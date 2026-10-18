const path = require('node:path');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType,
  ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags,
  SeparatorBuilder, SlashCommandBuilder, StringSelectMenuBuilder,
  TextDisplayBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  FileBuilder
} = require('discord.js');
const { loadData, saveData, makeId } = require('./eventData');

const CHANNEL = '1547545145904472114';
const NOTIFY_ROLE = '1548805132886745159';
const STAFF_ROLE = '1558396994601615460';
const IMAGE = path.join(__dirname, '..', 'images', 'image.png');
const TZ = 'Australia/Melbourne';
const PREFIX = 'msrpev:';
const files = () => [{ attachment: IMAGE, name: 'image.png' }];
const lock = new Set();

const commands = [new SlashCommandBuilder().setName('create-event')
  .setDescription('Publish a new MSRP community event')
  .addStringOption(x => x.setName('name').setDescription('Event name').setRequired(true).setMaxLength(120))
  .addStringOption(x => x.setName('date').setDescription('DD/MM/YYYY or YYYY-MM-DD (Melbourne)').setRequired(true))
  .addStringOption(x => x.setName('time').setDescription('HH:MM, 24-hour Melbourne time').setRequired(true))
  .addStringOption(x => x.setName('description').setDescription('Event description; use \\n for new lines').setRequired(true).setMaxLength(1500))
  .addStringOption(x => x.setName('location').setDescription('Optional event location').setMaxLength(250))
  .addStringOption(x => x.setName('notes').setDescription('Optional event notes; use \\n for new lines').setMaxLength(800))
  .addChannelOption(x => x.setName('voice-chat').setDescription('Optional event voice channel').addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice))
  .addStringOption(x => x.setName('event-link').setDescription('Optional event URL (https://...)').setMaxLength(500))];

function permitted(interaction) { return Boolean(interaction.member?.roles?.cache?.has(STAFF_ROLE) || interaction.memberPermissions?.has('Administrator')); }
function fmt(v='') { return String(v).replace(/\\n/g, '\n').replace(/@everyone|@here/gi, x => x.replace('@','@\u200b')).trim(); }
function emoji(guild, name) { const e=guild?.emojis?.cache?.find(e=>e.name===name); return e ? {id:e.id,name:e.name} : undefined; }
function sep() { return new SeparatorBuilder().setDivider(true); }
function txt(s) { return new TextDisplayBuilder().setContent(s); }
function menuEvent(e, guild) {
  const c=new ContainerBuilder().setAccentColor(0x2076e8);
  c.addTextDisplayComponents(txt(`## ${e.name}`)).addSeparatorComponents(sep());
  c.addTextDisplayComponents(txt(`${e.description}\n\n<@&${NOTIFY_ROLE}>`)).addSeparatorComponents(sep());
  const dt=e.delayedNoTime ? 'Delayed' : e.timestamp ? `<t:${e.timestamp}:F>` : 'Delayed';
  const tm=e.delayedNoTime ? 'Delayed' : e.timestamp ? `<t:${e.timestamp}:t> (<t:${e.timestamp}:R>)` : 'Delayed';
  let details=`📅 **Date:** ${dt}\n🕒 **Time:** ${tm}`;
  if(e.location) details+=`\n📍 **Location:** ${e.location}`;
  if(e.voiceId) details+=`\n🎙️ **Event Chat:** <#${e.voiceId}>`;
  if(e.eventLink) details+=`\n🔗 **Event Link:** ${e.eventLink}`;
  c.addTextDisplayComponents(txt(details)).addSeparatorComponents(sep());
  if(e.notes) c.addTextDisplayComponents(txt(`-# Notes: ${e.notes}`)).addSeparatorComponents(sep());
  const buttons=[
    new ButtonBuilder().setCustomId(`${PREFIX}join:${e.id}`).setLabel(`Participants: ${(e.participants||[]).length}`).setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${PREFIX}view:${e.id}`).setLabel('View Participants').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}staff:${e.id}`).setLabel('Staff Actions').setStyle(ButtonStyle.Secondary)
  ];
  ['msrp_event','msrp_event_people','msrp_event_staff'].forEach((name,i)=>{const em=emoji(guild,name);if(em)buttons[i].setEmoji(em);});
  c.addActionRowComponents(new ActionRowBuilder().addComponents(buttons)).addSeparatorComponents(sep());
  c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
  return c;
}
function notice(e, kind) {
  const cancel=kind==='cancel';
  const c=new ContainerBuilder().setAccentColor(cancel?0xd94343:0xf6a82b);
  c.addTextDisplayComponents(txt(cancel ? `## ${e.name} Cancelled\n\nUnfortunately, due to unforeseen circumstances, this event has been cancelled.\n\nWe apologise and hope you can join us at our next event.` : `## ${e.name} Delayed\n\nPlease be aware that this event has been delayed. It has not been cancelled, and we apologise for the inconvenience.`)).addSeparatorComponents(sep());
  c.addTextDisplayComponents(txt((e.participants||[]).length ? (e.participants||[]).map(x=>`<@${x}>`).join(' ').slice(0,3500) : '*No registered participants.*')).addSeparatorComponents(sep());
  c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
  return c;
}
function started(e) {
  const c=new ContainerBuilder().setAccentColor(0x2785dc);
  c.addTextDisplayComponents(txt(`## ${e.name} Started\n\n${e.description}`)).addSeparatorComponents(sep());
  c.addTextDisplayComponents(txt(`**Participants:**\n${(e.participants||[]).length?(e.participants||[]).map(x=>`<@${x}>`).join('\n').slice(0,3100):'*No participants registered.*'}\n\n<@&${NOTIFY_ROLE}>`)).addSeparatorComponents(sep());
  let detail=''; if(e.location)detail+=`📍 **Location:** ${e.location}\n`;
  if(e.voiceId)detail+=`🎙️ **Event Chat:** <#${e.voiceId}>\n`;
  if(e.eventLink)detail+=`🔗 **Event Link:** ${e.eventLink}\n`;
  if(detail)c.addTextDisplayComponents(txt(detail)).addSeparatorComponents(sep());
  if(e.notes)c.addTextDisplayComponents(txt(`-# Notes: ${e.notes}`)).addSeparatorComponents(sep());
  c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
  return c;
}
function parseTime(date,time) {
  const dm=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  const iso=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(date);
  if(!dm&&!iso)return null;
  const y=+(dm?dm[3]:iso[1]), m=+(dm?dm[2]:iso[2]),d=+(dm?dm[1]:iso[3]);
  const tm=/^(\d{1,2}):(\d{2})$/.exec(time); if(!tm)return null;
  const hh=+tm[1],mm=+tm[2];
  if(y<2025||m<1||m>12||d<1||d>31||hh>23||mm>59)return null;
  const valid=new Date(Date.UTC(y,m-1,d));if(valid.getUTCMonth()!==m-1||valid.getUTCDate()!==d)return null;
  const parts=(t)=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(t)).map(p=>[p.type,+p.value]));
  const wanted=Date.UTC(y,m-1,d,hh,mm);let t=wanted-11*3600000;
  for(let i=0;i<3;i++){const p=parts(t);const local=Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute);t+=wanted-local;}
  const p=parts(t);if(p.year!==y||p.month!==m||p.day!==d||p.hour!==hh||p.minute!==mm)return null;
  return Math.floor(t/1000);
}
async function getEvent(id) { const data=loadData();return {data,e:data.events[id]}; }
async function updateDashboard(interaction,e) {
  const channel=await interaction.client.channels.fetch(e.channelId);
  const msg=await channel.messages.fetch(e.messageId);
  await msg.edit({components:[menuEvent(e,interaction.guild)],files:files(),allowedMentions:{parse:[]}});
}
async function executeCommand(interaction) {
  if(!interaction.isChatInputCommand()||interaction.commandName!=='create-event')return false;
  if(!permitted(interaction)) {await interaction.reply({content:'Only the Event Team can create events.',flags:MessageFlags.Ephemeral});return true;}
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const o=interaction.options;
  const date=o.getString('date'),time=o.getString('time');const timestamp=parseTime(date,time);
  if(!timestamp){await interaction.editReply('Invalid date or time. Use DD/MM/YYYY and 24-hour HH:MM in Melbourne time.');return true;}
  if(timestamp*1000<Date.now()-60000){await interaction.editReply('Please select a date and time in the future.');return true;}
  const link=o.getString('event-link');
  if(link){try{const url=new URL(link);if(!['https:','http:'].includes(url.protocol))throw Error();}catch{await interaction.editReply('Event link must begin with https:// or http://.');return true;}}
  const e={id:makeId(),name:fmt(o.getString('name')),description:fmt(o.getString('description')),location:fmt(o.getString('location')||''),notes:fmt(o.getString('notes')||''),eventLink:link||null,voiceId:o.getChannel('voice-chat')?.id||null,timestamp,participants:[],status:'scheduled',channelId:CHANNEL,messageId:null,delayMessageIds:[]};
  try {
    const channel=await interaction.client.channels.fetch(CHANNEL);
    const message=await channel.send({components:[menuEvent(e,interaction.guild)],files:files(),flags:MessageFlags.IsComponentsV2,allowedMentions:{roles:[NOTIFY_ROLE]}});
    e.messageId=message.id;
    const data=loadData();data.events[e.id]=e;saveData(data);
    await interaction.editReply(`Event created: ${message.url}`);
  }catch(err){console.error('[EVENT] Creation failed',err);await interaction.editReply('Could not publish this event. Check channel and attachment permissions.');}
  return true;
}
async function handleInteraction(interaction) {
  if(!interaction.isButton()&&!interaction.isStringSelectMenu()&&!interaction.isModalSubmit())return false;
  const id=interaction.customId||'';if(!id.startsWith(PREFIX))return false;
  const rest=id.slice(PREFIX.length);const split=rest.indexOf(':');if(split<0)return false;
  const action=rest.slice(0,split),eventId=rest.slice(split+1);
  const {data,e}=await getEvent(eventId);
  if(!e){await interaction.reply({content:'This event is no longer available.',flags:MessageFlags.Ephemeral});return true;}
  if(action==='view'){
    const ids=e.participants||[];
    await interaction.reply({content:ids.length?`**Participants (${ids.length})**\n${ids.map((x,i)=>`${i+1}. <@${x}>`).join('\n').slice(0,1900)}`:'No participants yet.',flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});return true;
  }
  if(action==='join'){
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    if(lock.has(eventId)){await interaction.editReply('Another update is in progress. Try again.');return true;}
    lock.add(eventId);
    try{
      const fresh=loadData();const item=fresh.events[eventId];if(!item||item.status!=='scheduled'){await interaction.editReply('This event is no longer open.');return true;}
      const list=item.participants||[];const idx=list.indexOf(interaction.user.id);if(idx>=0)list.splice(idx,1);else list.push(interaction.user.id);
      item.participants=list;saveData(fresh);
      try{await updateDashboard(interaction,item);}catch(err){console.warn('[EVENT] Participant dashboard update failed:',err?.message);}
      await interaction.editReply(idx>=0?'You have been removed from this event.':'You are now participating in this event!');
    }finally{lock.delete(eventId);}return true;
  }
  if(!permitted(interaction)){await interaction.reply({content:'Only Event Team staff can use these actions.',flags:MessageFlags.Ephemeral});return true;}
  if(action==='staff'){
    const row=new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`${PREFIX}choose:${eventId}`).setPlaceholder('Select an event action').addOptions([
      {label:'Start Event',value:'start',description:'Publish the event start notification'},
      {label:'Cancel Event',value:'cancel',description:'Cancel and notify participants'},
      {label:'Delay Event',value:'delay',description:'Change date/time or mark as delayed'}
    ]));
    await interaction.reply({content:'**Event Actions**\nManage this event. Actions only affect this event and its registered participants.',components:[row],flags:MessageFlags.Ephemeral});return true;
  }
  if(action==='choose'){
    const chosen=interaction.values[0];
    if(chosen==='delay'){
      const modal=new ModalBuilder().setCustomId(`${PREFIX}delay:${eventId}`).setTitle('Delay event');
      modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('date').setLabel('New date (optional) DD/MM/YYYY').setStyle(TextInputStyle.Short).setRequired(false)),new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('time').setLabel('New time (optional) HH:MM').setStyle(TextInputStyle.Short).setRequired(false)));
      await interaction.showModal(modal);return true;
    }
    if(!['start','cancel'].includes(chosen)){await interaction.reply({content:'Invalid action.',flags:MessageFlags.Ephemeral});return true;}
    return transition(interaction,eventId,chosen);
  }
  if(action==='delay'){
    const date=interaction.fields.getTextInputValue('date')?.trim()||'';
    const time=interaction.fields.getTextInputValue('time')?.trim()||'';
    if(Boolean(date)!==Boolean(time)){await interaction.reply({content:'Please provide both a new date and time, or leave both blank to show Delayed.',flags:MessageFlags.Ephemeral});return true;}
    const stamp=date?parseTime(date,time):null;
    if(date&&!stamp){await interaction.reply({content:'Invalid date/time. Use DD/MM/YYYY and HH:MM.',flags:MessageFlags.Ephemeral});return true;}
    return transition(interaction,eventId,'delay',stamp);
  }
  return false;
}
async function transition(interaction,eventId,kind,newTime=null){
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  if(lock.has(eventId)){await interaction.editReply('Another action is in progress. Try again.');return true;}
  lock.add(eventId);
  try{
    const data=loadData(),e=data.events[eventId];
    if(!e||e.status!=='scheduled'){await interaction.editReply('This event has already started or been cancelled.');return true;}
    const ch=await interaction.client.channels.fetch(e.channelId);
    const parent=await ch.messages.fetch(e.messageId);
    if(kind==='delay'){
      // Reply before changing the dashboard so the notice stays linked to this event.
      const noticeMsg=await parent.reply({components:[notice(e,'delay')],flags:MessageFlags.IsComponentsV2,files:files(),allowedMentions:{users:(e.participants||[]).slice(0,100),parse:[]}});
      e.delayMessageIds=(e.delayMessageIds||[]).concat(noticeMsg.id);
      e.delayedNoTime=!newTime;if(newTime)e.timestamp=newTime;
      data.events[eventId]=e;saveData(data);
      await parent.edit({components:[menuEvent(e,interaction.guild)],files:files(),allowedMentions:{parse:[]}});
      await interaction.editReply('Event delayed. Participants have been notified.');return true;
    }
    const message=await parent.reply({components:[kind==='cancel'?notice(e,'cancel'):started(e)],flags:MessageFlags.IsComponentsV2,files:files(),allowedMentions:{users:(e.participants||[]).slice(0,100),roles:kind==='start'?[NOTIFY_ROLE]:[],parse:[]}});
    e.status=kind==='cancel'?'cancelled':'started';e.finalMessageId=message.id;data.events[eventId]=e;saveData(data);
    await Promise.allSettled([parent.delete(),...((e.delayMessageIds||[]).map(id=>ch.messages.delete(id)))]);
    await interaction.editReply(`Event ${kind==='cancel'?'cancelled':'started'} successfully.`);
  }catch(err){console.error('[EVENT] Action failed',err);await interaction.editReply('Could not complete this action. Please check permissions and try again.');}
  finally{lock.delete(eventId);}return true;
}
async function handleAutocomplete(){return false;}
function startEventMonitor(){console.log('[EVENT] No event polling required. Native Discord polls are used for voting.');}
module.exports={commands,executeCommand,handleInteraction,handleAutocomplete,startEventMonitor};
