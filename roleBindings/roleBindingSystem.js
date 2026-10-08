const fs = require('node:fs');
const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    LabelBuilder,
    MessageFlags,
    ModalBuilder,
    RoleSelectMenuBuilder,
    SeparatorBuilder,
    SlashCommandBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');

const { getMelonlyMemberByDiscordId } = require('../sessions/melonlyApi');

const DATA_FILE = path.join(__dirname, 'roleBindings.json');
const syncLocks = new Map();
const robloxCache = new Map();

const command = new SlashCommandBuilder()
    .setName('send-role-dashboard')
    .setDescription('Sends the role binding and nickname management dashboard.');

function loadConfig() {
    try {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        parsed.dashboard ||= { channelId: null, messageId: null };
        parsed.bindings ||= [];
        parsed.nicknameRules ||= [];
        return parsed;
    } catch (error) {
        console.error('[ROLE BINDINGS] Failed to load configuration:', error);
        return { dashboard: { channelId: null, messageId: null }, bindings: [], nicknameRules: [] };
    }
}

function saveConfig(config) {
    fs.writeFileSync(DATA_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function uniqueIds(values) {
    return [...new Set((values || []).map(String).filter(Boolean))];
}

function bindingLabel(binding, index) {
    return String(binding.name || `Binding ${index + 1}`).slice(0, 100);
}

function roleList(ids) {
    const clean = uniqueIds(ids);
    return clean.length ? clean.map(id => `<@&${id}>`).join(', ') : '*None*';
}

function buildDashboardPayload(config) {
    const bindingLines = config.bindings.length
        ? config.bindings.map((binding, i) =>
            `**${i + 1}. ${binding.name || 'Role Binding'}**\n${roleList(binding.triggerRoleIds)} → ${roleList(binding.linkedRoleIds)}`
        ).join('\n\n')
        : '*No role bindings configured.*';

    const nickLines = config.nicknameRules.length
        ? config.nicknameRules.map(rule => {
            const mode = rule.nameMode === 'discord_username'
                ? 'Discord username'
                : rule.nameMode === 'display_roblox'
                    ? 'Display name (Roblox username)'
                    : 'No automatic name';
            const excludes = rule.excludedRoleIds?.length
                ? ` • excludes ${roleList(rule.excludedRoleIds)}`
                : '';
            return `**${rule.prefix || 'No prefix'}** • <@&${rule.roleId}> • ${mode}${excludes}`;
        }).join('\n')
        : '*No nickname rules configured.*';

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## ⚙️ Role & Naming Dashboard\nManage automatic role bindings and nickname formats. A member only keeps an automatically-managed role while at least one binding requires it.'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### 🔗 Role bindings\n${bindingLines.slice(0, 3900)}`)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`### 🏷️ Naming rules\n${nickLines.slice(0, 3900)}`)
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rolebind_add').setLabel('Add Binding').setEmoji('🔗').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('rolebind_edit').setLabel('Edit Binding').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('rolename_add').setLabel('Add Name Rule').setEmoji('🏷️').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('rolename_edit').setLabel('Edit Name Rule').setEmoji('📝').setStyle(ButtonStyle.Secondary)
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rolebind_sync_roles').setLabel('Sync Roles').setEmoji('🔄').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('rolebind_sync_members').setLabel('Sync Members').setEmoji('👥').setStyle(ButtonStyle.Secondary)
            )
        );

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function refreshDashboard(client) {
    const config = loadConfig();
    if (!config.dashboard?.channelId || !config.dashboard?.messageId) return;
    try {
        const channel = await client.channels.fetch(config.dashboard.channelId);
        const message = await channel.messages.fetch(config.dashboard.messageId);
        await message.edit(buildDashboardPayload(config));
    } catch (error) {
        console.warn('[ROLE BINDINGS] Could not refresh dashboard:', error.message);
    }
}

async function executeDashboard(interaction) {
    const config = loadConfig();
    const message = await interaction.channel.send(buildDashboardPayload(config));
    config.dashboard = { channelId: interaction.channelId, messageId: message.id };
    saveConfig(config);
    await interaction.reply({ content: '✅ Role & Naming Dashboard sent.', flags: MessageFlags.Ephemeral });
}

function makeBindingModal(binding = null) {
    const editing = Boolean(binding);
    const id = binding?.id || `binding-${Date.now()}`;
    const modal = new ModalBuilder()
        .setCustomId(`rolebind_modal:${id}:${editing ? 'edit' : 'new'}`)
        .setTitle(editing ? 'Edit Role Binding' : 'Create Role Binding');

    const triggers = new RoleSelectMenuBuilder()
        .setCustomId('binding_triggers')
        .setMinValues(1)
        .setMaxValues(25)
        .setPlaceholder('Roles that activate this binding');
    if (binding?.triggerRoleIds?.length) triggers.setDefaultRoles(...binding.triggerRoleIds);

    const linked = new RoleSelectMenuBuilder()
        .setCustomId('binding_linked')
        .setMinValues(1)
        .setMaxValues(25)
        .setPlaceholder('Roles automatically given while active');
    if (binding?.linkedRoleIds?.length) linked.setDefaultRoles(...binding.linkedRoleIds);

    const name = new TextInputBuilder()
        .setCustomId('binding_name')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(60)
        .setPlaceholder('Optional label, e.g. Management');
    if (binding?.name) name.setValue(binding.name);

    modal.addLabelComponents(
        new LabelBuilder().setLabel('If they have ANY of these roles').setRoleSelectMenuComponent(triggers),
        new LabelBuilder().setLabel('Give them ALL of these roles').setRoleSelectMenuComponent(linked),
        new LabelBuilder().setLabel('Optional binding name').setTextInputComponent(name)
    );
    return modal;
}

function makeNameModal(rule = null) {
    const editing = Boolean(rule);
    const id = rule?.id || `nick-${Date.now()}`;
    const modal = new ModalBuilder()
        .setCustomId(`rolename_modal:${id}:${editing ? 'edit' : 'new'}`)
        .setTitle(editing ? 'Edit Naming Rule' : 'Create Naming Rule');

    const role = new RoleSelectMenuBuilder()
        .setCustomId('name_role')
        .setMinValues(1)
        .setMaxValues(1)
        .setPlaceholder('Role that activates this name');
    if (rule?.roleId) role.setDefaultRoles(rule.roleId);

    const prefix = new TextInputBuilder()
        .setCustomId('name_prefix')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(16)
        .setPlaceholder('Letters only, e.g. CD or F');
    if (rule?.prefix) prefix.setValue(rule.prefix);

    const format = new StringSelectMenuBuilder()
        .setCustomId('name_mode')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Display name (Roblox username)')
                .setValue('display_roblox')
                .setDescription('Example: CD・Max (RobloxName)')
                .setDefault(rule?.nameMode !== 'discord_username'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Discord username')
                .setValue('discord_username')
                .setDescription('Example: UNVERIFIED・maxbradley')
                .setDefault(rule?.nameMode === 'discord_username')
        );

    const excludes = new RoleSelectMenuBuilder()
        .setCustomId('name_excludes')
        .setMinValues(0)
        .setMaxValues(25)
        .setPlaceholder('Optional roles that block this naming rule');
    if (rule?.excludedRoleIds?.length) excludes.setDefaultRoles(...rule.excludedRoleIds);

    modal.addLabelComponents(
        new LabelBuilder().setLabel('Role').setRoleSelectMenuComponent(role),
        new LabelBuilder().setLabel('Prefix').setDescription('Just the prefix letters; the bot adds ・ automatically.').setTextInputComponent(prefix),
        new LabelBuilder().setLabel('Name format').setStringSelectMenuComponent(format),
        new LabelBuilder().setLabel('Optional excluded roles').setRoleSelectMenuComponent(excludes)
    );
    return modal;
}

function editSelectPayload(items, type) {
    const isBinding = type === 'binding';
    const menu = new StringSelectMenuBuilder()
        .setCustomId(isBinding ? 'rolebind_edit_select' : 'rolename_edit_select')
        .setPlaceholder(isBinding ? 'Choose a binding to edit...' : 'Choose a naming rule to edit...')
        .addOptions(items.slice(0, 25).map((item, i) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(isBinding ? bindingLabel(item, i) : `${item.prefix || 'No prefix'} — ${item.roleId}`.slice(0, 100))
                .setValue(item.id)
        ));
    return {
        content: isBinding ? '✏️ Select the role binding you want to edit.' : '📝 Select the naming rule you want to edit.',
        components: [new ActionRowBuilder().addComponents(menu)],
        flags: MessageFlags.Ephemeral
    };
}

function cleanupDeletedRoles(guild, config) {
    const exists = id => guild.roles.cache.has(id);
    const beforeBindings = config.bindings.length;
    const beforeNames = config.nicknameRules.length;

    config.bindings = config.bindings
        .map(binding => ({
            ...binding,
            triggerRoleIds: uniqueIds(binding.triggerRoleIds).filter(exists),
            linkedRoleIds: uniqueIds(binding.linkedRoleIds).filter(exists)
        }))
        .filter(binding => binding.triggerRoleIds.length && binding.linkedRoleIds.length);

    config.nicknameRules = config.nicknameRules
        .filter(rule => exists(rule.roleId))
        .map(rule => ({ ...rule, excludedRoleIds: uniqueIds(rule.excludedRoleIds).filter(exists) }));

    return {
        removedBindings: beforeBindings - config.bindings.length,
        removedNames: beforeNames - config.nicknameRules.length
    };
}

function getDiscordBaseName(member) {
    return member.user.globalName || member.user.username;
}

function extractRobloxUsername(memberData) {
    if (!memberData || typeof memberData !== 'object') return null;
    const value =
        memberData.robloxUsername ??
        memberData.roblox_username ??
        memberData.roblox?.username ??
        memberData.roblox?.name ??
        memberData.user?.robloxUsername ??
        memberData.user?.roblox_username ??
        memberData.username;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function getRobloxUsername(discordId) {
    const cached = robloxCache.get(discordId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let value = null;
    try {
        value = extractRobloxUsername(await getMelonlyMemberByDiscordId(discordId));
    } catch (error) {
        console.warn(`[ROLE NAMES] Melonly lookup failed for ${discordId}: ${error.message}`);
    }
    robloxCache.set(discordId, { value, expiresAt: Date.now() + 15 * 60 * 1000 });
    return value;
}

async function syncNickname(member, config) {
    if (!member.manageable) return;
    const eligible = config.nicknameRules.filter(rule =>
        member.roles.cache.has(rule.roleId) &&
        !(rule.excludedRoleIds || []).some(id => member.roles.cache.has(id))
    );
    if (!eligible.length) {
        const baseName = getDiscordBaseName(member).slice(0, 32);
        if (member.nickname && member.nickname !== baseName) {
            await member.setNickname(baseName, 'MSRP automatic naming rule removed');
        }
        return;
    }

    eligible.sort((a, b) => {
        const ar = member.guild.roles.cache.get(a.roleId)?.position ?? -1;
        const br = member.guild.roles.cache.get(b.roleId)?.position ?? -1;
        return br - ar;
    });

    const rule = eligible[0];
    const prefix = String(rule.prefix || '').replace(/[^A-Za-z]/g, '').slice(0, 16);
    const base = getDiscordBaseName(member);
    let newName;
    if (rule.nameMode === 'discord_username') {
        newName = prefix ? `${prefix}・${member.user.username}` : member.user.username;
    } else {
        const roblox = await getRobloxUsername(member.id);
        const body = roblox ? `${base} (${roblox})` : base;
        newName = prefix ? `${prefix}・${body}` : body;
    }
    newName = newName.slice(0, 32);
    if (member.nickname !== newName) {
        await member.setNickname(newName, 'MSRP automatic naming rule');
    }
}

async function syncMemberInternal(member) {
    if (!member || member.user?.bot) return;
    const config = loadConfig();

    for (let pass = 0; pass < 6; pass += 1) {
        const managed = new Set(config.bindings.flatMap(binding => binding.linkedRoleIds || []));
        const desired = new Set();
        for (const binding of config.bindings) {
            if ((binding.triggerRoleIds || []).some(id => member.roles.cache.has(id))) {
                for (const id of binding.linkedRoleIds || []) desired.add(id);
            }
        }

        const add = [...desired].filter(id => !member.roles.cache.has(id) && member.guild.roles.cache.has(id));
        const remove = [...managed].filter(id => member.roles.cache.has(id) && !desired.has(id) && member.guild.roles.cache.has(id));
        if (!add.length && !remove.length) break;
        if (add.length) await member.roles.add(add, 'MSRP automatic role binding');
        if (remove.length) await member.roles.remove(remove, 'MSRP automatic role binding removed');
    }

    await syncNickname(member, config);
}

async function syncMember(member) {
    const previous = syncLocks.get(member.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => syncMemberInternal(member));
    syncLocks.set(member.id, next);
    try {
        await next;
    } catch (error) {
        console.error(`[ROLE BINDINGS] Failed to sync ${member.user?.tag || member.id}:`, error);
    } finally {
        if (syncLocks.get(member.id) === next) syncLocks.delete(member.id);
    }
}

async function syncAllMembers(guild) {
    let members = guild.members.cache;
    try {
        members = await guild.members.fetch();
    } catch (error) {
        console.warn('[ROLE BINDINGS] Full member fetch was rate limited/unavailable; using cached members:', error.message);
    }
    let synced = 0;
    for (const member of members.values()) {
        if (member.user.bot) continue;
        await syncMember(member);
        synced += 1;
    }
    return synced;
}

async function handleInteraction(interaction) {
    const id = interaction.customId;
    if (!id || (!id.startsWith('rolebind_') && !id.startsWith('rolename_'))) return false;

    const canManage =
        interaction.memberPermissions?.has('Administrator') ||
        interaction.member?.roles?.cache?.has('1547525713853288448');

    if (!canManage) {
        await interaction.reply({
            content: '❌ You do not have permission to manage role bindings.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const config = loadConfig();

    if (id === 'rolebind_add') {
        await interaction.showModal(makeBindingModal());
        return true;
    }
    if (id === 'rolename_add') {
        await interaction.showModal(makeNameModal());
        return true;
    }
    if (id === 'rolebind_edit') {
        if (!config.bindings.length) await interaction.reply({ content: 'There are no role bindings to edit.', flags: MessageFlags.Ephemeral });
        else await interaction.reply(editSelectPayload(config.bindings, 'binding'));
        return true;
    }
    if (id === 'rolename_edit') {
        if (!config.nicknameRules.length) await interaction.reply({ content: 'There are no naming rules to edit.', flags: MessageFlags.Ephemeral });
        else await interaction.reply(editSelectPayload(config.nicknameRules, 'name'));
        return true;
    }
    if (id === 'rolebind_edit_select' && interaction.isStringSelectMenu()) {
        const binding = config.bindings.find(x => x.id === interaction.values[0]);
        if (!binding) await interaction.reply({ content: 'That binding no longer exists.', flags: MessageFlags.Ephemeral });
        else await interaction.showModal(makeBindingModal(binding));
        return true;
    }
    if (id === 'rolename_edit_select' && interaction.isStringSelectMenu()) {
        const rule = config.nicknameRules.find(x => x.id === interaction.values[0]);
        if (!rule) await interaction.reply({ content: 'That naming rule no longer exists.', flags: MessageFlags.Ephemeral });
        else await interaction.showModal(makeNameModal(rule));
        return true;
    }
    if (id.startsWith('rolebind_modal:') && interaction.isModalSubmit()) {
        const [, bindingId] = id.split(':');
        const binding = {
            id: bindingId,
            name: interaction.fields.getTextInputValue('binding_name').trim() || 'Role Binding',
            triggerRoleIds: uniqueIds([...interaction.fields.getSelectedRoles('binding_triggers', true).keys()]),
            linkedRoleIds: uniqueIds([...interaction.fields.getSelectedRoles('binding_linked', true).keys()])
        };
        const idx = config.bindings.findIndex(x => x.id === bindingId);
        if (idx >= 0) config.bindings[idx] = binding; else config.bindings.push(binding);
        saveConfig(config);
        await interaction.reply({ content: '💾 Role binding saved.', flags: MessageFlags.Ephemeral });
        await refreshDashboard(interaction.client);
        return true;
    }
    if (id.startsWith('rolename_modal:') && interaction.isModalSubmit()) {
        const [, ruleId] = id.split(':');
        const prefix = interaction.fields.getTextInputValue('name_prefix').replace(/[^A-Za-z]/g, '').slice(0, 16);
        const selectedRoles = interaction.fields.getSelectedRoles('name_role', true);
        const exclusions = interaction.fields.getSelectedRoles('name_excludes', false);
        const rule = {
            id: ruleId,
            roleId: [...selectedRoles.keys()][0],
            prefix,
            nameMode: interaction.fields.getStringSelectValues('name_mode')[0] || 'display_roblox',
            excludedRoleIds: exclusions ? uniqueIds([...exclusions.keys()]) : []
        };
        const idx = config.nicknameRules.findIndex(x => x.id === ruleId);
        if (idx >= 0) config.nicknameRules[idx] = rule; else config.nicknameRules.push(rule);
        saveConfig(config);
        await interaction.reply({ content: '💾 Naming rule saved.', flags: MessageFlags.Ephemeral });
        await refreshDashboard(interaction.client);
        return true;
    }
    if (id === 'rolebind_sync_roles') {
        const result = cleanupDeletedRoles(interaction.guild, config);
        saveConfig(config);
        await refreshDashboard(interaction.client);
        await interaction.reply({
            content: `🔄 Roles synced. Removed ${result.removedBindings} invalid binding(s) and ${result.removedNames} invalid naming rule(s). New Discord roles are automatically available in the role pickers.`,
            flags: MessageFlags.Ephemeral
        });
        return true;
    }
    if (id === 'rolebind_sync_members') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const count = await syncAllMembers(interaction.guild);
        await interaction.editReply({ content: `✅ Synced role bindings and names for ${count} member(s).` });
        return true;
    }
    return false;
}

async function handleGuildMemberUpdate(oldMember, newMember) {
    const oldRoles = [...oldMember.roles.cache.keys()].sort().join(',');
    const newRoles = [...newMember.roles.cache.keys()].sort().join(',');
    if (oldRoles !== newRoles) await syncMember(newMember);
}

async function handleGuildRoleDelete(role, client) {
    const config = loadConfig();
    const deletedBindings = config.bindings.filter(binding =>
        (binding.triggerRoleIds || []).includes(role.id) &&
        (binding.triggerRoleIds || []).filter(id => id !== role.id && role.guild.roles.cache.has(id)).length === 0
    );
    const orphanedLinkedRoles = new Set(deletedBindings.flatMap(binding => binding.linkedRoleIds || []));

    cleanupDeletedRoles(role.guild, config);
    saveConfig(config);

    if (orphanedLinkedRoles.size) {
        for (const member of role.guild.members.cache.values()) {
            if (member.user.bot) continue;
            const stillDesired = new Set();
            for (const binding of config.bindings) {
                if ((binding.triggerRoleIds || []).some(id => member.roles.cache.has(id))) {
                    for (const id of binding.linkedRoleIds || []) stillDesired.add(id);
                }
            }
            const toRemove = [...orphanedLinkedRoles].filter(id =>
                member.roles.cache.has(id) && !stillDesired.has(id) && role.guild.roles.cache.has(id)
            );
            if (toRemove.length) {
                try {
                    await member.roles.remove(toRemove, 'MSRP role binding trigger deleted');
                } catch (error) {
                    console.warn(`[ROLE BINDINGS] Could not remove orphaned roles from ${member.id}: ${error.message}`);
                }
            }
            await syncMember(member);
        }
    }

    await refreshDashboard(client);
}

module.exports = {
    command,
    executeDashboard,
    handleInteraction,
    handleGuildMemberUpdate,
    handleGuildRoleDelete,
    syncMember,
    syncAllMembers,
    refreshDashboard
};
