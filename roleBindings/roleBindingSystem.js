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

const {
    getMelonlyMemberByDiscordId,
    getMelonlyRobloxConnectionByDiscordId
} = require('../sessions/melonlyApi');

const DEFAULT_FILE = path.join(__dirname, 'roleBindings.json');
const DATA_FILE = path.join(__dirname, 'roleBindings.runtime.json');

const syncLocks = new Map();
const robloxCache = new Map();
const editSessions = new Map();

const command = new SlashCommandBuilder()
    .setName('send-role-dashboard')
    .setDescription('Sends the role binding and nickname management dashboard.');

function blankConfig() {
    return {
        dashboard: { channelId: null, messageId: null },
        bindings: [],
        nicknameRules: [],
        lastRoleSyncAt: null,
        lastMemberSyncAt: null,
        lastNameSyncAt: null
    };
}

function ensureConfigShape(config) {
    const value = config && typeof config === 'object' ? config : blankConfig();
    value.dashboard ||= { channelId: null, messageId: null };
    value.bindings ||= [];
    value.nicknameRules ||= [];
    value.lastRoleSyncAt ||= null;
    value.lastMemberSyncAt ||= null;
    value.lastNameSyncAt ||= null;
    return value;
}

function loadConfig() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const seed = fs.existsSync(DEFAULT_FILE)
                ? ensureConfigShape(JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8')))
                : blankConfig();
            fs.writeFileSync(DATA_FILE, `${JSON.stringify(seed, null, 2)}\n`, 'utf8');
            return seed;
        }
        return ensureConfigShape(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    } catch (error) {
        console.error('[ROLE BINDINGS] Failed to load configuration:', error);
        return blankConfig();
    }
}

function saveConfig(config) {
    fs.writeFileSync(DATA_FILE, `${JSON.stringify(ensureConfigShape(config), null, 2)}\n`, 'utf8');
}

function uniqueIds(values) {
    return [...new Set((values || []).map(String).filter(Boolean))];
}

function canManage(interaction) {
    return Boolean(
        interaction.memberPermissions?.has('Administrator') ||
        interaction.member?.roles?.cache?.has('1547525713853288448')
    );
}

function timestampText(value) {
    if (!value) return 'Not yet';
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return 'Not yet';
    return `<t:${Math.floor(ms / 1000)}:R>`;
}

function roleName(guild, roleId) {
    return guild?.roles?.cache?.get(roleId)?.name || 'Deleted role';
}

function roleNames(guild, ids, limit = 4) {
    const names = uniqueIds(ids).map(id => roleName(guild, id));
    if (!names.length) return 'None';
    if (names.length <= limit) return names.join(', ');
    return `${names.slice(0, limit).join(', ')} +${names.length - limit}`;
}

function bindingOptionLabel(guild, binding) {
    const triggers = uniqueIds(binding.triggerRoleIds);
    const linked = uniqueIds(binding.linkedRoleIds);
    const firstTrigger = roleName(guild, triggers[0] || '');
    const firstLinked = roleName(guild, linked[0] || '');
    const left = triggers.length > 1 ? `${firstTrigger} +${triggers.length - 1}` : firstTrigger;
    const right = linked.length > 1 ? `${firstLinked} +${linked.length - 1}` : firstLinked;
    return `${left} → ${right}`.slice(0, 100);
}

function nameRuleOptionLabel(guild, rule) {
    const prefix = rule.prefix || 'No prefix';
    return `${prefix} • ${roleName(guild, rule.roleId)}`.slice(0, 100);
}

function componentsV2Reply(container) {
    return {
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [container]
    };
}

function buildDashboardPayload(config) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## ⚙️ Role Management\nAutomatic role binding and staff nickname management.'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### System status\n` +
                `🔗 **Role bindings:** ${config.bindings.length}\n` +
                `🏷️ **Naming rules:** ${config.nicknameRules.length}\n` +
                `🔄 **Role list synced:** ${timestampText(config.lastRoleSyncAt)}\n` +
                `👥 **Members synced:** ${timestampText(config.lastMemberSyncAt)}\n` +
                `✏️ **Names synced:** ${timestampText(config.lastNameSyncAt)}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rolebind_manage')
                    .setLabel('Role Bindings')
                    .setEmoji('🔗')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('rolename_manage')
                    .setLabel('Name Rules')
                    .setEmoji('🏷️')
                    .setStyle(ButtonStyle.Primary)
            )
        )
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rolebind_sync_roles')
                    .setLabel('Sync Roles')
                    .setEmoji('🔄')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('rolebind_sync_members')
                    .setLabel('Sync Members')
                    .setEmoji('👥')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('rolename_sync_names')
                    .setLabel('Sync Names')
                    .setEmoji('✏️')
                    .setStyle(ButtonStyle.Secondary)
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
    await interaction.reply({ content: '✅ Role Management Dashboard sent.', flags: MessageFlags.Ephemeral });
}

function sessionKey(interaction, type) {
    return `${interaction.guildId}:${interaction.user.id}:${type}`;
}

function setEditState(interaction, type, state) {
    editSessions.set(sessionKey(interaction, type), {
        ...state,
        touchedAt: Date.now()
    });
}

function getEditState(interaction, type) {
    const key = sessionKey(interaction, type);
    const state = editSessions.get(key);
    if (!state) return null;
    if (Date.now() - state.touchedAt > 30 * 60 * 1000) {
        editSessions.delete(key);
        return null;
    }
    state.touchedAt = Date.now();
    return state;
}

function clearEditState(interaction, type) {
    editSessions.delete(sessionKey(interaction, type));
}

function buildBindingManager(guild, config) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## 🔗 Role Bindings\nChoose an existing binding to edit, or create a new one. Role names are shown as plain text so role colours do not affect readability.'
            )
        );

    if (config.bindings.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('rolebind_manager_select')
            .setPlaceholder('Choose a role binding…')
            .addOptions(
                config.bindings.slice(0, 25).map(binding =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(bindingOptionLabel(guild, binding))
                        .setValue(binding.id)
                        .setDescription(`${uniqueIds(binding.triggerRoleIds).length} trigger role(s) • ${uniqueIds(binding.linkedRoleIds).length} linked role(s)`.slice(0, 100))
                )
            );
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    } else {
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*No bindings configured yet.*'));
    }

    container
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rolebind_new').setLabel('New Binding').setEmoji('➕').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('rolebind_manager_close').setLabel('Close').setStyle(ButtonStyle.Secondary)
            )
        );

    return container;
}

function buildBindingEditor(guild, state) {
    const validTriggers = uniqueIds(state.triggerRoleIds).filter(id => guild.roles.cache.has(id)).slice(0, 25);
    const validLinked = uniqueIds(state.linkedRoleIds).filter(id => guild.roles.cache.has(id)).slice(0, 25);

    const triggers = new RoleSelectMenuBuilder()
        .setCustomId('rolebind_editor_triggers')
        .setPlaceholder('Choose trigger roles…')
        .setMinValues(1)
        .setMaxValues(25);
    if (validTriggers.length) triggers.setDefaultRoles(...validTriggers);

    const linked = new RoleSelectMenuBuilder()
        .setCustomId('rolebind_editor_linked')
        .setPlaceholder('Choose roles to automatically give…')
        .setMinValues(1)
        .setMaxValues(25);
    if (validLinked.length) linked.setDefaultRoles(...validLinked);

    const title = state.isNew ? '## ➕ New Role Binding' : '## ✏️ Edit Role Binding';
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${title}\n` +
                `**If they have:** ${roleNames(guild, validTriggers)}\n` +
                `**Automatically give:** ${roleNames(guild, validLinked)}\n\n` +
                '*Use the search box in Discord’s role picker to find any server role. You can select up to 25 roles in each side.*'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Trigger roles'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(triggers))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Roles to give'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(linked))
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rolebind_editor_save').setLabel('Save').setEmoji('💾').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('rolebind_editor_delete').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(state.isNew),
                new ButtonBuilder().setCustomId('rolebind_editor_back').setLabel('Back').setStyle(ButtonStyle.Secondary)
            )
        );

    return container;
}

function buildNameManager(guild, config) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## 🏷️ Name Rules\nThe highest configured Discord role a member has controls their prefix and name format.'
            )
        );

    if (config.nicknameRules.length) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('rolename_manager_select')
            .setPlaceholder('Choose a naming rule…')
            .addOptions(
                config.nicknameRules.slice(0, 25).map(rule =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(nameRuleOptionLabel(guild, rule))
                        .setValue(rule.id)
                        .setDescription(
                            rule.nameMode === 'discord_username'
                                ? 'Discord username'
                                : 'Display name (Roblox username when available)'
                        )
                )
            );
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    } else {
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*No naming rules configured yet.*'));
    }

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rolename_new').setLabel('New Name Rule').setEmoji('➕').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('rolename_manager_close').setLabel('Close').setStyle(ButtonStyle.Secondary)
        )
    );

    return container;
}

function buildNameEditor(guild, state) {
    const role = new RoleSelectMenuBuilder()
        .setCustomId('rolename_editor_role')
        .setPlaceholder('Choose the role for this name rule…')
        .setMinValues(1)
        .setMaxValues(1);
    if (state.roleId && guild.roles.cache.has(state.roleId)) role.setDefaultRoles(state.roleId);

    const mode = new StringSelectMenuBuilder()
        .setCustomId('rolename_editor_mode')
        .setPlaceholder('Choose name format…')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Display name (Roblox username)')
                .setDescription('Example: CD・Max (RobloxName)')
                .setValue('display_roblox')
                .setDefault(state.nameMode !== 'discord_username'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Discord username')
                .setDescription('Example: UNVERIFIED・maxbradley')
                .setValue('discord_username')
                .setDefault(state.nameMode === 'discord_username')
        );

    const validExcludes = uniqueIds(state.excludedRoleIds).filter(id => guild.roles.cache.has(id)).slice(0, 25);
    const excludes = new RoleSelectMenuBuilder()
        .setCustomId('rolename_editor_excludes')
        .setPlaceholder('Optional excluded roles…')
        .setMinValues(0)
        .setMaxValues(25);
    if (validExcludes.length) excludes.setDefaultRoles(...validExcludes);

    const roleText = state.roleId ? roleName(guild, state.roleId) : 'Not selected';
    const modeText = state.nameMode === 'discord_username' ? 'Discord username' : 'Display name (Roblox username)';
    const previewPrefix = state.prefix || 'No prefix';

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${state.isNew ? '## ➕ New Name Rule' : '## ✏️ Edit Name Rule'}\n` +
                `**Role:** ${roleText}\n` +
                `**Prefix:** ${previewPrefix}\n` +
                `**Format:** ${modeText}\n` +
                `**Excluded roles:** ${roleNames(guild, validExcludes)}\n\n` +
                '*The prefix box only needs letters such as `CD`, `F`, or `MGT`. The bot adds `・` automatically.*'
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Role'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(role))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Name format'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(mode))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Optional excluded roles'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(excludes))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rolename_editor_prefix').setLabel('Set Prefix').setEmoji('🔤').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('rolename_editor_clear_excludes').setLabel('Clear Exclusions').setStyle(ButtonStyle.Secondary).setDisabled(!validExcludes.length)
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rolename_editor_save').setLabel('Save').setEmoji('💾').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('rolename_editor_delete').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(state.isNew),
                new ButtonBuilder().setCustomId('rolename_editor_back').setLabel('Back').setStyle(ButtonStyle.Secondary)
            )
        );

    return container;
}

function makePrefixModal(state) {
    const prefix = new TextInputBuilder()
        .setCustomId('name_prefix')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(16)
        .setPlaceholder('Example: CD, F, MGT');
    if (state.prefix) prefix.setValue(state.prefix);

    return new ModalBuilder()
        .setCustomId('rolename_prefix_modal')
        .setTitle('Set nickname prefix')
        .addLabelComponents(
            new LabelBuilder()
                .setLabel('Prefix letters')
                .setDescription('Leave blank for no prefix.')
                .setTextInputComponent(prefix)
        );
}

function cleanupDeletedRoles(guild, config) {
    const exists = id => guild.roles.cache.has(id);
    const beforeBindings = config.bindings.length;
    const beforeNames = config.nicknameRules.length;
    let cleanedReferences = 0;

    config.bindings = config.bindings
        .map(binding => {
            const beforeTrigger = uniqueIds(binding.triggerRoleIds).length;
            const beforeLinked = uniqueIds(binding.linkedRoleIds).length;
            const triggerRoleIds = uniqueIds(binding.triggerRoleIds).filter(exists);
            const linkedRoleIds = uniqueIds(binding.linkedRoleIds).filter(exists);
            cleanedReferences += beforeTrigger - triggerRoleIds.length;
            cleanedReferences += beforeLinked - linkedRoleIds.length;
            return { ...binding, triggerRoleIds, linkedRoleIds };
        })
        .filter(binding => binding.triggerRoleIds.length && binding.linkedRoleIds.length);

    config.nicknameRules = config.nicknameRules
        .filter(rule => exists(rule.roleId))
        .map(rule => {
            const before = uniqueIds(rule.excludedRoleIds).length;
            const excludedRoleIds = uniqueIds(rule.excludedRoleIds).filter(exists);
            cleanedReferences += before - excludedRoleIds.length;
            return { ...rule, excludedRoleIds };
        });

    return {
        removedBindings: beforeBindings - config.bindings.length,
        removedNames: beforeNames - config.nicknameRules.length,
        cleanedReferences
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
        const connection = await getMelonlyRobloxConnectionByDiscordId(discordId);
        value = extractRobloxUsername(connection?.data ?? connection);
        if (!value) {
            const member = await getMelonlyMemberByDiscordId(discordId);
            value = extractRobloxUsername(member?.data ?? member);
        }
    } catch (error) {
        // Naming must continue even if a user is not verified or Melonly is unavailable.
        // Cache the miss so a bulk sync does not spam the console with the same lookup.
        value = null;
    }

    robloxCache.set(discordId, { value, expiresAt: Date.now() + 15 * 60 * 1000 });
    return value;
}

async function syncNickname(member, config) {
    if (!member || member.user?.bot) return { status: 'skipped', reason: 'bot' };
    if (!member.manageable) return { status: 'skipped', reason: 'hierarchy' };

    const eligible = config.nicknameRules.filter(rule =>
        member.roles.cache.has(rule.roleId) &&
        !(rule.excludedRoleIds || []).some(id => member.roles.cache.has(id))
    );

    let newName;
    if (!eligible.length) {
        newName = null;
    } else {
        eligible.sort((a, b) => {
            const ar = member.guild.roles.cache.get(a.roleId)?.position ?? -1;
            const br = member.guild.roles.cache.get(b.roleId)?.position ?? -1;
            return br - ar;
        });

        const rule = eligible[0];
        const prefix = String(rule.prefix || '').replace(/[^A-Za-z]/g, '').slice(0, 16);
        const base = getDiscordBaseName(member);

        if (rule.nameMode === 'discord_username') {
            newName = prefix ? `${prefix}・${member.user.username}` : member.user.username;
        } else {
            const roblox = await getRobloxUsername(member.id);
            const body = roblox ? `${base} (${roblox})` : base;
            newName = prefix ? `${prefix}・${body}` : body;
        }
        newName = newName.slice(0, 32);
    }

    const current = member.nickname || null;
    if (current === newName) {
        return { status: 'unchanged', name: newName };
    }

    try {
        await member.setNickname(newName, 'MSRP automatic naming rule');
        return { status: 'changed', name: newName };
    } catch (error) {
        return { status: 'failed', reason: error.message };
    }
}

async function syncMemberInternal(member, options = {}) {
    if (!member || member.user?.bot) return { rolesChanged: false, name: { status: 'skipped', reason: 'bot' } };
    const config = options.config || loadConfig();
    let rolesChanged = false;

    if (!options.namesOnly) {
        for (let pass = 0; pass < 6; pass += 1) {
            const managed = new Set(config.bindings.flatMap(binding => binding.linkedRoleIds || []));
            const desired = new Set();

            for (const binding of config.bindings) {
                if ((binding.triggerRoleIds || []).some(id => member.roles.cache.has(id))) {
                    for (const id of binding.linkedRoleIds || []) desired.add(id);
                }
            }

            const add = [...desired].filter(id => {
                const role = member.guild.roles.cache.get(id);
                return role && role.editable && !member.roles.cache.has(id);
            });
            const remove = [...managed].filter(id => {
                const role = member.guild.roles.cache.get(id);
                return role && role.editable && member.roles.cache.has(id) && !desired.has(id);
            });

            if (!add.length && !remove.length) break;

            try {
                if (add.length) {
                    await member.roles.add(add, 'MSRP automatic role binding');
                    rolesChanged = true;
                }
                if (remove.length) {
                    await member.roles.remove(remove, 'MSRP automatic role binding removed');
                    rolesChanged = true;
                }
            } catch (error) {
                console.warn(`[ROLE BINDINGS] Could not update roles for ${member.user?.tag || member.id}: ${error.message}`);
                break;
            }
        }
    }

    const name = await syncNickname(member, config);
    return { rolesChanged, name };
}

async function syncMember(member) {
    const previous = syncLocks.get(member.id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => syncMemberInternal(member));
    syncLocks.set(member.id, next);
    try {
        return await next;
    } catch (error) {
        console.error(`[ROLE BINDINGS] Failed to sync ${member.user?.tag || member.id}:`, error);
        return { rolesChanged: false, name: { status: 'failed', reason: error.message } };
    } finally {
        if (syncLocks.get(member.id) === next) syncLocks.delete(member.id);
    }
}

async function listGuildMembers(guild) {
    const all = new Map();
    for (const [id, member] of guild.members.cache) all.set(id, member);

    // guild.members.fetch() requests every member through Gateway opcode 8 and is
    // now aggressively rate limited. Prefer Discord's REST member-list endpoint.
    if (typeof guild.members.list === 'function') {
        try {
            let after;
            for (let page = 0; page < 25; page += 1) {
                const batch = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
                const members = [...batch.values()];
                for (const member of members) all.set(member.id, member);
                if (members.length < 1000) break;
                after = members[members.length - 1]?.id;
                if (!after) break;
            }
        } catch (error) {
            console.warn('[ROLE BINDINGS] REST member listing unavailable; using cached members:', error.message);
        }
    }

    return [...all.values()];
}

function newSyncStats() {
    return {
        members: 0,
        rolesChanged: 0,
        namesChanged: 0,
        namesUnchanged: 0,
        namesSkippedHierarchy: 0,
        namesFailed: 0
    };
}

function addNameResult(stats, result) {
    if (!result) return;
    if (result.status === 'changed') stats.namesChanged += 1;
    else if (result.status === 'unchanged') stats.namesUnchanged += 1;
    else if (result.status === 'skipped' && result.reason === 'hierarchy') stats.namesSkippedHierarchy += 1;
    else if (result.status === 'failed') stats.namesFailed += 1;
}

async function syncAllMembers(guild, { namesOnly = false } = {}) {
    const config = loadConfig();
    const members = await listGuildMembers(guild);
    const stats = newSyncStats();

    for (const member of members) {
        if (member.user?.bot) continue;
        stats.members += 1;
        const result = await syncMemberInternal(member, { config, namesOnly });
        if (result.rolesChanged) stats.rolesChanged += 1;
        addNameResult(stats, result.name);
    }

    return stats;
}

function syncSummary(stats, namesOnly = false) {
    if (namesOnly) {
        return `✅ Name sync finished for **${stats.members}** members.\n` +
            `✏️ Changed: **${stats.namesChanged}**\n` +
            `➖ Already correct: **${stats.namesUnchanged}**\n` +
            `🔒 Skipped (bot role too low / owner): **${stats.namesSkippedHierarchy}**\n` +
            `❌ Failed: **${stats.namesFailed}**`;
    }

    return `✅ Member sync finished for **${stats.members}** members.\n` +
        `🔗 Members with role changes: **${stats.rolesChanged}**\n` +
        `✏️ Names changed: **${stats.namesChanged}**\n` +
        `🔒 Names skipped by hierarchy: **${stats.namesSkippedHierarchy}**\n` +
        `❌ Name failures: **${stats.namesFailed}**`;
}

async function showOrUpdate(interaction, container) {
    const payload = { components: [container] };
    if (interaction.isButton() || interaction.isAnySelectMenu()) {
        await interaction.update(payload);
    } else {
        await interaction.reply(componentsV2Reply(container));
    }
}

async function handleInteraction(interaction) {
    const id = interaction.customId;
    if (!id || (!id.startsWith('rolebind_') && !id.startsWith('rolename_'))) return false;

    if (!canManage(interaction)) {
        await interaction.reply({
            content: '❌ You do not have permission to manage role bindings.',
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    const config = loadConfig();

    // Old dashboard IDs remain supported so the previous dashboard does not break.
    if (id === 'rolebind_add') {
        setEditState(interaction, 'binding', { id: `binding-${Date.now()}`, isNew: true, triggerRoleIds: [], linkedRoleIds: [] });
        await interaction.reply(componentsV2Reply(buildBindingEditor(interaction.guild, getEditState(interaction, 'binding'))));
        return true;
    }
    if (id === 'rolebind_edit' || id === 'rolebind_manage') {
        clearEditState(interaction, 'binding');
        await interaction.reply(componentsV2Reply(buildBindingManager(interaction.guild, config)));
        return true;
    }
    if (id === 'rolename_add') {
        setEditState(interaction, 'name', { id: `nick-${Date.now()}`, isNew: true, roleId: null, prefix: '', nameMode: 'display_roblox', excludedRoleIds: [] });
        await interaction.reply(componentsV2Reply(buildNameEditor(interaction.guild, getEditState(interaction, 'name'))));
        return true;
    }
    if (id === 'rolename_edit' || id === 'rolename_manage') {
        clearEditState(interaction, 'name');
        await interaction.reply(componentsV2Reply(buildNameManager(interaction.guild, config)));
        return true;
    }

    if (id === 'rolebind_manager_close' || id === 'rolename_manager_close') {
        const closed = new ContainerBuilder().addTextDisplayComponents(
            new TextDisplayBuilder().setContent('✅ Manager closed.')
        );
        await interaction.update({ components: [closed] });
        return true;
    }

    if (id === 'rolebind_new') {
        setEditState(interaction, 'binding', { id: `binding-${Date.now()}`, isNew: true, triggerRoleIds: [], linkedRoleIds: [] });
        await interaction.update({ components: [buildBindingEditor(interaction.guild, getEditState(interaction, 'binding'))] });
        return true;
    }

    if (id === 'rolebind_manager_select' && interaction.isStringSelectMenu()) {
        const binding = config.bindings.find(x => x.id === interaction.values[0]);
        if (!binding) {
            await interaction.reply({ content: '❌ That binding no longer exists.', flags: MessageFlags.Ephemeral });
            return true;
        }
        setEditState(interaction, 'binding', {
            id: binding.id,
            isNew: false,
            triggerRoleIds: uniqueIds(binding.triggerRoleIds),
            linkedRoleIds: uniqueIds(binding.linkedRoleIds)
        });
        await interaction.update({ components: [buildBindingEditor(interaction.guild, getEditState(interaction, 'binding'))] });
        return true;
    }

    if (id === 'rolebind_editor_triggers' && interaction.isRoleSelectMenu()) {
        const state = getEditState(interaction, 'binding');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Role Bindings again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        state.triggerRoleIds = uniqueIds(interaction.values);
        setEditState(interaction, 'binding', state);
        await interaction.update({ components: [buildBindingEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolebind_editor_linked' && interaction.isRoleSelectMenu()) {
        const state = getEditState(interaction, 'binding');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Role Bindings again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        state.linkedRoleIds = uniqueIds(interaction.values);
        setEditState(interaction, 'binding', state);
        await interaction.update({ components: [buildBindingEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolebind_editor_save') {
        const state = getEditState(interaction, 'binding');
        if (!state || !state.triggerRoleIds?.length || !state.linkedRoleIds?.length) {
            await interaction.reply({ content: '❌ Choose at least one trigger role and one role to give.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const currentConfig = loadConfig();
        const binding = {
            id: state.id,
            triggerRoleIds: uniqueIds(state.triggerRoleIds),
            linkedRoleIds: uniqueIds(state.linkedRoleIds)
        };
        const index = currentConfig.bindings.findIndex(x => x.id === state.id);
        if (index >= 0) currentConfig.bindings[index] = { ...currentConfig.bindings[index], ...binding };
        else currentConfig.bindings.push(binding);
        saveConfig(currentConfig);
        clearEditState(interaction, 'binding');
        await interaction.update({ components: [buildBindingManager(interaction.guild, currentConfig)] });
        await refreshDashboard(interaction.client);
        return true;
    }

    if (id === 'rolebind_editor_delete') {
        const state = getEditState(interaction, 'binding');
        if (!state || state.isNew) {
            await interaction.reply({ content: '❌ Nothing to delete.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const currentConfig = loadConfig();
        currentConfig.bindings = currentConfig.bindings.filter(x => x.id !== state.id);
        saveConfig(currentConfig);
        clearEditState(interaction, 'binding');
        await interaction.update({ components: [buildBindingManager(interaction.guild, currentConfig)] });
        await refreshDashboard(interaction.client);
        return true;
    }

    if (id === 'rolebind_editor_back') {
        clearEditState(interaction, 'binding');
        await interaction.update({ components: [buildBindingManager(interaction.guild, loadConfig())] });
        return true;
    }

    if (id === 'rolename_new') {
        setEditState(interaction, 'name', {
            id: `nick-${Date.now()}`,
            isNew: true,
            roleId: null,
            prefix: '',
            nameMode: 'display_roblox',
            excludedRoleIds: []
        });
        await interaction.update({ components: [buildNameEditor(interaction.guild, getEditState(interaction, 'name'))] });
        return true;
    }

    if (id === 'rolename_manager_select' && interaction.isStringSelectMenu()) {
        const rule = config.nicknameRules.find(x => x.id === interaction.values[0]);
        if (!rule) {
            await interaction.reply({ content: '❌ That naming rule no longer exists.', flags: MessageFlags.Ephemeral });
            return true;
        }
        setEditState(interaction, 'name', {
            id: rule.id,
            isNew: false,
            roleId: rule.roleId,
            prefix: rule.prefix || '',
            nameMode: rule.nameMode || 'display_roblox',
            excludedRoleIds: uniqueIds(rule.excludedRoleIds)
        });
        await interaction.update({ components: [buildNameEditor(interaction.guild, getEditState(interaction, 'name'))] });
        return true;
    }

    if (id === 'rolename_editor_role' && interaction.isRoleSelectMenu()) {
        const state = getEditState(interaction, 'name');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Name Rules again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        state.roleId = interaction.values[0] || null;
        setEditState(interaction, 'name', state);
        await interaction.update({ components: [buildNameEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolename_editor_mode' && interaction.isStringSelectMenu()) {
        const state = getEditState(interaction, 'name');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Name Rules again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        state.nameMode = interaction.values[0] || 'display_roblox';
        setEditState(interaction, 'name', state);
        await interaction.update({ components: [buildNameEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolename_editor_excludes' && interaction.isRoleSelectMenu()) {
        const state = getEditState(interaction, 'name');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Name Rules again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        state.excludedRoleIds = uniqueIds(interaction.values);
        setEditState(interaction, 'name', state);
        await interaction.update({ components: [buildNameEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolename_editor_clear_excludes') {
        const state = getEditState(interaction, 'name');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Name Rules again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        state.excludedRoleIds = [];
        setEditState(interaction, 'name', state);
        await interaction.update({ components: [buildNameEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolename_editor_prefix') {
        const state = getEditState(interaction, 'name');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Name Rules again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        await interaction.showModal(makePrefixModal(state));
        return true;
    }

    if (id === 'rolename_prefix_modal' && interaction.isModalSubmit()) {
        const state = getEditState(interaction, 'name');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Name Rules again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        state.prefix = interaction.fields.getTextInputValue('name_prefix').replace(/[^A-Za-z]/g, '').slice(0, 16);
        setEditState(interaction, 'name', state);
        await interaction.reply({ content: `✅ Prefix set to **${state.prefix || 'none'}**. Return to the editor and press **Save** when ready.`, flags: MessageFlags.Ephemeral });
        return true;
    }

    if (id === 'rolename_editor_save') {
        const state = getEditState(interaction, 'name');
        if (!state || !state.roleId) {
            await interaction.reply({ content: '❌ Choose the Discord role this naming rule applies to.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const currentConfig = loadConfig();
        const rule = {
            id: state.id,
            roleId: state.roleId,
            prefix: String(state.prefix || '').replace(/[^A-Za-z]/g, '').slice(0, 16),
            nameMode: state.nameMode === 'discord_username' ? 'discord_username' : 'display_roblox',
            excludedRoleIds: uniqueIds(state.excludedRoleIds)
        };
        const index = currentConfig.nicknameRules.findIndex(x => x.id === state.id);
        if (index >= 0) currentConfig.nicknameRules[index] = rule;
        else currentConfig.nicknameRules.push(rule);
        saveConfig(currentConfig);
        clearEditState(interaction, 'name');
        await interaction.update({ components: [buildNameManager(interaction.guild, currentConfig)] });
        await refreshDashboard(interaction.client);
        return true;
    }

    if (id === 'rolename_editor_delete') {
        const state = getEditState(interaction, 'name');
        if (!state || state.isNew) {
            await interaction.reply({ content: '❌ Nothing to delete.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const currentConfig = loadConfig();
        currentConfig.nicknameRules = currentConfig.nicknameRules.filter(x => x.id !== state.id);
        saveConfig(currentConfig);
        clearEditState(interaction, 'name');
        await interaction.update({ components: [buildNameManager(interaction.guild, currentConfig)] });
        await refreshDashboard(interaction.client);
        return true;
    }

    if (id === 'rolename_editor_back') {
        clearEditState(interaction, 'name');
        await interaction.update({ components: [buildNameManager(interaction.guild, loadConfig())] });
        return true;
    }

    if (id === 'rolebind_sync_roles') {
        const currentConfig = loadConfig();
        const result = cleanupDeletedRoles(interaction.guild, currentConfig);
        currentConfig.lastRoleSyncAt = new Date().toISOString();
        saveConfig(currentConfig);
        await refreshDashboard(interaction.client);
        await interaction.reply({
            content:
                `✅ Role list refreshed. **${Math.max(0, interaction.guild.roles.cache.size - 1)}** server roles are available in the role pickers.\n` +
                `Removed **${result.removedBindings}** invalid binding(s), **${result.removedNames}** invalid naming rule(s), and **${result.cleanedReferences}** deleted role reference(s).`,
            flags: MessageFlags.Ephemeral
        });
        return true;
    }

    if (id === 'rolebind_sync_members') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const stats = await syncAllMembers(interaction.guild, { namesOnly: false });
        const currentConfig = loadConfig();
        currentConfig.lastMemberSyncAt = new Date().toISOString();
        currentConfig.lastNameSyncAt = currentConfig.lastMemberSyncAt;
        saveConfig(currentConfig);
        await refreshDashboard(interaction.client);
        await interaction.editReply({ content: syncSummary(stats, false) });
        return true;
    }

    if (id === 'rolename_sync_names') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const stats = await syncAllMembers(interaction.guild, { namesOnly: true });
        const currentConfig = loadConfig();
        currentConfig.lastNameSyncAt = new Date().toISOString();
        saveConfig(currentConfig);
        await refreshDashboard(interaction.client);
        await interaction.editReply({ content: syncSummary(stats, true) });
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
    cleanupDeletedRoles(role.guild, config);
    saveConfig(config);

    // Recalculate members from the remaining bindings so a deleted trigger does
    // not leave stale automatically-managed roles behind.
    for (const member of role.guild.members.cache.values()) {
        if (!member.user?.bot) await syncMember(member);
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
