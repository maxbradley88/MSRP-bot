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

    'session-shutdown': [
        '1548126738876342272'
    ],

    'force-shutdown': [
        '1548126738876342272'
    ]
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

function canUseCommand(
    interaction
) {
    const commandName =
        interaction.commandName;

    /*
     * If the command isn't in the permissions
     * file yet, block it.
     *
     * This means we don't accidentally create
     * unrestricted staff commands.
     */
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
        commandPermissions[
            commandName
        ];


    /*
     * Empty role list = everyone allowed.
     */
    if (
        allowedRoles.length === 0
    ) {
        return true;
    }


    /*
     * Administrator bypass.
     */
    if (
        settings.administratorsBypass &&
        interaction.memberPermissions?.has(
            'Administrator'
        )
    ) {
        return true;
    }


    /*
     * Check whether the member has
     * at least one allowed role.
     */
    const memberRoles =
        interaction.member?.roles?.cache;

    if (!memberRoles) {
        return false;
    }


    return allowedRoles.some(
        roleId =>
            memberRoles.has(
                roleId
            )
    );
}


/*
 * ======================================================
 * HANDLE PERMISSION
 * ======================================================
 */

async function checkCommandPermission(
    interaction
) {
    if (
        canUseCommand(
            interaction
        )
    ) {
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