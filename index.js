console.log('🚀 INDEX.JS STARTED');

console.log('📦 Loading dotenv...');

require('dotenv').config();

console.log('✅ Dotenv loaded');

console.log('📦 Loading discord.js...');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    MessageFlags,
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ContainerBuilder,
    TextDisplayBuilder
} = require('discord.js');

console.log('✅ discord.js loaded');


const ticketSetup =
    require('./tickets/ticketSetup');

const {
    createTicket
} = require('./tickets/ticketCreate');

const config =
    require('./tickets/ticketConfig');


// ==========================================
// CLIENT
// ==========================================

const client =
    new Client({

        intents: [

            GatewayIntentBits.Guilds,

            GatewayIntentBits.GuildMembers

        ]

    });


// ==========================================
// SUPPORT ROLE CHECK
// ==========================================

function isSupportMember(member) {

    if (
        !member ||
        !member.roles
    ) {

        return false;
    }


    return (

        member.roles.cache.has(
            config.supportStaffRoleId
        ) ||

        member.roles.cache.has(
            config.seniorSupportStaffRoleId
        ) ||

        member.roles.cache.has(
            config.reportsAppealsRoleId
        )

    );
}


// ==========================================
// GET TICKET OWNER
// ==========================================

function getTicketOwnerId(channel) {

    const match =
        channel.topic?.match(
            /ticket-owner:(\d+)/
        );

    return match
        ? match[1]
        : null;
}


// ==========================================
// GET TICKET TYPE
// ==========================================

function getTicketType(channel) {

    const match =
        channel.topic?.match(
            /ticket-type:([^|]+)/
        );

    return match
        ? match[1]
        : null;
}


// ==========================================
// GET CLAIMED USER
// ==========================================

function getClaimedUserId(channel) {

    const match =
        channel.topic?.match(
            /claimed-by:(\d+)/
        );

    return match
        ? match[1]
        : null;
}


// ==========================================
// GET TICKET TYPE NAME
// ==========================================

function getTicketTypeName(channel) {

    const ticketType =
        getTicketType(channel);

    if (
        ticketType &&
        config.ticketTypes[ticketType]
    ) {

        return config.ticketTypes[
            ticketType
        ].name;
    }

    return 'support';
}


// ==========================================
// BOT READY
// ==========================================

client.once(
    'clientReady',
    async () => {

        console.log(
            `✅ Logged in as ${client.user.tag}`
        );

        console.log(
            '🤖 MSRP Bot is online!'
        );


        const rest =
            new REST({
                version: '10'
            })
            .setToken(
                process.env.DISCORD_TOKEN
            );


        try {

            await rest.put(

                Routes.applicationGuildCommands(

                    client.user.id,

                    process.env.DISCORD_GUILD_ID

                ),

                {

                    body: [

                        ticketSetup
                            .command
                            .toJSON()

                    ]

                }

            );


            console.log(
                '✅ Slash commands registered!'
            );


        } catch (error) {

            console.error(
                '❌ Failed to register slash commands:',
                error
            );

        }

    }
);


// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on(
    'interactionCreate',
    async interaction => {


        // ==========================================
        // SLASH COMMANDS
        // ==========================================

        if (
            interaction.isChatInputCommand()
        ) {

            if (
                interaction.commandName ===
                'send-ticket-dashboard'
            ) {

                await ticketSetup.execute(
                    interaction
                );

                return;
            }

        }


        // ==========================================
        // STRING SELECT MENUS
        // ==========================================

        if (
            interaction.isStringSelectMenu()
        ) {

            if (
                interaction.customId ===
                'ticket_type_select'
            ) {

                const ticketType =
                    interaction.values[0];

                const typeConfig =
                    config.ticketTypes[
                        ticketType
                    ];


                if (!typeConfig) {

                    await interaction.reply({

                        content:
                            '❌ This ticket type does not exist.',

                        flags:
                            MessageFlags.Ephemeral

                    });

                    return;
                }


                const questions =
                    typeConfig.questions ||
                    [];


                const modal =
                    new ModalBuilder()

                        .setCustomId(
                            `ticket_form:${ticketType}`
                        )

                        .setTitle(
                            typeConfig.name
                        );


                for (
                    const question of
                    questions.slice(0, 5)
                ) {


                    // ==========================================
                    // DROPDOWN
                    // ==========================================

                    if (
                        question.type ===
                        'dropdown'
                    ) {

                        const options =
                            question.options.map(
                                option => {

                                    const builder =
                                        new StringSelectMenuOptionBuilder()
                                            .setLabel(
                                                option.label
                                            )
                                            .setValue(
                                                option.value
                                            );


                                    if (
                                        option.description
                                    ) {

                                        builder.setDescription(
                                            option.description
                                        );

                                    }


                                    return builder;

                                }
                            );


                        const select =
                            new StringSelectMenuBuilder()

                                .setCustomId(
                                    question.id
                                )

                                .setPlaceholder(
                                    question.placeholder ||
                                    'Select an option...'
                                )

                                .setMinValues(1)

                                .setMaxValues(1)

                                .setRequired(
                                    question.required ??
                                    true
                                )

                                .addOptions(
                                    options
                                );


                        const label =
                            new LabelBuilder()

                                .setLabel(
                                    question.label
                                )

                                .setStringSelectMenuComponent(
                                    select
                                );


                        modal.addLabelComponents(
                            label
                        );

                        continue;
                    }


                    // ==========================================
                    // TEXT INPUT
                    // ==========================================

                    const input =
                        new TextInputBuilder()

                            .setCustomId(
                                question.id
                            )

                            .setStyle(

                                question.style ===
                                'Short'

                                    ? TextInputStyle.Short

                                    : TextInputStyle.Paragraph

                            )

                            .setRequired(
                                question.required ??
                                true
                            );


                    if (
                        question.placeholder
                    ) {

                        input.setPlaceholder(
                            question.placeholder
                        );

                    }


                    if (
                        question.minLength !==
                        undefined
                    ) {

                        input.setMinLength(
                            question.minLength
                        );

                    }


                    if (
                        question.maxLength !==
                        undefined
                    ) {

                        input.setMaxLength(
                            question.maxLength
                        );

                    }


                    const label =
                        new LabelBuilder()

                            .setLabel(
                                question.label
                            )

                            .setTextInputComponent(
                                input
                            );


                    modal.addLabelComponents(
                        label
                    );

                }


                await interaction.showModal(
                    modal
                );

                return;
            }

        }


        // ==========================================
        // MODALS
        // ==========================================

        if (
            interaction.isModalSubmit()
        ) {


            // ==========================================
            // HAND OFF MODAL
            // ==========================================

            if (
                interaction.customId ===
                'ticket_handoff_modal'
            ) {

                const channel =
                    interaction.channel;


                if (
                    !isSupportMember(
                        interaction.member
                    )
                ) {

                    await interaction.reply({

                        content:
                            'Only a support member can use this. The ticket must be claimed before using this.',

                        flags:
                            MessageFlags.Ephemeral

                    });

                    return;
                }


                const claimedBy =
                    getClaimedUserId(
                        channel
                    );


                if (!claimedBy) {

                    await interaction.reply({

                        content:
                            'Only a support member can use this. The ticket must be claimed before using this.',

                        flags:
                            MessageFlags.Ephemeral

                    });

                    return;
                }


                const selected =
                    interaction.fields
                        .getStringSelectValues(
                            'handoff_destination'
                        )[0];


                let newCategoryId;

                let destinationName;


                if (
                    selected ===
                    'reports_appeals'
                ) {

                    newCategoryId =
                        config
                            .reportsAppealsTicketCategoryId;

                    destinationName =
                        'Reports & Appeals Tickets';


                } else if (
                    selected ===
                    'support'
                ) {

                    newCategoryId =
                        config
                            .supportTicketCategoryId;

                    destinationName =
                        'Support Tickets';


                } else if (
                    selected ===
                    'senior'
                ) {

                    newCategoryId =
                        config
                            .seniorTicketCategoryId;

                    destinationName =
                        'Senior Support Tickets';


                } else {

                    await interaction.reply({

                        content:
                            '❌ Invalid hand off destination.',

                        flags:
                            MessageFlags.Ephemeral

                    });

                    return;
                }


                const newChannelName =
                    channel.name.replace(
                        /^CLAIMED-/i,
                        ''
                    );


                await channel.setName(
                    newChannelName
                );


                await channel.setParent(
                    newCategoryId,
                    {
                        lockPermissions: false
                    }
                );


                const updatedTopic =
                    (channel.topic || '')
                        .replace(
                            /\|claimed-by:\d+/,
                            ''
                        );


                await channel.setTopic(
                    updatedTopic
                );


                const ownerId =
                    getTicketOwnerId(
                        channel
                    );


                const ownerMention =
                    ownerId
                        ? `<@${ownerId}>`
                        : 'Customer';


                const handoffContainer =
                    new ContainerBuilder()
                        .addTextDisplayComponents(

                            new TextDisplayBuilder()
                                .setContent(

                                    `${ownerMention} | This ticket has been handed to ${destinationName}, a support member will be with you shortly`

                                )

                        );


                await channel.send({

                    components: [
                        handoffContainer
                    ],

                    flags:
                        MessageFlags.IsComponentsV2

                });


                await interaction.reply({

                    content:
                        '✅ Ticket handed off successfully.',

                    flags:
                        MessageFlags.Ephemeral

                });

                return;
            }


            // ==========================================
            // NORMAL TICKET FORM
            // ==========================================

            if (
                interaction.customId.startsWith(
                    'ticket_form:'
                )
            ) {

                const ticketType =
                    interaction.customId
                        .split(':')[1];


                const typeConfig =
                    config.ticketTypes[
                        ticketType
                    ];


                if (!typeConfig) {

                    await interaction.reply({

                        content:
                            '❌ This ticket type does not exist.',

                        flags:
                            MessageFlags.Ephemeral

                    });

                    return;
                }


                const answers = {};


                for (
                    const question of
                    typeConfig.questions || []
                ) {

                    try {

                        if (
                            question.type ===
                            'dropdown'
                        ) {

                            const values =
                                interaction.fields
                                    .getStringSelectValues(
                                        question.id
                                    );


                            answers[
                                question.id
                            ] =
                                values[0];

                        } else {

                            answers[
                                question.id
                            ] =
                                interaction.fields
                                    .getTextInputValue(
                                        question.id
                                    );

                        }

                    } catch (error) {

                        console.error(

                            `❌ Failed to collect question "${question.id}":`,

                            error

                        );

                    }

                }


                try {

                    await createTicket(
                        interaction,
                        ticketType,
                        answers
                    );

                } catch (error) {

                    console.error(
                        '❌ Ticket form submission error:',
                        error
                    );


                    if (
                        !interaction.replied &&
                        !interaction.deferred
                    ) {

                        await interaction.reply({

                            content:
                                '❌ Something went wrong while creating your ticket.',

                            flags:
                                MessageFlags.Ephemeral

                        });

                    }

                }

                return;
            }

        }


        // ==========================================
        // BUTTONS
        // ==========================================

        if (
            interaction.isButton()
        ) {


            // ==========================================
            // TICKET RULES
            // ==========================================

            if (
                interaction.customId ===
                'ticket_rules'
            ) {

                await interaction.reply({

                    content:
                        config
                            .ticketRulesButton
                            .message,

                    flags:
                        MessageFlags.Ephemeral

                });

                return;
            }


            // ==========================================
            // INFORMATION
            // ==========================================

            if (
                interaction.customId ===
                'ticket_information'
            ) {

                await interaction.reply({

                    content:
                        config
                            .informationButton
                            .message,

                    flags:
                        MessageFlags.Ephemeral

                });

                return;
            }


            // ==========================================
            // TICKET TYPE BUTTONS
            // ==========================================

            if (
                interaction.customId.startsWith(
                    'ticket_'
                ) &&

                ![
                    'ticket_claim',
                    'ticket_close',
                    'ticket_handoff'
                ].includes(
                    interaction.customId
                )
            ) {

                const ticketType =
                    interaction.customId.replace(
                        'ticket_',
                        ''
                    );


                try {

                    await createTicket(
                        interaction,
                        ticketType
                    );

                } catch (error) {

                    console.error(
                        '❌ Ticket creation error:',
                        error
                    );


                    if (
                        !interaction.replied &&
                        !interaction.deferred
                    ) {

                        await interaction.reply({

                            content:
                                '❌ Something went wrong while creating your ticket.',

                            flags:
                                MessageFlags.Ephemeral

                        });

                    }

                }

                return;
            }


            // ==========================================
            // CLAIM
            // ==========================================

            if (
                interaction.customId ===
                'ticket_claim'
            ) {

                const member =
                    interaction.member;


                if (
                    !isSupportMember(
                        member
                    )
                ) {

                    await interaction.reply({

                        content:
                            'Only a member of the MSRP support team can use this',

                        flags:
                            MessageFlags.Ephemeral

                    });

                    return;
                }


                const channel =
                    interaction.channel;


                if (
                    !channel ||
                    !channel.isTextBased()
                ) {

                    return;
                }


                const ownerId =
                    getTicketOwnerId(
                        channel
                    );


                const ownerMention =
                    ownerId
                        ? `<@${ownerId}>`
                        : 'Customer';


                const ticketTypeName =
                    getTicketTypeName(
                        channel
                    );


                let newName =
                    channel.name;


                if (
                    !newName.startsWith(
                        'CLAIMED-'
                    )
                ) {

                    newName =
                        `CLAIMED-${newName}`;

                }


                await channel.setName(
                    newName
                );


                let topic =
                    channel.topic || '';


                topic =
                    topic.replace(
                        /\|claimed-by:\d+/,
                        ''
                    );


                topic +=
                    `|claimed-by:${interaction.user.id}`;


                await channel.setTopic(
                    topic
                );


                const claimContainer =
                    new ContainerBuilder()
                        .addTextDisplayComponents(

                            new TextDisplayBuilder()
                                .setContent(

                                    `${ownerMention} | ${interaction.user} has claimed this ${ticketTypeName} ticket.`

                                )

                        );


                await channel.send({

                    components: [
                        claimContainer
                    ],

                    flags:
                        MessageFlags.IsComponentsV2

                });


                await interaction.reply({

                    content:
                        '✅ Ticket claimed.',

                    flags:
                        MessageFlags.Ephemeral

                });

                return;
            }


            // ==========================================
            // CLOSE
            // ==========================================

            if (
                interaction.customId ===
                'ticket_close'
            ) {

                await interaction.deferUpdate();

                return;
            }


            // ==========================================
            // HAND OFF
            // ==========================================

            if (
                interaction.customId ===
                'ticket_handoff'
            ) {

                const member =
                    interaction.member;


                if (
                    !isSupportMember(
                        member
                    )
                ) {

                    await interaction.reply({

                        content:
                            'Only a support member can use this. The ticket must be claimed before using this.',

                        flags:
                            MessageFlags.Ephemeral

                    });

                    return;
                }


                const channel =
                    interaction.channel;


                const claimedBy =
                    getClaimedUserId(
                        channel
                    );


                if (!claimedBy) {

                    await interaction.reply({

                        content:
                            'Only a support member can use this. The ticket must be claimed before using this.',

                        flags:
                            MessageFlags.Ephemeral

                    });

                    return;
                }


                const modal =
                    new ModalBuilder()

                        .setCustomId(
                            'ticket_handoff_modal'
                        )

                        .setTitle(
                            'Hand Off Ticket'
                        );


                const select =
                    new StringSelectMenuBuilder()

                        .setCustomId(
                            'handoff_destination'
                        )

                        .setPlaceholder(
                            'Select a destination...'
                        )

                        .setMinValues(1)

                        .setMaxValues(1)

                        .addOptions(

                            new StringSelectMenuOptionBuilder()

                                .setLabel(
                                    'Reports & Appeals Tickets'
                                )

                                .setValue(
                                    'reports_appeals'
                                ),

                            new StringSelectMenuOptionBuilder()

                                .setLabel(
                                    'Support Tickets'
                                )

                                .setValue(
                                    'support'
                                ),

                            new StringSelectMenuOptionBuilder()

                                .setLabel(
                                    'Senior Support Tickets'
                                )

                                .setValue(
                                    'senior'
                                )

                        );


                const label =
                    new LabelBuilder()

                        .setLabel(
                            'Where would you like to hand this to?'
                        )

                        .setStringSelectMenuComponent(
                            select
                        );


                modal.addLabelComponents(
                    label
                );


                await interaction.showModal(
                    modal
                );

                return;
            }

        }

    }
);


// ==========================================
// LOGIN
// ==========================================

console.log(
    '🔄 Attempting to log in...'
);

console.log(
    '🔑 Token loaded:',
    !!process.env.DISCORD_TOKEN
);

console.log(
    '🏠 Guild ID:',
    process.env.DISCORD_GUILD_ID
);


client.login(
    process.env.DISCORD_TOKEN
);