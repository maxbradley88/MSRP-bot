const {
    SlashCommandBuilder,
    MessageFlags,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const {
    getState,
    startVote,
    setVoteMessageId
} = require('./sessionState');

const {
    findSessionDashboard,
    updateSessionDashboardMessage
} = require('./sessionDashboard');

const {
    getApiSnapshot
} = require('./erlcApi');

const {
    ensureSessionIcons,
    buttonEmoji
} = require('./sessionIcons');

const sessionConfig =
    require('./sessionConfig');


function applyEmoji(button, emoji) {
    const formatted =
        buttonEmoji(emoji);

    if (formatted) {
        button.setEmoji(formatted);
    }

    return button;
}


function getMentionLine() {
    return (
        '@here, ' +
        sessionConfig.announcementRoleIds
            .map(id => `<@&${id}>`)
            .join(', ')
    );
}


async function buildVoteAnnouncement(
    guild
) {
    const state = getState();

    const icons =
        await ensureSessionIcons(
            guild
        );

    const voteButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId('session_vote')
                .setLabel(
                    `Vote: ${state.voters.size}/${state.voteTarget}`
                )
                .setStyle(
                    ButtonStyle.Primary
                ),
            icons.vote
        );

    const container =
        new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `${getMentionLine()}\n\n` +
                        `A session vote has been started! To start a session we require **${state.voteTarget} votes**, use the vote button to add your vote.`
                    )
            )
            .addActionRowComponents(
                new ActionRowBuilder()
                    .addComponents(
                        voteButton
                    )
            );

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: ['everyone'],
            roles:
                sessionConfig.announcementRoleIds
        }
    };
}


async function refreshVoteAnnouncement(
    channel
) {
    const state = getState();

    if (!state.voteMessageId) {
        return;
    }

    try {
        const message =
            await channel.messages.fetch(
                state.voteMessageId
            );

        const payload =
            await buildVoteAnnouncement(
                channel.guild
            );

        await message.edit({
            components:
                payload.components
        });

    } catch (error) {
        console.error(
            '[SESSION VOTE MESSAGE UPDATE ERROR]',
            error
        );
    }
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('session-vote')
        .setDescription(
            'Starts a session vote.'
        )
        .addIntegerOption(
            option =>
                option
                    .setName('votes')
                    .setDescription(
                        'Number of votes required to start the session.'
                    )
                    .setMinValue(1)
                    .setMaxValue(50)
                    .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({
            flags: MessageFlags.Ephemeral
        });

        const target =
            interaction.options.getInteger(
                'votes',
                true
            );

        const state = getState();

        if (state.status === 'active') {
            await interaction.editReply({
                content:
                    '❌ A session is already active.'
            });

            return;
        }

        if (state.status === 'vote') {
            await interaction.editReply({
                content:
                    '❌ A session vote is already running.'
            });

            return;
        }

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

            const dashboard =
                await findSessionDashboard(
                    channel
                );

            if (!dashboard) {
                await interaction.editReply({
                    content:
                        '❌ I could not find the session dashboard in the session channel. Use `/send-session-dashboard` first.'
                });

                return;
            }

            startVote(target);

            await updateSessionDashboardMessage(
                dashboard,
                getApiSnapshot()
            );

            const voteMessage =
                await channel.send({
                    ...(await buildVoteAnnouncement(
                        channel.guild
                    )),
                    reply: {
                        messageReference:
                            dashboard.id,
                        failIfNotExists: false
                    }
                });

            setVoteMessageId(
                voteMessage.id
            );

            await interaction.editReply({
                content:
                    `✅ Session vote started. ${target} vote${target === 1 ? '' : 's'} required.`
            });

        } catch (error) {
            console.error(
                '[SESSION VOTE COMMAND ERROR]',
                error
            );

            await interaction.editReply({
                content:
                    '❌ Failed to start the session vote.'
            });
        }
    },

    buildVoteAnnouncement,
    refreshVoteAnnouncement,
    getMentionLine
};
