'use strict';

const {
  PermissionFlagsBits, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');

const ANNOUNCEMENTS_CHANNEL_IDS = new Set([
  '1547544817641455626', // Main announcements
  '1555455731157700628', // Media notices
]);
const MEDIA_ONLY_CHANNEL_ID = '1564917954854780938';

// Accept exactly one uploaded image or video per message. No URLs, captions,
// miscellaneous files, stickers, or multi-attachment messages.
const MEDIA_EXT = /\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov)$/i;
const MEDIA_TYPES = /^(?:image|video)\//i;

async function rejectMedia(message) {
  await message.delete().catch(error => console.error('[MEDIA CHANNEL] Could not remove invalid post:', error));
  await message.author.send(
    'Your post in the media channel was removed. Please upload exactly one image or video per message, with no links, captions, or other attachments.'
  ).catch(() => {});
}

async function repostMedia(message) {
  const attachments = [...message.attachments.values()];
  const noText = !message.content?.trim();
  const oneAttachment = attachments.length === 1;
  const noOtherMedia = !message.stickers?.size;
  const attachment = attachments[0];
  // Require a recognised media MIME type or filename extension, and do not
  // let a non-media MIME type pass merely because its filename looks like an image.
  const contentType = attachment?.contentType || '';
  const validType = MEDIA_TYPES.test(contentType) ||
    (!contentType && MEDIA_EXT.test(attachment?.name || ''));

  if (!noText || !oneAttachment || !noOtherMedia || !validType) {
    await rejectMedia(message);
    return;
  }

  const filename = `media-${message.id}-${(attachment.name || 'upload').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 75)}`;
  const container = new ContainerBuilder()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(`attachment://${filename}`)
      )
    )
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# Credits: <@${message.author.id}>`)
    );

  // If sending fails, keep the original upload rather than losing the media.
  await message.channel.send({
    components: [container],
    files: [{ attachment: attachment.url, name: filename }],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
  });
  await message.delete().catch(error => console.error('[MEDIA CHANNEL] Reposted but original could not be deleted:', error));
}

module.exports = function registerAnnouncementRelay(client) {
  client.on('messageCreate', async message => {
    if (!message?.guild || message.author?.bot || message.webhookId) return;
    if (!message.channel?.isTextBased?.()) return;
    if (message.channelId !== MEDIA_ONLY_CHANNEL_ID && !ANNOUNCEMENTS_CHANNEL_IDS.has(message.channelId)) return;

    try {
      const me = message.guild.members.me || await message.guild.members.fetchMe();
      const permissions = message.channel.permissionsFor(me);
      const needed = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages];
      if (message.channelId === MEDIA_ONLY_CHANNEL_ID) needed.push(PermissionFlagsBits.AttachFiles);
      if (!permissions || !needed.every(p => permissions.has(p))) {
        console.error(`[ANNOUNCEMENT RELAY] Missing permissions in channel ${message.channelId}`);
        return;
      }
      if (message.channelId === MEDIA_ONLY_CHANNEL_ID) {
        await repostMedia(message);
        return;
      }

      // Preserve the behaviour of the existing announcement channels.
      const files = [...message.attachments.values()].map(attachment => ({
        attachment: attachment.url,
        name: attachment.name || undefined,
        description: attachment.description || undefined,
      }));
      const stickers = [...message.stickers.values()].map(sticker => sticker.id).filter(Boolean);
      const payload = { allowedMentions: { parse: ['users', 'roles', 'everyone'], repliedUser: false } };
      if (message.content?.length) payload.content = message.content;
      if (files.length) payload.files = files;
      if (stickers.length) payload.stickers = stickers;
      if (!payload.content && !payload.files && !payload.stickers) return;
      await message.channel.send(payload);
      await message.delete().catch(error => console.error('[ANNOUNCEMENT RELAY] Could not delete original:', error));
    } catch (error) {
      console.error('[ANNOUNCEMENT RELAY ERROR]', error);
    }
  });
};
