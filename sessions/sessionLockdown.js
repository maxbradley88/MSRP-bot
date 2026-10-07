const {
    getState
} = require('./sessionState');

const {
    getErlcPlayers,
    runErlcCommand
} = require('./erlcApi');

const sessionConfig = require('./sessionConfig');

let intervalHandle = null;
let sweepRunning = false;

// userKey -> timestamp when the warning PM was successfully sent.
const warnedPlayers = new Map();

// Avoid immediately re-processing somebody we just kicked.
const recentlyHandled = new Map();

const KICK_GRACE_MS = 30_000;
const LOCKDOWN_PM =
    'This server is currently shutdown. Join the mainland server to be notified when the next session is being hosted!';

function isProtectedPermission(permission) {
    const value = String(permission || '').toLowerCase();

    // Keep the highest server managers untouched. ER:LC may also prevent
    // remote commands from removing these users.
    return (
        value.includes('owner') ||
        value.includes('co-owner') ||
        value.includes('co owner') ||
        value.includes('administrator')
    );
}

function getPlayerKey(player) {
    return String(
        player.userId ||
        player.username ||
        ''
    ).toLowerCase();
}

function cleanupRecentlyHandled() {
    const now = Date.now();

    for (const [key, timestamp] of recentlyHandled) {
        if (now - timestamp > 60_000) {
            recentlyHandled.delete(key);
        }
    }
}

function cleanupWarningsForPlayersWhoLeft(players) {
    const onlineKeys = new Set(
        players
            .map(getPlayerKey)
            .filter(Boolean)
    );

    for (const key of warnedPlayers.keys()) {
        if (!onlineKeys.has(key)) {
            // They left before the kick. If they join again later they receive
            // a fresh warning and another full 30-second grace period.
            warnedPlayers.delete(key);
        }
    }
}

function clearLockdownWarnings() {
    warnedPlayers.clear();
    recentlyHandled.clear();
}

async function warnPlayer(player, userKey) {
    try {
        await runErlcCommand(
            `:pm ${player.username} ${LOCKDOWN_PM}`
        );

        warnedPlayers.set(userKey, Date.now());

        console.log(
            `[SESSION LOCKDOWN] Warned ${player.username}; kick in 30 seconds if still connected.`
        );

        return true;
    } catch (error) {
        console.warn(
            `[SESSION LOCKDOWN] Could not PM ${player.username}:`,
            error?.message || error
        );

        // Do not start the kick timer unless the warning was actually sent.
        return false;
    }
}

async function runShutdownLockdownSweep() {
    const state = getState();

    if (!state.shutdownLockdownEnabled) {
        clearLockdownWarnings();
        return;
    }

    if (sweepRunning) {
        return;
    }

    sweepRunning = true;

    try {
        cleanupRecentlyHandled();

        const players = await getErlcPlayers();
        cleanupWarningsForPlayersWhoLeft(players);

        const now = Date.now();

        for (const player of players) {
            const userKey = getPlayerKey(player);

            if (!userKey) {
                continue;
            }

            // During the normal three-minute shutdown countdown, players who
            // were already in-server are allowed to remain and wrap up their RP.
            if (
                player.userId &&
                state.shutdownGraceUserIds.has(String(player.userId))
            ) {
                continue;
            }

            if (isProtectedPermission(player.permission)) {
                warnedPlayers.delete(userKey);
                continue;
            }

            if (recentlyHandled.has(userKey)) {
                continue;
            }

            const warnedAt = warnedPlayers.get(userKey);

            if (!warnedAt) {
                await warnPlayer(player, userKey);
                continue;
            }

            if (now - warnedAt < KICK_GRACE_MS) {
                continue;
            }

            // They are still present in this fresh ER:LC player snapshot after
            // the full grace period, so remove them now.
            try {
                await runErlcCommand(`:kick ${player.username}`);

                warnedPlayers.delete(userKey);
                recentlyHandled.set(userKey, Date.now());

                console.log(
                    `[SESSION LOCKDOWN] Kicked ${player.username} after 30-second warning (${player.permission}).`
                );
            } catch (error) {
                console.warn(
                    `[SESSION LOCKDOWN] Could not kick ${player.username}:`,
                    error?.message || error
                );
            }
        }
    } catch (error) {
        // An offline ER:LC server is normal after shutdown; don't crash the bot.
        console.warn(
            '[SESSION LOCKDOWN] Sweep skipped:',
            error?.message || error
        );
    } finally {
        sweepRunning = false;
    }
}

function startSessionLockdownWatcher() {
    if (intervalHandle) {
        return intervalHandle;
    }

    const intervalMs =
        sessionConfig.shutdownLockdownRefreshMs ||
        15_000;

    intervalHandle = setInterval(() => {
        runShutdownLockdownSweep().catch(error => {
            console.error('[SESSION LOCKDOWN ERROR]', error);
        });
    }, intervalMs);

    if (typeof intervalHandle.unref === 'function') {
        intervalHandle.unref();
    }

    // Check shortly after bot startup too, so a persisted lockdown resumes.
    const startupTimer = setTimeout(() => {
        runShutdownLockdownSweep().catch(() => {});
    }, 2500);

    if (typeof startupTimer.unref === 'function') {
        startupTimer.unref();
    }

    return intervalHandle;
}

module.exports = {
    startSessionLockdownWatcher,
    runShutdownLockdownSweep,
    isProtectedPermission,
    clearLockdownWarnings
};
