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
// TICKET HELPERS
// ======================================================

function isSupportMember(member) {
    if (!member?.roles) return false;

    return (
        member.roles.cache.has(config.supportStaffRoleId) ||
        member.roles.cache.has(config.seniorSupportStaffRoleId) ||
        member.roles.cache.has(config.reportsAppealsRoleId)
    );
}

function isSeniorSupportMember(member) {
    return !!member?.roles?.cache?.has(
        config.seniorSupportStaffRoleId
    );
}

function getTicketOwnerId(channel) {
    const match = channel.topic?.match(
        /ticket-owner:(\d+)/
    );

    return match ? match[1] : null;
}

function getTicketType(channel) {
    const match = channel.topic?.match(
        /ticket-type:([^|]+)/
    );

    return match ? match[1] : null;
}

function getClaimedUserId(channel) {
    const match = channel.topic?.match(
        /(?:^|\|)claimed-by:(\d+)/
    );

    return match ? match[1] : null;
}

function getTicketTypeName(channel) {
    const type = getTicketType(channel);

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

function isCurrentClaimant(member, channel) {
    const claimedBy =
        getClaimedUserId(channel);

    if (!claimedBy) {
        return false;
    }

    return claimedBy === member?.user?.id;
}

function canManageTicket(member, channel) {
    // Senior Support Staff can manage ANY ticket.
    if (
        isSeniorSupportMember(member)
    ) {
        return true;
    }

    // Normal support staff can only manage
    // tickets they personally claimed.
    return isCurrentClaimant(
        member,
        channel
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
            new REST({ version: '10' })
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

                    console.log(
                        `[HANDOFF] Modal submitted in ${channel?.id}`
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
                                '❌ Only a support member can use this.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    if (
                        !canManageTicket(
                            interaction.member,
                            channel
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ Only the staff member who claimed this ticket or Senior Support Staff can hand it off.',
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
                                '❌ This ticket must be claimed before it can be handed off.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    try {

                        console.log(
                            '[HANDOFF] Acknowledging modal...'
                        );

                        await interaction.deferReply({
                            flags:
                                MessageFlags.Ephemeral
                        });

                        console.log(
                            '[HANDOFF] Modal acknowledged.'
                        );

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
                        } catch {
                            notes = '';
                        }

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

                        // ------------------------------------------
                        // REMOVE CLAIMED FROM CHANNEL NAME
                        // ------------------------------------------

                        const newChannelName =
                            channel.name.replace(
                                /^CLAIMED-/i,
                                ''
                            );

                        console.log(
                            `[HANDOFF] Renaming ${channel.name} -> ${newChannelName}`
                        );

                        await channel.setName(
                            newChannelName
                        );

                        // ------------------------------------------
                        // MOVE CATEGORY
                        // ------------------------------------------

                        console.log(
                            `[HANDOFF] Moving to category ${newCategoryId}`
                        );

                        await channel.setParent(
                            newCategoryId,
                            {
                                lockPermissions: false
                            }
                        );

                        // ------------------------------------------
                        // REMOVE CLAIM
                        // ------------------------------------------

                        let updatedTopic =
                            channel.topic || '';

                        updatedTopic =
                            updatedTopic.replace(
                                /\|claimed-by:\d+/,
                                ''
                            );

                        console.log(
                            '[HANDOFF] Removing claimed-by from topic.'
                        );

                        await channel.setTopic(
                            updatedTopic
                        );

                        // ------------------------------------------
                        // MESSAGE
                        // ------------------------------------------

                        const ownerId =
                            getTicketOwnerId(
                                channel
                            );

                        const ownerMention =
                            ownerId
                                ? `<@${ownerId}>`
                                : 'Customer';

                        let handoffMessage =
                            `${ownerMention}\n\n` +
                            `**This ticket has been handed to ${destinationName}.**\n` +
                            `A support member will be with you shortly.`;

                        if (notes) {

                            const formattedNotes =
                                notes
                                    .split('\n')
                                    .map(
                                        line =>
                                            `> ${line}`
                                    )
                                    .join('\n');

                            handoffMessage +=
                                `\n\n` +
                                `**Notes from previous staff member**\n` +
                                formattedNotes;
                        }

                        const handoffContainer =
                            new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(
                                            handoffMessage
                                        )
                                );

                        await channel.send({
                            components: [
                                handoffContainer
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

                        console.log(
                            '[HANDOFF] COMPLETE.'
                        );

                    } catch (error) {

                        console.error(
                            '[HANDOFF] ERROR:',
                            error
                        );

                        try {
                            await interaction.editReply({
                                content:
                                    '❌ Something went wrong while handing off this ticket. The error has been logged.'
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
                // TICKET RULES
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
                // TICKET CREATION BUTTONS
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

                    try {

                        await createTicket(
                            interaction,
                            ticketType
                        );

                    } catch (error) {

                        console.error(
                            'Ticket creation error:',
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

                // ==================================================
                // CLAIM
                // ==================================================

                if (
                    interaction.customId ===
                    'ticket_claim'
                ) {

                    const member =
                        interaction.member;

                    const channel =
                        interaction.channel;

                    console.log(
                        `[CLAIM] ${interaction.user.tag} clicked Claim in ${channel?.id}`
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
                        !isSupportMember(member)
                    ) {
                        await interaction.reply({
                            content:
                                '❌ Only a member of the MSRP support team can use this.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    const isSenior =
                        isSeniorSupportMember(
                            member
                        );

                    // Read the REAL current claim
                    // from the channel topic.
                    const alreadyClaimedBy =
                        getClaimedUserId(
                            channel
                        );

                    console.log(
                        `[CLAIM] Existing claimant: ${alreadyClaimedBy || 'none'}`
                    );

                    console.log(
                        `[CLAIM] Is SSS: ${isSenior}`
                    );

                    // ------------------------------------------
                    // ALREADY CLAIMED
                    // ------------------------------------------

                    if (
                        alreadyClaimedBy &&
                        alreadyClaimedBy ===
                        interaction.user.id
                    ) {

                        await interaction.reply({
                            content:
                                '❌ You have already claimed this ticket.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    // Normal SS cannot override another
                    // person's claim.
                    if (
                        alreadyClaimedBy &&
                        !isSenior
                    ) {

                        await interaction.reply({
                            content:
                                `❌ This ticket has already been claimed by <@${alreadyClaimedBy}>.`,
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    try {

                        console.log(
                            '[CLAIM] Acknowledging interaction...'
                        );

                        await interaction.deferReply({
                            flags:
                                MessageFlags.Ephemeral
                        });

                        console.log(
                            '[CLAIM] Interaction acknowledged.'
                        );

                        // Check the topic again immediately
                        // before making the claim.
                        const latestClaim =
                            getClaimedUserId(
                                channel
                            );

                        if (
                            latestClaim &&
                            latestClaim !==
                            interaction.user.id &&
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

                        console.log(
                            `[CLAIM] Setting channel name to ${newName}...`
                        );

                        await channel.setName(
                            newName
                        );

                        // ------------------------------------------
                        // UPDATE CLAIM IN TOPIC
                        // ------------------------------------------

                        let topic =
                            channel.topic || '';

                        topic =
                            topic.replace(
                                /\|claimed-by:\d+/,
                                ''
                            );

                        topic +=
                            `|claimed-by:${interaction.user.id}`;

                        console.log(
                            '[CLAIM] Updating topic...'
                        );

                        await channel.setTopic(
                            topic
                        );

                        // ------------------------------------------
                        // CLAIM MESSAGE
                        // ------------------------------------------

                        const claimText =
                            latestClaim &&
                            isSenior
                                ? `${ownerMention} | ${interaction.user} has taken over this ${ticketTypeName} ticket from <@${latestClaim}> as Senior Support.`
                                : `${ownerMention} | ${interaction.user} has claimed this ${ticketTypeName} ticket.`;

                        const claimContainer =
                            new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(
                                            claimText
                                        )
                                );

                        const mentionedUsers =
                            [];

                        if (ownerId) {
                            mentionedUsers.push(
                                ownerId
                            );
                        }

                        if (
                            latestClaim &&
                            isSenior &&
                            latestClaim !==
                            interaction.user.id
                        ) {
                            mentionedUsers.push(
                                latestClaim
                            );
                        }

                        console.log(
                            '[CLAIM] Sending claim message...'
                        );

                        await channel.send({
                            components: [
                                claimContainer
                            ],
                            flags:
                                MessageFlags.IsComponentsV2,
                            allowedMentions: {
                                users:
                                    mentionedUsers
                            }
                        });

                        console.log(
                            '[CLAIM] Claim message sent.'
                        );

                        await interaction.editReply({
                            content:
                                latestClaim &&
                                isSenior
                                    ? '✅ Ticket taken over successfully.'
                                    : '✅ Ticket claimed.'
                        });

                        console.log(
                            '[CLAIM] COMPLETE.'
                        );

                    } catch (error) {

                        console.error(
                            '[CLAIM] ERROR:',
                            error
                        );

                        try {
                            if (
                                interaction.deferred
                            ) {
                                await interaction.editReply({
                                    content:
                                        '❌ Something went wrong while claiming this ticket. The error has been logged.'
                                });
                            } else {
                                await interaction.reply({
                                    content:
                                        '❌ Something went wrong while claiming this ticket.',
                                    flags:
                                        MessageFlags.Ephemeral
                                });
                            }
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

                    console.log(
                        `[CLOSE] ${interaction.user.tag} clicked Close in ${channel?.id}`
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

                    const isSenior =
                        isSeniorSupportMember(
                            interaction.member
                        );

                    const claimedBy =
                        getClaimedUserId(
                            channel
                        );

                    console.log(
                        `[CLOSE] Claimed by: ${claimedBy || 'none'}`
                    );

                    console.log(
                        `[CLOSE] Is SSS: ${isSenior}`
                    );

                    // Must be claimed.
                    if (!claimedBy) {

                        await interaction.reply({
                            content:
                                '❌ This ticket has not been claimed yet.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    // SSS can close anything.
                    // SS can only close their own.
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

                        console.log(
                            '[CLOSE] Deleting channel...'
                        );

                        await channel.delete(
                            'MSRP ticket closed'
                        );

                    } catch (error) {

                        console.error(
                            '[CLOSE] ERROR:',
                            error
                        );

                        try {
                            if (
                                interaction.deferred
                            ) {
                                await interaction.followUp({
                                    content:
                                        '❌ Something went wrong while closing this ticket.',
                                    flags:
                                        MessageFlags.Ephemeral
                                });
                            }
                        } catch {}
                    }

                    return;
                }

                // ==================================================
                // HAND OFF BUTTON
                // ==================================================

                if (
                    interaction.customId ===
                    'ticket_handoff'
                ) {

                    const member =
                        interaction.member;

                    const channel =
                        interaction.channel;

                    console.log(
                        `[HANDOFF] ${interaction.user.tag} clicked Hand Off in ${channel?.id}`
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
                        !isSupportMember(member)
                    ) {
                        await interaction.reply({
                            content:
                                '❌ Only a support member can use this.',
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
                        `[HANDOFF] Claimed by: ${claimedBy || 'none'}`
                    );

                    const isSenior =
                        isSeniorSupportMember(
                            member
                        );

                    console.log(
                        `[HANDOFF] Is SSS: ${isSenior}`
                    );

                    // Must be claimed.
                    if (!claimedBy) {

                        await interaction.reply({
                            content:
                                '❌ This ticket must be claimed before it can be handed off.',
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }

                    // SSS can hand off anything.
                    // SS can only hand off their own.
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

                    console.log(
                        '[HANDOFF] Building modal...'
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

                    const notesInput =
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
                                notesInput
                            )
                    );

                    console.log(
                        '[HANDOFF] Showing modal...'
                    );

                    // This is the interaction response.
                    // Do NOT deferReply before this.
                    await interaction.showModal(
                        modal
                    );

                    console.log(
                        '[HANDOFF] Modal shown.'
                    );

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