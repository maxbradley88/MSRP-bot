'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
  SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder,
  AttachmentBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const { loadData: loadDashboard } = require('../mainDashboard/dashboardData');

const REVIEW_CHANNEL_ID = '1563809877359337603';
const FOUNDER_ROLE_ID = '1547525713853288448';
const GAME_STAFF_ROLE_ID = '1563761372272009297';
const SUPPORT_STAFF_ROLE_ID = '1556203938427183105';
const DATA_DIR = __dirname;
const FORMS_FILE = path.join(DATA_DIR, 'forms.runtime.json');
const RECORDS_FILE = path.join(DATA_DIR, 'applications.runtime.json');
const BANNER = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const FOOTER = path.join(__dirname, '..', 'images', 'image.png');
const inProgress = new Set();
// A rejected old bridge can remain in the channel. Retry it, but avoid flooding
// the host console with the same error every time the recovery check runs.
const failureLoggedAt = new Map();

const formManageCommand = new SlashCommandBuilder()
  .setName('form-manage')
  .setDescription('Foundership: add, update or remove a Google Form application.')
  .addStringOption(o => o.setName('manage').setDescription('What would you like to do?').setRequired(true)
    .addChoices({name:'Add',value:'add'},{name:'Remove',value:'remove'},{name:'Update',value:'update'}))
  .addStringOption(o => o.setName('name').setDescription('New form name, or select an existing form').setAutocomplete(true).setRequired(true))
  .addStringOption(o => o.setName('link').setDescription('Google Form link (needed for Add or Update)').setMaxLength(700))
  .addRoleOption(o => o.setName('approval-role').setDescription('Role awarded upon approval (optional for existing forms)'));

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) {
    if (err.code !== 'ENOENT') console.warn('[APPLICATIONS] Data read failed:', file, err.message);
    return fallback;
  }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
function defaultForms() {
  const data = loadDashboard().applications || {};
  return [
    {name:'Game Staff', link:data.gameStaff || null, roleId:GAME_STAFF_ROLE_ID},
    {name:'Support Staff', link:data.supportTeam || null, roleId:SUPPORT_STAFF_ROLE_ID},
  ];
}
function getForms() {
  const forms = readJson(FORMS_FILE, null);
  return Array.isArray(forms) ? forms : defaultForms();
}
function saveForms(forms) { writeJson(FORMS_FILE, forms); }
function updateLegacyFormLink(key, link) {
  const name=key==='gameStaff'?'Game Staff':key==='supportTeam'?'Support Staff':null;
  if (!name) return;
  const forms=getForms();
  const f=findForm(name,forms);
  if (f) f.link=link||null;
  else forms.push({name,link:link||null,roleId:key==='gameStaff'?GAME_STAFF_ROLE_ID:SUPPORT_STAFF_ROLE_ID});
  saveForms(forms);
}
function findForm(name, forms = getForms()) {
  return forms.find(f => f.name.toLowerCase() === String(name || '').trim().toLowerCase());
}
function readRecords() { return readJson(RECORDS_FILE, {}); }
function saveRecords(records) { writeJson(RECORDS_FILE, records); }
function founderIds() {
  return [...new Set((process.env.MSRP_FOUNDER_IDS || '').split(',').map(s=>s.trim()).filter(s=>/^\d{17,20}$/.test(s)))];
}
function isFounder(interaction) {
  const ids = founderIds();
  return ids.length === 3 && ids.includes(interaction.user.id) &&
    interaction.member?.roles?.cache?.has(FOUNDER_ROLE_ID);
}
function escapeText(value) {
  return String(value ?? '').replace(/@/g,'@\u200b').replace(/<(?=[@!#&])/g,'<\u200b')
    .replace(/([\\*_~`|])/g,'\\$1').trim();
}
function imageItem(name) { return new MediaGalleryItemBuilder().setURL(`attachment://${name}`); }
function applicationEmoji(guild) {
  const e = guild?.emojis?.cache?.find(e=>e.name==='msrp_applications');
  return e ? e.toString() : '';
}
function answerChunks(answers) {
  // Discord text-display fields are bounded; keep long applications readable.
  let chunks = [], current = '';
  for (const a of answers.slice(0, 100)) {
    const line = `**${escapeText(a.question).slice(0, 350)}**\n${escapeText(a.answer).slice(0, 2500) || '(No answer)'}\n\n`;
    if (current.length + line.length > 3400 && current) { chunks.push(current); current=''; }
    if (chunks.length === 4) break;
    current += line;
  }
  if (current) chunks.push(current);
  if (chunks.length === 0) chunks.push('No answers were provided.');
  if (answers.length > 100 || answers.reduce((n,a)=>n+String(a.answer).length+String(a.question).length,0)>13500)
    chunks.push('-# Some long responses were shortened to fit Discord.');
  return chunks.slice(0,5);
}
function renderApplication(record, guild) {
  const isUnlinked = Boolean(record.wasUnlinked && !record.linkedAt);
  const linkable = isUnlinked && record.status === 'unlinked';
  const pending = !isUnlinked && record.status === 'pending';
  const emoji = applicationEmoji(guild);
  const statusText = linkable ? 'Applicant not linked · Foundership action required'
    : pending ? `Pending review · ${record.votes.length}/3 approvals`
    : record.status === 'approved' ? `Approved by <@${record.decidedBy}>${record.forced ? ' (force approved)' : ''}`
    : `Denied by <@${record.decidedBy}>`;

  const intro = isUnlinked
    ? [
        'We could not identify the applicant from their submitted Discord User ID.',
        'Only the first four answers are shown until Foundership links the correct member.',
        `**Submitted Discord ID:** ${escapeText(record.submittedUserId || '(missing)').slice(0, 120)}`,
        `**Status:** ${statusText}`,
        '-# Please verify their identity before linking a member. A matching username alone is not proof.'
      ]
    : [
        `A new application has been submitted by <@${record.userId}>. Review the answers below and use the buttons to approve or deny the application. The MSRP bot will assign the role when approved.`,
        `**Status:** ${statusText}`,
        record.votes.length ? `-# Founder approvals: ${record.votes.map(id => `<@${id}>`).join(', ')}` : '',
        '-# Discord identity was supplied by the applicant and should be verified before approval.'
      ];

  const container = new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(imageItem('ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${emoji ? `${emoji} ` : ''}${escapeText(record.formName)} Application`,
      '',
      ...intro
    ].filter(Boolean).join('\n')))
    .addSeparatorComponents(new SeparatorBuilder());

  // The full answers remain in the private record. Unlinked applications only
  // display Q1-4, including after a denial, until explicitly linked.
  const visibleAnswers = isUnlinked ? record.answers.slice(0, 4) : record.answers;
  for (const chunk of answerChunks(visibleAnswers)) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
  }
  if (record.decisionReason) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `**Decision reason:** ${escapeText(record.decisionReason).slice(0, 1600)}`));
  }

  const buttons = new ActionRowBuilder();
  if (isUnlinked) {
    buttons.addComponents(
      new ButtonBuilder().setCustomId(`msrp_form:link:${record.id}`)
        .setLabel('Link User').setStyle(ButtonStyle.Primary).setDisabled(!linkable),
      new ButtonBuilder().setCustomId(`msrp_form:deny:${record.id}`)
        .setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(!linkable)
    );
  } else {
    buttons.addComponents(
      new ButtonBuilder().setCustomId(`msrp_form:approve:${record.id}`)
        .setLabel(`Approve ${record.votes.length}/3`).setStyle(ButtonStyle.Success).setDisabled(!pending),
      new ButtonBuilder().setCustomId(`msrp_form:deny:${record.id}`)
        .setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(!pending),
      new ButtonBuilder().setCustomId(`msrp_form:force:${record.id}`)
        .setLabel('Force Approve').setStyle(ButtonStyle.Secondary).setDisabled(!pending)
    );
  }
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(buttons);
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(imageItem('image.png')));
  return [new TextDisplayBuilder().setContent(`<@&${FOUNDER_ROLE_ID}>`), container];
}
function imageFiles() {
  return [new AttachmentBuilder(BANNER,{name:'ticket-dashboard.png'}),new AttachmentBuilder(FOOTER,{name:'image.png'})];
}
function validFormUrl(input) {
  try {
    const u = new URL(input);
    return u.protocol === 'https:' && (u.hostname === 'forms.gle' || u.hostname === 'docs.google.com');
  } catch { return false; }
}
async function handleAutocomplete(interaction) {
  if (!interaction.isAutocomplete() || interaction.commandName !== 'form-manage') return false;
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'name') return false;
  const mode = interaction.options.getString('manage');
  const matches = mode === 'add' ? [] : getForms()
    .filter(f=>f.name.toLowerCase().includes(String(focused.value).toLowerCase()))
    .slice(0,25).map(f=>({name:f.name,value:f.name}));
  await interaction.respond(matches).catch(()=>{});
  return true;
}
async function handleCommand(interaction) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'form-manage') return false;
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try {
    const mode=interaction.options.getString('manage',true);
    const name=interaction.options.getString('name',true).trim().slice(0,80);
    const link=interaction.options.getString('link');
    const role=interaction.options.getRole('approval-role');
    const forms=getForms();
    const existing=findForm(name,forms);
    if (!name) throw new Error('Please provide a form name.');
    if (mode==='remove') {
      if (!existing) throw new Error('That form is not registered. Choose one of the autocomplete suggestions.');
      const next=forms.filter(f=>f!==existing);
      saveForms(next);
      await interaction.editReply(`Removed **${escapeText(existing.name)}** from the application dropdown. Previously submitted applications are kept.`);
      return true;
    }
    if (!link || !validFormUrl(link)) throw new Error('Add and Update require a valid Google Forms URL (`forms.gle` or `docs.google.com/forms`).');
    if (mode==='add' && existing) throw new Error('A form with that name already exists. Select Update.');
    if (mode==='update' && !existing) throw new Error('That form is not registered. Select Add first.');
    if (mode==='add' && forms.length>=20) throw new Error('At most 20 forms can be listed.');
    const roleId=role?.id || existing?.roleId || null;
    if (!roleId) throw new Error('Choose an Approval Role for a new application type.');
    if (role && (role.managed || role.id===interaction.guildId)) throw new Error('That role cannot be assigned by the bot.');
    if (existing) {existing.link=link;existing.roleId=roleId;}
    else forms.push({name,link,roleId});
    saveForms(forms);
    await interaction.editReply(`**${escapeText(name)}** ${mode==='add'?'added':'updated'}. The application menu will show the link next time it is opened.\nSubmission integration requires the Google Apps Script trigger to be set up for this form.`);
  } catch(error) { await interaction.editReply(`Unable to manage form: ${error.message}`).catch(()=>{}); }
  return true;
}
async function updateMessage(client, record, pingLinkedMember = false) {
  if (!record.messageId) return;
  const channel=await client.channels.fetch(REVIEW_CHANNEL_ID);
  const msg=await channel.messages.fetch(record.messageId);
  await msg.edit({
    components:renderApplication(record,msg.guild),
    allowedMentions:{parse:[],users:pingLinkedMember && record.userId ? [record.userId] : [],roles:[]}
  });
}
function safeEqual(hexA,hexB) {
  if (!/^[a-f0-9]{64}$/i.test(hexA||'')||!/^[a-f0-9]{64}$/i.test(hexB||'')) return false;
  return crypto.timingSafeEqual(Buffer.from(hexA,'hex'),Buffer.from(hexB,'hex'));
}
async function handleIncoming(message) {
  const expectedWebhook=process.env.MSRP_FORMS_WEBHOOK_ID;
  const secret=process.env.MSRP_FORMS_SECRET;
  const queue=process.env.MSRP_FORMS_QUEUE_CHANNEL_ID || REVIEW_CHANNEL_ID;
  if (!expectedWebhook || !secret || !message || message.channelId!==queue) return;
  let shouldDelete=false;
  let imported=false;
  try {
    // A partial gateway message needs fetching before checking its webhook ID,
    // content, and attachment. Fetched backlog messages already have this data.
    if (message.partial) message=await message.fetch();
    if (message.webhookId!==expectedWebhook) return;
    if (!message.content?.startsWith('msrp_form_bridge')) return;
    shouldDelete=true;
    const attachment=message.attachments?.first();
    if (!attachment || attachment.size>150000 || attachment.size<10) throw new Error('Missing/oversized application attachment');
    const response=await fetch(attachment.url);
    if (!response.ok) throw new Error(`Could not retrieve bridge attachment (${response.status})`);
    const envelope=JSON.parse(await response.text());
    const body=JSON.stringify(envelope.payload);
    const hmac=crypto.createHmac('sha256',secret).update(body).digest('hex');
    if (!safeEqual(envelope.signature,hmac)) throw new Error('Invalid bridge signature');
    const payload=envelope.payload;
    if (!payload || typeof payload!=='object') throw new Error('Invalid submission structure');
    const name=String(payload.formName || '').slice(0,80);
    const form=findForm(name);
    if (!form || !form.link || !form.roleId) throw new Error(`Unregistered form: ${name}`);
    const userId=String(payload.discordUserId||'').trim();
    // A malformed, missing, or non-member ID is still a reviewable submission.
    // It enters the limited-preview Link User workflow instead of being discarded.
    if (!Array.isArray(payload.answers) || payload.answers.length>100) throw new Error('Too many or missing answers');
    const submission=String(payload.formId||'')+':'+String(payload.responseId||'');
    if (submission.length>250 || submission===':') throw new Error('Invalid submission ID');
    const id=crypto.createHash('sha256').update(submission).digest('hex').slice(0,24);
    if (inProgress.has(`receive:${id}`)) return;
    inProgress.add(`receive:${id}`);
    try {
      const records=readRecords();
      if (records[id]) { imported=true; return; }
      const guild=message.guild;
      if (!guild) throw new Error('Submission bridge must be in a server');
      const channel=await guild.channels.fetch(REVIEW_CHANNEL_ID);
      if (!channel?.send) throw new Error('Review channel not found');
      const looksLikeId = /^\d{17,20}$/.test(userId);
      const applicant = looksLikeId ? await guild.members.fetch(userId).catch(() => null) : null;
      const linkedId = applicant && !applicant.user?.bot ? userId : null;
      const record = {
        id, formName:form.name, userId:linkedId, submittedUserId:userId.slice(0,120),
        roleId:form.roleId,
        answers:payload.answers.map(a=>({question:String(a.question||'').slice(0,500),answer:String(a.answer??'').slice(0,12000)})),
        votes:[], status:linkedId ? 'pending' : 'unlinked',
        wasUnlinked:!linkedId, linkedAt:null, createdAt:Date.now(), messageId:null
      };
      const posted=await channel.send({
        components:renderApplication(record,guild), files:imageFiles(), flags:MessageFlags.IsComponentsV2,
        allowedMentions:{users:linkedId ? [linkedId] : [],roles:[FOUNDER_ROLE_ID],repliedUser:false}
      });
      record.messageId=posted.id;
      records[id]=record;
      saveRecords(records);
      imported=true;
      console.log('[APPLICATIONS] Imported application:', form.name, '(message', posted.id + ')');
    } finally {inProgress.delete(`receive:${id}`);}
  } catch (error) {
    const now=Date.now();
    const lastLog=failureLoggedAt.get(message.id) || 0;
    if (now-lastLog>=300_000) {
      console.error('[APPLICATIONS] Submission could not be imported:',error?.message||error);
      failureLoggedAt.set(message.id,now);
      // Bound memory if many invalid transports arrive over a long runtime.
      if (failureLoggedAt.size>200) failureLoggedAt.delete(failureLoggedAt.keys().next().value);
    }
  } finally {
    // Bridge transport messages are not the review messages. Keep application channel tidy.
    if (shouldDelete && imported) await message.delete().catch(()=>{});
  }
}
async function recoverPending(client) {
  const webhook=process.env.MSRP_FORMS_WEBHOOK_ID;
  if (!webhook || !process.env.MSRP_FORMS_SECRET) return;
  try {
    const channel=await client.channels.fetch(process.env.MSRP_FORMS_QUEUE_CHANNEL_ID||REVIEW_CHANNEL_ID);
    if (!channel?.messages?.fetch) return;
    const messages=await channel.messages.fetch({limit:100});
    for (const message of [...messages.values()].reverse()) {
      if (message.webhookId===webhook && message.content?.startsWith('msrp_form_bridge')) await handleIncoming(message);
    }
  } catch(error) {console.error('[APPLICATIONS] Bridge recovery failed:',error.message);}
}
async function approveMember(guild,record) {
  const member=await guild.members.fetch(record.userId).catch(()=>null);
  if (!member) throw new Error('Applicant is not in the Discord server.');
  const role=await guild.roles.fetch(record.roleId).catch(()=>null);
  if (!role || role.managed || role.id===guild.id) throw new Error('Acceptance role is missing or managed.');
  const me=guild.members.me || await guild.members.fetchMe();
  if (!member.manageable || role.position>=me.roles.highest.position) throw new Error('Bot role must be above the applicant and acceptance role.');
  if (!member.roles.cache.has(role.id)) await member.roles.add(role.id,'Approved MSRP Google Forms application');
}
async function applyDecision(interaction,action,reason='') {
  const id=interaction.customId.split(':')[2];
  if (!isFounder(interaction)) {
    await interaction.reply({content:'Only the three configured Foundership reviewers may decide applications.',flags:MessageFlags.Ephemeral});
    return;
  }
  const key=`decide:${id}`;
  if(inProgress.has(key)) {
    await interaction.reply({content:'This application is currently being reviewed. Try again.',flags:MessageFlags.Ephemeral});
    return;
  }
  inProgress.add(key);
  try {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const records=readRecords();
    const r=records[id];
    if (!r || !['pending','unlinked'].includes(r.status)) throw new Error('This application was already decided or is unavailable.');
    if (action !== 'deny' && (r.status !== 'pending' || !r.userId)) {
      throw new Error('Link the applicant to a Discord member before approving.');
    }
    let notice='';
    if(action==='approve') {
      if(r.votes.includes(interaction.user.id)) throw new Error('You have already approved this application.');
      const next=[...r.votes,interaction.user.id];
      if (next.length>=3) {
        await approveMember(interaction.guild,r);
        r.status='approved';r.decidedBy=interaction.user.id;r.forced=false;
        notice='All three founders approved this application. The acceptance role was assigned.';
      } else notice=`Approval recorded (${next.length}/3).`;
      r.votes=next;
    } else if(action==='force') {
      await approveMember(interaction.guild,r);
      r.status='approved';r.decidedBy=interaction.user.id;r.forced=true;r.decisionReason=reason;
      notice='Force approval completed and the acceptance role assigned.';
    } else if(action==='deny') {
      r.status='denied';r.decidedBy=interaction.user.id;r.decisionReason=reason;
      notice='Application denied.';
    }
    saveRecords(records);
    try { await updateMessage(interaction.client,r); }
    catch(e) { console.error('[APPLICATIONS] Could not refresh review:',e.message);notice+=' (Review message could not be refreshed.)'; }
    if(action==='deny') {
      if (!r.userId) {
        notice += ' Applicant was not linked, so no Discord DM was sent.';
      } else {
        const user=await interaction.client.users.fetch(r.userId).catch(()=>null);
        try {
          if (!user) throw new Error('Discord user not found');
          await user.send(`Your **${r.formName}** application for Melbourne State Roleplay was denied.\n\n**Reason:** ${String(reason).slice(0,1200)}`);
          notice += ' The applicant was notified by DM.';
        } catch { notice += ' **DM could not be delivered** (user may have DMs disabled).'; }
      }
    }
    await interaction.editReply(notice);
  } catch(e) {
    console.error('[APPLICATIONS] Decision error:',e);
    if(interaction.deferred || interaction.replied) await interaction.editReply(`Unable to process application: ${e.message}`).catch(()=>{});
    else await interaction.reply({content:`Unable to process application: ${e.message}`,flags:MessageFlags.Ephemeral}).catch(()=>{});
  } finally { inProgress.delete(key); }
}
async function handleLinkSelection(interaction, id) {
  if (!isFounder(interaction)) {
    await interaction.reply({content:'Only the three configured founders may link applicants.',flags:MessageFlags.Ephemeral});
    return;
  }
  // Use the same record-level lock as approval/denial to prevent a race.
  const key = `decide:${id}`;
  if (inProgress.has(key)) {
    await interaction.reply({content:'Someone is already linking this applicant. Try again.',flags:MessageFlags.Ephemeral});
    return;
  }
  inProgress.add(key);
  try {
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const records = readRecords();
    const record = records[id];
    if (!record || record.status !== 'unlinked' || !record.wasUnlinked || record.linkedAt) {
      throw new Error('This application is no longer waiting for a linked member.');
    }
    const userId = interaction.values?.[0];
    if (!/^\d{17,20}$/.test(userId || '')) throw new Error('Select a valid Discord member.');
    const member = await interaction.guild?.members.fetch(userId).catch(() => null);
    if (!member || member.user?.bot) throw new Error('Select a non-bot member of this Discord server.');

    // Preserve the original Google answer for auditing. Only the linked ID is
    // used for role assignment or a decision DM from this point forward.
    record.userId = userId;
    record.linkedAt = Date.now();
    record.linkedBy = interaction.user.id;
    record.votes = [];
    record.status = 'pending';
    saveRecords(records);
    try {
      await updateMessage(interaction.client, record, true);
    } catch (error) {
      // Don't leave a permanently linked record behind a stale Link User button.
      record.userId = null;
      record.linkedAt = null;
      record.linkedBy = null;
      record.status = 'unlinked';
      saveRecords(records);
      throw error;
    }
    await interaction.editReply(`Linked the application to <@${userId}>. The full responses and normal approval controls are now available. Please verify this is the real applicant before approving.`);
  } catch(error) {
    console.error('[APPLICATIONS] Link applicant failed:', error);
    await interaction.editReply(`Unable to link applicant: ${error.message}`).catch(()=>{});
  } finally {
    inProgress.delete(key);
  }
}

async function handleComponent(interaction) {
  if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isUserSelectMenu()) return false;
  if (!interaction.customId?.startsWith('msrp_form:')) return false;
  const [prefix,action,id]=interaction.customId.split(':');
  if (!/^[a-f0-9]{24}$/.test(id||'')) return false;

  if (action==='link' && interaction.isButton()) {
    if (!isFounder(interaction)) {
      await interaction.reply({content:'Only the three configured founders may link applicants.',flags:MessageFlags.Ephemeral});
      return true;
    }
    const r = readRecords()[id];
    if (!r || r.status !== 'unlinked' || !r.wasUnlinked || r.linkedAt) {
      await interaction.reply({content:'This application no longer needs linking.',flags:MessageFlags.Ephemeral});
      return true;
    }
    await interaction.reply({
      content:'Select the correct Discord member. **Confirm their identity before linking** — this selection determines which account receives the acceptance role.',
      components:[new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`msrp_form:link_select:${id}`)
          .setPlaceholder('Select the applicant').setMinValues(1).setMaxValues(1)
      )],
      flags:MessageFlags.Ephemeral
    });
    return true;
  }
  if (action==='link_select' && interaction.isUserSelectMenu()) {
    await handleLinkSelection(interaction,id);
    return true;
  }
  if (action==='approve' && interaction.isButton()) {
    await applyDecision(interaction,'approve');
    return true;
  }
  if ((action==='deny'||action==='force') && interaction.isButton()) {
    if (!isFounder(interaction)) {
      await interaction.reply({content:'Only configured Foundership reviewers can make this decision.',flags:MessageFlags.Ephemeral});
      return true;
    }
    const record=readRecords()[id];
    if (!record || !['pending','unlinked'].includes(record.status) || (action==='force' && record.status!=='pending')) {
      await interaction.reply({content:'This application is already decided, or must be linked before approval.',flags:MessageFlags.Ephemeral});
      return true;
    }
    await interaction.showModal(new ModalBuilder().setCustomId(`msrp_form:${action}_submit:${id}`)
      .setTitle(action==='force'?'Force Approve Application':'Deny Application')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('reason').setLabel(action==='force'?'Override reason':'Reason for denial')
        .setStyle(TextInputStyle.Paragraph).setMinLength(3).setMaxLength(1000).setRequired(true))));
    return true;
  }
  if((action==='deny_submit'||action==='force_submit')&&interaction.isModalSubmit()) {
    const reason=interaction.fields.getTextInputValue('reason')?.trim();
    await applyDecision(interaction,action==='deny_submit'?'deny':'force',reason);
    return true;
  }
  return false;
}

module.exports={formManageCommand,handleCommand,handleAutocomplete,handleComponent,handleIncoming,recoverPending,getForms,updateLegacyFormLink};
