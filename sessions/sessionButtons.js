const {
    MessageFlags,
    ModalBuilder,
    LabelBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

const {
    getSessionTimesText
} = require('./sessionTimes');

const {
    handleDisplayButton,
    findSessionDashboard,
    updateSessionDashboardMessage
} = require('./sessionDashboard');

const {
    getState,
    addVote,
    removeVote,
    hasVoted,
    getVoters,
    startSession,
    setVoteMessageId
} = require('./sessionState');

const {
    getApiSnapshot
} = require('./erlcApi');

const {
    refreshVoteAnnouncement,
    getMentionLine
} = require('./sessionVote');

const {
    ensureSessionIcons,
    buttonEmoji
} = require('./sessionIcons');

const sessionConfig =
    require('./sessionConfig');

let finishingVote = false;


function applyEmoji(button, emoji) {
    const formatted =
        buttonEmoji(emoji);

    if (formatted) {
        button.setEmoji(formatted);
    }

    return button;
}


async function getSessionChannel(client) {
    const channel =
        await client.channels.fetch(
            sessionConfig.sessionChannelId
        );

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        return null;
    }

    return channel;
}


async function updateVotingDisplays(
    client
) {
    const channel =
        await getSessionChannel(
            client
        );

    if (!channel) {
        return;
    }

    const dashboard =
        await findSessionDashboard(
            channel
        );

    if (dashboard) {
        await updateSessionDashboardMessage(
            dashboard,
            getApiSnapshot()
        );
    }

    await refreshVoteAnnouncement(
        channel
    );
}


async function sendSessionStartedMessage(
    channel,
    dashboard
) {
    const icons =
        await ensureSessionIcons(
            channel.guild
        );

    const joinButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId('session_join')
                .setLabel('Join')
                .setStyle(
                    ButtonStyle.Success
                ),
            icons.join
        );

    const container =
        new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `${getMentionLine()}\n\n` +
                        `A session has been started! Join using the button or code **${sessionConfig.serverCode}**, please read the server rules before joining.`
                    )
            )
            .addActionRowComponents(
                new ActionRowBuilder()
                    .addComponents(
                        joinButton
                    )
            );

    return await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: ['everyone'],
            roles:
                sessionConfig.announcementRoleIds
        },
        reply: {
            messageReference:
                dashboard.id,
            failIfNotExists: false
        }
    });
}


async function finishVote(client) {
    if (finishingVote) {
        return;
    }

    finishingVote = true;

    try {
        const state = getState();

        if (state.status !== 'vote') {
            return;
        }

        const channel =
            await getSessionChannel(
                client
            );

        if (!channel) {
            return;
        }

        const dashboard =
            await findSessionDashboard(
                channel
            );

        if (!dashboard) {
            return;
        }

        const voteMessageId =
            state.voteMessageId;

        startSession();

        if (voteMessageId) {
            try {
                const voteMessage =
                    await channel.messages.fetch(
                        voteMessageId
                    );

                await voteMessage.delete();
            } catch {}
        }

        setVoteMessageId(null);

        await updateSessionDashboardMessage(
            dashboard,
            getApiSnapshot()
        );

        await sendSessionStartedMessage(
            channel,
            dashboard
        );

    } catch (error) {
        console.error(
            '[SESSION VOTE FINISH ERROR]',
            error
        );

    } finally {
        finishingVote = false;
    }
}


async function showJoinRulesModal(
    interaction
) {
    const select =
        new StringSelectMenuBuilder()
            .setCustomId(
                'session_rules_agree'
            )
            .setPlaceholder(
                'Select an option...'
            )
            .setMinValues(1)
            .setMaxValues(1)
            .setRequired(true)
            .addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel('Yes')
                    .setValue('yes'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('No')
                    .setValue('no')
            );

    const modal =
        new ModalBuilder()
            .setCustomId(
                'session_join_rules_modal'
            )
            .setTitle(
                'Join MSRP'
            )
            .addLabelComponents(
                new LabelBuilder()
                    .setLabel(
                        'Do you agree to the server rules?'
                    )
                    .setStringSelectMenuComponent(
                        select
                    )
            );

    await interaction.showModal(
        modal
    );
}


async function handleSessionButton(
    interaction
) {
    if (
        interaction.customId ===
        'session_times'
    ) {
        await interaction.reply({
            content:
                getSessionTimesText(),
            flags:
                MessageFlags.Ephemeral
        });

        return true;
    }

    if (
        interaction.customId ===
        'session_vote'
    ) {
        const state = getState();

        if (state.status !== 'vote') {
            await interaction.reply({
                content:
                    '❌ There is no active session vote.',
                flags:
                    MessageFlags.Ephemeral
            });

            return true;
        }

        const userId =
            interaction.user.id;

        if (hasVoted(userId)) {
            removeVote(userId);

            await interaction.reply({
                content:
                    'Your vote has been removed.',
                flags:
                    MessageFlags.Ephemeral
            });

            await updateVotingDisplays(
                interaction.client
            );

            return true;
        }

        addVote(userId);

        await interaction.reply({
            content:
                'Your vote has been added.',
            flags:
                MessageFlags.Ephemeral
        });

        if (
            getState().voters.size >=
            getState().voteTarget
        ) {
            await finishVote(
                interaction.client
            );
        } else {
            await updateVotingDisplays(
                interaction.client
            );
        }

        return true;
    }

    if (
        interaction.customId ===
        'session_view_voters'
    ) {
        const state = getState();

        if (state.status !== 'vote') {
            await interaction.reply({
                content:
                    'There is no active session vote.',
                flags:
                    MessageFlags.Ephemeral
            });

            return true;
        }

        const voters =
            getVoters();

        const content =
            voters.length > 0
                ? voters
                    .map(
                        userId =>
                            `✅ - <@${userId}>`
                    )
                    .join('\n')
                : 'No one has voted yet.';

        await interaction.reply({
            content,
            flags:
                MessageFlags.Ephemeral,
            allowedMentions: {
                parse: []
            }
        });

        return true;
    }

    if (
        interaction.customId ===
        'session_join'
    ) {
        const state = getState();

        if (state.status !== 'active') {
            await interaction.reply({
                content:
                    '❌ There is no active session to join.',
                flags:
                    MessageFlags.Ephemeral
            });

            return true;
        }

        await showJoinRulesModal(
            interaction
        );

        return true;
    }

    const handledDisplayButton =
        await handleDisplayButton(
            interaction
        );

    if (handledDisplayButton) {
        return true;
    }

    return false;
}


async function handleSessionModal(
    interaction
) {
    if (
        !interaction.isModalSubmit() ||
        interaction.customId !==
            'session_join_rules_modal'
    ) {
        return false;
    }

    let answer = '';

    try {
        answer =
            interaction.fields
                .getStringSelectValues(
                    'session_rules_agree'
                )[0] || '';
    } catch {}

    if (
        answer.toLowerCase() !== 'yes'
    ) {
        await interaction.reply({
            content:
                sessionConfig.rulesDeclineMessage,
            flags:
                MessageFlags.Ephemeral
        });

        return true;
    }

    const joinButton =
        new ButtonBuilder()
            .setLabel('Join Server')
            .setStyle(ButtonStyle.Link)
            .setURL(
                sessionConfig.joinUrl
            );

    await interaction.reply({
        content:
            '✅ You have agreed to the server rules. Use the button below to join.',
        components: [
            new ActionRowBuilder()
                .addComponents(
                    joinButton
                )
        ],
        flags:
            MessageFlags.Ephemeral
    });

    return true;
}


module.exports = {
    handleSessionButton,
    handleSessionModal
};
