const { getState } = require('./sessionState');
const { getErlcPlayers, runErlcCommand } = require('./erlcApi');
const { stopActiveMelonlyShifts } = require('./melonlyApi');
const sessionConfig = require('./sessionConfig');

let intervalHandle = null;
let sweepRunning = false;
let shiftGuardRunning = false;
let lastShiftGuardAt = 0;
const SHIFT_GUARD_INTERVAL_MS = 15_000;
const warnedPlayers = new Map();
const recentlyHandled = new Map();

const KICK_GRACE_MS = 10_000;
const LOCKDOWN_PM =
    'This server is currently shutdown. Join the mainland server to be notified when the next session is being hosted!';

function isProtectedPermission(permission) {
    const value = String(permission || '').trim().toLowerCase();
    if (!value) return false;

    // Top-level ER:LC server permissions stay exempt from SSD auto-kicks.
    // Moderators are intentionally NOT protected.
    return (
        value.includes('owner') ||
        value.includes('co-owner') ||
        value.includes('co owner') ||
        value.includes('administrator') ||
        value === 'admin' ||
        value === 'server admin'
    );
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
        console.log(`[SESSION LOCKDOWN] Warned ${player.username}; kick in 10 seconds if still connected.`);
        return true;
    } catch (error) {
        console.warn(`[SESSION LOCKDOWN] Could not PM ${player.username}:`, error?.message || error);
        return false;
    }
}


async function enforceMelonlyShiftLockdown() {
    const state = getState();
    if (!state.shutdownLockdownEnabled) return;
    if (shiftGuardRunning) return;
    if (Date.now() - lastShiftGuardAt < SHIFT_GUARD_INTERVAL_MS) return;

    shiftGuardRunning = true;
    lastShiftGuardAt = Date.now();
    try {
        const result = await stopActiveMelonlyShifts();
        if (result?.active > 0 && result?.supported) {
            console.log(`[SESSION LOCKDOWN] Melonly SSD guard processed ${result.active} active shift(s).`);
        }
    } catch (error) {
        console.warn('[SESSION LOCKDOWN] Could not enforce Melonly shift SSD guard:', error?.message || error);
    } finally {
        shiftGuardRunning = false;
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

        // Shift enforcement is independent of ER:LC presence. A staff member who
        // starts a Melonly shift while SSD is active is caught even if they never
        // join the game.
        await enforceMelonlyShiftLockdown();
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

            // Only enforce kicks once the server is fully in SSD/offline mode.
            if (state.status !== 'offline') continue;

            // Keep only the highest ER:LC admin/owner permissions exempt.
            // Moderators and other command-capable staff are still kicked.
            if (isProtectedPermission(player.permission)) {
                warnedPlayers.delete(userKey);
                recentlyHandled.set(userKey, Date.now());
                console.log(`[SESSION LOCKDOWN] ${player.username} is exempt from SSD kick (${player.permission || 'top admin'}).`);
                continue;
            }

            try {
                await runErlcCommand(`:kick ${player.username}`);
                warnedPlayers.delete(userKey);
                recentlyHandled.set(userKey, Date.now());
                console.log(`[SESSION LOCKDOWN] Kicked ${player.username} after 10-second SSD warning (${player.permission || 'normal'}).`);
            } catch (error) {
                console.warn(`[SESSION LOCKDOWN] Could not kick ${player.username}:`, error?.message || error);
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
    enforceMelonlyShiftLockdown,
    isProtectedPermission,
    clearLockdownWarnings
};
