'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  AttachmentBuilder, MessageFlags
} = require('discord.js');

const CHANNEL_ID = '1550770706181005312';
const RETIRED_ROLE_ID = '1551831120985723033';
const BANNER = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const FOOTER = path.join(__dirname, '..', 'images', 'image.png');
const busy = new Set();

const command = new SlashCommandBuilder()
  .setName('resignation-log')
  .setDescription('Log a staff resignation and update their roles.')
  .addUserOption(o => o.setName('user').setDescription('Resigning staff member').setRequired(true))
  .addRoleOption(o => o.setName('position').setDescription('Staff position to remove').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason for resignation').setMaxLength(1000).setRequired(true))
  .addStringOption(o => o.setName('message').setDescription('Resignation message').setMaxLength(1500).setRequired(true));

function clean(value) {
  return String(value ?? '').trim().replace(/@/g, '@\u200b')
    .replace(/<(?=[@#!&])/g, '<\u200b')
    .replace(/[\\*_~`|]/g, '\\$&');
}
function icon(guild) {
  const emoji = guild?.emojis?.cache?.find(e => e.name === 'msrp_applications');
  return emoji ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : '📋';
}
function messageContainer({userId, issuerId, positionId, reason, message, emoji}) {
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${emoji} | Resignation`, '',
      `**User:** <@${userId}>`,
      `**Signed:** <@${issuerId}>`
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**Reason:** ${clean(reason)}`,
      `**Message:** ${clean(message)}`
    ].join('\n\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `-# <@${userId}> has retired from their role as <@&${positionId}>. We wish them the best on their future endeavours.`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
function assertRole(role, guild, me, label) {
  if (!role || role.guild?.id !== guild.id || role.id === guild.id || role.managed) {
    throw new Error(`${label} cannot be managed.`);
  }
  if (role.position >= me.roles.highest.position) {
    throw new Error(`My highest role must be above ${label.toLowerCase()}.`);
  }
}
async function reply(interaction, content) {
  if (interaction.replied || interaction.deferred) return interaction.editReply({content});
  return interaction.reply({content, flags: MessageFlags.Ephemeral});
}
async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'resignation-log') return false;
  if (!interaction.guild) {
    await reply(interaction, 'This command can only be used in the server.');
    return true;
  }
  const target = interaction.options.getUser('user', true);
  const key = `${interaction.guildId}:${target.id}`;
  if (busy.has(key)) {
    await reply(interaction, 'A resignation for this member is already being processed.');
    return true;
  }
  busy.add(key);
  try {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    const member = await interaction.guild.members.fetch(target.id);
    const me = interaction.guild.members.me || await interaction.guild.members.fetchMe();
    const position = interaction.options.getRole('position', true);
    const retired = await interaction.guild.roles.fetch(RETIRED_ROLE_ID);
    const reason = interaction.options.getString('reason', true);
    const message = interaction.options.getString('message', true);
    if (!reason.trim() || !message.trim()) throw new Error('Reason and message cannot be empty.');
    if (position.id === RETIRED_ROLE_ID) throw new Error('The position cannot be the retired role.');
    if (!member.manageable) throw new Error('I cannot manage this member. Check my bot role hierarchy.');
    assertRole(position, interaction.guild, me, 'Position');
    assertRole(retired, interaction.guild, me, 'Retired role');
    if (!member.roles.cache.has(position.id)) throw new Error('This member does not hold the selected position.');
    const channel = await interaction.guild.channels.fetch(CHANNEL_ID);
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') throw new Error('Resignation channel is unavailable.');
    if (!fs.existsSync(BANNER) || !fs.existsSync(FOOTER)) throw new Error('Dashboard images are missing from the images folder.');

    const hadRetired = member.roles.cache.has(RETIRED_ROLE_ID);
    let addedRetired = false, removedPosition = false;
    let sent;
    try {
      if (!hadRetired) {
        await member.roles.add(RETIRED_ROLE_ID, `Resignation signed by ${interaction.user.id}`);
        addedRetired = true;
      }
      await member.roles.remove(position.id, `Resignation signed by ${interaction.user.id}`);
      removedPosition = true;
      sent = await channel.send({
        components: [messageContainer({userId: target.id, issuerId: interaction.user.id,
          positionId: position.id, reason, message, emoji: icon(interaction.guild)})],
        files: [new AttachmentBuilder(BANNER, {name:'ticket-dashboard.png'}),
          new AttachmentBuilder(FOOTER, {name:'image.png'})],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {users: [...new Set([target.id, interaction.user.id])], roles: [], repliedUser: false}
      });
    } catch (error) {
      if (removedPosition) await member.roles.add(position.id, 'Rollback after failed resignation log').catch(e => console.error('[RESIGNATIONS] Could not restore position:', e));
      if (addedRetired) await member.roles.remove(RETIRED_ROLE_ID, 'Rollback after failed resignation log').catch(e => console.error('[RESIGNATIONS] Could not remove retired role:', e));
      throw error;
    }
    await reply(interaction, `Resignation logged for <@${target.id}>. [View announcement](${sent.url})`);
  } catch (error) {
    console.error('[RESIGNATIONS] Failed:', error);
    await reply(interaction, `Unable to log resignation: ${String(error.message || error).slice(0, 300)}`).catch(() => {});
  } finally {
    busy.delete(key);
  }
  return true;
}
module.exports = {command, handleCommand};
