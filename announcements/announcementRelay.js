const { PermissionFlagsBits } = require('discord.js');

const ANNOUNCEMENTS_CHANNEL_ID = '1547544817641455626';

/**
 * Reposts member messages in the announcements channel through the bot.
 * The source message is deleted only after the bot repost succeeds.
 */
module.exports = function registerAnnouncementRelay(client) {
    client.on('messageCreate', async message => {
        try {
            if (!message || message.author?.bot || message.webhookId) {
                return;
            }

            if (message.channelId !== ANNOUNCEMENTS_CHANNEL_ID) {
                return;
            }

            // Do not touch system-generated messages.
            if (!message.channel?.isTextBased?.()) {
                return;
            }

            const me = message.guild?.members?.me;
            if (me) {
                const permissions = message.channel.permissionsFor(me);
                if (
                    !permissions?.has(PermissionFlagsBits.SendMessages) ||
                    !permissions?.has(PermissionFlagsBits.ManageMessages)
                ) {
                    console.error(
                        '[ANNOUNCEMENT RELAY] Missing Send Messages or Manage Messages permission in the announcements channel.'
                    );
                    return;
                }
            }

            const files = [...message.attachments.values()].map(attachment => ({
                attachment: attachment.url,
                name: attachment.name || undefined,
                description: attachment.description || undefined
            }));

            const stickers = [...message.stickers.values()]
                .map(sticker => sticker.id)
                .filter(Boolean);

            const payload = {
                allowedMentions: {
                    parse: ['users', 'roles', 'everyone'],
                    repliedUser: false
                }
            };

            if (message.content?.length) {
                payload.content = message.content;
            }

            if (files.length) {
                payload.files = files;
            }

            if (stickers.length) {
                payload.stickers = stickers;
            }

            // Ignore truly empty messages rather than trying to send an invalid payload.
            if (!payload.content && !payload.files && !payload.stickers) {
                return;
            }

            await message.channel.send(payload);

            // Only delete the staff member's original after the bot copy exists.
            await message.delete().catch(error => {
                console.error(
                    '[ANNOUNCEMENT RELAY] Reposted successfully but could not delete original message:',
                    error?.message || error
                );
            });

            console.log(
                `[ANNOUNCEMENT RELAY] Reposted announcement from ${message.author.username} (${message.author.id}).`
            );
        } catch (error) {
            console.error(
                '[ANNOUNCEMENT RELAY ERROR]',
                error
            );
        }
    });
};
