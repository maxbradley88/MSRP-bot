const API_URL =
    'https://api.erlc.gg/v2/server?Players=true&Queue=true';

function countCollection(value) {
    if (Array.isArray(value)) {
        return value.length;
    }

    if (Number.isFinite(Number(value))) {
        return Number(value);
    }

    if (value && typeof value === 'object') {
        // ER:LC staff data may be returned as grouped maps/objects.
        let count = 0;

        for (const nested of Object.values(value)) {
            if (Array.isArray(nested)) {
                count += nested.length;
            } else if (nested && typeof nested === 'object') {
                count += Object.keys(nested).length;
            } else if (nested != null) {
                count += 1;
            }
        }

        return count;
    }

    return null;
}

async function getErlcHealth() {
    const rawKey = process.env.ERLC_SERVER_KEY;
    const key = rawKey ? rawKey.trim() : '';

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(API_URL, {
            signal: controller.signal,
            headers: {
                'Server-Key': key,
                Accept: 'application/json'
            }
        });

        const text = await response.text();
        let data = null;

        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }

        if (!response.ok) {
            const detail =
                typeof data === 'string'
                    ? data.slice(0, 250)
                    : data?.message || data?.error || '';

            console.error(
                `[ERLC API] HTTP ${response.status}${detail ? ` | ${detail}` : ''}`
            );

            return {
                ok: false,
                status: response.status,
                error: detail || `HTTP ${response.status}`,
                playerCount: null,
                queueCount: null,
                staffCount: null,
                maxPlayers: null
            };
        }

        const playerCount =
            Number.isFinite(Number(data?.CurrentPlayers))
                ? Number(data.CurrentPlayers)
                : countCollection(data?.Players);

        const queueCount = countCollection(data?.Queue);
        const staffCount = countCollection(data?.Staff);
        const maxPlayers =
            Number.isFinite(Number(data?.MaxPlayers))
                ? Number(data.MaxPlayers)
                : null;

        return {
            ok: true,
            data,
            playerCount,
            queueCount,
            staffCount,
            maxPlayers
        };
    } catch (error) {
        console.error('[ERLC API] Request failed:', error?.message || error);

        return {
            ok: false,
            error: error?.message || String(error),
            playerCount: null,
            queueCount: null,
            staffCount: null,
            maxPlayers: null
        };
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeErlcPlayer(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const username =
        raw.Username ||
        raw.username ||
        raw.Name ||
        raw.name ||
        (typeof raw.Player === 'string'
            ? raw.Player.split(':')[0]
            : null);

    const userId =
        raw.UserId ??
        raw.userId ??
        raw.UserID ??
        raw.id ??
        (typeof raw.Player === 'string' && raw.Player.includes(':')
            ? raw.Player.split(':').pop()
            : null);

    const permission =
        raw.Permission ||
        raw.permission ||
        'Normal';

    if (!username) return null;

    return {
        username: String(username),
        userId: userId == null ? null : String(userId),
        permission: String(permission)
    };
}

async function getErlcPlayers() {
    const rawKey = process.env.ERLC_SERVER_KEY;
    const key = rawKey ? rawKey.trim() : '';

    if (!key) {
        throw new Error('ERLC_SERVER_KEY is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(
            'https://api.erlc.gg/v2/server?Players=true',
            {
                signal: controller.signal,
                headers: {
                    'Server-Key': key,
                    Accept: 'application/json'
                }
            }
        );

        // ER:LC reports an empty/offline private server as 422. During a
        // shutdown lockdown this is expected, so treat it as no players.
        if (response.status === 422) {
            return [];
        }

        const text = await response.text();
        let data = null;

        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                data = text;
            }
        }

        if (!response.ok) {
            const detail =
                typeof data === 'string'
                    ? data.slice(0, 250)
                    : data?.message || data?.error || `HTTP ${response.status}`;

            throw new Error(`ER:LC players request failed (${response.status}): ${detail}`);
        }

        const players = Array.isArray(data?.Players)
            ? data.Players
            : [];

        return players
            .map(normalizeErlcPlayer)
            .filter(Boolean);
    } finally {
        clearTimeout(timeout);
    }
}

let erlcCommandChain = Promise.resolve();
let lastErlcCommandAt = 0;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runErlcCommandNow(command) {
    const rawKey = process.env.ERLC_SERVER_KEY;
    const key = rawKey ? rawKey.trim() : '';

    if (!key) {
        throw new Error('ERLC_SERVER_KEY is not configured.');
    }

    const cleanCommand = String(command || '').trim();
    if (!cleanCommand) {
        throw new Error('An ER:LC command is required.');
    }

    // ER:LC command execution is rate-limited. Keep command calls spaced out
    // so sequences such as :prty -> :m do not immediately 429.
    const minimumGapMs = 3000;
    const elapsed = Date.now() - lastErlcCommandAt;
    if (elapsed < minimumGapMs) {
        await wait(minimumGapMs - elapsed);
    }

    let lastError = null;

    for (let attempt = 1; attempt <= 4; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);

        try {
            const response = await fetch(
                'https://api.erlc.gg/v2/server/command',
                {
                    method: 'POST',
                    signal: controller.signal,
                    headers: {
                        'Server-Key': key,
                        Accept: 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ command: cleanCommand })
                }
            );

            const text = await response.text();
            let data = null;

            if (text) {
                try {
                    data = JSON.parse(text);
                } catch {
                    data = text;
                }
            }

            if (response.status === 429) {
                const retryAfterHeader = response.headers.get('retry-after');
                const retryAfterSeconds = Number(retryAfterHeader);
                const retryMs = Number.isFinite(retryAfterSeconds)
                    ? Math.max(1000, retryAfterSeconds * 1000)
                    : 5000 * attempt;

                console.warn(
                    `[ERLC COMMAND] Rate limited while sending ${cleanCommand}. Retrying in ${Math.ceil(retryMs / 1000)}s (attempt ${attempt}/4).`
                );

                lastError = new Error(
                    `ER:LC command failed (429): ${typeof data === 'string' ? data : data?.message || data?.error || 'You are being rate limited!'}`
                );

                if (attempt < 4) {
                    await wait(retryMs);
                    continue;
                }

                throw lastError;
            }

            if (!response.ok) {
                const detail =
                    typeof data === 'string'
                        ? data.slice(0, 300)
                        : data?.message || data?.error || `HTTP ${response.status}`;

                throw new Error(`ER:LC command failed (${response.status}): ${detail}`);
            }

            lastErlcCommandAt = Date.now();
            console.log(`[ERLC COMMAND] ${cleanCommand} sent successfully.`);
            return data;
        } catch (error) {
            lastError = error;

            if (attempt >= 4 || !String(error?.message || '').includes('(429)')) {
                throw error;
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    throw lastError || new Error('ER:LC command failed.');
}

function runErlcCommand(command) {
    const task = erlcCommandChain.then(
        () => runErlcCommandNow(command),
        () => runErlcCommandNow(command)
    );

    // Keep the queue alive even when one command fails.
    erlcCommandChain = task.catch(() => {});
    return task;
}

module.exports = {
    getErlcHealth,
    getErlcPlayers,
    runErlcCommand
};
