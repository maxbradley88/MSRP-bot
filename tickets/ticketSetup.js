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
    TextDisplayBuilder,
    SlashCommandBuilder
} = require('discord.js');

const { createTicketDashboard } = require('./ticketDashboard');
const { setupTicketIcons } = require('./ticketIcons');
const sendTicketDashboardCommand =
    new SlashCommandBuilder()
        .setName('send-ticket-dashboard')
        .setDescription('Sends the ticket dashboard.');

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

        // Share the existing custom application emoji with the ticket dashboard.
        // Avoid unnecessary Discord API calls or creating a duplicate emoji.
        const applicationsEmoji = interaction.guild.emojis.cache.find(
            emoji => emoji.name === 'msrp_applications'
        );
        if (applicationsEmoji) {
            iconMap.applications = {
                id: applicationsEmoji.id,
                name: applicationsEmoji.name
            };
        } else {
            console.warn('[TICKET DASHBOARD] msrp_applications emoji not in guild cache; displaying button without emoji.');
        }

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

const fs = require('node:fs');
const path = require('node:path');
const BULK_DATA_PATH = path.join(__dirname, 'ticketDashboard.runtime.json');
async function refreshForBulk(guild) {
    const channel = await guild.channels.fetch(config.supportChannelId);
    if (!channel || typeof channel.send !== 'function') throw new Error('Support ticket dashboard channel unavailable.');
    let messageId = null;
    try { messageId = JSON.parse(fs.readFileSync(BULK_DATA_PATH,'utf8')).messageId; } catch (_) {}
    let old = null;
    if (messageId) {
        try { old = await channel.messages.fetch(messageId); }
        catch (error) { if (error.code !== 10008) throw error; }
    }
    // Legacy send-ticket-dashboard did not persist its message ID. Search only
    // this channel for a message with the unique ticket_type_select component.
    if (!old) {
        const messages = await channel.messages.fetch({limit:100});
        old = messages.find(m => m.author?.id === guild.client.user.id &&
            JSON.stringify(m.components?.map(c=>c.toJSON?.() || c) || []).includes('ticket_type_select')) || null;
    }
    const {getTicketEmoji} = require('./ticketIcons');
    const map = {};
    for (const key of Object.keys(config.ticketTypes || {})) {
        const emoji = getTicketEmoji(guild,key);
        if (emoji) map[key] = emoji;
    }
    for (const key of ['ticketRules','information']) {
        const emoji = getTicketEmoji(guild,key);
        if (emoji) map[key] = emoji;
    }
    const applicationEmoji = guild.emojis.cache.find(e=>e.name==='msrp_applications');
    if (applicationEmoji) map.applications = {id:applicationEmoji.id,name:applicationEmoji.name};
    const payload = createTicketDashboard(map);
    if (old) {
        try {
            await old.edit({...payload,attachments:[]});
            fs.writeFileSync(BULK_DATA_PATH,JSON.stringify({channelId:channel.id,messageId:old.id},null,2));
            return {action:'updated',url:old.url};
        } catch (error) { if (error.code !== 10008) throw error; }
    }
    const sent = await channel.send(payload);
    fs.writeFileSync(BULK_DATA_PATH,JSON.stringify({channelId:channel.id,messageId:sent.id},null,2));
    return {action:'created',url:sent.url};
}

module.exports = {
    refreshForBulk,
    command,
    execute
};