const {
    ActionRowBuilder,
    UserSelectMenuBuilder,
    MessageFlags
} = require('discord.js');

const ticketState = require('./ticketState');
const ticketPermissions = require('./ticketPermissions');

function isTicketChannel(channel) {
    return Boolean(
        channel?.isTextBased?.() &&
        /(?:^|\|)ticket-owner:\d+/.test(String(channel.topic || ''))
    );
}

function getTicketOwnerId(channel) {
    const match = String(channel?.topic || '')
        .match(/(?:^|\|)ticket-owner:(\d+)/);

    return match ? match[1] : null;
}

async function deny(interaction, content) {
    const payload = {
        content,
        flags: MessageFlags.Ephemeral
    };

    if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload);
    } else {
        await interaction.reply(payload);
    }
}

async function handleAddUserButton(interaction) {
    const channel = interaction.channel;

    if (!isTicketChannel(channel)) {
        await deny(interaction, '❌ This button can only be used inside a ticket.');
        return true;
    }

    const claimedBy = ticketState.getClaimedUserId(channel);

    if (!claimedBy) {
        await deny(interaction, '❌ This ticket must be claimed before a customer can be added.');
        return true;
    }

    if (claimedBy !== interaction.user.id) {
        await deny(
            interaction,
            '❌ Only the staff member who currently has this ticket claimed can add another customer.'
        );
        return true;
    }

    const select = new UserSelectMenuBuilder()
        .setCustomId('ticket_add_user_select')
        .setPlaceholder('Select a user to add as a customer')
        .setMinValues(1)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(select);

    await interaction.reply({
        content: 'Select the user you want to add to this combined ticket.',
        components: [row],
        flags: MessageFlags.Ephemeral
    });

    return true;
}

async function handleAddUserSelect(interaction) {
    const channel = interaction.channel;

    if (!isTicketChannel(channel)) {
        await interaction.update({
            content: '❌ This ticket could not be found.',
            components: []
        });
        return true;
    }

    const claimedBy = ticketState.getClaimedUserId(channel);

    if (!claimedBy || claimedBy !== interaction.user.id) {
        await interaction.update({
            content: '❌ You no longer have this ticket claimed, so you cannot add a customer.',
            components: []
        });
        return true;
    }

    const targetId = interaction.values?.[0];
    const ownerId = getTicketOwnerId(channel);
    const botId = interaction.client.user?.id;

    if (!targetId) {
        await interaction.update({
            content: '❌ No user was selected.',
            components: []
        });
        return true;
    }

    if (targetId === ownerId) {
        await interaction.update({
            content: '❌ That user is already the original customer of this ticket.',
            components: []
        });
        return true;
    }

    if (targetId === claimedBy) {
        await interaction.update({
            content: '❌ You cannot add yourself as a customer while you are handling the ticket.',
            components: []
        });
        return true;
    }

    if (targetId === botId) {
        await interaction.update({
            content: '❌ The bot cannot be added as a ticket customer.',
            components: []
        });
        return true;
    }

    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);

    if (targetUser?.bot) {
        await interaction.update({
            content: '❌ Bots cannot be added as ticket customers.',
            components: []
        });
        return true;
    }

    if (ticketState.isAdditionalCustomer(channel, targetId)) {
        await interaction.update({
            content: `<@${targetId}> is already an additional customer on this ticket.`,
            components: [],
            allowedMentions: { users: [] }
        });
        return true;
    }

    ticketState.addAdditionalCustomer(
        channel,
        targetId,
        {
            reason: `Ticket customer added by ${interaction.user.tag}`,
            delay: 0
        }
    );

    await ticketPermissions.applyTicketPermissions(
        channel,
        {
            claimedBy,
            reason: `Add ticket customer ${targetId}`
        }
    );

    await interaction.update({
        content: `✅ <@${targetId}> has been added to this ticket as an additional customer.`,
        components: [],
        allowedMentions: { users: [] }
    });

    await channel.send({
        content: `<@${targetId}> has been added to this combined ticket by <@${interaction.user.id}>.`,
        allowedMentions: {
            users: [targetId, interaction.user.id]
        }
    });

    return true;
}

async function handleInteraction(interaction) {
    if (
        interaction.isButton?.() &&
        interaction.customId === 'ticket_add_user'
    ) {
        return handleAddUserButton(interaction);
    }

    if (
        interaction.isUserSelectMenu?.() &&
        interaction.customId === 'ticket_add_user_select'
    ) {
        return handleAddUserSelect(interaction);
    }

    return false;
}

module.exports = {
    handleInteraction
};
