'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

const DASHBOARD_CHANNEL = '1547549367320313927';
const REQUESTS_CHANNEL = '1563762274399952896';
const RESULTS_DASHBOARD_CHANNEL = '1563778392019697734';
const RESULTS_LOG_CHANNEL = '1547549532617842698';
const PHASE2_GRADUATE_ROLE = '1547541336998150234';
const ANNOUNCEMENTS_CHANNEL = '1547549243844198450';
const TRAINEE_ROLE = '1547541603772534814';
const TRAINER_ROLE = '1547543294056333323';
const COOLDOWN_BYPASS_ROLE = '1556177802267590686';
const PHASES = ['1563761372272009297', '1563761439322144828'];
const COOLDOWN = 24 * 60 * 60 * 1000;
const DATA_PATH = path.join(__dirname, 'trainingRequests.json');
const BANNER = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const FOOTER = path.join(__dirname, '..', 'images', 'image.png');
const command = new SlashCommandBuilder().setName('send-request-dashboard').setDescription('Send or refresh the training request dashboard.');
const resultDashboardCommand = new SlashCommandBuilder().setName('send-result-dashboard').setDescription('Post or refresh the training results publisher.');
const hostCommand = new SlashCommandBuilder()
  .setName('host-training')
  .setDescription('Offer to host a Phase 1 or Phase 2 training session.')
  .addIntegerOption(o => o.setName('phase').setDescription('Training phase').setRequired(true)
    .addChoices({name:'Phase 1',value:1},{name:'Phase 2',value:2}))
  .addStringOption(o => o.setName('notes').setDescription('Optional information about the training').setMaxLength(900));
function safe(value) {
  return String(value ?? '').trim().replace(/@/g, '@\u200b').replace(/<(?=[@#!&])/g, '<\u200b');
}
const busy = new Set();
const RESET_VERSION = 'training-results-form-v2';
// The first run of this update releases only older unfinished claims. Never wipes
// cooldowns, completed results, or request history. A marker prevents repeat resets.
function activeClaim(r) { return Boolean(r && r.claimedBy && !r.completedAt); }
function isTrainer(interaction) {
  const roles = interaction.member?.roles;
  return Boolean(roles?.cache?.has?.(TRAINER_ROLE) ||
    (Array.isArray(roles) && roles.includes(TRAINER_ROLE)));
}

function load() {
  let data;
  try { data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') {
      console.error('[TRAINING] Could not load records:', e);
      throw new Error('Training records cannot be read. Their contents were not overwritten.');
    }
    data = {};
  }
  data.dashboardId ||= null;
  data.resultDashboardId ||= null;
  data.cooldowns ||= {};
  data.requests ||= {};
  data.pendingResetMessages ||= [];
  if (data.claimResetVersion !== RESET_VERSION) {
    const resetIds = [];
    for (const [id, record] of Object.entries(data.requests)) {
      if (!activeClaim(record)) continue;
      record.previousClaimedBy = record.claimedBy;
      record.claimedBy = null;
      record.resetAt = Date.now();
      resetIds.push(id);
    }
    data.pendingResetMessages = [...new Set([...data.pendingResetMessages, ...resetIds])];
    data.claimResetVersion = RESET_VERSION;
    save(data);
    console.log(`[TRAINING] Released ${resetIds.length} unfinished old claim(s) one time.`);
  }
  return data;
}
function save(data) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const temp = DATA_PATH + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2));
  fs.renameSync(temp, DATA_PATH);
}
function files() {
  return [new AttachmentBuilder(BANNER, { name: 'ticket-dashboard.png' }), new AttachmentBuilder(FOOTER, { name: 'image.png' })];
}
function emoji(guild, name) {
  // No emoji creation. Deleting a custom emoji simply removes it from future buttons.
  const e = guild?.emojis?.cache?.find?.(v => v.name === name && v.available !== false);
  return e ? { id: e.id, name: e.name, animated: e.animated } : null;
}
function numberEmoji(guild, phase) {
  return emoji(guild, `msrp_number_${phase}`) || emoji(guild, `msrp_${phase}`);
}
function makeButton(label, id, style, emote, disabled = false) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  if (emote) b.setEmoji(emote);
  return b;
}
function dashboard(guild) {
  const buttons = PHASES.map((_, i) => makeButton(`Phase ${i + 1}`, `msrp_training_request_${i + 1}`, ButtonStyle.Primary, numberEmoji(guild, i + 1)));
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '## Training Requests',
      'Ready for your next training? Select the phase you currently hold below.',
      '',
      '-# Only trainees can request training • One request every 24 hours'
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(buttons))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Your request will be forwarded privately to the Staff Training team.'))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
function requestMessage({ userId, phase, claimedBy, createdAt, guild }) {
  const notification = emoji(guild, 'msrp_notifications');
  const heading = notification ? `<${notification.animated ? 'a' : ''}:${notification.name}:${notification.id}> Training Request` : 'Training Request';
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${heading}`,
      `**Requested by:** <@${userId}>`,
      `**Training:** Phase ${phase} • <@&${PHASES[phase - 1]}>`,
      `**Status:** ${claimedBy ? `Claimed by <@${claimedBy}>` : 'Awaiting a trainer'}`,
      `-# Requested <t:${Math.floor((createdAt || Date.now()) / 1000)}:R>`
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(makeButton(claimedBy ? 'Claimed' : 'Claim Training', `msrp_training_claim_${phase}`, claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success, null, Boolean(claimedBy))))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
function hostMessage({ hostId, phase, notes, claimedBy, guild }) {
  const emote = emoji(guild, 'msrp_appeal');
  const title = emote ? `<${emote.animated ? 'a' : ''}:${emote.name}:${emote.id}> ` : '';
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${title}Phase ${phase} Training`,
      `**Host:** <@${hostId}>`,
      `**Trainee:** ${claimedBy ? `<@${claimedBy}>` : 'Awaiting a trainee'}`,
      `**Training:** <@&${PHASES[phase - 1]}>`,
      ...(notes ? ['', `**Notes:** ${safe(notes)}`] : [])
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      makeButton(claimedBy ? 'Claimed' : 'Claim Training', `msrp_training_host_claim_${phase}`,
        claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success, null, Boolean(claimedBy))
    ))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
async function ephemeral(interaction, content) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({ content });
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}
async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName === resultDashboardCommand.name) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (!interaction.guild) throw new Error('Server only.');
      const channel = await interaction.guild.channels.fetch(RESULTS_DASHBOARD_CHANNEL);
      if (!channel?.send) throw new Error('Results publisher channel unavailable.');
      if (!fs.existsSync(BANNER) || !fs.existsSync(FOOTER)) throw new Error('Training dashboard images are missing.');
      const data = load();
      let sent;
      if (data.resultDashboardId) {
        try { sent = await channel.messages.fetch(data.resultDashboardId); }
        catch(e) { if (e.code !== 10008) throw e; }
      }
      if (sent) {
        try { sent = await sent.edit({ components: [resultsDashboard(interaction.guild)], attachments: [], files: files() }); }
        catch(e) { if (e.code !== 10008) throw e; sent = null; }
      }
      if (!sent) sent = await channel.send({ components: [resultsDashboard(interaction.guild)], files: files(), flags: MessageFlags.IsComponentsV2 });
      data.resultDashboardId = sent.id; save(data);
      await ephemeral(interaction, `Results publisher ready: ${sent.url}`);
    } catch(e) { console.error('[TRAINING] Results dashboard:',e); await ephemeral(interaction, `Unable to send results dashboard: ${e.message}`); }
    return true;
  }
  if (interaction.commandName === hostCommand.name) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (!interaction.guild) throw new Error('This command is for the MSRP server only.');
      const trainer = await interaction.guild.members.fetch(interaction.user.id);
      if (!trainer.roles.cache.has(TRAINER_ROLE)) throw new Error('Only Staff Trainers can host training.');
      if (!fs.existsSync(BANNER) || !fs.existsSync(FOOTER)) throw new Error('Training dashboard images are missing.');
      const phase = interaction.options.getInteger('phase', true);
      const notes = interaction.options.getString('notes')?.trim() || '';
      const channel = await interaction.guild.channels.fetch(DASHBOARD_CHANNEL);
      if (!channel || typeof channel.send !== 'function') throw new Error('Training dashboard channel is unavailable.');
      const sent = await channel.send({
        components: [hostMessage({ hostId: interaction.user.id, phase, notes, claimedBy: null, guild: interaction.guild })],
        files: files(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {users:[interaction.user.id],roles:[],repliedUser:false}
      });
      const data = load();
      data.requests[sent.id] = {kind:'host', hostId:interaction.user.id, phase, notes, claimedBy:null, createdAt:Date.now()};
      save(data);
      await ephemeral(interaction, `Training posted: ${sent.url}`);
    } catch(e) {
      console.error('[TRAINING] Host:', e);
      await ephemeral(interaction, `Unable to host training: ${e.message}`).catch(() => {});
    }
    return true;
  }
  if (interaction.commandName !== command.name) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (!interaction.guild) throw new Error('This command is for the MSRP server only.');
    if (!fs.existsSync(BANNER) || !fs.existsSync(FOOTER)) throw new Error('Dashboard banner or footer is missing.');
    const channel = await interaction.guild.channels.fetch(DASHBOARD_CHANNEL);
    if (!channel || typeof channel.send !== 'function') throw new Error('Training dashboard channel is unavailable.');
    const data = load();
    let existing = null;
    if (data.dashboardId) {
      try {
        existing = await channel.messages.fetch(data.dashboardId);
      } catch (error) {
        // A deleted dashboard is fine; other Discord/API errors should be reported.
        if (error.code !== 10008) throw error;
      }
    }
    if (existing) {
      try {
        existing = await existing.edit({
          components: [dashboard(interaction.guild)],
          attachments: [],
          files: files(),
          allowedMentions: { parse: [] }
        });
      } catch (error) {
        // The dashboard can be deleted between fetching and editing it.
        if (error.code !== 10008) throw error;
        existing = null;
      }
    }
    if (!existing) {
      existing = await channel.send({
        components: [dashboard(interaction.guild)],
        files: files(),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] }
      });
    }
    // Persist just the dashboard ID; preserve requests and cooldowns.
    if (data.dashboardId !== existing.id) {
      data.dashboardId = existing.id;
      save(data);
    }
    await ephemeral(interaction, `Training request dashboard ready: ${existing.url}`);
  } catch (e) {
    console.error('[TRAINING] Dashboard:', e);
    await ephemeral(interaction, `Unable to send dashboard: ${e.message}`).catch(() => {});
  }
  return true;
}
async function handleComponent(interaction) {
  if (interaction.isModalSubmit() && interaction.customId?.startsWith('msrp_training_publish_modal_')) return publishModal(interaction);
  if (!interaction.isButton()) return false;
  const id = interaction.customId || '';
  if (id === 'msrp_training_trainees') return showTrainees(interaction);
  if (id === 'msrp_training_publish') return startPublishing(interaction);
  if (id === 'msrp_training_unclaim') return startUnclaim(interaction);
  if (id === 'msrp_training_unclaim_cancel') { await interaction.update({content:'Unclaim cancelled.',components:[]}); return true; }
  const unclaimMatch = /^msrp_training_unclaim_confirm_(\d+)$/.exec(id);
  if (unclaimMatch) return confirmUnclaim(interaction, unclaimMatch[1]);
  const requestMatch = /^msrp_training_request_([12])$/.exec(id);
  const claimMatch = /^msrp_training_claim_([12])$/.exec(id);
  const hostClaimMatch = /^msrp_training_host_claim_([12])$/.exec(id);
  if (!requestMatch && !claimMatch && !hostClaimMatch) return false;
  if (!interaction.guild) { await ephemeral(interaction, 'Server-only control.'); return true; }
  if (requestMatch) {
    const phase = Number(requestMatch[1]);
    const key = `request:${interaction.guildId}:${interaction.user.id}`;
    if (busy.has(key)) { await ephemeral(interaction, 'Your training request is being processed.'); return true; }
    busy.add(key);
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (interaction.channelId !== DASHBOARD_CHANNEL) throw new Error('Training requests must be made using the request dashboard.');
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.has(TRAINEE_ROLE)) throw new Error('You must have the trainee role to request training.');
      const current = PHASES.findIndex(role => member.roles.cache.has(role)) + 1;
      if (!current) throw new Error('You must have a training phase role to request training.');
      if (current !== phase) throw new Error(`You must complete your Phase ${current} first. Please select Phase ${current}.`);
      const data = load();
      const last = Number(data.cooldowns[interaction.user.id] || 0);
      const remaining = last + COOLDOWN - Date.now();
      if (!member.roles.cache.has(COOLDOWN_BYPASS_ROLE) && remaining > 0) throw new Error(`You can request training again <t:${Math.ceil((last + COOLDOWN) / 1000)}:R>.`);
      const channel = await interaction.guild.channels.fetch(REQUESTS_CHANNEL);
      if (!channel || typeof channel.send !== 'function') throw new Error('Training requests channel is unavailable.');
      const createdAt = Date.now();
      const sent = await channel.send({ content: `<@&${TRAINER_ROLE}>`, components: [requestMessage({ userId: interaction.user.id, phase, claimedBy: null, createdAt, guild: interaction.guild })], files: files(), flags: MessageFlags.IsComponentsV2, allowedMentions: { users: [], roles: [TRAINER_ROLE], repliedUser: false } });
      data.cooldowns[interaction.user.id] = Date.now();
      data.requests[sent.id] = { userId: interaction.user.id, phase, claimedBy: null, createdAt };
      save(data);
      await ephemeral(interaction, 'Training requested.');
    } catch (e) {
      console.error('[TRAINING] Request:', e);
      await ephemeral(interaction, e.message).catch(() => {});
    } finally { busy.delete(key); }
    return true;
  }
  const phase = Number((claimMatch || hostClaimMatch)[1]);
  const key = `claim:${interaction.message.id}`;
  const trainerGuard = `trainer:${hostClaimMatch ? (load().requests[interaction.message.id]?.hostId || '') : interaction.user.id}`;
  if (busy.has(trainerGuard)) { await ephemeral(interaction, 'This trainer already has a claim being processed.'); return true; }
  if (busy.has(key)) { await ephemeral(interaction, 'Someone is already claiming this training.'); return true; }
  busy.add(key);
  busy.add(trainerGuard);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (hostClaimMatch) {
      if (interaction.channelId !== DASHBOARD_CHANNEL) throw new Error('This is not the training dashboard channel.');
      if (!member.roles.cache.has(TRAINEE_ROLE) || !member.roles.cache.has(PHASES[phase - 1])) throw new Error(`You need the trainee and Phase ${phase} roles to claim this session.`);
    } else {
      if (interaction.channelId !== REQUESTS_CHANNEL) throw new Error('This is not the training requests channel.');
      if (!member.roles.cache.has(TRAINER_ROLE)) throw new Error('Only Staff Trainers can claim training requests.');
    }
    const data = load();
    const request = data.requests[interaction.message.id];
    if (!request || request.phase !== phase || Boolean(request.kind === 'host') !== Boolean(hostClaimMatch)) throw new Error('This request is not in the training records.');
    if (request.completedAt) throw new Error('This training is already completed.');
    if (request.claimedBy) throw new Error(`This training is already claimed by <@${request.claimedBy}>.`);
    const trainerId = hostClaimMatch ? request.hostId : interaction.user.id;
    if (Object.values(data.requests).some(r => r.claimedBy && !r.completedAt && (r.kind === 'host' ? r.hostId : r.claimedBy) === trainerId)) throw new Error('This trainer already has an active training. Publish the results before claiming another.');
    await interaction.message.edit({
      components: [hostClaimMatch
        ? hostMessage({ ...request, claimedBy: interaction.user.id, guild: interaction.guild })
        : requestMessage({ ...request, claimedBy: interaction.user.id, guild: interaction.guild })],
      attachments: [],
      files: files(),
      allowedMentions: {parse:[]}
    });
    request.claimedBy = interaction.user.id;
    save(data);
    await ephemeral(interaction, 'You have claimed this training.');
  } catch (e) {
    console.error('[TRAINING] Claim:', e);
    await ephemeral(interaction, e.message).catch(() => {});
  } finally { busy.delete(key); busy.delete(trainerGuard); }
  return true;
}

function resultsDashboard(guild) {
  const people = emoji(guild, 'msrp_event_people');
  const appeal = emoji(guild, 'msrp_appeal');
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      '## Training Results Publisher',
      'Manage your training records, view trainee phases, or publish your completed session.',
      '',
      '-# A trainer may have one active training at a time.'
    ].join('\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      makeButton('Trainees','msrp_training_trainees',ButtonStyle.Secondary,people),
      makeButton('Publish Results','msrp_training_publish',ButtonStyle.Success,appeal),
      makeButton('Unclaim Training','msrp_training_unclaim',ButtonStyle.Secondary,null)
    ))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
function currentClaim(data, trainerId) {
  return Object.entries(data.requests).find(([,r]) => activeClaim(r) && (r.kind === 'host' ? r.hostId : r.claimedBy) === trainerId);
}
async function showTrainees(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (!interaction.guild) throw new Error('Server only.');
    const members = await interaction.guild.members.fetch();
    const lines = PHASES.map((role, i) => {
      const matches = [...members.values()].filter(m => m.roles.cache.has(TRAINEE_ROLE) && m.roles.cache.has(role));
      return `**Phase ${i+1} (${matches.length})**\n${matches.length ? matches.map(m => `<@${m.id}>`).join(', ') : 'No trainees currently in this phase.'}`;
    });
    const output = lines.join('\n\n');
    if (output.length <= 1900) {
      await interaction.editReply({ content: output, allowedMentions: { parse: [] } });
    } else {
      // Do not truncate a member mention; send complete paginated ephemeral chunks.
      const chunks = [];
      for (const block of lines) {
        if (block.length <= 1800) { chunks.push(block); continue; }
        const items = block.split(', '), pages = [];
        let page = '';
        for (const item of items) {
          if (page.length + item.length > 1750 && page) { pages.push(page); page = ''; }
          page += (page ? ', ' : '') + item;
        }
        if (page) pages.push(page);
        chunks.push(...pages);
      }
      await interaction.editReply({ content: chunks.shift().slice(0, 1900), allowedMentions: { parse: [] } });
      for (const chunk of chunks.slice(0, 7)) await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral, allowedMentions: {parse:[]} });
    }
  } catch (e) { await interaction.editReply({ content:`Could not list trainees: ${e.message}` }); }
  return true;
}
async function startPublishing(interaction) {
  if (!interaction.guild) { await ephemeral(interaction, 'Server only.'); return true; }
  if (!isTrainer(interaction)) { await ephemeral(interaction, 'Only Staff Trainers can publish results.'); return true; }
  const claim = currentClaim(load(), interaction.user.id);
  if (!claim) { await ephemeral(interaction, 'You have no active claimed training. Use Unclaim Training to manage an active claim.'); return true; }
  const [messageId, record] = claim;
  const traineeId = record.kind === 'host' ? record.claimedBy : record.userId;
  const modal = new ModalBuilder()
    .setCustomId(`msrp_training_publish_modal_${messageId}`)
    .setTitle('Publish Training Results')
    .addLabelComponents(
      new LabelBuilder().setLabel('Training type')
        .setDescription(`Your assigned trainee: Phase ${record.phase}`)
        .setStringSelectMenuComponent(new StringSelectMenuBuilder()
          .setCustomId('training_phase').setPlaceholder('Select the training phase')
          .addOptions([{label:'Phase 1',value:'1',default:record.phase===1}, {label:'Phase 2',value:'2',default:record.phase===2}])),
      new LabelBuilder().setLabel('Result')
        .setStringSelectMenuComponent(new StringSelectMenuBuilder()
          .setCustomId('training_outcome').setPlaceholder('Choose the result')
          .addOptions([{label:'Pass',value:'pass'}, {label:'Fail',value:'fail'}, {label:'Other',value:'other'}])),
      new LabelBuilder().setLabel('Notes')
        .setDescription(`Feedback for the assigned trainee (${traineeId}).`)
        .setTextInputComponent(new TextInputBuilder()
          .setCustomId('training_notes').setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Write your assessment and feedback...')
          .setRequired(true).setMaxLength(1500))
    );
  await interaction.showModal(modal);
  return true;
}
async function startUnclaim(interaction) {
  if (!interaction.guild) { await ephemeral(interaction, 'Server only.'); return true; }
  if (!isTrainer(interaction)) { await ephemeral(interaction,'Only Staff Trainers can unclaim a training.'); return true; }
  const claim = currentClaim(load(), interaction.user.id);
  if (!claim) { await ephemeral(interaction, 'You have no active training to unclaim.'); return true; }
  const [messageId, record] = claim;
  const traineeId = record.kind === 'host' ? record.claimedBy : record.userId;
  const row = new ActionRowBuilder().addComponents(
    makeButton('Yes, Unclaim Training',`msrp_training_unclaim_confirm_${messageId}`, ButtonStyle.Danger),
    makeButton('Cancel',`msrp_training_unclaim_cancel`, ButtonStyle.Secondary)
  );
  await interaction.reply({
    content: `**Unclaim your Phase ${record.phase} training with <@${traineeId}>?**\nThe training will reopen for claiming. This will not publish results or change roles.`,
    components: [row], flags: MessageFlags.Ephemeral, allowedMentions: {parse:[]}
  });
  return true;
}
async function confirmUnclaim(interaction, messageId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guard = `result:${messageId}`;
  if (busy.has(guard)) { await interaction.editReply('This training is currently being updated.'); return true; }
  busy.add(guard);
  try {
    if (!isTrainer(interaction)) throw new Error('Only Staff Trainers can unclaim a training.');
    const data = load(), claim = currentClaim(data, interaction.user.id);
    if (!claim || claim[0] !== messageId) throw new Error('This is no longer your active claim.');
    const record = data.requests[messageId];
    if (!record || record.completedAt) throw new Error('Results have already been published.');
    const channelId = record.kind === 'host' ? DASHBOARD_CHANNEL : REQUESTS_CHANNEL;
    const channel = await interaction.guild.channels.fetch(channelId);
    if (!channel?.messages?.fetch) throw new Error('Could not access the original training message.');
    let reopened = false;
    try {
      const original = await channel.messages.fetch(messageId);
      await original.edit({
        components: [record.kind === 'host'
          ? hostMessage({...record, claimedBy:null, guild:interaction.guild})
          : requestMessage({...record, claimedBy:null, guild:interaction.guild})],
        files: files(), attachments: [], allowedMentions: {parse:[]}
      });
      reopened = true;
    } catch (error) {
      if (error.code !== 10008) throw error; // deleted message: still release trainer
    }
    record.previousClaimedBy = record.claimedBy;
    record.claimedBy = null;
    record.unclaimedAt = Date.now();
    save(data);
    await interaction.editReply(reopened
      ? 'Training unclaimed. The request is available for claiming again.'
      : 'Training released. Its original message has been deleted, so no claim button was reopened.');
  } catch (e) {
    console.error('[TRAINING] Unclaim:', e);
    await interaction.editReply(`Unable to unclaim: ${e.message}`).catch(()=>{});
  } finally { busy.delete(guard); }
  return true;
}
async function publishModal(interaction) {
  const match = /^msrp_training_publish_modal_(\d+)$/.exec(interaction.customId);
  if (!match) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const messageId = match[1];
  const guard = `result:${messageId}`;
  if (busy.has(guard)) { await interaction.editReply('This result is already being processed.'); return true; }
  busy.add(guard);
  let added = false, removed = [], member, addId, result, notes;
  try {
    if (!interaction.guild || !isTrainer(interaction)) throw new Error('Only Staff Trainers can submit training results.');
    const data = load(), record = data.requests[messageId], claim = currentClaim(data, interaction.user.id);
    if (!record || !claim || claim[0] !== messageId || record.completedAt) throw new Error('Your active training changed. Open Publish Results again.');
    const phase = Number(interaction.fields.getStringSelectValues('training_phase')[0]);
    result = interaction.fields.getStringSelectValues('training_outcome')[0];
    notes = interaction.fields.getTextInputValue('training_notes').trim();
    if (![1,2].includes(phase) || !['pass','fail','other'].includes(result)) throw new Error('Choose a valid phase and result.');
    if (phase !== record.phase) throw new Error(`Your claimed session is Phase ${record.phase}. Please select that phase.`);
    if (!notes) throw new Error('Please enter training notes.');
    const traineeId = record.kind === 'host' ? record.claimedBy : record.userId;
    if (!traineeId) throw new Error('No trainee is assigned to this session.');
    member = await interaction.guild.members.fetch(traineeId);
    const resultsChannel = await interaction.guild.channels.fetch(RESULTS_LOG_CHANNEL);
    if (!resultsChannel?.send) throw new Error('Results channel unavailable.');
    if (!fs.existsSync(FOOTER)) throw new Error('Training footer image is missing.');
    addId = phase === 1 ? PHASES[1] : PHASE2_GRADUATE_ROLE;
    const removeIds = phase === 1 ? [PHASES[0]] : [PHASES[1], TRAINEE_ROLE];
    if (result === 'pass') {
      const bot = interaction.guild.members.me || await interaction.guild.members.fetchMe();
      if (!member.manageable) throw new Error('The bot cannot manage this trainee.');
      for (const roleId of [addId, ...removeIds]) {
        const role = await interaction.guild.roles.fetch(roleId);
        if (!role || role.managed || role.position >= bot.roles.highest.position) throw new Error(`The bot cannot manage role ${roleId}. Check role hierarchy.`);
      }
      try {
        if (!member.roles.cache.has(addId)) { await member.roles.add(addId, 'Passed training'); added = true; }
        for (const roleId of removeIds) {
          if (member.roles.cache.has(roleId)) { await member.roles.remove(roleId,'Passed training'); removed.push(roleId); }
        }
      } catch (e) {
        for (const id of removed) await member.roles.add(id,'Training result rollback').catch(err => console.error('[TRAINING] Rollback add:',err));
        if (added) await member.roles.remove(addId,'Training result rollback').catch(err => console.error('[TRAINING] Rollback remove:',err));
        throw e;
      }
    }
    const notification = emoji(interaction.guild,'msrp_appeal');
    const head = notification ? `<${notification.animated?'a':''}:${notification.name}:${notification.id}> ` : '';
    const headline = [
      `## ${head}Phase ${phase} Results`,
      `**Trainee:** <@${traineeId}>`,
      `**Trainer:** <@${interaction.user.id}>`
    ].join('\n');
    const details = [
      `**Results:** ${result === 'pass' ? 'Pass' : result === 'fail' ? 'Fail' : 'Other'}`,
      `**Notes:** ${safe(notes)}`,
      ...(result === 'pass' ? ['', `**Role added:** <@&${addId}>`, `**Roles removed:** ${removed.length ? removed.map(x => `<@&${x}>`).join(', ') : 'None'}`] : [])
    ].join('\n');
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(headline))
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(details))
      .addSeparatorComponents(new SeparatorBuilder())
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
    let sent;
    try {
      sent = await resultsChannel.send({
        components:[container], files:[new AttachmentBuilder(FOOTER,{name:'image.png'})],
        flags:MessageFlags.IsComponentsV2,
        allowedMentions:{users:[traineeId, interaction.user.id],roles:[],repliedUser:false}
      });
    } catch(e) {
      for(const id of removed) await member.roles.add(id,'Training result rollback').catch(err => console.error('[TRAINING] Rollback add:',err));
      if(added) await member.roles.remove(addId,'Training result rollback').catch(err => console.error('[TRAINING] Rollback remove:',err));
      throw e;
    }
    record.completedAt = Date.now();
    record.result = result;
    record.notes = notes;
    record.resultMessageId = sent.id;
    save(data);
    await interaction.editReply(`Results published for <@${traineeId}>: ${sent.url}\nYour training claim has been released.`);
  } catch (e) {
    console.error('[TRAINING] Publish results:',e);
    await interaction.editReply(`Unable to publish results: ${e.message}`).catch(()=>{});
  } finally { busy.delete(guard); }
  return true;
}

async function synchronizeLegacyResets(client) {
  const data = load();
  for (const messageId of [...data.pendingResetMessages]) {
    const currentData = load();
    const record = currentData.requests[messageId];
    if (!record || record.claimedBy || record.completedAt) {
      currentData.pendingResetMessages = currentData.pendingResetMessages.filter(id=>id!==messageId);
      save(currentData);
      continue;
    }
    try {
      const guildId = process.env.DISCORD_GUILD_ID || client.guilds.cache.first()?.id;
      if (!guildId) throw new Error('Cannot locate the MSRP guild for claim reset.');
      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(record.kind === 'host' ? DASHBOARD_CHANNEL : REQUESTS_CHANNEL);
      const original = await channel.messages.fetch(messageId);
      await original.edit({
        components: [record.kind === 'host'
          ? hostMessage({...record, claimedBy:null, guild})
          : requestMessage({...record, claimedBy:null, guild})],
        attachments:[], files:files(), allowedMentions:{parse:[]}
      });
      currentData.pendingResetMessages = currentData.pendingResetMessages.filter(id=>id!==messageId);
      save(currentData);
    } catch (error) {
      if (error.code === 10008) {
        currentData.pendingResetMessages = currentData.pendingResetMessages.filter(id=>id!==messageId);
        save(currentData);
      } else console.error('[TRAINING] Cannot refresh reset message',messageId,error);
    }
  }
}
function registerAnnouncements(client) {
  client.once('ready',()=> { void synchronizeLegacyResets(client).catch(e=>console.error('[TRAINING] Reset sync:',e)); });
  client.on('messageCreate', async message => {
    if (!message.guild || message.author?.bot || message.webhookId || message.channelId !== ANNOUNCEMENTS_CHANNEL) return;
    try {
      const me = message.guild.members.me || await message.guild.members.fetchMe();
      const perms = message.channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.ManageMessages)) return;
      const payload = { allowedMentions: { parse: ['users', 'roles', 'everyone'], repliedUser: false } };
      if (message.content) payload.content = message.content;
      if (message.attachments.size) payload.files = [...message.attachments.values()].map(a => ({ attachment: a.url, name: a.name, description: a.description || undefined }));
      if (message.stickers?.size) payload.stickers = [...message.stickers.values()].map(s => s.id);
      if (!payload.content && !payload.files && !payload.stickers) return;
      await message.channel.send(payload);
      await message.delete().catch(e => console.error('[TRAINING] Original announcement was not deleted:', e));
    } catch (e) { console.error('[TRAINING] Announcement relay failed:', e); }
  });
}
module.exports = { command, hostCommand, resultDashboardCommand, handleCommand, handleComponent, registerAnnouncements };
