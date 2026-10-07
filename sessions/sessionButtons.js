const {
    getSessionTimesText
} = require('./sessionTimes');

const {
    handleDisplayButton
} = require('./sessionDashboard');

async function handleSessionButton(
    interaction
) {
    /*
     * Session Times
     */
    if (
        interaction.customId ===
        'session_times'
    ) {
        await interaction.reply({
            content:
                getSessionTimesText(),
            ephemeral: true
        });

        return true;
    }

    /*
     * Decorative dashboard buttons
     */
    const handledDisplayButton =
        await handleDisplayButton(
            interaction
        );

    if (handledDisplayButton) {
        return true;
    }

    return false;
}

module.exports = {
    handleSessionButton
};