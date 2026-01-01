const socket = io();
const peers = {};
const videos = document.getElementById("videos");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

let localStream = null;
let localId = null;

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

socket.emit("join-room");

function createVideo(id, stream, muted = false) {
  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  video.id = id;
  video.style.minHeight = "200px";
  
  // Ensure audio plays from remote streams
  if (!muted) {
    video.volume = 1;
  }
  
  videos.appendChild(video);
}

async function getMedia(video = false) {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: video ? { width: 1280, height: 720 } : false
    });
  } catch (error) {
    console.error("Error accessing media:", error);
    alert("Unable to access microphone/camera. Check permissions.");
    throw error;
  }
}

socket.on("user-joined", async id => {
  console.log("User joined:", id);
  const pc = new RTCPeerConnection(config);
  peers[id] = pc;

  if (!localStream) {
    localStream = await getMedia();
    localId = socket.id;
    createVideo("me", localStream, true);
  }

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.onicecandidate = e => {
    if (e.candidate) {
      console.log("Sending ICE candidate to", id);
      socket.emit("ice-candidate", e.candidate, id);
    }
  };

  pc.ontrack = e => {
    console.log("Received remote track from", id);
    createVideo(id, e.streams[0]);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  console.log("Sending offer to", id);
  socket.emit("offer", offer, id);
});

socket.on("offer", async (offer, id) => {
  console.log("Received offer from", id);
  const pc = new RTCPeerConnection(config);
  peers[id] = pc;

  if (!localStream) {
    localStream = await getMedia();
    localId = socket.id;
    createVideo("me", localStream, true);
  }

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.ontrack = e => {
    console.log("Received remote track from", id);
    createVideo(id, e.streams[0]);
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      console.log("Sending ICE candidate to", id);
      socket.emit("ice-candidate", e.candidate, id);
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  console.log("Sending answer to", id);
  socket.emit("answer", answer, id);
});

socket.on("answer", async answer => {
  // Find the correct peer connection by checking which one has a pending answer
  for (const [id, pc] of Object.entries(peers)) {
    if (pc.signalingState === "have-local-offer") {
      console.log("Setting remote description (answer) for", id);
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      break;
    }
  }
});

socket.on("ice-candidate", async candidate => {
  // Add ICE candidate to all peers (it will be filtered correctly)
  for (const pc of Object.values(peers)) {
    try {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (e) {
      console.log("Error adding ICE candidate:", e);
    }
  }
});

socket.on("user-left", id => {
  document.getElementById(id)?.remove();
  peers[id]?.close();
  delete peers[id];
});

/* CONTROLS */

let micEnabled = true;
let camEnabled = false;
let screenSharing = false;
let screenStream = null;

const micBtn = document.getElementById("mic");
const camBtn = document.getElementById("cam");
const screenBtn = document.getElementById("screen");
const endCallBtn = document.getElementById("end-call");

function updateButtonState(btn, isActive) {
  if (isActive) {
    btn.classList.add("active");
  } else {
    btn.classList.remove("active");
  }
}

function replaceTrackForAllPeers(newTrack, trackType) {
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track && s.track.kind === trackType);
    if (sender) {
      sender.replaceTrack(newTrack).catch(e => console.error("Error replacing track:", e));
    }
  });
}

micBtn.onclick = async () => {
  if (!localStream) {
    // First time enabling mic
    try {
      localStream = await getMedia();
      localId = socket.id;
      createVideo("me", localStream, true);
      micEnabled = true;
      updateButtonState(micBtn, false);
    } catch (e) {
      console.error("Error enabling mic:", e);
    }
    return;
  }

  micEnabled = !micEnabled;
  
  // Toggle audio track
  localStream.getAudioTracks().forEach(track => {
    track.enabled = micEnabled;
  });

  // Broadcast audio state change to all peers
  Object.values(peers).forEach(pc => {
    const audioSender = pc.getSenders().find(s => s.track && s.track.kind === "audio");
    if (audioSender) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioSender.replaceTrack(audioTrack).catch(e => console.error("Error replacing audio:", e));
      }
    }
  });

  updateButtonState(micBtn, !micEnabled);
  micBtn.querySelector(".label").textContent = micEnabled ? "Mute" : "Unmute";
};

camBtn.onclick = async () => {
  try {
    if (camEnabled) {
      // Turn off camera
      camEnabled = false;
      localStream.getVideoTracks().forEach(track => track.stop());
      document.getElementById("me")?.remove();
      updateButtonState(camBtn, false);
      
      // Send null/empty video track to peers
      Object.values(peers).forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (videoSender) {
          videoSender.replaceTrack(null).catch(e => console.error("Error removing video:", e));
        }
      });
    } else {
      // Turn on camera - stop screenshare first if active
      if (screenSharing) {
        screenSharing = false;
        screenStream?.getTracks().forEach(track => track.stop());
        updateButtonState(screenBtn, false);
      }

      camEnabled = true;
      const mediaStream = await getMedia(true);
      
      // Keep audio from original stream
      const audioTrack = localStream.getAudioTracks()[0];
      const videoTrack = mediaStream.getVideoTracks()[0];

      // Stop previous video tracks
      localStream.getVideoTracks().forEach(track => track.stop());

      // Add new video track to local stream
      if (audioTrack) {
        mediaStream.removeTrack(audioTrack);
      }
      localStream.addTrack(videoTrack);

      // Remove old video element and create new one
      document.getElementById("me")?.remove();
      createVideo("me", localStream, true);

      // Broadcast video to all peers
      Object.values(peers).forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (videoSender) {
          videoSender.replaceTrack(videoTrack).catch(e => console.error("Error replacing video:", e));
        } else {
          // If no sender exists, add new track
          pc.addTrack(videoTrack, localStream);
        }
      });

      updateButtonState(camBtn, true);
    }
  } catch (e) {
    console.error("Error with camera:", e);
  }
};

screenBtn.onclick = async () => {
  try {
    if (screenSharing) {
      // Stop screenshare
      screenSharing = false;
      screenStream?.getTracks().forEach(track => track.stop());
      screenStream = null;
      updateButtonState(screenBtn, false);

      // Remove screenshare video element
      document.getElementById("me")?.remove();

      // Send empty video track to peers
      Object.values(peers).forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (videoSender) {
          videoSender.replaceTrack(null).catch(e => console.error("Error removing video:", e));
        }
      });
    } else {
      // Turn off camera first
      if (camEnabled) {
        camEnabled = false;
        localStream.getVideoTracks().forEach(track => track.stop());
        document.getElementById("me")?.remove();
        updateButtonState(camBtn, false);
      }

      // Get screenshare
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false
      });

      screenSharing = true;
      const screenTrack = screenStream.getVideoTracks()[0];

      // Create video element for screenshare
      createVideo("me", screenStream, true);

      // Broadcast screenshare to all peers
      Object.values(peers).forEach(pc => {
        const videoSender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (videoSender) {
          videoSender.replaceTrack(screenTrack).catch(e => console.error("Error replacing video:", e));
        } else {
          pc.addTrack(screenTrack, screenStream);
        }
      });

      updateButtonState(screenBtn, true);

      // When user stops screenshare from browser, clean up
      screenTrack.onended = () => {
        screenSharing = false;
        updateButtonState(screenBtn, false);
        document.getElementById("me")?.remove();

        // Clear video from peers
        Object.values(peers).forEach(pc => {
          const videoSender = pc.getSenders().find(s => s.track && s.track.kind === "video");
          if (videoSender) {
            videoSender.replaceTrack(null).catch(e => console.error("Error removing video:", e));
          }
        });
      };
    }
  } catch (e) {
    console.error("Screenshare error:", e);
  }
};

endCallBtn.onclick = () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  if (screenStream) {
    screenStream.getTracks().forEach(track => track.stop());
  }
  Object.values(peers).forEach(pc => pc.close());
  location.reload();
};

/* CHAT */

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function displayMessage(text, isOwn = false) {
  const messageEl = document.createElement("div");
  messageEl.className = `message ${isOwn ? 'own' : 'other'}`;
  
  const textEl = document.createElement("div");
  textEl.textContent = text;
  messageEl.appendChild(textEl);
  
  const timeEl = document.createElement("div");
  timeEl.className = "message-time";
  timeEl.textContent = formatTime(new Date());
  messageEl.appendChild(timeEl);
  
  messagesDiv.appendChild(messageEl);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  
  displayMessage(text, true);
  socket.emit("chat-message", text);
  messageInput.value = "";
  messageInput.focus();
}

sendBtn.onclick = sendMessage;

messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});

socket.on("chat-message", (message) => {
  displayMessage(message, false);
});
