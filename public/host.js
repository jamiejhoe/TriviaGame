const socket = io();
let roomCode = null;
let joinUrl = null;
let qrDataUrl = null;
let timerInterval = null;
let totalPlayers = 0;

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function createRoom() {
  socket.emit("host:create");
}

socket.on("host:created", ({ code, joinUrl: url, qrDataUrl: qr }) => {
  roomCode = code;
  joinUrl = url;
  qrDataUrl = qr;
  document.getElementById("join-code").textContent = code;
  const displayUrl = url ? url.replace(/^https?:\/\//, "").split("/")[0] : window.location.host;
  document.getElementById("join-url").textContent = displayUrl;
  if (qr) {
    const img = document.getElementById("qr-code");
    img.src = qr;
    img.style.display = "block";
  }
  showScreen("screen-lobby");
});

socket.on("host:player_joined", ({ players }) => {
  totalPlayers = players.length;
  document.getElementById("player-count").textContent =
    `${players.length} player${players.length !== 1 ? "s" : ""} joined`;

  const chips = document.getElementById("player-chips");
  chips.innerHTML = players.map(n => `<span class="chip">${n}</span>`).join("");

  document.getElementById("start-btn").disabled = players.length < 1;
});

socket.on("host:player_left", ({ name, players }) => {
  totalPlayers = players.length;
  document.getElementById("player-count").textContent =
    `${players.length} player${players.length !== 1 ? "s" : ""} connected`;

  const chips = document.getElementById("player-chips");
  chips.innerHTML = players.map(n => `<span class="chip">${n}</span>`).join("");
  
  // Brief notification that someone disconnected
  console.log(`${name} disconnected (can rejoin)`);
});

function startGame() {
  socket.emit("host:start");
  // Show the floating join info button with the room code
  const joinBtn = document.getElementById("show-join-btn");
  joinBtn.textContent = `📲 ${roomCode}`;
  joinBtn.classList.remove("hidden");
}

function openJoinModal() {
  const modal = document.getElementById("join-modal");
  document.getElementById("modal-join-code").textContent = roomCode;
  const displayUrl = joinUrl ? joinUrl.replace(/^https?:\/\//, "").split("/")[0] : window.location.host;
  document.getElementById("modal-join-url").textContent = displayUrl;
  if (qrDataUrl) {
    const img = document.getElementById("modal-qr-code");
    img.src = qrDataUrl;
    img.style.display = "block";
  }
  modal.classList.remove("hidden");
}

function closeJoinModal(event) {
  if (event && event.target !== event.currentTarget && !event.target.classList.contains("join-modal-close")) return;
  document.getElementById("join-modal").classList.add("hidden");
}

socket.on("host:question", ({ question, answers, correct, time, index, total }) => {
  document.getElementById("q-counter").textContent = `Q ${index + 1} / ${total}`;
  document.getElementById("q-text").textContent = question;
  document.getElementById("answer-tally").textContent = `0 / ${totalPlayers} answered`;

  const grid = document.getElementById("answers-grid");
  const shapes = ["▲", "◆", "●", "■"];
  const colors = ["color-0", "color-1", "color-2", "color-3"];
  grid.innerHTML = answers.map((a, i) =>
    `<div class="answer-btn ${colors[i]} no-hover">
       <span class="shape">${shapes[i]}</span> ${a}
     </div>`
  ).join("");

  showScreen("screen-question");
  startTimer(time);
});

socket.on("host:answer_update", ({ answered, total }) => {
  document.getElementById("answer-tally").textContent = `${answered} / ${total} answered`;
});

function startTimer(seconds) {
  clearInterval(timerInterval);
  let timeLeft = seconds;
  const circle = document.getElementById("timer-circle");
  const circumference = 163.4;

  function tick() {
    document.getElementById("timer-text").textContent = timeLeft;
    const progress = timeLeft / seconds;
    circle.style.strokeDashoffset = circumference * (1 - progress);
    circle.style.stroke = progress > 0.5 ? "#fff" : progress > 0.25 ? "#ffd700" : "#ff3355";
    if (timeLeft <= 0) clearInterval(timerInterval);
    else timeLeft--;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

socket.on("game:reveal", ({ correct, leaderboard }) => {
  clearInterval(timerInterval);

  const btns = document.querySelectorAll("#answers-grid .answer-btn");
  btns.forEach((btn, i) => {
    if (i === correct) btn.classList.add("reveal-correct");
    else btn.classList.add("wrong");
  });

  setTimeout(() => {
    renderLeaderboard("leaderboard", leaderboard);
    showScreen("screen-reveal");
  }, 2000);
});

function nextQuestion() {
  socket.emit("host:next");
}

socket.on("game:end", ({ leaderboard }) => {
  renderLeaderboard("final-leaderboard", leaderboard, true);
  showScreen("screen-end");
});

function renderLeaderboard(containerId, lb, final = false) {
  const medals = ["🥇", "🥈", "🥉"];
  document.getElementById(containerId).innerHTML = lb.map((p, i) =>
    `<div class="lb-row ${i === 0 && final ? "lb-winner" : ""}">
       <span class="lb-rank">${medals[i] || i + 1}</span>
       <span class="lb-name">${p.name}</span>
       <span class="lb-score">${p.score}</span>
     </div>`
  ).join("");
}

socket.on("game:closed", (msg) => alert(msg));

// ── Poll ───────────────────────────────────────────────────────────────────
function startPoll() {
  socket.emit("host:start_poll");
}

socket.on("host:poll", ({ question, options }) => {
  document.getElementById("poll-question-text").textContent = question;
  document.getElementById("poll-tally").textContent = `0 / ${totalPlayers} voted`;

  const grid = document.getElementById("poll-options-grid");
  const colors = ["color-0", "color-1", "color-2", "color-3", "color-0", "color-1"];
  const shapes = ["▲", "◆", "●", "■", "★", "⬟"];
  grid.innerHTML = options.map((opt, i) =>
    `<div class="answer-btn ${colors[i]} no-hover">
       <span class="shape">${shapes[i]}</span> ${opt}
     </div>`
  ).join("");

  showScreen("screen-poll");
});

socket.on("host:poll_update", ({ voted, total }) => {
  document.getElementById("poll-tally").textContent = `${voted} / ${total} voted`;
});

function revealPoll() {
  socket.emit("host:reveal_poll");
}

socket.on("poll:results", ({ question, results }) => {
  const container = document.getElementById("poll-results");
  const maxVotes = Math.max(...results.map(r => r.votes), 1);
  container.innerHTML = results.map(r =>
    `<div class="poll-result-row">
       <div class="poll-result-label">${r.option}</div>
       <div class="poll-result-bar-wrap">
         <div class="poll-result-bar" style="width: ${(r.votes / maxVotes) * 100}%"></div>
         <span class="poll-result-count">${r.votes} vote${r.votes !== 1 ? 's' : ''}</span>
       </div>
     </div>`
  ).join("");
  showScreen("screen-poll-results");
});
