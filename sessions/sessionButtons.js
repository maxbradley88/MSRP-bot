const {
    getSessionTimesText
} = require('./sessionTimes');

const {
    handleDisplayButton
} = require('./sessionDashboard');

const {
    handleVoteButton
} = require('./sessionVote');

async function handleSessionButton(interaction) {
    if (interaction.customId === 'session_times') {
        await interaction.reply({
            content: getSessionTimesText(),
            ephemeral: true
        });

        return true;
    }

    const handledVote = await handleVoteButton(interaction);
    if (handledVote) return true;

    const handledDisplayButton = await handleDisplayButton(interaction);
    if (handledDisplayButton) return true;

    return false;
}

module.exports = {
    handleSessionButton
};
