const HEALTH_URL = 'https://api.erlc.gg/v2/server?Players=true&Queue=true';
const PLAYERS_URL = 'https://api.erlc.gg/v2/server?Players=true';
const COMMAND_URL = 'https://api.erlc.gg/v2/server/command';

const ERLC_RUNTIME_KEY = Symbol.for('msrp.erlcApi.runtime');
const runtime = globalThis[ERLC_RUNTIME_KEY] || (globalThis[ERLC_RUNTIME_KEY] = {
    healthCache: { expiresAt: 0, value: null },
    playersCache: { expiresAt: 0, value: [] },
    healthPromise: null,
    playersPromise: null,
    requestBlockedUntil: 0,
    commandBlockedUntil: 0,
    commandChain: Promise.resolve(),
    lastCommandAt: 0,
    lastRateLimitLogAt: 0,
    lastFetchErrorLogAt: 0
});

const HEALTH_CACHE_MS = 20_000;
const PLAYERS_CACHE_MS = 8_000;
const DEFAULT_429_BACKOFF_MS = 60_000;
const COMMAND_GAP_MS = 4_000;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getKey() {
    return String(process.env.ERLC_SERVER_KEY || '').trim();
}

function countCollection(value) {
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(Number(value))) return Number(value);
    if (value && typeof value === 'object') {
        let count = 0;
        for (const nested of Object.values(value)) {
            if (Array.isArray(nested)) count += nested.length;
            else if (nested && typeof nested === 'object') count += Object.keys(nested).length;
            else if (nested != null) count += 1;
        }
        return count;
    }
    return null;
}

function parseRetryAfterMs(response, body, fallback = DEFAULT_429_BACKOFF_MS) {
    const values = [
        response?.headers?.get?.('retry-after'),
        body?.retry_after,
        body?.retryAfter,
        body?.error?.retry_after,
        body?.error?.retryAfter
    ];

    for (const value of values) {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.max(1000, Math.ceil(seconds * 1000));
        }
    }
    return fallback;
}

function logRateLimitOnce(label, retryMs) {
    if (Date.now() - runtime.lastRateLimitLogAt < 60_000) return;
    runtime.lastRateLimitLogAt = Date.now();
    console.warn(`[ERLC API] ${label} rate limited. Cooling down for ${Math.ceil(retryMs / 1000)}s.`);
}

function logFetchErrorOnce(error) {
    if (Date.now() - runtime.lastFetchErrorLogAt < 60_000) return;
    runtime.lastFetchErrorLogAt = Date.now();
    console.warn('[ERLC API] Request failed:', error?.message || error);
}

async function fetchJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'Server-Key': getKey(),
                Accept: 'application/json',
                ...(options.headers || {})
            }
        });

        const text = await response.text();
        let body = null;
        if (text) {
            try { body = JSON.parse(text); }
            catch { body = text; }
        }
        return { response, body };
    } finally {
        clearTimeout(timeout);
    }
}

async function getErlcHealth() {
    const key = getKey();
    if (!key) {
        return {
            ok: false,
            error: 'ERLC_SERVER_KEY is not configured.',
            playerCount: null,
            queueCount: null,
            staffCount: null,
            maxPlayers: null
        };
    }

    const now = Date.now();
    if (runtime.healthCache.value && now < runtime.healthCache.expiresAt) {
        return runtime.healthCache.value;
    }
    if (runtime.healthPromise) return runtime.healthPromise;

    // If ER:LC itself has asked us to cool down, return the last snapshot instead
    // of sending another request into the 429 window.
    if (now < runtime.requestBlockedUntil) {
        return runtime.healthCache.value || {
            ok: false,
            status: 429,
            error: 'ER:LC API cooling down after rate limit.',
            playerCount: null,
            queueCount: null,
            staffCount: null,
            maxPlayers: null
        };
    }

    runtime.healthPromise = (async () => {
        try {
            const { response, body } = await fetchJson(HEALTH_URL);

            if (response.status === 429) {
                const retryMs = parseRetryAfterMs(response, body);
                runtime.requestBlockedUntil = Math.max(runtime.requestBlockedUntil, Date.now() + retryMs);
                logRateLimitOnce('server info', retryMs);
                return runtime.healthCache.value || {
                    ok: false,
                    status: 429,
                    error: 'ER:LC rate limited.',
                    playerCount: null,
                    queueCount: null,
                    staffCount: null,
                    maxPlayers: null
                };
            }

            if (!response.ok) {
                const detail = typeof body === 'string'
                    ? body.slice(0, 250)
                    : body?.message || body?.error || `HTTP ${response.status}`;
                const value = {
                    ok: false,
                    status: response.status,
                    error: detail,
                    playerCount: null,
                    queueCount: null,
                    staffCount: null,
                    maxPlayers: null
                };
                runtime.healthCache = { value, expiresAt: Date.now() + HEALTH_CACHE_MS };
                return value;
            }

            const value = {
                ok: true,
                data: body,
                playerCount: Number.isFinite(Number(body?.CurrentPlayers))
                    ? Number(body.CurrentPlayers)
                    : countCollection(body?.Players),
                queueCount: countCollection(body?.Queue),
                staffCount: countCollection(body?.Staff),
                maxPlayers: Number.isFinite(Number(body?.MaxPlayers))
                    ? Number(body.MaxPlayers)
                    : null
            };
            runtime.healthCache = { value, expiresAt: Date.now() + HEALTH_CACHE_MS };
            return value;
        } catch (error) {
            logFetchErrorOnce(error);
            return runtime.healthCache.value || {
                ok: false,
                error: error?.message || String(error),
                playerCount: null,
                queueCount: null,
                staffCount: null,
                maxPlayers: null
            };
        } finally {
            runtime.healthPromise = null;
        }
    })();

    return runtime.healthPromise;
}

function normalizeErlcPlayer(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const username =
        raw.Username || raw.username || raw.Name || raw.name ||
        (typeof raw.Player === 'string' ? raw.Player.split(':')[0] : null);
    const userId =
        raw.UserId ?? raw.userId ?? raw.UserID ?? raw.id ??
        (typeof raw.Player === 'string' && raw.Player.includes(':')
            ? raw.Player.split(':').pop()
            : null);
    const permission = raw.Permission || raw.permission || 'Normal';
    if (!username) return null;
    return {
        username: String(username),
        userId: userId == null ? null : String(userId),
        permission: String(permission)
    };
}

async function getErlcPlayers() {
    if (!getKey()) throw new Error('ERLC_SERVER_KEY is not configured.');

    const now = Date.now();
    if (now < runtime.playersCache.expiresAt) return runtime.playersCache.value;
    if (runtime.playersPromise) return runtime.playersPromise;
    if (now < runtime.requestBlockedUntil) return runtime.playersCache.value || [];

    runtime.playersPromise = (async () => {
        try {
            const { response, body } = await fetchJson(PLAYERS_URL);
            if (response.status === 422) {
                runtime.playersCache = { value: [], expiresAt: Date.now() + PLAYERS_CACHE_MS };
                return [];
            }
            if (response.status === 429) {
                const retryMs = parseRetryAfterMs(response, body);
                runtime.requestBlockedUntil = Math.max(runtime.requestBlockedUntil, Date.now() + retryMs);
                logRateLimitOnce('players', retryMs);
                return runtime.playersCache.value || [];
            }
            if (!response.ok) {
                const detail = typeof body === 'string'
                    ? body.slice(0, 250)
                    : body?.message || body?.error || `HTTP ${response.status}`;
                throw new Error(`ER:LC players request failed (${response.status}): ${detail}`);
            }

            const players = (Array.isArray(body?.Players) ? body.Players : [])
                .map(normalizeErlcPlayer)
                .filter(Boolean);
            runtime.playersCache = { value: players, expiresAt: Date.now() + PLAYERS_CACHE_MS };
            return players;
        } catch (error) {
            logFetchErrorOnce(error);
            return runtime.playersCache.value || [];
        } finally {
            runtime.playersPromise = null;
        }
    })();

    return runtime.playersPromise;
}

async function runErlcCommandNow(command) {
    if (!getKey()) throw new Error('ERLC_SERVER_KEY is not configured.');
    const cleanCommand = String(command || '').trim();
    if (!cleanCommand) throw new Error('An ER:LC command is required.');

    const now = Date.now();
    if (now < runtime.commandBlockedUntil) {
        await wait(runtime.commandBlockedUntil - now);
    }

    const elapsed = Date.now() - runtime.lastCommandAt;
    if (elapsed < COMMAND_GAP_MS) await wait(COMMAND_GAP_MS - elapsed);

    // At most one retry. Repeatedly hammering a 429 just makes a cooldown worse.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        const { response, body } = await fetchJson(COMMAND_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: cleanCommand })
        });

        if (response.status === 429) {
            const retryMs = parseRetryAfterMs(response, body, 10_000);
            runtime.commandBlockedUntil = Math.max(runtime.commandBlockedUntil, Date.now() + retryMs);
            logRateLimitOnce('command', retryMs);
            if (attempt === 1) {
                await wait(retryMs);
                continue;
            }
            throw new Error('ER:LC command failed (429): rate limited after retry.');
        }

        if (!response.ok) {
            const detail = typeof body === 'string'
                ? body.slice(0, 300)
                : body?.message || body?.error || `HTTP ${response.status}`;
            throw new Error(`ER:LC command failed (${response.status}): ${detail}`);
        }

        runtime.lastCommandAt = Date.now();
        console.log(`[ERLC COMMAND] ${cleanCommand} sent successfully.`);
        return body;
    }
}

function runErlcCommand(command) {
    const task = runtime.commandChain.then(
        () => runErlcCommandNow(command),
        () => runErlcCommandNow(command)
    );
    runtime.commandChain = task.catch(() => {});
    return task;
}

module.exports = {
    getErlcHealth,
    getErlcPlayers,
    runErlcCommand
};
