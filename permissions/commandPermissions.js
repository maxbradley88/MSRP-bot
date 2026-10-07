const { MessageFlags } = require('discord.js');


/*
 * ======================================================
 * COMMAND PERMISSIONS
 * ======================================================
 *
 * Add every slash command here.
 *
 * Example:
 *
 * 'command-name': [
 *     'ROLE_ID_1',
 *     'ROLE_ID_2'
 * ]
 *
 * An empty array:
 *
 * []
 *
 * means EVERYONE can use the command.
 *
 * You can add/remove as many role IDs as you want.
 */

const commandPermissions = {

    'send-ticket-dashboard': [
        '1547525713853288448'
    ],

    'send-session-dashboard': [
        '1547525713853288448'
    ],

    'set-session-times': [
        '1547525713853288448'
    ],

    'reaction-role-message': [
    '1547525713853288448'
],

    'session-vote': [
    '1548126738876342272'
],

};


/*
 * ======================================================
 * SETTINGS
 * ======================================================
 */

const settings = {

    /*
     * If true, anyone with Discord Administrator
     * can use every command regardless of roles.
     */
    administratorsBypass: true,

    noPermissionMessage:
        '❌ You do not have permission to use this command.'

};


/*
 * ======================================================
 * PERMISSION CHECK
 * ======================================================
 */

async function canUseCommand(interaction) {
    const commandName =
        interaction.commandName;

    if (
        !Object.prototype.hasOwnProperty.call(
            commandPermissions,
            commandName
        )
    ) {
        console.warn(
            `[COMMAND PERMISSIONS] ${commandName} is not configured.`
        );

        return false;
    }

    const allowedRoles =
        commandPermissions[commandName];

    // Empty list = everyone can use it.
    if (allowedRoles.length === 0) {
        return true;
    }

    // Administrator bypass.
    if (
        settings.administratorsBypass &&
        interaction.memberPermissions?.has(
            'Administrator'
        )
    ) {
        return true;
    }

    // Fetch the member directly so we always get
    // their current Discord roles.
    const member =
        await interaction.guild.members
            .fetch(interaction.user.id)
            .catch(() => null);

    if (!member) {
        console.warn(
            `[COMMAND PERMISSIONS] Could not fetch member ${interaction.user.id}.`
        );

        return false;
    }

    const hasAllowedRole =
        allowedRoles.some(
            roleId =>
                member.roles.cache.has(roleId)
        );

    console.log(
        `[COMMAND PERMISSIONS] ${interaction.user.tag} using /${commandName}`
    );

    console.log(
        'Allowed roles:',
        allowedRoles
    );

    console.log(
        'Member roles:',
        member.roles.cache.map(
            role => `${role.name} (${role.id})`
        )
    );

    console.log(
        'Permission result:',
        hasAllowedRole
    );

    return hasAllowedRole;
}




/*
 * ======================================================
 * HANDLE PERMISSION
 * ======================================================
 */


async function checkCommandPermission(
    interaction
) {
    const allowed =
        await canUseCommand(
            interaction
        );

    if (allowed) {
        return true;
    }

    await interaction.reply({
        content:
            settings.noPermissionMessage,

        flags:
            MessageFlags.Ephemeral
    });

    return false;
}


module.exports = {
    commandPermissions,
    checkCommandPermission
};