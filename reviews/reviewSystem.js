'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');

// Anyone in the command channel can submit a review. Announcements go elsewhere.
const COMMAND_CHANNEL_ID = '1547545348493410355';
const REVIEW_CHANNEL_ID = '1548817361358946385';
const BANNER_PATH = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const FOOTER_PATH = path.join(__dirname, '..', 'images', 'image.png');
const activeReviews = new Set();

const RATINGS = Array.from({length: 10}, (_, i) => {
  const rating = (i + 1) / 2;
  const text = Number.isInteger(rating)
    ? `${rating} ${rating === 1 ? 'star' : 'stars'}`
    : `${Math.floor(rating) || ''}½ ${rating <= 1 ? 'star' : 'stars'}`;
  return {name: text.trim(), value: rating};
});

const command = new SlashCommandBuilder()
  .setName('review')
  .setDescription('Submit a review for a staff member.')
  .addUserOption(option => option
    .setName('user')
    .setDescription('The staff member you are reviewing')
    .setRequired(true))
  .addNumberOption(option => option
    .setName('rating')
    .setDescription('Rate the staff member from ½ to 5 stars')
    .addChoices(...RATINGS)
    .setRequired(true))
  .addStringOption(option => option
    .setName('review')
    .setDescription('Write your review')
    .setMaxLength(1500)
    .setRequired(true));

// The two icons match the other MSRP white-on-transparent server emojis.
// Half star is a full outline with its left half filled white.
const STAR_PATH = 'M64 9 L80 44 L119 49 L90 76 L98 115 L64 96 L30 115 L38 76 L9 49 L48 44 Z';
function starSvg(isHalf) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <defs><clipPath id="left"><rect x="0" y="0" width="64" height="128" /></clipPath></defs>
    <path d="${STAR_PATH}" fill="${isHalf ? 'none' : 'white'}"
      stroke="white" stroke-width="7" stroke-linejoin="round" />
    ${isHalf ? `<path d="${STAR_PATH}" fill="white" clip-path="url(#left)" />` : ''}
  </svg>`;
}

// Avoid repeated emoji creation/fetches if multiple reviews arrive together.
const iconWork = new Map();
async function ensureStarEmojis(guild) {
  if (!guild?.emojis) return {full: '★', half: '½'};
  if (iconWork.has(guild.id)) return iconWork.get(guild.id);

  const pending = (async () => {
    const specs = [
      {key: 'full', name: 'msrp_star_full', half: false},
      {key: 'half', name: 'msrp_star_half', half: true}
    ];
    let emojis = guild.emojis.cache;
    if (specs.some(s => !emojis.find(e => e.name === s.name))) {
      // A single fetch ensures we don't recreate an emoji that already exists.
      try { emojis = await guild.emojis.fetch(); }
      catch (error) { console.warn('[REVIEWS] Could not refresh server emojis:', error.message); }
    }

    const result = {};
    for (const spec of specs) {
      let emoji = emojis.find(e => e.name === spec.name) ||
        guild.emojis.cache.find(e => e.name === spec.name);
      if (!emoji) {
        try {
          const attachment = await sharp(Buffer.from(starSvg(spec.half))).png().toBuffer();
          emoji = await guild.emojis.create({
            attachment,
            name: spec.name,
            reason: 'MSRP review rating star'
          });
          console.log(`[REVIEWS] Created custom emoji :${spec.name}:`);
        } catch (error) {
          console.warn(`[REVIEWS] Could not create :${spec.name}: (${error.message}). Check Create Expressions permissions and emoji slots.`);
        }
      }
      // If creation isn't allowed, show a readable rating rather than fail a review.
      result[spec.key] = emoji
        ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`
        : (spec.half ? '½' : '★');
    }
    return result;
  })();
  iconWork.set(guild.id, pending);
  try { return await pending; }
  finally { iconWork.delete(guild.id); }
}

function ratingStars(rating, emojis) {
  const halves = Math.round(rating * 2);
  const fullStars = Math.floor(halves / 2);
  return [
    ...Array(fullStars).fill(emojis.full),
    ...(halves % 2 ? [emojis.half] : [])
  ].join(' ');
}

// Keep reviewers' text inside its quote and prevent forged pings in the log.
function safeReview(raw) {
  return String(raw || '')
    .trim()
    .replace(/@/g, '@\u200b')
    .replace(/<(?=[@#!&])/g, '<\u200b')
    .replace(/([\\*_~`|])/g, '\\$1')
    .replace(/\r\n?/g, '\n');
}
function quotedReview(value) {
  return safeReview(value).split('\n').map((line, index) =>
    `> ${index === 0 ? '**Review:** ' : ''}${line || ' '}`
  ).join('\n');
}

function buildReviewMessage({reviewerId, userId, rating, review, emojis}) {
  const announcement = `<@${reviewerId}> has created a review for <@${userId}>`;
  const details = [
    `> **Staff member:** <@${userId}>`,
    `> **Rating:** ${ratingStars(rating, emojis)}`,
    quotedReview(review)
  ].join('\n');
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')
    ))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(announcement))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(details))
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://image.png')
    ));
}

async function reply(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({content});
  }
  return interaction.reply({content, flags: MessageFlags.Ephemeral});
}

async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'review') return false;
  if (!interaction.guild) {
    await reply(interaction, 'This command can only be used inside the MSRP server.');
    return true;
  }
  if (interaction.channelId !== COMMAND_CHANNEL_ID) {
    await reply(interaction, `Please use /review in <#${COMMAND_CHANNEL_ID}>.`);
    return true;
  }

  const inProgressKey = `${interaction.guildId}:${interaction.user.id}`;
  if (activeReviews.has(inProgressKey)) {
    await reply(interaction, 'Your previous review is still being submitted.');
    return true;
  }
  activeReviews.add(inProgressKey);

  try {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    const target = interaction.options.getUser('user', true);
    const rating = interaction.options.getNumber('rating', true);
    const review = interaction.options.getString('review', true);

    // Also validate on the server; do not trust stale slash-command schemas.
    if (!Number.isFinite(rating) || rating < 0.5 || rating > 5 || Math.round(rating * 2) !== rating * 2) {
      throw new Error('Choose a rating in half-star steps between ½ and 5 stars.');
    }
    if (!review.trim()) throw new Error('Your review cannot be empty.');
    const channel = await interaction.guild.channels.fetch(REVIEW_CHANNEL_ID);
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
      throw new Error('The review announcement channel is not available.');
    }
    if (!fs.existsSync(BANNER_PATH) || !fs.existsSync(FOOTER_PATH)) {
      throw new Error('Review images are missing from the images folder.');
    }

    const emojis = await ensureStarEmojis(interaction.guild);
    const message = await channel.send({
      components: [buildReviewMessage({
        reviewerId: interaction.user.id,
        userId: target.id,
        rating,
        review,
        emojis
      })],
      files: [
        new AttachmentBuilder(BANNER_PATH, {name: 'ticket-dashboard.png'}),
        new AttachmentBuilder(FOOTER_PATH, {name: 'image.png'})
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: {
        users: [...new Set([interaction.user.id, target.id])],
        roles: [],
        repliedUser: false
      }
    });
    // Automatically react to new reviews with confetti
try {
  await message.react("🎉");
} catch (error) {
  console.error("[REVIEWS] Failed to add confetti reaction:", error);
}
    await reply(interaction, `Your review for <@${target.id}> has been submitted! [View review](${message.url})`);
  } catch (error) {
    console.error('[REVIEWS] Review submission failed:', error);
    await reply(interaction, `Unable to submit review: ${String(error.message || error).slice(0, 250)}`).catch(() => {});
  } finally {
    activeReviews.delete(inProgressKey);
  }
  return true;
}

module.exports = {command, handleCommand};
