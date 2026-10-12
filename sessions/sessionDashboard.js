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
    getErlcHealth
} = require('./erlcApi');

const sessionConfig = require('./sessionConfig');

// Process-wide dashboard runtime so duplicate imports/reconnects cannot start
// multiple refresh loops or duplicate the same Discord REST work.
const DASHBOARD_RUNTIME_KEY = Symbol.for('msrp.sessionDashboard.runtime');
const dashboardRuntime = globalThis[DASHBOARD_RUNTIME_KEY] || (globalThis[DASHBOARD_RUNTIME_KEY] = {
    updater: null,
    refreshPromise: null,
    channel: null,
    message: null
});

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

function firstFinite(...values) {
    for (const value of values) {
        if (Number.isFinite(Number(value))) {
            return Number(value);
        }
    }

    return null;
}

function displayLiveCount(value, { sessionActive, apiOnline }) {
    if (!sessionActive || !apiOnline) {
        return '—';
    }

    return Number.isFinite(Number(value))
        ? Number(value)
        : 0;
}

function getCachedDashboardData() {
    const state = getState();
    const erlc = state.lastErlcHealth || { ok: false };

    return {
        // Kept for backward compatibility with sessionState snapshots.
        // The public dashboard no longer polls Melonly at all.
        melonly: state.lastMelonlySnapshot || { ok: false, info: {} },
        erlc,
        bothOnline: Boolean(erlc.ok),
        updatedAt: state.lastUpdatedAt || Date.now()
    };
}

async function getDashboardData() {
    // ER:LC is the sole live source for online/player/queue status.
    // Removing the old Melonly poll halves dashboard API traffic and prevents
    // dashboard refreshes from contributing to Melonly 429s.
    let erlc;
    try {
        erlc = await getErlcHealth();
    } catch (error) {
        erlc = {
            ok: false,
            error: error?.message || 'ER:LC request failed.'
        };
    }

    const state = getState();
    const melonly = state.lastMelonlySnapshot || { ok: false, info: {} };
    const updatedAt = Date.now();

    setApiSnapshot({ melonly, erlc, updatedAt });

    return {
        melonly,
        erlc,
        bothOnline: Boolean(erlc.ok),
        updatedAt
    };
}

async function buildSessionDashboard({ guild, liveData = null, forceInactive = false } = {}) {
    const state = getState();
    const icons = await ensureSessionIcons(guild);
    const data = liveData || await getDashboardData();

    const melonlyInfo = data.melonly?.info || {};

    const updatedAt = data.updatedAt || Date.now();
    const updatedTimestamp = Math.floor(updatedAt / 1000);
    const isVoting = state.status === 'vote';
    const isSessionActive = !forceInactive && (state.status === 'active' || state.status === 'shutting-down');
    const isOnline = data.bothOnline;

    // Live players and queue now come ONLY from ER:LC. Melonly is not
    // used for these counters. Staff is the number of Discord members
    // who currently hold the configured staff role.
    const livePlayerCount = firstFinite(data.erlc?.playerCount);
    const liveQueueCount = firstFinite(data.erlc?.queueCount);

    let liveStaffCount = null;
    if (guild) {
        // IMPORTANT: never call guild.members.fetch() from a repeating dashboard
        // refresh. That uses Gateway member requests and was one of the noisy
        // calls seen in the Wispbyte logs. The GuildMembers intent keeps this
        // role membership cache current as members/roles change.
        const staffRole = guild.roles.cache.get(sessionConfig.staffRoleId);
        liveStaffCount = staffRole ? staffRole.members.size : 0;
    }

    const erlcCountsOnline = Boolean(data.erlc?.ok);

    const playerCount = displayLiveCount(livePlayerCount, {
        sessionActive: isSessionActive,
        apiOnline: erlcCountsOnline
    });
    const queueCount = displayLiveCount(liveQueueCount, {
        sessionActive: isSessionActive,
        apiOnline: erlcCountsOnline
    });
    const staffCount = displayLiveCount(liveStaffCount, {
        sessionActive: isSessionActive,
        apiOnline: true
    });

    const maxPlayers = firstFinite(
        data.erlc?.maxPlayers,
        sessionConfig.maxPlayers
    ) || sessionConfig.maxPlayers;

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
            .setLabel(`Player count: ${playerCount}${playerCount === '—' ? '' : `/${maxPlayers}`}`)
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
        sessionConfig.serverName ||
        'Unavailable';

    const serverOwner =
        sessionConfig.serverOwner ||
        'Unavailable';

    // The public server code is intentionally fixed and is not taken
    // from Melonly.
    const serverCode =
        sessionConfig.serverCode ||
        sessionConfig.fallbackJoinCode ||
        'MSRPAU';

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
                .setStyle(ButtonStyle.Success),
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
    if (dashboardRuntime.refreshPromise) return dashboardRuntime.refreshPromise;

    dashboardRuntime.refreshPromise = (async () => {
        const state = getState();

        if (!state.dashboardChannelId || !state.dashboardMessageId) {
            return false;
        }

        let channel = dashboardRuntime.channel;
        if (!channel || channel.id !== state.dashboardChannelId) {
            channel =
                client.channels.cache.get(state.dashboardChannelId) ||
                await client.channels.fetch(state.dashboardChannelId).catch(() => null);
            dashboardRuntime.channel = channel || null;
            dashboardRuntime.message = null;
        }

        if (!channel?.isTextBased()) return false;

        let message = dashboardRuntime.message;
        if (!message || message.id !== state.dashboardMessageId) {
            message =
                channel.messages.cache.get(state.dashboardMessageId) ||
                await channel.messages.fetch(state.dashboardMessageId).catch(() => null);
            dashboardRuntime.message = message || null;
        }

        if (!message) return false;

        let liveData = null;
        if (options.preferCached) {
            liveData = getCachedDashboardData();
        }

        const dashboard = await buildSessionDashboard({
            guild: channel.guild,
            liveData,
            forceInactive: Boolean(options.forceInactive)
        });

        await message.edit({
            ...dashboard,
            flags: MessageFlags.IsComponentsV2
        });

        return true;
    })().finally(() => {
        dashboardRuntime.refreshPromise = null;
    });

    return dashboardRuntime.refreshPromise;
}

function startSessionDashboardUpdater(client) {
    if (dashboardRuntime.updater) return dashboardRuntime.updater;

    // Never hammer Discord/API dashboards faster than once per minute.
    // Manual session actions can still call refreshSessionDashboard instantly.
    const configured =
        sessionConfig.dashboardRefreshMs ||
        sessionConfig.refreshIntervalMs ||
        60_000;
    const refreshMs = Math.max(60_000, Number(configured) || 60_000);

    const startupTimer = setTimeout(() => {
        refreshSessionDashboard(client).catch(error => {
            console.error('[SESSION DASHBOARD INITIAL REFRESH ERROR]', error);
        });
    }, 5_000);
    startupTimer.unref?.();

    dashboardRuntime.updater = setInterval(() => {
        refreshSessionDashboard(client).catch(error => {
            console.error('[SESSION DASHBOARD REFRESH ERROR]', error);
        });
    }, refreshMs);

    dashboardRuntime.updater.unref?.();
    return dashboardRuntime.updater;
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
