 'use strict';
const {SlashCommandBuilder,MessageFlags} = require('discord.js');
const ticket = require('../tickets/ticketSetup');
const session = require('../sessions/sessionDashboard');
const roleBindings = require('../roleBindings/roleBindingSystem');
const main = require('../mainDashboard/dashboardSystem');
const staff = require('../staffDashboard/staffDashboard');
const training = require('../training/trainingSystem');
const media = require('../media/mediaSystem');

const ROLE_BINDING_MANAGER = '1556177802267590686';
const command = new SlashCommandBuilder()
 .setName('update-server-dashboards')
 .setDescription('Refresh every existing MSRP server dashboard. Foundership only.');
let running = false;

async function handleCommand(interaction) {
 if (!interaction.isChatInputCommand() || interaction.commandName !== command.name) return false;
 // Defence in depth: ensure Foundership even if this handler is invoked outside index.js.
 const member = interaction.guild && await interaction.guild.members.fetch(interaction.user.id).catch(()=>null);
 if (!member?.roles.cache.has('1547525713853288448') && !interaction.memberPermissions?.has('Administrator')) {
  await interaction.reply({content:'Foundership permission required.',flags:MessageFlags.Ephemeral});
  return true;
 }
 if (running) {
  await interaction.reply({content:'A dashboard refresh is already running. Please retry after it finishes.',flags:MessageFlags.Ephemeral});
  return true;
 }
 running = true;
 try {
  await interaction.deferReply({flags:MessageFlags.Ephemeral});
  const guild = interaction.guild;
  if (!guild) throw new Error('Use this command inside the MSRP Discord server.');
  const outcomes=[];
  async function run(name, f) {
   try {
    const result = await f();
    for (const r of Array.isArray(result) ? result : [result]) outcomes.push({name:r?.name || name,...r});
   } catch (error) {
    console.error(`[DASHBOARDS] ${name}:`,error);
    outcomes.push({name,action:'failed',reason:String(error?.message || error).slice(0,180)});
   }
  }
  await run('Ticket Dashboard',()=>ticket.refreshForBulk(guild));
  await run('Session Dashboard',()=>session.refreshForBulk(interaction.client));
  if (member.roles.cache.has(ROLE_BINDING_MANAGER)) await run('Role Bindings',()=>roleBindings.refreshForBulk(guild));
  else outcomes.push({name:'Role Bindings',action:'skipped',reason:`Exclusive role <@&${ROLE_BINDING_MANAGER}> required.`});
  await run('Information Dashboard',()=>main.refreshForBulk(guild));
  await run('Staff Guides',()=>staff.refreshForBulk(guild));
  await run('Training Dashboards',()=>training.refreshForBulk(guild));
  await run('Media Project Manager',()=>media.refreshForBulk(guild));
  const counts={updated:0,created:0,skipped:0,failed:0};
  const lines=outcomes.map(r=>{
   const action=['updated','created','skipped'].includes(r.action) ? r.action : 'failed';
   counts[action]++;
   const symbol=({updated:'✅',created:'🆕',skipped:'⏭️',failed:'❌'})[action];
   const label=r.url ? `[${r.name}](${r.url})` : r.name;
   return `${symbol} **${label}** — ${action}${r.reason?`: ${r.reason}`:''}`;
  });
  await interaction.editReply({content:[
    '**MSRP Dashboard Refresh**',
    `Updated ${counts.updated} · Created ${counts.created} · Skipped ${counts.skipped} · Failed ${counts.failed}`,
    '',...lines
  ].join('\n').slice(0,1900),allowedMentions:{parse:[]}});
 } catch (error) {
  console.error('[DASHBOARDS] Fatal bulk refresh failure:',error);
  if (interaction.deferred||interaction.replied) await interaction.editReply({content:`Dashboard refresh failed: ${error.message}`}).catch(()=>{});
 } finally {running=false;}
 return true;
}
module.exports = {command,handleCommand};
