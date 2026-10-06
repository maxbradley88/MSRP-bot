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

const CLOSE_LOG_CHANNEL_ID = '1556842177743556718';
const optimisticClaimStates = new Map();
const optimisticDepartmentStates = new Map();
const ticketChannelEditVersions = new Map();



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



function getClaimedUserIdFromTopic(topic) {
    const match = String(topic || '').match(/(?:^|\|)claimed-by:(\d+)/);
    return match ? match[1] : null;
}

function getClaimedUserId(channel) {
    if (!channel) return null;

    if (optimisticClaimStates.has(channel.id)) {
        return optimisticClaimStates.get(channel.id);
    }

    return getClaimedUserIdFromTopic(channel.topic);
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




function getTicketDepartmentFromKey(key) {
    if (key === 'support') {
        return {
            key: 'support',
            name: 'Support Tickets',
            categoryId: config.supportTicketCategoryId,
            roleId: config.supportStaffRoleId
        };
    }

    if (key === 'senior') {
        return {
            key: 'senior',
            name: 'Senior Support Tickets',
            categoryId: config.seniorTicketCategoryId,
            roleId: config.seniorSupportStaffRoleId
        };
    }

    if (key === 'reports_appeals') {
        return {
            key: 'reports_appeals',
            name: 'Reports & Appeals Tickets',
            categoryId: config.reportsAppealsTicketCategoryId,
            roleId: config.reportsAppealsRoleId
        };
    }

    return null;
}

function getTicketDepartmentFromParentId(parentId) {
    if (parentId === config.supportTicketCategoryId) {
        return getTicketDepartmentFromKey('support');
    }

    if (parentId === config.seniorTicketCategoryId) {
        return getTicketDepartmentFromKey('senior');
    }

    if (parentId === config.reportsAppealsTicketCategoryId) {
        return getTicketDepartmentFromKey('reports_appeals');
    }

    return null;
}

function getTicketDepartment(channel) {
    if (!channel) return null;

    if (optimisticDepartmentStates.has(channel.id)) {
        return getTicketDepartmentFromKey(
            optimisticDepartmentStates.get(channel.id)
        );
    }

    return getTicketDepartmentFromParentId(channel.parentId);
}

function stripClaimedPrefix(channelName) {

    return String(channelName || '')
        .replace(
            /^(?:claimed-)+/i,
            ''
        );
}

function formatTicketChannelName(value) {
    const cleaned = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .replace(/[ _]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 90);

    return cleaned || null;
}


function buildHandoffChannelName(channel, ownerId, requestedName) {
    const prefix = formatTicketChannelName(requestedName);

    if (!prefix) {
        return null;
    }

    const baseName = stripClaimedPrefix(channel.name);
    const ticketType = getTicketType(channel);

    let ownerUsername = null;

    if (ownerId) {
        ownerUsername =
            channel.guild?.members?.cache?.get(ownerId)?.user?.username ||
            client.users.cache.get(ownerId)?.username ||
            null;
    }

    const safeUsername = ownerUsername
        ? ownerUsername
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '')
        : null;

    const numberMatch = baseName.match(/-(\d{1,6})$/);

    if (safeUsername && numberMatch) {
        const suffix = `${safeUsername}-${numberMatch[1]}`;
        const maxPrefixLength =
            Math.max(1, 100 - suffix.length - 1);

        return `${prefix.slice(0, maxPrefixLength)}-${suffix}`;
    }

    if (
        ticketType &&
        baseName.toLowerCase().startsWith(
            `${String(ticketType).toLowerCase()}-`
        )
    ) {
        const suffix =
            baseName.slice(String(ticketType).length + 1);

        const maxPrefixLength =
            Math.max(1, 100 - suffix.length - 1);

        return `${prefix.slice(0, maxPrefixLength)}-${suffix}`;
    }

    return prefix.slice(0, 100);
}

function applyOptimisticTicketState(channel, updates = {}) {
    const version =
        (ticketChannelEditVersions.get(channel.id) || 0) + 1;

    ticketChannelEditVersions.set(channel.id, version);

    if (Object.prototype.hasOwnProperty.call(updates, 'claimedBy')) {
        optimisticClaimStates.set(channel.id, updates.claimedBy);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'departmentKey')) {
        optimisticDepartmentStates.set(
            channel.id,
            updates.departmentKey
        );
    }

    return version;
}

function persistTicketChannelEdit(channel, data, version, label) {
    void channel.edit(data)
        .then(updatedChannel => {
            if (ticketChannelEditVersions.get(channel.id) !== version) {
                return;
            }

            if (optimisticClaimStates.has(channel.id)) {
                const persistedClaim =
                    getClaimedUserIdFromTopic(updatedChannel.topic);

                if (
                    optimisticClaimStates.get(channel.id) ===
                    persistedClaim
                ) {
                    optimisticClaimStates.delete(channel.id);
                }
            }

            if (optimisticDepartmentStates.has(channel.id)) {
                const persistedDepartment =
                    getTicketDepartmentFromParentId(
                        updatedChannel.parentId
                    );

                if (
                    optimisticDepartmentStates.get(channel.id) ===
                    persistedDepartment?.key
                ) {
                    optimisticDepartmentStates.delete(channel.id);
                }
            }
        })
        .catch(error => {
            console.error(
                `[${label} CHANNEL EDIT ERROR]`,
                error
            );
        });
}

function sendCloseNotifications(ownerId, message) {
    void (async () => {
        const tasks = [];

        let logChannel =
            client.channels.cache.get(CLOSE_LOG_CHANNEL_ID) || null;

        if (!logChannel) {
            try {
                logChannel = await client.channels.fetch(
                    CLOSE_LOG_CHANNEL_ID
                );
            } catch (error) {
                console.error(
                    '[CLOSE LOG CHANNEL FETCH ERROR]',
                    error
                );
            }
        }

        if (logChannel?.isTextBased()) {
            tasks.push(
                logChannel.send({ content: message })
            );
        }

        if (ownerId) {
            tasks.push(
                (async () => {
                    const user =
                        client.users.cache.get(ownerId) ||
                        await client.users.fetch(ownerId);

                    await user.send(message);
                })()
            );
        }

        const results = await Promise.allSettled(tasks);

        for (const result of results) {
            if (result.status === 'rejected') {
                console.error(
                    '[CLOSE NOTIFICATION ERROR]',
                    result.reason
                );
            }
        }
    })();
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
                    const channel = interaction.channel;

                    if (!channel || !channel.isTextBased()) {
                        await interaction.reply({
                            content: '❌ This ticket channel could not be found.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const ownerId = getTicketOwnerId(channel);
                    const isSenior = isSeniorSupportMember(
                        interaction.member
                    );

                    if (
                        ownerId === interaction.user.id &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            interaction.user.id
                        )
                    ) {
                        await interaction.reply({
                            content: '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (!isSupportMember(interaction.member)) {
                        await interaction.reply({
                            content: '❌ Only a member of the MSRP support team can use this.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const claimedBy = getClaimedUserId(channel);

                    if (!isSenior && !claimedBy) {
                        await interaction.reply({
                            content: '❌ You must claim this ticket before you can close it.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (
                        !isSenior &&
                        claimedBy !== interaction.user.id
                    ) {
                        await interaction.reply({
                            content: '❌ You can only close tickets that you have claimed.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const reason = interaction.fields
                        .getTextInputValue('close_reason')
                        .trim();

                    if (!reason) {
                        await interaction.reply({
                            content: '❌ A reason for closing the ticket is required.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    try {
                        await interaction.reply({
                            content: '✅ Closing ticket...',
                            flags: MessageFlags.Ephemeral
                        });

                        const closeMessage =
                            `Ticket closed | ${reason}`;

                        sendCloseNotifications(
                            ownerId,
                            closeMessage
                        );

                        const auditReason = (
                            `MSRP ticket closed by ${interaction.user.username} ` +
                            `(${interaction.user.id}): ${reason}`
                        ).slice(0, 512);

                        console.log(
                            `[TICKET CLOSE] ${channel.name} | ` +
                            `Closed by ${interaction.user.username} ` +
                            `(${interaction.user.id}) | ` +
                            `Reason: ${reason}`
                        );

                        await channel.delete(auditReason);

                    } catch (error) {
                        console.error(
                            '[CLOSE MODAL ERROR]',
                            error
                        );

                        try {
                            await interaction.editReply({
                                content: '❌ Something went wrong while closing this ticket.'
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
                    const channel = interaction.channel;

                    if (!channel || !channel.isTextBased()) {
                        await interaction.reply({
                            content:
                                '❌ This ticket channel could not be found.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const ownerId =
                        getTicketOwnerId(channel);

                    const claimedBy =
                        getClaimedUserId(channel);

                    const isSenior =
                        isSeniorSupportMember(
                            interaction.member
                        );

                    if (
                        ownerId === interaction.user.id &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            interaction.user.id
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (!isSupportMember(interaction.member)) {
                        await interaction.reply({
                            content:
                                '❌ Only a support member can use this.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (!isSenior && !claimedBy) {
                        await interaction.reply({
                            content:
                                '❌ You must claim this ticket before you can hand it off.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (
                        !isSenior &&
                        claimedBy !== interaction.user.id
                    ) {
                        await interaction.reply({
                            content:
                                '❌ You can only hand off tickets that you have claimed.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const selected =
                        interaction.fields
                            .getStringSelectValues(
                                'handoff_destination'
                            )?.[0];

                    const requestedName =
                        interaction.fields
                            .getTextInputValue(
                                'handoff_name'
                            )
                            .trim();

                    let notes = '';

                    try {
                        notes =
                            interaction.fields
                                .getTextInputValue(
                                    'handoff_notes'
                                )
                                ?.trim() || '';
                    } catch {}

                    if (!selected) {
                        await interaction.reply({
                            content:
                                '❌ Please select a hand off destination.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (!requestedName) {
                        await interaction.reply({
                            content:
                                '❌ Please enter a name for this ticket.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const destination =
                        getTicketDepartmentFromKey(
                            selected
                        );

                    if (!destination) {
                        await interaction.reply({
                            content:
                                '❌ Invalid hand off destination.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const currentDepartment =
                        getTicketDepartment(channel) ||
                        getTicketDepartmentFromParentId(
                            channel.parentId
                        );

                    if (
                        currentDepartment?.key ===
                        destination.key
                    ) {
                        await interaction.reply({
                            content:
                                '❌ This ticket is already in that department. Reopen Hand Off and choose another department.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const newName =
                        buildHandoffChannelName(
                            channel,
                            ownerId,
                            requestedName
                        );

                    if (!newName) {
                        await interaction.reply({
                            content:
                                '❌ That ticket name could not be used. Please try a different name.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const newTopic =
                        String(channel.topic || '')
                            .replace(
                                /\|claimed-by:\d+/g,
                                ''
                            );

                    await interaction.reply({
                        content:
                            `⏳ Moving ticket to ${destination.name}...`,
                        flags: MessageFlags.Ephemeral
                    });

                    try {
                        // Clear the live claim state immediately. This is important
                        // because Claim uses an optimistic cache for fast responses.
                        optimisticClaimStates.set(
                            channel.id,
                            null
                        );

                        const movedChannel =
                            await channel.setParent(
                                destination.categoryId,
                                {
                                    lockPermissions: false,
                                    reason:
                                        `Ticket handed off by ${interaction.user.tag}`
                                }
                            );

                        const updatedChannel =
                            await movedChannel.edit({
                                name: newName,
                                topic: newTopic,
                                reason:
                                    `Ticket renamed and unclaimed during hand off by ${interaction.user.tag}`
                            });

                        // Remember the confirmed destination so another handoff
                        // immediately uses the new department, even if Discord's
                        // cached parent takes a moment to refresh.
                        optimisticDepartmentStates.set(
                            channel.id,
                            destination.key
                        );

                        // The claimant is now persisted as removed in the topic.
                        optimisticClaimStates.delete(
                            channel.id
                        );

                        await interaction.editReply({
                            content:
                                `✅ Ticket handed off to ${destination.name}.`
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
                            'The ticket has been unclaimed for the new department. ' +
                            'A support member will be with you shortly.';

                        if (notes) {
                            message +=
                                '\n\n**Notes from previous staff member**\n' +
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
                                        .setContent(message)
                                );

                        try {
                            await updatedChannel.send({
                                components: [container],
                                flags:
                                    MessageFlags.IsComponentsV2,
                                allowedMentions: {
                                    users:
                                        ownerId
                                            ? [ownerId]
                                            : [],
                                    roles:
                                        destination.roleId
                                            ? [
                                                destination.roleId
                                            ]
                                            : []
                                }
                            });
                        } catch (messageError) {
                            console.error(
                                '[HANDOFF MESSAGE ERROR]',
                                messageError
                            );

                            try {
                                await updatedChannel.send({
                                    content: message,
                                    allowedMentions: {
                                        users:
                                            ownerId
                                                ? [ownerId]
                                                : [],
                                        roles:
                                            destination.roleId
                                                ? [
                                                    destination.roleId
                                                ]
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
                    } catch (moveError) {
                        // Do not leave a fake optimistic state if Discord failed.
                        optimisticDepartmentStates.delete(
                            channel.id
                        );
                        optimisticClaimStates.delete(
                            channel.id
                        );

                        console.error(
                            '[HANDOFF MOVE ERROR]',
                            moveError
                        );

                        try {
                            await interaction.editReply({
                                content:
                                    '❌ Discord could not complete this hand off. The ticket was not recorded as moved; please try again.'
                            });
                        } catch {}

                        return;
                    }

                    return;
                }

                // ==================================================

                // UNCLAIM MODAL

                // ==================================================

                if (
                    interaction.customId ===
                    'ticket_unclaim_modal'
                ) {
                    const channel = interaction.channel;

                    if (!channel || !channel.isTextBased()) {
                        await interaction.reply({
                            content:
                                '❌ This ticket channel could not be found.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const ownerId =
                        getTicketOwnerId(channel);

                    if (
                        ownerId === interaction.user.id &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            interaction.user.id
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (
                        !isSeniorSupportMember(
                            interaction.member
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ Only Senior Support Staff can unclaim a ticket.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const claimedBy =
                        getClaimedUserId(channel);

                    if (!claimedBy) {
                        await interaction.reply({
                            content:
                                '❌ No one has claimed this ticket.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    let notes = '';

                    try {
                        notes =
                            interaction.fields
                                .getTextInputValue(
                                    'unclaim_notes'
                                )
                                ?.trim() || '';
                    } catch {}

                    const newName =
                        stripClaimedPrefix(
                            channel.name
                        );

                    const newTopic =
                        String(channel.topic || '')
                            .replace(
                                /\|claimed-by:\d+/g,
                                ''
                            );

                    await interaction.reply({
                        content:
                            '⏳ Unclaiming ticket...',
                        flags: MessageFlags.Ephemeral
                    });

                    try {
                        optimisticClaimStates.set(
                            channel.id,
                            null
                        );

                        await channel.edit({
                            name: newName,
                            topic: newTopic,
                            reason:
                                `Ticket unclaimed by ${interaction.user.tag}`
                        });

                        optimisticClaimStates.delete(
                            channel.id
                        );

                        await interaction.editReply({
                            content:
                                '✅ Ticket unclaimed successfully.'
                        });

                        const ownerMention =
                            ownerId
                                ? `<@${ownerId}>`
                                : 'Customer';

                        let message =
                            `${ownerMention} | ` +
                            'This ticket has been unclaimed. ' +
                            'A support member will be with you shortly.';

                        if (notes) {
                            message +=
                                '\n\n**Notes**\n' +
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
                                        .setContent(message)
                                );

                        try {
                            await channel.send({
                                components: [container],
                                flags:
                                    MessageFlags.IsComponentsV2,
                                allowedMentions: {
                                    users:
                                        ownerId
                                            ? [ownerId]
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
                                    content: message,
                                    allowedMentions: {
                                        users:
                                            ownerId
                                                ? [ownerId]
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
                    } catch (error) {
                        optimisticClaimStates.delete(
                            channel.id
                        );

                        console.error(
                            '[UNCLAIM MODAL ERROR]',
                            error
                        );

                        try {
                            await interaction.editReply({
                                content:
                                    '❌ Something went wrong while unclaiming this ticket.'
                            });
                        } catch {}
                    }

                    return;
                }

                // ==================================================

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

                        'ticket_handoff',

                        'ticket_unclaim'

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
                    const channel = interaction.channel;
                    const userId = interaction.user.id;
                    const isSenior = isSeniorSupportMember(
                        interaction.member
                    );

                    if (!channel || !channel.isTextBased()) {
                        await interaction.reply({
                            content: '❌ This ticket channel could not be found.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const ownerId = getTicketOwnerId(channel);

                    if (
                        ownerId === userId &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            userId
                        )
                    ) {
                        await interaction.reply({
                            content: '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (!isSupportMember(interaction.member)) {
                        await interaction.reply({
                            content: '❌ Only a member of the MSRP support team can use this.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const claimedBy = getClaimedUserId(channel);

                    if (claimedBy === userId) {
                        await interaction.reply({
                            content: '❌ You have already claimed this ticket.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (claimedBy && !isSenior) {
                        await interaction.reply({
                            content: `❌ This ticket has already been claimed by <@${claimedBy}>.`,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (activeClaimChannels.has(channel.id)) {
                        await interaction.reply({
                            content: '❌ Another claim action is already being processed for this ticket. Please try again.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    activeClaimChannels.add(channel.id);

                    try {
                        const latestClaim =
                            getClaimedUserId(channel);

                        if (
                            latestClaim &&
                            latestClaim !== userId &&
                            !isSenior
                        ) {
                            await interaction.reply({
                                content: `❌ This ticket has already been claimed by <@${latestClaim}>.`,
                                flags: MessageFlags.Ephemeral
                            });
                            return;
                        }

                        const ownerMention = ownerId
                            ? `<@${ownerId}>`
                            : 'Customer';

                        const ticketTypeName =
                            getTicketTypeName(channel);

                        const newName =
                            `claimed-${stripClaimedPrefix(channel.name)}`;

                        const topic =
                            String(channel.topic || '')
                                .replace(
                                    /\|claimed-by:\d+/g,
                                    ''
                                ) +
                            `|claimed-by:${userId}`;

                        const isTakeover = Boolean(
                            latestClaim &&
                            latestClaim !== userId
                        );

                        const version =
                            applyOptimisticTicketState(
                                channel,
                                { claimedBy: userId }
                            );

                        await interaction.reply({
                            content: isTakeover
                                ? '✅ Ticket taken over successfully.'
                                : '✅ Ticket claimed.',
                            flags: MessageFlags.Ephemeral
                        });

                        persistTicketChannelEdit(
                            channel,
                            {
                                name: newName,
                                topic
                            },
                            version,
                            'CLAIM'
                        );

                        const claimText = isTakeover
                            ? `${ownerMention} | This ticket is now being handled by ${interaction.user}.`
                            : `${ownerMention} | ${interaction.user} has claimed this ${ticketTypeName} ticket.`;

                        const container =
                            new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(claimText)
                                );

                        const mentionUsers =
                            [ownerId, userId].filter(Boolean);

                        void channel.send({
                            components: [container],
                            flags: MessageFlags.IsComponentsV2,
                            allowedMentions: {
                                users: [
                                    ...new Set(mentionUsers)
                                ]
                            }
                        }).catch(async messageError => {
                            console.error(
                                '[CLAIM MESSAGE ERROR]',
                                messageError
                            );

                            try {
                                await channel.send({
                                    content: claimText,
                                    allowedMentions: {
                                        users: [
                                            ...new Set(mentionUsers)
                                        ]
                                    }
                                });
                            } catch (fallbackError) {
                                console.error(
                                    '[CLAIM FALLBACK MESSAGE ERROR]',
                                    fallbackError
                                );
                            }
                        });

                    } catch (error) {
                        console.error(
                            '[CLAIM ERROR]',
                            error
                        );

                        if (!interaction.replied && !interaction.deferred) {
                            try {
                                await interaction.reply({
                                    content: '❌ Something went wrong while claiming this ticket.',
                                    flags: MessageFlags.Ephemeral
                                });
                            } catch {}
                        } else {
                            try {
                                await interaction.editReply({
                                    content: '❌ Something went wrong while claiming this ticket.'
                                });
                            } catch {}
                        }
                    } finally {
                        activeClaimChannels.delete(channel.id);
                    }

                    return;
                }

                // ==================================================

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
                        getTicketOwnerId(channel);

                    const claimedBy =
                        getClaimedUserId(channel);

                    const isSenior =
                        isSeniorSupportMember(
                            interaction.member
                        );

                    if (
                        ownerId === interaction.user.id &&
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
                        getTicketDepartment(channel) ||
                        getTicketDepartmentFromParentId(
                            channel.parentId
                        );

                    const allDestinations = [
                        getTicketDepartmentFromKey(
                            'support'
                        ),
                        getTicketDepartmentFromKey(
                            'senior'
                        ),
                        getTicketDepartmentFromKey(
                            'reports_appeals'
                        )
                    ].filter(Boolean);

                    const destinationOptions =
                        allDestinations
                            .filter(
                                destination =>
                                    destination.key !==
                                    currentDepartment?.key
                            )
                            .map(
                                destination =>
                                    new StringSelectMenuOptionBuilder()
                                        .setLabel(
                                            destination.name
                                        )
                                        .setValue(
                                            destination.key
                                        )
                            );

                    if (
                        destinationOptions.length === 0
                    ) {
                        await interaction.reply({
                            content:
                                '❌ No other ticket departments are available.',
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

                    const ticketName =
                        new TextInputBuilder()
                            .setCustomId(
                                'handoff_name'
                            )
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(true)
                            .setPlaceholder(
                                'Example: Claiming giveaway prize'
                            )
                            .setMaxLength(90);

                    modal.addLabelComponents(
                        new LabelBuilder()
                            .setLabel(
                                'Please name this ticket'
                            )
                            .setTextInputComponent(
                                ticketName
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

                // ==================================================

                // UNCLAIM

                // ==================================================

                if (
                    interaction.customId ===
                    'ticket_unclaim'
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
                        getTicketOwnerId(channel);

                    if (
                        ownerId === interaction.user.id &&
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
                        !isSeniorSupportMember(
                            interaction.member
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ Only Senior Support Staff can unclaim a ticket.',
                            flags:
                                MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const claimedBy =
                        getClaimedUserId(channel);

                    if (!claimedBy) {
                        await interaction.reply({
                            content:
                                '❌ No one has claimed this ticket.',
                            flags:
                                MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'ticket_unclaim_modal'
                            )
                            .setTitle(
                                'Unclaim Ticket'
                            );

                    const notes =
                        new TextInputBuilder()
                            .setCustomId(
                                'unclaim_notes'
                            )
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setRequired(false)
                            .setPlaceholder(
                                'Add any notes for the next support member...'
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
                            '[UNCLAIM BUTTON ERROR]',
                            error
                        );

                        if (
                            !interaction.replied &&
                            !interaction.deferred
                        ) {
                            try {
                                await interaction.reply({
                                    content:
                                        '❌ Discord could not open the unclaim form.',
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