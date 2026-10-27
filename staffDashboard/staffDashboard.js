'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, AttachmentBuilder, MessageFlags} = require('discord.js');

const CHANNEL_ID = '1563417785332277288';
const DATA_PATH = path.join(__dirname, 'staffGuides.json');
const BANNER = path.join(__dirname, '..', 'images', 'ticket-dashboard.png');
const FOOTER = path.join(__dirname, '..', 'images', 'image.png');
const BUTTON_1 = 'https://www.roblox.com/share/g/621010341';
const BUTTON_2 = 'https://melon.ly/join/UNWVBJ';
const MENU_ID = 'msrp_staff_guides';

const commands = [
  new SlashCommandBuilder().setName('send-staff-dashboard').setDescription('Post or refresh the staff information dashboard.'),
  new SlashCommandBuilder().setName('add-staff-guide').setDescription('Add a guide to the staff dashboard.')
    .addStringOption(o=>o.setName('guide-name').setDescription('Name shown in the Guides dropdown').setMaxLength(90).setRequired(true))
    .addStringOption(o=>o.setName('guide-link').setDescription('Guide URL (https://)').setRequired(true)),
  new SlashCommandBuilder().setName('remove-staff-guide').setDescription('Remove a guide from the staff dashboard.')
    .addStringOption(o=>o.setName('guide').setDescription('Choose a guide').setAutocomplete(true).setRequired(true))
];

function load() {
  try {
    const obj=JSON.parse(fs.readFileSync(DATA_PATH,'utf8'));
    return {guides:Array.isArray(obj.guides)?obj.guides:[], messageId:obj.messageId||null};
  } catch(e) { if(e.code!=='ENOENT') console.error('[STAFF DASHBOARD] Data read error:',e); return {guides:[],messageId:null}; }
}
function save(data) {
  fs.mkdirSync(path.dirname(DATA_PATH),{recursive:true});
  const temp=`${DATA_PATH}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(data,null,2));
  fs.renameSync(temp,DATA_PATH);
}
function safeUrl(raw) {
  try { const url=new URL(raw); if(url.protocol!=='https:' && url.protocol!=='http:') return null; if(!url.hostname.includes('.')) return null; return url.toString(); } catch {return null;}
}
function emoji(guild,name,fallback) {
  const e=guild?.emojis?.cache?.find?.(x=>x.name===name);
  return e ? `<${e.animated?'a':''}:${e.name}:${e.id}>` : fallback;
}
function layout(guild,guides) {
  const people=guild?.emojis?.cache?.find(x=>x.name==='msrp_event_people');
  const chain=guild?.emojis?.cache?.find(x=>x.name==='msrp_chain');
  const whiteGroup=new ButtonBuilder().setLabel('Whitelisted Group').setStyle(ButtonStyle.Link).setURL(BUTTON_1)
    .setEmoji(people ? {id:people.id,name:people.name,animated:people.animated} : '👥');
  const melony=new ButtonBuilder().setLabel('Melony Dashboard').setStyle(ButtonStyle.Link).setURL(BUTTON_2)
    .setEmoji(chain ? {id:chain.id,name:chain.name,animated:chain.animated} : '🔗');
  const links=new ActionRowBuilder().addComponents(whiteGroup,melony);
  const menu=new StringSelectMenuBuilder().setCustomId(MENU_ID).setPlaceholder('Guides')
    .addOptions(guides.length ? guides.map((g,i)=>new StringSelectMenuOptionBuilder().setLabel(g.name.slice(0,100)).setValue(String(i))) : [new StringSelectMenuOptionBuilder().setLabel('No guides available yet').setValue('empty')]);
  if(!guides.length) menu.setDisabled(true);
  return new ContainerBuilder()
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://ticket-dashboard.png')))
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(links)
    .addSeparatorComponents(new SeparatorBuilder())
    .addActionRowComponents(new ActionRowBuilder().addComponents(menu))
    .addSeparatorComponents(new SeparatorBuilder())
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://image.png')));
}
function files() { return [new AttachmentBuilder(BANNER,{name:'ticket-dashboard.png'}),new AttachmentBuilder(FOOTER,{name:'image.png'})]; }
async function channelFor(guild) {
  const channel=await guild.channels.fetch(CHANNEL_ID);
  if(!channel?.isTextBased?.() || typeof channel.send!=='function') throw Error('Staff dashboard channel is unavailable.');
  return channel;
}
async function updateDashboard(guild,data,{create=false}={}) {
  const channel=await channelFor(guild);
  if(data.messageId) {
    const old=await channel.messages.fetch(data.messageId).catch(()=>null);
    if(old) {
      await old.edit({components:[layout(guild,data.guides)],files:files(),attachments:[],allowedMentions:{parse:[]}});
      return old;
    }
  }
  if(!create) return null;
  const message=await channel.send({components:[layout(guild,data.guides)],files:files(),flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}});
  data.messageId=message.id;
  save(data);
  return message;
}
async function respond(interaction,text) {
  if(interaction.deferred || interaction.replied) return interaction.editReply({content:text});
  return interaction.reply({content:text,flags:MessageFlags.Ephemeral});
}
async function handleAutocomplete(interaction) {
  if(!interaction.isAutocomplete() || interaction.commandName!=='remove-staff-guide') return false;
  const q=String(interaction.options.getFocused()||'').toLowerCase();
  const options=load().guides.filter(g=>g.name.toLowerCase().includes(q)).slice(0,25).map(g=>({name:g.name.slice(0,100),value:g.id}));
  await interaction.respond(options).catch(()=>{});
  return true;
}
async function handleCommand(interaction) {
  if(!interaction.isChatInputCommand() || !commands.some(c=>c.name===interaction.commandName)) return false;
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  try {
    if(!interaction.guild) throw Error('This command is only available in the server.');
    const data=load();
    if(interaction.commandName==='send-staff-dashboard') {
      if(!fs.existsSync(BANNER)||!fs.existsSync(FOOTER)) throw Error('Dashboard images are missing.');
      const msg=await updateDashboard(interaction.guild,data,{create:true});
      return await respond(interaction,`Staff dashboard ready in <#${CHANNEL_ID}>: ${msg.url}`),true;
    }
    if(interaction.commandName==='add-staff-guide') {
      const name=interaction.options.getString('guide-name',true).trim();
      const link=safeUrl(interaction.options.getString('guide-link',true).trim());
      if(!name || !link) throw Error('Enter a guide name and a valid http(s) guide link.');
      if(data.guides.length>=25) throw Error('The dropdown is full (25 guides). Remove one first.');
      if(data.guides.some(g=>g.name.toLowerCase()===name.toLowerCase())) throw Error('A guide with that name already exists.');
      const id=require('node:crypto').randomUUID();
      data.guides.push({id,name,link});
      save(data);
      await updateDashboard(interaction.guild,data);
      return await respond(interaction,`Added **${name}** to the Guides dropdown.`),true;
    }
    if(interaction.commandName==='remove-staff-guide') {
      const id=interaction.options.getString('guide',true);
      const index=data.guides.findIndex(g=>g.id===id);
      if(index<0) throw Error('That guide is no longer available. Select one from the suggestions.');
      const [removed]=data.guides.splice(index,1);
      save(data);
      await updateDashboard(interaction.guild,data);
      return await respond(interaction,`Removed **${removed.name}** from the Guides dropdown.`),true;
    }
  } catch(error) {
    console.error('[STAFF DASHBOARD]',error);
    await respond(interaction,`Unable to update staff dashboard: ${error.message}`).catch(()=>{});
  }
  return true;
}
async function handleComponent(interaction) {
  if(!interaction.isStringSelectMenu() || interaction.customId!==MENU_ID) return false;
  const selected=interaction.values[0];
  const data=load();
  const guide=data.guides[Number(selected)];
  if(!guide || selected==='empty') await respond(interaction,'That guide is no longer available.');
  else await respond(interaction,`**${guide.name}:** ${guide.link}`);
  // Reset the selected item without changing the saved guide or posting a new dashboard.
  try { if (interaction.message?.edit) await interaction.message.edit({components:[layout(interaction.guild,data.guides)]}); }
  catch(e) { console.warn('[STAFF DASHBOARD] Guide dropdown reset failed:',e?.message||e); }
  return true;
}
async function refreshForBulk(guild) {
  const data = load();
  const oldId = data.messageId;
  const message = await updateDashboard(guild, data, {create:true});
  return { action: oldId && oldId === message.id ? 'updated' : 'created', url: message.url };
}
module.exports={commands,handleCommand,handleComponent,handleAutocomplete,refreshForBulk};
