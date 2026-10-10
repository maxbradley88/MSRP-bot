const {
    PermissionFlagsBits
} = require('discord.js');

const config = require('./ticketConfig');
const ticketState = require('./ticketState');

function getReportsAppealsRoleId() {
    return (
        config.reportsAppealsStaffRoleId ||
        config.reportsAppealsRoleId
    );
}

function getDepartmentKeyFromParentId(parentId) {
    if (parentId === config.supportTicketCategoryId) {
        return 'support';
    }

    if (parentId === config.seniorTicketCategoryId) {
        return 'senior';
    }

    if (parentId === config.reportsAppealsTicketCategoryId) {
        return 'reports_appeals';
    }

    return null;
}

function getTicketOwnerId(channel) {
    const match = String(channel?.topic || '')
        .match(/(?:^|\|)ticket-owner:(\d+)/);

    return match ? match[1] : null;
}

function getStaffRoleOverwrites(departmentKey) {
    const supportRoleId = config.supportStaffRoleId;
    const seniorRoleId = config.seniorSupportStaffRoleId;
    const reportsRoleId = getReportsAppealsRoleId();

    if (!supportRoleId || !seniorRoleId || !reportsRoleId) {
        throw new Error(
            'One or more ticket staff role IDs are missing from ticketConfig.'
        );
    }

    const viewOnlyAllow = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory
    ];

    const fullStaffAllow = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
    ];

    const hiddenDeny = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages
    ];

    if (departmentKey === 'support') {
        return [
            {
                id: supportRoleId,
                allow: viewOnlyAllow,
                deny: [PermissionFlagsBits.SendMessages]
            },
            {
                id: seniorRoleId,
                allow: fullStaffAllow
            },
            {
                id: reportsRoleId,
                deny: hiddenDeny
            }
        ];
    }

    if (departmentKey === 'senior') {
        return [
            {
                id: supportRoleId,
                deny: hiddenDeny
            },
            {
                id: seniorRoleId,
                allow: fullStaffAllow
            },
            {
                id: reportsRoleId,
                deny: hiddenDeny
            }
        ];
    }

    if (departmentKey === 'reports_appeals') {
        return [
            {
                id: supportRoleId,
                deny: hiddenDeny
            },
            {
                id: seniorRoleId,
                allow: fullStaffAllow
            },
            {
                id: reportsRoleId,
                allow: viewOnlyAllow,
                deny: [PermissionFlagsBits.SendMessages]
            }
        ];
    }

    throw new Error(
        `Unknown ticket department: ${departmentKey}`
    );
}

function buildTicketPermissionOverwrites(
    guild,
    ownerId,
    departmentKey,
    claimedBy = null,
    additionalCustomerIds = []
) {
    if (!guild?.roles?.everyone?.id) {
        throw new Error('Guild permission data is unavailable.');
    }

    if (!ownerId) {
        throw new Error('Ticket owner ID is required.');
    }

    const botId = guild.members?.me?.id;

    if (!botId) {
        throw new Error('Bot guild member could not be found.');
    }

    const overwrites = [
        {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: ownerId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory
            ]
        },
        ...getStaffRoleOverwrites(departmentKey),
        {
            id: botId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ManageMessages
            ]
        }
    ];

    /*
     * SS/R&A are denied SendMessages at their role level until someone
     * claims the ticket. A member-specific allow overrides that role deny,
     * so only the individual claimant can type.
     *
     * SSS already has full role access, but adding the claimant overwrite is
     * harmless if an SSS member is the claimant and keeps this logic simple.
     */
    if (
        claimedBy &&
        claimedBy !== ownerId &&
        claimedBy !== botId
    ) {
        overwrites.push({
            id: claimedBy,
            allow: [
                PermissionFlagsBits.SendMessages
            ]
        });
    }

    for (const customerId of additionalCustomerIds || []) {
        if (
            !customerId ||
            customerId === ownerId ||
            customerId === botId
        ) {
            continue;
        }

        overwrites.push({
            id: customerId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        });
    }

    return overwrites;
}

async function applyTicketPermissions(
    channel,
    {
        departmentKey = null,
        claimedBy = null,
        reason = 'Sync MSRP ticket permissions'
    } = {}
) {
    if (!channel?.guild || !channel?.permissionOverwrites) {
        throw new Error('Ticket channel permission manager is unavailable.');
    }

    const resolvedDepartment =
        departmentKey ||
        getDepartmentKeyFromParentId(channel.parentId);

    if (!resolvedDepartment) {
        throw new Error(
            'Ticket channel is not inside a recognised ticket department.'
        );
    }

    const ownerId = getTicketOwnerId(channel);

    if (!ownerId) {
        throw new Error('Ticket owner could not be read from the channel topic.');
    }

    const overwrites = buildTicketPermissionOverwrites(
        channel.guild,
        ownerId,
        resolvedDepartment,
        claimedBy,
        ticketState.getAdditionalCustomerIds(channel)
    );

    await channel.permissionOverwrites.set(
        overwrites,
        reason
    );

    return true;
}

module.exports = {
    getDepartmentKeyFromParentId,
    getTicketOwnerId,
    buildTicketPermissionOverwrites,
    applyTicketPermissions
};
