const SUPABASE_URL = "https://supabase.zenovicharis.com";
const SUPABASE_ANON_KEY =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlLWxvY2FsIiwiaWF0IjoxNzc3OTcxNTA5LCJleHAiOjE4MDk1MDc1MDl9.qG8ROv2NimgF60YQzWEEiO8IlvZ_RNrzg81JGCbIesM";

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

const resetForm = document.getElementById("reset-form");
const adminPasswordInput = document.getElementById("admin-password");
const adminStatus = document.getElementById("admin-status");
const stateView = document.getElementById("state-view");
const roundsList = document.getElementById("rounds-list");
const adminConnectionStatus = document.getElementById(
	"admin-connection-status",
);

let refreshInFlight = false;
let lastStateSignature = "";
let lastRoundsSignature = "";
let reconnectTimer = null;
let socket = null;

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

function renderState(state, currentRound) {
	const payload = {
		current_round_id: state.current_round_id,
		current_round: currentRound,
	};

	const signature = JSON.stringify(payload);
	if (signature === lastStateSignature) {
		return;
	}

	lastStateSignature = signature;
	stateView.textContent = JSON.stringify(payload, null, 2);
}

function renderRounds(rounds, currentRoundId) {
	const signature = rounds
		.map(
			(round) => `${round.id}:${round.open}:${round.winner_profile_id || ""}`,
		)
		.join("|");
	if (signature === lastRoundsSignature) {
		return;
	}

	lastRoundsSignature = signature;

	if (!rounds.length) {
		roundsList.innerHTML = '<p class="muted compact">No rounds yet.</p>';
		return;
	}

	roundsList.innerHTML = rounds
		.map((round) => {
			const isCurrent = round.id === currentRoundId;
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
          <p class="round-summary">${round.winner_profile_id ? `Winner: ${round.winner_profile_id}` : "No winner yet"}</p>
        </article>`;
		})
		.join("");
}

async function refreshState() {
	if (refreshInFlight) {
		return;
	}

	refreshInFlight = true;
	try {
		const [state, rounds] = await Promise.all([getGameState(), getRounds()]);
		const currentRound = await getCurrentRound(state.current_round_id);
		renderState(state, currentRound);
		renderRounds(rounds, state.current_round_id);
	} catch (error) {
		setStatus(`Failed to load state: ${error.message}`, true);
	} finally {
		refreshInFlight = false;
	}
}

resetForm.addEventListener("submit", async (event) => {
	event.preventDefault();

	const password = adminPasswordInput.value;
	adminPasswordInput.value = "";

	try {
		const data = await postgrestJson("/rpc/reset_game", {
			method: "POST",
			body: JSON.stringify({ p_admin_password: password }),
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

const realtimeUrl = `wss://realtime.zenovicharis.com/socket/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`;
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

	socket.addEventListener("error", () =>
		setConnectionStatus("Connection error", "closed"),
	);
}

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible") {
		refreshState();
	}
});

window.addEventListener("focus", refreshState);

connectRealtime();
refreshState();
