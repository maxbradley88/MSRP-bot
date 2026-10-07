const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');

const {
    getState,
    stopSession,
    clearVoteAnnouncement
} = require('./sessionState');

const {
    refreshSessionDashboard
} = require('./sessionDashboard');

async function removeVoteAnnouncement(client) {
    const state = getState();

    if (!state.voteAnnouncementChannelId || !state.voteAnnouncementMessageId) {
        clearVoteAnnouncement();
        return;
    }

    const channel = await client.channels
        .fetch(state.voteAnnouncementChannelId)
        .catch(() => null);

    if (channel?.isTextBased()) {
        const message = await channel.messages
            .fetch(state.voteAnnouncementMessageId)
            .catch(() => null);

        if (message) {
            await message.delete().catch(() => null);
        }
    }

    clearVoteAnnouncement();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('session-shutdown')
        .setDescription('Resets the current session and session dashboard.'),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            await removeVoteAnnouncement(interaction.client);
            stopSession();
            await refreshSessionDashboard(interaction.client, { preferCached: true });

            await interaction.editReply({
                content: '✅ Session dashboard has been reset.'
            });
        } catch (error) {
            console.error('[SESSION SHUTDOWN ERROR]', error);

            await interaction.editReply({
                content: '❌ The session could not be reset.'
            });
        }
    }
};
