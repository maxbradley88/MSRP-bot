const { MessageFlags } = require('discord.js');

const FOUNDERSHIP_ROLE_ID = '1547525713853288448';
const SESSION_CONTROL_ROLE_ID = '1548126738876342272';

const commandPermissions = {
    'send-ticket-dashboard': [FOUNDERSHIP_ROLE_ID],
    'send-session-dashboard': [FOUNDERSHIP_ROLE_ID],
    'send-role-dashboard': [FOUNDERSHIP_ROLE_ID],
    'set-session-times': [FOUNDERSHIP_ROLE_ID],
    'reaction-role-message': [FOUNDERSHIP_ROLE_ID],

    'session-vote': [SESSION_CONTROL_ROLE_ID],
    'force-session': [SESSION_CONTROL_ROLE_ID],
    'session-shutdown': [SESSION_CONTROL_ROLE_ID],
    'force-shutdown': [SESSION_CONTROL_ROLE_ID],

    // Main dashboard configuration
    'send-dashboard': [FOUNDERSHIP_ROLE_ID],
    'add-dashboard-role': [FOUNDERSHIP_ROLE_ID],
    'remove-dashboard-role': [FOUNDERSHIP_ROLE_ID],
    'config-partnership-conditions': [FOUNDERSHIP_ROLE_ID],
    'set-rules': [FOUNDERSHIP_ROLE_ID],
    'departments-add': [FOUNDERSHIP_ROLE_ID],
    'departments-remove': [FOUNDERSHIP_ROLE_ID],
    'partnership-add': [FOUNDERSHIP_ROLE_ID],
    'partnership-remove': [FOUNDERSHIP_ROLE_ID],
    'application-manage': [FOUNDERSHIP_ROLE_ID],
    'coc-team-add': [FOUNDERSHIP_ROLE_ID],
    'coc-team-remove': [FOUNDERSHIP_ROLE_ID]
};

const settings = {
    administratorsBypass: true,
    noPermissionMessage: '❌ You do not have permission to use this command.'
};

function canUseCommand(interaction) {
    const commandName = interaction.commandName;

    if (!Object.prototype.hasOwnProperty.call(commandPermissions, commandName)) {
        console.warn(`[COMMAND PERMISSIONS] ${commandName} is not configured.`);
        return false;
    }

    const allowedRoles = commandPermissions[commandName];
    if (allowedRoles.length === 0) return true;

    if (
        settings.administratorsBypass &&
        interaction.memberPermissions?.has('Administrator')
    ) {
        return true;
    }

    const memberRoles = interaction.member?.roles?.cache;
    if (!memberRoles) return false;

    return allowedRoles.some(roleId => memberRoles.has(roleId));
}

async function checkCommandPermission(interaction) {
    if (canUseCommand(interaction)) return true;

    await interaction.reply({
        content: settings.noPermissionMessage,
        flags: MessageFlags.Ephemeral
    });

    return false;
}

module.exports = {
    commandPermissions,
    checkCommandPermission
};
