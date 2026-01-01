const socket = io();
const peers = {};
const videos = document.getElementById("videos");
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

let localStream = null;

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
  videos.appendChild(video);
}

async function getMedia(video = false) {
  return await navigator.mediaDevices.getUserMedia({
    audio: true,
    video
  });
}

socket.on("user-joined", async id => {
  const pc = new RTCPeerConnection(config);
  peers[id] = pc;

  if (!localStream) {
    localStream = await getMedia();
    createVideo("me", localStream, true);
  }

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.onicecandidate = e => {
    if (e.candidate)
      socket.emit("ice-candidate", e.candidate, id);
  };

  pc.ontrack = e => createVideo(id, e.streams[0]);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", offer, id);
});

socket.on("offer", async (offer, id) => {
  const pc = new RTCPeerConnection(config);
  peers[id] = pc;

  if (!localStream) {
    localStream = await getMedia();
    createVideo("me", localStream, true);
  }

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.ontrack = e => createVideo(id, e.streams[0]);

  pc.onicecandidate = e => {
    if (e.candidate)
      socket.emit("ice-candidate", e.candidate, id);
  };

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", answer, id);
});

socket.on("answer", async answer => {
  const pc = Object.values(peers)[0];
  await pc.setRemoteDescription(answer);
});

socket.on("ice-candidate", async candidate => {
  const pc = Object.values(peers)[0];
  await pc.addIceCandidate(candidate);
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
