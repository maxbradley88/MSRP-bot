const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
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
    clearVoteAnnouncement,
    setSessionAnnouncement
} = require('./sessionState');

const {
    refreshSessionDashboard
} = require('./sessionDashboard');

const {
    removeShutdownAnnouncement
} = require('./sessionShutdown');

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

function divider() {
    return new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true);
}

function pingText() {
    const roleIds = sessionConfig.pingRoleIds || sessionConfig.announcementRoleIds || [];
    return `@here ${roleIds.map(id => `<@&${id}>`).join(' ')}`.trim();
}

function findEmoji(guild, names) {
    return guild?.emojis?.cache?.find(emoji =>
        names.includes(emoji.name?.toLowerCase())
    ) || null;
}

function buildVoteAnnouncement(guild, target) {
    const voteEmoji = findEmoji(guild, ['msrp_vote', 'vote']);
    const icon = voteEmoji ? `${voteEmoji} ` : '';

    return new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${icon}Session Vote\n` +
                '**A session vote has been started!**\n\n' +
                'Use the **Vote** button on the Sessions Dashboard to cast or remove your vote. ' +
                'Once the goal is reached, the session will automatically open.\n\n' +
                `**Vote goal:** ${target}`
            )
        )
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '-# Your vote can be changed at any time before the goal is reached.'
            )
        );
}

function buildStartedAnnouncement(guild) {
    const logoEmoji = findEmoji(guild, ['logo']);
    const icon = logoEmoji ? `${logoEmoji} ` : '';

    return new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${icon}Session Started\n` +
                '**A session has started!**\n\n' +
                'Join using the **Join** button on the Sessions Dashboard, or use the server code below.\n\n' +
                `**Server code:** \`${sessionConfig.fallbackJoinCode || sessionConfig.serverCode}\``
            )
        );
}

async function getAnnouncementChannel(client) {
    const channelId =
        sessionConfig.announcementChannelId ||
        sessionConfig.sessionChannelId;

    const channel = await client.channels
        .fetch(channelId)
        .catch(() => null);

    if (!channel?.isTextBased()) {
        throw new Error('The configured session announcement channel could not be found.');
    }

    return channel;
}

async function deleteVoteAnnouncement(client) {
    const state = getState();

    if (!state.voteAnnouncementChannelId || !state.voteAnnouncementMessageId) {
        clearVoteAnnouncement();
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

    // A new vote replaces any old post-shutdown notice immediately.
    await removeShutdownAnnouncement(interaction.client).catch(() => {});

    startVote(target);

    const channel = await getAnnouncementChannel(interaction.client);
    const roleIds = sessionConfig.pingRoleIds || sessionConfig.announcementRoleIds || [];

    const message = await channel.send({
        components: [
            new TextDisplayBuilder().setContent(pingText()),
            buildVoteAnnouncement(channel.guild, target)
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: ['everyone'],
            roles: roleIds
        }
    });

    setVoteAnnouncement(channel.id, message.id);

    // Use cached API values here so the vote controls appear immediately.
    await refreshSessionDashboard(interaction.client, { preferCached: true });

    await interaction.editReply({
        content: `✅ Session vote started. Goal: ${target} vote${target === 1 ? '' : 's'}.`
    });
}

async function tryStartMelonlySession() {
    if (!sessionConfig.attemptMelonlyStart) {
        return false;
    }

    try {
        await startMelonlySession();
        console.log('[MELONLY SESSION] Session start request succeeded.');
        return true;
    } catch (error) {
        console.warn(
            '[MELONLY SESSION] Could not start Melonly session; continuing with Discord session:',
            error?.message || error
        );
        return false;
    }
}

async function startSessionNow(client) {
    // Best-effort only. Melonly currently does not expose a documented public
    // start-session endpoint, so failure no longer blocks the Discord session.
    await tryStartMelonlySession();

    startSession();

    // Starting a new session cancels the post-shutdown join lockdown and
    // removes the previous one-hour shutdown notice if it still exists.
    await removeShutdownAnnouncement(client).catch(() => {});

    // If a force-start happens while a vote is running, remove the old vote
    // announcement and its dashboard controls too.
    await deleteVoteAnnouncement(client);
    await refreshSessionDashboard(client, { preferCached: true });

    const channel = await getAnnouncementChannel(client);
    const roleIds = sessionConfig.pingRoleIds || sessionConfig.announcementRoleIds || [];

    const startedMessage = await channel.send({
        components: [
            new TextDisplayBuilder().setContent(pingText()),
            buildStartedAnnouncement(channel.guild)
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: ['everyone'],
            roles: roleIds
        }
    });

    setSessionAnnouncement(channel.id, startedMessage.id);

    return true;
}

async function completeVote(client) {
    const state = getState();

    if (state.status !== 'vote' || state.voters.size < state.voteTarget) {
        return false;
    }

    return startSessionNow(client);
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

    // Reply first so Discord instantly acknowledges the click.
    await interaction.reply({
        content: added
            ? 'Your vote has been added'
            : 'Your vote has been removed',
        flags: MessageFlags.Ephemeral
    });

    // Fast state-only refresh; no API round trip here.
    await refreshSessionDashboard(interaction.client, { preferCached: true });

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
    completeVote,
    startSessionNow,
    deleteVoteAnnouncement
};
