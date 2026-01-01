const socket = io();
const peers = {};
const videos = document.getElementById("videos");

let localStream;
let micEnabled = true;
let camEnabled = false;

// Get mic on join
(async () => {
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false
  });
})();

// Create peer
function createPeer(id) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });

  localStream.getTracks().forEach(track =>
    pc.addTrack(track, localStream)
  );

  pc.ontrack = e => {
    let video = document.getElementById(id);
    if (!video) {
      video = document.createElement("video");
      video.id = id;
      video.autoplay = true;
      video.playsInline = true;
      videos.appendChild(video);
    }
    video.srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit("signal", {
        to: id,
        signal: { candidate: e.candidate }
      });
    }
  };

  return pc;
}

// New user
socket.on("user-joined", async id => {
  const pc = createPeer(id);
  peers[id] = pc;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("signal", {
    to: id,
    signal: { sdp: pc.localDescription }
  });
});

// Signals
socket.on("signal", async data => {
  let pc = peers[data.from];
  if (!pc) {
    pc = createPeer(data.from);
    peers[data.from] = pc;
  }

  if (data.signal.sdp) {
    await pc.setRemoteDescription(data.signal.sdp);
    if (data.signal.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", {
        to: data.from,
        signal: { sdp: pc.localDescription }
      });
    }
  }

  if (data.signal.candidate) {
    await pc.addIceCandidate(data.signal.candidate);
  }
});

// User leaves
socket.on("user-left", id => {
  if (peers[id]) peers[id].close();
  delete peers[id];
  const video = document.getElementById(id);
  if (video) video.remove();
});

// Controls
document.getElementById("muteBtn").onclick = () => {
  micEnabled = !micEnabled;
  localStream.getAudioTracks()[0].enabled = micEnabled;
};

document.getElementById("camBtn").onclick = async () => {
  if (!camEnabled) {
    const cam = await navigator.mediaDevices.getUserMedia({ video: true });
    cam.getTracks().forEach(track => {
      localStream.addTrack(track);
      Object.values(peers).forEach(pc =>
        pc.addTrack(track, localStream)
      );
    });
    camEnabled = true;
  }
};

document.getElementById("screenBtn").onclick = async () => {
  const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const track = screen.getVideoTracks()[0];
  Object.values(peers).forEach(pc => {
    const sender = pc.getSenders().find(s => s.track.kind === "video");
    if (sender) sender.replaceTrack(track);
  });
};
