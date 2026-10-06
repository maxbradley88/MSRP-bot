const path = require('path');

const {
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const config = require('./ticketConfig');
const ticketStatus = require('./ticketStatus');

const {
    setupTicketIcons,
    getTicketEmoji
} = require('./ticketIcons');

async function createTicket(
    interaction,
    ticketType,
    answers = {}
) {
    const guild = interaction.guild;
    const user = interaction.user;
    const typeConfig = config.ticketTypes[ticketType];

    if (!typeConfig) {
        await interaction.reply({
            content: '❌ This ticket type does not exist.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const isSeniorTicket = typeConfig.category === 2;
    const isReportsAppealsTicket = typeConfig.category === 3;
    let categoryId;

    if (isReportsAppealsTicket) {
        categoryId = config.reportsAppealsTicketCategoryId;
    } else if (isSeniorTicket) {
        categoryId = config.seniorTicketCategoryId;
    } else {
        categoryId = config.supportTicketCategoryId;
    }

    const userTickets = guild.channels.cache.filter(
        channel =>
            channel.topic?.includes(`ticket-owner:${user.id}`) &&
            channel.topic?.includes('ticket-type:')
    );

    const supportTicketCount = userTickets.filter(channel => {
        const match = channel.topic?.match(/ticket-type:([^|]+)/);
        const currentType = match ? match[1] : null;
        return ['general', 'other'].includes(currentType);
    }).size;

    const seniorTicketCount = userTickets.filter(channel => {
        const match = channel.topic?.match(/ticket-type:([^|]+)/);
        return match && match[1] === 'higherup';
    }).size;

    const reportsAppealsTicketCount = userTickets.filter(channel => {
        const match = channel.topic?.match(/ticket-type:([^|]+)/);
        const currentType = match ? match[1] : null;
        return ['report', 'appeal'].includes(currentType);
    }).size;

    if (
        !isSeniorTicket &&
        !isReportsAppealsTicket &&
        supportTicketCount >= config.maxSupportTicketsPerUser
    ) {
        await interaction.reply({
            content: `❌ You already have the maximum number of open Support tickets (${config.maxSupportTicketsPerUser}).`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (
        isSeniorTicket &&
        seniorTicketCount >= config.maxSeniorTicketsPerUser
    ) {
        await interaction.reply({
            content: `❌ You already have the maximum number of open Higher Up tickets (${config.maxSeniorTicketsPerUser}).`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (
        isReportsAppealsTicket &&
        reportsAppealsTicketCount >= config.maxReportsAppealsTicketsPerUser
    ) {
        await interaction.reply({
            content: `❌ You already have the maximum number of open Reports & Appeals tickets (${config.maxReportsAppealsTicketsPerUser}).`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await setupTicketIcons(guild);

    const supportRole = await guild.roles.fetch(config.supportStaffRoleId);
    const seniorSupportRole = await guild.roles.fetch(config.seniorSupportStaffRoleId);
    const reportsAppealsRole = await guild.roles.fetch(config.reportsAppealsStaffRoleId);

    if (!supportRole || !seniorSupportRole || !reportsAppealsRole) {
        throw new Error('One or more ticket staff roles could not be found.');
    }

    const permissionOverwrites = [
        {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },
        {
            id: supportRole.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },
        {
            id: seniorSupportRole.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },
        {
            id: reportsAppealsRole.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },
        {
            id: guild.members.me.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        }
    ];

    const ticketNumber =
        guild.channels.cache.filter(
            channel =>
                channel.parentId === categoryId &&
                channel.topic?.startsWith('ticket-owner:')
        ).size + 1;

    const paddedNumber = String(ticketNumber).padStart(3, '0');

    const safeUsername = user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-');

    const channelName =
        `${ticketType}-${safeUsername}-${paddedNumber}`;

    const ticketChannel =
        await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: categoryId,
            topic:
                `ticket-owner:${user.id}` +
                `|ticket-type:${ticketType}`,
            permissionOverwrites
        });

    await interaction.reply({
        content: `✅ Your ticket has been created: ${ticketChannel}`,
        flags: MessageFlags.Ephemeral
    });

    await ticketChannel.send({
        content: `${user} <@&${typeConfig.roleId}>`
    });

    const responseLines = [];

    for (const question of typeConfig.questions || []) {
        let answer = answers[question.id];

        if (
            answer === undefined ||
            answer === null ||
            answer === ''
        ) {
            answer = 'N/A';
        }

        if (question.type === 'dropdown') {
            const selectedOption = question.options?.find(
                option => option.value === answer
            );

            if (selectedOption) {
                answer = selectedOption.label;
            }
        }

        responseLines.push(
            `**${question.label}**\n${answer}`
        );
    }

    const responsesText =
        responseLines.length > 0
            ? responseLines.join('\n\n')
            : 'No form responses were provided.';

    const claimEmoji = getTicketEmoji(guild, 'claim');
    const closeEmoji = getTicketEmoji(guild, 'close');
    const handoffEmoji = getTicketEmoji(guild, 'handoff');
    const unclaimEmoji = getTicketEmoji(guild, 'unclaim');

    const ticketButtons =
        new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('ticket_claim')
                    .setLabel('Claim')
                    .setStyle(ButtonStyle.Success)
                    .setEmoji(claimEmoji || undefined),

                new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('Close')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji(closeEmoji || undefined),

                new ButtonBuilder()
                    .setCustomId('ticket_handoff')
                    .setLabel('Hand Off')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji(handoffEmoji || undefined),

                new ButtonBuilder()
                    .setCustomId('ticket_unclaim')
                    .setLabel('Unclaim')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji(unclaimEmoji || undefined)
            );

    const welcomeContainer =
        new ContainerBuilder()
            .addMediaGalleryComponents(
                new MediaGalleryBuilder()
                    .addItems(
                        new MediaGalleryItemBuilder()
                            .setURL(
                                'attachment://ticket-dashboard.png'
                            )
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        '**Thank you for using the MSRP support system**\n\n' +
                        'One of our support staff will assist you shortly, ' +
                        'please provide any evidence or required context that ' +
                        'may help our staff.'
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
            )
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        '__Details & Information__\n\n' +
                        responsesText
                    )
            )
            .addSeparatorComponents(
                new SeparatorBuilder()
                    .setDivider(true)
            )
            .addMediaGalleryComponents(
                new MediaGalleryBuilder()
                    .addItems(
                        new MediaGalleryItemBuilder()
                            .setURL(
                                'attachment://image.png'
                            )
                    )
            )
            .addActionRowComponents(
                ticketButtons
            );

    const ticketMessage = await ticketChannel.send({
        components: [welcomeContainer],
        files: [
            {
                attachment: path.join(
                    __dirname,
                    '..',
                    'images',
                    'ticket-dashboard.png'
                ),
                name: 'ticket-dashboard.png'
            },
            {
                attachment: path.join(
                    __dirname,
                    '..',
                    'images',
                    'image.png'
                ),
                name: 'image.png'
            }
        ],
        flags: MessageFlags.IsComponentsV2
    });

    ticketStatus.rememberTicketMessage(
        ticketChannel.id,
        ticketMessage.id
    );

    try {
        await ticketMessage.pin(
            'Pin MSRP ticket control container'
        );
    } catch (error) {
        console.error(
            '[TICKET CREATE PIN ERROR]',
            error
        );
    }
}

module.exports = {
    createTicket
};
