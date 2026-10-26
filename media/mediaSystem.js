'use strict';

// MSRP Media Workspace: one dashboard, persistent tasks, management review.
// Does not create custom server emojis or require task-claim commands.
const fs = require('node:fs');
const path = require('node:path');
const {
  SlashCommandBuilder, ChannelType, MessageFlags, AttachmentBuilder,
  ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder,
  MediaGalleryItemBuilder, SeparatorBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, LabelBuilder,
  TextInputBuilder, TextInputStyle, StringSelectMenuBuilder,
  UserSelectMenuBuilder, FileUploadBuilder, FileBuilder
} = require('discord.js');

const HEAD = '1550808851538780160';
const SENIOR = '1564210385903419503';
const MEMBER = '1558399994267176991';
const TRIAL = '1550809222520770613';
const FOUNDER = '1547525713853288448';
const DATA = path.join(__dirname, 'mediaTasks.runtime.json');
const TOP = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const BOTTOM = path.join(__dirname, '..', 'images', 'image.png');
const locks = new Set();

const command = new SlashCommandBuilder()
  .setName('send-media-dashboard')
  .setDescription('Post or refresh the Media Management dashboard.')
  .addChannelOption(o => o.setName('approvals-channel').setDescription('Where new requests and work reviews go (private recommended)').addChannelTypes(ChannelType.GuildText))
  .addChannelOption(o => o.setName('tasks-channel').setDescription('Where approved tasks are tracked').addChannelTypes(ChannelType.GuildText));

function initial() { return {seq:0, tasks:{}, config:{}, dashboard:null}; }
function load() {
  try {
    const obj = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    return { ...initial(), ...obj, tasks:obj.tasks || {}, config:obj.config || {} };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return initial();
  }
}
function save(data) {
  fs.mkdirSync(path.dirname(DATA), {recursive:true});
  const tmp = `${DATA}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA);
}
function roles(i) { return i.member?.roles?.cache; }
function isManagement(i) {
  return Boolean(i.memberPermissions?.has('Administrator') ||
    [FOUNDER,HEAD,SENIOR].some(id=>roles(i)?.has(id)));
}
function isMedia(i) { return isManagement(i) || [MEMBER,TRIAL].some(id=>roles(i)?.has(id)); }
function icon(guild, name) {
  const e = guild?.emojis?.cache?.find(x=>x.name===name && x.available!==false);
  return e ? e.toString() : '';
}
function withIcon(guild, name, label) { const found=icon(guild,name);return found?`${found} ${label}`:label; }
function txt(v, max=900) {
  const s = String(v??'').trim().replace(/@/g,'@\u200b').replace(/<(?=[@!#&])/g,'<\u200b')
    .replace(/([\\*_~`|])/g,'\\$1');
  return s.length>max ? `${s.slice(0,max-1)}…` : (s||'—');
}
function validLink(v) { if(!v) return '';try{const x=new URL(v);return ['http:','https:'].includes(x.protocol)?x.href:'';}catch{return '';} }
function images(banner) {
  const result = [];
  if (banner) result.push(new AttachmentBuilder(TOP, {name:'ticket-dashboard.png'}));
  result.push(new AttachmentBuilder(BOTTOM, {name:'image.png'}));
  return result;
}
function gallery(name) {
  return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${name}`));
}
function button(id,label,style=ButtonStyle.Secondary,disabled=false,emName=null,guild=null) {
  const b=new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
  if(emName) { const e=guild?.emojis?.cache?.find(x=>x.name===emName && x.available!==false); if(e) b.setEmoji({id:e.id,name:e.name,animated:Boolean(e.animated)}); }
  return b;
}
function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function payload(components,{banner=false,extraFiles=[]}={}) {
  return {flags:MessageFlags.IsComponentsV2,components,files:[...images(banner),...extraFiles],allowedMentions:{parse:[]}};
}
function statusText(s) {return ({pending:'Pending approval',denied:'Denied',not_started:'Not started',in_progress:'In progress',on_hold:'On hold',awaiting_review:'Awaiting review',changes_requested:'Changes requested',completed:'Completed',cancelled:'Cancelled',rejected:'Rejected'})[s]||s;}
function details(t) {
  return [
    `**Type:** ${txt(t.type,80)}`,
    `**Requested by:** <@${t.creatorId}>`,
    `**Assigned to:** ${t.assigneeId?`<@${t.assigneeId}>`:'Not assigned'}`,
    `**Status:** ${statusText(t.status)}`,
    `**Deadline:** ${txt(t.deadline,70)}`
  ].join('\n');
}
function baseContainer(header, body, {banner=false}={}) {
  const c=new ContainerBuilder();
  if(banner) c.addMediaGalleryComponents(gallery('ticket-dashboard.png')).addSeparatorComponents(new SeparatorBuilder());
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  return c;
}
function finishContainer(c) { return c.addSeparatorComponents(new SeparatorBuilder()).addMediaGalleryComponents(gallery('image.png')); }
function dashboard(guild) {
  const c = baseContainer(
    `## ${withIcon(guild,'msrp_event_people','Media Management')}`,
    'Submit media requests and ideas, then manage assigned work here. Requests are reviewed by Senior Media or Head of Media.\n\n-# Approved work is automatically assigned to its requester. Finished work must be reviewed before completion.',
    {banner:true}
  );
  c.addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(row(
      button('msrp_media:create','New Request',ButtonStyle.Primary,false,'msrp_appeal',guild),
      button('msrp_media:mine','My Tasks',ButtonStyle.Secondary,false,'msrp_information_v2',guild),
      button('msrp_media:browse','Browse Tasks',ButtonStyle.Secondary,false,'msrp_ticket_rules',guild)
    ));
  return finishContainer(c);
}
function approvalCard(t,guild) {
  const c=baseContainer(`## ${withIcon(guild,'msrp_notifications','Media Request')}  ·  #${t.id}`,
    `**${txt(t.title,140)}**\n${details(t)}\n\n**Description**\n${txt(t.description,1600)}`,
    {banner:true});
  if(t.denialReason) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Decision notes:** ${txt(t.denialReason,600)}`));
  c.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(row(
    button(`msrp_media:approve:${t.id}`,'Approve',ButtonStyle.Success,t.status!=='pending'),
    button(`msrp_media:deny:${t.id}`,'Deny',ButtonStyle.Danger,t.status!=='pending')
  ));
  return finishContainer(c);
}
function taskCard(t,guild) {
  const c=baseContainer(`## ${withIcon(guild,'msrp_appeal',t.type)}  ·  #${t.id}`,
    `**${txt(t.title,140)}**\n${details(t)}\n\n**Task**\n${txt(t.description,1400)}`,
    {banner:false});
  if(t.notes) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Notes / Progress**\n${txt(t.notes,900)}`));
  if(t.reviewNotes) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Management feedback**\n${txt(t.reviewNotes,900)}`));
  if(t.submission) {
    const parts = [];
    if(t.submission.link) parts.push(`**Work link:** ${t.submission.link}`);
    if(t.submission.notes) parts.push(`**Submission notes:** ${txt(t.submission.notes,500)}`);
    if(t.submission.files?.length) parts.push(`**Attachments:** ${t.submission.files.map(f=>`[${txt(f.name,45)}](${f.url})`).join(' · ')}`);
    if(parts.length) c.addTextDisplayComponents(new TextDisplayBuilder().setContent(parts.join('\n')));
  }
  const ended=['completed','cancelled','rejected'].includes(t.status);
  c.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(row(
    button(`msrp_media:status:${t.id}`,'Update Status',ButtonStyle.Secondary,ended),
    button(`msrp_media:edit:${t.id}`,'Edit Details',ButtonStyle.Secondary,ended),
    button(`msrp_media:submit:${t.id}`,'Submit Work',ButtonStyle.Primary,ended||t.status==='awaiting_review'),
    button(`msrp_media:assign:${t.id}`,'Reassign',ButtonStyle.Secondary,ended),
    button(`msrp_media:cancel:${t.id}`,'Cancel',ButtonStyle.Danger,ended)
  ));
  return finishContainer(c);
}
function reviewCard(t,guild) {
  const c=baseContainer(`## ${withIcon(guild,'msrp_information_v2','Review Finished Work')}  ·  #${t.id}`,
    `**${txt(t.title,140)}**\n**Type:** ${txt(t.type,80)}\n**Submitted by:** <@${t.assigneeId}>\n**Task status:** ${statusText(t.status)}`,
    {banner:false});
  if(t.submission) {
    const line=[t.submission.link?`**Work link:** ${t.submission.link}`:null,
      t.submission.notes?`**Notes:** ${txt(t.submission.notes,800)}`:null,
      t.submission.files?.length?`**Files:** ${t.submission.files.map(f=>`[${txt(f.name,40)}](${f.url})`).join(' · ')}`:null].filter(Boolean);
    c.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent(line.join('\n') || 'Files attached.'));
  }
  c.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(row(
    button(`msrp_media:accept:${t.id}`,'Accept Work',ButtonStyle.Success,t.status!=='awaiting_review'),
    button(`msrp_media:revise:${t.id}`,'Return Draft',ButtonStyle.Secondary,t.status!=='awaiting_review'),
    button(`msrp_media:reject:${t.id}`,'Deny Work',ButtonStyle.Danger,t.status!=='awaiting_review')
  ));
  return finishContainer(c);
}
function labelText(name,id,style=TextInputStyle.Short,{required=true,value='',max=1000}={}) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
  if(value) input.setValue(String(value).slice(0,max));
  return new LabelBuilder().setLabel(name).setTextInputComponent(input);
}
function createModal() {
  return new ModalBuilder().setCustomId('msrp_media:form:create').setTitle('Create Media Request').addLabelComponents(
    new LabelBuilder().setLabel('Request type').setStringSelectMenuComponent(
      new StringSelectMenuBuilder().setCustomId('type').setRequired(true).addOptions(
        {label:'Editing',value:'Editing'},{label:'Thumbnail',value:'Thumbnail'},
        {label:'Script',value:'Script'},{label:'Idea / Suggestion',value:'Idea / Suggestion'})),
    labelText('Task title','title',TextInputStyle.Short,{max:120}),
    labelText('What needs to be done?','description',TextInputStyle.Paragraph,{max:1600}),
    labelText('Deadline (optional)','deadline',TextInputStyle.Short,{required:false,max:80})
  );
}
function editModal(t) {
  return new ModalBuilder().setCustomId(`msrp_media:form:edit:${t.id}`).setTitle('Edit Media Task').addLabelComponents(
    labelText('Task title','title',TextInputStyle.Short,{value:t.title,max:120}),
    labelText('Task description','description',TextInputStyle.Paragraph,{value:t.description,max:1600}),
    labelText('Deadline (optional)','deadline',TextInputStyle.Short,{required:false,value:t.deadline,max:80}),
    labelText('Notes / progress','notes',TextInputStyle.Paragraph,{required:false,value:t.notes,max:900})
  );
}
function submitModal(t) {
  return new ModalBuilder().setCustomId(`msrp_media:form:submit:${t.id}`).setTitle('Submit Finished Work').addLabelComponents(
    labelText('Finished work URL (if any)','link',TextInputStyle.Short,{required:false,max:900}),
    labelText('Notes for management','notes',TextInputStyle.Paragraph,{required:false,max:800}),
    new LabelBuilder().setLabel('Finished files (optional)').setFileUploadComponent(
      new FileUploadBuilder().setCustomId('uploads').setRequired(false).setMinValues(0).setMaxValues(3))
  );
}
function reasonModal(id,action) {
  return new ModalBuilder().setCustomId(`msrp_media:form:${action}:${id}`).setTitle(action==='revise'?'Return Draft':action==='reject'?'Deny Finished Work':'Deny Request').addLabelComponents(
    labelText('Reason / feedback','reason',TextInputStyle.Paragraph,{required:true,max:800})
  );
}
function isAssignee(i,t) { return t.assigneeId===i.user.id; }
function allowedToEdit(i,t) {return isManagement(i) || isAssignee(i,t);}
function channelId(state,kind,i) { return state.config[kind] || state.config.dashboardChannelId || i.channelId; }
async function sendTo(i,id,components,opt={}) {
  const ch=await i.guild.channels.fetch(id);
  if(!ch || typeof ch.send!=='function') throw new Error('Configured channel is missing or not writable.');
  return ch.send(payload(components,opt));
}
async function refresh(i,t,kind) {
  const mid = t[`${kind}MessageId`], cid=t[`${kind}ChannelId`];
  if(!mid || !cid) return;
  const ch=await i.guild.channels.fetch(cid); const msg=await ch.messages.fetch(mid);
  const card=kind==='approval'?approvalCard(t,i.guild):kind==='review'?reviewCard(t,i.guild):taskCard(t,i.guild);
  const kept = kind==='review'
    ? Array.from(msg.attachments.values()).filter(a=>a.name?.startsWith('media-')).map(a=>({id:a.id}))
    : [];
  const fileViews = kind==='review'
    ? Array.from(msg.attachments.values()).filter(a=>a.name?.startsWith('media-')).map(a=>new FileBuilder().setURL(`attachment://${a.name}`))
    : [];
  await msg.edit({...payload([card,...fileViews],{banner:kind==='approval'}),...(kind==='review'?{attachments:kept}:{})});
}
async function tryRefresh(i,t,kind) {
  try{ await refresh(i,t,kind); }catch(e){ console.error(`[MEDIA] Could not refresh ${kind}:`,e.message); }
}
async function ephemeral(i,content,components) {
  const opts = {content,flags:MessageFlags.Ephemeral};
  if(components) opts.components=components;
  if(i.deferred||i.replied) return i.editReply({content, ...(components?{components}:{})});
  return i.reply(opts);
}
function itemLink(t) {
  return t.taskMessageId?`https://discord.com/channels/${t.guildId}/${t.taskChannelId}/${t.taskMessageId}`:null;
}
function listTasks(i,mine) {
  const all=Object.values(load().tasks).filter(t=>t.guildId===i.guildId && (mine?(t.creatorId===i.user.id||t.assigneeId===i.user.id):t.status!=='denied'))
    .sort((a,b)=>b.createdAt-a.createdAt).slice(0,15);
  if(!all.length) return 'No tasks found yet.';
  return all.map(t=>`**#${t.id} · ${txt(t.title,60)}** — ${statusText(t.status)}${itemLink(t)?` · [Open task](${itemLink(t)})`:''}`).join('\n');
}

async function handleCommand(i) {
  if(!i.isChatInputCommand() || i.commandName!=='send-media-dashboard') return false;
  await i.deferReply({flags:MessageFlags.Ephemeral});
  try {
    if(!isManagement(i)) throw new Error('Head of Media or Senior Media required.');
    const state=load(), approvals=i.options.getChannel('approvals-channel'),tasks=i.options.getChannel('tasks-channel');
    const channel=i.channel;
    if(!channel || typeof channel.send!=='function') throw new Error('Use this command in a text channel.');
    const nextConfig={
      dashboardChannelId:i.channelId,
      approvals:approvals?.id || state.config.approvals || i.channelId,
      tasks:tasks?.id || state.config.tasks || i.channelId
    };
    let posted;
    if(state.dashboard?.channelId===i.channelId && state.dashboard?.messageId) {
      try {
        const original=await channel.messages.fetch(state.dashboard.messageId);
        await original.edit(payload([dashboard(i.guild)],{banner:true}));
        posted=original;
      }catch(e){ if(e.code!==10008 && e.code!==10003) throw e; }
    }
    if(!posted) posted=await channel.send(payload([dashboard(i.guild)],{banner:true}));
    state.dashboard={channelId:i.channelId,messageId:posted.id};state.config=nextConfig;save(state);
    await i.editReply(`Media Dashboard ready: ${posted.url}\nApprovals: <#${nextConfig.approvals}> · Tasks: <#${nextConfig.tasks}>`);
  } catch(e) {await i.editReply(`Unable to send Media Dashboard: ${e.message}`).catch(()=>{});}
  return true;
}
async function handleComponent(i) {
  if(!i.customId?.startsWith('msrp_media:')) return false;
  if(!i.guild) {await ephemeral(i,'Media Dashboard only works in the server.');return true;}
  if(i.isButton() && i.customId==='msrp_media:create') {
    if(!isMedia(i)) await ephemeral(i,'Media Team role required.');
    else await i.showModal(createModal());
    return true;
  }
  if(i.isButton() && ['msrp_media:mine','msrp_media:browse'].includes(i.customId)) {
    if(!isMedia(i)) await ephemeral(i,'Media Team role required.');
    else await ephemeral(i,`**${i.customId.endsWith('mine')?'My Tasks':'Media Tasks'}**\n${listTasks(i,i.customId.endsWith('mine'))}`);
    return true;
  }
  const [prefix,action,id,modalTaskId] = i.customId.split(':');
  if(prefix!=='msrp_media' || !id) return false;
  const lookupId = action==='form' && id!=='create' ? modalTaskId : id;
  const state=load(), t=(action==='form' && id==='create') ? {guildId:i.guildId,creatorId:i.user.id} : state.tasks[lookupId];
  if(!t || t.guildId!==i.guildId) {await ephemeral(i,'Task not found.');return true;}
  if(i.isButton() && ['approve','deny','accept','revise','reject','cancel','assign','edit','submit','status'].includes(action)) {
    const mgmt=['approve','deny','accept','revise','reject','cancel','assign'].includes(action);
    if(mgmt&&!isManagement(i)) {await ephemeral(i,'Only Senior Media / Head of Media can do this.');return true;}
    if(!mgmt&&!allowedToEdit(i,t)) {await ephemeral(i,'This task is not assigned to you.');return true;}
    if(['approve','deny'].includes(action) && t.status!=='pending') {await ephemeral(i,'This request was already reviewed.');return true;}
    if(['accept','revise','reject'].includes(action) && t.status!=='awaiting_review') {await ephemeral(i,'This work is not currently awaiting review.');return true;}
    if(['edit','submit','status','assign','cancel'].includes(action) && ['completed','cancelled','denied','rejected','pending','awaiting_review'].includes(t.status)) {await ephemeral(i,'This task cannot be changed in its current state.');return true;}
    if(['deny','revise','reject'].includes(action)) {await i.showModal(reasonModal(id,action));return true;}
    if(action==='edit') {await i.showModal(editModal(t));return true;}
    if(action==='submit') {if(t.status==='awaiting_review') {await ephemeral(i,'This submission is already awaiting review.');return true;} await i.showModal(submitModal(t));return true;}
    if(action==='status') {
      await ephemeral(i,'Choose the task status:',[row(new StringSelectMenuBuilder().setCustomId(`msrp_media:selectstatus:${id}`).setPlaceholder('Update task status').addOptions(
        {label:'In Progress',value:'in_progress'},{label:'On Hold',value:'on_hold'},{label:'Not Started',value:'not_started'}))]);
      return true;
    }
    if(action==='assign') {
      await ephemeral(i,'Choose the new assigned Media Team member:',[row(new UserSelectMenuBuilder().setCustomId(`msrp_media:selectuser:${id}`).setPlaceholder('Choose a member').setMinValues(1).setMaxValues(1))]);
      return true;
    }
  }
  const key=`${i.guildId}:${lookupId}`;
  if(locks.has(key)) {await ephemeral(i,'This task is already being updated.');return true;}
  locks.add(key);
  try {
    if(i.isButton() && action==='approve') {
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const st=load(),r=st.tasks[id];if(r.status!=='pending') throw new Error('Request already processed.');
      r.status='not_started';r.assigneeId=r.creatorId;r.updatedAt=Date.now();
      const posted=await sendTo(i,channelId(st,'tasks',i),[taskCard(r,i.guild)]);
      r.taskChannelId=posted.channelId;r.taskMessageId=posted.id;save(st);
      await tryRefresh(i,r,'approval');await i.editReply(`Approved and assigned to <@${r.creatorId}>. [View task](${posted.url})`);
      return true;
    }
    if(i.isButton() && action==='accept') {
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const st=load(),r=st.tasks[id];if(r.status!=='awaiting_review') throw new Error('Not awaiting review.');
      r.status='completed';r.updatedAt=Date.now();r.reviewedBy=i.user.id;save(st);
      await Promise.all([tryRefresh(i,r,'task'),tryRefresh(i,r,'review')]);
      await i.editReply(`Task #${id} marked **Completed**.`);
      return true;
    }
    if(i.isButton() && action==='cancel') {
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const st=load(),r=st.tasks[id];if(['completed','cancelled','denied','rejected'].includes(r.status)) throw new Error('Already finalised.');
      r.status='cancelled';r.updatedAt=Date.now();save(st);
      await Promise.all([tryRefresh(i,r,'task'),tryRefresh(i,r,'review')]);
      await i.editReply(`Task #${id} cancelled.`);
      return true;
    }
    if(i.isStringSelectMenu() && action==='selectstatus') {
      if(!allowedToEdit(i,t)) throw new Error('Not your task.');
      if(['pending','denied','completed','cancelled','rejected','awaiting_review'].includes(t.status)) throw new Error('This task cannot change status now.');
      const chosen=i.values[0];if(!['not_started','in_progress','on_hold'].includes(chosen)) throw new Error('Invalid status.');
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const st=load();st.tasks[id].status=chosen;st.tasks[id].updatedAt=Date.now();save(st);
      await tryRefresh(i,st.tasks[id],'task');await i.editReply(`Updated to **${statusText(chosen)}**.`);return true;
    }
    if(i.isUserSelectMenu() && action==='selectuser') {
      if(!isManagement(i)) throw new Error('Management permission required.');
      if(['pending','denied','completed','cancelled','rejected','awaiting_review'].includes(t.status)) throw new Error('Task is no longer assignable.');
      const target=await i.guild.members.fetch(i.values[0]);
      if(![HEAD,SENIOR,MEMBER,TRIAL].some(x=>target.roles.cache.has(x))) throw new Error('Select a member of the Media Team.');
      await i.deferReply({flags:MessageFlags.Ephemeral});
      const st=load();st.tasks[id].assigneeId=target.id;st.tasks[id].updatedAt=Date.now();save(st);
      await tryRefresh(i,st.tasks[id],'task');await i.editReply(`Task #${id} assigned to <@${target.id}>.`);return true;
    }
    if(i.isModalSubmit() && action==='form') {
      const operation=id;
      const taskId=modalTaskId;
      // Modals have their own action name and task ID.
      if(operation==='create') {
        if(!isMedia(i)) throw new Error('Media Team role required.');
        await i.deferReply({flags:MessageFlags.Ephemeral});
        const st=load();const kind=i.fields.getStringSelectValues('type')?.[0];
        if(!['Editing','Thumbnail','Script','Idea / Suggestion'].includes(kind)) throw new Error('Invalid media request type.');
        const title=i.fields.getTextInputValue('title').trim();
        const description=i.fields.getTextInputValue('description').trim();
        if(!title||!description) throw new Error('A title and description are required.');
        const num=st.seq+1, keyId=String(num).padStart(4,'0');
        const r={id:keyId,guildId:i.guildId,type:kind,title,description,deadline:i.fields.getTextInputValue('deadline')?.trim()||'',
          creatorId:i.user.id,assigneeId:null,status:'pending',notes:'',reviewNotes:'',submission:null,createdAt:Date.now(),updatedAt:Date.now()};
        const posted=await sendTo(i,channelId(st,'approvals',i),[approvalCard(r,i.guild)],{banner:true});
        r.approvalChannelId=posted.channelId;r.approvalMessageId=posted.id;st.seq=num;st.tasks[keyId]=r;save(st);
        await i.editReply(`Request #${keyId} submitted to management. [View request](${posted.url})`);return true;
      }
      const st=load(),r=st.tasks[taskId];
      if(!r || r.guildId!==i.guildId) throw new Error('Task no longer exists.');
      if(['deny','revise','reject'].includes(operation)) {
        if(!isManagement(i)) throw new Error('Management permission required.');
        if(operation==='deny'&&r.status!=='pending') throw new Error('Request already reviewed.');
        if(['revise','reject'].includes(operation)&&r.status!=='awaiting_review') throw new Error('Not awaiting review.');
        await i.deferReply({flags:MessageFlags.Ephemeral});
        const reason=i.fields.getTextInputValue('reason').trim();
        if(!reason) throw new Error('Feedback required.');
        if(operation==='deny') {r.status='denied';r.denialReason=reason;}
        else {r.status=operation==='reject'?'rejected':'changes_requested';r.reviewNotes=reason;}
        r.updatedAt=Date.now();save(st);
        await Promise.all([tryRefresh(i,r,'approval'),tryRefresh(i,r,'task'),tryRefresh(i,r,'review')]);
        await i.editReply(operation==='deny'?`Request #${r.id} denied.`:operation==='reject'?`Finished work for task #${r.id} denied.`:`Task #${r.id} returned to its assignee for changes.`);return true;
      }
      if(!allowedToEdit(i,r)) throw new Error('This task is not assigned to you.');
      if(['pending','denied','completed','cancelled','rejected','awaiting_review'].includes(r.status)) throw new Error('Task is finalised, pending approval, or awaiting review.');
      if(operation==='edit') {
        await i.deferReply({flags:MessageFlags.Ephemeral});
        r.title=i.fields.getTextInputValue('title').trim();r.description=i.fields.getTextInputValue('description').trim();
        r.deadline=i.fields.getTextInputValue('deadline')?.trim()||'';r.notes=i.fields.getTextInputValue('notes')?.trim()||'';
        if(!r.title||!r.description) throw new Error('Title and description cannot be blank.');
        r.updatedAt=Date.now();save(st);await tryRefresh(i,r,'task');
        await i.editReply(`Task #${r.id} details updated.`);return true;
      }
      if(operation==='submit') {
        if(r.status==='awaiting_review') throw new Error('Work already awaiting review.');
        await i.deferReply({flags:MessageFlags.Ephemeral});
        const raw=i.fields.getTextInputValue('link')?.trim()||'';
        const link=validLink(raw);
        if(raw && !link) throw new Error('Work link must start with https:// or http://.');
        const note=i.fields.getTextInputValue('notes')?.trim()||'';
        const uploads=Array.from(i.fields.getUploadedFiles('uploads',false)?.values()||[]);
        if(!link && uploads.length===0) throw new Error('Add a link or at least one file before submitting.');
        // The earlier review message must never approve a newer submission.
        if(r.reviewMessageId) await tryRefresh(i,{...r,status:'superseded'},'review');
        r.status='awaiting_review';r.updatedAt=Date.now();
        r.submission={link,notes:note,files:uploads.map((f,j)=>({name:f.name,url:f.url,index:j}))};
        const safeUploads=uploads.map((f,j)=>({attachment:f.url,name:`media-${r.id}-${j+1}-${String(f.name).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,65)}`}));
        // Reupload files into the review channel to preserve them beyond the modal.
        const c=reviewCard(r,i.guild);
        const sent=await sendTo(i,channelId(st,'approvals',i),[c,...safeUploads.map(f=>new FileBuilder().setURL(`attachment://${f.name}`))],{extraFiles:safeUploads});
        r.submission.files=Array.from(sent.attachments.values()).filter(f=>safeUploads.some(x=>x.name===f.name)).map(f=>({name:f.name,url:f.url}));
        r.reviewChannelId=sent.channelId;r.reviewMessageId=sent.id;save(st);
        await tryRefresh(i,r,'task');await tryRefresh(i,r,'review');
        await i.editReply(`Task #${r.id} submitted for management review. [View submission](${sent.url})`);return true;
      }
    }
    await ephemeral(i,'This media action is not available.');
  } catch(e) {
    console.error('[MEDIA] Action failed:',e);
    await ephemeral(i,`Unable to update task: ${String(e.message||e).slice(0,300)}`).catch(()=>{});
  } finally{locks.delete(key);}
  return true;
}
module.exports={command,handleCommand,handleComponent};
