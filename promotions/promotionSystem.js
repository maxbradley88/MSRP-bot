'use strict';

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const lucide = require('lucide-static');
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

const LOG_CHANNEL_ID = '1548592005595267072';
const BANNER = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const FOOTER = path.join(__dirname, '..', 'images', 'image.png');
const inProgress = new Set();

const command = new SlashCommandBuilder()
  .setName('promote')
  .setDescription('Promote a staff member and post a promotion announcement.')
  .addUserOption(option => option
    .setName('user')
    .setDescription('The staff member receiving the promotion')
    .setRequired(true))
  .addRoleOption(option => option
    .setName('promotion')
    .setDescription('The new role to assign to the staff member')
    .setRequired(true))
  .addStringOption(option => option
    .setName('reason')
    .setDescription('Reason for the promotion')
    .setMaxLength(1000)
    .setRequired(true))
  .addRoleOption(option => option
    .setName('previous-role')
    .setDescription('Optional: old role to remove when promoting')
    .setRequired(false));

// Prevent user-supplied text from making fake mentions/headings in the log.
function escapeText(value) {
  return String(value ?? '')
    .replace(/@/g, '@\u200b')
    .replace(/<(?=[@#!&])/g, '<\u200b')
    .replace(/[\r\n]+/g, ' ')
    .replace(/([\\*_~`|>])/g, '\\$1')
    .trim();
}

function existingEmoji(guild, names) {
  const found = guild?.emojis?.cache?.find(emoji => names.includes(emoji.name));
  return found ? `<${found.animated ? 'a' : ''}:${found.name}:${found.id}>` : '';
}

// Small custom emoji beside the heading, matching the infraction icon's style.
async function getPromotionEmoji(guild) {
  const fallback = () => existingEmoji(guild, ['msrp_event_staff', 'msrp_information_v2', 'msrp_information']);
  if (!guild?.emojis) return fallback();

  try {
    const name = 'msrp_promotion';
    let emoji = guild.emojis.cache.find(item => item.name === name);
    if (!emoji && typeof guild.emojis.fetch === 'function') {
      await guild.emojis.fetch();
      emoji = guild.emojis.cache.find(item => item.name === name);
    }
    if (!emoji) {
      const icon = lucide.BadgeCheck || lucide.Award || lucide.ArrowUpCircle;
      if (typeof icon !== 'string') throw new Error('Promotion icon not available');
      const svg = icon.replace('width="24"', 'width="128"')
        .replace('height="24"', 'height="128"')
        .replace(/currentColor/g, 'white');
      const png = await sharp(Buffer.from(svg)).resize(128, 128).png().toBuffer();
      emoji = await guild.emojis.create({
        attachment: png,
        name,
        reason: 'MSRP promotion log icon'
      });
      console.log('[PROMOTIONS] Created :msrp_promotion: custom emoji.');
    }
    return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
  } catch (error) {
    console.warn('[PROMOTIONS] Custom emoji unavailable; using a server emoji:', error.message);
    return fallback();
  }
}

function buildAnnouncement({userId, issuerId, previousRoleId, newRoleId, reason, emoji}) {
  const heading = `## ${emoji ? `${emoji} ` : ''}Promotion`;
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')
    ))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      heading,
      '',
      `**User:** <@${userId}>`,
      `**Promoted by:** <@${issuerId}>`
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      ...(previousRoleId ? [`**Previous role:** <@&${previousRoleId}>`] : []),
      `**New role:** <@&${newRoleId}>`,
      `**Reason:** ${escapeText(reason)}`
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://image.png')
    ));
}

function assertAssignable(role, guild, botMember, description) {
  if (!role || role.guild.id !== guild.id) throw new Error(`${description} is not a role in this server.`);
  if (role.id === guild.id || role.managed || role.editable === false) {
    throw new Error(`I cannot manage the ${description.toLowerCase()}. Check that it is not managed and my bot role is above it.`);
  }
  if (botMember && role.position >= botMember.roles.highest.position) {
    throw new Error(`My bot role must be above the ${description.toLowerCase()}.`);
  }
}

async function respond(interaction, content) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({content});
  return interaction.reply({content, flags:MessageFlags.Ephemeral});
}

async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'promote') return false;
  if (!interaction.guild) {
    await respond(interaction, 'You can only use this command in the server.');
    return true;
  }

  const user = interaction.options.getUser('user', true);
  const lockKey = `${interaction.guildId}:${user.id}`;
  if (inProgress.has(lockKey)) {
    await respond(interaction, 'A promotion for this member is already in progress.');
    return true;
  }
  inProgress.add(lockKey);

  try {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const member = await interaction.guild.members.fetch(user.id);
    if (!member.manageable) throw new Error('I cannot manage this member. Check my role position.');

    const newRole = interaction.options.getRole('promotion', true);
    const previousRole = interaction.options.getRole('previous-role');
    const reason = interaction.options.getString('reason', true);
    const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe();

    assertAssignable(newRole, interaction.guild, botMember, 'New role');
    if (previousRole) assertAssignable(previousRole, interaction.guild, botMember, 'Previous role');
    if (previousRole && previousRole.id === newRole.id) {
      throw new Error('The previous role and new role cannot be the same.');
    }
    if (member.roles.cache.has(newRole.id)) {
      throw new Error('This member already has the promotion role.');
    }
    if (previousRole && !member.roles.cache.has(previousRole.id)) {
      throw new Error('This member does not have the selected previous role. Choose a role they currently have or leave it blank.');
    }

    const channel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
      throw new Error('The promotion log channel cannot be found or is not text based.');
    }
    if (!fs.existsSync(BANNER) || !fs.existsSync(FOOTER)) {
      throw new Error('Promotion announcement images are missing from the images folder.');
    }

    let newRoleAdded = false;
    let previousRoleRemoved = false;
    const rollback = async () => {
      if (previousRoleRemoved) {
        await member.roles.add(previousRole.id, 'Restore old role after failed promotion').catch(err =>
          console.error('[PROMOTIONS] Could not restore previous role:', err));
      }
      if (newRoleAdded) {
        await member.roles.remove(newRole.id, 'Revert failed promotion').catch(err =>
          console.error('[PROMOTIONS] Could not revert new role:', err));
      }
    };

    let message;
    try {
      await member.roles.add(newRole.id, `Staff promotion by ${interaction.user.id}`);
      newRoleAdded = true;
      if (previousRole) {
        await member.roles.remove(previousRole.id, `Staff promotion by ${interaction.user.id}`);
        previousRoleRemoved = true;
      }
      const emoji = await getPromotionEmoji(interaction.guild);
      message = await channel.send({
        components: [buildAnnouncement({
          userId: user.id,
          issuerId: interaction.user.id,
          previousRoleId: previousRole?.id || null,
          newRoleId: newRole.id,
          reason,
          emoji
        })],
        files: [
          new AttachmentBuilder(BANNER, {name:'ticket-dashboard.png'}),
          new AttachmentBuilder(FOOTER, {name:'image.png'})
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
          users: [...new Set([user.id, interaction.user.id])],
          roles: [],
          repliedUser: false
        }
      });
    } catch (error) {
      await rollback();
      throw error;
    }

    let reactionFailed = false;
    try {
      await message.react('🎉');
    } catch (error) {
      reactionFailed = true;
      console.warn('[PROMOTIONS] Could not react with confetti:', error.message);
    }

    await respond(interaction,
      `Promoted <@${user.id}> to <@&${newRole.id}>${previousRole ? ` and removed <@&${previousRole.id}>` : ''}. ` +
      `[View announcement](${message.url})` +
      (reactionFailed ? '\nThe promotion succeeded, but I could not add 🎉. Check my Add Reactions permission.' : '')
    );
  } catch (error) {
    console.error('[PROMOTIONS] Promotion failed:', error);
    await respond(interaction, `Unable to complete promotion: ${escapeText(error.message).slice(0,300)}`).catch(() => {});
  } finally {
    inProgress.delete(lockKey);
  }
  return true;
}

module.exports = {command, handleCommand};
