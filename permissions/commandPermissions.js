const { MessageFlags } = require('discord.js');

const FOUNDERSHIP_ROLE_ID = '1547525713853288448';
const SESSION_CONTROL_ROLE_ID = '1548126738876342272';
const EVENT_TEAM_ROLE_ID = '1558396994601615460';

const commandPermissions = {
    'send-ticket-dashboard': [FOUNDERSHIP_ROLE_ID],
    'send-session-dashboard': [FOUNDERSHIP_ROLE_ID],
    'send-role-dashboard': [FOUNDERSHIP_ROLE_ID],
    'set-session-times': [FOUNDERSHIP_ROLE_ID],
    'reaction-role-message': [FOUNDERSHIP_ROLE_ID],

    'session-vote': [SESSION_CONTROL_ROLE_ID],
    'cancel-session-vote': [SESSION_CONTROL_ROLE_ID],
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
    'form-manage': [FOUNDERSHIP_ROLE_ID],
    'send-media-dashboard': [FOUNDERSHIP_ROLE_ID, '1550808851538780160', '1564210385903419503'],
    'coc-team-add': [FOUNDERSHIP_ROLE_ID],
    'coc-team-remove': [FOUNDERSHIP_ROLE_ID],

    // Event system — only the Event Team can create/manage events.
    'create-event': [EVENT_TEAM_ROLE_ID],
    'create-giveaway': ['1561287581897982042'],
    'infract': ['1547535121320779796', '1547525713853288448', '1547539082752561274', '1547536815475396668'],
    'revoke-infraction': ['1547535121320779796', '1547525713853288448', '1547535997762277397'],
    'promote': ['1547535121320779796', '1547525713853288448', '1547536815475396668'],
    // Anyone may submit a review, but the review handler restricts the channel.
    'review': [],
    'send-staff-dashboard': [FOUNDERSHIP_ROLE_ID],
    'add-staff-guide': [FOUNDERSHIP_ROLE_ID],
    'remove-staff-guide': [FOUNDERSHIP_ROLE_ID],
    'send-request-dashboard': [FOUNDERSHIP_ROLE_ID],
    'host-training': ['1547543294056333323'],
    'send-result-dashboard': [FOUNDERSHIP_ROLE_ID],
    'resignation-log': ['1547535121320779796', FOUNDERSHIP_ROLE_ID]
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
    EVENT_TEAM_ROLE_ID,
    checkCommandPermission
};
