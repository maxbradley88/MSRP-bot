const path = require('path');
const {
    ChannelType,
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

const config = require('./ticketConfig');
const { setupTicketIcons, getTicketEmoji } = require('./ticketIcons');

function getCategoryId(typeConfig) {
    if (typeConfig.category === 1) {
        return config.supportTicketCategoryId;
    }

    if (typeConfig.category === 2) {
        return config.seniorTicketCategoryId;
    }

    if (typeConfig.category === 3) {
        return config.reportsAppealsTicketCategoryId;
    }

    return null;
}

function getOpenTicketsByType(guild, userId, ticketTypes) {
    return guild.channels.cache.filter(channel => {
        if (channel.type !== ChannelType.GuildText) {
            return false;
        }

        if (!channel.topic) {
            return false;
        }

        const ownerMatch = channel.topic.match(/ticket-owner:(\d+)/);
        const typeMatch = channel.topic.match(/ticket-type:([a-z]+)/);

        if (!ownerMatch || !typeMatch) {
            return false;
        }

        return (
            ownerMatch[1] === userId &&
            ticketTypes.includes(typeMatch[1])
        );
    });
}

function getFormValue(formAnswers, questionId) {
    const answer = formAnswers?.[questionId];

    if (answer === undefined || answer === null) {
        return 'Not provided';
    }

    if (typeof answer === 'string' && answer.trim() === '') {
        return 'Not provided';
    }

    return String(answer);
}

async function createTicket(interaction, ticketType, formAnswers = {}) {
    const guild = interaction.guild;

    if (!guild) {
        throw new Error('Guild was not found.');
    }

    const typeConfig = config.ticketTypes[ticketType];

    if (!typeConfig) {
        throw new Error(`Unknown ticket type: ${ticketType}`);
    }

    const categoryId = getCategoryId(typeConfig);

    if (!categoryId) {
        throw new Error(`No category configured for ticket type: ${ticketType}`);
    }

    // =========================================================
    // CHECK TICKET LIMITS
    // =========================================================

    let ticketLimit;
    let countedTypes;

    if (typeConfig.category === 1) {
        ticketLimit = config.maxSupportTicketsPerUser;
        countedTypes = ['general', 'other'];
    } else if (typeConfig.category === 2) {
        ticketLimit = config.maxSeniorTicketsPerUser;
        countedTypes = ['higherup'];
    } else if (typeConfig.category === 3) {
        ticketLimit = config.maxReportsAppealsTicketsPerUser;
        countedTypes = ['report', 'appeal'];
    }

    const openTickets = getOpenTicketsByType(
        guild,
        interaction.user.id,
        countedTypes
    );

    if (openTickets.size >= ticketLimit) {
        return interaction.reply({
            content:
                `❌ You already have the maximum number of open ${typeConfig.category === 3 ? 'Reports & Appeals' : typeConfig.category === 2 ? 'Senior Support' : 'Support'} tickets (${ticketLimit}).`,
            flags: MessageFlags.Ephemeral
        });
    }

    // =========================================================
    // MAKE SURE CUSTOM EMOJIS EXIST
    // =========================================================

    await setupTicketIcons(guild);

    // =========================================================
    // FETCH STAFF ROLES
    // =========================================================

    const supportRole = await guild.roles.fetch(config.supportStaffRoleId);
    const seniorRole = await guild.roles.fetch(config.seniorSupportStaffRoleId);
    const reportsAppealsRole = await guild.roles.fetch(
        config.reportsAppealsStaffRoleId
    );

    if (!supportRole) {
        throw new Error('Support Staff role was not found.');
    }

    if (!seniorRole) {
        throw new Error('Senior Support Staff role was not found.');
    }

    if (!reportsAppealsRole) {
        throw new Error('Reports & Appeals role was not found.');
    }

    // =========================================================
    // CHANNEL PERMISSIONS
    // =========================================================

    const permissionOverwrites = [
        {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: interaction.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        },
        {
            id: supportRole.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        },
        {
            id: seniorRole.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        },
        {
            id: reportsAppealsRole.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        }
    ];

    // =========================================================
    // CREATE CHANNEL
    // =========================================================

    const channel = await guild.channels.create({
        name: `${ticketType}-${interaction.user.username}`.toLowerCase(),
        type: ChannelType.GuildText,
        parent: categoryId,
        topic:
            `ticket-owner:${interaction.user.id}` +
            `|ticket-type:${ticketType}`,
        permissionOverwrites
    });

    // =========================================================
    // TOP STAFF PING
    // =========================================================

    await channel.send({
        content: `${interaction.user} <@&${typeConfig.roleId}>`,
        allowedMentions: {
            users: [interaction.user.id],
            roles: [typeConfig.roleId]
        }
    });

    // =========================================================
    // BUILD DETAILS
    // =========================================================

    const details = [];

    for (const question of typeConfig.questions) {
        const answer = getFormValue(formAnswers, question.id);

        details.push(
            `**${question.label}**\n${answer}`
        );
    }

    const detailsText = details.join('\n\n');

    // =========================================================
    // GET ACTION EMOJIS
    // =========================================================

    const claimEmoji = getTicketEmoji(guild, 'claim');
    const closeEmoji = getTicketEmoji(guild, 'close');
    const handoffEmoji = getTicketEmoji(guild, 'handoff');

    // =========================================================
    // ACTION BUTTONS
    // =========================================================

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_claim')
            .setLabel('Claim')
            .setStyle(ButtonStyle.Success)
            .setEmoji(
                claimEmoji
                    ? {
                          id: claimEmoji.id,
                          name: claimEmoji.name
                      }
                    : undefined
            ),

        new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
            .setEmoji(
                closeEmoji
                    ? {
                          id: closeEmoji.id,
                          name: closeEmoji.name
                      }
                    : undefined
            ),

        new ButtonBuilder()
            .setCustomId('ticket_handoff')
            .setLabel('Hand Off')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(
                handoffEmoji
                    ? {
                          id: handoffEmoji.id,
                          name: handoffEmoji.name
                      }
                    : undefined
            )
    );

    // =========================================================
    // MAIN TICKET CONTAINER
    // =========================================================

    const container = new ContainerBuilder();

    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(
                'attachment://ticket-dashboard.png'
            )
        )
    );

    container.addSeparatorComponents(
        new SeparatorBuilder()
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            '**Thank you for using the MSRP support system**\n' +
            'One of our support staff will assist you shortly, please provide any evidence or required context that may help our staff.'
        )
    );

    container.addSeparatorComponents(
        new SeparatorBuilder()
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `__Details & Information__\n\n${detailsText}`
        )
    );

    container.addSeparatorComponents(
        new SeparatorBuilder()
    );

    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL(
                'attachment://image.png'
            )
        )
    );

    container.addActionRowComponents(actionRow);

    // =========================================================
    // SEND TICKET MESSAGE
    // =========================================================

    await channel.send({
        components: [container],
        files: [
            {
                attachment: path.resolve(
                    __dirname,
                    '../images/ticket-dashboard.png'
                ),
                name: 'ticket-dashboard.png'
            },
            {
                attachment: path.resolve(
                    __dirname,
                    '../images/image.png'
                ),
                name: 'image.png'
            }
        ],
        flags: MessageFlags.IsComponentsV2
    });

    // =========================================================
    // CONFIRM CREATION
    // =========================================================

    return interaction.reply({
        content: `✅ Your ticket has been created: ${channel}`,
        flags: MessageFlags.Ephemeral
    });
}

module.exports = {
    createTicket
};