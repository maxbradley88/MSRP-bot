const desiredStates = new Map();
const syncTimers = new Map();
const syncWorkers = new Map();

function stripClaimedPrefix(name) {
    return String(name || '').replace(/^(?:claimed-)+/i, '');
}

function parseClaimedBy(topic) {
    const match = String(topic || '').match(/(?:^|\|)claimed-by:(\d+)/);
    return match ? match[1] : null;
}

function removeClaimedBy(topic) {
    return String(topic || '')
        .replace(/(?:^|\|)claimed-by:\d+/g, '')
        .replace(/^\|+|\|+$/g, '')
        .replace(/\|{2,}/g, '|');
}

function setClaimedBy(topic, userId) {
    const clean = removeClaimedBy(topic);
    return `${clean}${clean ? '|' : ''}claimed-by:${userId}`;
}

function getDesiredState(channel) {
    const existing = desiredStates.get(channel.id);

    if (existing) {
        return existing;
    }

    const state = {
        version: 0,
        claimedBy: parseClaimedBy(channel.topic),
        name: String(channel.name || ''),
        topic: String(channel.topic || ''),
        reason: 'Ticket state sync'
    };

    desiredStates.set(channel.id, state);
    return state;
}

function getClaimedUserId(channel) {
    if (!channel) return null;
    return getDesiredState(channel).claimedBy;
}

function getEffectiveName(channel) {
    if (!channel) return '';
    return getDesiredState(channel).name;
}

function getEffectiveTopic(channel) {
    if (!channel) return '';
    return getDesiredState(channel).topic;
}

function scheduleSync(channel, delay = 500) {
    const channelId = channel.id;

    const oldTimer = syncTimers.get(channelId);
    if (oldTimer) {
        clearTimeout(oldTimer);
    }

    const timer = setTimeout(() => {
        syncTimers.delete(channelId);
        void runSyncWorker(channel);
    }, delay);

    syncTimers.set(channelId, timer);
}

function updateDesiredState(channel, updates, options = {}) {
    const current = getDesiredState(channel);
    const next = {
        ...current,
        ...updates,
        version: current.version + 1,
        reason: options.reason || updates.reason || current.reason || 'Ticket state sync'
    };

    desiredStates.set(channel.id, next);
    scheduleSync(channel, options.delay ?? 500);
    return next;
}

async function runSyncWorker(channel) {
    const channelId = channel.id;

    if (syncWorkers.has(channelId)) {
        return syncWorkers.get(channelId);
    }

    const worker = (async () => {
        while (true) {
            const desired = desiredStates.get(channelId);

            if (!desired) {
                return;
            }

            const targetVersion = desired.version;

            const targetName = String(
                desired.name || channel.name || ''
            ).slice(0, 100);

            const targetTopic = String(
                desired.topic ?? channel.topic ?? ''
            );

            const actualName = String(channel.name || '');
            const actualTopic = String(channel.topic || '');

            if (
                actualName.toLowerCase() ===
                    targetName.toLowerCase() &&
                actualTopic === targetTopic
            ) {
                if (
                    desiredStates.get(channelId)?.version ===
                    targetVersion
                ) {
                    return;
                }

                continue;
            }

            try {
                const updatedChannel =
                    await channel.edit({
                        name: targetName,
                        topic: targetTopic,
                        reason:
                            desired.reason ||
                            'Ticket state sync'
                    });

                if (updatedChannel) {
                    channel = updatedChannel;
                }
            } catch (error) {
                /*
                 * Discord error 10003 = Unknown Channel.
                 *
                 * The ticket has been deleted.
                 * NEVER retry it again.
                 */
                if (
                    error?.code === 10003 ||
                    error?.rawError?.code === 10003
                ) {
                    console.log(
                        `[TICKET STATE] Forgetting deleted channel ${channelId}`
                    );

                    forgetTicket(channelId);
                    return;
                }

                console.error(
                    '[TICKET STATE SYNC ERROR]',
                    error
                );

                /*
                 * Retry actual temporary Discord errors.
                 */
                setTimeout(() => {
                    if (
                        desiredStates.has(channelId) &&
                        !syncWorkers.has(channelId)
                    ) {
                        void runSyncWorker(channel);
                    }
                }, 3000);

                return;
            }

            const latest =
                desiredStates.get(channelId);

            if (
                !latest ||
                latest.version === targetVersion
            ) {
                return;
            }
        }
    })().finally(() => {
        syncWorkers.delete(channelId);

        /*
         * IMPORTANT:
         * If the ticket was deleted/forgotten,
         * DO NOT recreate another sync timer.
         */
        const desired =
            desiredStates.get(channelId);

        if (!desired) {
            return;
        }

        const nameMatches =
            String(channel.name || '')
                .toLowerCase() ===
            String(desired.name || '')
                .toLowerCase();

        const topicMatches =
            String(channel.topic || '') ===
            String(desired.topic || '');

        if (!nameMatches || !topicMatches) {
            scheduleSync(channel, 250);
        }
    });

    syncWorkers.set(channelId, worker);

    return worker;
}

function claimTicket(channel, userId, options = {}) {
    const current = getDesiredState(channel);

    const cleanName =
        stripClaimedPrefix(
            current.name || channel.name
        );

    const claimedName =
        `claimed-${cleanName}`.slice(0, 100);

    const claimedTopic =
        setClaimedBy(
            current.topic || channel.topic,
            userId
        );

    const nextState =
        updateDesiredState(
            channel,
            {
                claimedBy: userId,
                name: claimedName,
                topic: claimedTopic
            },
            {
                reason:
                    options.reason ||
                    `Ticket claimed by ${userId}`,
                delay: 0
            }
        );

    /*
     * FORCE the real Discord channel name as well.
     *
     * This runs separately from the normal state worker,
     * so Claim -> Unclaim -> Claim will always try to put
     * "claimed-" back onto the actual channel.
     */
    setTimeout(async () => {
        try {
            /*
             * If another action happened after this Claim
             * (for example Unclaim), cancel this old rename.
             */
            const latestBeforeFetch =
                desiredStates.get(channel.id);

            if (
                !latestBeforeFetch ||
                latestBeforeFetch.version !==
                    nextState.version ||
                latestBeforeFetch.claimedBy !==
                    userId
            ) {
                return;
            }

            const freshChannel =
                await channel.guild.channels.fetch(
                    channel.id,
                    {
                        force: true
                    }
                );

            if (!freshChannel) {
                return;
            }

            /*
             * Check again after fetching because another
             * action may have happened while Discord was
             * responding.
             */
            const latest =
                desiredStates.get(channel.id);

            if (
                !latest ||
                latest.version !==
                    nextState.version ||
                latest.claimedBy !==
                    userId
            ) {
                return;
            }

            const freshBaseName =
                stripClaimedPrefix(
                    freshChannel.name
                );

            const forcedName =
                `claimed-${freshBaseName}`
                    .slice(0, 100);

            const forcedTopic =
                setClaimedBy(
                    freshChannel.topic,
                    userId
                );

            if (
                freshChannel.name.toLowerCase() !==
                    forcedName.toLowerCase() ||
                String(freshChannel.topic || '') !==
                    forcedTopic
            ) {
                const updatedChannel =
                    await freshChannel.edit({
                        name: forcedName,
                        topic: forcedTopic,
                        reason:
                            options.reason ||
                            `Ticket claimed by ${userId}`
                    });

                console.log(
                    `[CLAIM TITLE FORCED] ${updatedChannel.name}`
                );
            }

        } catch (error) {
            /*
             * Deleted ticket — don't retry it.
             */
            if (
                error?.code === 10003 ||
                error?.rawError?.code === 10003
            ) {
                forgetTicket(channel.id);
                return;
            }

            console.error(
                '[CLAIM TITLE FORCE ERROR]',
                error
            );
        }
    }, 250);

    return nextState;
}

function unclaimTicket(channel, options = {}) {
    const current = getDesiredState(channel);

    return updateDesiredState(
        channel,
        {
            claimedBy: null,
            name: stripClaimedPrefix(current.name || channel.name).slice(0, 100),
            topic: removeClaimedBy(current.topic || channel.topic)
        },
        {
            reason: options.reason || 'Ticket unclaimed',
            delay: options.delay ?? 500
        }
    );
}

function handoffTicketState(channel, newName, options = {}) {
    const current = getDesiredState(channel);

    return updateDesiredState(
        channel,
        {
            claimedBy: null,
            name: stripClaimedPrefix(newName).slice(0, 100),
            topic: removeClaimedBy(current.topic || channel.topic)
        },
        {
            reason: options.reason || 'Ticket handed off',
            delay: options.delay ?? 250
        }
    );
}

function forgetTicket(channelId) {
    const timer = syncTimers.get(channelId);
    if (timer) clearTimeout(timer);

    syncTimers.delete(channelId);
    desiredStates.delete(channelId);
}

module.exports = {
    stripClaimedPrefix,
    getClaimedUserId,
    getEffectiveName,
    getEffectiveTopic,
    claimTicket,
    unclaimTicket,
    handoffTicketState,
    forgetTicket
};
