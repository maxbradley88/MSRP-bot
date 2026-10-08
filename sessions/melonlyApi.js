const BASE_URL = 'https://api.melonly.xyz/api/v1';

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
            const detail =
                typeof body === 'string'
                    ? body.slice(0, 300)
                    : body?.error || body?.message || '';

            throw new Error(
                `Melonly API returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`
            );
        }

        return body;
    } finally {
        clearTimeout(timeout);
    }
}


let memberCache = { expiresAt: 0, members: [] };

function extractMemberArray(body) {
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body?.members)) return body.members;
    if (Array.isArray(body?.results)) return body.results;
    return [];
}

function getDiscordIdFromMelonlyMember(member) {
    const value =
        member?.discordId ??
        member?.discord_id ??
        member?.discord?.id ??
        member?.user?.discordId ??
        member?.user?.discord_id;
    return value == null ? null : String(value);
}

async function getMelonlyMembers() {
    if (memberCache.expiresAt > Date.now()) return memberCache.members;

    const body = await melonlyRequest('/members');
    const members = extractMemberArray(body);
    memberCache = {
        expiresAt: Date.now() + 5 * 60 * 1000,
        members
    };
    return members;
}

async function getMelonlyMemberByDiscordId(discordId) {
    const members = await getMelonlyMembers();
    return members.find(member => getDiscordIdFromMelonlyMember(member) === String(discordId)) || null;
}

async function getMelonlyServerInfo() {
    return melonlyRequest('/server/info');
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
    // There is currently no documented public Melonly endpoint for starting
    // a session. Keep this isolated so it can be replaced if Melonly provides
    // the correct endpoint later.
    throw new Error(
        'Melonly does not currently publish a documented public API endpoint for starting a session.'
    );
}

async function stopActiveMelonlyShifts() {
    // Melonly's current public clients document reading shifts, but do not
    // expose a documented write/clock-out endpoint. Do not guess a destructive
    // endpoint. This hook is kept here so the correct endpoint can be dropped in
    // later without changing the shutdown flow.
    console.warn(
        '[MELONLY SHIFTS] Automatic shift ending is not available through the documented public API yet.'
    );

    return {
        supported: false,
        stopped: 0
    };
}

module.exports = {
    getMelonlyServerInfo,
    getMelonlySnapshot,
    getMelonlyMembers,
    getMelonlyMemberByDiscordId,
    startMelonlySession,
    stopActiveMelonlyShifts
};
