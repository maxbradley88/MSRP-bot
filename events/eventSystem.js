const fs = require('node:fs');
const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    ContainerBuilder,
    GuildScheduledEventEntityType,
    GuildScheduledEventPrivacyLevel,
    GuildScheduledEventStatus,
    LabelBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    ModalBuilder,
    SeparatorBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} = require('discord.js');

const { loadData, saveData, makeId } = require('./eventData');
const { ensureEventIcons, getEventIcons } = require('./eventIcons');
const { getState } = require('../sessions/sessionState');
const sessionConfig = require('../sessions/sessionConfig');
const mainDashboardData = require('../mainDashboard/dashboardData');

const EVENT_CHANNEL_ID = '1547545145904472114';
const EVENT_NOTIFICATION_ROLE_ID = '1548805132886745159';
const EVENT_TEAM_ROLE_ID = '1558396994601615460';
const EVENT_STAGE_CHANNEL_ID = '1558417063083647056';
const INFO_DASHBOARD_CHANNEL_ID = '1547544258276364338';

const TOP_IMAGE = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const BOTTOM_IMAGE = path.join(__dirname, '..', 'images', 'image.png');
const ADELAIDE_TIME_ZONE = 'Australia/Adelaide';
const MONITOR_INTERVAL_MS = 15_000;
const STARTING_SOON_MS = 5 * 60 * 1000;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

const pendingConfig = new Map();
let monitorStarted = false;
let monitorBusy = false;

const commands = [
    new SlashCommandBuilder()
        .setName('event-vote')
        .setDescription('Starts an MSRP event vote in the event channel.')
        .addStringOption(option => option
            .setName('message')
            .setDescription('Message shown above the vote.')
            .setRequired(true)
            .setMaxLength(1500))
        .addStringOption(option => option
            .setName('option-1')
            .setDescription('First event option.')
            .setRequired(true)
            .setMaxLength(80))
        .addStringOption(option => option
            .setName('option-2')
            .setDescription('Second event option.')
            .setRequired(true)
            .setMaxLength(80))
        // Discord requires every required slash-command option to appear
        // before any optional option. Keep vote end date/time here.
        .addStringOption(option => option
            .setName('end-date')
            .setDescription('Vote end date: DD/MM/YYYY or YYYY-MM-DD.')
            .setRequired(true)
            .setMaxLength(10))
        .addStringOption(option => option
            .setName('end-time')
            .setDescription('Vote end time in 24-hour format, e.g. 19:30.')
            .setRequired(true)
            .setMaxLength(5))
        .addStringOption(option => option.setName('option-3').setDescription('Third event option.').setMaxLength(80))
        .addStringOption(option => option.setName('option-4').setDescription('Fourth event option.').setMaxLength(80))
        .addStringOption(option => option.setName('option-5').setDescription('Fifth event option.').setMaxLength(80))
];

function applyEmoji(component, emoji) {
    if (emoji) component.setEmoji(emoji);
    return component;
}

function isEventStaff(member) {
    return Boolean(member?.roles?.cache?.has(EVENT_TEAM_ROLE_ID));
}

function sessionIsActive() {
    return getState()?.status === 'active';
}

function joinUrl() {
    return sessionConfig.joinUrl || 'https://erlc.gg/join/MSRPAU';
}

function parseDateString(value) {
    const text = String(value || '').trim();
    let match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };

    match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };

    return null;
}

function parseTimeString(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
}

function zonedParts(date, timeZone) {
    const formatter = new Intl.DateTimeFormat('en-AU', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
    });

    return Object.fromEntries(
        formatter.formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, Number(part.value)])
    );
}

function adelaideLocalToDate(dateInput, timeInput) {
    const date = parseDateString(dateInput);
    const time = parseTimeString(timeInput);
    if (!date || !time) return null;

    const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
    let guess = localAsUtc;

    for (let i = 0; i < 3; i += 1) {
        const parts = zonedParts(new Date(guess), ADELAIDE_TIME_ZONE);
        const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
        const offset = represented - guess;
        guess = localAsUtc - offset;
    }

    const result = new Date(guess);
    return Number.isNaN(result.getTime()) ? null : result;
}

function timestamp(ms, style = 'F') {
    if (!ms) return 'Not set';
    return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function countdown(ms) {
    if (!ms) return '';
    return `<t:${Math.floor(ms / 1000)}:R>`;
}

function clampText(text, max) {
    const value = String(text || '');
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function statusFor(current) {
    if (current.phase === 'cancelled') return { label: 'Canceled', style: ButtonStyle.Danger, color: 0xED4245 };
    if (current.phase === 'waiting-session') return { label: 'Waiting for Session', style: ButtonStyle.Primary, color: 0x5865F2 };
    if (current.phase === 'active' && sessionIsActive()) return { label: 'Active', style: ButtonStyle.Success, color: 0x57F287 };
    if (current.phase === 'active' && !sessionIsActive()) return { label: 'Waiting for Session', style: ButtonStyle.Primary, color: 0x5865F2 };
    if (['scheduled', 'starting-soon'].includes(current.phase) && !sessionIsActive()) {
        return { label: 'Waiting for Session', style: ButtonStyle.Primary, color: 0x5865F2 };
    }
    return { label: 'Preparing', style: ButtonStyle.Secondary, color: 0x99AAB5 };
}

function participantCount(current) {
    return Array.isArray(current?.event?.participantIds) ? current.event.participantIds.length : 0;
}

function partnershipEntries() {
    try {
        return (mainDashboardData.loadData()?.partnerships || []).slice(0, 24);
    } catch {
        return [];
    }
}

function partnershipNames(ids) {
    const byId = new Map(partnershipEntries().map(item => [item.id, item.name]));
    const names = (ids || []).map(id => byId.get(id)).filter(Boolean);
    return names.length ? names : [];
}

function eventDiscordUrl(guildId, eventId) {
    return guildId && eventId ? `https://discord.com/events/${guildId}/${eventId}` : null;
}

function buildFiles({ top = false, bottom = true } = {}) {
    const files = [];
    if (top && fs.existsSync(TOP_IMAGE)) files.push({ attachment: TOP_IMAGE, name: 'ticket-dashboard.png' });
    if (bottom && fs.existsSync(BOTTOM_IMAGE)) files.push({ attachment: BOTTOM_IMAGE, name: 'image.png' });
    return files;
}

function addBottomImage(container) {
    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );
}

function addTopImage(container) {
    container
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')
            )
        )
        .addSeparatorComponents(new SeparatorBuilder());
}

function splitRows(buttons, max = 5) {
    const rows = [];
    for (let i = 0; i < buttons.length; i += max) {
        rows.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + max)));
    }
    return rows;
}

function pollCounts(current) {
    const voteMap = current.vote?.votes || {};
    const counts = Object.fromEntries((current.vote?.options || []).map(option => [option.id, 0]));
    for (const optionId of Object.values(voteMap)) {
        if (Object.prototype.hasOwnProperty.call(counts, optionId)) counts[optionId] += 1;
    }
    return counts;
}

function pollResultsText(current) {
    const counts = pollCounts(current);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const lines = (current.vote?.options || []).map(option => {
        const count = counts[option.id] || 0;
        const percent = total ? Math.round((count / total) * 100) : 0;
        return `**${option.label}** — ${count} vote${count === 1 ? '' : 's'} (${percent}%)`;
    });
    return `${lines.join('\n')}\n\n**Total votes:** ${total}`;
}

function buildVoteCard(current, icons) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Event vote\n\n${current.vote.message}\n\n**Voting closes:** ${timestamp(current.vote.endsAt)} (${countdown(current.vote.endsAt)})`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(pollResultsText(current)))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${EVENT_NOTIFICATION_ROLE_ID}>`))
        .addSeparatorComponents(new SeparatorBuilder());

    const optionButtons = (current.vote.options || []).map(option =>
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(`evt_vote:${current.id}:${option.id}`)
                .setLabel(option.label)
                .setStyle(ButtonStyle.Secondary),
            icons.vote
        )
    );

    for (const row of splitRows(optionButtons, 4)) container.addActionRowComponents(row);

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            applyEmoji(
                new ButtonBuilder()
                    .setCustomId(`evt_staff:${current.id}`)
                    .setLabel('Staff Actions')
                    .setStyle(ButtonStyle.Secondary),
                icons.staff
            )
        )
    );

    addBottomImage(container);
    return { container, files: buildFiles({ bottom: true }) };
}

function buildTieCard(current, icons) {
    const tied = current.tieOptionIds || [];
    const options = current.vote.options.filter(option => tied.includes(option.id));
    const container = new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Event vote tied\n\nThe vote has ended without a single winner. Event Team must choose the event that will proceed.\n\n${options.map(option => `- **${option.label}**`).join('\n')}`
            )
        )
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${EVENT_TEAM_ROLE_ID}>`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                applyEmoji(
                    new ButtonBuilder().setCustomId(`evt_choose_winner:${current.id}`).setLabel('Choose Winner').setStyle(ButtonStyle.Primary),
                    icons.winner
                ),
                applyEmoji(
                    new ButtonBuilder().setCustomId(`evt_cancel:${current.id}`).setLabel('Cancel Event').setStyle(ButtonStyle.Danger),
                    icons.cancel
                )
            )
        );
    addBottomImage(container);
    return { container, files: buildFiles({ bottom: true }) };
}

function eventControlRow(current, icons, { activeJoin = false, cancelled = false } = {}) {
    const status = statusFor(current);
    const buttons = [];

    if (cancelled) {
        buttons.push(
            applyEmoji(new ButtonBuilder().setCustomId(`evt_join_disabled:${current.id}`).setLabel('Join Event').setStyle(ButtonStyle.Secondary).setDisabled(true), icons.join)
        );
    } else if (activeJoin) {
        buttons.push(
            applyEmoji(new ButtonBuilder().setCustomId(`evt_join_server:${current.id}`).setLabel('Join').setStyle(ButtonStyle.Primary), icons.join)
        );
    } else {
        const configured = Boolean(current.event?.startAt && current.event?.hostId);
        buttons.push(
            applyEmoji(
                new ButtonBuilder()
                    .setCustomId(`evt_participate:${current.id}`)
                    .setLabel('Join Event')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!configured),
                icons.join
            )
        );
    }

    buttons.push(
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(`evt_participants:${current.id}`)
                .setLabel(cancelled ? 'Participants: -' : `Participants: ${participantCount(current)}`)
                .setStyle(ButtonStyle.Primary)
                .setDisabled(true),
            icons.participants
        )
    );

    buttons.push(
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(`evt_status:${current.id}`)
                .setLabel(`Status: ${status.label}`)
                .setStyle(status.style)
                .setDisabled(cancelled),
            icons.status
        )
    );

    buttons.push(
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(`evt_staff:${current.id}`)
                .setLabel('Staff Actions')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(cancelled),
            icons.staff
        )
    );

    return new ActionRowBuilder().addComponents(...buttons);
}

function buildDraftCard(current, icons) {
    const title = current.event?.title || `${current.winnerLabel} MSRP Event`;
    const description = current.event?.description || 'A Melbourne State Roleplay Event has been voted for, please watch this page for further information from the event team.';
    const container = new ContainerBuilder().setAccentColor(0x99AAB5);
    addTopImage(container);
    container
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n\n${description}`))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${EVENT_NOTIFICATION_ROLE_ID}>\n<@&${EVENT_TEAM_ROLE_ID}>`))
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(eventControlRow(current, icons));
    addBottomImage(container);
    return { container, files: buildFiles({ top: true, bottom: true }) };
}

function eventDetailsText(current) {
    const event = current.event || {};
    const partners = partnershipNames(event.partnershipIds);
    const lines = [
        `## ${event.title || current.winnerLabel}`,
        '',
        event.description || '',
        '',
        `**Host:** ${event.hostId ? `<@${event.hostId}>` : 'Not set'}`,
        `**Date & time:** ${event.startAt ? `${timestamp(event.startAt)} (${countdown(event.startAt)})` : 'Not set'}`
    ];
    if (partners.length) lines.push(`**Partnerships:** ${partners.join(', ')}`);
    return lines.join('\n');
}

function buildScheduledCard(current, icons) {
    const status = statusFor(current);
    const container = new ContainerBuilder().setAccentColor(status.color);
    addTopImage(container);
    container
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(eventDetailsText(current)))
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(eventControlRow(current, icons))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${EVENT_NOTIFICATION_ROLE_ID}>`));
    addBottomImage(container);
    return { container, files: buildFiles({ top: true, bottom: true }) };
}

function buildStartingSoonCard(current, icons) {
    const status = statusFor(current);
    const event = current.event;
    const container = new ContainerBuilder().setAccentColor(status.color)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${event.title} Starting Soon!\n\n${event.title} is starting shortly.\n\nThe host for the event will be: <@${event.hostId}>\n\n**Starts:** ${timestamp(event.startAt)} (${countdown(event.startAt)})\n\nWe cant wait to see you there!\n\n<@&${EVENT_NOTIFICATION_ROLE_ID}>`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(eventControlRow(current, icons));
    addBottomImage(container);
    return { container, files: buildFiles({ bottom: true }) };
}

function buildWaitingSessionCard(current, icons) {
    const container = new ContainerBuilder()
        .setAccentColor(0x5865F2)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Waiting for session\n\nBefore we can start this event a session must be hosted, please wait for a session to be hosted.\n\nOnce a session has started this event will be started by the host.`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(eventControlRow(current, icons))
        .addSeparatorComponents(new SeparatorBuilder());
    addBottomImage(container);
    return { container, files: buildFiles({ bottom: true }) };
}

function buildActiveCard(current, icons) {
    const event = current.event;
    const voiceId = event.liveVoiceChannelId || EVENT_STAGE_CHANNEL_ID;
    const waiting = !sessionIsActive();
    const container = new ContainerBuilder().setAccentColor(waiting ? 0x5865F2 : 0x57F287)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                waiting
                    ? `## ${event.title} — Waiting for Session\n\nThe event has been paused because the MSRP game session is currently offline. It will become available again when the session returns.\n\n**Host:** <@${event.hostId}>\n\n<@&${EVENT_NOTIFICATION_ROLE_ID}>`
                    : `## ${event.title} Has Started!\n\n${event.title} has now started, join the server now to participate in the event.\n\nJoin <#${voiceId}> to hear whats happening!\n\n@here <@&${EVENT_NOTIFICATION_ROLE_ID}>`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(eventControlRow(current, icons, { activeJoin: !waiting }));
    addBottomImage(container);
    return { container, files: buildFiles({ bottom: true }) };
}

function buildCancelledCard(current, icons) {
    const name = current.event?.title || current.winnerLabel || 'Event';
    const container = new ContainerBuilder().setAccentColor(0xED4245)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${name} has been canceled.\n\nMelbourne State Roleplay regrets to inform you that this event has been cancelled by the host or an organiser.\n\nPlease stay tuned to this channel or claim the event notification in <#${INFO_DASHBOARD_CHANNEL_ID}> to find out when the next event will be hosted!\n\n<@&${EVENT_NOTIFICATION_ROLE_ID}>`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(eventControlRow(current, icons, { cancelled: true }));
    addBottomImage(container);
    return { container, files: buildFiles({ bottom: true }) };
}

function buildCompletedCard(current, icons) {
    const name = current.event?.title || current.winnerLabel || 'Event';
    const container = new ContainerBuilder().setAccentColor(0x99AAB5)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${name} Has Finished\n\nThank you to everyone who participated in the event. Keep an eye on this channel for the next MSRP event!`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                applyEmoji(new ButtonBuilder().setCustomId(`evt_done:${current.id}`).setLabel(`Participants: ${participantCount(current)}`).setStyle(ButtonStyle.Secondary).setDisabled(true), icons.participants),
                applyEmoji(new ButtonBuilder().setCustomId(`evt_done_status:${current.id}`).setLabel('Status: Finished').setStyle(ButtonStyle.Secondary).setDisabled(true), icons.status)
            )
        );
    addBottomImage(container);
    return { container, files: buildFiles({ bottom: true }) };
}

function buildCard(current, icons) {
    if (current.phase === 'voting') return buildVoteCard(current, icons);
    if (current.phase === 'tie') return buildTieCard(current, icons);
    if (current.phase === 'draft') return buildDraftCard(current, icons);
    if (current.phase === 'scheduled') return buildScheduledCard(current, icons);
    if (current.phase === 'starting-soon') return buildStartingSoonCard(current, icons);
    if (current.phase === 'waiting-session') return buildWaitingSessionCard(current, icons);
    if (current.phase === 'active') return buildActiveCard(current, icons);
    if (current.phase === 'cancelled') return buildCancelledCard(current, icons);
    return buildCompletedCard(current, icons);
}

function allowedMentionsForPhase(current) {
    const roles = [];
    let parse = [];
    if (['voting', 'draft', 'scheduled', 'starting-soon', 'waiting-session', 'active', 'cancelled'].includes(current.phase)) {
        roles.push(EVENT_NOTIFICATION_ROLE_ID);
    }
    if (['draft', 'tie'].includes(current.phase)) roles.push(EVENT_TEAM_ROLE_ID);
    if (current.phase === 'active') parse = ['everyone'];
    return { parse, roles: [...new Set(roles)], users: [] };
}

async function getEventChannel(client) {
    return client.channels.cache.get(EVENT_CHANNEL_ID) || await client.channels.fetch(EVENT_CHANNEL_ID);
}

async function fetchCurrentMessage(client, current) {
    if (!current?.messageId) return null;
    const channel = await getEventChannel(client);
    try {
        return await channel.messages.fetch(current.messageId);
    } catch {
        return null;
    }
}

async function editCurrentCard(client, current) {
    const message = await fetchCurrentMessage(client, current);
    if (!message) return false;
    const icons = getEventIcons(message.guild);
    const built = buildCard(current, icons);
    await message.edit({
        components: [built.container],
        files: built.files,
        attachments: []
    });
    return true;
}

async function replaceCurrentCard(client, current, { ping = true } = {}) {
    const channel = await getEventChannel(client);
    const oldMessage = await fetchCurrentMessage(client, current);
    const icons = getEventIcons(channel.guild);
    const built = buildCard(current, icons);
    const message = await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [built.container],
        files: built.files,
        allowedMentions: ping ? allowedMentionsForPhase(current) : { parse: [], roles: [], users: [] }
    });
    current.messageId = message.id;
    current.channelId = channel.id;
    saveData({ current });
    if (oldMessage && oldMessage.id !== message.id) {
        await oldMessage.delete().catch(() => {});
    }
    return message;
}

async function createNativeScheduledEvent(guild, current) {
    const event = current.event;
    const partnerNames = partnershipNames(event.partnershipIds);
    const description = clampText(
        `${event.description}\n\nHost: ${event.hostId ? `<@${event.hostId}>` : 'TBA'}${partnerNames.length ? `\nPartnerships: ${partnerNames.join(', ')}` : ''}`,
        1000
    );

    const image = fs.existsSync(TOP_IMAGE) ? fs.readFileSync(TOP_IMAGE) : undefined;
    const existing = event.discordEventId
        ? await guild.scheduledEvents.fetch(event.discordEventId).catch(() => null)
        : null;

    const payload = {
        name: clampText(event.title, 100),
        description,
        scheduledStartTime: new Date(event.startAt),
        scheduledEndTime: new Date(event.startAt + SIX_HOURS_MS),
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityType: GuildScheduledEventEntityType.Voice,
        channel: EVENT_STAGE_CHANNEL_ID,
        image
    };

    let scheduled;
    if (existing) {
        scheduled = await existing.edit(payload, 'MSRP event details updated');
    } else {
        scheduled = await guild.scheduledEvents.create({ ...payload, reason: 'MSRP event created' });
    }
    event.discordEventId = scheduled.id;
    saveData({ current });
    return scheduled;
}

async function setNativeEventStatus(guild, current, status) {
    const eventId = current.event?.discordEventId;
    if (!eventId) return;
    try {
        const scheduled = await guild.scheduledEvents.fetch(eventId);
        if (!scheduled) return;
        await scheduled.setStatus(status);
    } catch (error) {
        console.warn('[EVENTS] Could not change Discord scheduled event status:', error?.message || error);
    }
}

async function finishVote(client, current, forcedWinnerId = null) {
    if (!current || current.phase !== 'voting') return;
    const counts = pollCounts(current);
    const max = Math.max(0, ...Object.values(counts));
    let candidateIds = forcedWinnerId
        ? [forcedWinnerId]
        : current.vote.options.filter(option => (counts[option.id] || 0) === max).map(option => option.id);

    if (!forcedWinnerId && (max === 0 || candidateIds.length !== 1)) {
        current.phase = 'tie';
        current.tieOptionIds = max === 0 ? current.vote.options.map(option => option.id) : candidateIds;
        saveData({ current });
        await replaceCurrentCard(client, current, { ping: true });
        return;
    }

    const winner = current.vote.options.find(option => option.id === candidateIds[0]);
    if (!winner) return;

    current.phase = 'draft';
    current.winnerOptionId = winner.id;
    current.winnerLabel = winner.label;
    current.tieOptionIds = [];
    current.event = {
        title: `${winner.label} MSRP Event`,
        description: 'A Melbourne State Roleplay Event has been voted for, please watch this page for further information from the event team.',
        startAt: null,
        hostId: null,
        partnershipIds: [],
        discordEventId: null,
        participantIds: [],
        liveVoiceChannelId: null,
        startedAt: null
    };
    saveData({ current });
    await replaceCurrentCard(client, current, { ping: true });
}

function staffPanel(current, icons, userId) {
    const hostBlockedBySession =
        ['starting-soon', 'waiting-session'].includes(current.phase) &&
        userId === current.event?.hostId &&
        !sessionIsActive();

    const staffText = hostBlockedBySession
        ? '## Event Staff Actions\n\n🔒 **Start Event is unavailable because MSRP is not currently SSU.** Once a session is active, reopen Staff Actions and you will be able to start the event.'
        : '## Event Staff Actions';

    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(staffText))
        .addSeparatorComponents(new SeparatorBuilder());

    const buttons = [];
    if (current.phase === 'voting') {
        buttons.push(
            applyEmoji(new ButtonBuilder().setCustomId(`evt_end_poll:${current.id}`).setLabel('End Poll').setStyle(ButtonStyle.Primary), icons.end),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_add_option:${current.id}`).setLabel('Add Option').setStyle(ButtonStyle.Secondary), icons.add),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_remove_option:${current.id}`).setLabel('Remove Option').setStyle(ButtonStyle.Secondary), icons.remove),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_cancel:${current.id}`).setLabel('Cancel Event').setStyle(ButtonStyle.Danger), icons.cancel)
        );
    } else if (current.phase === 'tie') {
        buttons.push(
            applyEmoji(new ButtonBuilder().setCustomId(`evt_choose_winner:${current.id}`).setLabel('Choose Winner').setStyle(ButtonStyle.Primary), icons.winner),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_cancel:${current.id}`).setLabel('Cancel Event').setStyle(ButtonStyle.Danger), icons.cancel)
        );
    } else if (current.phase === 'draft') {
        buttons.push(
            applyEmoji(new ButtonBuilder().setCustomId(`evt_configure:${current.id}`).setLabel('Configure Event').setStyle(ButtonStyle.Primary), icons.configure),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_cancel:${current.id}`).setLabel('Cancel Event').setStyle(ButtonStyle.Danger), icons.cancel)
        );
    } else if (['scheduled', 'starting-soon', 'waiting-session'].includes(current.phase)) {
        if (['starting-soon', 'waiting-session'].includes(current.phase)) {
            buttons.push(
                applyEmoji(
                    new ButtonBuilder()
                        .setCustomId(`evt_start:${current.id}`)
                        .setLabel('Start Event')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(userId !== current.event.hostId || !sessionIsActive()),
                    icons.start
                )
            );
        }
        buttons.push(
            applyEmoji(new ButtonBuilder().setCustomId(`evt_change_time:${current.id}`).setLabel('Change Date/Time').setStyle(ButtonStyle.Secondary), icons.calendar),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_change_partners:${current.id}`).setLabel('Change Partnerships').setStyle(ButtonStyle.Secondary), icons.partnership),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_change_host:${current.id}`).setLabel('Change Host').setStyle(ButtonStyle.Secondary), icons.host),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_cancel:${current.id}`).setLabel('Cancel Event').setStyle(ButtonStyle.Danger), icons.cancel)
        );
    } else if (current.phase === 'active') {
        buttons.push(
            applyEmoji(new ButtonBuilder().setCustomId(`evt_change_partners:${current.id}`).setLabel('Change Partnerships').setStyle(ButtonStyle.Secondary), icons.partnership),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_change_host:${current.id}`).setLabel('Change Host').setStyle(ButtonStyle.Secondary), icons.host),
            applyEmoji(new ButtonBuilder().setCustomId(`evt_cancel:${current.id}`).setLabel('Cancel Event').setStyle(ButtonStyle.Danger), icons.cancel)
        );
    }

    for (const row of splitRows(buttons, 4)) container.addActionRowComponents(row);
    return container;
}

function configureModal(current) {
    const modal = new ModalBuilder().setCustomId(`evt_config_modal:${current.id}`).setTitle('Configure Event');

    const title = new TextInputBuilder()
        .setCustomId('title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setValue(clampText(current.event?.title || `${current.winnerLabel} MSRP Event`, 100));
    const description = new TextInputBuilder()
        .setCustomId('description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setValue(clampText(current.event?.description || '', 1000));
    const date = new TextInputBuilder()
        .setCustomId('date')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(10)
        .setPlaceholder('DD/MM/YYYY');
    const time = new TextInputBuilder()
        .setCustomId('time')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(5)
        .setPlaceholder('19:30');

    modal.addLabelComponents(
        new LabelBuilder().setLabel('Event title').setTextInputComponent(title),
        new LabelBuilder().setLabel('Description').setTextInputComponent(description),
        new LabelBuilder().setLabel('Date').setTextInputComponent(date),
        new LabelBuilder().setLabel('Time').setTextInputComponent(time)
    );
    return modal;
}

function configWizardContainer(eventId, userId, draft, icons) {
    const partnerships = partnershipEntries();
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Finish Event Setup\n\n**Title:** ${draft.title}\n**Date & time:** ${timestamp(draft.startAt)}\n**Host:** ${draft.hostId ? `<@${draft.hostId}>` : 'Select a host below'}\n**Partnerships:** ${partnershipNames(draft.partnershipIds).join(', ') || 'None'}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new UserSelectMenuBuilder()
                    .setCustomId(`evtcfg_host:${eventId}:${userId}`)
                    .setPlaceholder('Select the event host')
                    .setMinValues(1)
                    .setMaxValues(1)
            )
        );

    if (partnerships.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`evtcfg_partners:${eventId}:${userId}`)
            .setPlaceholder('Select partnerships (optional)')
            .setMinValues(1)
            .setMaxValues(Math.min(10, partnerships.length + 1))
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('No partnerships').setValue('__none__'),
                ...partnerships.map(item => new StringSelectMenuOptionBuilder().setLabel(clampText(item.name, 100)).setValue(item.id))
            );
        container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    }

    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                applyEmoji(
                    new ButtonBuilder()
                        .setCustomId(`evtcfg_save:${eventId}:${userId}`)
                        .setLabel('Save Event')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(!draft.hostId),
                    icons.configure
                )
            )
        );
    return container;
}

function dateTimeModal(current) {
    const modal = new ModalBuilder().setCustomId(`evt_time_modal:${current.id}`).setTitle('Change Event Date & Time');
    const date = new TextInputBuilder().setCustomId('date').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder('DD/MM/YYYY');
    const time = new TextInputBuilder().setCustomId('time').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setPlaceholder('19:30');
    modal.addLabelComponents(
        new LabelBuilder().setLabel('Date').setTextInputComponent(date),
        new LabelBuilder().setLabel('Time').setTextInputComponent(time)
    );
    return modal;
}

function addOptionModal(current) {
    const modal = new ModalBuilder().setCustomId(`evt_add_option_modal:${current.id}`).setTitle('Add Event Option');
    const input = new TextInputBuilder().setCustomId('option').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setPlaceholder('Event option');
    modal.addLabelComponents(new LabelBuilder().setLabel('Option name').setTextInputComponent(input));
    return modal;
}

async function cancelEvent(client, current, guild) {
    current.phase = 'cancelled';
    saveData({ current });
    if (current.event?.discordEventId) {
        const scheduled = await guild.scheduledEvents.fetch(current.event.discordEventId).catch(() => null);
        if (scheduled) {
            const targetStatus = scheduled.status === GuildScheduledEventStatus.Active
                ? GuildScheduledEventStatus.Completed
                : GuildScheduledEventStatus.Canceled;
            await scheduled.setStatus(targetStatus).catch(() => {});
        }
    }
    await replaceCurrentCard(client, current, { ping: true });
}

async function startEvent(client, current, guild, voiceChannelId) {
    if (!sessionIsActive()) throw new Error('SESSION_OFFLINE');
    current.phase = 'active';
    current.event.liveVoiceChannelId = voiceChannelId;
    current.event.startedAt = Date.now();
    saveData({ current });
    await setNativeEventStatus(guild, current, GuildScheduledEventStatus.Active);
    await replaceCurrentCard(client, current, { ping: true });
}

async function saveConfiguredEvent(interaction, client, current, draft) {
    current.event = {
        ...current.event,
        title: draft.title,
        description: draft.description,
        startAt: draft.startAt,
        hostId: draft.hostId,
        partnershipIds: draft.partnershipIds || [],
        participantIds: current.event?.participantIds || [],
        discordEventId: current.event?.discordEventId || null,
        liveVoiceChannelId: null,
        startedAt: null
    };
    current.phase = (current.event.startAt - Date.now() <= STARTING_SOON_MS) ? 'starting-soon' : 'scheduled';
    current.lastSessionActive = sessionIsActive();
    saveData({ current });

    let nativeError = null;
    try {
        await createNativeScheduledEvent(interaction.guild, current);
    } catch (error) {
        nativeError = error;
        console.error('[EVENTS] Failed to create Discord scheduled event:', error);
    }

    await replaceCurrentCard(client, current, { ping: current.phase === 'starting-soon' });
    pendingConfig.delete(`${interaction.user.id}:${current.id}`);

    const resultText = nativeError
        ? `✅ Event saved, but Discord's native Scheduled Event could not be created: ${nativeError.message}`
        : '✅ Event saved and the Discord Scheduled Event was created.';
    await interaction.update({
        components: [
            new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(resultText)
            )
        ]
    });
}

async function executeCommand(interaction, client) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'event-vote') return false;

    if (!isEventStaff(interaction.member)) {
        await interaction.reply({ content: '❌ Only the Event Team can create or manage events.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const data = loadData();
    const existing = data.current;
    if (existing && !['cancelled', 'completed'].includes(existing.phase)) {
        await interaction.reply({
            content: '❌ There is already an event vote/event in progress. Finish or cancel it before creating another one.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const endsAtDate = adelaideLocalToDate(
        interaction.options.getString('end-date', true),
        interaction.options.getString('end-time', true)
    );
    if (!endsAtDate || endsAtDate.getTime() <= Date.now()) {
        await interaction.reply({ content: '❌ Enter a valid vote end date/time in the future.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const labels = [];
    for (let i = 1; i <= 5; i += 1) {
        const value = interaction.options.getString(`option-${i}`)?.trim();
        if (value && !labels.some(existingLabel => existingLabel.toLowerCase() === value.toLowerCase())) labels.push(value);
    }
    if (labels.length < 2) {
        await interaction.reply({ content: '❌ A vote needs at least two different options.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const channel = await getEventChannel(client);
    await ensureEventIcons(channel.guild);
    const current = {
        id: makeId('event'),
        phase: 'voting',
        channelId: channel.id,
        messageId: null,
        createdBy: interaction.user.id,
        createdAt: Date.now(),
        vote: {
            message: interaction.options.getString('message', true),
            endsAt: endsAtDate.getTime(),
            options: labels.map(label => ({ id: makeId('opt'), label })),
            votes: {}
        },
        winnerOptionId: null,
        winnerLabel: null,
        tieOptionIds: [],
        event: null
    };

    const icons = getEventIcons(channel.guild);
    const built = buildVoteCard(current, icons);
    const message = await channel.send({
        flags: MessageFlags.IsComponentsV2,
        components: [built.container],
        files: built.files,
        allowedMentions: { parse: [], roles: [EVENT_NOTIFICATION_ROLE_ID], users: [] }
    });
    current.messageId = message.id;
    saveData({ current });

    await interaction.reply({
        content: `✅ Event vote created in <#${EVENT_CHANNEL_ID}>.`,
        flags: MessageFlags.Ephemeral
    });
    return true;
}

async function showStaffActions(interaction, current) {
    if (!isEventStaff(interaction.member)) {
        await interaction.reply({ content: '❌ Only the Event Team can manage events.', flags: MessageFlags.Ephemeral });
        return;
    }
    const icons = getEventIcons(interaction.guild);
    await interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [staffPanel(current, icons, interaction.user.id)]
    });
}

async function handleInteraction(interaction, client) {
    if (!interaction.customId?.startsWith('evt')) return false;

    const data = loadData();
    const current = data.current;
    if (!current) {
        if (interaction.isRepliable()) await interaction.reply({ content: '❌ This event no longer exists.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
    }

    const [action, eventId, extra] = interaction.customId.split(':');
    if (eventId && eventId !== current.id) {
        if (interaction.isRepliable()) await interaction.reply({ content: '❌ This is an old event control.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
    }

    if (action === 'evt_status') {
        await interaction.deferUpdate();
        return true;
    }

    if (action === 'evt_vote' && interaction.isButton()) {
        if (current.phase !== 'voting' || Date.now() >= current.vote.endsAt) {
            await interaction.reply({ content: '❌ Voting has ended.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const optionId = extra;
        if (!current.vote.options.some(option => option.id === optionId)) {
            await interaction.reply({ content: '❌ That option no longer exists.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const previous = current.vote.votes[interaction.user.id];
        if (previous === optionId) delete current.vote.votes[interaction.user.id];
        else current.vote.votes[interaction.user.id] = optionId;
        saveData({ current });
        await editCurrentCard(client, current);
        await interaction.reply({
            content: previous === optionId ? '✅ Your vote was removed.' : previous ? '✅ Your vote was changed.' : '✅ Your vote was added.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (action === 'evt_staff') {
        await showStaffActions(interaction, current);
        return true;
    }

    if (['evt_end_poll','evt_add_option','evt_remove_option','evt_cancel','evt_choose_winner','evt_configure','evt_change_time','evt_change_partners','evt_change_host','evt_start'].includes(action) && !isEventStaff(interaction.member)) {
        await interaction.reply({ content: '❌ Only the Event Team can manage events.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'evt_end_poll') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await finishVote(client, current);
        await interaction.editReply('✅ Poll ended.');
        return true;
    }

    if (action === 'evt_cancel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await cancelEvent(client, current, interaction.guild);
        await interaction.editReply('✅ Event cancelled.');
        return true;
    }

    if (action === 'evt_add_option') {
        if (current.phase !== 'voting') {
            await interaction.reply({ content: '❌ Options can only be changed while voting is open.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (current.vote.options.length >= 5) {
            await interaction.reply({ content: '❌ This poll already has the maximum of 5 options.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(addOptionModal(current));
        return true;
    }

    if (action === 'evt_add_option_modal' && interaction.isModalSubmit()) {
        const label = interaction.fields.getTextInputValue('option').trim();
        if (current.vote.options.some(option => option.label.toLowerCase() === label.toLowerCase())) {
            await interaction.reply({ content: '❌ That option already exists.', flags: MessageFlags.Ephemeral });
            return true;
        }
        current.vote.options.push({ id: makeId('opt'), label });
        saveData({ current });
        await editCurrentCard(client, current);
        await interaction.reply({ content: `✅ Added **${label}**.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'evt_remove_option') {
        if (current.phase !== 'voting' || current.vote.options.length <= 2) {
            await interaction.reply({ content: '❌ A vote must keep at least two options.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`evt_remove_option_select:${current.id}`)
            .setPlaceholder('Select an option to remove')
            .addOptions(current.vote.options.map(option => new StringSelectMenuOptionBuilder().setLabel(option.label).setValue(option.id)));
        await interaction.reply({
            content: 'Select the option to remove:',
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (action === 'evt_remove_option_select' && interaction.isStringSelectMenu()) {
        const removeId = interaction.values[0];
        const removed = current.vote.options.find(option => option.id === removeId);
        current.vote.options = current.vote.options.filter(option => option.id !== removeId);
        for (const [userId, optionId] of Object.entries(current.vote.votes)) {
            if (optionId === removeId) delete current.vote.votes[userId];
        }
        saveData({ current });
        await editCurrentCard(client, current);
        await interaction.update({ content: `✅ Removed **${removed?.label || 'option'}**. Votes for that option were cleared.`, components: [] });
        return true;
    }

    if (action === 'evt_choose_winner') {
        const optionIds = current.tieOptionIds?.length ? current.tieOptionIds : current.vote.options.map(option => option.id);
        const options = current.vote.options.filter(option => optionIds.includes(option.id));
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`evt_choose_winner_select:${current.id}`)
            .setPlaceholder('Select the winning event')
            .addOptions(options.map(option => new StringSelectMenuOptionBuilder().setLabel(option.label).setValue(option.id)));
        await interaction.reply({ content: 'Choose the event that should proceed:', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'evt_choose_winner_select' && interaction.isStringSelectMenu()) {
        current.phase = 'voting';
        saveData({ current });
        await interaction.deferUpdate();
        await finishVote(client, current, interaction.values[0]);
        await interaction.editReply({ content: '✅ Winner selected.', components: [] }).catch(() => {});
        return true;
    }

    if (action === 'evt_configure') {
        await interaction.showModal(configureModal(current));
        return true;
    }

    if (action === 'evt_config_modal' && interaction.isModalSubmit()) {
        const start = adelaideLocalToDate(interaction.fields.getTextInputValue('date'), interaction.fields.getTextInputValue('time'));
        if (!start || start.getTime() <= Date.now()) {
            await interaction.reply({ content: '❌ Enter a valid event date/time in the future.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const key = `${interaction.user.id}:${current.id}`;
        const draft = {
            title: interaction.fields.getTextInputValue('title').trim(),
            description: interaction.fields.getTextInputValue('description').trim(),
            startAt: start.getTime(),
            hostId: null,
            partnershipIds: []
        };
        pendingConfig.set(key, draft);
        const icons = getEventIcons(interaction.guild);
        await interaction.reply({
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            components: [configWizardContainer(current.id, interaction.user.id, draft, icons)]
        });
        return true;
    }

    if (action === 'evtcfg_host' && interaction.isUserSelectMenu()) {
        if (extra !== interaction.user.id) {
            await interaction.reply({ content: '❌ This setup belongs to another staff member.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const key = `${interaction.user.id}:${current.id}`;
        const draft = pendingConfig.get(key);
        if (!draft) {
            await interaction.reply({ content: '❌ This setup expired. Open Configure Event again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        draft.hostId = interaction.values[0];
        pendingConfig.set(key, draft);
        const icons = getEventIcons(interaction.guild);
        await interaction.update({ components: [configWizardContainer(current.id, interaction.user.id, draft, icons)] });
        return true;
    }

    if (action === 'evtcfg_partners' && interaction.isStringSelectMenu()) {
        if (extra !== interaction.user.id) {
            await interaction.reply({ content: '❌ This setup belongs to another staff member.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const key = `${interaction.user.id}:${current.id}`;
        const draft = pendingConfig.get(key);
        if (!draft) {
            await interaction.reply({ content: '❌ This setup expired. Open Configure Event again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        draft.partnershipIds = interaction.values.includes('__none__') ? [] : interaction.values;
        pendingConfig.set(key, draft);
        const icons = getEventIcons(interaction.guild);
        await interaction.update({ components: [configWizardContainer(current.id, interaction.user.id, draft, icons)] });
        return true;
    }

    if (action === 'evtcfg_save' && interaction.isButton()) {
        if (extra !== interaction.user.id) {
            await interaction.reply({ content: '❌ This setup belongs to another staff member.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const key = `${interaction.user.id}:${current.id}`;
        const draft = pendingConfig.get(key);
        if (!draft?.hostId) {
            await interaction.reply({ content: '❌ Select a host first.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await saveConfiguredEvent(interaction, client, current, draft);
        return true;
    }

    if (action === 'evt_change_time') {
        await interaction.showModal(dateTimeModal(current));
        return true;
    }

    if (action === 'evt_time_modal' && interaction.isModalSubmit()) {
        const start = adelaideLocalToDate(interaction.fields.getTextInputValue('date'), interaction.fields.getTextInputValue('time'));
        if (!start || start.getTime() <= Date.now()) {
            await interaction.reply({ content: '❌ Enter a valid future date/time.', flags: MessageFlags.Ephemeral });
            return true;
        }
        current.event.startAt = start.getTime();
        current.phase = (current.event.startAt - Date.now() <= STARTING_SOON_MS) ? 'starting-soon' : 'scheduled';
        saveData({ current });
        let warning = '';
        try { await createNativeScheduledEvent(interaction.guild, current); }
        catch (error) { warning = ` Discord event update failed: ${error.message}`; }
        await replaceCurrentCard(client, current, { ping: current.phase === 'starting-soon' });
        await interaction.reply({ content: `✅ Date/time updated.${warning}`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'evt_change_host') {
        const menu = new UserSelectMenuBuilder().setCustomId(`evt_change_host_select:${current.id}`).setPlaceholder('Select the new host').setMinValues(1).setMaxValues(1);
        await interaction.reply({ content: 'Select the new event host:', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'evt_change_host_select' && interaction.isUserSelectMenu()) {
        current.event.hostId = interaction.values[0];
        saveData({ current });
        try { await createNativeScheduledEvent(interaction.guild, current); } catch {}
        await editCurrentCard(client, current);
        await interaction.update({ content: `✅ Host changed to <@${current.event.hostId}>.`, components: [], allowedMentions: { users: [] } });
        return true;
    }

    if (action === 'evt_change_partners') {
        const partnerships = partnershipEntries();
        if (!partnerships.length) {
            current.event.partnershipIds = [];
            saveData({ current });
            try { await createNativeScheduledEvent(interaction.guild, current); } catch {}
            await editCurrentCard(client, current);
            await interaction.reply({ content: '✅ There are no configured dashboard partnerships, so partnerships were cleared.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`evt_change_partners_select:${current.id}`)
            .setPlaceholder('Select partnerships, or None')
            .setMinValues(1)
            .setMaxValues(Math.min(10, partnerships.length + 1))
            .addOptions(
                new StringSelectMenuOptionBuilder().setLabel('No partnerships').setValue('__none__'),
                ...partnerships.map(item => new StringSelectMenuOptionBuilder().setLabel(clampText(item.name, 100)).setValue(item.id))
            );
        await interaction.reply({ content: 'Select the event partnerships:', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'evt_change_partners_select' && interaction.isStringSelectMenu()) {
        current.event.partnershipIds = interaction.values.includes('__none__') ? [] : interaction.values;
        saveData({ current });
        try { await createNativeScheduledEvent(interaction.guild, current); } catch {}
        await editCurrentCard(client, current);
        await interaction.update({ content: '✅ Partnerships updated.', components: [] });
        return true;
    }

    if (action === 'evt_participate') {
        if (!current.event?.startAt) {
            await interaction.reply({ content: '❌ This event is not configured yet.', flags: MessageFlags.Ephemeral });
            return true;
        }
        current.event.participantIds ||= [];
        if (!current.event.participantIds.includes(interaction.user.id)) current.event.participantIds.push(interaction.user.id);
        saveData({ current });
        await editCurrentCard(client, current);
        const eventUrl = eventDiscordUrl(interaction.guildId, current.event.discordEventId);
        const row = eventUrl
            ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Open Discord Event').setStyle(ButtonStyle.Link).setURL(eventUrl))]
            : [];
        await interaction.reply({
            content: eventUrl
                ? '✅ You are registered as a participant. Use **Open Discord Event** to also mark yourself Interested for Discord reminders.'
                : '✅ You are registered as a participant.',
            components: row,
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (action === 'evt_start') {
        if (interaction.user.id !== current.event?.hostId) {
            await interaction.reply({ content: '❌ Only the event host can start the event.', flags: MessageFlags.Ephemeral });
            return true;
        }
        if (!sessionIsActive()) {
            await interaction.reply({
                content: '❌ **Start Event is locked because MSRP is not currently SSU.** A normal session must be active before this event can be started.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        const menu = new ChannelSelectMenuBuilder()
            .setCustomId(`evt_start_channel:${current.id}`)
            .setPlaceholder('Select the event voice channel')
            .setMinValues(1)
            .setMaxValues(1)
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice);
        await interaction.reply({ content: 'Select the voice/stage channel participants should join:', components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'evt_start_channel' && interaction.isChannelSelectMenu()) {
        if (interaction.user.id !== current.event?.hostId) {
            await interaction.reply({ content: '❌ Only the event host can start the event.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.deferUpdate();
        try {
            await startEvent(client, current, interaction.guild, interaction.values[0]);
            await interaction.editReply({ content: '✅ Event started.', components: [] });
        } catch (error) {
            await interaction.editReply({
                content: error.message === 'SESSION_OFFLINE'
                    ? '❌ **Start Event is locked because MSRP is not currently SSU.** A normal session must be active before this event can be started.'
                    : `❌ Could not start event: ${error.message}`,
                components: []
            });
        }
        return true;
    }

    if (action === 'evt_join_server') {
        if (!sessionIsActive()) {
            await interaction.reply({ content: '❌ The MSRP session is currently offline.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.reply({
            content: 'The event is live — use the button below to join MSRP.',
            components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Join MSRP').setStyle(ButtonStyle.Link).setURL(joinUrl()))],
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    return false;
}

async function monitorTick(client) {
    if (monitorBusy) return;
    monitorBusy = true;
    try {
        const data = loadData();
        const current = data.current;
        if (!current || ['cancelled', 'completed', 'draft', 'tie'].includes(current.phase)) return;
        const now = Date.now();

        if (current.phase === 'voting' && now >= current.vote.endsAt) {
            await finishVote(client, current);
            return;
        }

        if (current.phase === 'scheduled' && current.event?.startAt && now >= current.event.startAt - STARTING_SOON_MS) {
            current.phase = 'starting-soon';
            current.lastSessionActive = sessionIsActive();
            saveData({ current });
            await replaceCurrentCard(client, current, { ping: true });
            return;
        }

        if (current.phase === 'scheduled') {
            const previous = current.lastSessionActive;
            const next = sessionIsActive();
            if (previous !== next) {
                current.lastSessionActive = next;
                saveData({ current });
                await editCurrentCard(client, current);
            }
            return;
        }

        if (current.phase === 'starting-soon') {
            const previous = current.lastSessionActive;
            const next = sessionIsActive();

            // Once the scheduled time has arrived, an event may not start
            // until the normal MSRP session is actually SSU. Show a dedicated
            // waiting card rather than leaving an expired Starting Soon card.
            if (current.event?.startAt && now >= current.event.startAt && !next) {
                current.phase = 'waiting-session';
                current.lastSessionActive = false;
                saveData({ current });
                await replaceCurrentCard(client, current, { ping: false });
                return;
            }

            if (previous !== next) {
                current.lastSessionActive = next;
                saveData({ current });
                await editCurrentCard(client, current);
            }
            return;
        }

        if (current.phase === 'waiting-session') {
            // The moment a normal session becomes SSU, return to the
            // start-ready card. Only the configured host can start it.
            if (sessionIsActive()) {
                current.phase = 'starting-soon';
                current.lastSessionActive = true;
                saveData({ current });
                await replaceCurrentCard(client, current, { ping: false });
            }
            return;
        }

        if (current.phase === 'active') {
            const expectedEnd = current.event?.startAt ? current.event.startAt + SIX_HOURS_MS : null;
            if (expectedEnd && now >= expectedEnd) {
                current.phase = 'completed';
                saveData({ current });
                await setNativeEventStatus((await getEventChannel(client)).guild, current, GuildScheduledEventStatus.Completed);
                await replaceCurrentCard(client, current, { ping: false });
                return;
            }

            const previous = current.lastSessionActive;
            const next = sessionIsActive();
            if (previous !== next) {
                current.lastSessionActive = next;
                saveData({ current });
                await editCurrentCard(client, current);
            }
        }
    } catch (error) {
        console.error('[EVENTS MONITOR ERROR]', error);
    } finally {
        monitorBusy = false;
    }
}

function startEventMonitor(client) {
    if (monitorStarted) return;
    monitorStarted = true;
    setInterval(() => void monitorTick(client), MONITOR_INTERVAL_MS);
    setTimeout(() => void monitorTick(client), 3_000);
    console.log('[EVENTS] Event lifecycle monitor started.');
}

async function handleAutocomplete() {
    return false;
}

module.exports = {
    commands,
    executeCommand,
    handleInteraction,
    handleAutocomplete,
    startEventMonitor
};
