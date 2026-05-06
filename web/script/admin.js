import { APP_CONFIG, getRealtimeUrl } from "./config.js";

const PROFILES = [
  { id: "p1", label: "Inderpal" },
  { id: "p2", label: "AM" },
  { id: "p3", label: "Kacem" },
  { id: "p4", label: "Ahmed" },
  { id: "p5", label: "Rania" },
  { id: "p6", label: "Emi" },
];

const postgrestHeaders = {
  apikey: APP_CONFIG.supabaseAnonKey,
  authorization: `Bearer ${APP_CONFIG.supabaseAnonKey}`,
  "content-type": "application/json",
  accept: "application/json",
};

const questionForm = document.getElementById("question-form");
const resetForm = document.getElementById("reset-form");
const adminPasswordInput = document.getElementById("admin-password");
const gameTypeInput = document.getElementById("game-type");
const adminStatus = document.getElementById("admin-status");
const stateView = document.getElementById("state-view");
const roundsList = document.getElementById("rounds-list");
const adminConnectionStatus = document.getElementById("admin-connection-status");
const scoreboard = document.getElementById("scoreboard");
const correctBtn = document.getElementById("correct-btn");
const releaseBtn = document.getElementById("release-btn");
const activeQuestion = document.getElementById("active-question");
const answerTimer = document.getElementById("answer-timer");
const roundBadge = document.getElementById("round-badge");

let refreshInFlight = false;
let reconnectTimer = null;
let socket = null;
let currentRound = null;
let timerInterval = null;

async function postgrestJson(path, options = {}) {
  const headers = new Headers(postgrestHeaders);
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      headers.set(key, value);
    }
  }

  const response = await fetch(`${APP_CONFIG.supabaseUrl}${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || response.statusText || "Request failed";
    throw new Error(message);
  }

  return data;
}

function rpc(name, body = {}) {
  return postgrestJson(`/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function getGameState() {
  const data = await postgrestJson("/game_state?id=eq.1&select=id,current_round_id");
  return Array.isArray(data) ? data[0] : data;
}

async function getRounds() {
  const data = await postgrestJson(
    "/rounds?select=id,created_at,open,winner_profile_id,buzzed_at,game_type,point_value,answer_status,answer_deadline_at,correct_profile_id&order=created_at.desc"
  );
  return Array.isArray(data) ? data : [];
}

async function getScores() {
  const data = await postgrestJson("/scores?select=profile_id,total&order=total.desc");
  return Array.isArray(data) ? data : [];
}

function getProfileLabel(profileId) {
  return PROFILES.find((profile) => profile.id === profileId)?.label || profileId || "Unknown";
}

function setStatus(message, isError = false) {
  adminStatus.textContent = message;
  adminStatus.style.color = isError ? "#9b1c31" : "#466280";
}

function setConnectionStatus(message, tone = "open") {
  adminConnectionStatus.textContent = message;
  adminConnectionStatus.className = `status-pill status-pill-${tone}`;
}

function formatRoundTime(value) {
  if (!value) {
    return "Unknown time";
  }

  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRoundValue(round) {
  const type = round.game_type === "double" ? "Double Jeopardy" : "Jeopardy";
  return `${type} · ${round.point_value}`;
}

function getBadge(round) {
  if (!round?.id) {
    return { label: "Waiting", tone: "muted" };
  }

  if (round.answer_status === "answering") {
    return { label: "Answering", tone: "muted" };
  }

  if (round.answer_status === "correct") {
    return { label: "Correct", tone: "open" };
  }

  if (round.open) {
    return { label: "Open", tone: "open" };
  }

  return { label: "Closed", tone: "closed" };
}

function renderScores(scores) {
  if (!scores.length) {
    scoreboard.innerHTML = '<p class="muted compact">No scores yet.</p>';
    return;
  }

  scoreboard.innerHTML = scores
    .map(
      (item) => `
        <div class="score-row">
          <span>${getProfileLabel(item.profile_id)}</span>
          <strong>${Number(item.total || 0).toLocaleString()}</strong>
        </div>`
    )
    .join("");
}

function renderRounds(rounds, currentRoundId) {
  if (!rounds.length) {
    roundsList.innerHTML = '<p class="muted compact">No rounds yet.</p>';
    return;
  }

  roundsList.innerHTML = rounds
    .map((round) => {
      const isCurrent = round.id === currentRoundId;
      const badge = getBadge(round);
      const winner = round.correct_profile_id || round.winner_profile_id;
      return `
        <article class="round-row ${isCurrent ? "is-current" : ""}">
          <div class="round-row-top">
            <div>
              <p class="round-id">${formatRoundValue(round)}</p>
              <p class="round-meta">${formatRoundTime(round.created_at)}</p>
            </div>
            <span class="status-pill status-pill-${badge.tone}">
              ${isCurrent ? "Current" : badge.label}
            </span>
          </div>
          <p class="round-summary">
            ${winner ? `Player: ${getProfileLabel(winner)}` : "No player yet"}
          </p>
        </article>`;
    })
    .join("");
}

function clearTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function renderTimer(round) {
  clearTimer();
  answerTimer.textContent = "";

  if (round?.answer_status !== "answering" || !round.answer_deadline_at) {
    return;
  }

  const tick = async () => {
    const remainingMs = new Date(round.answer_deadline_at).getTime() - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    answerTimer.textContent = `${remaining}s left`;

    if (remainingMs <= 0) {
      clearTimer();
      const data = await rpc("expire_answer_window");
      if (data) {
        setStatus("Answer window expired. Buzzer released.");
      }
      refreshState();
    }
  };

  tick();
  timerInterval = setInterval(tick, 500);
}

function renderActiveQuestion(round) {
  currentRound = round;
  const badge = getBadge(round);
  roundBadge.textContent = badge.label;
  roundBadge.className = `status-pill status-pill-${badge.tone}`;
  correctBtn.disabled = round?.answer_status !== "answering";
  releaseBtn.disabled = round?.answer_status !== "answering";
  renderTimer(round);

  if (!round?.id) {
    activeQuestion.textContent = "No active question yet.";
    return;
  }

  if (round.answer_status === "answering") {
    activeQuestion.textContent = `${getProfileLabel(round.winner_profile_id)} is answering ${formatRoundValue(round)}.`;
    return;
  }

  if (round.answer_status === "correct") {
    activeQuestion.textContent = `${getProfileLabel(round.correct_profile_id)} scored ${round.point_value}.`;
    return;
  }

  activeQuestion.textContent = `${formatRoundValue(round)} is ${round.open ? "open for buzzes" : "closed"}.`;
}

function renderState(state, rounds, scores) {
  const round = rounds.find((item) => item.id === state?.current_round_id) || null;
  const payload = {
    current_round_id: state?.current_round_id,
    current_round: round,
  };

  stateView.textContent = JSON.stringify(payload, null, 2);
  renderScores(scores);
  renderRounds(rounds, state?.current_round_id);
  renderActiveQuestion(round);
}

async function refreshState() {
  if (refreshInFlight) {
    return;
  }

  refreshInFlight = true;
  try {
    const [state, rounds, scores] = await Promise.all([getGameState(), getRounds(), getScores()]);
    renderState(state, rounds, scores);
  } catch (error) {
    setStatus(`Failed to load state: ${error.message}`, true);
  } finally {
    refreshInFlight = false;
  }
}

function getAdminPassword() {
  return adminPasswordInput.value;
}

questionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const pointInput = document.querySelector('input[name="point-value"]:checked');

  try {
    const data = await rpc("start_question", {
      p_admin_password: getAdminPassword(),
      p_game_type: gameTypeInput.value,
      p_point_value: Number(pointInput.value),
    });

    if (!data) {
      setStatus("Start denied: invalid admin password.", true);
      return;
    }

    setStatus(`Started ${formatRoundValue(data)}.`);
    refreshState();
  } catch (error) {
    setStatus(`Start failed: ${error.message}`, true);
  }
});

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const data = await rpc("reset_game", {
      p_admin_password: getAdminPassword(),
    });

    if (!data) {
      setStatus("Reset denied: invalid admin password.", true);
      return;
    }

    setStatus(`Round reset: ${data.id}`);
    refreshState();
  } catch (error) {
    setStatus(`Reset failed: ${error.message}`, true);
  }
});

correctBtn.addEventListener("click", async () => {
  try {
    const data = await rpc("confirm_correct", {
      p_admin_password: getAdminPassword(),
    });

    if (!data) {
      setStatus("No answer to confirm or invalid admin password.", true);
      return;
    }

    setStatus(`${getProfileLabel(data.correct_profile_id)} scored ${data.point_value}.`);
    refreshState();
  } catch (error) {
    setStatus(`Confirm failed: ${error.message}`, true);
  }
});

releaseBtn.addEventListener("click", async () => {
  try {
    const data = await rpc("release_buzzer", {
      p_admin_password: getAdminPassword(),
    });

    if (!data) {
      setStatus("No active answer to release or invalid admin password.", true);
      return;
    }

    setStatus("Buzzer released for other contestants.");
    refreshState();
  } catch (error) {
    setStatus(`Release failed: ${error.message}`, true);
  }
});

const realtimeUrl = getRealtimeUrl();

function connectRealtime() {
  if (socket?.readyState === WebSocket.OPEN) {
    return;
  }

  setConnectionStatus("Connecting...", "muted");
  socket = new WebSocket(realtimeUrl);

  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        topic: "realtime:buzzer",
        event: "phx_join",
        payload: {
          access_token: APP_CONFIG.supabaseAnonKey,
          config: {
            postgres_changes: [
              { event: "*", schema: "public", table: "game_state", filter: "id=eq.1" },
              { event: "*", schema: "public", table: "rounds" },
              { event: "*", schema: "public", table: "scores" },
            ],
          },
        },
        ref: "1",
        join_ref: "1",
      })
    );
  });

  socket.addEventListener("message", (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.event === "phx_reply" && message.payload?.status === "ok") {
        setConnectionStatus("Live", "open");
        refreshState();
        return;
      }

      if (message.event === "postgres_changes" || message.event === "system") {
        refreshState();
      }
    } catch {
      // Ignore non-JSON keepalives.
    }
  });

  socket.addEventListener("close", () => {
    setConnectionStatus("Reconnecting...", "closed");
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
    }
    reconnectTimer = setTimeout(connectRealtime, 1500);
  });

  socket.addEventListener("error", () => setConnectionStatus("Connection error", "closed"));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refreshState();
  }
});

window.addEventListener("focus", refreshState);

connectRealtime();
refreshState();
