const path = require('path');

const {
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    ActionRowBuilder,
    MessageFlags
} = require('discord.js');

const {
    getState,
    setDashboardMessage,
    setApiSnapshot
} = require('./sessionState');

const {
    ensureSessionIcons,
    buttonEmoji
} = require('./sessionIcons');

const {
    getMelonlySnapshot
} = require('./melonlyApi');

const {
    getErlcHealth
} = require('./erlcApi');

const sessionConfig = require('./sessionConfig');

function divider() {
    return new SeparatorBuilder()
        .setSpacing(SeparatorSpacingSize.Small)
        .setDivider(true);
}

function applyEmoji(button, emoji) {
    const formatted = buttonEmoji(emoji);

    if (formatted) {
        button.setEmoji(formatted);
    }

    return button;
}

function displayCount(value) {
    return Number.isFinite(value) ? value : '—';
}

function getCachedDashboardData() {
    const state = getState();
    const melonly = state.lastMelonlySnapshot || {
        ok: false,
        info: {},
        playerCount: null,
        queueCount: null,
        staffCount: null
    };
    const erlc = state.lastErlcHealth || { ok: false };

    return {
        melonly,
        erlc,
        bothOnline: Boolean(melonly.ok && erlc.ok),
        updatedAt: state.lastUpdatedAt || Date.now()
    };
}

async function getDashboardData() {
    const [melonlyResult, erlcResult] = await Promise.allSettled([
        getMelonlySnapshot(),
        getErlcHealth()
    ]);

    const melonly = melonlyResult.status === 'fulfilled'
        ? melonlyResult.value
        : {
            ok: false,
            error: melonlyResult.reason?.message || 'Melonly request failed.'
        };

    const erlc = erlcResult.status === 'fulfilled'
        ? erlcResult.value
        : {
            ok: false,
            error: erlcResult.reason?.message || 'ER:LC request failed.'
        };

    const updatedAt = Date.now();

    setApiSnapshot({
        melonly,
        erlc,
        updatedAt
    });

    return {
        melonly,
        erlc,
        bothOnline: Boolean(melonly.ok && erlc.ok),
        updatedAt
    };
}

async function buildSessionDashboard({ guild, liveData = null } = {}) {
    const state = getState();
    const icons = await ensureSessionIcons(guild);
    const data = liveData || await getDashboardData();

    const melonlyInfo = data.melonly?.info || {};
    const playerCount = displayCount(data.melonly?.playerCount);
    const queueCount = displayCount(data.melonly?.queueCount);
    const staffCount = displayCount(data.melonly?.staffCount);

    const updatedAt = data.updatedAt || Date.now();
    const updatedTimestamp = Math.floor(updatedAt / 1000);
    const isVoting = state.status === 'vote';
    const isSessionActive = state.status === 'active' || state.status === 'shutting-down';
    const isOnline = data.bothOnline;

    const logoEmoji = icons.logo ? icons.logo.toString() : '';

    const topImage = new AttachmentBuilder(
        path.join(__dirname, '..', 'images', 'ticket-dashboard.png'),
        { name: 'session-dashboard.png' }
    );

    const bottomImage = new AttachmentBuilder(
        path.join(__dirname, '..', 'images', 'image.png'),
        { name: 'session-footer.png' }
    );

    const sessionTimesButton = applyEmoji(
        new ButtonBuilder()
            .setCustomId('session_times')
            .setLabel('Session Times')
            .setStyle(ButtonStyle.Secondary),
        icons.sessionTimes
    );

    const statusButton = applyEmoji(
        new ButtonBuilder()
            .setCustomId('session_status')
            .setLabel(isOnline ? 'Online' : 'Offline')
            .setStyle(isOnline ? ButtonStyle.Success : ButtonStyle.Danger)
            .setDisabled(!isOnline),
        icons.status
    );

    const playerButton = applyEmoji(
        new ButtonBuilder()
            .setCustomId('session_player_count')
            .setLabel(`Player count: ${playerCount}/${sessionConfig.maxPlayers}`)
            .setStyle(isSessionActive ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(!isSessionActive),
        icons.players
    );

    const staffButton = applyEmoji(
        new ButtonBuilder()
            .setCustomId('session_staff_count')
            .setLabel(`Staff: ${staffCount}`)
            .setStyle(isSessionActive ? ButtonStyle.Danger : ButtonStyle.Secondary)
            .setDisabled(!isSessionActive),
        icons.staff
    );

    const queueButton = applyEmoji(
        new ButtonBuilder()
            .setCustomId('session_queue_count')
            .setLabel(`Queue: ${queueCount}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!isSessionActive),
        icons.queue
    );

    let joinButton;

    if (isSessionActive) {
        // Discord link buttons always use the Link style. They cannot be green,
        // but this is now a direct one-click ER:LC link with no rules form.
        joinButton = applyEmoji(
            new ButtonBuilder()
                .setLabel('Join')
                .setStyle(ButtonStyle.Link)
                .setURL(sessionConfig.joinUrl),
            icons.join
        );
    } else {
        joinButton = applyEmoji(
            new ButtonBuilder()
                .setCustomId('session_join_disabled')
                .setLabel('Join')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            icons.join
        );
    }

    const informationRow = new ActionRowBuilder()
        .addComponents(
            playerButton,
            staffButton,
            queueButton,
            joinButton
        );

    const serverName =
        melonlyInfo.name ||
        melonlyInfo.serverName ||
        sessionConfig.serverName ||
        'Unavailable';

    const serverOwner =
        melonlyInfo.ownerName ||
        melonlyInfo.owner ||
        melonlyInfo.ownerId ||
        sessionConfig.serverOwner ||
        'Unavailable';

    const serverCode =
        melonlyInfo.joinCode ||
        melonlyInfo.code ||
        sessionConfig.fallbackJoinCode;

    const container = new ContainerBuilder()
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://session-dashboard.png')
            )
        )
        .addSeparatorComponents(divider())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                sessionTimesButton,
                statusButton
            )
        )
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${logoEmoji}${logoEmoji ? ' | ' : ''}Server Information\n\n` +
                `- **Server name:** ${serverName}\n` +
                `- **Server owner:** ${serverOwner}\n` +
                `- **Server Code:** ${serverCode}\n` +
                `- **Last updated:** <t:${updatedTimestamp}:R>`
            )
        )
        .addSeparatorComponents(divider())
        .addActionRowComponents(informationRow);

    if (isVoting) {
        const voteButton = applyEmoji(
            new ButtonBuilder()
                .setCustomId('session_vote')
                .setLabel(`Vote ${state.voters.size}/${state.voteTarget}`)
                .setStyle(ButtonStyle.Secondary),
            icons.vote
        );

        const votersButton = new ButtonBuilder()
            .setCustomId('session_view_voters')
            .setLabel('View voters')
            .setStyle(ButtonStyle.Secondary);

        container
            .addSeparatorComponents(divider())
            .addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    voteButton,
                    votersButton
                )
            );
    }

    container
        .addSeparatorComponents(divider())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://session-footer.png')
            )
        );

    return {
        components: [container],
        files: [topImage, bottomImage]
    };
}

async function sendSessionDashboard(channel) {
    const dashboard = await buildSessionDashboard({ guild: channel.guild });

    const message = await channel.send({
        ...dashboard,
        flags: MessageFlags.IsComponentsV2
    });

    setDashboardMessage(channel.id, message.id);
    return message;
}

async function refreshSessionDashboard(client, options = {}) {
    const state = getState();

    if (!state.dashboardChannelId || !state.dashboardMessageId) {
        return false;
    }

    const channel = await client.channels.fetch(state.dashboardChannelId).catch(() => null);
    if (!channel?.isTextBased()) return false;

    const message = await channel.messages.fetch(state.dashboardMessageId).catch(() => null);
    if (!message) return false;

    let liveData = null;

    if (options.preferCached) {
        liveData = getCachedDashboardData();
    }

    const dashboard = await buildSessionDashboard({
        guild: channel.guild,
        liveData
    });

    await message.edit({
        ...dashboard,
        flags: MessageFlags.IsComponentsV2
    });

    return true;
}

function startSessionDashboardUpdater(client) {
    const refreshMs =
        sessionConfig.dashboardRefreshMs ||
        sessionConfig.refreshIntervalMs ||
        30_000;

    // Run once shortly after startup so the dashboard has fresh data.
    setTimeout(() => {
        refreshSessionDashboard(client).catch(error => {
            console.error('[SESSION DASHBOARD INITIAL REFRESH ERROR]', error);
        });
    }, 1500).unref?.();

    const interval = setInterval(async () => {
        try {
            await refreshSessionDashboard(client);
        } catch (error) {
            console.error('[SESSION DASHBOARD REFRESH ERROR]', error);
        }
    }, refreshMs);

    if (typeof interval.unref === 'function') {
        interval.unref();
    }

    return interval;
}

async function handleDisplayButton(interaction) {
    const ids = [
        'session_status',
        'session_player_count',
        'session_staff_count',
        'session_queue_count'
    ];

    if (!ids.includes(interaction.customId)) {
        return false;
    }

    await interaction.deferUpdate();
    return true;
}

module.exports = {
    buildSessionDashboard,
    sendSessionDashboard,
    refreshSessionDashboard,
    startSessionDashboardUpdater,
    startDashboardAutoRefresh: startSessionDashboardUpdater,
    handleDisplayButton,
    getCachedDashboardData
};
