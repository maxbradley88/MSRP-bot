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
    const commandName = interaction.commandName;

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

    if (allowedRoles.length === 0) {
        return true;
    }

    if (
        settings.administratorsBypass &&
        interaction.memberPermissions?.has(
            'Administrator'
        )
    ) {
        return true;
    }

    let member = interaction.member;

    try {
        member =
            await interaction.guild.members.fetch(
                interaction.user.id
            );
    } catch (error) {
        console.error(
            '[COMMAND PERMISSIONS] Member fetch failed:',
            error
        );
    }

    let memberRoleIds = [];

    // Normal discord.js GuildMember
    if (member?.roles?.cache) {
        memberRoleIds =
            [...member.roles.cache.keys()];
    }

    // Fallback for raw interaction member data
    else if (Array.isArray(member?.roles)) {
        memberRoleIds =
            member.roles;
    }

    console.log(
        '========== COMMAND PERMISSION DEBUG =========='
    );

    console.log(
        'Command:',
        commandName
    );

    console.log(
        'User:',
        interaction.user.tag,
        interaction.user.id
    );

    console.log(
        'Allowed role IDs:',
        allowedRoles
    );

    console.log(
        'Member role IDs:',
        memberRoleIds
    );

    const allowed =
        allowedRoles.some(
            roleId =>
                memberRoleIds.includes(roleId)
        );

    console.log(
        'Allowed:',
        allowed
    );

    console.log(
        '=============================================='
    );

    return allowed;
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