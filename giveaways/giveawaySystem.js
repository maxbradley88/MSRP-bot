'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder,
  MessageFlags, SeparatorBuilder, SlashCommandBuilder, TextDisplayBuilder,
  PermissionFlagsBits
} = require('discord.js');

const STORE = path.join(__dirname, 'giveaways.json');
const TZ = 'Australia/Melbourne'; // All entered draw dates/times use AEST or AEDT.
const MONITOR_MS = 60_000;
const REMINDER_BEFORE_MS = 10 * 60_000;
const NOTIFY_ROLE_ID = '1561315149086855228';
const GIVEAWAY_ROLE_ID = '1561287581897982042';
let running = false;
let monitor = null;
const locks = new Set();
let store = { giveaways: {} };
try {
  if (fs.existsSync(STORE)) store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  if (!store || typeof store.giveaways !== 'object') store = { giveaways: {} };
} catch (e) { console.error('[GIVEAWAYS] Failed to read data:', e.message); store = { giveaways: {} }; }

function persist() {
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  const tmp = STORE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE);
}

const command = new SlashCommandBuilder()
  .setName('create-giveaway').setDescription('Create a timed MSRP giveaway.')
  .addStringOption(o => o.setName('name').setDescription('Prize or giveaway name').setRequired(true).setMaxLength(100))
  .addStringOption(o => o.setName('description').setDescription('Giveaway type or description').setRequired(true).setMaxLength(1200))
  .addStringOption(o => o.setName('draw-date').setDescription('Melbourne date DD/MM/YYYY (AEST/AEDT)').setRequired(true))
  .addStringOption(o => o.setName('draw-time').setDescription('Melbourne time HH:MM, 24-hour (AEST/AEDT)').setRequired(true))
  .addUserOption(o => o.setName('host').setDescription('Person hosting the giveaway').setRequired(true))
  .addIntegerOption(o => o.setName('winners').setDescription('Number of unique winners (1–20)').setRequired(true).setMinValue(1).setMaxValue(20))
  .addRoleOption(o => o.setName('required-role').setDescription('Optional role required to enter'))
  .addStringOption(o => o.setName('notes').setDescription('Optional additional notes').setMaxLength(500));

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
}
function parseDate(dateStr, timeStr) {
  const d = String(dateStr || '').trim();
  const t = String(timeStr || '').trim();
  let y, mo, day;
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
  if (m) { day=+m[1]; mo=+m[2]; y=+m[3]; }
  else { m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); if (!m) return null; y=+m[1]; mo=+m[2]; day=+m[3]; }
  const tm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!tm || y < 2025 || y > 2100 || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  const hh=+tm[1], mm=+tm[2];
  const nominal=Date.UTC(y,mo-1,day,hh,mm);
  if (new Date(Date.UTC(y,mo-1,day)).getUTCDate() !== day) return null;
  // Resolve IANA timezone including DST; reject nonexistent DST local times.
  let guess=nominal-10.5*3600_000;
  for (let i=0;i<4;i++) {
    const p=zonedParts(new Date(guess));
    const seen=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);
    guess += nominal-seen;
  }
  const p=zonedParts(new Date(guess));
  if ([p.year,p.month,p.day,p.hour,p.minute].join()!==[y,mo,day,hh,mm].join()) return null;
  return guess;
}
function timezoneLabel(instant) {
  const value = new Intl.DateTimeFormat('en-AU', {
    timeZone: TZ, timeZoneName: 'short'
  }).formatToParts(new Date(instant)).find(part => part.type === 'timeZoneName')?.value;
  // Australia/Melbourne is UTC+10 in winter (AEST) and UTC+11 in summer (AEDT).
  if (value === 'GMT+11' || value === 'UTC+11' || value === 'AEDT') return 'AEDT (UTC+11)';
  if (value === 'GMT+10' || value === 'UTC+10' || value === 'AEST') return 'AEST (UTC+10)';
  return value || 'Australia/Melbourne';
}
function safeText(x) { return String(x || '').replace(/@/g,'@\u200b').replace(/<(?=[@#])/g,'<\u200b').trim(); }
function renderGiveaway(g, disabled=false) {
  const time = Math.floor(g.drawAt / 1000);
  const heading = `### ${safeText(g.name)}\n${safeText(g.description)}`;
  const details = [
    `**Draws:** <t:${time}:R>`,
    `**Host:** <@${g.hostId}>`,
    `**Entries:** ${g.entries.length}`,
    `**Winners:** ${g.winners}`
  ].join('\n');
  const container = new ContainerBuilder()
    .setAccentColor(0x2378D4)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(heading))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(details));
  if (g.requiredRoleId) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**Entry requirement**\nHave the <@&${g.requiredRoleId}> role to participate.`)
    );
  }
  if (g.notes) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${safeText(g.notes)}`));
  }
  const button = new ButtonBuilder()
    .setCustomId(`msrp_giveaway_enter:${g.id}`)
    .setLabel(g.status === 'ended' ? 'Giveaway ended' : 'Enter giveaway')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled || g.status !== 'open');
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(new ActionRowBuilder().addComponents(button));
  return {
    components: [new TextDisplayBuilder().setContent(`<@&${NOTIFY_ROLE_ID}>`), container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {parse: []}
  };
}
function payload(g, guild, disabled=false) { return renderGiveaway(g,disabled); }
function announcementPayload(g, guild) {
  const p = renderGiveaway(g,false);
  p.allowedMentions = {roles:[NOTIFY_ROLE_ID],parse:[]};
  return p;
}

function rolePresent(interaction, roleId) {
  if (!roleId) return true;
  const roles=interaction.member?.roles;
  return Boolean(roles?.cache?.has?.(roleId) || (Array.isArray(roles) && roles.includes(roleId)));
}
async function commandHandler(interaction) {
  if (interaction.commandName !== 'create-giveaway') return false;
  if (!rolePresent(interaction,GIVEAWAY_ROLE_ID) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({content:'You need the Giveaway Team role to create giveaways.',flags:MessageFlags.Ephemeral});return true;
  }
  const o=interaction.options;
  const drawAt=parseDate(o.getString('draw-date'),o.getString('draw-time'));
  if (!drawAt) {
    await interaction.reply({content:`Enter a valid date/time (${timezoneLabel(drawAt || Date.now())}). Dates use DD/MM/YYYY, times use HH:MM (24-hour). Current time in that timezone: ${new Intl.DateTimeFormat('en-AU',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date())}.`,flags:MessageFlags.Ephemeral});return true;
  }
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const g={id:crypto.randomBytes(7).toString('hex'),guildId:interaction.guildId,channelId:interaction.channelId,
    messageId:null,name:o.getString('name'),description:o.getString('description'),
    drawAt,hostId:o.getUser('host').id,winners:o.getInteger('winners'),
    requiredRoleId:o.getRole('required-role')?.id || null,notes:o.getString('notes')||null,
    entries:[],status:'open',createdAt:Date.now(),resultMessageId:null,reminderMessageId:null,reminderPending:false};
  try {
    const msg=await interaction.channel.send(announcementPayload(g,interaction.guild));
    g.messageId=msg.id; store.giveaways[g.id]=g; persist();
    if (drawAt <= Date.now()) {
      // Past dates close immediately. There are no entrants at creation, so no winner can be selected.
      await draw(interaction.client, g);
    }
    await interaction.editReply({content:drawAt<=Date.now() ? `Giveaway posted and closed immediately (the scheduled draw was in the past, so there were no entries): ${msg.url}` : `✅ Giveaway posted: ${msg.url}`});
  } catch (e) {console.error('[GIVEAWAYS] Creation failed:',e);await interaction.editReply({content:'Unable to post giveaway. Check Send Messages and Components permissions.'});}
  return true;
}
async function entryHandler(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('msrp_giveaway_enter:')) return false;
  const id=interaction.customId.slice('msrp_giveaway_enter:'.length);
  if (locks.has(id)) {await interaction.reply({content:'Please try again in a moment.',flags:MessageFlags.Ephemeral});return true;}
  locks.add(id);
  try {
    const g=store.giveaways[id];
    if (!g || g.status !== 'open' || Date.now() >= g.drawAt) {
      await interaction.reply({content:'This giveaway has closed.',flags:MessageFlags.Ephemeral});return true;
    }
    if (g.guildId !== interaction.guildId || g.messageId !== interaction.message.id) {
      await interaction.reply({content:'This giveaway button is no longer valid.',flags:MessageFlags.Ephemeral});return true;
    }
    const uid=interaction.user.id;
    const ix=g.entries.indexOf(uid);
    if (ix < 0 && !rolePresent(interaction,g.requiredRoleId)) {
      await interaction.reply({content:`You need <@&${g.requiredRoleId}> to enter this giveaway.`,flags:MessageFlags.Ephemeral});return true;
    }
    if (ix >= 0) g.entries.splice(ix,1); else g.entries.push(uid);
    persist();
    await interaction.reply({content:ix>=0?'✅ You left the giveaway.':'✅ You entered the giveaway. Good luck!',flags:MessageFlags.Ephemeral});
    try {await interaction.message.edit(payload(g,interaction.guild));}catch(e){console.warn('[GIVEAWAYS] Entry count update failed:',e.message);}
  } catch(e) {console.error('[GIVEAWAYS] Entry error:',e);if(!interaction.replied && !interaction.deferred)await interaction.reply({content:'Unable to update entry.',flags:MessageFlags.Ephemeral}).catch(()=>{});}
  finally {locks.delete(id);}
  return true;
}
async function draw(client,g) {
  if (locks.has(g.id)) return;
  locks.add(g.id);
  try {
    if(g.status!=='open')return;
    const guild=await client.guilds.fetch(g.guildId);
    const channel=await client.channels.fetch(g.channelId);
    if(!channel?.send)throw new Error('Giveaway channel inaccessible');
    const eligible=[];
    for(const id of [...new Set(g.entries)]) {
      if (!g.requiredRoleId) { eligible.push(id); continue; }
      try {
        // No mass fetch; one request at a time only if the member isn't cached.
        let member=guild.members.cache.get(id);
        if (!member) {
          member=await guild.members.fetch({user:id,force:false});
          await new Promise(resolve=>setTimeout(resolve,350));
        }
        if(member?.roles.cache.has(g.requiredRoleId))eligible.push(id);
      }catch(e){console.warn(`[GIVEAWAYS] Skipping unavailable member ${id}: ${e.message}`);}
    }
    // Rejection sampling avoids modulo bias and picks without replacement.
    const pool=[...eligible];const winnerIds=[];
    for(let n=0;n<Math.min(g.winners,pool.length);n++) {
      const index=crypto.randomInt(pool.length);winnerIds.push(pool.splice(index,1)[0]);
    }
    // Persist result before posting; on send failure, retry just the announcement.
    g.status='ended';g.winnerIds=winnerIds;g.endedAt=Date.now();persist();
    try {const msg=await channel.messages.fetch(g.messageId);await msg.edit(payload(g,guild,true));}catch(e){console.warn('[GIVEAWAYS] Could not close giveaway button:',e.message);}
    await announceResult(channel,g);
    await removeReminder(channel,g);
  } catch(e){console.error(`[GIVEAWAYS] Draw ${g.id} failed; will retry:`,e.message);}
  finally{locks.delete(g.id);}
}
async function sendReminder(client,g) {
  if(g.reminderMessageId || g.reminderPending || g.status !== 'open')return;
  // Record the attempt before sending: protects against repeated pings on restarts.
  g.reminderPending=true;
  persist();
  try {
    const channel=await client.channels.fetch(g.channelId);
    if(!channel?.send)throw new Error('Channel not accessible');
    const container=new ContainerBuilder()
      .setAccentColor(0xE7A334)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Last chance to enter\n**${safeText(g.name)}** is drawing <t:${Math.floor(g.drawAt/1000)}:R>.\n\nEnter using the giveaway button above before entries close.`));
    const msg=await channel.send({
      components:[new TextDisplayBuilder().setContent(`<@&${NOTIFY_ROLE_ID}>`),container],
      flags:MessageFlags.IsComponentsV2,
      reply:{messageReference:g.messageId,failIfNotExists:false},
      allowedMentions:{roles:[NOTIFY_ROLE_ID],parse:[]}
    });
    g.reminderMessageId=msg.id;
    persist();
  }catch(e){console.warn(`[GIVEAWAYS] Reminder ${g.id} failed:`,e.message);}
}
async function removeReminder(channel,g) {
  if(!g.reminderMessageId)return;
  try {
    const msg=await channel.messages.fetch(g.reminderMessageId);
    await msg.delete();
    g.reminderMessageId=null;
    persist();
  }catch(e){
    if(e.code===10008){g.reminderMessageId=null;persist();}
    else console.warn('[GIVEAWAYS] Reminder cleanup failed:',e.message);
  }
}
async function announceResult(channel,g) {
  if(g.resultMessageId)return;
  const ids=g.winnerIds || [];
  const content=ids.length
    ? `🎉 Congratulations ${ids.map(id=>`<@${id}>`).join(' ')}! You won **${safeText(g.name)}**!\n\n-# Open a support ticket to claim your prize!`
    : `🎁 **${safeText(g.name)}** has ended with no eligible entries. No winners were selected.`;
  // Mentions permitted for actual selected winners only.
  const m=await channel.send({content,reply:{messageReference:g.messageId,failIfNotExists:false},allowedMentions:{users:ids,parse:[]}});
  g.resultMessageId=m.id;persist();
}
async function tick(client) {
  if(running)return;
  running=true;
  try {
    for(const g of Object.values(store.giveaways)) {
      if(g.status==='open' && g.drawAt<=Date.now())await draw(client,g);
      else if(g.status==='open' && g.drawAt-Date.now() <= REMINDER_BEFORE_MS && g.drawAt>Date.now() && !g.reminderMessageId && !g.reminderPending) await sendReminder(client,g);
      else if(g.status==='ended' && !g.resultMessageId && g.winnerIds) {
        try {const ch=await client.channels.fetch(g.channelId);if(ch)await announceResult(ch,g);}catch(e){console.warn('[GIVEAWAYS] Announcement retry failed:',e.message);}
      }
      if(g.status==='ended' && g.reminderMessageId) {
        try {const ch=await client.channels.fetch(g.channelId);if(ch)await removeReminder(ch,g);}catch(e){console.warn('[GIVEAWAYS] Reminder cleanup retry:',e.message);}
      }
    }
  }finally{running=false;}
}
function start(client) {
  if(monitor)return;
  monitor=setInterval(()=>void tick(client).catch(e=>console.error('[GIVEAWAYS] Tick error:',e.message)),MONITOR_MS);
  monitor.unref?.();
  void tick(client).catch(e=>console.error('[GIVEAWAYS] Startup check failed:',e.message));
  console.log('[GIVEAWAYS] Scheduled draw checks active (60s; no API polling).');
}
module.exports={command,commandHandler,entryHandler,start};
