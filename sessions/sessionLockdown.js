const { getState } = require('./sessionState');
const { getErlcPlayers, runErlcCommand } = require('./erlcApi');
const sessionConfig = require('./sessionConfig');

let intervalHandle = null;
let sweepRunning = false;
const warnedPlayers = new Map();
const recentlyHandled = new Map();

const KICK_GRACE_MS = 30_000;
const LOCKDOWN_PM =
    'This server is currently shutdown. Join the mainland server to be notified when the next session is being hosted!';

function isProtectedPermission() {
    // Kept for compatibility with any existing imports. SSD no longer exempts
    // owners/admins because we use :shutdown rather than trying to :kick them.
    return false;
}

function getPlayerKey(player) {
    return String(player.userId || player.username || '').toLowerCase();
}

function cleanupRecentlyHandled() {
    const now = Date.now();
    for (const [key, timestamp] of recentlyHandled) {
        if (now - timestamp > 60_000) recentlyHandled.delete(key);
    }
}

function cleanupWarningsForPlayersWhoLeft(players) {
    const onlineKeys = new Set(players.map(getPlayerKey).filter(Boolean));
    for (const key of warnedPlayers.keys()) {
        if (!onlineKeys.has(key)) warnedPlayers.delete(key);
    }
}

function clearLockdownWarnings() {
    warnedPlayers.clear();
    recentlyHandled.clear();
}

async function warnPlayer(player, userKey) {
    try {
        await runErlcCommand(`:pm ${player.username} ${LOCKDOWN_PM}`);
        warnedPlayers.set(userKey, Date.now());
        console.log(`[SESSION LOCKDOWN] Warned ${player.username}; SSD enforcement in 30 seconds if still connected.`);
        return true;
    } catch (error) {
        console.warn(`[SESSION LOCKDOWN] Could not PM ${player.username}:`, error?.message || error);
        return false;
    }
}

async function runShutdownLockdownSweep() {
    const state = getState();

    if (!state.shutdownLockdownEnabled) {
        clearLockdownWarnings();
        return;
    }

    if (sweepRunning) return;
    sweepRunning = true;

    try {
        cleanupRecentlyHandled();
        const players = await getErlcPlayers();
        cleanupWarningsForPlayersWhoLeft(players);
        const now = Date.now();

        for (const player of players) {
            const userKey = getPlayerKey(player);
            if (!userKey) continue;

            // Preserve the original 3-minute slow-shutdown grace for people who
            // were already in the server when shutdown began.
            if (
                state.status === 'shutting-down' &&
                player.userId &&
                state.shutdownGraceUserIds?.has?.(String(player.userId))
            ) {
                continue;
            }

            if (recentlyHandled.has(userKey)) continue;

            const warnedAt = warnedPlayers.get(userKey);
            if (!warnedAt) {
                await warnPlayer(player, userKey);
                continue;
            }

            if (now - warnedAt < KICK_GRACE_MS) continue;

            // During the 3-minute countdown, don't destroy the whole server early.
            // As soon as the session is truly offline/SSD, ANY connected player —
            // including owners/admins — causes another :shutdown. This avoids the
            // permission hierarchy problem that made :kick ineffective on staff.
            if (state.status !== 'offline') continue;

            try {
                await runErlcCommand(':shutdown');
                warnedPlayers.delete(userKey);
                recentlyHandled.set(userKey, Date.now());
                console.log(`[SESSION LOCKDOWN] ${player.username} was present during SSD; :shutdown sent (${player.permission || 'unknown permission'}).`);

                // One shutdown command is enough for the whole server this sweep.
                break;
            } catch (error) {
                console.warn('[SESSION LOCKDOWN] Could not enforce SSD with :shutdown:', error?.message || error);
            }
        }
    } catch (error) {
        console.warn('[SESSION LOCKDOWN] Sweep skipped:', error?.message || error);
    } finally {
        sweepRunning = false;
    }
}

function startSessionLockdownWatcher() {
    if (intervalHandle) return intervalHandle;

    const intervalMs = sessionConfig.shutdownLockdownRefreshMs || 15_000;
    intervalHandle = setInterval(() => {
        runShutdownLockdownSweep().catch(error => {
            console.error('[SESSION LOCKDOWN ERROR]', error);
        });
    }, intervalMs);

    intervalHandle.unref?.();

    const startupTimer = setTimeout(() => {
        runShutdownLockdownSweep().catch(() => {});
    }, 2500);
    startupTimer.unref?.();

    return intervalHandle;
}

module.exports = {
    startSessionLockdownWatcher,
    runShutdownLockdownSweep,
    isProtectedPermission,
    clearLockdownWarnings
};
