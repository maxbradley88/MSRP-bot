const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MessageFlags
} = require('discord.js');

const sessionConfig = require('./sessionConfig');
const {
    getState,
    startVote,
    addVote,
    removeVote,
    hasVoted,
    startSession,
    setVoteAnnouncement,
    clearVoteAnnouncement
} = require('./sessionState');

const {
    refreshSessionDashboard
} = require('./sessionDashboard');

const {
    startMelonlySession
} = require('./melonlyApi');

const command = new SlashCommandBuilder()
    .setName('session-vote')
    .setDescription('Starts a session vote.')
    .addIntegerOption(option =>
        option
            .setName('votes-required')
            .setDescription('Number of votes required to start the session.')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(50)
    );

function pingText() {
    return `@here ${sessionConfig.pingRoleIds.map(id => `<@&${id}>`).join(' ')}`;
}

function buildVoteAnnouncement() {
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## A session vote has been started!\n' +
                'Use the button on the Sessions Dashboard to cast your vote. Once the goal is reached, a session will start.'
            )
        );
}

function buildStartedAnnouncement() {
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## A session has started!\n' +
                `Join using the button on the Sessions Dashboard or use code: **${sessionConfig.fallbackJoinCode}**.`
            )
        );
}

async function getAnnouncementChannel(client) {
    const channel = await client.channels
        .fetch(sessionConfig.announcementChannelId)
        .catch(() => null);

    if (!channel?.isTextBased()) {
        throw new Error('The configured session announcement channel could not be found.');
    }

    return channel;
}

async function deleteVoteAnnouncement(client) {
    const state = getState();

    if (!state.voteAnnouncementChannelId || !state.voteAnnouncementMessageId) {
        return;
    }

    const channel = await client.channels
        .fetch(state.voteAnnouncementChannelId)
        .catch(() => null);

    const message = channel?.isTextBased()
        ? await channel.messages.fetch(state.voteAnnouncementMessageId).catch(() => null)
        : null;

    if (message) {
        await message.delete().catch(() => null);
    }

    clearVoteAnnouncement();
}

async function beginVote(interaction) {
    const state = getState();

    if (state.status === 'vote') {
        await interaction.reply({
            content: '❌ A session vote is already running.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (state.status === 'active' || state.status === 'shutting-down') {
        await interaction.reply({
            content: '❌ A session is already active.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const target = interaction.options.getInteger('votes-required', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    startVote(target);

    const channel = await getAnnouncementChannel(interaction.client);

    const message = await channel.send({
        components: [
            new TextDisplayBuilder().setContent(pingText()),
            buildVoteAnnouncement()
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: ['everyone'],
            roles: sessionConfig.pingRoleIds
        }
    });

    setVoteAnnouncement(channel.id, message.id);
    await refreshSessionDashboard(interaction.client);

    await interaction.editReply({
        content: `✅ Session vote started. Goal: ${target} vote${target === 1 ? '' : 's'}.`
    });
}

async function completeVote(client) {
    const state = getState();

    if (state.status !== 'vote' || state.voters.size < state.voteTarget) {
        return false;
    }

    try {
        /*
         * Melonly MUST start successfully before we unlock Join or send the
         * session-start ping. If this throws, the vote remains active.
         */
        await startMelonlySession();
    } catch (error) {
        console.error('[MELONLY SESSION START ERROR]', error);

        const channel = await getAnnouncementChannel(client).catch(() => null);
        if (channel) {
            await channel.send({
                content:
                    '❌ The vote goal was reached, but the bot could not start the session on Melonly. ' +
                    'The Join button has not been unlocked.\n' +
                    `Reason: ${error.message}`
            });
        }

        return false;
    }

    startSession();
    await deleteVoteAnnouncement(client);
    await refreshSessionDashboard(client);

    const channel = await getAnnouncementChannel(client);

    await channel.send({
        components: [
            new TextDisplayBuilder().setContent(pingText()),
            buildStartedAnnouncement()
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: ['everyone'],
            roles: sessionConfig.pingRoleIds
        }
    });

    return true;
}

async function toggleVote(interaction) {
    const state = getState();

    if (state.status !== 'vote') {
        await interaction.reply({
            content: 'There is no active session vote.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const userId = interaction.user.id;
    let added;

    if (hasVoted(userId)) {
        removeVote(userId);
        added = false;
    } else {
        addVote(userId);
        added = true;
    }

    await interaction.reply({
        content: added
            ? 'Your vote has been added'
            : 'Your vote has been removed',
        flags: MessageFlags.Ephemeral
    });

    await refreshSessionDashboard(interaction.client);

    if (added && state.voters.size >= state.voteTarget) {
        await completeVote(interaction.client);
    }

    return true;
}

async function viewVoters(interaction) {
    const state = getState();

    if (state.status !== 'vote') {
        await interaction.reply({
            content: 'There is no active session vote.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const tick = interaction.guild?.emojis?.cache?.find(emoji =>
        ['white_tick', 'msrp_tick', 'tick'].includes(emoji.name?.toLowerCase())
    );

    const tickText = tick ? tick.toString() : '✅';
    const voters = [...state.voters];

    const content = voters.length
        ? voters.map(id => `${tickText} - <@${id}>`).join('\n')
        : 'No one has voted yet.';

    await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] }
    });

    return true;
}

async function handleVoteButton(interaction) {
    if (interaction.customId === 'session_vote') {
        return toggleVote(interaction);
    }

    if (interaction.customId === 'session_view_voters') {
        return viewVoters(interaction);
    }

    return false;
}

module.exports = {
    data: command,
    execute: beginVote,
    handleVoteButton,
    completeVote
};
