const {
    ContainerBuilder,
    MessageFlags,
    TextDisplayBuilder
} = require('discord.js');

const LOG_CHANNEL_ID = '1547548896526336040';

function plainUserName(member, user) {
    return (
        member?.displayName ||
        user?.globalName ||
        user?.username ||
        'Unknown user'
    );
}

async function sendCommandLog(client, { command, userName, channelName, timestamp }) {
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (!channel?.isTextBased?.()) return;

        const unix = Math.floor((timestamp || Date.now()) / 1000);
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## Command Used\n` +
                    `**Command:** \`${command}\`\n` +
                    `**User:** ${userName}\n` +
                    `**Channel:** ${channelName ? `#${channelName}` : 'Unknown'}\n` +
                    `**Time:** <t:${unix}:F> • <t:${unix}:R>`
                )
            );

        await channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [container],
            allowedMentions: { parse: [] }
        });
    } catch (error) {
        console.warn('[COMMAND LOG] Could not send command log:', error.message);
    }
}

async function logSlashCommand(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    await sendCommandLog(interaction.client, {
        command: `/${interaction.commandName}`,
        userName: plainUserName(interaction.member, interaction.user),
        channelName: interaction.channel?.name || null,
        timestamp: interaction.createdTimestamp
    });
}

async function logMessageCommand(message, commandName) {
    if (!message?.client || !message?.author) return;

    await sendCommandLog(message.client, {
        command: commandName,
        userName: plainUserName(message.member, message.author),
        channelName: message.channel?.name || null,
        timestamp: message.createdTimestamp
    });
}

module.exports = {
    LOG_CHANNEL_ID,
    logSlashCommand,
    logMessageCommand
};
