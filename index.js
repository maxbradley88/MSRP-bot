require('dotenv').config();



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



const ticketSetup = require('./tickets/ticketSetup');

const { createTicket } = require('./tickets/ticketCreate');

const config = require('./tickets/ticketConfig');



let testingOverrides = {

    allowTicketCreatorStaffActions: false

};



try {

    testingOverrides = require(

        './tickets/testingOverrides'

    );

} catch (error) {

    if (

        error?.code !== 'MODULE_NOT_FOUND'

    ) {

        console.warn(

            '[TESTING OVERRIDES ERROR]',

            error

        );

    }

}



const client = new Client({

    intents: [

        GatewayIntentBits.Guilds,

        GatewayIntentBits.GuildMembers

    ]

});



const activeClaimChannels = new Set();



// ======================================================

// HELPERS

// ======================================================



function isSupportMember(member) {

    if (!member?.roles?.cache) return false;



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



function isSeniorSupportMember(member) {

    if (!member?.roles?.cache) return false;



    return member.roles.cache.has(

        config.seniorSupportStaffRoleId

    );

}



function isTicketOwnerStaffTestingAllowed(

    member,

    ownerId,

    userId

) {

    return (

        ownerId === userId &&

        testingOverrides

            .allowTicketCreatorStaffActions === true &&

        isSupportMember(member)

    );

}



function getTicketOwnerId(channel) {

    const match =

        channel.topic?.match(

            /(?:^|\|)ticket-owner:(\d+)/

        );



    return match ? match[1] : null;

}



function getTicketType(channel) {

    const match =

        channel.topic?.match(

            /(?:^|\|)ticket-type:([^|]+)/

        );



    return match ? match[1] : null;

}



function getClaimedUserId(channel) {

    const match =

        channel.topic?.match(

            /(?:^|\|)claimed-by:(\d+)/

        );



    return match ? match[1] : null;

}



function getTicketTypeName(channel) {

    const type =

        getTicketType(channel);



    if (

        type &&

        config.ticketTypes[type]

    ) {

        return (

            config.ticketTypes[type].name ||

            config.ticketTypes[type].label ||

            'support'

        );

    }



    return 'support';

}




function getTicketDepartment(channel) {

    if (!channel) return null;

    if (channel.parentId === config.supportTicketCategoryId) {
        return {
            key: 'support',
            name: 'Support Tickets',
            categoryId: config.supportTicketCategoryId,
            roleId: config.supportStaffRoleId
        };
    }

    if (channel.parentId === config.seniorTicketCategoryId) {
        return {
            key: 'senior',
            name: 'Senior Support Tickets',
            categoryId: config.seniorTicketCategoryId,
            roleId: config.seniorSupportStaffRoleId
        };
    }

    if (channel.parentId === config.reportsAppealsTicketCategoryId) {
        return {
            key: 'reports_appeals',
            name: 'Reports & Appeals Tickets',
            categoryId: config.reportsAppealsTicketCategoryId,
            roleId: config.reportsAppealsRoleId
        };
    }

    return null;
}


function stripClaimedPrefix(channelName) {

    return String(channelName || '')
        .replace(
            /^(?:claimed-)+/i,
            ''
        );
}

// ======================================================

// READY

// ======================================================



client.once(

    'clientReady',

    async () => {



        console.log(

            `Logged in as ${client.user.tag}`

        );



        console.log(

            'MSRP Bot is online.'

        );



        const rest =

            new REST({

                version: '10'

            }).setToken(

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

                        ticketSetup.command.toJSON()

                    ]

                }

            );



            console.log(

                'Slash commands registered.'

            );



        } catch (error) {



            console.error(

                'Failed to register slash commands:',

                error

            );

        }

    }

);



// ======================================================

// INTERACTIONS

// ======================================================



client.on(

    'interactionCreate',

    async interaction => {



        try {



            // ==================================================

            // SLASH COMMANDS

            // ==================================================



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

                }



                return;

            }



            // ==================================================

            // TICKET TYPE SELECT

            // ==================================================



            if (

                interaction.isStringSelectMenu() &&

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



                const modal =

                    new ModalBuilder()

                        .setCustomId(

                            `ticket_form:${ticketType}`

                        )

                        .setTitle(

                            typeConfig.name ||

                            typeConfig.label ||

                            'Ticket'

                        );



                for (

                    const question of

                    (

                        typeConfig.questions ||

                        []

                    ).slice(0, 5)

                ) {



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



                        modal.addLabelComponents(

                            new LabelBuilder()

                                .setLabel(

                                    question.label

                                )

                                .setStringSelectMenuComponent(

                                    select

                                )

                        );



                        continue;

                    }



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



                    modal.addLabelComponents(

                        new LabelBuilder()

                            .setLabel(

                                question.label

                            )

                            .setTextInputComponent(

                                input

                            )

                    );

                }



                await interaction.showModal(

                    modal

                );



                return;

            }



            // ==================================================

            // MODALS

            // ==================================================



            if (

                interaction.isModalSubmit()

            ) {



                // ==================================================

                // CLOSE MODAL

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_close_modal'

                ) {



                    const channel =

                        interaction.channel;



                    if (

                        !channel ||

                        !channel.isTextBased()

                    ) {

                        await interaction.reply({

                            content:

                                '❌ This ticket channel could not be found.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const ownerId =

                        getTicketOwnerId(

                            channel

                        );



                    const isSenior =

                        isSeniorSupportMember(

                            interaction.member

                        );



                    if (

                        ownerId ===

                        interaction.user.id &&

                        !isTicketOwnerStaffTestingAllowed(

                            interaction.member,

                            ownerId,

                            interaction.user.id

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ The user who created the ticket cannot use staff ticket buttons.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSupportMember(

                            interaction.member

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ Only a member of the MSRP support team can use this.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const claimedBy =

                        getClaimedUserId(

                            channel

                        );



                    if (

                        !isSenior &&

                        !claimedBy

                    ) {

                        await interaction.reply({

                            content:

                                '❌ You must claim this ticket before you can close it.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSenior &&

                        claimedBy !==

                        interaction.user.id

                    ) {

                        await interaction.reply({

                            content:

                                '❌ You can only close tickets that you have claimed.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const reason =

                        interaction.fields

                            .getTextInputValue(

                                'close_reason'

                            )

                            .trim();



                    if (!reason) {

                        await interaction.reply({

                            content:

                                '❌ A reason for closing the ticket is required.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    try {

                        await interaction.reply({

                            content:

                                '✅ Closing ticket...',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        const auditReason =

                            (

                                `MSRP ticket closed by ${interaction.user.username} ` +

                                `(${interaction.user.id}): ${reason}`

                            ).slice(0, 512);



                        console.log(

                            `[TICKET CLOSE] ${channel.name} | ` +

                            `Closed by ${interaction.user.username} ` +

                            `(${interaction.user.id}) | ` +

                            `Reason: ${reason}`

                        );



                        await channel.delete(

                            auditReason

                        );



                    } catch (error) {

                        console.error(

                            '[CLOSE MODAL ERROR]',

                            error

                        );



                        try {

                            await interaction.editReply({

                                content:

                                    '❌ Something went wrong while closing this ticket.'

                            });

                        } catch {}

                    }



                    return;

                }



                // ==================================================

                // HAND OFF MODAL

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_handoff_modal'

                ) {



                    const channel =

                        interaction.channel;



                    if (

                        !channel ||

                        !channel.isTextBased()

                    ) {

                        await interaction.reply({

                            content:

                                '❌ This ticket channel could not be found.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const ownerId =

                        getTicketOwnerId(

                            channel

                        );



                    const claimedBy =

                        getClaimedUserId(

                            channel

                        );



                    const isSenior =

                        isSeniorSupportMember(

                            interaction.member

                        );



                    if (

                        ownerId ===

                        interaction.user.id &&

                        !isTicketOwnerStaffTestingAllowed(

                            interaction.member,

                            ownerId,

                            interaction.user.id

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ The user who created the ticket cannot use staff ticket buttons.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSupportMember(

                            interaction.member

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ Only a support member can use this.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSenior &&

                        !claimedBy

                    ) {

                        await interaction.reply({

                            content:

                                '❌ You must claim this ticket before you can hand it off.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSenior &&

                        claimedBy !==

                        interaction.user.id

                    ) {

                        await interaction.reply({

                            content:

                                '❌ You can only hand off tickets that you have claimed.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    try {



                        await interaction.deferReply({

                            flags:

                                MessageFlags.Ephemeral

                        });



                        const selected =

                            interaction.fields

                                .getStringSelectValues(

                                    'handoff_destination'

                                )?.[0];



                        if (!selected) {

                            await interaction.editReply({

                                content:

                                    '❌ Please select a hand off destination.'

                            });



                            return;

                        }



                        let notes = '';



                        try {

                            notes =

                                interaction.fields

                                    .getTextInputValue(

                                        'handoff_notes'

                                    )

                                    ?.trim() || '';

                        } catch {}



                        const currentDepartment =

                            getTicketDepartment(

                                channel

                            );



                        if (

                            selected ===

                            'unclaimed'

                        ) {



                            const newName =

                                stripClaimedPrefix(

                                    channel.name

                                );



                            let newTopic =

                                channel.topic || '';



                            newTopic =

                                newTopic.replace(

                                    /\|claimed-by:\d+/g,

                                    ''

                                );



                            await channel.edit({

                                name: newName,

                                topic: newTopic

                            });



                            const ownerMention =

                                ownerId

                                    ? `<@${ownerId}>`

                                    : 'Customer';



                            const departmentRoleId =

                                currentDepartment?.roleId;



                            const departmentRoleMention =

                                departmentRoleId

                                    ? `<@&${departmentRoleId}>`

                                    : 'Support Staff';



                            let message =

                                `${ownerMention} ${departmentRoleMention} | ` +

                                `${interaction.user} has unclaimed this ticket, ` +

                                'a support member will be with you shortly.';



                            if (notes) {

                                message +=

                                    `\n\n**Notes**\n` +

                                    notes

                                        .split('\n')

                                        .map(

                                            line =>

                                                `> ${line}`

                                        )

                                        .join('\n');

                            }



                            const container =

                                new ContainerBuilder()

                                    .addTextDisplayComponents(

                                        new TextDisplayBuilder()

                                            .setContent(

                                                message

                                            )

                                    );



                            await interaction.editReply({

                                content:

                                    '✅ Ticket unclaimed successfully.'

                            });



                            try {

                                await channel.send({

                                    components: [

                                        container

                                    ],

                                    flags:

                                        MessageFlags.IsComponentsV2,

                                    allowedMentions: {

                                        users: [

                                            ...new Set(

                                                [

                                                    ownerId,

                                                    interaction.user.id

                                                ].filter(Boolean)

                                            )

                                        ],

                                        roles:

                                            departmentRoleId

                                                ? [departmentRoleId]

                                                : []

                                    }

                                });

                            } catch (messageError) {

                                console.error(

                                    '[UNCLAIM MESSAGE ERROR]',

                                    messageError

                                );



                                try {

                                    await channel.send({

                                        content:

                                            message,

                                        allowedMentions: {

                                            users: [

                                                ...new Set(

                                                    [

                                                        ownerId,

                                                        interaction.user.id

                                                    ].filter(Boolean)

                                                )

                                            ],

                                            roles:

                                                departmentRoleId

                                                    ? [departmentRoleId]

                                                    : []

                                        }

                                    });

                                } catch (fallbackError) {

                                    console.error(

                                        '[UNCLAIM FALLBACK MESSAGE ERROR]',

                                        fallbackError

                                    );

                                }

                            }



                            return;

                        }



                        let destination;



                        if (

                            selected ===

                            'reports_appeals'

                        ) {

                            destination = {

                                key:

                                    'reports_appeals',

                                name:

                                    'Reports & Appeals Tickets',

                                categoryId:

                                    config

                                        .reportsAppealsTicketCategoryId,

                                roleId:

                                    config.reportsAppealsRoleId

                            };



                        } else if (

                            selected ===

                            'support'

                        ) {

                            destination = {

                                key:

                                    'support',

                                name:

                                    'Support Tickets',

                                categoryId:

                                    config

                                        .supportTicketCategoryId,

                                roleId:

                                    config.supportStaffRoleId

                            };



                        } else if (

                            selected ===

                            'senior'

                        ) {

                            destination = {

                                key:

                                    'senior',

                                name:

                                    'Senior Support Tickets',

                                categoryId:

                                    config

                                        .seniorTicketCategoryId,

                                roleId:

                                    config

                                        .seniorSupportStaffRoleId

                            };



                        } else {

                            await interaction.editReply({

                                content:

                                    '❌ Invalid hand off destination.'

                            });



                            return;

                        }



                        if (

                            currentDepartment?.key ===

                            destination.key

                        ) {

                            await interaction.editReply({

                                content:

                                    '❌ This ticket is already in that department. Please reopen Hand Off and choose another option.'

                            });



                            return;

                        }



                        const newName =

                            stripClaimedPrefix(

                                channel.name

                            );



                        let newTopic =

                            channel.topic || '';



                        newTopic =

                            newTopic.replace(

                                /\|claimed-by:\d+/g,

                                ''

                            );



                        await channel.edit({

                            name: newName,

                            parent:

                                destination.categoryId,

                            topic: newTopic,

                            lockPermissions: false

                        });



                        const ownerMention =

                            ownerId

                                ? `<@${ownerId}>`

                                : 'Customer';



                        const destinationRoleMention =

                            destination.roleId

                                ? `<@&${destination.roleId}>`

                                : destination.name;



                        let message =

                            `${ownerMention} ${destinationRoleMention}\n\n` +

                            `**This ticket has been handed to ${destination.name}.**\n` +

                            'A support member will be with you shortly.';



                        if (notes) {

                            message +=

                                `\n\n**Notes from previous staff member**\n` +

                                notes

                                    .split('\n')

                                    .map(

                                        line =>

                                            `> ${line}`

                                    )

                                    .join('\n');

                        }



                        const container =

                            new ContainerBuilder()

                                .addTextDisplayComponents(

                                    new TextDisplayBuilder()

                                        .setContent(

                                            message

                                        )

                                );



                        await interaction.editReply({

                            content:

                                '✅ Ticket handed off successfully.'

                        });



                        try {

                            await channel.send({

                                components: [

                                    container

                                ],

                                flags:

                                    MessageFlags.IsComponentsV2,

                                allowedMentions: {

                                    users:

                                        ownerId

                                            ? [ownerId]

                                            : [],

                                    roles:

                                        destination.roleId

                                            ? [destination.roleId]

                                            : []

                                }

                            });

                        } catch (messageError) {

                            console.error(

                                '[HANDOFF MESSAGE ERROR]',

                                messageError

                            );



                            try {

                                await channel.send({

                                    content:

                                        message,

                                    allowedMentions: {

                                        users:

                                            ownerId

                                                ? [ownerId]

                                                : [],

                                        roles:

                                            destination.roleId

                                                ? [destination.roleId]

                                                : []

                                    }

                                });

                            } catch (fallbackError) {

                                console.error(

                                    '[HANDOFF FALLBACK MESSAGE ERROR]',

                                    fallbackError

                                );

                            }

                        }



                    } catch (error) {

                        console.error(

                            '[HANDOFF MODAL ERROR]',

                            error

                        );



                        try {

                            await interaction.editReply({

                                content:

                                    '❌ Something went wrong while handing off this ticket.'

                            });

                        } catch {}

                    }



                    return;

                }



                // ==================================================

                // NORMAL TICKET FORM

                // ==================================================



                if (

                    interaction.customId.startsWith(

                        'ticket_form:'

                    )

                ) {



                    const ticketType =

                        interaction.customId.split(':')[1];



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



                                answers[

                                    question.id

                                ] =

                                    interaction.fields

                                        .getStringSelectValues(

                                            question.id

                                        )[0];



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

                                `Failed to collect question "${question.id}":`,

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

                            'Ticket form submission error:',

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



            // ==================================================

            // BUTTONS

            // ==================================================



            if (

                interaction.isButton()

            ) {



                // ==================================================

                // RULES

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_rules'

                ) {



                    await interaction.reply({

                        content:

                            config.ticketRulesButton.message,

                        flags:

                            MessageFlags.Ephemeral

                    });



                    return;

                }



                // ==================================================

                // INFORMATION

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_information'

                ) {



                    await interaction.reply({

                        content:

                            config.informationButton.message,

                        flags:

                            MessageFlags.Ephemeral

                    });



                    return;

                }



                // ==================================================

                // TICKET CREATION

                // ==================================================



                if (

                    interaction.customId.startsWith(

                        'ticket\_'

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

                            'ticket\_',

                            ''

                        );



                    await createTicket(

                        interaction,

                        ticketType

                    );



                    return;

                }



                // ==================================================

                // CLAIM

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_claim'

                ) {



                    const channel =

                        interaction.channel;



                    const userId =

                        interaction.user.id;



                    const isSenior =

                        isSeniorSupportMember(

                            interaction.member

                        );



                    if (

                        !channel ||

                        !channel.isTextBased()

                    ) {

                        await interaction.reply({

                            content:

                                '❌ This ticket channel could not be found.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const ownerId =

                        getTicketOwnerId(

                            channel

                        );



                    if (

                        ownerId ===

                        userId &&

                        !isTicketOwnerStaffTestingAllowed(

                            interaction.member,

                            ownerId,

                            userId

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ The user who created the ticket cannot use staff ticket buttons.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSupportMember(

                            interaction.member

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ Only a member of the MSRP support team can use this.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const claimedBy =

                        getClaimedUserId(

                            channel

                        );



                    if (

                        claimedBy ===

                        userId

                    ) {

                        await interaction.reply({

                            content:

                                '❌ You have already claimed this ticket.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        claimedBy &&

                        !isSenior

                    ) {

                        await interaction.reply({

                            content:

                                `❌ This ticket has already been claimed by <@${claimedBy}>.`,

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        activeClaimChannels.has(

                            channel.id

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ Another claim action is already being processed for this ticket. Please try again.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    activeClaimChannels.add(

                        channel.id

                    );



                    try {



                        await interaction.reply({

                            content:

                                'Claiming ticket...',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        const latestClaim =

                            getClaimedUserId(

                                channel

                            );



                        if (

                            latestClaim &&

                            latestClaim !==

                            userId &&

                            !isSenior

                        ) {

                            await interaction.editReply({

                                content:

                                    `❌ This ticket has already been claimed by <@${latestClaim}>.`

                            });



                            return;

                        }



                        const ownerMention =

                            ownerId

                                ? `<@${ownerId}>`

                                : 'Customer';



                        const ticketTypeName =

                            getTicketTypeName(

                                channel

                            );



                        const newName =

                            `claimed-${

                                stripClaimedPrefix(

                                    channel.name

                                )

                            }`;



                        let topic =

                            channel.topic || '';



                        topic =

                            topic.replace(

                                /\|claimed-by:\d+/g,

                                ''

                            );



                        topic +=

                            `|claimed-by:${userId}`;



                        await channel.edit({

                            name: newName,

                            topic

                        });



                        const isTakeover =

                            Boolean(

                                latestClaim &&

                                latestClaim !==

                                userId

                            );



                        const claimText =

                            isTakeover

                                ? `${ownerMention} | This ticket is now being handled by ${interaction.user}.`

                                : `${ownerMention} | ${interaction.user} has claimed this ${ticketTypeName} ticket.`;



                        const container =

                            new ContainerBuilder()

                                .addTextDisplayComponents(

                                    new TextDisplayBuilder()

                                        .setContent(

                                            claimText

                                        )

                                );



                        await interaction.editReply({

                            content:

                                isTakeover

                                    ? '✅ Ticket taken over successfully.'

                                    : '✅ Ticket claimed.'

                        });



                        const mentionUsers =

                            [

                                ownerId,

                                userId

                            ].filter(Boolean);



                        try {

                            await channel.send({

                                components: [

                                    container

                                ],

                                flags:

                                    MessageFlags.IsComponentsV2,

                                allowedMentions: {

                                    users:

                                        [

                                            ...new Set(

                                                mentionUsers

                                            )

                                        ]

                                }

                            });



                        } catch (messageError) {

                            console.error(

                                '[CLAIM MESSAGE ERROR]',

                                messageError

                            );



                            try {

                                await channel.send({

                                    content:

                                        claimText,

                                    allowedMentions: {

                                        users:

                                            [

                                                ...new Set(

                                                    mentionUsers

                                                )

                                            ]

                                    }

                                });

                            } catch (fallbackError) {

                                console.error(

                                    '[CLAIM FALLBACK MESSAGE ERROR]',

                                    fallbackError

                                );

                            }

                        }



                    } catch (error) {

                        console.error(

                            '[CLAIM ERROR]',

                            error

                        );



                        try {

                            await interaction.editReply({

                                content:

                                    '❌ Something went wrong while claiming this ticket.'

                            });

                        } catch {}



                    } finally {

                        activeClaimChannels.delete(

                            channel.id

                        );

                    }



                    return;

                }



                // ==================================================

                // CLOSE

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_close'

                ) {



                    const channel =

                        interaction.channel;



                    if (

                        !channel ||

                        !channel.isTextBased()

                    ) {



                        await interaction.reply({

                            content:

                                '❌ This ticket channel could not be found.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const ownerId =
                        getTicketOwnerId(
                            channel
                        );

                    const isSenior =
                        isSeniorSupportMember(
                            interaction.member
                        );

                    if (
                        ownerId ===
                        interaction.user.id &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            interaction.user.id
                        )
                    ) {

                        await interaction.reply({
                            content:
                                '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    if (
                        !isSupportMember(
                            interaction.member
                        )
                    ) {

                        await interaction.reply({
                            content:
                                '❌ Only a member of the MSRP support team can use this.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    const claimedBy =
                        getClaimedUserId(
                            channel
                        );

                    // Senior Support can close any ticket, claimed or unclaimed.
                    // SS / R&A may only close a ticket they personally claimed.
                    if (
                        !isSenior &&
                        !claimedBy
                    ) {

                        await interaction.reply({
                            content:
                                '❌ You must claim this ticket before you can close it.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    if (
                        !isSenior &&
                        claimedBy !==
                        interaction.user.id
                    ) {

                        await interaction.reply({
                            content:
                                '❌ You can only close tickets that you have claimed.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }



                    const modal =

                        new ModalBuilder()

                            .setCustomId(

                                'ticket_close_modal'

                            )

                            .setTitle(

                                'Close Ticket'

                            );



                    const reasonInput =

                        new TextInputBuilder()

                            .setCustomId(

                                'close_reason'

                            )

                            .setStyle(

                                TextInputStyle.Paragraph

                            )

                            .setRequired(true)

                            .setMinLength(1)

                            .setMaxLength(500)

                            .setPlaceholder(

                                'Enter the reason for closing this ticket...'

                            );



                    modal.addLabelComponents(

                        new LabelBuilder()

                            .setLabel(

                                'Reason for close'

                            )

                            .setTextInputComponent(

                                reasonInput

                            )

                    );



                    await interaction.showModal(

                        modal

                    );



                    return;

                }



                // ==================================================

                // HAND OFF

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_handoff'

                ) {



                    const channel =

                        interaction.channel;



                    if (

                        !channel ||

                        !channel.isTextBased()

                    ) {

                        await interaction.reply({

                            content:

                                '❌ This ticket channel could not be found.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const ownerId =

                        getTicketOwnerId(

                            channel

                        );



                    const claimedBy =

                        getClaimedUserId(

                            channel

                        );



                    const isSenior =

                        isSeniorSupportMember(

                            interaction.member

                        );



                    if (

                        ownerId ===

                        interaction.user.id &&

                        !isTicketOwnerStaffTestingAllowed(

                            interaction.member,

                            ownerId,

                            interaction.user.id

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ The user who created the ticket cannot use staff ticket buttons.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSupportMember(

                            interaction.member

                        )

                    ) {

                        await interaction.reply({

                            content:

                                '❌ Only a member of the MSRP support team can use this.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSenior &&

                        !claimedBy

                    ) {

                        await interaction.reply({

                            content:

                                '❌ You must claim this ticket before you can hand it off.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    if (

                        !isSenior &&

                        claimedBy !==

                        interaction.user.id

                    ) {

                        await interaction.reply({

                            content:

                                '❌ You can only hand off tickets that you have claimed.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const currentDepartment =

                        getTicketDepartment(

                            channel

                        );



                    const allDestinations = [

                        {

                            label:

                                'Support Tickets',

                            value:

                                'support',

                            categoryId:

                                config

                                    .supportTicketCategoryId

                        },

                        {

                            label:

                                'Senior Support Tickets',

                            value:

                                'senior',

                            categoryId:

                                config

                                    .seniorTicketCategoryId

                        },

                        {

                            label:

                                'Reports & Appeals Tickets',

                            value:

                                'reports_appeals',

                            categoryId:

                                config

                                    .reportsAppealsTicketCategoryId

                        }

                    ];



                    const destinationOptions =

                        allDestinations

                            .filter(

                                destination =>

                                    destination.categoryId !==

                                    channel.parentId

                            )

                            .map(

                                destination =>

                                    new StringSelectMenuOptionBuilder()

                                        .setLabel(

                                            destination.label

                                        )

                                        .setValue(

                                            destination.value

                                        )

                            );



                    destinationOptions.push(

                        new StringSelectMenuOptionBuilder()

                            .setLabel(

                                'Unclaimed'

                            )

                            .setDescription(

                                currentDepartment

                                    ? `Keep in ${currentDepartment.name} and release the claim`

                                    : 'Keep the ticket here and release the claim'

                            )

                            .setValue(

                                'unclaimed'

                            )

                    );



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

                                destinationOptions

                            );



                    modal.addLabelComponents(

                        new LabelBuilder()

                            .setLabel(

                                'Where would you like to hand this to?'

                            )

                            .setStringSelectMenuComponent(

                                select

                            )

                    );



                    const notes =

                        new TextInputBuilder()

                            .setCustomId(

                                'handoff_notes'

                            )

                            .setStyle(

                                TextInputStyle.Paragraph

                            )

                            .setRequired(false)

                            .setPlaceholder(

                                'Add any useful notes for the next support member...'

                            )

                            .setMaxLength(1000);



                    modal.addLabelComponents(

                        new LabelBuilder()

                            .setLabel(

                                'Notes (Optional)'

                            )

                            .setTextInputComponent(

                                notes

                            )

                    );



                    try {

                        await interaction.showModal(

                            modal

                        );



                    } catch (error) {

                        console.error(

                            '[HANDOFF BUTTON ERROR]',

                            error

                        );



                        if (

                            !interaction.replied &&

                            !interaction.deferred

                        ) {

                            try {

                                await interaction.reply({

                                    content:

                                        '❌ Discord could not open the hand off form.',

                                    flags:

                                        MessageFlags.Ephemeral

                                });

                            } catch {}

                        }

                    }



                    return;

                }

            }



        } catch (error) {



            console.error(

                'UNHANDLED INTERACTION ERROR:',

                error

            );



            try {



                if (

                    interaction.replied ||

                    interaction.deferred

                ) {



                    await interaction.followUp({

                        content:

                            '❌ Something went wrong while processing that action.',

                        flags:

                            MessageFlags.Ephemeral

                    });



                } else {



                    await interaction.reply({

                        content:

                            '❌ Something went wrong while processing that action.',

                        flags:

                            MessageFlags.Ephemeral

                    });

                }



            } catch {}

        }

    }

);



// ======================================================

// LOGIN

// ======================================================



client.login(

    process.env.DISCORD_TOKEN

);