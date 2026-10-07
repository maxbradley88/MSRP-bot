const {
    SlashCommandBuilder
} = require('discord.js');

const {
    sendSessionDashboard
} = require('./sessionDashboard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('send-session-dashboard')
        .setDescription(
            'Sends the session dashboard.'
        ),

    async execute(interaction) {
        await interaction.deferReply({
            ephemeral: true
        });

        try {
            await sendSessionDashboard(
                interaction.channel
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