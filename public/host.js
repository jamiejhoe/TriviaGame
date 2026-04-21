const socket = io();
let roomCode = null;
let timerInterval = null;
let totalPlayers = 0;

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function createRoom() {
  socket.emit("host:create");
}

socket.on("host:created", ({ code, joinUrl, qrDataUrl }) => {
  roomCode = code;
  document.getElementById("join-code").textContent = code;
  // Show the LAN URL from the server (strips protocol for cleaner display)
  const displayUrl = joinUrl ? joinUrl.replace(/^https?:\/\//, "").split("/")[0] : window.location.host;
  document.getElementById("join-url").textContent = displayUrl;
  if (qrDataUrl) {
    const img = document.getElementById("qr-code");
    img.src = qrDataUrl;
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
