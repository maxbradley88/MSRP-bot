const API_URL =
    'https://api.policeroleplay.community/v2/server?Players=true&Queue=true';

const snapshot = {
    apiOnline: false,
    playerCount: 0,
    queueCount: 0,
    maxPlayers: 50,
    lastCheckedAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0
};

function getApiSnapshot() {
    return { ...snapshot };
}

async function fetchErlcSnapshot() {
    const serverKey =
        process.env.ERLC_SERVER_KEY;

    snapshot.lastCheckedAt = Date.now();

    if (!serverKey) {
        snapshot.apiOnline = false;
        snapshot.consecutiveFailures += 1;

        console.warn(
            '[ERLC API] ERLC_SERVER_KEY is missing.'
        );

        return getApiSnapshot();
    }

    const controller =
        new AbortController();

    const timeout = setTimeout(
        () => controller.abort(),
        10000
    );

    try {
        const response = await fetch(
            API_URL,
            {
                method: 'GET',
                headers: {
                    'Server-Key': serverKey,
                    'Accept': 'application/json'
                },
                signal: controller.signal
            }
        );

        if (!response.ok) {
            throw new Error(
                `HTTP ${response.status}`
            );
        }

        const data =
            await response.json();

        const players =
            Array.isArray(data.Players)
                ? data.Players
                : [];

        const queue =
            Array.isArray(data.Queue)
                ? data.Queue
                : [];

        snapshot.playerCount =
            Number.isFinite(Number(data.CurrentPlayers))
                ? Number(data.CurrentPlayers)
                : players.length;

        snapshot.queueCount =
            queue.length;

        snapshot.maxPlayers =
            Number.isFinite(Number(data.MaxPlayers)) &&
            Number(data.MaxPlayers) > 0
                ? Number(data.MaxPlayers)
                : 50;

        snapshot.apiOnline = true;
        snapshot.lastSuccessAt = Date.now();
        snapshot.consecutiveFailures = 0;

        console.log(
            `[ERLC API] Online | Players ${snapshot.playerCount}/${snapshot.maxPlayers} | Queue ${snapshot.queueCount}`
        );

    } catch (error) {
        snapshot.consecutiveFailures += 1;

        // One brief API hiccup will not immediately turn the
        // dashboard red. Two failed checks in a row will.
        if (snapshot.consecutiveFailures >= 2) {
            snapshot.apiOnline = false;
        }

        console.error(
            `[ERLC API] Check failed (${snapshot.consecutiveFailures})`,
            error?.message || error
        );

    } finally {
        clearTimeout(timeout);
    }

    return getApiSnapshot();
}

module.exports = {
    fetchErlcSnapshot,
    getApiSnapshot
};
