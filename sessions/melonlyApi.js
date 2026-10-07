const BASE_URL = 'https://api.melonly.xyz/api/v1';

function getToken() {
    const token = process.env.MELONY_API_KEY || process.env.MELONLY_API_KEY;

    if (!token) {
        throw new Error('MELONY_API_KEY is not configured.');
    }

    return token;
}

async function melonlyRequest(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(`${BASE_URL}${path}`, {
            ...options,
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${getToken()}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...(options.headers || {})
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
            throw new Error(
                `Melonly API returned HTTP ${response.status}${
                    body?.error ? `: ${body.error}` : ''
                }`
            );
        }

        return body;
    } finally {
        clearTimeout(timeout);
    }
}

async function getMelonlyServerInfo() {
    return melonlyRequest('/server/info');
}

function asCount(value) {
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(Number(value))) return Number(value);
    return null;
}

/*
 * Melonly's published API currently documents /server/info with
 * name/joinCode/ownerId metadata. Some deployments may return additional
 * ER:LC live fields. We read those fields when present without inventing data.
 */
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

/*
 * IMPORTANT:
 * The public Melonly API/client currently does not publish a documented
 * endpoint for starting a Melonly session. This function intentionally fails
 * instead of guessing an endpoint and falsely unlocking the Discord session.
 */
async function startMelonlySession() {
    throw new Error(
        'Melonly does not currently publish a documented public API endpoint for starting a session.'
    );
}

module.exports = {
    getMelonlyServerInfo,
    getMelonlySnapshot,
    startMelonlySession
};
