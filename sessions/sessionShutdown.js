const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');

const {
    getState,
    stopSession,
    clearVoteAnnouncement,
    clearSessionAnnouncement
} = require('./sessionState');

const {
    refreshSessionDashboard
} = require('./sessionDashboard');

const {
    runErlcCommand
} = require('./erlcApi');

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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('session-shutdown')
        .setDescription('Shuts down the ER:LC session and resets the dashboard.'),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            const state = getState();

            if (state.status !== 'active' && state.status !== 'shutting-down') {
                await interaction.editReply({
                    content: '❌ There is no active session to shut down.'
                });
                return;
            }

            // Shut the actual ER:LC server down FIRST. If this fails, keep the
            // Discord dashboard/session state active so it does not lie.
            await runErlcCommand(':shutdown');

            await removeVoteAnnouncement(interaction.client);
            await removeSessionStartedAnnouncement(interaction.client);

            stopSession();
            await refreshSessionDashboard(interaction.client, {
                preferCached: true,
                forceInactive: true
            });

            await interaction.editReply({
                content: '✅ Session shut down in ER:LC and the dashboard has been reset.'
            });
        } catch (error) {
            console.error('[SESSION SHUTDOWN ERROR]', error);

            await interaction.editReply({
                content:
                    '❌ The ER:LC shutdown command could not be completed, so the dashboard was not reset.\n' +
                    `Reason: ${error?.message || error}`
            });
        }
    }
};
