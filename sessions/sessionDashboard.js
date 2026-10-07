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
    setDashboardMessageId
} = require('./sessionState');

const {
    ensureSessionIcons,
    buttonEmoji
} = require('./sessionIcons');

const {
    getApiSnapshot,
    fetchErlcSnapshot
} = require('./erlcApi');

const sessionConfig =
    require('./sessionConfig');


function divider() {
    return new SeparatorBuilder()
        .setSpacing(
            SeparatorSpacingSize.Small
        )
        .setDivider(true);
}


function getStaffCount(guild) {
    if (!guild) {
        return 0;
    }

    return guild.members.cache.filter(
        member =>
            member.roles.cache.has(
                sessionConfig.staffRoleId
            ) &&
            !member.user.bot
    ).size;
}


function applyEmoji(button, emoji) {
    const formatted =
        buttonEmoji(emoji);

    if (formatted) {
        button.setEmoji(formatted);
    }

    return button;
}


function getAttachmentUrls(message) {
    if (!message) {
        return {};
    }

    const top =
        message.attachments.find(
            item =>
                item.name ===
                'session-dashboard.png'
        );

    const bottom =
        message.attachments.find(
            item =>
                item.name ===
                'session-footer.png'
        );

    return {
        top: top?.url || null,
        bottom: bottom?.url || null
    };
}


async function buildSessionDashboard({
    guild,
    apiSnapshot = getApiSnapshot(),
    attachmentUrls = {}
}) {
    const state = getState();

    const icons =
        await ensureSessionIcons(guild);

    const staffCount =
        getStaffCount(guild);

    const now =
        Math.floor(Date.now() / 1000);

    const sessionActive =
        state.status === 'active' ||
        state.status === 'shutting-down';

    const isVoting =
        state.status === 'vote';

    const logoEmoji =
        icons.logo
            ? icons.logo.toString()
            : '';

    const files = [];

    let topUrl =
        attachmentUrls.top;

    let bottomUrl =
        attachmentUrls.bottom;

    if (!topUrl) {
        files.push(
            new AttachmentBuilder(
                path.join(
                    __dirname,
                    '..',
                    'images',
                    'ticket-dashboard.png'
                ),
                {
                    name: 'session-dashboard.png'
                }
            )
        );

        topUrl =
            'attachment://session-dashboard.png';
    }

    if (!bottomUrl) {
        files.push(
            new AttachmentBuilder(
                path.join(
                    __dirname,
                    '..',
                    'images',
                    'image.png'
                ),
                {
                    name: 'session-footer.png'
                }
            )
        );

        bottomUrl =
            'attachment://session-footer.png';
    }

    const sessionTimesButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId('session_times')
                .setLabel('Session Times')
                .setStyle(ButtonStyle.Secondary),
            icons.sessionTimes
        );

    const statusButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId('session_status')
                .setLabel(
                    apiSnapshot.apiOnline
                        ? 'Online'
                        : 'Offline'
                )
                .setStyle(
                    apiSnapshot.apiOnline
                        ? ButtonStyle.Success
                        : ButtonStyle.Danger
                )
                .setDisabled(true),
            icons.status
        );

    const playerButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(
                    'session_player_count'
                )
                .setLabel(
                    `Player count: ${apiSnapshot.playerCount}/${apiSnapshot.maxPlayers || 50}`
                )
                .setStyle(
                    sessionActive
                        ? ButtonStyle.Primary
                        : ButtonStyle.Secondary
                )
                .setDisabled(true),
            icons.players
        );

    const staffButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(
                    'session_staff_count'
                )
                .setLabel(
                    `Staff: ${staffCount}`
                )
                .setStyle(
                    sessionActive
                        ? ButtonStyle.Danger
                        : ButtonStyle.Secondary
                )
                .setDisabled(true),
            icons.staff
        );

    const queueButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(
                    'session_queue_count'
                )
                .setLabel(
                    `Queue: ${apiSnapshot.queueCount}`
                )
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(true),
            icons.queue
        );

    const joinButton =
        sessionActive
            ? applyEmoji(
                new ButtonBuilder()
                    .setCustomId('session_join')
                    .setLabel('Join')
                    .setStyle(ButtonStyle.Success),
                icons.join
            )
            : applyEmoji(
                new ButtonBuilder()
                    .setCustomId(
                        'session_join_disabled'
                    )
                    .setLabel('Join')
                    .setStyle(
                        ButtonStyle.Secondary
                    )
                    .setDisabled(true),
                icons.join
            );

    const informationRow =
        new ActionRowBuilder()
            .addComponents(
                playerButton,
                staffButton,
                queueButton,
                joinButton
            );

    let votingRow = null;

    if (isVoting) {
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

        const viewVotersButton =
            new ButtonBuilder()
                .setCustomId(
                    'session_view_voters'
                )
                .setLabel('View Voters')
                .setStyle(
                    ButtonStyle.Secondary
                );

        votingRow =
            new ActionRowBuilder()
                .addComponents(
                    voteButton,
                    viewVotersButton
                );
    }

    const container =
        new ContainerBuilder()
            .addMediaGalleryComponents(
                new MediaGalleryBuilder()
                    .addItems(
                        new MediaGalleryItemBuilder()
                            .setURL(topUrl)
                    )
            )
            .addSeparatorComponents(
                divider()
            )
            .addActionRowComponents(
                new ActionRowBuilder()
                    .addComponents(
                        sessionTimesButton,
                        statusButton
                    )
            )
            .addSeparatorComponents(
                divider()
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `## ${logoEmoji}${logoEmoji ? ' | ' : ''}Server Information\n\n` +
                        `- **Server name:** ${sessionConfig.serverName}\n` +
                        `- **Server owner:** ${sessionConfig.serverOwner}\n` +
                        `- **Server Code:** ${sessionConfig.serverCode}\n` +
                        `- **Last update:** <t:${now}:R>`
                    )
            )
            .addSeparatorComponents(
                divider()
            )
            .addActionRowComponents(
                informationRow
            );

    if (votingRow) {
        container
            .addActionRowComponents(
                votingRow
            );
    }

    container
        .addSeparatorComponents(
            divider()
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder()
                .addItems(
                    new MediaGalleryItemBuilder()
                        .setURL(bottomUrl)
                )
        );

    return {
        components: [container],
        files
    };
}


async function sendSessionDashboard(
    channel,
    options = {}
) {
    const dashboard =
        await buildSessionDashboard({
            guild: channel.guild,
            ...options
        });

    const message =
        await channel.send({
            ...dashboard,
            flags:
                MessageFlags.IsComponentsV2
        });

    setDashboardMessageId(
        message.id
    );

    return message;
}


function isSessionDashboardMessage(message) {
    if (!message) {
        return false;
    }

    try {
        const raw = JSON.stringify(
            message.components
        );

        return (
            raw.includes('session_times') &&
            raw.includes('session_player_count')
        );
    } catch {
        return false;
    }
}


async function findSessionDashboard(channel) {
    const state = getState();

    if (state.dashboardMessageId) {
        try {
            const known =
                await channel.messages.fetch(
                    state.dashboardMessageId
                );

            if (
                isSessionDashboardMessage(
                    known
                )
            ) {
                return known;
            }
        } catch {}
    }

    const messages =
        await channel.messages.fetch({
            limit: 100
        });

    const dashboard =
        messages.find(
            message =>
                message.author?.id ===
                    channel.client.user.id &&
                isSessionDashboardMessage(
                    message
                )
        );

    if (dashboard) {
        setDashboardMessageId(
            dashboard.id
        );
    }

    return dashboard || null;
}


async function updateSessionDashboardMessage(
    message,
    apiSnapshot = getApiSnapshot()
) {
    if (!message) {
        return null;
    }

    const dashboard =
        await buildSessionDashboard({
            guild: message.guild,
            apiSnapshot,
            attachmentUrls:
                getAttachmentUrls(message)
        });

    const payload = {
        components:
            dashboard.components
    };

    if (dashboard.files.length > 0) {
        payload.files =
            dashboard.files;
    }

    return await message.edit(
        payload
    );
}


async function refreshSessionDashboard(client) {
    try {
        const channel =
            await client.channels.fetch(
                sessionConfig.sessionChannelId
            );

        if (
            !channel ||
            !channel.isTextBased()
        ) {
            console.error(
                '[SESSION DASHBOARD] Session channel could not be found.'
            );

            return;
        }

        const apiSnapshot =
            await fetchErlcSnapshot();

        const dashboard =
            await findSessionDashboard(
                channel
            );

        if (!dashboard) {
            return;
        }

        await updateSessionDashboardMessage(
            dashboard,
            apiSnapshot
        );

    } catch (error) {
        console.error(
            '[SESSION DASHBOARD REFRESH ERROR]',
            error
        );
    }
}


function startSessionDashboardUpdater(client) {
    void refreshSessionDashboard(
        client
    );

    return setInterval(
        () => {
            void refreshSessionDashboard(
                client
            );
        },
        sessionConfig.dashboardRefreshMs
    );
}


async function handleDisplayButton(
    interaction
) {
    const ids = [
        'session_status',
        'session_player_count',
        'session_staff_count',
        'session_queue_count'
    ];

    if (
        !ids.includes(
            interaction.customId
        )
    ) {
        return false;
    }

    await interaction.deferUpdate();
    return true;
}


module.exports = {
    buildSessionDashboard,
    sendSessionDashboard,
    findSessionDashboard,
    updateSessionDashboardMessage,
    refreshSessionDashboard,
    startSessionDashboardUpdater,
    handleDisplayButton
};
