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
const recentlyHandled = new Map();

function isProtectedPermission(permission) {
    const value = String(permission || '').toLowerCase();

    // ER:LC does not allow the API to remove the highest server managers.
    // Keep owners/co-owners/admins untouched and only enforce the lockdown
    // against ordinary players / lower server permissions.
    return (
        value.includes('owner') ||
        value.includes('co-owner') ||
        value.includes('co owner') ||
        value.includes('administrator')
    );
}

function cleanupRecentlyHandled() {
    const now = Date.now();
    for (const [key, timestamp] of recentlyHandled) {
        if (now - timestamp > 60_000) {
            recentlyHandled.delete(key);
        }
    }
}

async function runShutdownLockdownSweep() {
    const state = getState();

    if (!state.shutdownLockdownEnabled) {
        return;
    }

    if (sweepRunning) {
        return;
    }

    sweepRunning = true;

    try {
        cleanupRecentlyHandled();

        const players = await getErlcPlayers();

        for (const player of players) {
            const userKey = player.userId || player.username.toLowerCase();

            if (
                player.userId &&
                state.shutdownGraceUserIds.has(String(player.userId))
            ) {
                continue;
            }

            if (isProtectedPermission(player.permission)) {
                continue;
            }

            if (recentlyHandled.has(userKey)) {
                continue;
            }

            recentlyHandled.set(userKey, Date.now());

            try {
                await runErlcCommand(`:kick ${player.username}`);
                console.log(
                    `[SESSION LOCKDOWN] Kicked ${player.username} (${player.permission}).`
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
    setTimeout(() => {
        runShutdownLockdownSweep().catch(() => {});
    }, 2500).unref?.();

    return intervalHandle;
}

module.exports = {
    startSessionLockdownWatcher,
    runShutdownLockdownSweep,
    isProtectedPermission
};
