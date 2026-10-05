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

const {
    setupTicketIcons,
    getTicketEmoji
} = require('./ticketIcons');


// ==========================================
// CREATE TICKET
// ==========================================

async function createTicket(
    interaction,
    ticketType,
    answers = {}
) {

    const guild =
        interaction.guild;

    const user =
        interaction.user;

    const typeConfig =
        config.ticketTypes[ticketType];


    // ==========================================
    // CHECK TICKET TYPE
    // ==========================================

    if (!typeConfig) {

        await interaction.reply({

            content:
                '❌ This ticket type does not exist.',

            flags:
                MessageFlags.Ephemeral

        });

        return;
    }


    // ==========================================
    // DETERMINE CATEGORY
    // ==========================================

    const isSeniorTicket =
        typeConfig.category === 2;

    const isReportsAppealsTicket =
        typeConfig.category === 3;

    let categoryId;


    if (isReportsAppealsTicket) {

        categoryId =
            config.reportsAppealsTicketCategoryId;

    } else if (isSeniorTicket) {

        categoryId =
            config.seniorTicketCategoryId;

    } else {

        categoryId =
            config.supportTicketCategoryId;
    }


    // ==========================================
    // GET USER'S OPEN TICKETS
    // ==========================================

    const userTickets =
        guild.channels.cache.filter(
            channel =>
                channel.topic?.includes(
                    `ticket-owner:${user.id}`
                ) &&
                channel.topic?.includes(
                    'ticket-type:'
                )
        );


    // ==========================================
    // COUNT SUPPORT TICKETS
    // GENERAL + OTHER
    // ==========================================

    const supportTicketCount =
        userTickets.filter(channel => {

            const match =
                channel.topic?.match(
                    /ticket-type:([^|]+)/
                );

            const currentType =
                match
                    ? match[1]
                    : null;

            return [
                'general',
                'other'
            ].includes(
                currentType
            );

        }).size;


    // ==========================================
    // COUNT HIGHER UP TICKETS
    // ==========================================

    const seniorTicketCount =
        userTickets.filter(channel => {

            const match =
                channel.topic?.match(
                    /ticket-type:([^|]+)/
                );

            return (
                match &&
                match[1] === 'higherup'
            );

        }).size;


    // ==========================================
    // COUNT REPORTS + APPEALS
    // ==========================================

    const reportsAppealsTicketCount =
        userTickets.filter(channel => {

            const match =
                channel.topic?.match(
                    /ticket-type:([^|]+)/
                );

            const currentType =
                match
                    ? match[1]
                    : null;

            return [
                'report',
                'appeal'
            ].includes(
                currentType
            );

        }).size;


    // ==========================================
    // ENFORCE SUPPORT LIMIT
    // ==========================================

    if (
        !isSeniorTicket &&
        !isReportsAppealsTicket &&
        supportTicketCount >=
            config.maxSupportTicketsPerUser
    ) {

        await interaction.reply({

            content:
                `❌ You already have the maximum number of open Support tickets (${config.maxSupportTicketsPerUser}).`,

            flags:
                MessageFlags.Ephemeral

        });

        return;
    }


    // ==========================================
    // ENFORCE SENIOR LIMIT
    // ==========================================

    if (
        isSeniorTicket &&
        seniorTicketCount >=
            config.maxSeniorTicketsPerUser
    ) {

        await interaction.reply({

            content:
                `❌ You already have the maximum number of open Higher Up tickets (${config.maxSeniorTicketsPerUser}).`,

            flags:
                MessageFlags.Ephemeral

        });

        return;
    }


    // ==========================================
    // ENFORCE REPORTS + APPEALS LIMIT
    // ==========================================

    if (
        isReportsAppealsTicket &&
        reportsAppealsTicketCount >=
            config.maxReportsAppealsTicketsPerUser
    ) {

        await interaction.reply({

            content:
                `❌ You already have the maximum number of open Reports & Appeals tickets (${config.maxReportsAppealsTicketsPerUser}).`,

            flags:
                MessageFlags.Ephemeral

        });

        return;
    }


    // ==========================================
    // MAKE SURE CUSTOM EMOJIS EXIST
    // ==========================================

    await setupTicketIcons(guild);


    // ==========================================
    // GET STAFF ROLES
    // ==========================================

    const supportRole =
        await guild.roles.fetch(
            config.supportStaffRoleId
        );

    const seniorSupportRole =
        await guild.roles.fetch(
            config.seniorSupportStaffRoleId
        );

    const reportsAppealsRole =
        await guild.roles.fetch(
            config.reportsAppealsStaffRoleId
        );


    if (
        !supportRole ||
        !seniorSupportRole ||
        !reportsAppealsRole
    ) {

        throw new Error(
            'One or more ticket staff roles could not be found.'
        );
    }


    // ==========================================
    // PERMISSIONS
    // ==========================================

    const permissionOverwrites = [

        {
            id:
                guild.roles.everyone.id,

            deny: [
                PermissionFlagsBits.ViewChannel
            ]
        },

        {
            id:
                user.id,

            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },

        {
            id:
                supportRole.id,

            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },

        {
            id:
                seniorSupportRole.id,

            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },

        {
            id:
                reportsAppealsRole.id,

            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },

        {
            id:
                guild.members.me.id,

            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        }

    ];


    // ==========================================
    // TICKET NUMBER
    // ==========================================

    const ticketNumber =
        guild.channels.cache.filter(
            channel =>
                channel.parentId === categoryId &&
                channel.topic?.startsWith(
                    'ticket-owner:'
                )
        ).size + 1;


    const paddedNumber =
        String(ticketNumber)
            .padStart(3, '0');


    // ==========================================
    // CHANNEL NAME
    // ==========================================

    const safeUsername =
        user.username
            .toLowerCase()
            .replace(
                /[^a-z0-9-]/g,
                '-'
            );


    const channelName =
        `${ticketType}-${safeUsername}-${paddedNumber}`;


    // ==========================================
    // CREATE CHANNEL
    // ==========================================

    const ticketChannel =
        await guild.channels.create({

            name:
                channelName,

            type:
                ChannelType.GuildText,

            parent:
                categoryId,

            topic:
                `ticket-owner:${user.id}` +
                `|ticket-type:${ticketType}`,

            permissionOverwrites

        });


    // ==========================================
    // CREATION RESPONSE
    // ==========================================

    await interaction.reply({

        content:
            `✅ Your ticket has been created: ${ticketChannel}`,

        flags:
            MessageFlags.Ephemeral

    });


    // ==========================================
    // STAFF TAG MESSAGE
    // ==========================================

    await ticketChannel.send({

        content:
            `${user} <@&${typeConfig.roleId}>`

    });


    // ==========================================
    // BUILD FORM RESPONSES
    // ==========================================

    const responseLines = [];


    for (
        const question of
        typeConfig.questions || []
    ) {

        let answer =
            answers[question.id];


        if (
            answer === undefined ||
            answer === null ||
            answer === ''
        ) {

            answer =
                'N/A';
        }


        if (
            question.type ===
            'dropdown'
        ) {

            const selectedOption =
                question.options?.find(
                    option =>
                        option.value ===
                        answer
                );


            if (selectedOption) {

                answer =
                    selectedOption.label;
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


    // ==========================================
    // GET CUSTOM BUTTON EMOJIS
    // ==========================================

    const claimEmoji =
        getTicketEmoji(
            guild,
            'claim'
        );

    const closeEmoji =
        getTicketEmoji(
            guild,
            'close'
        );

    const handoffEmoji =
        getTicketEmoji(
            guild,
            'handoff'
        );


    // ==========================================
    // BUTTONS
    // ==========================================

    const ticketButtons =
        new ActionRowBuilder()
            .addComponents(

                new ButtonBuilder()
                    .setCustomId(
                        'ticket_claim'
                    )
                    .setLabel(
                        'Claim'
                    )
                    .setStyle(
                        ButtonStyle.Success
                    )
                    .setEmoji(
                        claimEmoji
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'ticket_close'
                    )
                    .setLabel(
                        'Close'
                    )
                    .setStyle(
                        ButtonStyle.Danger
                    )
                    .setEmoji(
                        closeEmoji
                    ),

                new ButtonBuilder()
                    .setCustomId(
                        'ticket_handoff'
                    )
                    .setLabel(
                        'Hand Off'
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    )
                    .setEmoji(
                        handoffEmoji
                    )

            );


    // ==========================================
    // MAIN TICKET CONTAINER
    // ==========================================

    const welcomeContainer =
        new ContainerBuilder()

            // IMAGE
            .addMediaGalleryComponents(

                new MediaGalleryBuilder()
                    .addItems(

                        new MediaGalleryItemBuilder()
                            .setURL(
                                'attachment://ticket-dashboard.png'
                            )

                    )

            )

            // DIVIDER
            .addSeparatorComponents(

                new SeparatorBuilder()
                    .setDivider(true)

            )

            // WELCOME
            .addTextDisplayComponents(

                new TextDisplayBuilder()
                    .setContent(

                        '**Thank you for using the MSRP support system**\n\n' +
                        'One of our support staff will assist you shortly, ' +
                        'please provide any evidence or required context that ' +
                        'may help our staff.'

                    )

            )

            // DIVIDER
            .addSeparatorComponents(

                new SeparatorBuilder()
                    .setDivider(true)

            )

            // FORM RESPONSES
            .addTextDisplayComponents(

                new TextDisplayBuilder()
                    .setContent(

                        '__Details & Information__\n\n' +
                        responsesText

                    )

            )

            // DIVIDER
            .addSeparatorComponents(

                new SeparatorBuilder()
                    .setDivider(true)

            )

            // BOTTOM IMAGE
            .addMediaGalleryComponents(

                new MediaGalleryBuilder()
                    .addItems(

                        new MediaGalleryItemBuilder()
                            .setURL(
                                'attachment://image.png'
                            )

                    )

            )

            // BUTTONS INSIDE CONTAINER
            .addActionRowComponents(
                ticketButtons
            );


    // ==========================================
    // SEND MAIN CONTAINER
    // ==========================================

    await ticketChannel.send({

        components: [
            welcomeContainer
        ],

        files: [

            {
                attachment:
                    path.join(
                        __dirname,
                        '..',
                        'images',
                        'ticket-dashboard.png'
                    ),

                name:
                    'ticket-dashboard.png'
            },

            {
                attachment:
                    path.join(
                        __dirname,
                        '..',
                        'images',
                        'image.png'
                    ),

                name:
                    'image.png'
            }

        ],

        flags:
            MessageFlags.IsComponentsV2

    });

}


module.exports = {
    createTicket
};