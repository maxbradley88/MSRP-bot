const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');

const {
    getState
} = require('./sessionState');

const {
    startSessionNow
} = require('./sessionVote');

const data = new SlashCommandBuilder()
    .setName('force-session')
    .setDescription('Starts a session immediately without a vote.');

async function execute(interaction) {
    const state = getState();

    if (state.status === 'active') {
        await interaction.reply({
            content: '❌ A session is already active.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (state.status === 'shutting-down') {
        await interaction.reply({
            content: '❌ A session is currently shutting down. Wait for shutdown to finish before starting another session.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    try {
        await startSessionNow(interaction.client);

        await interaction.editReply({
            content: '✅ Session started immediately.'
        });
    } catch (error) {
        console.error('[FORCE SESSION ERROR]', error);

        await interaction.editReply({
            content:
                '❌ The session could not be started.\n' +
                `Reason: ${error?.message || 'Unknown error'}`
        });
    }
}

module.exports = {
    data,
    execute
};
