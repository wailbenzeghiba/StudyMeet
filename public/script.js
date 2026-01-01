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

micBtn.onclick = async () => {
  if (!localStream) return;
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = micEnabled;
  });
  updateButtonState(micBtn, !micEnabled);
  micBtn.querySelector(".label").textContent = micEnabled ? "Mute" : "Unmute";
};

camBtn.onclick = async () => {
  if (camEnabled) {
    camEnabled = false;
    localStream.getVideoTracks().forEach(track => track.stop());
    document.getElementById("me")?.remove();
  } else {
    camEnabled = true;
    localStream = await getMedia(true);
    document.getElementById("me")?.remove();
    createVideo("me", localStream, true);
    
    Object.values(peers).forEach(pc => {
      localStream.getTracks().forEach(track =>
        pc.addTrack(track, localStream)
      );
    });
  }
  updateButtonState(camBtn, camEnabled);
};

screenBtn.onclick = async () => {
  try {
    if (screenSharing) {
      screenSharing = false;
      updateButtonState(screenBtn, false);
    } else {
      const stream = await navigator.mediaDevices.getDisplayMedia();
      screenSharing = true;
      updateButtonState(screenBtn, true);
      
      Object.values(peers).forEach(pc => {
        pc.addTrack(stream.getVideoTracks()[0], stream);
      });
      
      stream.getVideoTracks()[0].onended = () => {
        screenSharing = false;
        updateButtonState(screenBtn, false);
      };
    }
  } catch (e) {
    console.log("Screen share cancelled");
  }
};

endCallBtn.onclick = () => {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
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
