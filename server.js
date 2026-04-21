const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const os = require("os");
const QRCode = require("qrcode");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// Find the machine's LAN IP (e.g. 192.168.x.x) so phones on the same Wi-Fi can connect.
// On EC2, set PUBLIC_HOST env var to override (e.g. PUBLIC_HOST=ec2-1-2-3-4.compute.amazonaws.com)
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}
const LAN_IP = getLanIp();
const PUBLIC_HOST = process.env.PUBLIC_HOST || null;

// ── Default Questions ──────────────────────────────────────────────────────
const DEFAULT_QUESTIONS = [
  { text: "What is the capital of France?", answers: ["Berlin", "Paris", "Madrid", "Rome"], correct: 1, time: 20 },
  { text: "Which planet is known as the Red Planet?", answers: ["Venus", "Jupiter", "Mars", "Saturn"], correct: 2, time: 20 },
  { text: "What is 12 × 12?", answers: ["124", "144", "132", "148"], correct: 1, time: 15 },
  { text: "Who wrote 'Romeo and Juliet'?", answers: ["Charles Dickens", "Mark Twain", "William Shakespeare", "Jane Austen"], correct: 2, time: 20 },
  { text: "What is the chemical symbol for water?", answers: ["O2", "CO2", "H2O", "HO"], correct: 2, time: 15 },
  { text: "How many sides does a hexagon have?", answers: ["5", "7", "8", "6"], correct: 3, time: 15 },
  { text: "Which ocean is the largest?", answers: ["Atlantic", "Indian", "Arctic", "Pacific"], correct: 3, time: 20 },
  { text: "What year did World War II end?", answers: ["1943", "1944", "1945", "1946"], correct: 2, time: 20 },
  { text: "What is the fastest land animal?", answers: ["Lion", "Cheetah", "Horse", "Leopard"], correct: 1, time: 20 },
  { text: "Which language runs in a web browser?", answers: ["Python", "Java", "C++", "JavaScript"], correct: 3, time: 15 },
];

// ── Room State ─────────────────────────────────────────────────────────────
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getLeaderboard(room) {
  return Object.values(room.players)
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

// ── Socket Events ──────────────────────────────────────────────────────────
io.on("connection", (socket) => {

  socket.on("host:create", async () => {
    const code = generateCode();
    rooms[code] = {
      hostId: socket.id,
      players: {},
      questions: [...DEFAULT_QUESTIONS],
      currentQ: -1,
      timer: null,
      phase: "lobby",
    };
    socket.join(code);

    // Build player join URL.
    // Priority: PUBLIC_HOST env var (prod) → request host → LAN IP fallback.
    let host;
    if (PUBLIC_HOST) {
      host = PUBLIC_HOST;
    } else {
      host = socket.handshake.headers.host || `${LAN_IP}:${PORT}`;
      if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) {
        const port = host.split(":")[1] || PORT;
        host = `${LAN_IP}:${port}`;
      }
    }
    const proto = socket.handshake.headers["x-forwarded-proto"] || "http";
    const joinUrl = `${proto}://${host}/player.html?code=${code}`;

    let qrDataUrl = null;
    try {
      qrDataUrl = await QRCode.toDataURL(joinUrl, {
        width: 280,
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
    } catch (err) {
      console.error("QR generation failed:", err);
    }

    socket.emit("host:created", { code, joinUrl, qrDataUrl });
  });

  socket.on("player:join", ({ code, name }) => {
    const room = rooms[code];
    if (!room) return socket.emit("player:error", "Room not found.");
    if (room.phase !== "lobby") return socket.emit("player:error", "Game already started.");
    if (Object.keys(room.players).length >= 50) return socket.emit("player:error", "Room is full.");

    const trimmed = name.trim().substring(0, 20);
    if (!trimmed) return socket.emit("player:error", "Enter a valid name.");

    room.players[socket.id] = { name: trimmed, score: 0, answered: false };
    socket.join(code);
    socket.data.code = code;
    socket.data.name = trimmed;

    socket.emit("player:joined", { name: trimmed });
    io.to(room.hostId).emit("host:player_joined", {
      players: Object.values(room.players).map(p => p.name),
    });
  });

  socket.on("host:start", () => {
    const code = getHostRoom(socket.id);
    if (!code) return;
    const room = rooms[code];
    room.phase = "playing";
    room.currentQ = 0;
    sendQuestion(code);
  });

  socket.on("host:next", () => {
    const code = getHostRoom(socket.id);
    if (!code) return;
    const room = rooms[code];
    room.currentQ++;
    if (room.currentQ >= room.questions.length) {
      endGame(code);
    } else {
      sendQuestion(code);
    }
  });

  socket.on("player:answer", ({ answerIndex }) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (!room || room.phase !== "playing") return;

    const player = room.players[socket.id];
    if (!player || player.answered) return;

    player.answered = true;
    const q = room.questions[room.currentQ];
    const isCorrect = answerIndex === q.correct;
    const points = isCorrect ? Math.round(500 + (player.timeLeft / q.time) * 500) : 0;
    player.score += points;

    socket.emit("player:answer_result", { correct: isCorrect, points });

    const answeredCount = Object.values(room.players).filter(p => p.answered).length;
    io.to(room.hostId).emit("host:answer_update", {
      answered: answeredCount,
      total: Object.keys(room.players).length,
    });

    if (answeredCount === Object.keys(room.players).length) {
      clearTimeout(room.timer);
      showAnswerReveal(code);
    }
  });

  socket.on("player:tick", ({ timeLeft }) => {
    const code = socket.data.code;
    const room = rooms[code];
    if (room && room.players[socket.id]) {
      room.players[socket.id].timeLeft = timeLeft;
    }
  });

  socket.on("disconnect", () => {
    const code = socket.data.code;
    if (code && rooms[code]) {
      const room = rooms[code];
      if (room.hostId === socket.id) {
        io.to(code).emit("game:closed", "Host disconnected.");
        clearTimeout(room.timer);
        delete rooms[code];
      } else {
        delete room.players[socket.id];
        io.to(room.hostId).emit("host:player_joined", {
          players: Object.values(room.players).map(p => p.name),
        });
      }
    }
  });
});

// ── Game Helpers ───────────────────────────────────────────────────────────
function sendQuestion(code) {
  const room = rooms[code];
  const q = room.questions[room.currentQ];

  Object.values(room.players).forEach(p => { p.answered = false; p.timeLeft = q.time; });

  io.to(room.hostId).emit("host:question", {
    question: q.text,
    answers: q.answers,
    correct: q.correct,
    time: q.time,
    index: room.currentQ,
    total: room.questions.length,
  });

  Object.keys(room.players).forEach(pid => {
    io.to(pid).emit("player:question", {
      question: q.text,
      answers: q.answers,
      time: q.time,
      index: room.currentQ,
      total: room.questions.length,
    });
  });

  room.timer = setTimeout(() => showAnswerReveal(code), (q.time + 1) * 1000);
}

function showAnswerReveal(code) {
  const room = rooms[code];
  if (!room) return;
  clearTimeout(room.timer);

  const q = room.questions[room.currentQ];
  const lb = getLeaderboard(room);

  io.to(code).emit("game:reveal", {
    correct: q.correct,
    leaderboard: lb.slice(0, 10),
  });
}

function endGame(code) {
  const room = rooms[code];
  if (!room) return;
  const lb = getLeaderboard(room);
  io.to(code).emit("game:end", { leaderboard: lb });
  room.phase = "ended";
}

function getHostRoom(socketId) {
  return Object.keys(rooms).find(c => rooms[c].hostId === socketId) || null;
}

// ── Start Server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
// Listen on :: (all interfaces, IPv4 + IPv6) so phones that connect via IPv6 work too
server.listen(PORT, "::", () => {
  console.log(`\n🎮 TriviaBlast is running!\n`);
  console.log(`   Host (this device):  http://localhost:${PORT}`);
  console.log(`   Host (LAN):          http://${LAN_IP}:${PORT}`);
  console.log(`   Players (phones):    http://${LAN_IP}:${PORT}/player.html\n`);
});
