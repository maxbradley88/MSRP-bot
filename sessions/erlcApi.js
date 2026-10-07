const API_URL =
    'https://api.policeroleplay.community/v2/server?Players=true&Queue=true';

async function getErlcHealth() {
    const rawKey = process.env.ERLC_SERVER_KEY;
    const key = rawKey ? rawKey.trim() : '';

    if (!key) {
        return {
            ok: false,
            error: 'ERLC_SERVER_KEY is not configured.'
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
                error: detail || `HTTP ${response.status}`
            };
        }

        return {
            ok: true,
            data
        };
    } catch (error) {
        console.error('[ERLC API] Request failed:', error?.message || error);

        return {
            ok: false,
            error: error?.message || String(error)
        };
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = {
    getErlcHealth
};
