const fs = require('node:fs');
const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    LabelBuilder,
    MessageFlags,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    ModalBuilder,
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
const DASHBOARD_IMAGE = path.join(__dirname, '..', 'images', 'image.png');

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
        lastNameSyncAt: null,
        lastSystemSyncAt: null,
        lastPublishAt: null
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
    value.lastSystemSyncAt ||= null;
    value.lastPublishAt ||= null;
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

function buildDashboardPayload(config, { includeFile = false } = {}) {
    const manageMenu = new StringSelectMenuBuilder()
        .setCustomId('rolebind_dashboard_manage')
        .setPlaceholder('Manage role system…')
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Role Bindings')
                .setDescription('Create or edit automatic role bindings')
                .setEmoji('🔗')
                .setValue('bindings'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Name Rules')
                .setDescription('Create or edit nickname rules')
                .setEmoji('🏷️')
                .setValue('names')
        );

    const container = new ContainerBuilder()
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://role-dashboard.png')
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '## Role Management\n' +
                'Manage automatic staff roles and nickname formatting from one place.\n\n' +
                `🔗 **${config.bindings.length}** role bindings  •  🏷️ **${config.nicknameRules.length}** name rules\n` +
                `🔄 **Last sync:** ${timestampText(config.lastSystemSyncAt || config.lastRoleSyncAt)}\n` +
                `🚀 **Last publish:** ${timestampText(config.lastPublishAt || config.lastMemberSyncAt)}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('rolebind_sync_system')
                    .setLabel('Sync System')
                    .setEmoji('🔄')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('rolebind_publish')
                    .setLabel('Publish Changes')
                    .setEmoji('🚀')
                    .setStyle(ButtonStyle.Success)
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(new ActionRowBuilder().addComponents(manageMenu))
        .addSeparatorComponents(new SeparatorBuilder());

    const payload = { flags: MessageFlags.IsComponentsV2, components: [container] };
    if (includeFile) {
        payload.files = [{ attachment: DASHBOARD_IMAGE, name: 'role-dashboard.png' }];
    }
    return payload;
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
    const message = await interaction.channel.send(buildDashboardPayload(config, { includeFile: true }));
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

function selectableRoles(guild) {
    return [...guild.roles.cache.values()]
        .filter(role => role.id !== guild.id && !role.managed)
        .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
}

function rolePage(guild, page = 0, pageSize = 20) {
    const roles = selectableRoles(guild);
    const totalPages = Math.max(1, Math.ceil(roles.length / pageSize));
    const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
    return {
        roles: roles.slice(safePage * pageSize, safePage * pageSize + pageSize),
        page: safePage,
        totalPages,
        totalRoles: roles.length
    };
}

function buildRolePageSelect(guild, customId, selectedIds, page, placeholder, { single = false } = {}) {
    const info = rolePage(guild, page);
    const selected = new Set(uniqueIds(selectedIds));
    const menu = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(`${placeholder} • Page ${info.page + 1}/${info.totalPages}`)
        .setMinValues(single ? 1 : 0)
        .setMaxValues(single ? 1 : Math.max(1, info.roles.length));

    menu.addOptions(info.roles.map(role =>
        new StringSelectMenuOptionBuilder()
            .setLabel(role.name.slice(0, 100))
            .setValue(role.id)
            .setDescription(`Position ${role.position}`)
            .setDefault(selected.has(role.id))
    ));

    return { menu, info };
}

function pageButtons(prefix, info) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}_prev`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(info.page <= 0),
        new ButtonBuilder()
            .setCustomId(`${prefix}_next`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(info.page >= info.totalPages - 1)
    );
}

function buildBindingEditor(guild, state) {
    state.triggerPage ||= 0;
    state.linkedPage ||= 0;

    const triggerPicker = buildRolePageSelect(
        guild,
        'rolebind_editor_triggers',
        state.triggerRoleIds,
        state.triggerPage,
        'Choose trigger roles'
    );
    const linkedPicker = buildRolePageSelect(
        guild,
        'rolebind_editor_linked',
        state.linkedRoleIds,
        state.linkedPage,
        'Choose roles to give'
    );

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${state.isNew ? '## ➕ Create Role Binding' : '## ✏️ Edit Role Binding'}\n` +
                `**If they have:** ${roleNames(guild, state.triggerRoleIds, 8)}\n` +
                `**Automatically give:** ${roleNames(guild, state.linkedRoleIds, 8)}\n\n` +
                `All **${triggerPicker.info.totalRoles}** usable server roles are available below. Use Previous/Next to browse every role.`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Trigger roles'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(triggerPicker.menu))
        .addActionRowComponents(pageButtons('rolebind_trigger_page', triggerPicker.info))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Roles to automatically give'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(linkedPicker.menu))
        .addActionRowComponents(pageButtons('rolebind_linked_page', linkedPicker.info))
        .addSeparatorComponents(new SeparatorBuilder())
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rolebind_editor_save').setLabel('Save').setEmoji('💾').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('rolebind_editor_delete').setLabel('Delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(state.isNew),
                new ButtonBuilder().setCustomId('rolebind_editor_back').setLabel('Back').setStyle(ButtonStyle.Secondary)
            )
        );
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
                                : 'Discord display name (Roblox username)'
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
    state.rolePage ||= 0;
    state.excludePage ||= 0;

    const rolePicker = buildRolePageSelect(
        guild,
        'rolename_editor_role',
        state.roleId ? [state.roleId] : [],
        state.rolePage,
        'Choose rule role',
        { single: true }
    );
    const excludePicker = buildRolePageSelect(
        guild,
        'rolename_editor_excludes',
        state.excludedRoleIds,
        state.excludePage,
        'Optional excluded roles'
    );

    const mode = new StringSelectMenuBuilder()
        .setCustomId('rolename_editor_mode')
        .setPlaceholder('Choose name format…')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel('Discord display name (Roblox username)')
                .setDescription('Example: CD・Max (RobloxName)')
                .setValue('display_roblox')
                .setDefault(state.nameMode !== 'discord_username'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Discord username')
                .setDescription('Example: UNVERIFIED・maxbradley')
                .setValue('discord_username')
                .setDefault(state.nameMode === 'discord_username')
        );

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${state.isNew ? '## ➕ Create Name Rule' : '## ✏️ Edit Name Rule'}\n` +
                `**Role:** ${state.roleId ? roleName(guild, state.roleId) : 'Not selected'}\n` +
                `**Prefix:** ${state.prefix || 'No prefix'}\n` +
                `**Format:** ${state.nameMode === 'discord_username' ? 'Discord username' : 'Discord display name (Roblox username)'}\n` +
                `**Excluded roles:** ${roleNames(guild, state.excludedRoleIds, 8)}\n\n` +
                `All **${rolePicker.info.totalRoles}** usable server roles are available. Browse pages to find any role.`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Role'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(rolePicker.menu))
        .addActionRowComponents(pageButtons('rolename_role_page', rolePicker.info))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Name format'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(mode))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('### Optional excluded roles'))
        .addActionRowComponents(new ActionRowBuilder().addComponents(excludePicker.menu))
        .addActionRowComponents(pageButtons('rolename_exclude_page', excludePicker.info))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('rolename_editor_prefix').setLabel('Set Prefix').setEmoji('🔤').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('rolename_editor_clear_excludes').setLabel('Clear Exclusions').setStyle(ButtonStyle.Secondary).setDisabled(!uniqueIds(state.excludedRoleIds).length)
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

function extractRobloxIdentity(value, depth = 0, seen = new Set()) {
    if (value == null || depth > 6) return { username: null, id: null };
    if (typeof value !== 'object') return { username: null, id: null };
    if (seen.has(value)) return { username: null, id: null };
    seen.add(value);

    const usernameKeys = [
        'robloxUsername', 'roblox_username', 'robloxName', 'roblox_name',
        'username', 'userName', 'name'
    ];
    const idKeys = [
        'robloxId', 'roblox_id', 'robloxUserId', 'roblox_user_id',
        'userId', 'user_id'
    ];

    let username = null;
    let id = null;

    for (const key of usernameKeys) {
        const candidate = value?.[key];
        if (typeof candidate === 'string' && candidate.trim() && !/^\d+$/.test(candidate.trim())) {
            username = candidate.trim();
            break;
        }
    }
    for (const key of idKeys) {
        const candidate = value?.[key];
        if ((typeof candidate === 'string' || typeof candidate === 'number') && /^\d+$/.test(String(candidate))) {
            id = String(candidate);
            break;
        }
    }

    const preferredChildren = ['roblox', 'robloxUser', 'roblox_user', 'verification', 'connection', 'user', 'data', 'member'];
    for (const key of preferredChildren) {
        const child = value?.[key];
        if (!child || typeof child !== 'object') continue;
        const nested = extractRobloxIdentity(child, depth + 1, seen);
        username ||= nested.username;
        id ||= nested.id;
        if (username && id) return { username, id };
    }

    for (const child of Object.values(value)) {
        if (!child || typeof child !== 'object') continue;
        const nested = extractRobloxIdentity(child, depth + 1, seen);
        username ||= nested.username;
        id ||= nested.id;
        if (username && id) break;
    }

    return { username, id };
}

async function resolveRobloxUsernameById(robloxId) {
    if (!robloxId) return null;
    try {
        const response = await fetch(`https://users.roblox.com/v1/users/${encodeURIComponent(robloxId)}`);
        if (!response.ok) return null;
        const body = await response.json();
        return typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null;
    } catch {
        return null;
    }
}

async function getRobloxUsername(discordId) {
    const cached = robloxCache.get(discordId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let identity = { username: null, id: null };
    try {
        const connection = await getMelonlyRobloxConnectionByDiscordId(discordId);
        identity = extractRobloxIdentity(connection);
    } catch {}

    if (!identity.username) {
        try {
            const member = await getMelonlyMemberByDiscordId(discordId);
            const memberIdentity = extractRobloxIdentity(member);
            identity.username ||= memberIdentity.username;
            identity.id ||= memberIdentity.id;
        } catch {}
    }

    if (!identity.username && identity.id) {
        identity.username = await resolveRobloxUsernameById(identity.id);
    }

    robloxCache.set(discordId, {
        value: identity.username || null,
        expiresAt: Date.now() + 15 * 60 * 1000
    });
    return identity.username || null;
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

    if (id === 'rolebind_dashboard_manage' && interaction.isStringSelectMenu()) {
        const choice = interaction.values[0];
        if (choice === 'bindings') {
            clearEditState(interaction, 'binding');
            await interaction.reply(componentsV2Reply(buildBindingManager(interaction.guild, config)));
        } else {
            clearEditState(interaction, 'name');
            await interaction.reply(componentsV2Reply(buildNameManager(interaction.guild, config)));
        }
        return true;
    }

    // Old dashboard IDs remain supported so the previous dashboard does not break.
    if (id === 'rolebind_add') {
        setEditState(interaction, 'binding', { id: `binding-${Date.now()}`, isNew: true, triggerRoleIds: [], linkedRoleIds: [], triggerPage: 0, linkedPage: 0 });
        await interaction.reply(componentsV2Reply(buildBindingEditor(interaction.guild, getEditState(interaction, 'binding'))));
        return true;
    }
    if (id === 'rolebind_edit' || id === 'rolebind_manage') {
        clearEditState(interaction, 'binding');
        await interaction.reply(componentsV2Reply(buildBindingManager(interaction.guild, config)));
        return true;
    }
    if (id === 'rolename_add') {
        setEditState(interaction, 'name', { id: `nick-${Date.now()}`, isNew: true, roleId: null, prefix: '', nameMode: 'display_roblox', excludedRoleIds: [], rolePage: 0, excludePage: 0 });
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
        setEditState(interaction, 'binding', { id: `binding-${Date.now()}`, isNew: true, triggerRoleIds: [], linkedRoleIds: [], triggerPage: 0, linkedPage: 0 });
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
            linkedRoleIds: uniqueIds(binding.linkedRoleIds),
            triggerPage: 0,
            linkedPage: 0
        });
        await interaction.update({ components: [buildBindingEditor(interaction.guild, getEditState(interaction, 'binding'))] });
        return true;
    }

    if (id === 'rolebind_editor_triggers' && interaction.isStringSelectMenu()) {
        const state = getEditState(interaction, 'binding');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Role Bindings again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const pageIds = new Set(rolePage(interaction.guild, state.triggerPage).roles.map(r => r.id));
        state.triggerRoleIds = uniqueIds([...(state.triggerRoleIds || []).filter(id => !pageIds.has(id)), ...interaction.values]);
        setEditState(interaction, 'binding', state);
        await interaction.update({ components: [buildBindingEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolebind_editor_linked' && interaction.isStringSelectMenu()) {
        const state = getEditState(interaction, 'binding');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Role Bindings again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const pageIds = new Set(rolePage(interaction.guild, state.linkedPage).roles.map(r => r.id));
        state.linkedRoleIds = uniqueIds([...(state.linkedRoleIds || []).filter(id => !pageIds.has(id)), ...interaction.values]);
        setEditState(interaction, 'binding', state);
        await interaction.update({ components: [buildBindingEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolebind_trigger_page_prev' || id === 'rolebind_trigger_page_next') {
        const state = getEditState(interaction, 'binding');
        if (!state) return true;
        state.triggerPage = Math.max(0, (state.triggerPage || 0) + (id.endsWith('_next') ? 1 : -1));
        setEditState(interaction, 'binding', state);
        await interaction.update({ components: [buildBindingEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolebind_linked_page_prev' || id === 'rolebind_linked_page_next') {
        const state = getEditState(interaction, 'binding');
        if (!state) return true;
        state.linkedPage = Math.max(0, (state.linkedPage || 0) + (id.endsWith('_next') ? 1 : -1));
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
            excludedRoleIds: [],
            rolePage: 0,
            excludePage: 0
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
            excludedRoleIds: uniqueIds(rule.excludedRoleIds),
            rolePage: 0,
            excludePage: 0
        });
        await interaction.update({ components: [buildNameEditor(interaction.guild, getEditState(interaction, 'name'))] });
        return true;
    }

    if (id === 'rolename_editor_role' && interaction.isStringSelectMenu()) {
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

    if (id === 'rolename_editor_excludes' && interaction.isStringSelectMenu()) {
        const state = getEditState(interaction, 'name');
        if (!state) {
            await interaction.reply({ content: '❌ This editor expired. Open Name Rules again.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const pageIds = new Set(rolePage(interaction.guild, state.excludePage).roles.map(r => r.id));
        state.excludedRoleIds = uniqueIds([...(state.excludedRoleIds || []).filter(id => !pageIds.has(id)), ...interaction.values]);
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

    if (id === 'rolename_role_page_prev' || id === 'rolename_role_page_next') {
        const state = getEditState(interaction, 'name');
        if (!state) return true;
        state.rolePage = Math.max(0, (state.rolePage || 0) + (id.endsWith('_next') ? 1 : -1));
        setEditState(interaction, 'name', state);
        await interaction.update({ components: [buildNameEditor(interaction.guild, state)] });
        return true;
    }

    if (id === 'rolename_exclude_page_prev' || id === 'rolename_exclude_page_next') {
        const state = getEditState(interaction, 'name');
        if (!state) return true;
        state.excludePage = Math.max(0, (state.excludePage || 0) + (id.endsWith('_next') ? 1 : -1));
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

    if (id === 'rolebind_sync_system' || id === 'rolebind_sync_roles') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try { await interaction.guild.roles.fetch(); } catch {}
        const currentConfig = loadConfig();
        const result = cleanupDeletedRoles(interaction.guild, currentConfig);
        robloxCache.clear();
        currentConfig.lastRoleSyncAt = new Date().toISOString();
        currentConfig.lastSystemSyncAt = currentConfig.lastRoleSyncAt;
        saveConfig(currentConfig);
        await refreshDashboard(interaction.client);
        await interaction.editReply({
            content:
                `✅ System sync complete. **${Math.max(0, selectableRoles(interaction.guild).length)}** usable Discord roles are loaded.\n` +
                `Cleaned **${result.removedBindings}** invalid binding(s), **${result.removedNames}** invalid name rule(s), and **${result.cleanedReferences}** deleted role reference(s).\n\n` +
                `Press **Publish Changes** when you want the saved rules applied to everyone.`
        });
        return true;
    }

    if (id === 'rolebind_publish' || id === 'rolebind_sync_members' || id === 'rolename_sync_names') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const namesOnly = id === 'rolename_sync_names';
        const stats = await syncAllMembers(interaction.guild, { namesOnly });
        const currentConfig = loadConfig();
        const now = new Date().toISOString();
        if (namesOnly) {
            currentConfig.lastNameSyncAt = now;
        } else {
            currentConfig.lastMemberSyncAt = now;
            currentConfig.lastNameSyncAt = now;
            currentConfig.lastPublishAt = now;
        }
        saveConfig(currentConfig);
        await refreshDashboard(interaction.client);
        await interaction.editReply({ content: namesOnly ? syncSummary(stats, true) : `🚀 **Changes published.**\n\n${syncSummary(stats, false)}` });
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
