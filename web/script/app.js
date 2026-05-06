import { APP_CONFIG, getRealtimeUrl } from "./config.js";

const STORAGE_KEY = "buzzer_profile_store";
const LAST_PROFILE_KEY = "buzzer_last_profile";

const postgrestHeaders = {
  apikey: APP_CONFIG.supabaseAnonKey,
  authorization: `Bearer ${APP_CONFIG.supabaseAnonKey}`,
  "content-type": "application/json",
  accept: "application/json",
};

const PROFILES = [
  { id: "p1", label: "Inderpal" },
  { id: "p2", label: "AM" },
  { id: "p3", label: "Kacem" },
  { id: "p4", label: "Ahmed" },
  { id: "p5", label: "Rania" },
  { id: "p6", label: "Emi" },
];

const loginCard = document.getElementById("login-card");
const playerCard = document.getElementById("player-card");
const loginForm = document.getElementById("login-form");
const profileIdInput = document.getElementById("profile-id");
const profilePasswordInput = document.getElementById("profile-password");
const loginStatus = document.getElementById("login-status");
const gameStatus = document.getElementById("game-status");
const winnerStatus = document.getElementById("winner-status");
const timerStatus = document.getElementById("timer-status");
const buzzBtn = document.getElementById("buzz-btn");
const savedProfilesEl = document.getElementById("saved-profiles");
const roundBadge = document.getElementById("round-badge");
const profileStatus = document.getElementById("profile-status");
const connectionStatus = document.getElementById("connection-status");
const rememberProfileInput = document.getElementById("remember-profile");
const clearProfileBtn = document.getElementById("clear-profile-btn");
const signOutBtn = document.getElementById("sign-out-btn");
const playerName = document.getElementById("player-name");
const playerScore = document.getElementById("player-score");
const scoreboard = document.getElementById("scoreboard");

let currentProfileId = localStorage.getItem(LAST_PROFILE_KEY) || null;
let currentPassword = null;
let currentState = null;
let currentScores = [];
let latestBuzzStampPlayed = null;
let reconnectTimer = null;
let socket = null;
let refreshInFlight = false;
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

function readSavedProfiles() {
	try {
		return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
	} catch {
		return [];
	}
}

function writeSavedProfiles(profiles) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

function saveProfile(profileId, password) {
  if (!rememberProfileInput.checked) {
    writeSavedProfiles(readSavedProfiles().filter((item) => item.id !== profileId));
    localStorage.setItem(LAST_PROFILE_KEY, profileId);
    return;
  }

	const profiles = readSavedProfiles().filter((item) => item.id !== profileId);
	profiles.unshift({ id: profileId, password, savedAt: Date.now() });
	writeSavedProfiles(profiles.slice(0, 5));
	localStorage.setItem(LAST_PROFILE_KEY, profileId);
}

function removeSavedProfiles() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LAST_PROFILE_KEY);
  currentProfileId = null;
  currentPassword = null;
}

function getProfileLabel(profileId) {
	return (
		PROFILES.find((profile) => profile.id === profileId)?.label || profileId
	);
}

function renderProfiles() {
	const savedProfiles = readSavedProfiles();

	profileIdInput.innerHTML = PROFILES.map(
		(profile) => `<option value="${profile.id}">${profile.label}</option>`,
	).join("");

	if (currentProfileId) {
		profileIdInput.value = currentProfileId;
	}

	if (!savedProfiles.length) {
		savedProfilesEl.innerHTML =
			'<p class="muted compact">No saved profiles yet.</p>';
		return;
	}

	savedProfilesEl.innerHTML = savedProfiles
		.map(
			(profile) => `
        <button class="profile-chip" type="button" data-profile-id="${profile.id}">
          <span>${getProfileLabel(profile.id)}</span>
          <small>${profile.id}</small>
        </button>`,
		)
		.join("");
}

function setConnectionStatus(message, tone = "open") {
	connectionStatus.textContent = message;
	connectionStatus.className = `status-pill status-pill-${tone}`;
}

function setProfileStatus(message, tone = "muted") {
	profileStatus.textContent = message;
	profileStatus.className = `status-pill status-pill-${tone}`;
}

function setLoginStatus(message, isError = false) {
	loginStatus.textContent = message;
	loginStatus.style.color = isError ? "#9b1c31" : "#466280";
}

function formatRoundValue(round) {
  if (!round?.id) {
    return "Waiting";
  }

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

  return { label: "Locked", tone: "closed" };
}

function playWinnerTone() {
	const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
	if (!AudioCtx) {
		return;
	}

	const ctx = new AudioCtx();
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();

	osc.type = "triangle";
	osc.frequency.value = 880;
	gain.gain.value = 0.001;

	osc.connect(gain);
	gain.connect(ctx.destination);

	const now = ctx.currentTime;
	gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
	gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

	osc.start(now);
	osc.stop(now + 0.4);
}

function renderSession() {
  const signedIn = Boolean(currentProfileId && currentPassword);
  loginCard.classList.toggle("is-hidden", signedIn);
  playerCard.classList.toggle("is-hidden", !signedIn);

  if (!signedIn) {
    setProfileStatus("Not signed in", "muted");
    return;
  }

  const profileLabel = getProfileLabel(currentProfileId);
  playerName.textContent = profileLabel;
  setProfileStatus(`Signed in as ${profileLabel}`, "open");
}

function renderScores(scores) {
  currentScores = scores;
  const score = scores.find((item) => item.profile_id === currentProfileId)?.total || 0;
  playerScore.textContent = score.toLocaleString();

  if (!scores.length) {
    scoreboard.innerHTML = '<p class="muted compact">Scores will appear after setup.</p>';
    return;
  }

  scoreboard.innerHTML = scores
    .map(
      (item) => `
        <div class="score-row ${item.profile_id === currentProfileId ? "is-current" : ""}">
          <span>${getProfileLabel(item.profile_id)}</span>
          <strong>${Number(item.total || 0).toLocaleString()}</strong>
        </div>`
    )
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
  timerStatus.textContent = "";

  if (round?.answer_status !== "answering" || !round.answer_deadline_at) {
    return;
  }

  const tick = async () => {
    const remainingMs = new Date(round.answer_deadline_at).getTime() - Date.now();
    const remaining = Math.max(0, Math.ceil(remainingMs / 1000));
    timerStatus.textContent = `${remaining}s answer window`;

    if (remainingMs <= 0) {
      clearTimer();
      await rpc("expire_answer_window");
      refreshState();
    }
  };

  tick();
  timerInterval = setInterval(tick, 500);
}

function renderState(state, rounds, scores = currentScores) {
  currentState = state;
  renderScores(scores);
  renderSession();

  const currentRound = rounds.find((round) => round.id === state?.current_round_id) || null;
  const badge = getBadge(currentRound);
  roundBadge.textContent = badge.label;
  roundBadge.className = `status-pill status-pill-${badge.tone}`;
  renderTimer(currentRound);

  if (!currentProfileId || !currentPassword) {
    buzzBtn.disabled = true;
    winnerStatus.textContent = "";
    timerStatus.textContent = "";
    return;
  }

  if (!currentRound?.id) {
    gameStatus.textContent = "Waiting for the admin to start a question.";
    winnerStatus.textContent = "";
    buzzBtn.disabled = true;
    return;
  }

  if (currentRound.open && currentRound.answer_status === "buzzing") {
    gameStatus.textContent = `${formatRoundValue(currentRound)} is open.`;
    winnerStatus.textContent = "";
    buzzBtn.disabled = false;
    return;
  }

  buzzBtn.disabled = true;

  if (currentRound.answer_status === "answering") {
    const winnerLabel = getProfileLabel(currentRound.winner_profile_id);
    gameStatus.textContent =
      currentRound.winner_profile_id === currentProfileId
        ? "You buzzed first. Answer now."
        : `${winnerLabel} is answering.`;
    winnerStatus.textContent = `For ${currentRound.point_value} points`;

    if (
      currentRound.winner_profile_id === currentProfileId &&
      currentRound.buzzed_at &&
      latestBuzzStampPlayed !== currentRound.buzzed_at
    ) {
      latestBuzzStampPlayed = currentRound.buzzed_at;
      playWinnerTone();
    }
    return;
  }

  if (currentRound.answer_status === "correct") {
    gameStatus.textContent = `${formatRoundValue(currentRound)} was scored.`;
    winnerStatus.textContent = `Correct: ${getProfileLabel(currentRound.correct_profile_id)}`;
    return;
  }

  gameStatus.textContent = "Waiting for the next question.";
  winnerStatus.textContent = "";
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
    gameStatus.textContent = `Failed to load game state: ${error.message}`;
    buzzBtn.disabled = true;
  } finally {
    refreshInFlight = false;
  }
}

async function signIn(profileId, password) {
  try {
    const data = await rpc("verify_profile_password", {
      p_profile_id: profileId,
      p_password: password,
    });

		if (!data) {
			setLoginStatus("Wrong profile/password.", true);
			return false;
		}

    currentProfileId = profileId;
    currentPassword = password;
    saveProfile(profileId, password);
    setLoginStatus(`Signed in as ${getProfileLabel(profileId)}.`);
    renderProfiles();
    renderSession();
    await refreshState();
    return true;
  } catch (error) {
    setLoginStatus(`Login failed: ${error.message}`, true);
    return false;
  }
}

async function buzz() {
  if (!currentProfileId || !currentPassword) {
    gameStatus.textContent = "Sign in first.";
    return;
  }

  try {
    const data = await rpc("submit_buzz", {
      p_profile_id: currentProfileId,
      p_password: currentPassword,
    });

    if (!data) {
      gameStatus.textContent = "Too late. Another player already buzzed.";
      return;
    }

    gameStatus.textContent = "You buzzed first!";
    await refreshState();
  } catch (error) {
    gameStatus.textContent = `Buzz failed: ${error.message}`;
  }
}

loginForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	await signIn(profileIdInput.value, profilePasswordInput.value);
	profilePasswordInput.value = "";
});

savedProfilesEl.addEventListener("click", async (event) => {
	const chip = event.target.closest("[data-profile-id]");
	if (!chip) {
		return;
	}

  const savedProfile = readSavedProfiles().find((profile) => profile.id === chip.dataset.profileId);
  if (!savedProfile?.password) {
    return;
  }

  profileIdInput.value = savedProfile.id;
  profilePasswordInput.value = savedProfile.password;
  await signIn(savedProfile.id, savedProfile.password);
  profilePasswordInput.value = "";
});

clearProfileBtn.addEventListener("click", () => {
  removeSavedProfiles();
  profilePasswordInput.value = "";
  loginStatus.textContent = "Saved profiles cleared.";
  renderProfiles();
  renderSession();
  refreshState();
});

signOutBtn.addEventListener("click", () => {
  currentProfileId = null;
  currentPassword = null;
  localStorage.removeItem(LAST_PROFILE_KEY);
  loginStatus.textContent = "Signed out.";
  renderProfiles();
  renderSession();
});

buzzBtn.addEventListener("click", buzz);

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
renderProfiles();
renderSession();

async function bootstrapSession() {
	const savedProfiles = readSavedProfiles();
	const preferredProfile =
		savedProfiles.find((profile) => profile.id === currentProfileId) ||
		savedProfiles[0];

  if (preferredProfile?.password) {
    profileIdInput.value = preferredProfile.id;
    await signIn(preferredProfile.id, preferredProfile.password);
    return;
  }

  setLoginStatus("Not signed in.");
  await refreshState();
}

bootstrapSession();
