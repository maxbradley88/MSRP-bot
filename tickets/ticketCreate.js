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

async function createTicket(interaction, ticketType, answers = {}) {

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

    // ==========================================
    // DETERMINE CATEGORY
    // ==========================================

    const isSeniorTicket = typeConfig.category === 2;
    const isReportsAppealsTicket = typeConfig.category === 3;

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
    // CHECK USER TICKET LIMIT
    // ==========================================

    const userTickets =
        guild.channels.cache.filter(channel =>
            channel.topic?.startsWith(
                `ticket-owner:${user.id}`
            )
        );

    const userTicketCount =
        userTickets.size;


    if (
        !isSeniorTicket &&
        userTicketCount >=
            config.maxTicketsPerUser
    ) {

        await interaction.reply({
            content:
                `❌ You already have the maximum number of open tickets (${config.maxTicketsPerUser}).`,
            flags:
                MessageFlags.Ephemeral
        });

        return;
    }


    if (
        isSeniorTicket &&
        userTicketCount >=
            config.maxSeniorTicketsPerUser
    ) {

        await interaction.reply({
            content:
                `❌ You already have the maximum number of open Senior Support tickets (${config.maxSeniorTicketsPerUser}).`,
            flags:
                MessageFlags.Ephemeral
        });

        return;
    }


    // ==========================================
    // PERMISSIONS
    // ==========================================

   const supportRole = await guild.roles.fetch(
    config.supportStaffRoleId
);

const seniorSupportRole = await guild.roles.fetch(
    config.seniorSupportStaffRoleId
);

const reportsAppealsRole = await guild.roles.fetch(
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

const permissionOverwrites = [
    {
        id: guild.roles.everyone.id,
        deny: [
            PermissionFlagsBits.ViewChannel
        ]
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
        String(ticketNumber).padStart(3, '0');


    // ==========================================
    // CHANNEL NAME
    // ==========================================

    const safeUsername =
        user.username
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-');

    const channelName =
        `${ticketType}-${safeUsername}-${paddedNumber}`;


    // ==========================================
    // CREATE TICKET CHANNEL
    // ==========================================

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
    // TOP NORMAL MESSAGE
    // ==========================================
    //
    // This is intentionally OUTSIDE the
    // Components V2 container.
    //
    // Customer + correct department role.
    //

    await ticketChannel.send({

        content:
            `${user} <@&${typeConfig.roleId}>`
    });


    // ==========================================
    // FORM RESPONSES
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
                'No response provided.';
        }


        // ==========================================
        // GET DROPDOWN LABEL
        // ==========================================

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
    // COMPONENTS V2 WELCOME CONTAINER
    // ==========================================

    const welcomeContainer =
        new ContainerBuilder()


            // ==========================================
            // TOP IMAGE
            // ==========================================

            .addMediaGalleryComponents(

                new MediaGalleryBuilder()
                    .addItems(

                        new MediaGalleryItemBuilder()
                            .setURL(
                                'attachment://ticket-dashboard.png'
                            )

                    )
            )


            // ==========================================
            // DIVIDER
            // ==========================================

            .addSeparatorComponents(

                new SeparatorBuilder()
                    .setDivider(true)

            )


            // ==========================================
            // WELCOME MESSAGE
            // ==========================================

            .addTextDisplayComponents(

                new TextDisplayBuilder()
                    .setContent(

                        '**Thank you for using the MSRP support system**\n\n' +
                        'One of our support staff will assist you shortly, ' +
                        'please provide any evidence or required context that ' +
                        'may help our staff.'

                    )

            )


            // ==========================================
            // DIVIDER
            // ==========================================

            .addSeparatorComponents(

                new SeparatorBuilder()
                    .setDivider(true)

            )


            // ==========================================
            // FORM RESPONSES
            // ==========================================

            .addTextDisplayComponents(

                new TextDisplayBuilder()
                    .setContent(
                        responsesText
                    )

            )


            // ==========================================
            // DIVIDER
            // ==========================================

            .addSeparatorComponents(

                new SeparatorBuilder()
                    .setDivider(true)

            )


            // ==========================================
            // BOTTOM IMAGE
            // ==========================================

            .addMediaGalleryComponents(

                new MediaGalleryBuilder()
                    .addItems(

                        new MediaGalleryItemBuilder()
                            .setURL(
                                'attachment://image.png'
                            )

                    )

            );


    // ==========================================
    // SEND WELCOME CONTAINER
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


    // ==========================================
    // TICKET CONTROL BUTTONS
    // ==========================================

    const ticketButtons =
        new ActionRowBuilder()
            .addComponents(


                // ==========================================
                // CLAIM
                // ==========================================

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

                    .setEmoji('✓'),


                // ==========================================
                // CLOSE
                // ==========================================

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

                    .setEmoji('🔒'),


                // ==========================================
                // HAND OFF
                // ==========================================

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

                    .setEmoji('↗')

            );


    // ==========================================
    // SEND BUTTONS OUTSIDE CONTAINER
    // ==========================================

    await ticketChannel.send({

        components: [
            ticketButtons
        ]

    });

}


module.exports = {
    createTicket
};