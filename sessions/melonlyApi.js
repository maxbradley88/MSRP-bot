const BASE_URL = 'https://api.melonly.xyz/api/v1';

const MELONLY_RUNTIME_KEY = Symbol.for('msrp.melonlyApi.runtime');
const melonlyRuntime = globalThis[MELONLY_RUNTIME_KEY] || (globalThis[MELONLY_RUNTIME_KEY] = {
    blockedUntil: 0,
    memberCache: { expiresAt: 0, members: [] },
    responseCache: new Map(),
    inFlightRequests: new Map(),
    lastRateLimitLogAt: 0,
    shiftStopPromise: null,
    lastShiftStopCheckAt: 0,
    shiftStopBlockedUntil: 0,
    shiftWebhookMissingLogged: false
});
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 15 * 60_000;
const SERVER_ERROR_BACKOFF_MS = 2 * 60_000;

function getRetryAfterMs(response, body) {
    const header = response.headers.get('retry-after');
    const headerSeconds = Number(header);
    if (Number.isFinite(headerSeconds) && headerSeconds > 0) {
        return Math.ceil(headerSeconds * 1000);
    }

    const candidates = [
        body?.retry_after,
        body?.retryAfter,
        body?.retry_in,
        body?.retryIn,
        body?.error?.retry_after,
        body?.error?.retryAfter
    ];

    for (const candidate of candidates) {
        const seconds = Number(candidate);
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.ceil(seconds * 1000);
        }
    }

    return DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

function getToken() {
    const token =
        process.env.MELONLY_API_TOKEN ||
        process.env.MELONLY_API_KEY ||
        process.env.MELONY_API_KEY;

    if (!token) {
        throw new Error(
            'Melonly token is not configured. Use MELONLY_API_TOKEN (or MELONLY_API_KEY).'
        );
    }

    return token.trim();
}

function getCachedResponse(key) {
    const entry = melonlyRuntime.responseCache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
        melonlyRuntime.responseCache.delete(key);
        return undefined;
    }
    return entry.value;
}

function setCachedResponse(key, value, ttlMs) {
    if (!ttlMs) return;
    melonlyRuntime.responseCache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
    });
}

function logRateLimitOnce(retryAfterMs) {
    if (Date.now() - melonlyRuntime.lastRateLimitLogAt < 5 * 60_000) return;
    melonlyRuntime.lastRateLimitLogAt = Date.now();
    console.warn(`[MELONLY API] Rate limited. Cooling down for ${Math.ceil(retryAfterMs / 60000)} minute(s).`);
}

async function melonlyRequest(path, options = {}) {
    const cacheTtlMs = Number(options.cacheTtlMs) || 0;
    const fetchOptions = { ...options };
    delete fetchOptions.cacheTtlMs;

    if (Date.now() < melonlyRuntime.blockedUntil) {
        const error = new Error('Melonly API is temporarily cooling down after a rate limit.');
        error.status = 429;
        error.retryAfterMs = melonlyRuntime.blockedUntil - Date.now();
        error.isCooldown = true;
        throw error;
    }

    const method = String(fetchOptions.method || 'GET').toUpperCase();
    const requestKey = method === 'GET' ? `${method}:${path}` : null;

    if (requestKey && cacheTtlMs) {
        const cached = getCachedResponse(requestKey);
        if (cached !== undefined) return cached;
    }

    // Collapse identical concurrent GET requests into one network request.
    if (requestKey && melonlyRuntime.inFlightRequests.has(requestKey)) {
        return melonlyRuntime.inFlightRequests.get(requestKey);
    }

    const requestPromise = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        try {
            const response = await fetch(`${BASE_URL}${path}`, {
                ...fetchOptions,
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${getToken()}`,
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    ...(fetchOptions.headers || {})
                }
            });

            const text = await response.text();
            let body = null;

            if (text) {
                try {
                    body = JSON.parse(text);
                } catch {
                    body = text;
                }
            }

            if (!response.ok) {
                let detail = '';
                if (typeof body === 'string') {
                    detail = body.slice(0, 300);
                } else if (typeof body?.message === 'string') {
                    detail = body.message;
                } else if (typeof body?.error === 'string') {
                    detail = body.error;
                } else if (body?.error?.message) {
                    detail = String(body.error.message);
                }

                const error = new Error(
                    `Melonly API returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`
                );
                error.status = response.status;

                if (response.status === 429) {
                    error.retryAfterMs = Math.max(getRetryAfterMs(response, body), 5 * 60_000);
                    melonlyRuntime.blockedUntil = Math.max(
                        melonlyRuntime.blockedUntil,
                        Date.now() + error.retryAfterMs
                    );
                    logRateLimitOnce(error.retryAfterMs);
                } else if (response.status >= 500) {
                    // Server-side failures are not retried in a tight loop.
                    melonlyRuntime.blockedUntil = Math.max(
                        melonlyRuntime.blockedUntil,
                        Date.now() + SERVER_ERROR_BACKOFF_MS
                    );
                }

                throw error;
            }

            if (requestKey && cacheTtlMs) setCachedResponse(requestKey, body, cacheTtlMs);
            return body;
        } finally {
            clearTimeout(timeout);
        }
    })();

    if (requestKey) melonlyRuntime.inFlightRequests.set(requestKey, requestPromise);

    try {
        return await requestPromise;
    } finally {
        if (requestKey && melonlyRuntime.inFlightRequests.get(requestKey) === requestPromise) {
            melonlyRuntime.inFlightRequests.delete(requestKey);
        }
    }
}

function extractMemberArray(body) {
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.members)) return body.members;
    if (Array.isArray(body?.results)) return body.results;
    return [];
}

async function getMelonlyMembers() {
    if (melonlyRuntime.memberCache.expiresAt > Date.now()) return melonlyRuntime.memberCache.members;

    // Current official Melonly client uses /server/members.
    const body = await melonlyRequest('/server/members?limit=100');
    const members = extractMemberArray(body);
    melonlyRuntime.memberCache = {
        expiresAt: Date.now() + 10 * 60 * 1000,
        members
    };
    return members;
}

async function getMelonlyMemberByDiscordId(discordId) {
    if (!discordId) return null;
    try {
        // Current official Melonly client exposes a direct Discord lookup.
        return await melonlyRequest(`/server/members/discord/${encodeURIComponent(discordId)}`, { cacheTtlMs: 10 * 60_000 });
    } catch (error) {
        if (error?.status === 404) return null;
        throw error;
    }
}

async function getMelonlyRobloxConnectionByDiscordId(discordId) {
    if (!discordId) return null;
    try {
        // Returns { robloxId, userId, ... } for verified members.
        return await melonlyRequest(`/verification/discord/${encodeURIComponent(discordId)}/roblox`, { cacheTtlMs: 10 * 60_000 });
    } catch (error) {
        if (error?.status === 404) return null;
        throw error;
    }
}

async function getMelonlyServerInfo() {
    return melonlyRequest('/server/info', { cacheTtlMs: 2 * 60_000 });
}

function asCount(value) {
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(Number(value))) return Number(value);
    return null;
}

function extractLiveStats(info) {
    const playerCount =
        asCount(info?.playerCount) ??
        asCount(info?.players) ??
        asCount(info?.currentPlayers) ??
        asCount(info?.erlc?.players) ??
        asCount(info?.game?.players);

    const queueCount =
        asCount(info?.queueCount) ??
        asCount(info?.queue) ??
        asCount(info?.erlc?.queue) ??
        asCount(info?.game?.queue);

    const staffCount =
        asCount(info?.onlineStaff) ??
        asCount(info?.staffCount) ??
        asCount(info?.staff) ??
        asCount(info?.erlc?.staff) ??
        asCount(info?.game?.staff);

    return {
        playerCount,
        queueCount,
        staffCount
    };
}

async function getMelonlySnapshot() {
    const info = await getMelonlyServerInfo();
    const live = extractLiveStats(info);

    return {
        ok: true,
        info,
        ...live
    };
}

async function startMelonlySession() {
    throw new Error(
        'Melonly does not currently publish a documented public API endpoint for starting a session.'
    );
}

function extractShiftArray(body) {
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.shifts)) return body.shifts;
    if (Array.isArray(body?.results)) return body.results;
    return [];
}

async function getMelonlyShifts() {
    const body = await melonlyRequest('/server/shifts?limit=100', { cacheTtlMs: 2 * 60_000 });
    return extractShiftArray(body);
}

function isActiveShift(shift) {
    return !Number(shift?.endedAt || 0);
}

function isMelonlyShiftEndConfigured() {
    return Boolean(process.env.MELONLY_SHIFT_END_WEBHOOK?.trim());
}

async function stopActiveMelonlyShifts() {
    const webhook = process.env.MELONLY_SHIFT_END_WEBHOOK?.trim();

    // Do not burn Melonly API quota reading shifts when there is no supported
    // way configured to end them afterwards.
    if (!webhook) {
        if (!melonlyRuntime.shiftWebhookMissingLogged) {
            melonlyRuntime.shiftWebhookMissingLogged = true;
            console.warn(
                '[MELONLY SHIFTS] Shift enforcement is disabled because MELONLY_SHIFT_END_WEBHOOK is not configured.'
            );
        }
        return { supported: false, stopped: 0, active: 0, skipped: 'no-webhook' };
    }

    const now = Date.now();
    if (now < melonlyRuntime.shiftStopBlockedUntil) {
        return {
            supported: true,
            stopped: 0,
            active: 0,
            skipped: 'cooldown',
            retryAfterMs: melonlyRuntime.shiftStopBlockedUntil - now
        };
    }

    // One process-wide shift enforcement operation at a time, regardless of
    // how many callers/watcher instances invoke this function.
    if (melonlyRuntime.shiftStopPromise) return melonlyRuntime.shiftStopPromise;

    // Never check active shifts more than once every five minutes.
    if (now - melonlyRuntime.lastShiftStopCheckAt < 5 * 60_000) {
        return { supported: true, stopped: 0, active: 0, skipped: 'interval' };
    }

    melonlyRuntime.lastShiftStopCheckAt = now;
    melonlyRuntime.shiftStopPromise = (async () => {
        try {
            const shifts = await getMelonlyShifts();
            const active = shifts.filter(isActiveShift);

            if (active.length === 0) {
                return { supported: true, stopped: 0, active: 0 };
            }

            const response = await fetch(webhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'session_shutdown',
                    endAllActiveShifts: true,
                    shiftIds: active.map(shift => shift.id),
                    memberIds: active.map(shift => shift.memberId).filter(Boolean),
                    timestamp: Date.now()
                })
            });

            if (!response.ok) {
                throw new Error(`Melonly shift workflow returned HTTP ${response.status}`);
            }

            console.log(`[MELONLY SHIFTS] Sent ${active.length} active shift(s) to the shift-ending workflow.`);
            return { supported: true, stopped: active.length, active: active.length };
        } catch (error) {
            if (error?.status === 429) {
                const retryAfterMs = Math.max(Number(error.retryAfterMs) || DEFAULT_RATE_LIMIT_BACKOFF_MS, DEFAULT_RATE_LIMIT_BACKOFF_MS);
                melonlyRuntime.shiftStopBlockedUntil = Math.max(
                    melonlyRuntime.shiftStopBlockedUntil,
                    Date.now() + retryAfterMs
                );
            }
            throw error;
        } finally {
            melonlyRuntime.shiftStopPromise = null;
        }
    })();

    return melonlyRuntime.shiftStopPromise;
}

module.exports = {
    getMelonlyServerInfo,
    getMelonlySnapshot,
    getMelonlyMembers,
    getMelonlyMemberByDiscordId,
    getMelonlyRobloxConnectionByDiscordId,
    getMelonlyShifts,
    startMelonlySession,
    stopActiveMelonlyShifts,
    isMelonlyShiftEndConfigured
};
