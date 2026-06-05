const socket = io();
let score = 0;
let timerInterval = null;

// Auto-fill code from URL (?code=ABC12) when scanning QR
const urlCode = new URLSearchParams(window.location.search).get("code");
if (urlCode) {
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("code-input").value = urlCode.toUpperCase();
    document.getElementById("name-input").focus();
  });
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showError(msg) {
  const el = document.getElementById("error-msg");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function joinGame() {
  const code = document.getElementById("code-input").value.trim().toUpperCase();
  const name = document.getElementById("name-input").value.trim();
  if (!code || code.length < 4) return showError("Enter a valid game code.");
  if (!name) return showError("Enter your name.");
  document.getElementById("error-msg").classList.add("hidden");
  socket.emit("player:join", { code, name });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && document.getElementById("screen-join").classList.contains("active")) {
    joinGame();
  }
});

socket.on("player:joined", ({ name }) => {
  document.getElementById("waiting-name").textContent = name;
  showScreen("screen-waiting");
});

// Late join - player joined after game started
socket.on("player:joined_late", ({ name, currentQ, total }) => {
  score = 0;
  document.getElementById("waiting-name").textContent = name;
  document.getElementById("waiting-msg").innerHTML = 
    `You joined mid-game!<br>Question ${currentQ} of ${total}`;
  showScreen("screen-waiting");
});

// Rejoin - player reconnected and recovered their score
socket.on("player:rejoined", ({ name, score: savedScore, phase, currentQ, total }) => {
  score = savedScore;
  document.getElementById("waiting-name").textContent = name;
  document.getElementById("waiting-msg").innerHTML = 
    `Welcome back! 🎉<br>Score: ${savedScore} points`;
  document.getElementById("p-score").textContent = score;
  showScreen("screen-waiting");
});

// Waiting state when rejoined but already answered current question
socket.on("player:wait_for_next", ({ message }) => {
  document.getElementById("waiting-msg").textContent = message;
  showScreen("screen-waiting");
});

socket.on("player:error", (msg) => showError(msg));

socket.on("player:question", ({ question, answers, time, timeRemaining }) => {
  document.getElementById("p-question-text").textContent = question;
  document.getElementById("p-score").textContent = score;

  const shapes = ["▲", "◆", "●", "■"];
  const colors = ["color-0", "color-1", "color-2", "color-3"];
  const grid = document.getElementById("p-answers-grid");
  grid.innerHTML = answers.map((a, i) =>
    `<button class="answer-btn ${colors[i]}" onclick="submitAnswer(${i}, this)">
       <span class="shape">${shapes[i]}</span> ${a}
     </button>`
  ).join("");

  showScreen("screen-question");
  // Use timeRemaining if provided (rejoin/late join), otherwise full time
  startTimer(timeRemaining != null ? timeRemaining : time, time);
});

function startTimer(seconds, totalTime) {
  if (!totalTime) totalTime = seconds;
  clearInterval(timerInterval);
  let timeLeft = seconds;
  const circle = document.getElementById("p-timer-circle");
  const circumference = 163.4;

  function tick() {
    socket.emit("player:tick", { timeLeft });
    document.getElementById("p-timer-text").textContent = timeLeft;
    const progress = timeLeft / totalTime;
    circle.style.strokeDashoffset = circumference * (1 - progress);
    circle.style.stroke = progress > 0.5 ? "#fff" : progress > 0.25 ? "#ffd700" : "#ff3355";
    if (timeLeft <= 0) clearInterval(timerInterval);
    else timeLeft--;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function submitAnswer(index, btn) {
  if (btn.disabled) return;
  clearInterval(timerInterval);
  document.querySelectorAll("#p-answers-grid .answer-btn").forEach(b => b.disabled = true);
  btn.style.outline = "4px solid #fff";
  socket.emit("player:answer", { answerIndex: index });
}

socket.on("player:answer_result", ({ correct, points }) => {
  score += points;
  document.getElementById("p-feedback-icon").textContent = correct ? "✅" : "❌";
  document.getElementById("p-feedback-msg").textContent = correct ? "Correct!" : "Wrong!";
  document.getElementById("p-feedback-points").textContent = correct ? `+${points} points` : "";
  showScreen("screen-feedback");
});

socket.on("game:reveal", ({ leaderboard }) => {
  renderLeaderboard("p-leaderboard", leaderboard);
  showScreen("screen-lb");
});

socket.on("game:end", ({ leaderboard }) => {
  renderLeaderboard("p-final-leaderboard", leaderboard, true);
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

socket.on("game:closed", (msg) => {
  alert(msg);
  location.reload();
});
