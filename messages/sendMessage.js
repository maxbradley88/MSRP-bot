const ALLOWED_ROLE_ID = '1547525713853288448';
const PREFIX = 'm!send';
const { logMessageCommand } = require('../utils/commandLogger');

module.exports = function setupSendMessage(client) {
    client.on('messageCreate', async message => {
        try {
            if (message.author.bot || !message.guild) return;
            if (!message.content.toLowerCase().startsWith(PREFIX)) return;

            const content = message.content.slice(PREFIX.length).trimStart();
            const attachmentNames = [...message.attachments.values()]
                .map(a => a.name)
                .filter(Boolean);

            const detailParts = [];
            if (content) {
                detailParts.push(`**Message:** ${content.slice(0, 1200)}`);
            }
            if (attachmentNames.length) {
                detailParts.push(`**Attachments:** ${attachmentNames.join(', ')}`);
            }
            if (!message.member.roles.cache.has(ALLOWED_ROLE_ID)) {
                detailParts.push('**Result:** Denied — missing required role.');
            } else {
                detailParts.push('**Result:** Accepted.');
            }

            // Log every attempted m!send before permission handling.
            void logMessageCommand(
                message,
                'm!send',
                detailParts.join('\n')
            );

            if (!message.member.roles.cache.has(ALLOWED_ROLE_ID)) return;

            const files = [...message.attachments.values()].map(attachment => ({
                attachment: attachment.url,
                name: attachment.name
            }));

            if (!content && files.length === 0) return;

            await message.channel.send({
                content: content || undefined,
                files,
                allowedMentions: {
                    parse: ['users', 'roles', 'everyone']
                }
            });

            await message.delete();
        } catch (error) {
            console.error('[M!SEND ERROR]', error);
        }
    });
};
