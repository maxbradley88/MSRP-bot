const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');

const sessionConfig = require('./sessionConfig');

const {
    getState,
    setStatus,
    startShutdown,
    stopSession,
    clearVoteAnnouncement,
    clearSessionAnnouncement,
    setShutdownAnnouncement,
    clearShutdownAnnouncement,
    enableShutdownLockdown,
    enterPostShutdownLockdown,
    disableShutdownLockdown
} = require('./sessionState');

const {
    refreshSessionDashboard
} = require('./sessionDashboard');

const {
    getErlcPlayers,
    runErlcCommand
} = require('./erlcApi');

const {
    stopActiveMelonlyShifts
} = require('./melonlyApi');

let pendingShutdownTimer = null;
let pendingCountdownMessage = null;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function divider() {
    return new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true);
}

async function getAnnouncementChannel(client) {
    const channelId =
        sessionConfig.announcementChannelId ||
        sessionConfig.sessionChannelId;

    const channel = await client.channels
        .fetch(channelId)
        .catch(() => null);

    if (!channel?.isTextBased()) {
        throw new Error('The configured session announcement channel could not be found.');
    }

    return channel;
}

async function deleteTrackedMessage(client, channelId, messageId) {
    if (!channelId || !messageId) return;

    const channel = await client.channels
        .fetch(channelId)
        .catch(() => null);

    if (!channel?.isTextBased()) return;

    const message = await channel.messages
        .fetch(messageId)
        .catch(() => null);

    if (message) {
        await message.delete().catch(() => null);
    }
}

async function removeVoteAnnouncement(client) {
    const state = getState();

    await deleteTrackedMessage(
        client,
        state.voteAnnouncementChannelId,
        state.voteAnnouncementMessageId
    );

    clearVoteAnnouncement();
}

async function removeSessionStartedAnnouncement(client) {
    const state = getState();

    await deleteTrackedMessage(
        client,
        state.sessionAnnouncementChannelId,
        state.sessionAnnouncementMessageId
    );

    clearSessionAnnouncement();
}

async function removeShutdownAnnouncement(client) {
    const state = getState();

    await deleteTrackedMessage(
        client,
        state.shutdownAnnouncementChannelId,
        state.shutdownAnnouncementMessageId
    );

    clearShutdownAnnouncement();
}

function buildCountdownAnnouncement(shutdownAt) {
    const unix = Math.floor(shutdownAt / 1000);

    return new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## ⚠️ Server Shutdown Incoming\n' +
                '**The current MSRP session is ending.**\n\n' +
                'The server will shut down in **3 minutes**. Please wrap up your role-plays and prepare to leave the server.\n\n' +
                `**Shutdown:** <t:${unix}:R>`
            )
        )
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '-# New non-admin joins may be removed while the server is closing.'
            )
        );
}

function buildShutdownAnnouncement() {
    return new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## Session Shut Down\n' +
                '**Thank you for role-playing with Melbourne State Roleplay!**\n\n' +
                'This session has now ended. We hope to see you again in the next session! 👋'
            )
        )
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '-# This notice will remain here until a new session vote begins or a new session starts.'
            )
        );
}

async function sendCountdownAnnouncement(client, shutdownAt) {
    const channel = await getAnnouncementChannel(client);

    const message = await channel.send({
        components: [buildCountdownAnnouncement(shutdownAt)],
        flags: MessageFlags.IsComponentsV2
    });

    pendingCountdownMessage = {
        channelId: channel.id,
        messageId: message.id
    };

    return message;
}

async function removeCountdownAnnouncement(client) {
    if (!pendingCountdownMessage) return;

    await deleteTrackedMessage(
        client,
        pendingCountdownMessage.channelId,
        pendingCountdownMessage.messageId
    );

    pendingCountdownMessage = null;
}

async function sendShutdownAnnouncement(client) {
    await removeShutdownAnnouncement(client);

    const channel = await getAnnouncementChannel(client);

    const message = await channel.send({
        components: [buildShutdownAnnouncement()],
        flags: MessageFlags.IsComponentsV2
    });

    // Keep this notice until the next session vote or session start.
    setShutdownAnnouncement(
        channel.id,
        message.id,
        null
    );
}

async function stopMelonlyShiftsBestEffort() {
    try {
        const result = await stopActiveMelonlyShifts();

        if (result?.supported === false) {
            console.warn(
                '[SESSION SHUTDOWN] Melonly shift stop skipped because the public API does not document a clock-out mutation.'
            );
        }
    } catch (error) {
        console.warn(
            '[SESSION SHUTDOWN] Could not stop Melonly shifts:',
            error?.message || error
        );
    }
}

async function beginGraceLockdown() {
    try {
        const players = await getErlcPlayers();
        const existingIds = players
            .map(player => player.userId)
            .filter(Boolean);

        enableShutdownLockdown(existingIds);
    } catch (error) {
        console.warn(
            '[SESSION SHUTDOWN] Could not snapshot current ER:LC players for grace lockdown:',
            error?.message || error
        );

        // Still enable lockdown; without a snapshot, the safest fallback is
        // post-shutdown-only enforcement after :shutdown succeeds.
        enableShutdownLockdown([]);
    }
}

async function finishShutdown(client) {
    await runErlcCommand(':shutdown');

    // From this point onward, anyone who joins before the next session is
    // considered a post-shutdown join and can be removed by the lockdown watcher.
    enterPostShutdownLockdown();

    await removeCountdownAnnouncement(client);
    await removeVoteAnnouncement(client);
    await removeSessionStartedAnnouncement(client);

    stopSession();

    await refreshSessionDashboard(client, {
        preferCached: true,
        forceInactive: true
    });

    await sendShutdownAnnouncement(client);
}

async function runNormalShutdown(interaction) {
    const state = getState();

    if (state.status !== 'active') {
        await interaction.reply({
            content: state.status === 'shutting-down'
                ? '❌ A shutdown sequence is already running.'
                : '❌ There is no active session to shut down.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    try {
        startShutdown();
        await refreshSessionDashboard(interaction.client, { preferCached: true });

        // The session is now closing, so remove the old Session Started notice
        // immediately rather than leaving it visible during the countdown.
        await removeSessionStartedAnnouncement(interaction.client);

        await stopMelonlyShiftsBestEffort();
        await beginGraceLockdown();

        const countdownSeconds =
            sessionConfig.shutdownCountdownSeconds || 180;
        const shutdownAt = Date.now() + countdownSeconds * 1000;

        await sendCountdownAnnouncement(
            interaction.client,
            shutdownAt
        );

        // Priority timer is in seconds. The ER:LC command helper also queues
        // and spaces commands so the following :m does not get rate-limited.
        await runErlcCommand(`:prty ${countdownSeconds}`);

        await runErlcCommand(
            `:m ${sessionConfig.shutdownGameMessage || 'The MSRP server will be shutting down in 3 minutes. Please wrap-up your role-plays'}`
        );

        await interaction.editReply({
            content:
                '✅ Shutdown sequence started. The server will shut down in 3 minutes.'
        });

        pendingShutdownTimer = setTimeout(async () => {
            pendingShutdownTimer = null;

            try {
                await finishShutdown(interaction.client);
            } catch (error) {
                console.error('[SESSION SHUTDOWN ERROR]', error);

                try {
                    const channel = await getAnnouncementChannel(interaction.client);
                    await channel.send({
                        content:
                            '❌ The scheduled ER:LC shutdown could not be completed.\n' +
                            `Reason: ${error?.message || error}`
                    });
                } catch {}
            }
        }, countdownSeconds * 1000);

        pendingShutdownTimer.unref?.();
    } catch (error) {
        console.error('[SESSION SHUTDOWN START ERROR]', error);

        setStatus('active');
        disableShutdownLockdown();
        await removeCountdownAnnouncement(interaction.client).catch(() => {});
        await refreshSessionDashboard(interaction.client, { preferCached: true }).catch(() => {});

        await interaction.editReply({
            content:
                '❌ The shutdown sequence could not be started.\n' +
                `Reason: ${error?.message || error}`
        });
    }
}

async function runForceShutdown(interaction) {
    const state = getState();

    if (state.status !== 'active' && state.status !== 'shutting-down') {
        await interaction.reply({
            content: '❌ There is no active session to force shut down.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    try {
        if (pendingShutdownTimer) {
            clearTimeout(pendingShutdownTimer);
            pendingShutdownTimer = null;
        }

        startShutdown();
        await stopMelonlyShiftsBestEffort();

        // Force shutdown has no grace period.
        enableShutdownLockdown([]);

        await finishShutdown(interaction.client);

        await interaction.editReply({
            content: '✅ The ER:LC server was force shut down and the session was reset.'
        });
    } catch (error) {
        console.error('[SESSION FORCE SHUTDOWN ERROR]', error);

        setStatus('active');
        disableShutdownLockdown();
        await refreshSessionDashboard(interaction.client, { preferCached: true }).catch(() => {});

        await interaction.editReply({
            content:
                '❌ The ER:LC force shutdown could not be completed, so the dashboard was not reset.\n' +
                `Reason: ${error?.message || error}`
        });
    }
}

function resumeShutdownAnnouncementExpiry(client) {
    // Shutdown notices now intentionally persist until the next vote or session
    // starts, so there is no expiry timer to resume after a bot restart.
    return;
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('session-shutdown')
        .setDescription('Starts the 3-minute ER:LC session shutdown sequence.'),

    forceData: new SlashCommandBuilder()
        .setName('force-shutdown')
        .setDescription('Immediately shuts down the ER:LC session.'),

    execute: runNormalShutdown,
    executeForce: runForceShutdown,
    removeShutdownAnnouncement,
    resumeShutdownAnnouncementExpiry
};
