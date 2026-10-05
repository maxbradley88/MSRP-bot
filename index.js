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

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

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

                    const claimedBy =
                        getClaimedUserId(
                            channel
                        );

                    const isSenior =
                        isSeniorSupportMember(
                            interaction.member
                        );

                    console.log(
                        `[HANDOFF MODAL] User: ${interaction.user.id}`
                    );

                    console.log(
                        `[HANDOFF MODAL] Claimed by: ${claimedBy || 'NONE'}`
                    );

                    console.log(
                        `[HANDOFF MODAL] Senior: ${isSenior}`
                    );

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

                    if (!claimedBy) {

                        await interaction.reply({
                            content:
                                '❌ This ticket must be claimed before it can be handed off.',
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

                        let notes = '';

                        try {
                            notes =
                                interaction.fields
                                    .getTextInputValue(
                                        'handoff_notes'
                                    )
                                    ?.trim() || '';
                        } catch {}

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

                            await interaction.editReply({
                                content:
                                    '❌ Invalid hand off destination.'
                            });

                            return;
                        }

                        const newName =
                            channel.name.replace(
                                /^CLAIMED-/i,
                                ''
                            );

                        await channel.setName(
                            newName
                        );

                        await channel.setParent(
                            newCategoryId,
                            {
                                lockPermissions:
                                    false
                            }
                        );

                        let newTopic =
                            channel.topic || '';

                        newTopic =
                            newTopic.replace(
                                /\|claimed-by:\d+/,
                                ''
                            );

                        await channel.setTopic(
                            newTopic
                        );

                        const ownerId =
                            getTicketOwnerId(
                                channel
                            );

                        const ownerMention =
                            ownerId
                                ? `<@${ownerId}>`
                                : 'Customer';

                        let message =
                            `${ownerMention}\n\n` +
                            `**This ticket has been handed to ${destinationName}.**\n` +
                            `A support member will be with you shortly.`;

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
                                        : []
                            }
                        });

                        await interaction.editReply({
                            content:
                                '✅ Ticket handed off successfully.'
                        });

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

                    console.log(
                        `[CLAIM] User=${userId} Senior=${isSenior} Channel=${channel?.id}`
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

                    console.log(
                        `[CLAIM] ClaimedBy=${claimedBy || 'NONE'}`
                    );

                    // ------------------------------------------
                    // SAME PERSON
                    // ------------------------------------------

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

                    // ------------------------------------------
                    // SOMEONE ELSE
                    // ------------------------------------------

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

                    // ------------------------------------------
                    // CLAIM / TAKEOVER
                    // ------------------------------------------

                    try {

                        await interaction.deferReply({
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
                            `|claimed-by:${userId}`;

                        await channel.setTopic(
                            topic
                        );

                        const claimText =
                            latestClaim &&
                            isSenior
                                ? `${ownerMention} | ${interaction.user} has taken over this ${ticketTypeName} ticket from <@${latestClaim}> as Senior Support.`
                                : `${ownerMention} | ${interaction.user} has claimed this ${ticketTypeName} ticket.`;

                        const container =
                            new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(
                                            claimText
                                        )
                                );

                        const mentions =
                            [];

                        if (ownerId) {
                            mentions.push(
                                ownerId
                            );
                        }

                        if (
                            latestClaim &&
                            isSenior &&
                            latestClaim !==
                            userId
                        ) {
                            mentions.push(
                                latestClaim
                            );
                        }

                        await channel.send({
                            components: [
                                container
                            ],
                            flags:
                                MessageFlags.IsComponentsV2,
                            allowedMentions: {
                                users:
                                    mentions
                            }
                        });

                        await interaction.editReply({
                            content:
                                latestClaim &&
                                isSenior
                                    ? '✅ Ticket taken over successfully.'
                                    : '✅ Ticket claimed.'
                        });

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

                    const claimedBy =
                        getClaimedUserId(
                            channel
                        );

                    const isSenior =
                        isSeniorSupportMember(
                            interaction.member
                        );

                    console.log(
                        `[CLOSE] User=${interaction.user.id} ClaimedBy=${claimedBy || 'NONE'} Senior=${isSenior}`
                    );

                    if (!claimedBy) {

                        await interaction.reply({
                            content:
                                '❌ This ticket has not been claimed yet.',
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

                    try {

                        await interaction.deferUpdate();

                        await channel.delete(
                            'MSRP ticket closed'
                        );

                    } catch (error) {

                        console.error(
                            '[CLOSE ERROR]',
                            error
                        );
                    }

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

                    const claimedBy =
                        getClaimedUserId(
                            channel
                        );

                    const isSenior =
                        isSeniorSupportMember(
                            interaction.member
                        );

                    console.log(
                        `[HANDOFF BUTTON] User=${interaction.user.id} ClaimedBy=${claimedBy || 'NONE'} Senior=${isSenior}`
                    );

                    if (
                        !claimedBy
                    ) {

                        await interaction.reply({
                            content:
                                '❌ This ticket must be claimed before it can be handed off.',
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

                    // ------------------------------------------
                    // BUILD MODAL
                    // ------------------------------------------

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
                            .setRequired(true)
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

                    console.log(
                        '[HANDOFF BUTTON] Calling showModal...'
                    );

                    try {

                        await interaction.showModal(
                            modal
                        );

                        console.log(
                            '[HANDOFF BUTTON] Modal displayed.'
                        );

                    } catch (error) {

                        console.error(
                            '[HANDOFF BUTTON ERROR]',
                            error
                        );

                        // The interaction may not have been
                        // acknowledged if showModal failed.
                        try {

                            if (
                                !interaction.replied &&
                                !interaction.deferred
                            ) {

                                await interaction.reply({
                                    content:
                                        '❌ Discord could not open the hand off form.',
                                    flags:
                                        MessageFlags.Ephemeral
                                });
                            }

                        } catch {}
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