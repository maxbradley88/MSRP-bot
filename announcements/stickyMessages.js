'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder, ChannelType, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, PermissionFlagsBits } = require('discord.js');
const FILE = path.join(__dirname, 'stickyMessages.runtime.json');
const command = new SlashCommandBuilder().setName('sticky-message').setDescription('Create or update a sticky message.')
  .addBooleanOption(o=>o.setName('container').setDescription('Use a neutral container').setRequired(true))
  .addChannelOption(o=>o.setName('channel').setDescription('Text channel for the sticky').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
  .addStringOption(o=>o.setName('title').setDescription('Sticky heading').setRequired(true).setMaxLength(160))
  .addStringOption(o=>o.setName('text').setDescription('Optional description').setMaxLength(3000));
let state = {};
try { state = JSON.parse(fs.readFileSync(FILE,'utf8')); } catch(e) { if(e.code !== 'ENOENT') console.error('[STICKY] Read failed', e); }
const timers=new Map(), running=new Set(), reruns=new Set();
const save=()=>{ const tmp=FILE+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2));fs.renameSync(tmp,FILE); };
const clean=x=>String(x||'').replace(/@/g,'@\u200b').replace(/<(?=[@#!&])/g,'<\u200b');
function payload(s) {
 const title='## '+clean(s.title), text=clean(s.text);
 if(!s.container) return {content:title+(text?'\n\n'+text:''),allowedMentions:{parse:[]}};
 const c=new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
 if(text) c.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
 return {components:[c],flags:MessageFlags.IsComponentsV2,allowedMentions:{parse:[]}};
}
function queue(client,id) {
 if(!state[id])return;
 clearTimeout(timers.get(id));
 timers.set(id,setTimeout(()=>{timers.delete(id);void refresh(client,id);},2500));
}
async function refresh(client,id,force=false) {
 if(running.has(id)){reruns.add(id);return false;}
 running.add(id);
 let posted=false;
 try {
  const s=state[id];if(!s)return false;
  const channel=await client.channels.fetch(id).catch(()=>null);
  if(!channel?.messages?.fetch || typeof channel.send!=='function')return false;
  const me=channel.guild.members.me||await channel.guild.members.fetchMe();
  const p=channel.permissionsFor(me);
  if(![PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ManageMessages,PermissionFlagsBits.ReadMessageHistory].every(x=>p?.has(x))) {console.warn('[STICKY] Missing channel permissions:',id);return false;}
  if(!force&&s.messageId){const last=(await channel.messages.fetch({limit:1})).first();if(last?.id===s.messageId)return true;}
  const old=s.messageId;
  const msg=await channel.send(payload(s));
  s.messageId=msg.id;save();posted=true;
  if(old&&old!==msg.id)await channel.messages.delete(old).catch(e=>{if(e.code!==10008)console.warn('[STICKY] Old message delete failed',e);});
 }catch(e){console.error('[STICKY] Update failed:',e);}
 finally {running.delete(id);if(reruns.delete(id))queue(client,id);}
 return posted;
}
function register(client){
 client.on('messageCreate',m=>{if(!m.guild||!state[m.channelId]||m.id===state[m.channelId].messageId)return;queue(client,m.channelId);});
 client.once('clientReady',()=>{for(const id of Object.keys(state))queue(client,id);});
}
async function handleCommand(interaction){
 if(!interaction.isChatInputCommand()||interaction.commandName!=='sticky-message')return false;
 await interaction.deferReply({flags:MessageFlags.Ephemeral});
 const ch=interaction.options.getChannel('channel',true);
 if(!interaction.guild||ch.guildId!==interaction.guildId){await interaction.editReply('Choose a channel in this server.');return true;}
 const me=interaction.guild.members.me||await interaction.guild.members.fetchMe();const p=ch.permissionsFor(me);
 if(![PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ManageMessages,PermissionFlagsBits.ReadMessageHistory].every(x=>p?.has(x))) {
  await interaction.editReply('I need View Channel, Send Messages, Read Message History and Manage Messages in that channel.');return true;
 }
 const prior=state[ch.id];
 state[ch.id]={title:interaction.options.getString('title',true),text:interaction.options.getString('text')||'',container:interaction.options.getBoolean('container',true),messageId:prior?.messageId||null};
 save();
 const ok=await refresh(interaction.client,ch.id,true);
 await interaction.editReply(ok?`Sticky message set for <#${ch.id}>. It refreshes after new messages.`:'Settings saved, but I could not post the sticky. Check the bot console.');
 return true;
}
module.exports={command,register,handleCommand};
