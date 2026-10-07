const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');

const {
    setSessionTimes
} = require('./sessionTimes');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('set-session-times')
        .setDescription(
            'Update the weekly session times.'
        )

        .addStringOption(option =>
            option
                .setName('mon')
                .setDescription(
                    'Monday session times'
                )
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName('tue')
                .setDescription(
                    'Tuesday session times'
                )
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName('wed')
                .setDescription(
                    'Wednesday session times'
                )
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName('thu')
                .setDescription(
                    'Thursday session times'
                )
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName('fri')
                .setDescription(
                    'Friday session times'
                )
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName('sat')
                .setDescription(
                    'Saturday session times'
                )
                .setRequired(false)
        )

        .addStringOption(option =>
            option
                .setName('sun')
                .setDescription(
                    'Sunday session times'
                )
                .setRequired(false)
        ),

    async execute(interaction) {
        const times = {
            monday:
                interaction.options
                    .getString('mon') ||
                'No session times',

            tuesday:
                interaction.options
                    .getString('tue') ||
                'No session times',

            wednesday:
                interaction.options
                    .getString('wed') ||
                'No session times',

            thursday:
                interaction.options
                    .getString('thu') ||
                'No session times',

            friday:
                interaction.options
                    .getString('fri') ||
                'No session times',

            saturday:
                interaction.options
                    .getString('sat') ||
                'No session times',

            sunday:
                interaction.options
                    .getString('sun') ||
                'No session times'
        };

        setSessionTimes(times);

        await interaction.reply({
            content:
                '✅ Session times have been updated.',
            flags:
                MessageFlags.Ephemeral
        });
    }
};