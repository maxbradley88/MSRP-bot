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
const ticketState = require('./ticketState');
const ticketStatus = require('./ticketStatus');
const ticketPermissions = require('./ticketPermissions');

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

function hasBeenHandedOff(channel) {
    const topic = ticketState.getEffectiveTopic?.(channel) || channel?.topic || '';
    return /(?:^|\|)handed-off:1(?:\||$)/.test(String(topic));
}

function buildHandedOffTopic(channel) {
    let topic = String(
        ticketState.getEffectiveTopic?.(channel) ||
        channel?.topic ||
        ''
    );

    topic = topic
        .replace(/(?:^|\|)claimed-by:\d+/g, '')
        .replace(/(?:^|\|)handed-off:1/g, '')
        .replace(/^\|+|\|+$/g, '')
        .replace(/\|{2,}/g, '|');

    return `${topic}${topic ? '|' : ''}handed-off:1`;
}

function getOwnerId(channel) {
    const match = String(channel?.topic || '').match(/(?:^|\|)ticket-owner:(\d+)/);
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

function checkPermission(interaction) {
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

    const claimedBy = ticketState.getClaimedUserId(channel);

    if (!claimedBy) {
        return {
            allowed: false,
            ownerId,
            claimedBy,
            message: '❌ You must claim this ticket first.'
        };
    }

    // SSS can hand off any claimed ticket, regardless of claimant or department.
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

    if (!correctDepartmentRole || claimedBy !== userId) {
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

function formatName(value) {
    const cleaned = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .replace(/[ _]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');

    return cleaned || null;
}

async function buildHandoffName(channel, ownerId, requestedName) {
    const prefix = formatName(requestedName);
    if (!prefix) return null;

    const currentName = ticketState.stripClaimedPrefix(
        ticketState.getEffectiveName(channel) || channel.name
    );

    const numberMatch = currentName.match(/-(\d{1,6})$/);
    const ticketNumber = numberMatch ? numberMatch[1] : null;

    let ownerUsername = null;

    if (ownerId) {
        ownerUsername =
            channel.guild?.members?.cache?.get(ownerId)?.user?.username ||
            channel.client?.users?.cache?.get(ownerId)?.username ||
            null;

        if (!ownerUsername) {
            try {
                const member = await channel.guild.members.fetch(ownerId);
                ownerUsername = member?.user?.username || null;
            } catch {}
        }
    }

    const safeUsername = ownerUsername
        ? ownerUsername
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '')
        : null;

    if (safeUsername && ticketNumber) {
        const suffix = `${safeUsername}-${ticketNumber}`;
        const maxPrefixLength = Math.max(1, 100 - suffix.length - 1);
        return `${prefix.slice(0, maxPrefixLength)}-${suffix}`;
    }

    // Fallback: preserve the final two name segments if possible.
    const parts = currentName.split('-').filter(Boolean);
    if (parts.length >= 3) {
        const suffix = parts.slice(-2).join('-');
        const maxPrefixLength = Math.max(1, 100 - suffix.length - 1);
        return `${prefix.slice(0, maxPrefixLength)}-${suffix}`;
    }

    return prefix.slice(0, 100);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

    for (let attempt = 1; attempt <= 5; attempt += 1) {
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
            console.error(
                `[HANDOFF MESSAGE COMPONENT ERROR ${attempt}/5]`,
                componentError
            );

            try {
                return await channel.send({
                    content: text,
                    allowedMentions: {
                        users: ownerId ? [ownerId] : [],
                        roles: destination.roleId ? [destination.roleId] : []
                    }
                });
            } catch (plainError) {
                console.error(
                    `[HANDOFF MESSAGE FALLBACK ERROR ${attempt}/5]`,
                    plainError
                );
            }
        }

        if (attempt < 5) {
            await sleep(500 * attempt);
        }
    }

    return null;
}

async function openHandoffModal(interaction) {
    const channel = interaction.channel;

    if (!channel || !channel.isTextBased()) {
        await interaction.reply({
            content: '❌ This ticket channel could not be found.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (hasBeenHandedOff(channel)) {
        await interaction.reply({
            content: 'This ticket has already been handed off',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const permission = checkPermission(interaction);

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

async function submitHandoff(interaction) {
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

    if (hasBeenHandedOff(channel)) {
        await interaction.editReply({
            content: 'This ticket has already been handed off'
        });
        return;
    }

    const permission = checkPermission(interaction);

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

    activeHandoffs.add(channel.id);

    try {
        // Do not leave the interaction on Discord's "thinking" state while a
        // channel move is queued by Discord.
        await interaction.editReply({
            content: `✅ Hand off accepted. Transferring to ${destination.name}...`
        });

        // One Discord edit does all critical handoff state at once:
        // move department + unclaim + permanently mark as handed off.
        // This avoids extra queued channel edits after the move.
        ticketState.forgetTicket(channel.id);

        const movedChannel = await channel.edit({
            parent: destination.categoryId,
            topic: buildHandedOffTopic(channel),
            reason: `Ticket handed off by ${interaction.user.tag}`
        });

        // Future claim/unclaim actions should read the confirmed Discord state.
        ticketState.forgetTicket(movedChannel.id);

        // Rebuild staff visibility/write permissions for the NEW department.
        // The previous department immediately loses access, the destination
        // department can view but cannot type until someone claims, and SSS
        // keeps full access everywhere.
        await ticketPermissions.applyTicketPermissions(
            movedChannel,
            {
                departmentKey: destination.key,
                claimedBy: null,
                reason:
                    `Ticket handed off by ${interaction.user.tag}`
            }
        );

        try {
            await ticketStatus.setTicketControlState(
                movedChannel,
                false,
                true
            );
        } catch (statusError) {
            console.error(
                '[HANDOFF BUTTON STATUS ERROR]',
                statusError
            );
        }

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
                        '⚠️ The ticket moved successfully, but Discord could not send the hand off message after several attempts.',
                    flags: MessageFlags.Ephemeral
                });
            } catch {}
        }
    } catch (error) {
        console.error('[HANDOFF MOVE ERROR]', error);

        try {
            await interaction.editReply({
                content:
                    '❌ Discord could not move this ticket to the selected department. The ticket was left unchanged.'
            });
        } catch {}
    } finally {
        activeHandoffs.delete(channel.id);
    }
}

async function handleTicketHandoffInteraction(interaction) {
    if (
        interaction.isButton?.() &&
        interaction.customId === 'ticket_handoff'
    ) {
        await openHandoffModal(interaction);
        return true;
    }

    if (
        interaction.isModalSubmit?.() &&
        interaction.customId === 'ticket_handoff_modal'
    ) {
        await submitHandoff(interaction);
        return true;
    }

    return false;
}

module.exports = {
    handleTicketHandoffInteraction
};
