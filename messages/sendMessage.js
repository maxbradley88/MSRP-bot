const ALLOWED_ROLE_ID = '1547525713853288448';
const PREFIX = 'm!send';

module.exports = function setupSendMessage(client) {
    client.on('messageCreate', async message => {
        try {
            // Ignore bots and DMs
            if (message.author.bot || !message.guild) {
                return;
            }

            // Must start with m!send
            if (!message.content.toLowerCase().startsWith(PREFIX)) {
                return;
            }

            // Only the allowed role can use it
            if (!message.member.roles.cache.has(ALLOWED_ROLE_ID)) {
                return;
            }

            // Remove "m!send" from the beginning
            const content = message.content
                .slice(PREFIX.length)
                .trimStart();

            // Copy any attachments/images/files
            const files = [
                ...message.attachments.values()
            ].map(attachment => ({
                attachment: attachment.url,
                name: attachment.name
            }));

            // Don't send an empty message
            if (!content && files.length === 0) {
                return;
            }

            // Send the copied message as the bot
            await message.channel.send({
                content: content || undefined,
                files,
                allowedMentions: {
                    parse: [
                        'users',
                        'roles',
                        'everyone'
                    ]
                }
            });

            // Delete the user's original message
            await message.delete();

        } catch (error) {
            console.error(
                '[M!SEND ERROR]',
                error
            );
        }
    });
};