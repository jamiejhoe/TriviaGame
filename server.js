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
  // Round 1: AWS Enterprise Support
  { text: "What is the critical system response time SLA for AWS Enterprise Support customers?", answers: ["1 hour", "30 minutes", "15 minutes", "5 minutes"], correct: 2, time: 20 },
  { text: "What is the name of the designated resource assigned to Enterprise Support customers who provides architectural guidance and Well-Architected Reviews?", answers: ["Cloud Solutions Architect", "Technical Account Manager (TAM)", "Support Operations Lead", "DevOps Consultant"], correct: 1, time: 20 },
  { text: "Which security service is now included at no additional cost with AWS Enterprise Support?", answers: ["Amazon GuardDuty", "AWS Security Hub", "AWS Security Incident Response", "Amazon Inspector"], correct: 2, time: 20 },
  // Round 2: Basic AWS Knowledge
  { text: "What is the name of AWS's serverless compute service that runs code in response to events without provisioning servers?", answers: ["Amazon EC2", "AWS Fargate", "AWS Lambda", "Amazon ECS"], correct: 2, time: 20 },
  { text: "How many products and services does AWS offer (approximately)?", answers: ["Over 50", "Over 100", "Over 200", "Over 500"], correct: 2, time: 20 },
  { text: "Which of the following is NOT a pillar of the AWS Well-Architected Framework?", answers: ["Security", "Reliability", "Cost Optimization", "Availability"], correct: 3, time: 20 },
  // Round 3: AWS DevOps Agent
  { text: "AWS DevOps Agent is best described as your always-on, autonomous ___?", answers: ["Security Analyst", "Database Administrator", "On-call Engineer / SRE", "Network Architect"], correct: 2, time: 20 },
  { text: "Which of the following is NOT one of the key areas that AWS DevOps Agent delivers recommendations for?", answers: ["Observability (monitoring, alerting, logging)", "Infrastructure optimization (autoscaling, capacity tuning)", "Deployment pipeline enhancement (testing, validation)", "Database schema design"], correct: 3, time: 25 },
  // Round 4: Kiro
  { text: "Kiro is an AI-powered IDE built by AWS. What development methodology does it introduce that transforms 'vibe coding' into production-ready applications?", answers: ["Test-driven development", "Specification-driven development", "Behavior-driven development", "Trunk-based development"], correct: 1, time: 20 },
  { text: "Kiro is built on which AWS managed service for generative AI?", answers: ["Amazon SageMaker", "Amazon CodeWhisperer", "Amazon Bedrock", "Amazon Comprehend"], correct: 2, time: 20 },
  // Bonus Tiebreaker
  { text: "🏆 BONUS: AWS DevOps Agent reached General Availability in what month/year?", answers: ["January 2026", "March 2026", "June 2025", "December 2025"], correct: 1, time: 30 },
];

// ── Room State ─────────────────────────────────────────────────────────────
const rooms = {};

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function getLeaderboard(room) {
  return Object.values(room.players)
    .filter(p => p.connected) // Only show connected players
    .map(p => ({ name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score);
}

function getConnectedPlayers(room) {
  return Object.values(room.players).filter(p => p.connected);
}

function findPlayerByName(room, name) {
  return Object.entries(room.players).find(([_, p]) => p.name.toLowerCase() === name.toLowerCase());
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
    if (room.phase === "ended") return socket.emit("player:error", "Game has ended.");

    const trimmed = name.trim().substring(0, 20);
    if (!trimmed) return socket.emit("player:error", "Enter a valid name.");

    // Check if this is a rejoin (same name, disconnected player)
    const existingPlayer = findPlayerByName(room, trimmed);
    
    if (existingPlayer) {
      const [oldSocketId, player] = existingPlayer;
      
      if (player.connected) {
        return socket.emit("player:error", "Name already taken.");
      }
      
      // Rejoin: transfer player data to new socket
      delete room.players[oldSocketId];
      room.players[socket.id] = player;
      player.connected = true;
      player.socketId = socket.id;
      
      socket.join(code);
      socket.data.code = code;
      socket.data.name = player.name;

      // Send rejoin confirmation with current score
      socket.emit("player:rejoined", { 
        name: player.name, 
        score: player.score,
        phase: room.phase,
        currentQ: room.currentQ,
        total: room.questions.length
      });

      // If game is in progress, send current question state
      if (room.phase === "playing" && !player.answered) {
        const q = room.questions[room.currentQ];
        socket.emit("player:question", {
          question: q.text,
          answers: q.answers,
          time: q.time,
          index: room.currentQ,
          total: room.questions.length,
          lateJoin: true // Signal reduced time
        });
      } else if (room.phase === "playing" && player.answered) {
        socket.emit("player:wait_for_next", { message: "You already answered this question. Waiting for results..." });
      }

      console.log(`♻️  ${player.name} rejoined room ${code}`);
    } else {
      // New player joining
      if (Object.keys(room.players).length >= 50) {
        return socket.emit("player:error", "Room is full.");
      }

      // Check for duplicate name among connected players
      const nameTaken = Object.values(room.players).some(
        p => p.connected && p.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (nameTaken) {
        return socket.emit("player:error", "Name already taken.");
      }

      room.players[socket.id] = { 
        name: trimmed, 
        score: 0, 
        answered: false, 
        connected: true,
        socketId: socket.id,
        joinedAt: room.currentQ // Track when they joined for fair scoring
      };
      
      socket.join(code);
      socket.data.code = code;
      socket.data.name = trimmed;

      if (room.phase === "lobby") {
        socket.emit("player:joined", { name: trimmed });
      } else {
        // Late join during game
        socket.emit("player:joined_late", { 
          name: trimmed,
          currentQ: room.currentQ + 1,
          total: room.questions.length
        });

        // Send current question if in playing phase
        if (room.phase === "playing") {
          const q = room.questions[room.currentQ];
          socket.emit("player:question", {
            question: q.text,
            answers: q.answers,
            time: q.time,
            index: room.currentQ,
            total: room.questions.length,
            lateJoin: true
          });
        }

        console.log(`🆕 ${trimmed} late-joined room ${code} at Q${room.currentQ + 1}`);
      }
    }

    // Update host with player list
    io.to(room.hostId).emit("host:player_joined", {
      players: getConnectedPlayers(room).map(p => p.name),
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

    const answeredCount = Object.values(room.players).filter(p => p.connected && p.answered).length;
    const connectedCount = getConnectedPlayers(room).length;
    io.to(room.hostId).emit("host:answer_update", {
      answered: answeredCount,
      total: connectedCount,
    });

    if (answeredCount === connectedCount) {
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
      } else if (room.players[socket.id]) {
        // Mark player as disconnected instead of deleting (allows rejoin)
        room.players[socket.id].connected = false;
        console.log(`📴 ${room.players[socket.id].name} disconnected from room ${code}`);
        
        io.to(room.hostId).emit("host:player_left", {
          name: room.players[socket.id].name,
          players: getConnectedPlayers(room).map(p => p.name),
        });

        // Check if all remaining connected players have answered
        const connectedPlayers = getConnectedPlayers(room);
        if (room.phase === "playing" && connectedPlayers.length > 0) {
          const answeredCount = connectedPlayers.filter(p => p.answered).length;
          if (answeredCount === connectedPlayers.length) {
            clearTimeout(room.timer);
            showAnswerReveal(code);
          }
        }
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

  // Only send to connected players
  getConnectedPlayers(room).forEach(player => {
    io.to(player.socketId).emit("player:question", {
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
