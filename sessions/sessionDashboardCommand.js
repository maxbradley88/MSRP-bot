const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');

const {
    sendSessionDashboard
} = require('./sessionDashboard');

const {
    fetchErlcSnapshot
} = require('./erlcApi');

const sessionConfig =
    require('./sessionConfig');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('send-session-dashboard')
        .setDescription(
            'Sends the session dashboard.'
        ),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        try {
            const channel =
                await interaction.client.channels.fetch(
                    sessionConfig.sessionChannelId
                );

            if (
                !channel ||
                !channel.isTextBased()
            ) {
                throw new Error(
                    'Session channel not found.'
                );
            }

            const apiSnapshot =
                await fetchErlcSnapshot();

            await sendSessionDashboard(
                channel,
                { apiSnapshot }
            );

            await interaction.editReply({
                content:
                    '✅ Session dashboard sent.'
            });

        } catch (error) {
            console.error(
                '[SESSION DASHBOARD SEND ERROR]',
                error
            );

            await interaction.editReply({
                content:
                    '❌ Failed to send the session dashboard.'
            });
        }
    }
};
