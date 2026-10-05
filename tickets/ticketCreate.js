const {
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

const config = require('./ticketConfig');

async function createTicket(interaction, ticketType, answers = {}) {

    const guild = interaction.guild;
    const user = interaction.user;

    const typeConfig = config.ticketTypes[ticketType];

    // Make sure the ticket type exists
    if (!typeConfig) {
        await interaction.reply({
            content: '❌ This ticket type does not exist.',
            ephemeral: true
        });
        return;
    }

    // ==========================================
    // WORK OUT WHICH CATEGORY THIS TICKET USES
    // ==========================================

const isSeniorTicket = typeConfig.category === 2;
const isReportsAppealsTicket = typeConfig.category === 3;

let categoryId;

if (isReportsAppealsTicket) {
    categoryId = config.reportsAppealsTicketCategoryId;
} else if (isSeniorTicket) {
    categoryId = config.seniorTicketCategoryId;
} else {
    categoryId = config.supportTicketCategoryId;
}


    // ==========================================
    // CHECK HOW MANY TICKETS THE USER HAS
    // ==========================================

    const userTickets = guild.channels.cache.filter(channel =>
        channel.topic?.startsWith(`ticket-owner:${user.id}`)
    );

    const userTicketCount = userTickets.size;

    if (
        !isSeniorTicket &&
        userTicketCount >= config.maxTicketsPerUser
    ) {
        await interaction.reply({
            content:
                `❌ You already have the maximum number of open tickets (${config.maxTicketsPerUser}).`,
            ephemeral: true
        });
        return;
    }


    // ==========================================
    // SENIOR TICKET LIMIT
    // ==========================================

    if (
        isSeniorTicket &&
        userTicketCount >= config.maxSeniorTicketsPerUser
    ) {
        await interaction.reply({
            content:
                `❌ You already have the maximum number of open Senior Support tickets (${config.maxSeniorTicketsPerUser}).`,
            ephemeral: true
        });
        return;
    }


    // ==========================================
    // PERMISSIONS
    // ==========================================

    const permissionOverwrites = [

        // Hide the ticket from everyone
        {
            id: guild.roles.everyone.id,
            deny: [
                PermissionFlagsBits.ViewChannel
            ]
        },

        // Ticket creator
        {
            id: user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },

        // Support Staff
        {
            id: config.supportStaffRoleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },

        // Senior Support Staff can always see tickets
        {
            id: config.seniorSupportStaffRoleId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },

        // Bot
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

    const ticketNumber = guild.channels.cache.filter(
        channel =>
            channel.parentId === categoryId &&
            channel.topic?.startsWith('ticket-owner:')
    ).size + 1;

    const paddedNumber = String(ticketNumber).padStart(3, '0');


    // ==========================================
    // CHANNEL NAME
    // ==========================================

    const safeUsername = user.username
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-');

    const channelName =
        `${ticketType}-${safeUsername}-${paddedNumber}`;


    // ==========================================
    // CREATE CHANNEL
    // ==========================================

    const ticketChannel = await guild.channels.create({

        name: channelName,

        type: ChannelType.GuildText,

        parent: categoryId,

        topic: `ticket-owner:${user.id}`,

        permissionOverwrites

    });


    // ==========================================
    // RESPOND TO USER
    // ==========================================

    await interaction.reply({
        content: `✅ Your ticket has been created: ${ticketChannel}`,
        ephemeral: true
    });


    // ==========================================
    // OPENING MESSAGE
    // ==========================================

await ticketChannel.send({
    content:
        `**Thank you for using the support system ${user}**\n` +
        `A staff member will be with you shortly, please provide any details that may be helpful to our support team in the meantime.\n\n` +
        `*Please do not mention our support staff*\n` +
        `<@&${typeConfig.roleId}>`
});

}

module.exports = {
    createTicket
};