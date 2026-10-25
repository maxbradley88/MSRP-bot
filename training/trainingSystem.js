'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

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

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    return { dashboardId: data.dashboardId || null, cooldowns: data.cooldowns || {}, requests: data.requests || {}, resultDashboardId: data.resultDashboardId || null };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[TRAINING] Failed to load saved requests:', e);
    return { dashboardId: null, cooldowns: {}, requests: {}, resultDashboardId: null };
  }
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
  const buttons = PHASES.map((_, i) => makeButton(`Request Phase ${i + 1}`, `msrp_training_request_${i + 1}`, ButtonStyle.Secondary, numberEmoji(guild, i + 1)));
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Training Requests\nSelect your current phase to request a training session.\n-# Trainees may submit one request every 24 hours.'))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(buttons))
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
function requestMessage({ userId, phase, claimedBy, createdAt, guild }) {
  const notification = emoji(guild, 'msrp_notifications');
  const heading = notification ? `<${notification.animated ? 'a' : ''}:${notification.name}:${notification.id}> Training Request` : 'Training Request';
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${heading}\n\n**Trainee:** <@${userId}>\n**Phase:** <@&${PHASES[phase - 1]}>\n**Status:** ${claimedBy ? `Claimed by <@${claimedBy}>` : 'Awaiting a trainer'}\n-# Requested <t:${Math.floor((createdAt || Date.now()) / 1000)}:R>`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(makeButton(claimedBy ? 'Claimed' : 'Claim', `msrp_training_claim_${phase}`, claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success, null, Boolean(claimedBy))))
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
function hostMessage({ hostId, phase, notes, claimedBy, guild }) {
  const emote = emoji(guild, 'msrp_appeal');
  const title = emote ? `<${emote.animated ? 'a' : ''}:${emote.name}:${emote.id}>` : '';
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title ? title + ' ' : ''}Phase ${phase} Training`))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `**Host:** <@${hostId}>`,
      `**Claimed:** ${claimedBy ? `<@${claimedBy}>` : 'Unclaimed'}`,
      `**Phase:** <@&${PHASES[phase - 1]}>`,
      ...(notes ? [`**Notes:** ${safe(notes)}`] : [])
    ].join('\n\n')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      makeButton(claimedBy ? 'Claimed' : 'Claim Training', `msrp_training_host_claim_${phase}`,
        claimedBy ? ButtonStyle.Secondary : ButtonStyle.Success, null, Boolean(claimedBy))
    ))
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://image.png')));
  return container;
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
      const data = load();
      let sent;
      if (data.resultDashboardId) {
        try { sent = await channel.messages.fetch(data.resultDashboardId); }
        catch(e) { if (e.code !== 10008) throw e; }
      }
      if (sent) {
        try { sent = await sent.edit({ components: [resultsDashboard(interaction.guild)], attachments: [], files: [new AttachmentBuilder(FOOTER, {name:'image.png'})] }); }
        catch(e) { if (e.code !== 10008) throw e; sent = null; }
      }
      if (!sent) sent = await channel.send({ components: [resultsDashboard(interaction.guild)], files: [new AttachmentBuilder(FOOTER, {name:'image.png'})], flags: MessageFlags.IsComponentsV2 });
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
      if (!fs.existsSync(FOOTER)) throw new Error('Training footer image is missing.');
      const phase = interaction.options.getInteger('phase', true);
      const notes = interaction.options.getString('notes')?.trim() || '';
      const channel = await interaction.guild.channels.fetch(DASHBOARD_CHANNEL);
      if (!channel || typeof channel.send !== 'function') throw new Error('Training dashboard channel is unavailable.');
      const sent = await channel.send({
        components: [hostMessage({ hostId: interaction.user.id, phase, notes, claimedBy: null, guild: interaction.guild })],
        files: [new AttachmentBuilder(FOOTER, {name:'image.png'})],
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
  if (interaction.isModalSubmit() && interaction.customId?.startsWith('msrp_training_result_notes_')) return handleNotesModal(interaction);
  if (interaction.isStringSelectMenu() && interaction.customId?.startsWith('msrp_training_result_')) return handleResultSelection(interaction);
  if (!interaction.isButton()) return false;
  const id = interaction.customId || '';
  if (id === 'msrp_training_trainees') return showTrainees(interaction);
  if (id === 'msrp_training_publish') return startPublishing(interaction);
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
    if (request.claimedBy) throw new Error(`This training is already claimed by <@${request.claimedBy}>.`);
    const trainerId = hostClaimMatch ? request.hostId : interaction.user.id;
    if (Object.values(data.requests).some(r => r.claimedBy && !r.completedAt && (r.kind === 'host' ? r.hostId : r.claimedBy) === trainerId)) throw new Error('This trainer already has an active training. Publish the results before claiming another.');
    await interaction.message.edit({
      components: [hostClaimMatch
        ? hostMessage({ ...request, claimedBy: interaction.user.id, guild: interaction.guild })
        : requestMessage({ ...request, claimedBy: interaction.user.id, guild: interaction.guild })],
      attachments: [],
      files: hostClaimMatch ? [new AttachmentBuilder(FOOTER, {name:'image.png'})] : files(),
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
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('## Training Results Publisher\nView current trainees or publish the outcome of your claimed session.'))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      makeButton('Trainees','msrp_training_trainees',ButtonStyle.Secondary,people),
      makeButton('Publish Results','msrp_training_publish',ButtonStyle.Primary,appeal)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
function currentClaim(data, trainerId) {
  return Object.entries(data.requests).find(([,r]) => r.claimedBy && !r.completedAt && (r.kind === 'host' ? r.hostId : r.claimedBy) === trainerId);
}
async function showTrainees(interaction) {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try {
    const members = await interaction.guild.members.fetch();
    const out = PHASES.map((role,i) => {
      const matches = [...members.values()].filter(m => m.roles.cache.has(TRAINEE_ROLE) && m.roles.cache.has(role));
      const list = matches.length ? matches.map(m => `<@${m.id}>`).join(', ') : 'None';
      return `**Phase ${i+1}** (${matches.length})\n${list}`;
    }).join('\n\n');
    await interaction.editReply({content:out.slice(0,1900),allowedMentions:{parse:[]}});
  } catch(e) { await interaction.editReply({content:`Could not list trainees: ${e.message}`}); }
  return true;
}
async function startPublishing(interaction) {
  if (!interaction.guild) { await ephemeral(interaction,'Server only.'); return true; }
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!member.roles.cache.has(TRAINER_ROLE)) { await ephemeral(interaction,'Only Staff Trainers may publish results.'); return true; }
  const claim = currentClaim(load(), interaction.user.id);
  if (!claim) { await ephemeral(interaction,'You have no active claimed training.'); return true; }
  const [messageId,r] = claim;
  const traineeId = r.kind === 'host' ? r.claimedBy : r.userId;
  const select = new StringSelectMenuBuilder().setCustomId(`msrp_training_result_phase_${messageId}`)
    .setPlaceholder('Training type').addOptions([{label:'Phase 1',value:'1'},{label:'Phase 2',value:'2'}]);
  await interaction.reply({content:`Publishing a result for <@${traineeId}>. Select the phase:`, components:[new ActionRowBuilder().addComponents(select)],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  return true;
}
async function handleResultSelection(interaction) {
  const id=interaction.customId;
  const match=/^msrp_training_result_(phase|outcome)_([0-9]+)(?:_([12]))?$/.exec(id);
  if (!match) return false;
  const [,step,messageId,phaseParam]=match;
  const claim=currentClaim(load(),interaction.user.id);
  if (!claim || claim[0] !== messageId) { await ephemeral(interaction,'This training is no longer assigned to you.'); return true; }
  if (step === 'phase') {
    const phase=Number(interaction.values[0]);
    if (phase !== claim[1].phase) { await ephemeral(interaction,`Your claimed session is Phase ${claim[1].phase}. Select that phase.`); return true; }
    const select=new StringSelectMenuBuilder().setCustomId(`msrp_training_result_outcome_${messageId}_${phase}`)
      .setPlaceholder('Result').addOptions([{label:'Pass',value:'pass'},{label:'Fail',value:'fail'},{label:'Other',value:'other'}]);
    await interaction.update({content:`Phase ${phase} selected. Choose the result:`,components:[new ActionRowBuilder().addComponents(select)],allowedMentions:{parse:[]}});
    return true;
  }
  const result=interaction.values[0];
  const modal=new ModalBuilder().setCustomId(`msrp_training_result_notes_${messageId}_${phaseParam}_${result}`).setTitle('Publish Training Result');
  const notes=new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setMaxLength(1500).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(notes));
  await interaction.showModal(modal);
  return true;
}
async function handleNotesModal(interaction) {
  const match=/^msrp_training_result_notes_([0-9]+)_([12])_(pass|fail|other)$/.exec(interaction.customId);
  if (!match) return false;
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const [,messageId,phaseString,result]=match;
  const guard=`result:${messageId}`;
  if (busy.has(guard)) { await interaction.editReply('This result is already being processed.'); return true; }
  busy.add(guard);
  try {
    const data=load();
    const record=data.requests[messageId];
    const claim=currentClaim(data,interaction.user.id);
    if (!claim || claim[0] !== messageId || !record || record.phase!==Number(phaseString)) throw new Error('This training is no longer your active claimed session.');
    const traineeId=record.kind==='host'?record.claimedBy:record.userId;
    const member=await interaction.guild.members.fetch(traineeId);
    const notes=interaction.fields.getTextInputValue('notes').trim();
    if (!notes) throw new Error('Please enter notes.');
    const addId=record.phase===1?PHASES[1]:PHASE2_GRADUATE_ROLE;
    const removeIds=record.phase===1?[PHASES[0]]:[PHASES[1],TRAINEE_ROLE];
    let added=false; const removed=[];
    const resultsChannel=await interaction.guild.channels.fetch(RESULTS_LOG_CHANNEL);
    if (!resultsChannel?.send) throw new Error('Results log channel unavailable.');
    if (result==='pass') {
      const bot=interaction.guild.members.me || await interaction.guild.members.fetchMe();
      if (!member.manageable) throw new Error('I cannot manage the trainee roles.');
      const roles=[addId,...removeIds];
      for (const id of roles) {
        const role=await interaction.guild.roles.fetch(id);
        if (!role || role.position>=bot.roles.highest.position || role.managed) throw new Error('My role hierarchy prevents this result.');
      }
      try {
        if (!member.roles.cache.has(addId)) { await member.roles.add(addId,'Passed training'); added=true; }
        for (const id of removeIds) if(member.roles.cache.has(id)) {await member.roles.remove(id,'Passed training');removed.push(id);}
      } catch(e) {
        for(const id of removed) await member.roles.add(id,'Training result rollback').catch(()=>{});
        if(added) await member.roles.remove(addId,'Training result rollback').catch(()=>{});
        throw e;
      }
    }
    const lines=[`## Phase ${record.phase} Results!`,'',`**User:** <@${traineeId}>`,`**Trainer:** <@${interaction.user.id}>`,'',`**Results:** ${result.toUpperCase()}`,`**Notes:** ${safe(notes)}`];
    if(result==='pass') {lines.push('',`**Roles added:** <@&${addId}>`,`**Roles removed:** ${removed.length?removed.map(r=>`<@&${r}>`).join(', '):'None'}`);}
    const container=new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
      .addSeparatorComponents(new SeparatorBuilder())
      .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
    let sent;
    try {
      sent=await resultsChannel.send({components:[container],files:[new AttachmentBuilder(FOOTER,{name:'image.png'})],flags:MessageFlags.IsComponentsV2,allowedMentions:{users:[traineeId,interaction.user.id],roles:[],repliedUser:false}});
    } catch(e) {
      for(const id of removed) await member.roles.add(id,'Training result rollback').catch(()=>{});
      if(added) await member.roles.remove(addId,'Training result rollback').catch(()=>{});
      throw e;
    }
    record.completedAt=Date.now();record.result=result;record.resultMessageId=sent.id;record.notes=notes;
    save(data);
    await interaction.editReply(`Results published for <@${traineeId}>: ${sent.url}. Your training claim is now released.`);
  } catch(e) {console.error('[TRAINING] Publish results:',e);await interaction.editReply(`Unable to publish results: ${e.message}`).catch(()=>{});}
  finally {busy.delete(guard);}
  return true;
}

function registerAnnouncements(client) {
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
