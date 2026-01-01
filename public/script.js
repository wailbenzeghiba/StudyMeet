const socket = io();
const peers = {};
const videos = document.getElementById("videos");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const usernameInput = document.getElementById("username-input");

let localStream = null;
let localId = null;
let username = "You";
let localVideoContainer = null; // Track the local video container
const usernames = {};

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

socket.emit("join-room");

// Handle username changes
usernameInput.addEventListener("input", (e) => {
  username = e.target.value || "You";
  // Update local username display
  if (localVideoContainer) {
    const label = localVideoContainer.querySelector('.video-label');
    if (label) {
      label.textContent = username;
    }
  }
  // Broadcast username change to others
  socket.emit("username-change", username);
});

socket.on("user-username", (id, name) => {
  usernames[id] = name;
  const video = document.querySelector(`#${id}`);
  if (video) {
    const container = video.closest('.video-container');
    if (container) {
      const label = container.querySelector('.video-label');
      if (label) {
        label.textContent = name;
      }
    }
  }
});

function createVideoContainer(id, stream, muted = false, name = "User") {
  const container = document.createElement("div");
  container.className = "video-container";
  container.id = `container-${id}`;

  const videoWrapper = document.createElement("div");
  videoWrapper.className = "video-wrapper";

  const video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = muted;
  video.id = id;
  video.style.minHeight = "200px";

  if (!muted) {
    video.volume = 1;
  }

  const fullscreenBtn = document.createElement("button");
  fullscreenBtn.className = "fullscreen-btn";
  fullscreenBtn.innerHTML = "⛶";
  fullscreenBtn.title = "Fullscreen";
  fullscreenBtn.onclick = (e) => {
    e.stopPropagation();
    if (video.requestFullscreen) {
      video.requestFullscreen();
    } else if (video.webkitRequestFullscreen) {
      video.webkitRequestFullscreen();
    }
  };

  videoWrapper.appendChild(video);
  videoWrapper.appendChild(fullscreenBtn);

  const label = document.createElement("div");
  label.className = "video-label";
  label.textContent = name;

  container.appendChild(videoWrapper);
  container.appendChild(label);

  videos.appendChild(container);
  
  return container;
}

function updateLocalVideo(stream, name) {
  if (!localVideoContainer) {
    localVideoContainer = createVideoContainer("me", stream, true, name);
  } else {
    const video = localVideoContainer.querySelector('video');
    video.srcObject = stream;
    
    const label = localVideoContainer.querySelector('.video-label');
    if (label) {
      label.textContent = name;
    }
  }
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
    localVideoContainer = createVideoContainer("me", localStream, true, username);
  }

  // Add all local tracks to the peer connection
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
    const remoteUsername = usernames[id] || "User";
    // Check if we already have a container for this user
    const existingContainer = document.querySelector(`#container-${id}`);
    if (!existingContainer) {
      createVideoContainer(id, e.streams[0], false, remoteUsername);
    } else {
      // Update existing container
      const video = existingContainer.querySelector('video');
      video.srcObject = e.streams[0];
    }
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
    localVideoContainer = createVideoContainer("me", localStream, true, username);
  }

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.ontrack = e => {
    console.log("Received remote track from", id);
    const remoteUsername = usernames[id] || "User";
    // Check if we already have a container for this user
    const existingContainer = document.querySelector(`#container-${id}`);
    if (!existingContainer) {
      createVideoContainer(id, e.streams[0], false, remoteUsername);
    } else {
      // Update existing container
      const video = existingContainer.querySelector('video');
      video.srcObject = e.streams[0];
    }
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
  const container = document.querySelector(`#container-${id}`);
  container?.remove();
  peers[id]?.close();
  delete peers[id];
  delete usernames[id];
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
      createVideoContainer("me", localStream, true, username);
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

      // Update the local video container
      updateLocalVideo(localStream, username);

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

      // Update local video display
      updateLocalVideo(localStream, username);

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
        updateButtonState(camBtn, false);
      }

      // Get screenshare
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false
      });

      screenSharing = true;
      const screenTrack = screenStream.getVideoTracks()[0];

      // Update local video container with screenshare
      updateLocalVideo(screenStream, `${username} (Screen)`);

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
        
        // Update local video to show nothing
        updateLocalVideo(localStream, username);

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
