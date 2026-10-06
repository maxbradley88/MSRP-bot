const {
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

const config = require('./ticketConfig');

let testingOverrides = {
    allowTicketCreatorStaffActions: false
};

try {
    testingOverrides = require('./testingOverrides');
} catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') {
        console.warn('[HANDOFF TESTING OVERRIDES ERROR]', error);
    }
}

const activeHandoffs = new Set();

function getOwnerId(channel) {
    const match = String(channel?.topic || '').match(/(?:^|\|)ticket-owner:(\d+)/);
    return match ? match[1] : null;
}

function getTicketType(channel) {
    const match = String(channel?.topic || '').match(/(?:^|\|)ticket-type:([^|]+)/);
    return match ? match[1] : null;
}

function getClaimedFromTopic(channel) {
    const match = String(channel?.topic || '').match(/(?:^|\|)claimed-by:(\d+)/);
    return match ? match[1] : null;
}

function hasSupportRole(member) {
    return Boolean(member?.roles?.cache?.has(config.supportStaffRoleId));
}

function hasSeniorRole(member) {
    return Boolean(member?.roles?.cache?.has(config.seniorSupportStaffRoleId));
}

function hasReportsRole(member) {
    const roleId = config.reportsAppealsStaffRoleId || config.reportsAppealsRoleId;
    return Boolean(roleId && member?.roles?.cache?.has(roleId));
}

function ownerTestingAllowed(member, ownerId, userId) {
    if (ownerId !== userId) return false;
    if (testingOverrides.allowTicketCreatorStaffActions !== true) return false;

    return (
        hasSupportRole(member) ||
        hasSeniorRole(member) ||
        hasReportsRole(member)
    );
}

function getDepartmentFromKey(key) {
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
            roleId: config.reportsAppealsStaffRoleId || config.reportsAppealsRoleId
        };
    }

    return null;
}

function getDepartmentFromParent(parentId) {
    if (parentId === config.supportTicketCategoryId) {
        return getDepartmentFromKey('support');
    }

    if (parentId === config.seniorTicketCategoryId) {
        return getDepartmentFromKey('senior');
    }

    if (parentId === config.reportsAppealsTicketCategoryId) {
        return getDepartmentFromKey('reports_appeals');
    }

    return null;
}

function stripClaimedPrefix(name) {
    return String(name || '').replace(/^(?:claimed-)+/i, '');
}

function formatName(value) {
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

function buildHandoffName(channel, ownerId, requestedName) {
    const prefix = formatName(requestedName);
    if (!prefix) return null;

    const baseName = stripClaimedPrefix(channel.name);
    const ticketType = getTicketType(channel);

    let ownerUsername = null;

    if (ownerId) {
        ownerUsername =
            channel.guild?.members?.cache?.get(ownerId)?.user?.username ||
            channel.client?.users?.cache?.get(ownerId)?.username ||
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

    // Normal ticket format: <type>-<username>-<number>.
    // Replace only the ticket type/name section and keep username + number.
    if (safeUsername && numberMatch) {
        const suffix = `${safeUsername}-${numberMatch[1]}`;
        const maxPrefix = Math.max(1, 100 - suffix.length - 1);
        return `${prefix.slice(0, maxPrefix)}-${suffix}`;
    }

    if (
        ticketType &&
        baseName.toLowerCase().startsWith(`${String(ticketType).toLowerCase()}-`)
    ) {
        const suffix = baseName.slice(String(ticketType).length + 1);
        const maxPrefix = Math.max(1, 100 - suffix.length - 1);
        return `${prefix.slice(0, maxPrefix)}-${suffix}`;
    }

    return prefix.slice(0, 100);
}

function checkPermission(interaction, helpers) {
    const channel = interaction.channel;
    const member = interaction.member;
    const userId = interaction.user.id;
    const ownerId = getOwnerId(channel);

    if (
        ownerId === userId &&
        !ownerTestingAllowed(member, ownerId, userId)
    ) {
        return {
            allowed: false,
            ownerId,
            message: '❌ The user who created the ticket cannot use staff ticket buttons.'
        };
    }

    const claimedBy = helpers?.getClaimedUserId
        ? helpers.getClaimedUserId(channel)
        : getClaimedFromTopic(channel);

    if (!claimedBy) {
        return {
            allowed: false,
            ownerId,
            claimedBy,
            message: '❌ You must claim this ticket first.'
        };
    }

    if (hasSeniorRole(member)) {
        return {
            allowed: true,
            ownerId,
            claimedBy,
            isSenior: true
        };
    }

    const department = getDepartmentFromParent(channel.parentId);

    if (!department) {
        return {
            allowed: false,
            ownerId,
            claimedBy,
            message: '❌ This ticket is not inside a recognised ticket department.'
        };
    }

    const correctDepartmentRole =
        (department.key === 'support' && hasSupportRole(member)) ||
        (department.key === 'reports_appeals' && hasReportsRole(member));

    if (!correctDepartmentRole) {
        return {
            allowed: false,
            ownerId,
            claimedBy,
            message: '❌ You do not have permission to hand off tickets in this department.'
        };
    }

    if (claimedBy !== userId) {
        return {
            allowed: false,
            ownerId,
            claimedBy,
            message: '❌ You must claim this ticket first.'
        };
    }

    return {
        allowed: true,
        ownerId,
        claimedBy,
        isSenior: false
    };
}

async function sendHandoffMessage(channel, ownerId, destination, notes) {
    const ownerMention = ownerId ? `<@${ownerId}>` : 'Customer';
    const roleMention = destination.roleId
        ? `<@&${destination.roleId}>`
        : destination.name;

    let text =
        `${ownerMention} ${roleMention}\n\n` +
        `**This ticket has been handed to ${destination.name}.**\n` +
        'The ticket has been unclaimed for the new department. ' +
        'A support member will be with you shortly.';

    if (notes) {
        text +=
            '\n\n**Notes from previous staff member**\n' +
            notes
                .split('\n')
                .map(line => `> ${line}`)
                .join('\n');
    }

    try {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(text)
            );

        return await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: {
                users: ownerId ? [ownerId] : [],
                roles: destination.roleId ? [destination.roleId] : []
            }
        });
    } catch (componentError) {
        console.error('[HANDOFF MESSAGE COMPONENT ERROR]', componentError);

        try {
            return await channel.send({
                content: text,
                allowedMentions: {
                    users: ownerId ? [ownerId] : [],
                    roles: destination.roleId ? [destination.roleId] : []
                }
            });
        } catch (plainError) {
            console.error('[HANDOFF MESSAGE FALLBACK ERROR]', plainError);
            return null;
        }
    }
}

async function openHandoffModal(interaction, helpers) {
    const channel = interaction.channel;

    if (!channel || !channel.isTextBased()) {
        await interaction.reply({
            content: '❌ This ticket channel could not be found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const permission = checkPermission(interaction, helpers);

    if (!permission.allowed) {
        await interaction.reply({
            content: permission.message,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const currentDepartment = getDepartmentFromParent(channel.parentId);
    const destinations = [
        getDepartmentFromKey('support'),
        getDepartmentFromKey('senior'),
        getDepartmentFromKey('reports_appeals')
    ]
        .filter(Boolean)
        .filter(destination => destination.key !== currentDepartment?.key);

    if (!destinations.length) {
        await interaction.reply({
            content: '❌ No other ticket departments are available.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const modal = new ModalBuilder()
        .setCustomId('ticket_handoff_modal')
        .setTitle('Hand Off Ticket');

    const select = new StringSelectMenuBuilder()
        .setCustomId('handoff_destination')
        .setPlaceholder('Select a destination...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            destinations.map(destination =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(destination.name)
                    .setValue(destination.key)
            )
        );

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Where would you like to hand this to?')
            .setStringSelectMenuComponent(select)
    );

    const nameInput = new TextInputBuilder()
        .setCustomId('handoff_name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Example: Claiming giveaway prize')
        .setMaxLength(90);

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Please name this ticket')
            .setTextInputComponent(nameInput)
    );

    const notesInput = new TextInputBuilder()
        .setCustomId('handoff_notes')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Add any useful notes for the next support member...')
        .setMaxLength(1000);

    modal.addLabelComponents(
        new LabelBuilder()
            .setLabel('Notes (Optional)')
            .setTextInputComponent(notesInput)
    );

    await interaction.showModal(modal);
}

async function submitHandoff(interaction, helpers) {
    const channel = interaction.channel;

    if (!channel || !channel.isTextBased()) {
        await interaction.reply({
            content: '❌ This ticket channel could not be found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const permission = checkPermission(interaction, helpers);

    if (!permission.allowed) {
        await interaction.editReply({
            content: permission.message
        });
        return;
    }

    if (activeHandoffs.has(channel.id)) {
        await interaction.editReply({
            content: '❌ A hand off is already being processed for this ticket.'
        });
        return;
    }

    const selected = interaction.fields
        .getStringSelectValues('handoff_destination')?.[0];

    const requestedName = interaction.fields
        .getTextInputValue('handoff_name')
        .trim();

    let notes = '';

    try {
        notes = interaction.fields
            .getTextInputValue('handoff_notes')
            ?.trim() || '';
    } catch {}

    const destination = getDepartmentFromKey(selected);
    const currentDepartment = getDepartmentFromParent(channel.parentId);

    if (!destination) {
        await interaction.editReply({
            content: '❌ Invalid hand off destination.'
        });
        return;
    }

    if (destination.key === currentDepartment?.key) {
        await interaction.editReply({
            content: '❌ This ticket is already in that department.'
        });
        return;
    }

    const newName = buildHandoffName(
        channel,
        permission.ownerId,
        requestedName
    );

    if (!newName) {
        await interaction.editReply({
            content: '❌ Please enter a valid ticket name.'
        });
        return;
    }

    activeHandoffs.add(channel.id);

    try {
        // Cancel any Claim/Unclaim title edit that has not reached Discord yet.
        // This lets the category move jump ahead instead of waiting behind old
        // cosmetic rename work.
        helpers?.prepareForHandoff?.(channel);

        await interaction.editReply({
            content: `✅ Hand off accepted. Moving ticket to ${destination.name}...`
        });

        // CATEGORY MOVE ONLY. Do not include name/topic here. Keeping the
        // critical move separate prevents a title rename rate limit from
        // blocking the department transfer.
        const movedChannel = await channel.setParent(
            destination.categoryId,
            {
                lockPermissions: false,
                reason: `Ticket handed off by ${interaction.user.tag}`
            }
        );

        const newTopic = String(movedChannel.topic || channel.topic || '')
            .replace(/(?:^|\|)claimed-by:\d+/g, '');

        // Main script becomes unclaimed immediately and schedules ONE final
        // name/topic sync. The requested handoff name never includes claimed-.
        helpers?.syncAfterHandoff?.(movedChannel, {
            name: newName,
            topic: newTopic,
            departmentKey: destination.key,
            reason: `Ticket handed off by ${interaction.user.tag}`
        });

        await interaction.editReply({
            content: `✅ Ticket handed off to ${destination.name}.`
        });

        const notification = await sendHandoffMessage(
            movedChannel,
            permission.ownerId,
            destination,
            notes
        );

        if (!notification) {
            try {
                await interaction.followUp({
                    content:
                        '⚠️ The ticket moved successfully, but Discord could not send the hand off message.',
                    flags: MessageFlags.Ephemeral
                });
            } catch {}
        }
    } catch (error) {
        console.error('[HANDOFF MOVE ERROR]', error);

        try {
            await interaction.editReply({
                content:
                    '❌ Discord could not move this ticket to the selected department. ' +
                    'The ticket has not been handed off.'
            });
        } catch {}
    } finally {
        activeHandoffs.delete(channel.id);
    }
}

async function handleTicketHandoffInteraction(interaction, helpers = {}) {
    if (
        interaction.isButton?.() &&
        interaction.customId === 'ticket_handoff'
    ) {
        await openHandoffModal(interaction, helpers);
        return true;
    }

    if (
        interaction.isModalSubmit?.() &&
        interaction.customId === 'ticket_handoff_modal'
    ) {
        await submitHandoff(interaction, helpers);
        return true;
    }

    return false;
}

module.exports = {
    handleTicketHandoffInteraction
};
