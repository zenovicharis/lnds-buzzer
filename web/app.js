const SUPABASE_URL = "https://supabase.zenovicharis.com";
const SUPABASE_ANON_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWxvY2FsIiwiaWF0IjoxNzc3OTcxNTA5LCJleHAiOjE4MDk1MDc1MDl9.qG8ROv2NimgF60YQzWEEiO8IlvZ_RNrzg81JGCbIesM";
const STORAGE_KEY = "buzzer_profile_store";
const LAST_PROFILE_KEY = "buzzer_last_profile";

const postgrestHeaders = {
	apikey: SUPABASE_ANON_KEY,
	authorization: `Bearer ${SUPABASE_ANON_KEY}`,
	"content-type": "application/json",
	accept: "application/json",
};

async function postgrestJson(path, options = {}) {
	const headers = new Headers(postgrestHeaders);
	if (options.headers) {
		for (const [key, value] of Object.entries(options.headers)) {
			headers.set(key, value);
		}
	}

	const response = await fetch(`${SUPABASE_URL}${path}`, {
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

async function getGameState() {
	const data = await postgrestJson(
		"/game_state?id=eq.1&select=id,current_round_id",
	);
	return Array.isArray(data) ? data[0] : data;
}

async function getCurrentRound(roundId) {
	if (!roundId) {
		return null;
	}

	const data = await postgrestJson(
		`/rounds?id=eq.${encodeURIComponent(roundId)}&select=id,created_at,open,winner_profile_id,buzzed_at`,
	);
	return Array.isArray(data) ? data[0] : data;
}

async function getRounds() {
	const data = await postgrestJson(
		"/rounds?select=id,created_at,open,winner_profile_id,buzzed_at&order=created_at.desc",
	);
	return Array.isArray(data) ? data : [];
}

const PROFILES = [
	{ id: "p1", label: "Inderpal" },
	{ id: "p2", label: "AM" },
	{ id: "p3", label: "Kacem" },
	{ id: "p4", label: "Ahmed" },
	{ id: "p5", label: "Rania" },
	{ id: "p6", label: "Emi" },
];

const loginForm = document.getElementById("login-form");
const profileIdInput = document.getElementById("profile-id");
const profilePasswordInput = document.getElementById("profile-password");
const loginStatus = document.getElementById("login-status");
const gameStatus = document.getElementById("game-status");
const winnerStatus = document.getElementById("winner-status");
const buzzBtn = document.getElementById("buzz-btn");
const savedProfilesEl = document.getElementById("saved-profiles");
const roundBadge = document.getElementById("round-badge");
const profileStatus = document.getElementById("profile-status");
const connectionStatus = document.getElementById("connection-status");
const rememberProfileInput = document.getElementById("remember-profile");
const clearProfileBtn = document.getElementById("clear-profile-btn");
const roundsList = document.createElement("div");
roundsList.id = "rounds-list";
roundsList.className = "rounds-list";
document.querySelector(".buzz-card").appendChild(roundsList);

let currentProfileId = localStorage.getItem(LAST_PROFILE_KEY) || null;
let latestBuzzStampPlayed = null;
let currentState = null;
let reconnectTimer = null;
let socket = null;
let socketJoined = false;
let refreshInFlight = false;
let lastRenderedSignature = "";
let roundsSignature = "";

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
		const profiles = readSavedProfiles().filter(
			(item) => item.id !== profileId,
		);
		writeSavedProfiles(profiles);
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

function setGameMessage(message) {
	gameStatus.textContent = message;
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

function formatRoundTime(value) {
	if (!value) {
		return "Unknown time";
	}

	const date = new Date(value);
	return date.toLocaleString([], {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

function getRoundTone(round, isCurrent) {
	if (isCurrent) {
		return "status-pill-open";
	}

	if (round.open) {
		return "status-pill-muted";
	}

	return "status-pill-closed";
}

function getRoundLabel(round, isCurrent) {
	if (isCurrent) {
		return "Current";
	}

	return round.open ? "Open" : "Closed";
}

function getBadgeTone(round) {
	if (!round?.id) {
		return "status-pill-muted";
	}

	return round.open ? "status-pill-open" : "status-pill-closed";
}

function getBadgeLabel(round) {
	if (!round?.id) {
		return "Waiting";
	}

	return round.open ? "Open" : "Locked";
}

function renderRounds(rounds, currentRoundId) {
	const signature = `${currentRoundId || ""}:${rounds
		.map(
			(round) => `${round.id}:${round.open}:${round.winner_profile_id || ""}`,
		)
		.join("|")}`;
	if (signature === roundsSignature) {
		return;
	}

	roundsSignature = signature;

	if (!rounds.length) {
		roundsList.innerHTML = '<p class="muted compact">No rounds yet.</p>';
		return;
	}

	roundsList.innerHTML = rounds
		.map((round) => {
			const isCurrent = round.id === currentRoundId;
			const winnerLabel = round.winner_profile_id
				? `Winner: ${round.winner_profile_id}`
				: "No winner";
			const roundTone = getRoundTone(round, isCurrent);
			const roundLabel = getRoundLabel(round, isCurrent);
			return `
        <article class="round-row ${isCurrent ? "is-current" : ""}">
          <div class="round-row-top">
            <div>
              <p class="round-id">${round.id}</p>
              <p class="round-meta">${formatRoundTime(round.created_at)}</p>
            </div>
            <span class="status-pill ${roundTone}">
              ${roundLabel}
            </span>
          </div>
          <p class="round-summary">${winnerLabel}</p>
        </article>`;
		})
		.join("");
}

function renderState(state, rounds) {
	currentState = state;
	const currentRound =
		rounds.find((round) => round.id === state.current_round_id) || null;
	const signature = `${state.current_round_id || ""}-${currentRound?.open || false}-${currentRound?.winner_profile_id || ""}-${currentRound?.buzzed_at || ""}`;

	renderRounds(rounds, state.current_round_id);

	if (signature === lastRenderedSignature) {
		return;
	}

	lastRenderedSignature = signature;

	if (!currentProfileId) {
		buzzBtn.disabled = true;
		setGameMessage("Sign in to play.");
		winnerStatus.textContent = "";
		roundBadge.textContent = getBadgeLabel(currentRound);
		roundBadge.className = `status-pill ${getBadgeTone(currentRound)}`;
		return;
	}

	if (currentRound?.open) {
		setGameMessage("Round is OPEN. Tap BUZZ now.");
		winnerStatus.textContent = "";
		buzzBtn.disabled = false;
		roundBadge.textContent = "Open";
		roundBadge.className = "status-pill status-pill-open";
		return;
	}

	buzzBtn.disabled = true;
	roundBadge.textContent = "Locked";
	roundBadge.className = "status-pill status-pill-closed";

	if (!currentRound?.winner_profile_id) {
		setGameMessage("Round closed.");
		winnerStatus.textContent = "No winner saved.";
		return;
	}

	setGameMessage("Round is CLOSED.");
	winnerStatus.textContent = `Winner: ${getProfileLabel(currentRound.winner_profile_id)}`;

	if (
		currentRound.winner_profile_id === currentProfileId &&
		currentRound.buzzed_at &&
		latestBuzzStampPlayed !== currentRound.buzzed_at
	) {
		latestBuzzStampPlayed = currentRound.buzzed_at;
		playWinnerTone();
	}
}

async function refreshState() {
	if (refreshInFlight) {
		return;
	}

	refreshInFlight = true;
	try {
		const [state, rounds] = await Promise.all([getGameState(), getRounds()]);
		renderState(state, rounds);
	} catch (error) {
		setGameMessage(`Failed to load game state: ${error.message}`);
		buzzBtn.disabled = true;
	} finally {
		refreshInFlight = false;
	}
}

async function signIn(profileId, password) {
	try {
		const data = await postgrestJson("/rpc/verify_profile_password", {
			method: "POST",
			body: JSON.stringify({
				p_profile_id: profileId,
				p_password: password,
			}),
		});

		if (!data) {
			setLoginStatus("Wrong profile/password.", true);
			return false;
		}

		currentProfileId = profileId;
		saveProfile(profileId, password);
		let profileLabel = getProfileLabel(profileId);
		setLoginStatus(`Signed in as ${profileLabel}.`);
		setProfileStatus(`Signed in as ${profileLabel}`, "open");
		renderProfiles();
		await refreshState();
		return true;
	} catch (error) {
		setLoginStatus(`Login failed: ${error.message}`, true);
		return false;
	}
}

async function buzz() {
	if (!currentProfileId) {
		setGameMessage("Sign in first.");
		return;
	}

	const currentRoundId = currentState?.current_round_id;
	if (!currentRoundId) {
		setGameMessage("No active round yet.");
		return;
	}

	const now = new Date().toISOString();

	try {
		const data = await postgrestJson(
			`/rounds?id=eq.${encodeURIComponent(currentRoundId)}&open=eq.true&winner_profile_id=is.null`,
			{
				method: "PATCH",
				headers: {
					Prefer: "return=representation",
				},
				body: JSON.stringify({
					open: false,
					winner_profile_id: currentProfileId,
					buzzed_at: now,
				}),
			},
		);

		if (!data || data.length === 0) {
			setGameMessage("Too late. Another player already won.");
			return;
		}

		const row = Array.isArray(data) ? data[0] : data;
		setGameMessage("You buzzed first!");
		renderState({ ...currentState, current_round_id: row.id }, [row]);
	} catch (error) {
		setGameMessage(`Buzz failed: ${error.message}`);
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

	const savedProfiles = readSavedProfiles();
	const profileId = chip.dataset.profileId;
	const savedProfile = savedProfiles.find(
		(profile) => profile.id === profileId,
	);

	if (!savedProfile) {
		return;
	}

	profileIdInput.value = profileId;
	profilePasswordInput.value = savedProfile.password || "";
	await signIn(profileId, profilePasswordInput.value);
});

clearProfileBtn.addEventListener("click", () => {
	removeSavedProfiles();
	profilePasswordInput.value = "";
	loginStatus.textContent = "Saved profiles cleared.";
	setProfileStatus("Not signed in", "muted");
	renderProfiles();
	refreshState();
});

buzzBtn.addEventListener("click", buzz);

const realtimeUrl = `wss://realtime.zenovicharis.com/socket/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;
function connectRealtime() {
	if (socket?.readyState === WebSocket.OPEN) {
		return;
	}

	setConnectionStatus("Connecting...", "muted");
	socket = new WebSocket(realtimeUrl);
	socketJoined = false;

	socket.addEventListener("open", () => {
		socket.send(
			JSON.stringify({
				topic: "realtime:buzzer",
				event: "phx_join",
				payload: {
					access_token: SUPABASE_ANON_KEY,
					config: {
						postgres_changes: [
							{
								event: "*",
								schema: "public",
								table: "game_state",
								filter: "id=eq.1",
							},
							{ event: "*", schema: "public", table: "rounds" },
						],
					},
				},
				ref: "1",
				join_ref: "1",
			}),
		);
	});

	socket.addEventListener("message", (event) => {
		try {
			const message = JSON.parse(event.data);

			if (message.event === "phx_reply" && message.payload?.status === "ok") {
				socketJoined = true;
				setConnectionStatus("Live", "open");
				refreshState();
				return;
			}

			if (message.event === "system" && message.payload?.status === "ok") {
				refreshState();
				return;
			}

			if (message.event === "postgres_changes") {
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

	socket.addEventListener("error", () => {
		setConnectionStatus("Connection error", "closed");
	});
}

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") {
		refreshState();
	}
});

window.addEventListener("focus", refreshState);

connectRealtime();

renderProfiles();

async function bootstrapSession() {
	const savedProfiles = readSavedProfiles();
	const preferredProfile =
		savedProfiles.find((profile) => profile.id === currentProfileId) ||
		savedProfiles[0];

	if (preferredProfile?.password) {
		profileIdInput.value = preferredProfile.id;
		profilePasswordInput.value = preferredProfile.password;
		await signIn(preferredProfile.id, preferredProfile.password);
		profilePasswordInput.value = "";
		return;
	}

	if (currentProfileId) {
		setLoginStatus(`Using saved profile: ${getProfileLabel(currentProfileId)}`);
		setProfileStatus(`Ready as ${getProfileLabel(currentProfileId)}`, "open");
		profileIdInput.value = currentProfileId;
	} else {
		setLoginStatus("Not signed in.");
		setProfileStatus("Not signed in", "muted");
	}
}

bootstrapSession().then(refreshState);
