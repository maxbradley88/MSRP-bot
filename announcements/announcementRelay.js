'use strict';

const {
  PermissionFlagsBits, MessageFlags,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, FileBuilder,
} = require('discord.js');

const ANNOUNCEMENTS_CHANNEL_IDS = new Set([
  '1547544817641455626', // Main announcements
  '1555455731157700628', // Media notices
]);
const MEDIA_ONLY_CHANNEL_ID = '1564917954854780938';

const MEDIA_EXT = /\.(?:png|jpe?g|gif|webp|avif|mp4|webm|mov)(?:[?#]|$)/i;
const MEDIA_TYPES = /^(?:image|video)\//i;
const URL_TOKEN = /^https?:\/\/\S+$/i;

function cleanUrl(token) {
  return token.replace(/[),.;!?]+$/g, '');
}

function getUrls(content) {
  const tokens = (content || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const urls = tokens.map(cleanUrl);
  if (!urls.every(u => URL_TOKEN.test(u))) return null;
  if (urls.length > 15) return null;
  try {
    urls.forEach(u => {
      const parsed = new URL(u);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw Error('Invalid protocol');
    });
    return urls;
  } catch {
    return null;
  }
}

async function repostMedia(message) {
  const urls = getUrls(message.content);
  const attachments = [...message.attachments.values()];
  // Only standalone URLs and/or attachments are permitted. Do not accept captions or other text.
  if (urls === null || (!urls.length && !attachments.length)) {
    await message.delete().catch(e => console.error('[MEDIA CHANNEL] Could not remove invalid post:', e));
    await message.author.send('Your post in the media channel was removed. Please send only links, images, videos or attachments (without extra text).')
      .catch(() => {});
    return;
  }

  const container = new ContainerBuilder(); // No accent colour.
  const gallery = [];
  const textLinks = [];
  const files = [];
  const fileComponents = [];

  // Remote web links are rendered as media if they point directly to images or videos.
  // Site pages (such as youtube.com/watch) stay clickable links, not inline players.
  for (const url of urls) {
    if (MEDIA_EXT.test(url) && gallery.length < 10) {
      gallery.push(new MediaGalleryItemBuilder().setURL(url));
    } else {
      textLinks.push(url);
    }
  }

  // Files must be explicitly referenced by a Components V2 gallery/file component.
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const filename = `media-${i}-${(att.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 75)}`;
    if (MEDIA_TYPES.test(att.contentType || '') || MEDIA_EXT.test(att.name || '')) {
      if (gallery.length < 10) {
        files.push({ attachment: att.url, name: filename });
        gallery.push(new MediaGalleryItemBuilder().setURL(`attachment://${filename}`));
        continue;
      }
    }
    files.push({ attachment: att.url, name: filename });
    fileComponents.push(new FileBuilder().setURL(`attachment://${filename}`));
  }

  if (gallery.length) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...gallery));
  }
  if (textLinks.length) {
    // Each URL remains visible and clickable; no raw top-level content in Components V2.
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(textLinks.join('\n')));
  }
  for (const file of fileComponents) container.addFileComponents(file);
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# Credits: <@${message.author.id}>`)
  );

  await message.channel.send({
    components: [container],
    files,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { users: [message.author.id], roles: [], repliedUser: false },
  });
  await message.delete().catch(e => console.error('[MEDIA CHANNEL] Reposted but original could not be deleted:', e));
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
