const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    GuildScheduledEventEntityType,
    GuildScheduledEventPrivacyLevel,
    GuildScheduledEventStatus,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SlashCommandBuilder,
    TextDisplayBuilder
} = require('discord.js');

const { loadData, saveData, makeId } = require('./eventData');
const { ensureEventIcons, getEventIcons } = require('./eventIcons');
const { getState } = require('../sessions/sessionState');
const sessionConfig = require('../sessions/sessionConfig');

const BOTTOM_IMAGE = path.join(__dirname, '..', 'images', 'image.png');
const ADELAIDE_TIME_ZONE = 'Australia/Adelaide';
const EVENT_MONITOR_INTERVAL_MS = 20_000;

const commands = [
    new SlashCommandBuilder()
        .setName('event-create')
        .setDescription('Creates a public MSRP event card.')
        .addStringOption(option => option
            .setName('name')
            .setDescription('Event name.')
            .setRequired(true)
            .setMaxLength(100))
        .addStringOption(option => option
            .setName('date')
            .setDescription('Optional date: DD/MM/YYYY or YYYY-MM-DD.')
            .setMaxLength(10))
        .addStringOption(option => option
            .setName('time')
            .setDescription('Optional time in 24-hour format, e.g. 19:30.')
            .setMaxLength(5))
        .addStringOption(option => option
            .setName('partnerships')
            .setDescription('Optional partnerships involved in the event.')
            .setMaxLength(1000))
        .addStringOption(option => option
            .setName('links')
            .setDescription('Optional links. Separate multiple links with spaces.')
            .setMaxLength(1500))
        .addStringOption(option => option
            .setName('message')
            .setDescription('Optional custom event message. Formatting is preserved.')
            .setMaxLength(4000)),

    new SlashCommandBuilder()
        .setName('event-schedule')
        .setDescription('Adds or changes the date/time for an event.')
        .addStringOption(option => option
            .setName('event')
            .setDescription('Event to schedule.')
            .setRequired(true)
            .setAutocomplete(true))
        .addStringOption(option => option
            .setName('date')
            .setDescription('Date: DD/MM/YYYY or YYYY-MM-DD.')
            .setRequired(true)
            .setMaxLength(10))
        .addStringOption(option => option
            .setName('time')
            .setDescription('Time in 24-hour format, e.g. 19:30.')
            .setRequired(true)
            .setMaxLength(5)),

    new SlashCommandBuilder()
        .setName('event-start')
        .setDescription('Starts an MSRP event now. A session must be running.')
        .addStringOption(option => option
            .setName('event')
            .setDescription('Event to start.')
            .setRequired(true)
            .setAutocomplete(true)),

    new SlashCommandBuilder()
        .setName('event-end')
        .setDescription('Ends a live MSRP event.')
        .addStringOption(option => option
            .setName('event')
            .setDescription('Event to end.')
            .setRequired(true)
            .setAutocomplete(true)),

    new SlashCommandBuilder()
        .setName('event-cancel')
        .setDescription('Cancels an MSRP event.')
        .addStringOption(option => option
            .setName('event')
            .setDescription('Event to cancel.')
            .setRequired(true)
            .setAutocomplete(true)),

    new SlashCommandBuilder()
        .setName('event-vote')
        .setDescription('Creates a public vote for an event or event idea.')
        .addStringOption(option => option
            .setName('question')
            .setDescription('Vote question.')
            .setRequired(true)
            .setMaxLength(200))
        .addStringOption(option => option
            .setName('option-1')
            .setDescription('First option.')
            .setRequired(true)
            .setMaxLength(80))
        .addStringOption(option => option
            .setName('option-2')
            .setDescription('Second option.')
            .setRequired(true)
            .setMaxLength(80))
        .addStringOption(option => option.setName('option-3').setDescription('Third option.').setMaxLength(80))
        .addStringOption(option => option.setName('option-4').setDescription('Fourth option.').setMaxLength(80))
        .addStringOption(option => option.setName('option-5').setDescription('Fifth option.').setMaxLength(80)),

    new SlashCommandBuilder()
        .setName('event-vote-end')
        .setDescription('Ends an active event vote and shows the final result.')
        .addStringOption(option => option
            .setName('vote')
            .setDescription('Vote to end.')
            .setRequired(true)
            .setAutocomplete(true))
];

function applyEmoji(component, emoji) {
    if (emoji) component.setEmoji(emoji);
    return component;
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
    if (match) {
        return { year: Number(match[3]), month: Number(match[2]), day: Number(match[1]) };
    }

    match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
    }

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
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    });

    const parts = Object.fromEntries(
        formatter.formatToParts(date)
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, Number(part.value)])
    );

    return parts;
}

function adelaideLocalToDate(dateInput, timeInput) {
    const date = parseDateString(dateInput);
    const time = parseTimeString(timeInput);
    if (!date || !time) return null;

    const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
    let guess = localAsUtc;

    for (let i = 0; i < 3; i += 1) {
        const parts = zonedParts(new Date(guess), ADELAIDE_TIME_ZONE);
        const represented = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second || 0
        );
        const offset = represented - guess;
        guess = localAsUtc - offset;
    }

    const result = new Date(guess);
    return Number.isNaN(result.getTime()) ? null : result;
}

function parseLinks(value) {
    if (!value) return [];
    return String(value)
        .split(/\s+/)
        .map(item => item.trim())
        .filter(Boolean)
        .filter(item => {
            try {
                const url = new URL(item);
                return ['http:', 'https:'].includes(url.protocol);
            } catch {
                return false;
            }
        })
        .slice(0, 8);
}

function truncate(text, max) {
    const value = String(text || '');
    return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function discordTimestamp(ms) {
    if (!ms) return null;
    const seconds = Math.floor(ms / 1000);
    return `<t:${seconds}:F> (<t:${seconds}:R>)`;
}

function eventStatusLabel(event) {
    if (event.status === 'live') return 'LIVE';
    if (event.status === 'paused-session') return 'Paused — Session Offline';
    if (event.status === 'waiting-session') return 'Waiting for Session';
    if (event.status === 'completed') return 'Completed';
    if (event.status === 'cancelled') return 'Cancelled';
    return 'Upcoming';
}

function eventInfoText(event) {
    const lines = [
        `## ${event.name}`
    ];

    if (event.message) {
        lines.push('', event.message);
    }

    lines.push('', `**Status:** ${eventStatusLabel(event)}`);
    lines.push(`**When:** ${event.startAt ? discordTimestamp(event.startAt) : 'To be announced'}`);

    if (event.partnerships) {
        lines.push(`**Partnerships:** ${event.partnerships}`);
    }

    if (event.links?.length) {
        lines.push(`**Links:** ${event.links.join(' • ')}`);
    }

    if (event.scheduledEventUrl) {
        lines.push(`**Discord Event:** ${event.scheduledEventUrl}`);
    }

    if (event.status === 'waiting-session' || event.status === 'paused-session') {
        lines.push('', 'This event cannot run while the MSRP server is shut down. It will become available when a session is active.');
    }

    return lines.join('\n');
}

function buildEventCard(event, icons) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(truncate(eventInfoText(event), 3800))
        )
        .addSeparatorComponents(new SeparatorBuilder());

    const row = new ActionRowBuilder();
    const joinEnabled = event.status === 'live' && sessionIsActive();

    if (joinEnabled) {
        row.addComponents(
            applyEmoji(
                new ButtonBuilder()
                    .setLabel('Join Event')
                    .setStyle(ButtonStyle.Link)
                    .setURL(joinUrl()),
                icons.join
            )
        );
    } else {
        row.addComponents(
            applyEmoji(
                new ButtonBuilder()
                    .setCustomId(`event_join_disabled:${event.id}`)
                    .setLabel('Join Event')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                icons.join
            )
        );
    }

    if (event.scheduledEventUrl) {
        row.addComponents(
            applyEmoji(
                new ButtonBuilder()
                    .setLabel('Discord Event')
                    .setStyle(ButtonStyle.Link)
                    .setURL(event.scheduledEventUrl),
                icons.calendar
            )
        );
    }

    container.addActionRowComponents(row);
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL('attachment://image.png')
        )
    );

    return container;
}

function voteCounts(vote) {
    const counts = Object.fromEntries(vote.options.map(option => [option.id, 0]));
    for (const optionId of Object.values(vote.votes || {})) {
        if (Object.prototype.hasOwnProperty.call(counts, optionId)) counts[optionId] += 1;
    }
    return counts;
}

function buildVoteCard(vote, icons) {
    const counts = voteCounts(vote);
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const lines = [
        '## Event Vote',
        vote.question,
        '',
        ...vote.options.map((option, index) => {
            const count = counts[option.id] || 0;
            const percentage = total ? Math.round((count / total) * 100) : 0;
            return `**${index + 1}. ${option.label}** — ${count} vote${count === 1 ? '' : 's'} (${percentage}%)`;
        })
    ];

    if (!vote.active) {
        const max = Math.max(...Object.values(counts), 0);
        const winners = vote.options.filter(option => (counts[option.id] || 0) === max && max > 0);
        lines.push('', winners.length
            ? `**Final result:** ${winners.map(item => item.label).join(' / ')}`
            : '**Final result:** No votes were cast.');
    } else {
        lines.push('', 'Select an option below. Selecting your current choice again removes your vote.');
    }

    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
        .addSeparatorComponents(new SeparatorBuilder());

    const buttons = vote.options.map((option, index) =>
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(`event_vote:${vote.id}:${option.id}`)
                .setLabel(truncate(`${index + 1}. ${option.label}`, 80))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!vote.active),
            icons.vote
        )
    );

    for (let index = 0; index < buttons.length; index += 5) {
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(buttons.slice(index, index + 5))
        );
    }

    container.addSeparatorComponents(new SeparatorBuilder());
    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL('attachment://image.png')
        )
    );

    return container;
}

async function createNativeScheduledEvent(guild, event) {
    if (!event.startAt) return null;

    const scheduledStart = new Date(event.startAt);
    const scheduledEnd = new Date(event.startAt + (2 * 60 * 60 * 1000));

    const descriptionParts = [];
    if (event.message) descriptionParts.push(event.message);
    if (event.partnerships) descriptionParts.push(`Partnerships: ${event.partnerships}`);
    if (event.links?.length) descriptionParts.push(`Links: ${event.links.join(' ')}`);

    try {
        const scheduled = await guild.scheduledEvents.create({
            name: truncate(event.name, 100),
            description: truncate(descriptionParts.join('\n\n') || 'Melbourne State Roleplay event.', 1000),
            entityType: GuildScheduledEventEntityType.External,
            privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
            scheduledStartTime: scheduledStart,
            scheduledEndTime: scheduledEnd,
            entityMetadata: {
                location: joinUrl()
            },
            reason: `MSRP event created by bot (${event.id})`
        });

        event.scheduledEventId = scheduled.id;
        event.scheduledEventUrl = scheduled.url;
        return scheduled;
    } catch (error) {
        console.warn('[EVENTS] Could not create Discord scheduled event:', error?.message || error);
        event.scheduledEventError = String(error?.message || error);
        return null;
    }
}

async function editNativeScheduledStatus(guild, event, status) {
    if (!event.scheduledEventId) return;
    try {
        const scheduled = await guild.scheduledEvents.fetch(event.scheduledEventId);
        if (scheduled) await scheduled.edit({ status });
    } catch (error) {
        console.warn('[EVENTS] Could not update Discord scheduled event:', error?.message || error);
    }
}

async function updateEventMessage(client, event) {
    if (!event.channelId || !event.messageId) return;
    const channel = await client.channels.fetch(event.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(event.messageId).catch(() => null);
    if (!message) return;

    const icons = getEventIcons(channel.guild);
    await message.edit({
        components: [buildEventCard(event, icons)],
        allowedMentions: { parse: [] }
    }).catch(error => console.warn('[EVENTS] Event card update failed:', error?.message || error));
}

async function updateVoteMessage(client, vote) {
    if (!vote.channelId || !vote.messageId) return;
    const channel = await client.channels.fetch(vote.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(vote.messageId).catch(() => null);
    if (!message) return;

    const icons = getEventIcons(channel.guild);
    await message.edit({
        components: [buildVoteCard(vote, icons)],
        allowedMentions: { parse: [] }
    }).catch(error => console.warn('[EVENTS] Vote card update failed:', error?.message || error));
}

async function startEvent(client, event, { automatic = false } = {}) {
    if (!sessionIsActive()) {
        event.status = 'waiting-session';
        saveCurrentEvent(event);
        await updateEventMessage(client, event);
        return false;
    }

    event.status = 'live';
    event.startedAt = Date.now();
    event.startedAutomatically = automatic;
    saveCurrentEvent(event);

    const guild = client.guilds.cache.get(event.guildId);
    if (guild && event.scheduledEventId) {
        await editNativeScheduledStatus(guild, event, GuildScheduledEventStatus.Active);
    }

    await updateEventMessage(client, event);
    return true;
}

function saveCurrentEvent(updatedEvent) {
    const data = loadData();
    const index = data.events.findIndex(item => item.id === updatedEvent.id);
    if (index !== -1) data.events[index] = updatedEvent;
    saveData(data);
}

async function endEvent(client, event, status = 'completed') {
    event.status = status;
    event.endedAt = Date.now();
    saveCurrentEvent(event);

    const guild = client.guilds.cache.get(event.guildId);
    if (guild && event.scheduledEventId) {
        await editNativeScheduledStatus(
            guild,
            event,
            status === 'cancelled'
                ? GuildScheduledEventStatus.Canceled
                : GuildScheduledEventStatus.Completed
        );
    }

    await updateEventMessage(client, event);
}

function eventChoices(data, query) {
    const q = String(query || '').toLowerCase();
    return data.events
        .filter(event => !['completed', 'cancelled'].includes(event.status))
        .filter(event => !q || event.name.toLowerCase().includes(q))
        .slice(0, 25)
        .map(event => ({ name: truncate(`${event.name} — ${eventStatusLabel(event)}`, 100), value: event.id }));
}

function voteChoices(data, query) {
    const q = String(query || '').toLowerCase();
    return data.votes
        .filter(vote => vote.active)
        .filter(vote => !q || vote.question.toLowerCase().includes(q))
        .slice(0, 25)
        .map(vote => ({ name: truncate(vote.question, 100), value: vote.id }));
}

async function handleAutocomplete(interaction) {
    if (!interaction.isAutocomplete()) return false;

    const focused = interaction.options.getFocused(true);
    const eventCommands = new Set(['event-schedule', 'event-start', 'event-end', 'event-cancel']);

    if (eventCommands.has(interaction.commandName) && focused.name === 'event') {
        const data = loadData();
        await interaction.respond(eventChoices(data, focused.value)).catch(() => {});
        return true;
    }

    if (interaction.commandName === 'event-vote-end' && focused.name === 'vote') {
        const data = loadData();
        await interaction.respond(voteChoices(data, focused.value)).catch(() => {});
        return true;
    }

    return false;
}

async function executeCommand(interaction, client) {
    const name = interaction.commandName;
    if (!name.startsWith('event-')) return false;

    const data = loadData();

    if (name === 'event-create') {
        const date = interaction.options.getString('date');
        const time = interaction.options.getString('time');

        if ((date && !time) || (!date && time)) {
            await interaction.reply({
                content: '❌ Date and time need to be supplied together. You can also leave both blank and schedule it later.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        let startAt = null;
        if (date && time) {
            const parsed = adelaideLocalToDate(date, time);
            if (!parsed || parsed.getTime() <= Date.now() + 60_000) {
                await interaction.reply({
                    content: '❌ I could not read that date/time, or it is not in the future. Use DD/MM/YYYY and 24-hour time such as 19:30.',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }
            startAt = parsed.getTime();
        }

        const event = {
            id: makeId('event'),
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            messageId: null,
            name: interaction.options.getString('name', true).trim(),
            message: interaction.options.getString('message')?.trim() || null,
            partnerships: interaction.options.getString('partnerships')?.trim() || null,
            links: parseLinks(interaction.options.getString('links')),
            date: date || null,
            time: time || null,
            startAt,
            status: 'upcoming',
            scheduledEventId: null,
            scheduledEventUrl: null,
            createdBy: interaction.user.id,
            createdAt: Date.now()
        };

        const icons = await ensureEventIcons(interaction.guild);
        if (startAt) await createNativeScheduledEvent(interaction.guild, event);

        const message = await interaction.channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [buildEventCard(event, icons)],
            files: [{ attachment: BOTTOM_IMAGE, name: 'image.png' }],
            allowedMentions: { parse: [] }
        });

        event.messageId = message.id;
        data.events.push(event);
        saveData(data);

        const nativeNote = startAt
            ? (event.scheduledEventId
                ? ' A Discord Scheduled Event was created too.'
                : ' The public card was created, but Discord would not let the bot create the native Scheduled Event; check the bot’s Manage Events permission.')
            : ' No date/time was supplied, so the native Discord Scheduled Event will be created when you use `/event-schedule`.';

        await interaction.reply({
            content: `✅ **${event.name}** created.${nativeNote}`,
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (name === 'event-schedule') {
        const id = interaction.options.getString('event', true);
        const event = data.events.find(item => item.id === id);
        if (!event) {
            await interaction.reply({ content: '❌ That event no longer exists.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const date = interaction.options.getString('date', true);
        const time = interaction.options.getString('time', true);
        const parsed = adelaideLocalToDate(date, time);
        if (!parsed || parsed.getTime() <= Date.now() + 60_000) {
            await interaction.reply({
                content: '❌ Invalid/past date and time. Use DD/MM/YYYY and 24-hour time such as 19:30.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        event.date = date;
        event.time = time;
        event.startAt = parsed.getTime();
        event.status = 'upcoming';

        if (event.scheduledEventId) {
            try {
                const scheduled = await interaction.guild.scheduledEvents.fetch(event.scheduledEventId);
                if (scheduled) {
                    await scheduled.edit({
                        scheduledStartTime: parsed,
                        scheduledEndTime: new Date(parsed.getTime() + 2 * 60 * 60 * 1000)
                    });
                    event.scheduledEventUrl = scheduled.url;
                }
            } catch {
                event.scheduledEventId = null;
                event.scheduledEventUrl = null;
                await createNativeScheduledEvent(interaction.guild, event);
            }
        } else {
            await createNativeScheduledEvent(interaction.guild, event);
        }

        saveData(data);
        await updateEventMessage(client, event);
        await interaction.reply({ content: `✅ **${event.name}** scheduled for ${discordTimestamp(event.startAt)}.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (name === 'event-start') {
        const id = interaction.options.getString('event', true);
        const event = data.events.find(item => item.id === id);
        if (!event) {
            await interaction.reply({ content: '❌ That event no longer exists.', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (!sessionIsActive()) {
            event.status = 'waiting-session';
            saveData(data);
            await updateEventMessage(client, event);
            await interaction.reply({
                content: '❌ The MSRP server is currently shut down. The event has been marked **Waiting for Session** and cannot be started yet.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }

        await startEvent(client, event);
        await interaction.reply({ content: `✅ **${event.name}** is now live and its Join Event button is active.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (name === 'event-end' || name === 'event-cancel') {
        const id = interaction.options.getString('event', true);
        const event = data.events.find(item => item.id === id);
        if (!event) {
            await interaction.reply({ content: '❌ That event no longer exists.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const cancelled = name === 'event-cancel';
        await endEvent(client, event, cancelled ? 'cancelled' : 'completed');
        await interaction.reply({
            content: `✅ **${event.name}** ${cancelled ? 'cancelled' : 'ended'}.`,
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (name === 'event-vote') {
        const options = [];
        for (let index = 1; index <= 5; index += 1) {
            const value = interaction.options.getString(`option-${index}`);
            if (value?.trim()) {
                options.push({ id: `option_${index}`, label: value.trim() });
            }
        }

        const vote = {
            id: makeId('vote'),
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            messageId: null,
            question: interaction.options.getString('question', true).trim(),
            options,
            votes: {},
            active: true,
            createdBy: interaction.user.id,
            createdAt: Date.now()
        };

        const icons = await ensureEventIcons(interaction.guild);
        const message = await interaction.channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [buildVoteCard(vote, icons)],
            files: [{ attachment: BOTTOM_IMAGE, name: 'image.png' }],
            allowedMentions: { parse: [] }
        });

        vote.messageId = message.id;
        data.votes.push(vote);
        saveData(data);

        await interaction.reply({ content: '✅ Event vote posted.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (name === 'event-vote-end') {
        const id = interaction.options.getString('vote', true);
        const vote = data.votes.find(item => item.id === id);
        if (!vote) {
            await interaction.reply({ content: '❌ That vote no longer exists.', flags: MessageFlags.Ephemeral });
            return true;
        }

        vote.active = false;
        vote.endedAt = Date.now();
        saveData(data);
        await updateVoteMessage(client, vote);
        await interaction.reply({ content: '✅ Event vote ended and final results are now displayed.', flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function handleInteraction(interaction, client) {
    if (!interaction.isButton()) return false;
    if (!interaction.customId.startsWith('event_vote:')) return false;

    const [, voteId, optionId] = interaction.customId.split(':');
    const data = loadData();
    const vote = data.votes.find(item => item.id === voteId);

    if (!vote || !vote.active) {
        await interaction.reply({ content: '❌ This vote has ended.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (!vote.options.some(option => option.id === optionId)) {
        await interaction.reply({ content: '❌ That vote option no longer exists.', flags: MessageFlags.Ephemeral });
        return true;
    }

    const current = vote.votes?.[interaction.user.id] || null;
    vote.votes = vote.votes || {};

    let confirmation;
    if (current === optionId) {
        delete vote.votes[interaction.user.id];
        confirmation = '✅ Your vote has been removed.';
    } else {
        vote.votes[interaction.user.id] = optionId;
        const option = vote.options.find(item => item.id === optionId);
        confirmation = `✅ Your vote is now **${option.label}**.`;
    }

    saveData(data);
    await interaction.reply({ content: confirmation, flags: MessageFlags.Ephemeral });
    await updateVoteMessage(client, vote);
    return true;
}

async function monitorEvents(client) {
    const data = loadData();
    const now = Date.now();
    let changed = false;

    for (const event of data.events) {
        if (['completed', 'cancelled'].includes(event.status)) continue;

        if (event.status === 'live' && !sessionIsActive()) {
            event.status = 'paused-session';
            changed = true;
            await updateEventMessage(client, event);
            continue;
        }

        if (event.status === 'paused-session' && sessionIsActive()) {
            event.status = 'live';
            changed = true;
            await updateEventMessage(client, event);
            continue;
        }

        if (!event.startAt || now < event.startAt) continue;

        if (['upcoming', 'waiting-session'].includes(event.status)) {
            if (sessionIsActive()) {
                event.status = 'live';
                event.startedAt = now;
                event.startedAutomatically = true;
                changed = true;

                const guild = client.guilds.cache.get(event.guildId);
                if (guild && event.scheduledEventId) {
                    await editNativeScheduledStatus(guild, event, GuildScheduledEventStatus.Active);
                }
            } else if (event.status !== 'waiting-session') {
                event.status = 'waiting-session';
                changed = true;
            }

            await updateEventMessage(client, event);
        }
    }

    if (changed) saveData(data);
}

function startEventMonitor(client) {
    if (globalThis.__MSRP_EVENT_MONITOR__) return;
    globalThis.__MSRP_EVENT_MONITOR__ = true;

    console.log('[EVENTS] Event monitor started.');
    void monitorEvents(client).catch(error => console.warn('[EVENTS] Initial monitor failed:', error?.message || error));

    const timer = setInterval(() => {
        void monitorEvents(client).catch(error => console.warn('[EVENTS] Monitor failed:', error?.message || error));
    }, EVENT_MONITOR_INTERVAL_MS);

    timer.unref?.();
}

module.exports = {
    commands,
    handleAutocomplete,
    executeCommand,
    handleInteraction,
    startEventMonitor
};
