const { getState } = require('./sessionState');
const { getErlcPlayers, runErlcCommand } = require('./erlcApi');
const { stopActiveMelonlyShifts } = require('./melonlyApi');
const sessionConfig = require('./sessionConfig');

// Keep lockdown runtime state process-wide. This prevents duplicate module loads,
// reconnects, or overlapping features from starting multiple SSD guard loops.
const RUNTIME_KEY = Symbol.for('msrp.sessionLockdown.runtime');
const runtime = globalThis[RUNTIME_KEY] || (globalThis[RUNTIME_KEY] = {
    intervalHandle: null,
    sweepPromise: null,
    shiftGuardPromise: null,
    lastShiftGuardAt: 0,
    shiftGuardBlockedUntil: 0,
    lastMelonlyRateLimitLogAt: 0,
    warnedPlayers: new Map(),
    recentlyHandled: new Map()
});

const SHIFT_GUARD_INTERVAL_MS = 60_000;
const KICK_GRACE_MS = 10_000;
const LOCKDOWN_PM =
    'This server is currently shutdown. Join the mainland server to be notified when the next session is being hosted!';

function isProtectedPermission(permission) {
    const value = String(permission || '').trim().toLowerCase();
    if (!value) return false;

    // Only top ER:LC admin/owner permissions are exempt.
    // Moderators and other command-capable staff are intentionally NOT exempt.
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
    for (const [key, timestamp] of runtime.recentlyHandled) {
        if (now - timestamp > 60_000) runtime.recentlyHandled.delete(key);
    }
}

function cleanupWarningsForPlayersWhoLeft(players) {
    const onlineKeys = new Set(players.map(getPlayerKey).filter(Boolean));
    for (const key of runtime.warnedPlayers.keys()) {
        if (!onlineKeys.has(key)) runtime.warnedPlayers.delete(key);
    }
}

function clearLockdownWarnings() {
    runtime.warnedPlayers.clear();
    runtime.recentlyHandled.clear();
}

async function warnPlayer(player, userKey) {
    try {
        await runErlcCommand(`:pm ${player.username} ${LOCKDOWN_PM}`);
        runtime.warnedPlayers.set(userKey, Date.now());
        console.log(`[SESSION LOCKDOWN] Warned ${player.username}; kick in 10 seconds if still connected.`);
        return true;
    } catch (error) {
        console.warn(`[SESSION LOCKDOWN] Could not PM ${player.username}:`, error?.message || error);
        return false;
    }
}

function logMelonlyRateLimitOnce(retryAfterMs) {
    const now = Date.now();
    // Avoid console spam if several callers all observe the same cooldown.
    if (now - runtime.lastMelonlyRateLimitLogAt < 60_000) return;
    runtime.lastMelonlyRateLimitLogAt = now;
    console.warn(
        `[SESSION LOCKDOWN] Melonly rate limited the SSD shift guard. Pausing shift checks for ${Math.ceil(retryAfterMs / 1000)} seconds.`
    );
}

async function enforceMelonlyShiftLockdown() {
    const state = getState();
    if (!state.shutdownLockdownEnabled) return;

    const now = Date.now();
    if (now < runtime.shiftGuardBlockedUntil) return;
    if (now - runtime.lastShiftGuardAt < SHIFT_GUARD_INTERVAL_MS) return;

    // If one check is already running anywhere in this process, share it.
    if (runtime.shiftGuardPromise) return runtime.shiftGuardPromise;

    runtime.lastShiftGuardAt = now;
    runtime.shiftGuardPromise = (async () => {
        try {
            const result = await stopActiveMelonlyShifts();
            if (result?.active > 0 && result?.supported) {
                console.log(`[SESSION LOCKDOWN] Melonly SSD guard processed ${result.active} active shift(s).`);
            }
        } catch (error) {
            if (error?.status === 429) {
                const retryAfterMs = Math.max(Number(error.retryAfterMs) || 60_000, 60_000);
                runtime.shiftGuardBlockedUntil = Math.max(
                    runtime.shiftGuardBlockedUntil,
                    Date.now() + retryAfterMs
                );
                logMelonlyRateLimitOnce(retryAfterMs);
                return;
            }

            console.warn(
                '[SESSION LOCKDOWN] Could not enforce Melonly shift SSD guard:',
                error?.message || error
            );
        } finally {
            runtime.shiftGuardPromise = null;
        }
    })();

    return runtime.shiftGuardPromise;
}

async function doShutdownLockdownSweep() {
    const state = getState();

    if (!state.shutdownLockdownEnabled) {
        clearLockdownWarnings();
        return;
    }

    cleanupRecentlyHandled();

    // Melonly shift enforcement is independent of ER:LC presence.
    // It is deliberately non-blocking for the ER:LC sweep so a slow/rate-limited
    // Melonly request never stops join enforcement.
    enforceMelonlyShiftLockdown().catch(() => {});

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

        if (runtime.recentlyHandled.has(userKey)) continue;

        const warnedAt = runtime.warnedPlayers.get(userKey);
        if (!warnedAt) {
            await warnPlayer(player, userKey);
            continue;
        }

        if (now - warnedAt < KICK_GRACE_MS) continue;
        if (state.status !== 'offline') continue;

        // Only the highest ER:LC admin/owner permissions are exempt.
        if (isProtectedPermission(player.permission)) {
            runtime.warnedPlayers.delete(userKey);
            runtime.recentlyHandled.set(userKey, Date.now());
            console.log(
                `[SESSION LOCKDOWN] ${player.username} is exempt from SSD kick (${player.permission || 'top admin'}).`
            );
            continue;
        }

        try {
            await runErlcCommand(`:kick ${player.username}`);
            runtime.warnedPlayers.delete(userKey);
            runtime.recentlyHandled.set(userKey, Date.now());
            console.log(
                `[SESSION LOCKDOWN] Kicked ${player.username} after 10-second SSD warning (${player.permission || 'normal'}).`
            );
        } catch (error) {
            console.warn(`[SESSION LOCKDOWN] Could not kick ${player.username}:`, error?.message || error);
        }
    }
}

async function runShutdownLockdownSweep() {
    // Share a single in-flight sweep across every caller/module instance.
    if (runtime.sweepPromise) return runtime.sweepPromise;

    runtime.sweepPromise = doShutdownLockdownSweep()
        .catch(error => {
            console.warn('[SESSION LOCKDOWN] Sweep skipped:', error?.message || error);
        })
        .finally(() => {
            runtime.sweepPromise = null;
        });

    return runtime.sweepPromise;
}

function startSessionLockdownWatcher() {
    if (runtime.intervalHandle) return runtime.intervalHandle;

    const intervalMs = sessionConfig.shutdownLockdownRefreshMs || 15_000;
    runtime.intervalHandle = setInterval(() => {
        runShutdownLockdownSweep().catch(error => {
            console.error('[SESSION LOCKDOWN ERROR]', error);
        });
    }, intervalMs);

    runtime.intervalHandle.unref?.();

    const startupTimer = setTimeout(() => {
        runShutdownLockdownSweep().catch(() => {});
    }, 2500);
    startupTimer.unref?.();

    return runtime.intervalHandle;
}

module.exports = {
    startSessionLockdownWatcher,
    runShutdownLockdownSweep,
    enforceMelonlyShiftLockdown,
    isProtectedPermission,
    clearLockdownWarnings
};
