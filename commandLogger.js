const {
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
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

function stringifyOption(option, depth = 0) {
    if (!option || depth > 4) return [];

    if (Array.isArray(option.options) && option.options.length) {
        const prefix = option.type === 1 || option.type === 2 ? `${option.name} ` : '';
        return option.options
            .flatMap(child => stringifyOption(child, depth + 1))
            .map(value => `${prefix}${value}`.trim());
    }

    let value = option.value;
    if (option.user?.id) {
        value = `${option.user.globalName || option.user.username || 'Unknown user'} (${option.user.id})`;
    } else if (option.member?.id) {
        value = `${option.member.displayName || option.member.user?.username || 'Unknown user'} (${option.member.id})`;
    } else if (option.role?.id) {
        value = `${option.role.name || 'Role'} (${option.role.id})`;
    } else if (option.channel?.id) {
        value = `#${option.channel.name || 'channel'} (${option.channel.id})`;
    } else if (option.attachment?.name) {
        value = option.attachment.name;
    }

    if (value === undefined || value === null || value === '') return [];
    return [`**${option.name}:** ${String(value)}`];
}

function commandDetails(interaction) {
    const details = (interaction.options?.data || []).flatMap(option => stringifyOption(option));
    return details.length ? details.join('\n') : '*No options supplied.*';
}

async function sendCommandLog(client, { command, userName, userId, channelName, channelId, timestamp, details }) {
    try {
        const channel = await client.channels.fetch(LOG_CHANNEL_ID);
        if (!channel?.isTextBased?.()) return;

        const unix = Math.floor((timestamp || Date.now()) / 1000);
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## Command Used\n` +
                    `**Command:** \`${command}\`\n` +
                    `**User:** ${userName} (\`${userId}\`)\n` +
                    `**Channel:** ${channelName ? `#${channelName}` : 'Unknown'}${channelId ? ` (\`${channelId}\`)` : ''}\n` +
                    `**Time:** <t:${unix}:F> • <t:${unix}:R>`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### Details\n${details || '*No additional details.*'}`)
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
        userId: interaction.user.id,
        channelName: interaction.channel?.name || null,
        channelId: interaction.channelId,
        timestamp: interaction.createdTimestamp,
        details: commandDetails(interaction)
    });
}

async function logMessageCommand(message, commandName, details = null) {
    if (!message?.client || !message?.author) return;

    await sendCommandLog(message.client, {
        command: commandName,
        userName: plainUserName(message.member, message.author),
        userId: message.author.id,
        channelName: message.channel?.name || null,
        channelId: message.channelId,
        timestamp: message.createdTimestamp,
        details: details || '*No additional details.*'
    });
}

module.exports = {
    LOG_CHANNEL_ID,
    logSlashCommand,
    logMessageCommand
};
