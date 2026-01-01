const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", socket => {
  console.log("User connected:", socket.id);

  socket.on("join-room", () => {
    socket.join("room");
    socket.to("room").emit("user-joined", socket.id);
  });

  socket.on("offer", (offer, to) => {
    socket.to(to).emit("offer", offer, socket.id);
  });

  socket.on("answer", (answer, to) => {
    socket.to(to).emit("answer", answer);
  });

  socket.on("ice-candidate", (candidate, to) => {
    socket.to(to).emit("ice-candidate", candidate);
  });

  socket.on("username-change", (name) => {
    socket.to("room").emit("user-username", socket.id, name);
  });

  socket.on("chat-message", (message) => {
    socket.to("room").emit("chat-message", message);
  });

  socket.on("disconnect", () => {
    socket.to("room").emit("user-left", socket.id);
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});