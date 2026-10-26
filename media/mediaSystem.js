'use strict';
// MSRP Media Project Manager v2. Existing prototype data is left untouched.
const fs=require('node:fs');
const path=require('node:path');
const {
 SlashCommandBuilder,MessageFlags,AttachmentBuilder,ContainerBuilder,TextDisplayBuilder,
 MediaGalleryBuilder,MediaGalleryItemBuilder,SeparatorBuilder,ActionRowBuilder,
 ButtonBuilder,ButtonStyle,ModalBuilder,LabelBuilder,TextInputBuilder,
 TextInputStyle,StringSelectMenuBuilder,UserSelectMenuBuilder,FileUploadBuilder
}=require('discord.js');
const PROJECT_CHANNEL='1564222211802398740';
const APPROVAL_CHANNEL='1564222450147790930';
const ROLES={head:'1550808851538780160',senior:'1564210385903419503',member:'1558399994267176991',trial:'1550809222520770613',founder:'1547525713853288448'};
const TYPES=['Video Script','Video Editing','Video (Final Submission)','Image (Logo/Banner)','Image (In-Game Media)','Other'];
const FILE=path.join(__dirname,'mediaProjects.runtime.json');
const BANNER=path.join(__dirname,'..','images','ticket-dashboard.png');
const FOOTER=path.join(__dirname,'..','images','image.png');
const locks=new Set();
const command=new SlashCommandBuilder().setName('send-media-dashboard').setDescription('Post or refresh the Media Project Manager.');
function initial(){return {sequence:0,projects:{},dashboard:null};}
function load(){try{const x=JSON.parse(fs.readFileSync(FILE,'utf8'));return {...initial(),...x,projects:x.projects||{}};}catch(e){if(e.code==='ENOENT')return initial();throw e;}}
function save(x){fs.mkdirSync(path.dirname(FILE),{recursive:true});const tmp=FILE+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(x,null,2));fs.renameSync(tmp,FILE);}
function management(i){return Boolean(i.memberPermissions?.has('Administrator')||[ROLES.founder,ROLES.head,ROLES.senior].some(r=>i.member?.roles?.cache?.has(r)));}
function media(i){return management(i)||[ROLES.member,ROLES.trial].some(r=>i.member?.roles?.cache?.has(r));}
function icon(g,n){const e=g?.emojis?.cache?.find(x=>x.name===n&&x.available!==false);return e?e.toString()+' ':'';}
function safe(s,n=1200){const x=String(s??'').trim().replace(/@/g,'@\u200b').replace(/<(?=[@!#&])/g,'<\u200b').replace(/([\\*_~`|])/g,'\\$1');return (x||'—').slice(0,n);}
function status(s){return ({pending:'Pending Approval',denied:'Denied',not_started:'Not Started',in_progress:'In Progress',on_hold:'On Hold',awaiting_review:'Awaiting Review',changes_requested:'Changes Requested',completed:'Completed',cancelled:'Cancelled'})[s]||s;}
function colour(s){return ({pending:0xE4AC36,denied:0xCF4C56,not_started:0x737D8B,in_progress:0x4389DA,on_hold:0xE4AC36,awaiting_review:0x9366CE,changes_requested:0xDC8D33,completed:0x38A66A,cancelled:0xCF4C56})[s]||0x737D8B;}
function gallery(n){return new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${n}`));}
function row(...components){return new ActionRowBuilder().addComponents(...components);}
function btn(id,label,style=ButtonStyle.Secondary,disabled=false){return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);}
function buttonRow(...items){return row(...items);}
function base({banner=false,accent=null}={}){const c=new ContainerBuilder();if(accent!==null)c.setAccentColor(accent);if(banner)c.addMediaGalleryComponents(gallery('ticket-dashboard.png')).addSeparatorComponents(new SeparatorBuilder());return c;}
function finish(c){return c.addSeparatorComponents(new SeparatorBuilder()).addMediaGalleryComponents(gallery('image.png'));}
function section(c,t){c.addTextDisplayComponents(new TextDisplayBuilder().setContent(t));return c;}
function files(banner=false){return [...(banner?[new AttachmentBuilder(BANNER,{name:'ticket-dashboard.png'})]:[]),new AttachmentBuilder(FOOTER,{name:'image.png'})];}
function sendPayload(c,{banner=false,roleIds=[]}={}){return {components:[c],files:files(banner),flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[],users:[],roles:roleIds}};}
function cards(g){
 const c=base({banner:true});
 section(c,`## ${icon(g,'msrp_appeal')}Media Project Manager\nThis dashboard is where the Media Team can log the projects they are working on, track their progress and manage their submissions.`);
 c.addSeparatorComponents(new SeparatorBuilder());
 c.addActionRowComponents(buttonRow(
  btn('msrpm:active','View Active Projects',ButtonStyle.Secondary),
  btn('msrpm:mine','View My Tasks',ButtonStyle.Secondary)
 ));
 c.addActionRowComponents(row(new StringSelectMenuBuilder()
  .setCustomId('msrpm:dashboard:actions')
  .setPlaceholder('Project Actions')
  .addOptions([
   {label:'Start a New Project',value:'new',description:'Create a project for management approval'},
   {label:'View Completed Projects',value:'completed',description:'View finished projects and their evidence'},
   {label:'Management Overview',value:'overview',description:'Filter projects by status (management only)'}
  ])));
 return finish(c);
}
function projectText(p){return [`**Project:** ${safe(p.title,120)}`,`**Type:** ${safe(p.type,60)}`,`**Created by:** <@${p.creator}>`,`**Assigned to:** <@${p.assignee}>`,`**Status:** ${status(p.status)}`,`**Submission date:** ${safe(p.deadline,30)}`,``,`**Description**`,safe(p.description,1400),...(p.notes?[``,`**Project Notes**`,safe(p.notes,650)]:[])].join('\n');}
function evidenceText(p){const s=p.submission;if(!s)return '';const pieces=[];if(s.link)pieces.push(`**Submission link:** ${safe(s.link,850)}`);if(s.files?.length)pieces.push(`**Attachments:** ${s.files.map(f=>`[${safe(f.name,60)}](${f.url})`).join(' · ')}`);if(s.notes)pieces.push(`**Submission notes:** ${safe(s.notes,900)}`);return pieces.join('\n\n');}
function approvalCard(p,g){const c=base({accent:colour(p.status),banner:true});
 if(p.status==='completed'){
  section(c,`## ${icon(g,'msrp_appeal')}Completed Media Project  ·  #${p.id}\n**${safe(p.title,120)}**`);
  c.addSeparatorComponents(new SeparatorBuilder());section(c,`**Completed by:** <@${p.assignee}>\n**Approved by:** <@${p.reviewedBy}>\n**Type:** ${safe(p.type,80)}\n**Completed:** <t:${Math.floor(p.completedAt/1000)}:f>`);
  c.addSeparatorComponents(new SeparatorBuilder());section(c,`**Description**\n${safe(p.description,1400)}`);
  if(evidenceText(p))c.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent(evidenceText(p)));
  return finish(c);
 }
 section(c,`## ${icon(g,'msrp_appeal')}Media Project  ·  #${p.id}\n${projectText(p)}`);
 if(p.feedback)c.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Management Feedback**\n${safe(p.feedback,750)}`));
 if(p.status==='awaiting_review'&&evidenceText(p))c.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent(evidenceText(p)));
 c.addSeparatorComponents(new SeparatorBuilder());
 if(p.status==='pending')c.addActionRowComponents(buttonRow(btn(`msrpm:approve:${p.id}`,'Approve',ButtonStyle.Success),btn(`msrpm:deny:${p.id}`,'Deny',ButtonStyle.Danger)));
 else if(p.status==='awaiting_review')c.addActionRowComponents(buttonRow(btn(`msrpm:accept:${p.id}`,'Accept Work',ButtonStyle.Success),btn(`msrpm:revise:${p.id}`,'Return Draft'),btn(`msrpm:denywork:${p.id}`,'Reject Work',ButtonStyle.Danger)));
 else if(!['completed','denied','cancelled'].includes(p.status))c.addActionRowComponents(buttonRow(btn(`msrpm:edit:${p.id}`,'Edit Details'),btn(`msrpm:status:${p.id}`,'Update Status'),btn(`msrpm:assign:${p.id}`,'Reassign')));
 return finish(c);
}
function smallCard(p,g,canEdit=false){const c=base({accent:colour(p.status)});section(c,`## ${icon(g,'msrp_appeal')}${safe(p.title,110)}  ·  #${p.id}\n${projectText(p)}`);
 if(p.feedback)section(c,`**Management Feedback**\n${safe(p.feedback,700)}`);
 if(p.status==='completed'&&evidenceText(p)){c.addSeparatorComponents(new SeparatorBuilder());section(c,evidenceText(p));}
 if(p.status==='pending')section(c,'-# Waiting for management approval. Project controls are unavailable.');
 else if(canEdit&&!['denied','cancelled','completed','awaiting_review'].includes(p.status)){
 c.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(buttonRow(btn(`msrpm:status:${p.id}`,'Update Status'),btn(`msrpm:edit:${p.id}`,'Edit Details'),btn(`msrpm:submit:${p.id}`,'Submit Project',ButtonStyle.Primary)));
 }
 return finish(c);
}
function label(name,id,style=TextInputStyle.Short,required=true,value='',max=1000){const x=new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);if(value)x.setValue(String(value).slice(0,max));return new LabelBuilder().setLabel(name).setTextInputComponent(x);}
function typeLabel(selected){const sel=new StringSelectMenuBuilder().setCustomId('type').setRequired(true).addOptions(TYPES.map(t=>({label:t,value:t,default:t===selected})));return new LabelBuilder().setLabel('Project type').setStringSelectMenuComponent(sel);}
function createModal(p=null){return new ModalBuilder().setCustomId(p?`msrpm:form:edit:${p.id}`:'msrpm:form:new').setTitle(p?'Edit Media Project':'New Media Project').addLabelComponents(label('Project name','title',TextInputStyle.Short,true,p?.title,120),label('Project description','description',TextInputStyle.Paragraph,true,p?.description,1600),typeLabel(p?.type),label('Submission date (DD/MM/YY)','deadline',TextInputStyle.Short,true,p?.deadline,10),label('Notes (optional)','notes',TextInputStyle.Paragraph,false,p?.notes,800));}
function submissionModal(p){return new ModalBuilder().setCustomId(`msrpm:form:submit:${p.id}`).setTitle('Submit Project Work').addLabelComponents(label('Work link (optional)','link',TextInputStyle.Short,false,'',900),label('Submission notes (optional)','notes',TextInputStyle.Paragraph,false,'',900),new LabelBuilder().setLabel('Attach finished files (optional)').setFileUploadComponent(new FileUploadBuilder().setCustomId('uploads').setRequired(false).setMinValues(0).setMaxValues(3)));}
function reasonModal(p,op){return new ModalBuilder().setCustomId(`msrpm:form:${op}:${p.id}`).setTitle(op==='revise'?'Return for Changes':op==='deny'?'Deny Project':'Reject Submission').addLabelComponents(label('Reason / feedback','reason',TextInputStyle.Paragraph,true,'',800));}
function dateCheck(value){const match=/^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(value);if(!match)throw Error('Submission date must use DD/MM/YY.');let y=Number(match[3]);if(y<100)y+=2000;const d=new Date(Date.UTC(y,Number(match[2])-1,Number(match[1])));if(d.getUTCFullYear()!==y||d.getUTCMonth()+1!==Number(match[2])||d.getUTCDate()!==Number(match[1]))throw Error('Submission date is not valid.');return value;}
function link(s){if(!s)return '';try{const u=new URL(s);if(['http:','https:'].includes(u.protocol))return u.href;}catch{}throw Error('Work link must begin with https:// or http://.');}
function log(p,actor,event){(p.history??=[]).push({at:Date.now(),by:actor,event});p.updatedAt=Date.now();}
async function channel(i,id){const c=await i.guild.channels.fetch(id);if(!c||!c.isTextBased()||typeof c.send!=='function')throw Error('Media channel unavailable or bot cannot post there.');return c;}
async function sync(i,p){if(!p.approvalMessageId)return;try{const c=await channel(i,APPROVAL_CHANNEL);const m=await c.messages.fetch(p.approvalMessageId);await m.edit(sendPayload(approvalCard(p,i.guild),{banner:true}));}catch(e){console.error('[MEDIA] Failed to refresh project #'+p.id,e);throw new Error('Project saved, but its management message could not be refreshed. Check channel permissions.');}}
async function respond(i,msg){if(i.deferred||i.replied)return i.editReply({content:msg});return i.reply({content:msg,flags:MessageFlags.Ephemeral});}
async function defer(i){if(!i.deferred&&!i.replied)await i.deferReply({flags:MessageFlags.Ephemeral});}
function mineList(i,mode='mine'){
 const own=p=>p.creator===i.user.id || p.assignee===i.user.id;
 const active=new Set(['not_started','in_progress','on_hold','changes_requested','awaiting_review']);
 return Object.values(load().projects)
  .filter(p=>p.guildId===i.guildId && (
   mode==='completed' ? p.status==='completed' :
   mode==='active' ? p.assignee===i.user.id && active.has(p.status) :
   own(p) && p.status!=='completed'
  ))
  .sort((a,b)=>b.updatedAt-a.updatedAt);
}
function overviewPicker(i,filter='all'){
 const items=Object.values(load().projects).filter(p=>p.guildId===i.guildId && (filter==='all'?p.status!=='completed':p.status===filter)).sort((a,b)=>b.updatedAt-a.updatedAt);
 const c=base({banner:false});
 section(c,`## Management Overview\n**Filter:** ${filter==='all'?'All open projects':status(filter)}\n**Matching projects:** ${items.length}`);
 const filters=['all','pending','not_started','in_progress','on_hold','awaiting_review','changes_requested'];
 c.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(row(new StringSelectMenuBuilder()
  .setCustomId('msrpm:filter:0')
  .setPlaceholder('Filter projects by status')
  .addOptions(filters.map(x=>({label:x==='all'?'All Open Projects':status(x),value:x,default:x===filter})))));
 if(items.length)c.addActionRowComponents(row(new StringSelectMenuBuilder()
  .setCustomId('msrpm:pickmanage:0')
  .setPlaceholder('Select project to manage')
  .addOptions(items.slice(0,25).map(p=>({label:p.title.slice(0,90),value:p.id,description:`#${p.id} · ${status(p.status)}`.slice(0,100)})))));
 if(!items.length)section(c,'-# No projects match this filter.');
 if(items.length>25)section(c,'-# Showing the 25 most recently updated matching projects.');
 return finish(c);
}
function picker(i,mode='mine'){
 const arr=mineList(i,mode);
 const c=base({banner:true});
 const completed=mode==='completed';
 section(c,completed
  ? '## Completed Media Projects\nSelect a finished project to view its details, evidence and completion notes.'
  : mode==='active'
  ? '## My Active Projects\nSelect a project assigned to you. Pending projects are shown under View My Tasks.'
  : '## My Media Tasks\nView your projects, including those still waiting for management approval.');
 if(!arr.length)section(c,completed?'No completed projects yet.':mode==='active'?'You have no active assigned projects.':'You have no projects yet.');
 else {
  const opts=arr.slice(0,25).map(p=>({label:p.title.slice(0,90),value:p.id,description:(`#${p.id} · ${status(p.status)}`).slice(0,100)}));
  const pickerAction=completed?'pickdone':mode==='active'?'pickactive':'pickmine';
  c.addSeparatorComponents(new SeparatorBuilder()).addActionRowComponents(row(new StringSelectMenuBuilder()
   .setCustomId(`msrpm:${pickerAction}:0`)
   .setPlaceholder(completed?'Select a completed project':mode==='active'?'Select an active project':'Select your project')
   .addOptions(opts)));
 }
 if(arr.length>25)section(c,'-# Showing the 25 most recently updated projects.');
 return finish(c);
}
async function componentReply(i,c,banner=false){return i.reply({...sendPayload(c,{banner}),flags:MessageFlags.IsComponentsV2|MessageFlags.Ephemeral});}
async function handleCommand(i){if(!i.isChatInputCommand()||i.commandName!==command.name)return false;if(!management(i)){await respond(i,'Foundership or Media management permission required.');return true;}await defer(i);try{const c=await channel(i,PROJECT_CHANNEL),s=load();let msg;if(s.dashboard?.messageId){try{const existing=await c.messages.fetch(s.dashboard.messageId);msg=await existing.edit(sendPayload(cards(i.guild),{banner:true}));}catch(e){if(![10008,10003].includes(e.code))throw e;}}if(!msg)msg=await c.send(sendPayload(cards(i.guild),{banner:true}));s.dashboard={messageId:msg.id,channelId:c.id};save(s);await i.editReply(`Media Project Manager ready: ${msg.url}`);}catch(e){await i.editReply(`Unable to post dashboard: ${e.message}`);}return true;}
async function handleComponent(i){if(!i.customId?.startsWith('msrpm:'))return false;if(!i.guild){await respond(i,'Server only.');return true;}
 const bits=i.customId.split(':'),action=bits[1],id=bits[2];
 try{
 if(i.isStringSelectMenu()&&action==='dashboard'){
  if(!media(i))throw Error('Media Team role required.');
  const choice=i.values[0];
  if(choice==='new')await i.showModal(createModal());
  else if(choice==='completed')await componentReply(i,picker(i,'completed'),true);
  else if(choice==='overview'){
   if(!management(i))throw Error('Management access required.');
   await componentReply(i,overviewPicker(i),false);
  }else throw Error('Unknown dashboard action.');
  return true;
 }
 // Keep the previous button IDs working if someone presses a cached old dashboard.
 if(i.isButton()&&action==='new'){if(!media(i))throw Error('Media Team role required.');await i.showModal(createModal());return true;}
 if(i.isButton()&&action==='overview'){if(!management(i))throw Error('Management access required.');await componentReply(i,overviewPicker(i),false);return true;}
 if(i.isStringSelectMenu()&&action==='filter'){if(!management(i))throw Error('Management access required.');await componentReply(i,overviewPicker(i,i.values[0]),false);return true;}
 if(i.isButton()&&['active','mine','completed'].includes(action)){
  if(!media(i))throw Error('Media Team role required.');
  await componentReply(i,picker(i,action==='completed'?'completed':action==='active'?'active':'mine'),true);
  return true;
 }
 if(i.isStringSelectMenu()&&['pickactive','pickmine','pickdone','pickmanage'].includes(action)){
  const p=load().projects[i.values[0]];
  if(!p||p.guildId!==i.guildId)throw Error('Project not found.');
  if(!media(i))throw Error('Media Team role required.');
  if(action==='pickmanage'&&!management(i))throw Error('Management access required.');
  if(action==='pickmine'&&p.creator!==i.user.id&&p.assignee!==i.user.id)throw Error('This is not your project.');
  if(action==='pickactive'&&(p.assignee!==i.user.id||!['not_started','in_progress','on_hold','changes_requested','awaiting_review'].includes(p.status)))throw Error('This project is no longer in your active list.');
  if(action==='pickdone'&&p.status!=='completed')throw Error('This is not a completed project.');
  await componentReply(i,action==='pickmanage'?approvalCard(p,i.guild):smallCard(p,i.guild,p.assignee===i.user.id||management(i)),action==='pickmanage');
  return true;
 }
 const p=load().projects[action==='form'&&id!=='new'?bits[3]:id];if(!(action==='form'&&id==='new')&&(!p||p.guildId!==i.guildId))throw Error('Project not found.');
 if(i.isButton()){
  if(['approve','deny','accept','revise','denywork','assign'].includes(action)&&!management(i))throw Error('Media management role required.');
  if(['status','edit','submit'].includes(action)&&p.assignee!==i.user.id&&!management(i))throw Error('Only the assigned project member may make this change.');
  if(['approve','deny'].includes(action)&&p.status!=='pending')throw Error('Project has already been reviewed.');
  if(['accept','revise','denywork'].includes(action)&&p.status!=='awaiting_review')throw Error('No submission is awaiting review.');
  if(['status','edit','submit','assign'].includes(action)&&['pending','denied','cancelled','completed','awaiting_review'].includes(p.status))throw Error('This project cannot be changed in its current status.');
  if(['deny','revise','denywork'].includes(action)){await i.showModal(reasonModal(p,action));return true;}
  if(action==='edit'){await i.showModal(createModal(p));return true;}
  if(action==='submit'){await i.showModal(submissionModal(p));return true;}
  if(action==='status'){await i.reply({content:'Choose the new project status:',components:[row(new StringSelectMenuBuilder().setCustomId(`msrpm:selectstatus:${id}`).setPlaceholder('Update status').addOptions([{label:'Not Started',value:'not_started'},{label:'In Progress',value:'in_progress'},{label:'On Hold',value:'on_hold'},{label:'Cancel Project',value:'cancelled'}]))],flags:MessageFlags.Ephemeral});return true;}
  if(action==='assign'){await i.reply({content:'Choose a Media Team member to reassign this project to:',components:[row(new UserSelectMenuBuilder().setCustomId(`msrpm:selectuser:${id}`).setPlaceholder('Choose new owner').setMinValues(1).setMaxValues(1))],flags:MessageFlags.Ephemeral});return true;}
 }
 const key=i.guildId+':'+(id==='new'?'create:'+i.user.id:id);if(locks.has(key))throw Error('This project is being updated.');locks.add(key);
 try{
 if(i.isModalSubmit()&&action==='form'&&id==='new'){
  if(!media(i))throw Error('Media Team role required.');await defer(i);const title=i.fields.getTextInputValue('title').trim(),description=i.fields.getTextInputValue('description').trim(),type=i.fields.getStringSelectValues('type')[0],deadline=dateCheck(i.fields.getTextInputValue('deadline').trim()),notes=i.fields.getTextInputValue('notes')?.trim()||'';
  if(!title||!description||!TYPES.includes(type))throw Error('Project name, description and type are required.');const state=load(),seq=state.sequence+1,pid=String(seq).padStart(4,'0');const obj={id:pid,guildId:i.guildId,title,description,type,deadline,notes,creator:i.user.id,assignee:i.user.id,status:'pending',submission:null,feedback:'',createdAt:Date.now(),updatedAt:Date.now(),history:[]};log(obj,i.user.id,'Project created; approval requested');const c=await channel(i,APPROVAL_CHANNEL);const m=await c.send(sendPayload(approvalCard(obj,i.guild),{banner:true}));obj.approvalMessageId=m.id;state.sequence=seq;state.projects[pid]=obj;save(state);await i.editReply(`Project **#${pid}** submitted for approval. It is visible under **My Projects** but cannot be edited until approved. [View review log](${m.url})`);return true;
 }
 if(i.isButton()&&['approve','accept'].includes(action)){
  await defer(i);const s=load(),r=s.projects[id],expected=action==='approve'?'pending':'awaiting_review';if(r.status!==expected)throw Error('Project status has already changed.');if(!management(i))throw Error('Management permission required.');if(action==='approve'){r.status='not_started';log(r,i.user.id,'Project approved');}else{r.status='completed';r.reviewedBy=i.user.id;r.completedAt=Date.now();log(r,i.user.id,'Finished work accepted');}save(s);await sync(i,r);await i.editReply(action==='approve'?`Project #${id} approved and assigned to <@${r.assignee}>.`:`Project #${id} marked complete; permanent completion log updated.`);return true;
 }
 if(i.isStringSelectMenu()&&action==='selectstatus'){
  if(p.assignee!==i.user.id&&!management(i))throw Error('Not your project.');if(['pending','denied','cancelled','completed','awaiting_review'].includes(p.status))throw Error('Project locked.');const next=i.values[0];if(!['not_started','in_progress','on_hold','cancelled'].includes(next))throw Error('Unknown status.');await defer(i);const s=load(),r=s.projects[id];if(['pending','denied','cancelled','completed','awaiting_review'].includes(r.status))throw Error('Project locked.');r.status=next;log(r,i.user.id,'Status changed to '+next);save(s);await sync(i,r);await i.editReply(`Project #${id} changed to **${status(next)}**.`);return true;
 }
 if(i.isUserSelectMenu()&&action==='selectuser'){
  if(!management(i))throw Error('Media management role required.');if(['pending','denied','cancelled','completed','awaiting_review'].includes(p.status))throw Error('Project locked.');const target=await i.guild.members.fetch(i.values[0]);if(!Object.values(ROLES).some(r=>target.roles.cache.has(r))&&!target.permissions.has('Administrator'))throw Error('Please select a Media Team member.');await defer(i);const s=load(),r=s.projects[id];r.assignee=target.id;log(r,i.user.id,'Reassigned to '+target.id);save(s);await sync(i,r);await i.editReply(`Project #${id} assigned to <@${target.id}>.`);return true;
 }
 if(i.isModalSubmit()&&action==='form'){
  const op=id,pid=bits[3],s=load(),r=s.projects[pid];if(!r||r.guildId!==i.guildId)throw Error('Project no longer exists.');const owner=r.assignee===i.user.id;
  if(['deny','revise','denywork'].includes(op)){
   if(!management(i))throw Error('Management permission required.');if(op==='deny'&&r.status!=='pending')throw Error('Project already reviewed.');if(op!=='deny'&&r.status!=='awaiting_review')throw Error('Submission not pending.');const reason=i.fields.getTextInputValue('reason').trim();if(!reason)throw Error('A reason is required.');await defer(i);r.feedback=reason;r.status=op==='deny'||op==='denywork'?'denied':'changes_requested';log(r,i.user.id,`${op}: ${reason}`);save(s);await sync(i,r);await i.editReply(`Project #${pid} ${op==='revise'?'sent back for changes':'denied'}.`);return true;
  }
  if(!owner&&!management(i))throw Error('This project is not assigned to you.');if(['pending','denied','cancelled','completed','awaiting_review'].includes(r.status))throw Error('Project locked.');
  if(op==='edit'){
   const title=i.fields.getTextInputValue('title').trim(),description=i.fields.getTextInputValue('description').trim(),type=i.fields.getStringSelectValues('type')[0],deadline=dateCheck(i.fields.getTextInputValue('deadline').trim()),notes=i.fields.getTextInputValue('notes')?.trim()||'';if(!title||!description||!TYPES.includes(type))throw Error('Missing project information.');await defer(i);Object.assign(r,{title,description,type,deadline,notes});log(r,i.user.id,'Project details edited');save(s);await sync(i,r);await i.editReply(`Project #${pid} details updated.`);return true;
  }
  if(op==='submit'){
   const raw=i.fields.getTextInputValue('link')?.trim()||'',url=link(raw),note=i.fields.getTextInputValue('notes')?.trim()||'',up=Array.from(i.fields.getUploadedFiles('uploads',false)?.values()||[]);if(!url&&!up.length)throw Error('Please provide a finished-work link or attachment.');await defer(i);
   // Mirror uploaded files into the permanent approval log before storing their URLs.
   const c=await channel(i,APPROVAL_CHANNEL);const uploaded=[];if(up.length){const names=up.map((a,j)=>`msrpm-${pid}-${j+1}-${String(a.name).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,60)}`);const attachmentMessage=await c.send({content:`Project #${pid} — submission attachments`,files:up.map((f,j)=>({attachment:f.url,name:names[j]})),allowedMentions:{parse:[]}});for(const f of attachmentMessage.attachments.values())uploaded.push({name:f.name,url:f.url});}
   r.submission={link:url,notes:note,files:uploaded,submittedBy:i.user.id,submittedAt:Date.now()};r.status='awaiting_review';log(r,i.user.id,'Submitted completed work for review');save(s);await sync(i,r);await i.editReply(`Project #${pid} submitted for management review.`);return true;
  }
 }
 await respond(i,'This action is no longer available.');return true;
 }finally{locks.delete(key);}
 }catch(e){console.error('[MEDIA PROJECTS] Interaction error:',e);await respond(i,`Unable to update project: ${String(e.message||e).slice(0,300)}`).catch(()=>{});return true;}
}
module.exports={command,handleCommand,handleComponent};
