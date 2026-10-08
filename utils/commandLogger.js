const {
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');

const LOG_CHANNEL_ID = '1547548896526336040';

function stringifyOption(option, depth = 0) {
    if (!option || depth > 4) return [];

    if (Array.isArray(option.options) && option.options.length) {
        const prefix = option.type === 1 || option.type === 2 ? `${option.name} ` : '';
        return option.options.flatMap(child => stringifyOption(child, depth + 1)).map(value => `${prefix}${value}`.trim());
    }

    let value = option.value;
    if (option.user?.id) value = `<@${option.user.id}>`;
    else if (option.member?.id) value = `<@${option.member.id}>`;
    else if (option.role?.id) value = `<@&${option.role.id}>`;
    else if (option.channel?.id) value = `<#${option.channel.id}>`;
    else if (option.attachment?.name) value = option.attachment.name;

    if (value === undefined || value === null || value === '') return [];
    return [`**${option.name}:** ${String(value)}`];
}

function commandDetails(interaction) {
    const details = (interaction.options?.data || []).flatMap(option => stringifyOption(option));
    return details.length ? details.join('\n') : '*No options supplied.*';
}

async function logSlashCommand(interaction) {
    if (!interaction?.isChatInputCommand?.()) return;

    try {
        const channel = await interaction.client.channels.fetch(LOG_CHANNEL_ID);
        if (!channel?.isTextBased?.()) return;

        const unix = Math.floor((interaction.createdTimestamp || Date.now()) / 1000);
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## Command Used\n` +
                    `**Command:** \`/${interaction.commandName}\`\n` +
                    `**User:** <@${interaction.user.id}> (\`${interaction.user.id}\`)\n` +
                    `**Channel:** ${interaction.channelId ? `<#${interaction.channelId}>` : 'Unknown'}\n` +
                    `**Time:** <t:${unix}:F> • <t:${unix}:R>`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`### Details\n${commandDetails(interaction)}`)
            );

        await channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [container]
        });
    } catch (error) {
        console.warn('[COMMAND LOG] Could not send command log:', error.message);
    }
}

module.exports = {
    LOG_CHANNEL_ID,
    logSlashCommand
};
