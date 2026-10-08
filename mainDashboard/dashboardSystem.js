const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder
} = require('discord.js');

const { loadData, saveData, makeId } = require('./dashboardData');
const { ensureDashboardIcons, getDashboardIcons } = require('./dashboardIcons');

const TOP_IMAGE = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const BOTTOM_IMAGE = path.join(__dirname, '..', 'images', 'image.png');

const commands = [
    new SlashCommandBuilder()
        .setName('send-dashboard')
        .setDescription('Sends the main MSRP dashboard.'),

    new SlashCommandBuilder()
        .setName('add-dashboard-role')
        .setDescription('Adds a notification role button to the main dashboard.')
        .addStringOption(option => option
            .setName('name')
            .setDescription('The name shown on the button.')
            .setRequired(true)
            .setMaxLength(80))
        .addRoleOption(option => option
            .setName('role')
            .setDescription('The role this notification button toggles.')
            .setRequired(true)),

    new SlashCommandBuilder()
        .setName('remove-dashboard-role')
        .setDescription('Removes a notification role button from the main dashboard.')
        .addStringOption(option => option
            .setName('notification')
            .setDescription('The notification role button to remove.')
            .setRequired(true)
            .setAutocomplete(true)),

    new SlashCommandBuilder()
        .setName('config-partnership-conditions')
        .setDescription('Configures the partnership conditions shown on the dashboard.')
        .addIntegerOption(option => option
            .setName('members')
            .setDescription('Minimum members. Leave blank to remove this condition.')
            .setMinValue(1))
        .addIntegerOption(option => option
            .setName('staff')
            .setDescription('Minimum staff. Leave blank to remove this condition.')
            .setMinValue(1))
        .addIntegerOption(option => option
            .setName('representatives')
            .setDescription('Required representatives. Leave blank to remove this condition.')
            .setMinValue(1))
        .addStringOption(option => option
            .setName('other')
            .setDescription('Any other condition. Leave blank to remove it.')
            .setMaxLength(1000))
        .addStringOption(option => option
            .setName('notes')
            .setDescription('Additional notes. Leave blank to remove them.')
            .setMaxLength(1000)),

    new SlashCommandBuilder()
        .setName('set-rules')
        .setDescription('Updates the game and/or server rules shown on the dashboard.')
        .addStringOption(option => option
            .setName('game')
            .setDescription('Game rules. Formatting and emojis are preserved.')
            .setMaxLength(6000))
        .addStringOption(option => option
            .setName('server')
            .setDescription('Server rules. Formatting and emojis are preserved.')
            .setMaxLength(6000)),

    new SlashCommandBuilder()
        .setName('departments-add')
        .setDescription('Adds a department to the main dashboard.')
        .addStringOption(option => option
            .setName('department')
            .setDescription('Department name shown on the button.')
            .setRequired(true)
            .setMaxLength(80))
        .addStringOption(option => option
            .setName('link')
            .setDescription('Discord invite link for the department server.')
            .setRequired(true)
            .setMaxLength(500))
        .addStringOption(option => option
            .setName('message')
            .setDescription('Department promotional message. Formatting is preserved.')
            .setRequired(true)
            .setMaxLength(6000))
        .addStringOption(option => option
            .setName('icon')
            .setDescription('Optional emoji/custom emoji shown with the department.')
            .setMaxLength(100)),

    new SlashCommandBuilder()
        .setName('departments-remove')
        .setDescription('Removes a department from the main dashboard.')
        .addStringOption(option => option
            .setName('department')
            .setDescription('Department to remove.')
            .setRequired(true)
            .setAutocomplete(true)),

    new SlashCommandBuilder()
        .setName('partnership-add')
        .setDescription('Adds a partnership to the main dashboard.')
        .addStringOption(option => option
            .setName('name')
            .setDescription('Partnership/server name.')
            .setRequired(true)
            .setMaxLength(80))
        .addStringOption(option => option
            .setName('details')
            .setDescription('Partnership details. Formatting and emojis are preserved.')
            .setRequired(true)
            .setMaxLength(6000))
        .addStringOption(option => option
            .setName('link')
            .setDescription('Discord invite link.')
            .setRequired(true)
            .setMaxLength(500))
        .addUserOption(option => option.setName('rep-1').setDescription('Representative 1'))
        .addUserOption(option => option.setName('rep-2').setDescription('Representative 2'))







        .addUserOption(option => option.setName('rep-10').setDescription('Representative 10')),

    new SlashCommandBuilder()
        .setName('partnership-remove')
        .setDescription('Removes a partnership from the main dashboard.')
        .addStringOption(option => option
            .setName('partnership')
            .setDescription('Partnership to remove.')
            .setRequired(true)
            .setAutocomplete(true)),

    new SlashCommandBuilder()
        .setName('application-manage')
        .setDescription('Configures an application button on the main dashboard.')
        .addStringOption(option => option
            .setName('application')
            .setDescription('Application to configure.')
            .setRequired(true)
            .addChoices(
                { name: 'Game Staff', value: 'gameStaff' },
                { name: 'Support Team', value: 'supportTeam' }
            ))
        .addStringOption(option => option
            .setName('application-link')
            .setDescription('Application link. Leave blank to disable the button.')
            .setMaxLength(500)),

    new SlashCommandBuilder()
        .setName('coc-team-add')
        .setDescription('Adds a team to the Chain of Command message.')
        .addStringOption(option => option
            .setName('team-name')
            .setDescription('Team name.')
            .setRequired(true)
            .setMaxLength(80))
        .addRoleOption(option => option
            .setName('connected-role-1')
            .setDescription('Connected role 1.')
            .setRequired(true))
        .addRoleOption(option => option
            .setName('team-role')
            .setDescription('Main team role.')
            .setRequired(true))
        .addRoleOption(option => option.setName('connected-role-2').setDescription('Connected role 2.'))
        .addRoleOption(option => option.setName('connected-role-3').setDescription('Connected role 3.'))
        .addRoleOption(option => option.setName('connected-role-4').setDescription('Connected role 4.'))
        .addRoleOption(option => option.setName('connected-role-5').setDescription('Connected role 5.')),

    new SlashCommandBuilder()
        .setName('coc-team-remove')
        .setDescription('Removes a team from the Chain of Command message.')
        .addStringOption(option => option
            .setName('team')
            .setDescription('Team to remove.')
            .setRequired(true)
            .setAutocomplete(true))
];

function applyEmoji(component, emoji) {
    if (emoji) component.setEmoji(emoji);
    return component;
}

function attachmentFiles() {
    return [
        { attachment: TOP_IMAGE, name: 'ticket-dashboard.png' },
        { attachment: BOTTOM_IMAGE, name: 'image.png' }
    ];
}

function bottomImageOnly() {
    return [{ attachment: BOTTOM_IMAGE, name: 'image.png' }];
}

function componentsReply(container, { image = false } = {}) {
    const payload = {
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [container],
        allowedMentions: { parse: [] }
    };
    if (image) payload.files = bottomImageOnly();
    return payload;
}

function buildMainDashboard(icons) {
    const informationMenu = new StringSelectMenuBuilder()
        .setCustomId('main_dash_information')
        .setPlaceholder('Information')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Rules')
                .setValue('rules')
                .setEmoji(icons.rules),
            new StringSelectMenuOptionBuilder()
                .setLabel('Departments')
                .setValue('departments')
                .setEmoji(icons.departments),
            new StringSelectMenuOptionBuilder()
                .setLabel('Partnerships')
                .setValue('partnerships')
                .setEmoji(icons.partnership)
        );

    const applicationsMenu = new StringSelectMenuBuilder()
        .setCustomId('main_dash_applications')
        .setPlaceholder('Applications')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Applications')
                .setValue('applications')
                .setEmoji(icons.applications),
            new StringSelectMenuOptionBuilder()
                .setLabel('Chain of Command')
                .setValue('chain')
                .setEmoji(icons.chain)
        );

    const notifications = applyEmoji(
        new ButtonBuilder()
            .setCustomId('main_dash_notifications')
            .setLabel('Notifications')
            .setStyle(ButtonStyle.Secondary),
        icons.notifications
    );

    const conditions = applyEmoji(
        new ButtonBuilder()
            .setCustomId('main_dash_conditions')
            .setLabel('Partnership Conditions')
            .setStyle(ButtonStyle.Secondary),
        icons.partnership
    );

    return new ContainerBuilder()
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(notifications, conditions)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(informationMenu)
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(applicationsMenu)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );
}

function parseEmojiInput(value) {
    if (!value) return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^<a?:([\w~]+):(\d+)>$/);
    if (match) return { name: match[1], id: match[2] };
    return trimmed;
}

function safeUrl(value) {
    if (!value) return null;
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return url.toString();
    } catch {
        return null;
    }
}

function buttonRows(buttons) {
    const rows = [];
    for (let index = 0; index < buttons.length; index += 5) {
        rows.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + 5)));
    }
    return rows;
}

function textChunks(text, maxLength = 3500) {
    const input = String(text || '');
    if (!input) return [''];
    if (input.length <= maxLength) return [input];

    const chunks = [];
    let remaining = input;

    while (remaining.length > maxLength) {
        let cut = remaining.lastIndexOf('\n', maxLength);
        if (cut < Math.floor(maxLength * 0.55)) cut = maxLength;
        chunks.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).replace(/^\n/, '');
    }

    if (remaining) chunks.push(remaining);
    return chunks;
}

function addTextBlocks(container, text) {
    for (const chunk of textChunks(text)) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk || ' '));
    }
    return container;
}

async function executeCommand(interaction) {
    const data = loadData();

    if (interaction.commandName === 'send-dashboard') {
        const icons = await ensureDashboardIcons(interaction.guild);
        const message = await interaction.channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [buildMainDashboard(icons)],
            files: attachmentFiles()
        });

        data.dashboard = {
            channelId: interaction.channelId,
            messageId: message.id
        };
        saveData(data);

        await interaction.reply({
            content: '✅ Main dashboard sent.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.commandName === 'add-dashboard-role') {
        const name = interaction.options.getString('name', true).trim();
        const role = interaction.options.getRole('role', true);

        const existing = data.notificationRoles.find(item => item.roleId === role.id);
        if (existing) {
            existing.name = name;
        } else {
            data.notificationRoles.push({ id: makeId('notify'), name, roleId: role.id });
        }
        saveData(data);

        await interaction.reply({
            content: `✅ Notification button **${name}** now toggles ${role}.`,
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.commandName === 'remove-dashboard-role') {
        const id = interaction.options.getString('notification', true);
        const before = data.notificationRoles.length;
        data.notificationRoles = data.notificationRoles.filter(item => item.id !== id);
        saveData(data);

        await interaction.reply({
            content: before === data.notificationRoles.length
                ? '❌ That notification role no longer exists.'
                : '✅ Notification role removed.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.commandName === 'config-partnership-conditions') {
        data.partnershipConditions = {
            ...data.partnershipConditions,
            members: interaction.options.getInteger('members'),
            staff: interaction.options.getInteger('staff'),
            representatives: interaction.options.getInteger('representatives'),
            activeCommunity: true,
            other: interaction.options.getString('other'),
            notes: interaction.options.getString('notes')
        };
        saveData(data);

        await interaction.reply({
            content: '✅ Partnership conditions updated. Blank options were removed.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.commandName === 'set-rules') {
        const game = interaction.options.getString('game');
        const server = interaction.options.getString('server');
        if (game == null && server == null) {
            await interaction.reply({
                content: '❌ Add at least one of `game` or `server`.',
                flags: MessageFlags.Ephemeral
            });
            return true;
        }
        if (game != null) data.rules.game = game;
        if (server != null) data.rules.server = server;
        saveData(data);

        await interaction.reply({
            content: '✅ Rules updated.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.commandName === 'departments-add') {
        const link = safeUrl(interaction.options.getString('link', true));
        if (!link) {
            await interaction.reply({ content: '❌ Please provide a valid `http` or `https` invite link.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const department = {
            id: makeId('dept'),
            name: interaction.options.getString('department', true).trim(),
            link,
            message: interaction.options.getString('message', true),
            icon: interaction.options.getString('icon')?.trim() || null
        };
        data.departments.push(department);
        saveData(data);

        await interaction.reply({ content: `✅ **${department.name}** was added.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.commandName === 'departments-remove') {
        const id = interaction.options.getString('department', true);
        const item = data.departments.find(entry => entry.id === id);
        data.departments = data.departments.filter(entry => entry.id !== id);
        saveData(data);
        await interaction.reply({ content: item ? `✅ **${item.name}** was removed.` : '❌ That department no longer exists.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.commandName === 'partnership-add') {
        const link = safeUrl(interaction.options.getString('link', true));
        if (!link) {
            await interaction.reply({ content: '❌ Please provide a valid `http` or `https` invite link.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const reps = [];
        for (let i = 1; i <= 2; i += 1) {
            const user = interaction.options.getUser(`rep-${i}`);
            if (user && !reps.includes(user.id)) reps.push(user.id);
        }

        const partnership = {
            id: makeId('partner'),
            name: interaction.options.getString('name', true).trim(),
            details: interaction.options.getString('details', true),
            link,
            representativeIds: reps
        };
        data.partnerships.push(partnership);
        saveData(data);

        await interaction.reply({ content: `✅ Partnership **${partnership.name}** was added.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.commandName === 'partnership-remove') {
        const id = interaction.options.getString('partnership', true);
        const item = data.partnerships.find(entry => entry.id === id);
        data.partnerships = data.partnerships.filter(entry => entry.id !== id);
        saveData(data);
        await interaction.reply({ content: item ? `✅ Partnership **${item.name}** was removed.` : '❌ That partnership no longer exists.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.commandName === 'application-manage') {
        const application = interaction.options.getString('application', true);
        const rawLink = interaction.options.getString('application-link');
        if (rawLink && !safeUrl(rawLink)) {
            await interaction.reply({ content: '❌ Please provide a valid `http` or `https` application link.', flags: MessageFlags.Ephemeral });
            return true;
        }
        data.applications[application] = rawLink ? safeUrl(rawLink) : null;
        saveData(data);

        const label = application === 'gameStaff' ? 'Game Staff' : 'Support Team';
        await interaction.reply({
            content: rawLink ? `✅ **${label}** application link updated.` : `✅ **${label}** application button disabled.`,
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (interaction.commandName === 'coc-team-add') {
        const roleIds = [];
        for (let i = 1; i <= 5; i += 1) {
            const role = interaction.options.getRole(`connected-role-${i}`);
            if (role && !roleIds.includes(role.id)) roleIds.push(role.id);
        }

        const teamRole = interaction.options.getRole('team-role', true);
        const team = {
            id: makeId('team'),
            name: interaction.options.getString('team-name', true).trim(),
            connectedRoleIds: roleIds,
            teamRoleId: teamRole.id
        };
        data.cocTeams.push(team);
        saveData(data);

        await interaction.reply({ content: `✅ **${team.name}** was added to the Chain of Command.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (interaction.commandName === 'coc-team-remove') {
        const id = interaction.options.getString('team', true);
        const item = data.cocTeams.find(entry => entry.id === id);
        data.cocTeams = data.cocTeams.filter(entry => entry.id !== id);
        saveData(data);
        await interaction.reply({ content: item ? `✅ **${item.name}** was removed.` : '❌ That team no longer exists.', flags: MessageFlags.Ephemeral });
        return true;
    }

    return false;
}

async function handleAutocomplete(interaction) {
    if (!interaction.isAutocomplete()) return false;

    const data = loadData();
    const focused = interaction.options.getFocused().toLowerCase();
    let items = null;

    if (interaction.commandName === 'remove-dashboard-role') {
        items = data.notificationRoles;
    } else if (interaction.commandName === 'departments-remove') {
        items = data.departments;
    } else if (interaction.commandName === 'partnership-remove') {
        items = data.partnerships;
    } else if (interaction.commandName === 'coc-team-remove') {
        items = data.cocTeams;
    }

    if (!items) return false;

    const choices = items
        .filter(item => item.name.toLowerCase().includes(focused))
        .slice(0, 25)
        .map(item => ({ name: item.name.slice(0, 100), value: item.id }));

    await interaction.respond(choices);
    return true;
}

async function showNotifications(interaction, icons) {
    const data = loadData();
    const buttons = data.notificationRoles.map(item =>
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(`main_dash_notify:${item.id}`)
                .setLabel(item.name.slice(0, 80))
                .setStyle(ButtonStyle.Secondary),
            icons.notifications
        )
    );

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## Notifications\nChoose which notification roles you would like to receive.')
        );

    if (buttons.length) {
        container.addSeparatorComponents(new SeparatorBuilder());
        for (const row of buttonRows(buttons)) container.addActionRowComponents(row);
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent('*No notification roles are configured yet.*')
        );
    }

    await interaction.reply(componentsReply(container));
}

async function showConditions(interaction) {
    const c = loadData().partnershipConditions;
    const lines = [];
    if (c.members) lines.push(`- Members: ${c.members}+`);
    if (c.staff) lines.push(`- Staff: ${c.staff}+`);
    if (c.representatives) lines.push(`- Representatives: ${c.representatives}`);
    if (c.activeCommunity) lines.push('- Active Community');
    if (c.other) lines.push(`- ${c.other}`);
    if (c.notes) lines.push(`- ${c.notes}`);

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## MSRP Partnership Conditions\n\n' +
                'View the conditions MSRP requires for your server to partner with us!\n\n' +
                'We would love to have you join us, apply your server for a partnership through a ticket.'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(lines.length ? lines.join('\n') : '*No partnership conditions are currently configured.*')
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );

    await interaction.reply(componentsReply(container, { image: true }));
}

async function showRulesMenu(interaction, icons) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('## MSRP Rules\n\nMelbourne State Roleplay follows a strict rule program. If rules are broken you WILL be infracted. View our game or server rules below.')
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                applyEmoji(
                    new ButtonBuilder().setCustomId('main_dash_rule:game').setLabel('Game Rules').setStyle(ButtonStyle.Secondary),
                    icons.rules
                ),
                applyEmoji(
                    new ButtonBuilder().setCustomId('main_dash_rule:server').setLabel('Server Rules').setStyle(ButtonStyle.Secondary),
                    icons.rules
                )
            )
        );

    await interaction.reply(componentsReply(container));
}

async function showRule(interaction, kind) {
    const data = loadData();
    const text = kind === 'game' ? data.rules.game : data.rules.server;
    const container = new ContainerBuilder();
    addTextBlocks(container, text || '*No rules configured.*');
    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );
    await interaction.reply(componentsReply(container, { image: true }));
}

async function showDepartments(interaction) {
    const data = loadData();
    const buttons = data.departments.map(item => {
        const button = new ButtonBuilder()
            .setCustomId(`main_dash_department:${item.id}`)
            .setLabel(item.name.slice(0, 80))
            .setStyle(ButtonStyle.Secondary);
        const emoji = parseEmojiInput(item.icon);
        if (emoji) {
            try { button.setEmoji(emoji); } catch {}
        }
        return button;
    });

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## MSRP Roleplay Departments\n\nUse the buttons below to find out more about the current departments Melbourne State Roleplay offers!'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder());

    if (buttons.length) {
        for (const row of buttonRows(buttons)) container.addActionRowComponents(row);
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*No departments are currently configured.*'));
    }

    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );

    await interaction.reply(componentsReply(container, { image: true }));
}

async function showDepartment(interaction, id) {
    const item = loadData().departments.find(entry => entry.id === id);
    if (!item) {
        await interaction.reply({ content: '❌ That department is no longer configured.', flags: MessageFlags.Ephemeral });
        return;
    }

    const icon = item.icon ? `${item.icon} ` : '';
    const joinButton = new ButtonBuilder()
        .setLabel('Join Server')
        .setStyle(ButtonStyle.Link)
        .setURL(item.link);

    const container = new ContainerBuilder();
    addTextBlocks(container, `## ${icon}${item.name}\n\n${item.message}`);
    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(new ActionRowBuilder().addComponents(joinButton))
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );

    await interaction.reply(componentsReply(container, { image: true }));
}

async function showPartnerships(interaction, icons) {
    const data = loadData();
    const buttons = data.partnerships.map(item =>
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(`main_dash_partner:${item.id}`)
                .setLabel(item.name.slice(0, 80))
                .setStyle(ButtonStyle.Secondary),
            icons.partnership
        )
    );

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## MSRP Partnerships\n\nMelbourne State Roleplay has a range of partnerships with other servers that can be seen below!'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder());

    if (buttons.length) {
        for (const row of buttonRows(buttons)) container.addActionRowComponents(row);
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*No partnerships are currently configured.*'));
    }

    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );

    await interaction.reply(componentsReply(container, { image: true }));
}

async function showPartnership(interaction, id) {
    const item = loadData().partnerships.find(entry => entry.id === id);
    if (!item) {
        await interaction.reply({ content: '❌ That partnership is no longer configured.', flags: MessageFlags.Ephemeral });
        return;
    }

    const reps = item.representativeIds?.length
        ? item.representativeIds.map(userId => `<@${userId}>`).join(' ')
        : 'None configured';

    const container = new ContainerBuilder();
    addTextBlocks(container, `## ${item.name}\n\n${item.details}`);
    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setLabel('Join today!').setStyle(ButtonStyle.Link).setURL(item.link)
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`**Representatives:** ${reps}`)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );

    await interaction.reply(componentsReply(container, { image: true }));
}

function applicationButton(label, link) {
    if (link) {
        return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(link);
    }
    return new ButtonBuilder()
        .setCustomId(`main_dash_application_disabled:${label.toLowerCase().replace(/\s+/g, '_')}`)
        .setLabel(label)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true);
}

async function showApplications(interaction) {
    const apps = loadData().applications;
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## Apply at MSRP today!\n\n' +
                'We would love to have you join our team! Select your application type below, if you are interested in a **fast pass** please open a higher up support ticket.'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                applicationButton('Game Staff', apps.gameStaff),
                applicationButton('Support Team', apps.supportTeam)
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );

    await interaction.reply(componentsReply(container, { image: true }));
}

async function showChainOfCommand(interaction) {
    const data = loadData();
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## MSRP Roles\n\n' +
                'See the current staff roles that Melbourne State Roleplay has.\n\n' +
                'To apply see the apply dropdown on the dashboard (or) request a fast pass through a higher up support ticket - applications are always open for our game staff!'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder());

    if (!data.cocTeams.length) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*No Chain of Command teams are configured yet.*'));
    } else {
        for (const [index, team] of data.cocTeams.entries()) {
            const connected = team.connectedRoleIds?.length
                ? team.connectedRoleIds.map(roleId => `<@&${roleId}>`).join('\n')
                : '*No connected roles*';

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**${team.name}**\n\n${connected}\n\n[<@&${team.teamRoleId}>]`
                )
            );
            if (index < data.cocTeams.length - 1) {
                container.addSeparatorComponents(new SeparatorBuilder());
            }
        }
    }

    container
        .addSeparatorComponents(new SeparatorBuilder())
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );

    await interaction.reply(componentsReply(container, { image: true }));
}

async function toggleNotification(interaction, id) {
    const item = loadData().notificationRoles.find(entry => entry.id === id);
    if (!item) {
        await interaction.reply({ content: '❌ That notification role no longer exists.', flags: MessageFlags.Ephemeral });
        return;
    }

    const role = interaction.guild.roles.cache.get(item.roleId);
    if (!role) {
        await interaction.reply({ content: '❌ That Discord role no longer exists.', flags: MessageFlags.Ephemeral });
        return;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id);
    const hasRole = member.roles.cache.has(role.id);

    try {
        if (hasRole) {
            await member.roles.remove(role, 'MSRP main dashboard notification preference');
            await interaction.reply({ content: `✅ **${item.name}** notifications have been removed.`, flags: MessageFlags.Ephemeral });
        } else {
            await member.roles.add(role, 'MSRP main dashboard notification preference');
            await interaction.reply({ content: `✅ **${item.name}** notifications have been enabled.`, flags: MessageFlags.Ephemeral });
        }
    } catch (error) {
        console.error('[MAIN DASHBOARD] Notification toggle failed:', error);
        await interaction.reply({ content: '❌ I could not update that role. Check my role position and Manage Roles permission.', flags: MessageFlags.Ephemeral });
    }
}

async function handleInteraction(interaction) {
    const customId = interaction.customId || '';
    if (!customId.startsWith('main_dash_')) return false;

    const icons = interaction.guild ? getDashboardIcons(interaction.guild) : {};

    if (interaction.isButton()) {
        if (customId === 'main_dash_notifications') await showNotifications(interaction, icons);
        else if (customId === 'main_dash_conditions') await showConditions(interaction);
        else if (customId.startsWith('main_dash_notify:')) await toggleNotification(interaction, customId.split(':')[1]);
        else if (customId.startsWith('main_dash_rule:')) await showRule(interaction, customId.split(':')[1]);
        else if (customId.startsWith('main_dash_department:')) await showDepartment(interaction, customId.split(':')[1]);
        else if (customId.startsWith('main_dash_partner:')) await showPartnership(interaction, customId.split(':')[1]);
        else return false;
        return true;
    }

    if (interaction.isStringSelectMenu()) {
        const value = interaction.values[0];
        if (customId === 'main_dash_information') {
            if (value === 'rules') await showRulesMenu(interaction, icons);
            else if (value === 'departments') await showDepartments(interaction);
            else if (value === 'partnerships') await showPartnerships(interaction, icons);
            else return false;
            return true;
        }

        if (customId === 'main_dash_applications') {
            if (value === 'applications') await showApplications(interaction);
            else if (value === 'chain') await showChainOfCommand(interaction);
            else return false;
            return true;
        }
    }

    return false;
}

module.exports = {
    commands,
    executeCommand,
    handleAutocomplete,
    handleInteraction,
    ensureDashboardIcons
};
