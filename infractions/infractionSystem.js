'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, ThumbnailBuilder, AttachmentBuilder, MessageFlags
} = require('discord.js');

const LOG_CHANNEL_ID = '1548592083441418371';
const LEVEL_ROLES = [
  '1547732792429908028', '1547733091798352062', '1547733176775090248',
  '1547733526739292282', '1547733618867048458', '1547733693907345448'
];
const LEVEL_LABELS = ['Warning 1', 'Warning 2', 'Warning 3', 'Strike 1', 'Strike 2', 'Strike 3'];
const DATA_FILE = path.join(__dirname, 'infractions.json');
const BANNER = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const sharp = require('sharp');
const lucide = require('lucide-static');
const FOOTER = path.join(__dirname, '..', 'images', 'image.png');
let db = {records: {}, users: {}};
try {
  if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (!db?.records || !db?.users) throw new Error('Invalid infraction data');
} catch (err) {
  // Never overwrite damaged data silently.
  console.error('[INFRACTIONS] Could not read data file:', err);
  db = null;
}
const activeLocks = new Set();
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
const infractCommand = new SlashCommandBuilder()
  .setName('infract').setDescription('Issue and record a staff infraction.')
  .addUserOption(o => o.setName('user').setDescription('Staff member to infract').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Why this infraction is being issued').setRequired(true).setMaxLength(1000))
  .addStringOption(o => o.setName('type').setDescription('Type of infraction').setRequired(true)
    .addChoices({name:'Warning',value:'warning'}, {name:'Demotion',value:'demotion'},
      {name:'Termination',value:'termination'}, {name:'Other',value:'other'}))
  .addStringOption(o => o.setName('evidence').setDescription('Optional evidence (link or text)').setMaxLength(1000))
  .addStringOption(o => o.setName('notes').setDescription('Optional private notes shown in the log').setMaxLength(1000))
  .addStringOption(o => o.setName('custom-infraction').setDescription('Optional level: assigns all missing levels through it')
    .addChoices(...LEVEL_LABELS.map((name, i) => ({name,value:String(i)}))));
const revokeCommand = new SlashCommandBuilder()
  .setName('revoke-infraction').setDescription('Revoke an existing staff infraction.')
  .addUserOption(o => o.setName('user').setDescription('Staff member').setRequired(true))
  .addStringOption(o => o.setName('punishment-revoked').setDescription('Choose an active infraction by its reason').setRequired(true).setAutocomplete(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason for revoking this infraction').setRequired(true).setMaxLength(1000));

function safe(s) {
  return String(s ?? '').replace(/@/g, '@\u200b').replace(/<(?=[@#!&])/g, '<\u200b').replace(/[\r\n]+/g, ' ').trim();
}
// Use small native Discord custom emoji codes, not thumbnails or additional images.
// If the specific icon cannot be created (e.g. permissions or emoji limit),
// fall back to another existing server icon instead of failing the infraction.
function existingEmoji(guild, names) {
  const emoji = guild?.emojis?.cache?.find(x => names.includes(x.name));
  return emoji ? `<:${emoji.name}:${emoji.id}>` : '';
}
async function getInfractionEmoji(guild) {
  const fallback = () => existingEmoji(guild, ['msrp_ticket_rules', 'msrp_information_v2', 'msrp_information']);
  if (!guild?.emojis) return fallback();
  try {
    const name = 'msrp_infraction';
    let emoji = guild.emojis.cache.find(x => x.name === name);
    if (!emoji && typeof guild.emojis.fetch === 'function') {
      await guild.emojis.fetch();
      emoji = guild.emojis.cache.find(x => x.name === name);
    }
    if (!emoji) {
      const vector = lucide.ShieldAlert || lucide.ClipboardList;
      if (!vector || typeof vector !== 'string') throw new Error('Lucide icon is missing');
      const svg = vector.replace('width="24"', 'width="128"').replace('height="24"', 'height="128"').replace(/currentColor/g, 'white');
      const png = await sharp(Buffer.from(svg)).resize(128, 128).png().toBuffer();
      emoji = await guild.emojis.create({attachment:png, name, reason:'MSRP infraction heading icon'});
      console.log('[INFRACTIONS] Created custom emoji :msrp_infraction:');
    }
    return `<:${emoji.name}:${emoji.id}>`;
  } catch (err) {
    console.warn('[INFRACTIONS] Custom infraction emoji unavailable, using existing icon:', err.message);
    return fallback();
  }
}
function titleWithEmoji(emoji, text) { return `## ${emoji ? emoji + ' ' : ''}${text}`; }
// Keep the title as the only heading. Member names sit directly underneath it,
// and one divider separates the identity block from the infraction details.
function containerFor(record, {addedRoles = [], isRevocation = false, actorId, revokeReason = '', infractionEmoji = ''}) {
  const c = new ContainerBuilder();
  if (!isRevocation) {
    c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        titleWithEmoji(infractionEmoji, 'Infraction'),
        '',
        `**User:** <@${record.userId}>`,
        `**Issuer:** <@${actorId}>`
      ].join('\n')))
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**Type:** ${safe(record.type[0].toUpperCase() + record.type.slice(1))}`,
        `**Reason:** ${safe(record.reason)}`,
        `**Role(s) added:** ${addedRoles.length ? addedRoles.map(id => `<@&${id}>`).join(', ') : 'None'}`,
        ...(record.evidence ? [`**Evidence:** ${safe(record.evidence)}`] : []),
        ...(record.notes ? [`**Notes:** ${safe(record.notes)}`] : [])
      ].join('\n')));
  } else {
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      titleWithEmoji(infractionEmoji, 'Infraction Revoked'),
      '',
      `**User:** <@${record.userId}>`,
      `**Revoked by:** <@${actorId}>`
    ].join('\n')))
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `**Infraction type:** ${safe(record.type[0].toUpperCase() + record.type.slice(1))}`,
        `**Original reason:** ${safe(record.reason)}`,
        `**Revocation reason:** ${safe(revokeReason)}`
      ].join('\n')));
  }
  c.addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
  return c;
}
// Notify only the staff member and the moderator who issued or revoked this
// infraction. Warning/strike roles remain visible but never ping their members.
function infractionMentions(userId, actorId) {
  return {users: [...new Set([userId, actorId])], roles: [], repliedUser: false};
}
function attachments(isRevoke) {
  return isRevoke ? [new AttachmentBuilder(FOOTER, {name:'image.png'})] : [
    new AttachmentBuilder(BANNER, {name:'ticket-dashboard.png'}),
    new AttachmentBuilder(FOOTER, {name:'image.png'})
  ];
}
function activeFor(guildId, userId) {
  return Object.values(db.records).filter(r=>r.guildId===guildId && r.userId===userId && !r.revokedAt);
}
function userKey(guildId,userId) { return `${guildId}:${userId}`; }
function baselineFor(guildId, userId) { return db.users[userKey(guildId,userId)]?.baselineRoleIds ?? []; }
function desiredRoles(guildId,userId,records) {
  const baseline = new Set(baselineFor(guildId,userId));
  const desired = new Set(baseline);
  for (const record of records) for (const roleId of (record.requiredRoleIds || [])) desired.add(roleId);
  return desired;
}
async function reconcile(member,guildId,userId,records) {
  const desired = desiredRoles(guildId,userId,records);
  const present = new Set(LEVEL_ROLES.filter(x=>member.roles.cache.has(x)));
  const toAdd = LEVEL_ROLES.filter(x=>desired.has(x) && !present.has(x));
  const toRemove = LEVEL_ROLES.filter(x=>!desired.has(x) && present.has(x));
  // Apply sequentially, so we can report exactly which changes succeeded.
  const added = [], removed = [];
  for (const id of toAdd) {await member.roles.add(id, 'MSRP staff infraction level');added.push(id);}
  for (const id of toRemove) {await member.roles.remove(id, 'MSRP staff infraction revoked');removed.push(id);}
  return {added, removed};
}
async function getLogChannel(interaction) {
  const channel = await interaction.guild.channels.fetch(LOG_CHANNEL_ID);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') throw new Error('The configured infraction log channel was not found or is not text based.');
  return channel;
}
async function reply(interaction, message) {
  if (interaction.deferred || interaction.replied) return interaction.editReply({content:message});
  return interaction.reply({content:message, flags:MessageFlags.Ephemeral});
}
async function handleAutocomplete(interaction) {
  if (!interaction.isAutocomplete() || interaction.commandName !== 'revoke-infraction') return false;
  try {
    // During autocomplete, Discord sometimes only supplies a raw snowflake rather
    // than a resolved User object. Look at the raw option as a fallback.
    const userOption = interaction.options.get('user');
    const userId = interaction.options.getUser('user')?.id || userOption?.value;
    if (!db || !/^\d{15,22}$/.test(String(userId || '')) || !interaction.guildId) {
      await interaction.respond([]); return true;
    }
    const search = String(interaction.options.getFocused() || '').toLowerCase();
    const options = activeFor(interaction.guildId,String(userId))
      .sort((a,b)=>b.createdAt-a.createdAt)
      .filter(x=>`${x.reason} ${x.type}`.toLowerCase().includes(search))
      .slice(0,25)
      .map(x=>({name:`${x.reason.slice(0,70)} (${new Date(x.createdAt).toLocaleDateString('en-AU')})`.slice(0,100),value:x.id}));
    await interaction.respond(options);
  } catch (err) {
    console.error('[INFRACTIONS] Autocomplete error:',err);
    if (!interaction.responded) await interaction.respond([]).catch(()=>{});
  }
  return true;
}
async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand() || !['infract','revoke-infraction'].includes(interaction.commandName)) return false;
  if (!db) {await reply(interaction,'Infraction storage failed to load. Fix infractions/infractions.json before continuing.');return true;}
  if (!interaction.guild) {await reply(interaction,'This command can only be used in the server.');return true;}
  const user = interaction.options.getUser('user',true);
  const lock = userKey(interaction.guildId,user.id);
  if (activeLocks.has(lock)) {await reply(interaction,'An infraction update for this member is already running. Try again.');return true;}
  activeLocks.add(lock);
  try {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const member = await interaction.guild.members.fetch(user.id);
    if (!member.manageable) throw new Error('I cannot manage this member. Check that my bot role is above their highest role.');
    const channel = await getLogChannel(interaction);
    const isRevoke = interaction.commandName === 'revoke-infraction';
    if (!isRevoke) {
      const type = interaction.options.getString('type',true);
      const reason = interaction.options.getString('reason',true);
      const evidence = interaction.options.getString('evidence') || null;
      const notes = interaction.options.getString('notes') || null;
      const custom = interaction.options.getString('custom-infraction');
      let target = custom === null ? -1 : Number(custom);
      if (custom === null && type==='termination') target = LEVEL_ROLES.length - 1;
      if (custom === null && (type==='warning' || type==='demotion' || type==='other')) {
        target = LEVEL_ROLES.findIndex(id=>!member.roles.cache.has(id));
        if (target < 0) {await reply(interaction,'This member already has all six infraction roles. Select a custom level if recording an infraction without adding roles.');return true;}
      }
      const key = userKey(interaction.guildId,user.id);
      const isNewUser = !db.users[key];
      if (isNewUser) db.users[key] = {baselineRoleIds:LEVEL_ROLES.filter(x=>member.roles.cache.has(x))};
      // A custom level guarantees the full preceding warning/strike ladder.
      const requiredRoleIds = target >= 0 ? LEVEL_ROLES.slice(0,target+1) : [];
      const record = {
        id:crypto.randomUUID(), guildId:interaction.guildId,userId:user.id,issuerId:interaction.user.id,
        type, reason,evidence,notes,requiredRoleIds,createdAt:Date.now(),revokedAt:null,
        logMessageId:null, logChannelId:LOG_CHANNEL_ID
      };
      const records = [...activeFor(interaction.guildId,user.id),record];
      let changed;
      try {changed = await reconcile(member,interaction.guildId,user.id,records);}
      catch(err) { // Try restoring the roles to the previous persisted state.
        await member.fetch().catch(()=>{});
        await reconcile(member,interaction.guildId,user.id,activeFor(interaction.guildId,user.id)).catch(e=>console.error('[INFRACTIONS] Rollback failed:',e));
        if(isNewUser) delete db.users[key];
        throw err;
      }
      let message;
      try {
        message = await channel.send({components:[containerFor(record,{addedRoles:changed.added,actorId:interaction.user.id,infractionEmoji:await getInfractionEmoji(interaction.guild),guild:interaction.guild})],
          files:attachments(false),flags:MessageFlags.IsComponentsV2,allowedMentions:infractionMentions(record.userId,interaction.user.id)});
      } catch(err) {
        await member.fetch().catch(()=>{});
        await reconcile(member,interaction.guildId,user.id,activeFor(interaction.guildId,user.id)).catch(e=>console.error('[INFRACTIONS] Rollback failed:',e));
        if(isNewUser) delete db.users[key];
        throw err;
      }
      record.logMessageId = message.id;
      record.addedRoleIds = changed.added;
      db.records[record.id] = record;
      save();
      await reply(interaction,`Infraction issued to <@${user.id}>. ${changed.added.length} role(s) added. [View log](${message.url})`);
    } else {
      const id = interaction.options.getString('punishment-revoked',true);
      const record = db.records[id];
      if (!record || record.revokedAt || record.userId!==user.id || record.guildId!==interaction.guildId) {
        await reply(interaction,'That infraction is not active for this user. Pick an entry from the autocomplete list.');return true;
      }
      const reason = interaction.options.getString('reason',true);
      const remaining = activeFor(interaction.guildId,user.id).filter(x=>x.id!==id);
      let changed;
      try {changed = await reconcile(member,interaction.guildId,user.id,remaining);}
      catch (err) {
        await member.fetch().catch(()=>{});
        await reconcile(member,interaction.guildId,user.id,activeFor(interaction.guildId,user.id)).catch(e=>console.error('[INFRACTIONS] Rollback failed:',e));
        throw err;
      }
      let message;
      try {
        message = await channel.send({components:[containerFor(record,{isRevocation:true,actorId:interaction.user.id,revokeReason:reason,infractionEmoji:await getInfractionEmoji(interaction.guild),guild:interaction.guild})],
          files:attachments(true),flags:MessageFlags.IsComponentsV2,allowedMentions:infractionMentions(record.userId,interaction.user.id),
          ...(record.logMessageId ? {reply:{messageReference:record.logMessageId, failIfNotExists:false}} : {})});
      } catch(err) {
        await member.fetch().catch(()=>{});
        await reconcile(member,interaction.guildId,user.id,activeFor(interaction.guildId,user.id)).catch(e=>console.error('[INFRACTIONS] Rollback failed:',e));
        throw err;
      }
      record.revokedAt=Date.now();record.revokedById=interaction.user.id;record.revokeReason=reason;
      record.revokeMessageId=message.id;
      save();
      await reply(interaction,`Infraction revoked for <@${user.id}>. ${changed.removed.length} role(s) removed. [View log](${message.url})`);
    }
  } catch(err) {
    console.error('[INFRACTIONS]',err);
    await reply(interaction,`Unable to update the infraction: ${safe(err.message).slice(0,250)}`).catch(()=>{});
  } finally {activeLocks.delete(lock);}
  return true;
}
module.exports = {commands:[infractCommand,revokeCommand],handleCommand,handleAutocomplete};
