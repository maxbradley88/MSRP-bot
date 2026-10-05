const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');

const { createTicketDashboard } = require('./ticketDashboard');
const { setupTicketIcons } = require('./ticketIcons');

const config = require('./ticketConfig');

const command = new SlashCommandBuilder()
    .setName('send-ticket-dashboard')
    .setDescription('Sends the support ticket dashboard.');

async function execute(interaction) {

    // Acknowledge the command immediately.
    // Creating the icons can take longer than Discord's
    // initial interaction response window.
    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    const dashboardChannel = interaction.guild.channels.cache.get(
        config.supportChannelId
    );

    if (!dashboardChannel) {

        await interaction.editReply({
            content:
                '❌ The configured ticket dashboard channel could not be found.'
        });

        return;
    }

    try {

        // ==========================================
        // CREATE / FIND TICKET ICONS
        // ==========================================

        console.log('🎨 Setting up ticket icons...');

        const iconMap = await setupTicketIcons(
            interaction.guild
        );

        console.log('✅ Ticket icons ready!');


        // ==========================================
        // CREATE DASHBOARD
        // ==========================================

        const dashboard = createTicketDashboard(
            iconMap
        );


        // ==========================================
        // SEND DASHBOARD
        // ==========================================

        await dashboardChannel.send(
            dashboard
        );


        // ==========================================
        // COMMAND RESPONSE
        // ==========================================

        await interaction.editReply({
            content:
                `✅ Ticket dashboard sent to ${dashboardChannel}.`
        });

    } catch (error) {

        console.error(
            '❌ Failed to send ticket dashboard:',
            error
        );

        await interaction.editReply({
            content:
                '❌ Something went wrong while creating the ticket dashboard. Check the bot console for the error.'
        }).catch(() => {});
    }
}

module.exports = {
    command,
    execute
};