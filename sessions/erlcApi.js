const API_URL =
    'https://api.erlc.gg/v2/server?Players=true&Queue=true&Staff=true';
    
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

module.exports = {
    getErlcHealth
};
