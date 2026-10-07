require('dotenv').config();



const {

    Client,

    GatewayIntentBits,

    REST,

    Routes,

    MessageFlags,

    Partials,

    ModalBuilder,

    LabelBuilder,

    TextInputBuilder,

    TextInputStyle,

    StringSelectMenuBuilder,

    StringSelectMenuOptionBuilder,

    ContainerBuilder,

    SlashCommandBuilder,

    TextDisplayBuilder

} = require('discord.js');


const { createTicket } = require('./tickets/ticketCreate');

const ticketSetup = require('./tickets/ticketSetup');
const sendTicketDashboardCommand =
    new SlashCommandBuilder()
        .setName('send-ticket-dashboard')
        .setDescription('Sends the ticket dashboard.');

const config = require('./tickets/ticketConfig');
const { handleTicketHandoffInteraction } = require('./tickets/ticketHandoff');
const ticketState = require('./tickets/ticketState');
const ticketStatus = require('./tickets/ticketStatus');
const ticketPermissions = require('./tickets/ticketPermissions');
const { sendTicketCloseNotifications } = require('./tickets/ticketCloseMessage');
const {
    checkCommandPermission
} = require('./permissions/commandPermissions');

const reactionRole =
    require('./reactionRoles/reactionRole');

const sessionDashboardCommand =
    require('./sessions/sessionDashboardCommand');

const sessionTimesCommand =
    require('./sessions/sessionTimesCommand');

const {
    handleSessionButton
} = require('./sessions/sessionButtons');


const client = new Client({

    intents: [

        GatewayIntentBits.Guilds,

        GatewayIntentBits.GuildMembers,

        GatewayIntentBits.GuildMessageReactions,

        GatewayIntentBits.GuildMessages,

        GatewayIntentBits.MessageContent

    ],

      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]

});


require('./messages/sendMessage')(client);

const activeClaimChannels = new Set();

const CLOSE_LOG_CHANNEL_ID = '1556842177743556718';
const optimisticClaimStates = new Map();
const optimisticDepartmentStates = new Map();
const optimisticChannelNames = new Map();
const optimisticChannelTopics = new Map();
const ticketChannelEditVersions = new Map();
const ticketChannelEditPending = new Map();
const ticketChannelEditWorkers = new Map();
const ticketChannelEditRetryCounts = new Map();
const ticketStateSyncTimers = new Map();
const ticketStateSyncDesired = new Map();



// ======================================================

// HELPERS

// ======================================================



function hasSupportStaffRole(member) {
    return Boolean(
        member?.roles?.cache?.has(
            config.supportStaffRoleId
        )
    );
}

function hasReportsAppealsRole(member) {
    return Boolean(
        member?.roles?.cache?.has(
            config.reportsAppealsRoleId
        )
    );
}

function isSeniorSupportMember(member) {
    return Boolean(
        member?.roles?.cache?.has(
            config.seniorSupportStaffRoleId
        )
    );
}

function isSupportMember(member) {
    return (
        hasSupportStaffRole(member) ||
        isSeniorSupportMember(member) ||
        hasReportsAppealsRole(member)
    );
}



function isTicketOwnerStaffTestingAllowed(

    member,

    ownerId,

    userId

) {

    // Production mode: ticket creators can never use staff ticket actions
    // on their own ticket, even if they hold a staff role.
    return false;

}


function isRulesQuestion(question) {

    const text = [
        question?.id,
        question?.label,
        question?.placeholder
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return text.includes('rule');
}


function getRulesDeclineMessage() {

    return (
        '# You Must Agree o The Rules Before Creating a Ticket\n\n' +
        'Welcome to our **Support Channel!** Here, you can receive assistance, report or appeal a decision, request an interview for a rank, and ask any questions you may have.\n\n' +
        'Our friendly and dedicated staff are here to help you, but we ask that you treat them with the same respect and courtesy they show you. To ensure our support system remains a **safe, fair, and welcoming environment** for everyone, please follow the rules below:\n\n' +
        '## 1. Remain respectful to staff\n' +
        'Please communicate with all staff members in a polite and respectful manner.\n\n' +
        '## 2. Do not ping staff\n' +
        'Please do not directly ping, mention, or mass-mention staff members regarding your ticket.\n\n' +
        '## 3. Cooperate with staff requests\n' +
        'Please cooperate with reasonable requests made by our staff while your ticket is being handled.\n\n' +
        '## 4. Remember that staff are people too\n' +
        'Our staff volunteer their time to assist the community. Please be patient and respectful while they work to resolve your request.\n\n' +
        '## ⚠️ Failure to Follow the Rules\n' +
        'Failure to comply with any of the above rules may result in your **ticket being voided and the situation being referred for further investigation.**\n\n' +
        'By selecting **Yes** when creating a ticket, you confirm that you have read, understood, and agree to follow the rules of our Support System.\n\n' +
        '---\n\n' +
        '## MSRP Foundership Team'
    );

}


function getTicketOwnerId(channel) {

    const match =

        channel.topic?.match(

            /(?:^|\|)ticket-owner:(\d+)/

        );



    return match ? match[1] : null;

}



function getTicketType(channel) {

    const match =

        channel.topic?.match(

            /(?:^|\|)ticket-type:([^|]+)/

        );



    return match ? match[1] : null;

}



function getClaimedUserIdFromTopic(topic) {
    const match = String(topic || '').match(/(?:^|\|)claimed-by:(\d+)/);
    return match ? match[1] : null;
}

function getClaimedUserId(channel) {
    return ticketState.getClaimedUserId(channel);
}

function getTicketTypeName(channel) {

    const type =

        getTicketType(channel);



    if (

        type &&

        config.ticketTypes[type]

    ) {

        return (

            config.ticketTypes[type].name ||

            config.ticketTypes[type].label ||

            'support'

        );

    }



    return 'support';

}




function getTicketDepartmentFromKey(key) {
    if (key === 'support') {
        return {
            key: 'support',
            name: 'Support Tickets',
            categoryId: config.supportTicketCategoryId,
            roleId: config.supportStaffRoleId
        };
    }

    if (key === 'senior') {
        return {
            key: 'senior',
            name: 'Senior Support Tickets',
            categoryId: config.seniorTicketCategoryId,
            roleId: config.seniorSupportStaffRoleId
        };
    }

    if (key === 'reports_appeals') {
        return {
            key: 'reports_appeals',
            name: 'Reports & Appeals Tickets',
            categoryId: config.reportsAppealsTicketCategoryId,
            roleId: config.reportsAppealsRoleId
        };
    }

    return null;
}

function getTicketDepartmentFromParentId(parentId) {
    if (parentId === config.supportTicketCategoryId) {
        return getTicketDepartmentFromKey('support');
    }

    if (parentId === config.seniorTicketCategoryId) {
        return getTicketDepartmentFromKey('senior');
    }

    if (parentId === config.reportsAppealsTicketCategoryId) {
        return getTicketDepartmentFromKey('reports_appeals');
    }

    return null;
}

function getTicketDepartment(channel) {
    if (!channel) return null;

    // Permissions must always follow the channel's real Discord category.
    // Never use an optimistic department here, otherwise a failed/pending
    // handoff can temporarily give the wrong department access.
    return getTicketDepartmentFromParentId(channel.parentId);
}

function stripClaimedPrefix(channelName) {

    return String(channelName || '')
        .replace(
            /^(?:claimed-)+/i,
            ''
        );
}

function getEffectiveChannelName(channel) {
    return ticketState.getEffectiveName(channel);
}

function getEffectiveChannelTopic(channel) {
    return ticketState.getEffectiveTopic(channel);
}

function canRegularStaffUseTicketDepartment(member, channel) {
    const department = getTicketDepartment(channel);

    if (!department) return false;

    if (department.key === 'support') {
        return hasSupportStaffRole(member);
    }

    if (department.key === 'reports_appeals') {
        return hasReportsAppealsRole(member);
    }

    // Senior Support department is SSS-only.
    return false;
}

function getTicketActionPermission(member, channel, action, userId) {
    const isSenior = isSeniorSupportMember(member);
    const claimedBy = getClaimedUserId(channel);
    const department = getTicketDepartment(channel);

    if (action === 'claim') {
        // SSS can claim/take over tickets in any department.
        if (!isSenior) {
            if (!department || !canRegularStaffUseTicketDepartment(member, channel)) {
                return {
                    allowed: false,
                    claimedBy,
                    message: '❌ You do not have permission to claim tickets in this department.'
                };
            }

            if (claimedBy === userId) {
                return {
                    allowed: false,
                    claimedBy,
                    message: '❌ You have already claimed this ticket.'
                };
            }

            if (claimedBy) {
                return {
                    allowed: false,
                    claimedBy,
                    message: `❌ This ticket has already been claimed by <@${claimedBy}>.`
                };
            }

            return { allowed: true, claimedBy, isSenior: false };
        }

        if (claimedBy === userId) {
            return {
                allowed: false,
                claimedBy,
                message: '❌ You have already claimed this ticket.'
            };
        }

        return { allowed: true, claimedBy, isSenior: true };
    }

    if (action === 'close' || action === 'handoff') {
        // SSS can control any claimed ticket, regardless of who claimed it.
        if (isSenior) {
            if (!claimedBy) {
                return {
                    allowed: false,
                    claimedBy,
                    message: '❌ This ticket must be claimed first.'
                };
            }

            return { allowed: true, claimedBy, isSenior: true };
        }

        // SS and R/A can only act inside their own department.
        if (!department || !canRegularStaffUseTicketDepartment(member, channel)) {
            return {
                allowed: false,
                claimedBy,
                message: `❌ You do not have permission to ${action === 'close' ? 'close' : 'hand off'} tickets in this department.`
            };
        }

        // For regular staff, unclaimed or claimed by somebody else is the same:
        // they must personally claim the ticket first.
        if (!claimedBy || claimedBy !== userId) {
            return {
                allowed: false,
                claimedBy,
                message: '❌ You must claim this ticket first.'
            };
        }

        return { allowed: true, claimedBy, isSenior: false };
    }

    if (action === 'unclaim') {
        if (!isSenior) {
            return {
                allowed: false,
                claimedBy,
                message: '❌ Only Senior Support Staff can unclaim a ticket.'
            };
        }

        if (!claimedBy) {
            return {
                allowed: false,
                claimedBy,
                message: '❌ No one has claimed this ticket.'
            };
        }

        return { allowed: true, claimedBy, isSenior: true };
    }

    return {
        allowed: false,
        claimedBy,
        message: '❌ You do not have permission to use this ticket action.'
    };
}


function formatTicketChannelName(value) {
    const cleaned = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .replace(/[ _]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 90);

    return cleaned || null;
}


function buildHandoffChannelName(channel, ownerId, requestedName) {
    const prefix = formatTicketChannelName(requestedName);

    if (!prefix) {
        return null;
    }

    const baseName = stripClaimedPrefix(getEffectiveChannelName(channel));
    const ticketType = getTicketType(channel);

    let ownerUsername = null;

    if (ownerId) {
        ownerUsername =
            channel.guild?.members?.cache?.get(ownerId)?.user?.username ||
            client.users.cache.get(ownerId)?.username ||
            null;
    }

    const safeUsername = ownerUsername
        ? ownerUsername
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '')
        : null;

    const numberMatch = baseName.match(/-(\d{1,6})$/);

    if (safeUsername && numberMatch) {
        const suffix = `${safeUsername}-${numberMatch[1]}`;
        const maxPrefixLength =
            Math.max(1, 100 - suffix.length - 1);

        return `${prefix.slice(0, maxPrefixLength)}-${suffix}`;
    }

    if (
        ticketType &&
        baseName.toLowerCase().startsWith(
            `${String(ticketType).toLowerCase()}-`
        )
    ) {
        const suffix =
            baseName.slice(String(ticketType).length + 1);

        const maxPrefixLength =
            Math.max(1, 100 - suffix.length - 1);

        return `${prefix.slice(0, maxPrefixLength)}-${suffix}`;
    }

    return prefix.slice(0, 100);
}

function applyOptimisticTicketState(channel, updates = {}) {
    const version =
        (ticketChannelEditVersions.get(channel.id) || 0) + 1;

    ticketChannelEditVersions.set(channel.id, version);

    if (Object.prototype.hasOwnProperty.call(updates, 'claimedBy')) {
        optimisticClaimStates.set(channel.id, updates.claimedBy);
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'departmentKey')) {
        optimisticDepartmentStates.set(
            channel.id,
            updates.departmentKey
        );
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
        optimisticChannelNames.set(
            channel.id,
            updates.name
        );
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'topic')) {
        optimisticChannelTopics.set(
            channel.id,
            updates.topic
        );
    }

    return version;
}


function cancelScheduledTicketStateSync(channelId) {
    const timer = ticketStateSyncTimers.get(channelId);

    if (timer) {
        clearTimeout(timer);
        ticketStateSyncTimers.delete(channelId);
    }

    ticketStateSyncDesired.delete(channelId);
}

function scheduleTicketStateSync(
    channel,
    {
        name,
        topic,
        reason = 'Ticket state updated'
    },
    delay = 1500
) {
    if (!channel) return;

    const channelId = channel.id;

    cancelScheduledTicketStateSync(channelId);

    const desired = {
        name: String(name || channel.name || '').slice(0, 100),
        topic: String(topic ?? channel.topic ?? ''),
        reason
    };

    ticketStateSyncDesired.set(channelId, desired);

    const timer = setTimeout(async () => {
        ticketStateSyncTimers.delete(channelId);

        if (ticketStateSyncDesired.get(channelId) !== desired) {
            return;
        }

        try {
            if (
                String(channel.name || '').toLowerCase() ===
                    desired.name.toLowerCase() &&
                String(channel.topic || '') === desired.topic
            ) {
                optimisticChannelNames.set(channelId, desired.name);
                optimisticChannelTopics.set(channelId, desired.topic);
                optimisticClaimStates.set(
                    channelId,
                    getClaimedUserIdFromTopic(desired.topic)
                );
                ticketStateSyncDesired.delete(channelId);
                return;
            }

            const updatedChannel = await channel.edit({
                name: desired.name,
                topic: desired.topic,
                reason: desired.reason
            });

            if (ticketStateSyncDesired.get(channelId) !== desired) {
                return;
            }

            optimisticChannelNames.set(
                channelId,
                updatedChannel.name || desired.name
            );
            optimisticChannelTopics.set(
                channelId,
                updatedChannel.topic ?? desired.topic
            );
            optimisticClaimStates.set(
                channelId,
                getClaimedUserIdFromTopic(
                    updatedChannel.topic ?? desired.topic
                )
            );

            ticketStateSyncDesired.delete(channelId);
        } catch (error) {
            console.error('[TICKET STATE SYNC ERROR]', error);
            ticketStateSyncDesired.delete(channelId);
        }
    }, delay);

    ticketStateSyncTimers.set(channelId, timer);
}

function prepareTicketForHandoff(channel) {
    if (!channel) return;

    cancelScheduledTicketStateSync(channel.id);

    const nextVersion =
        (ticketChannelEditVersions.get(channel.id) || 0) + 1;

    ticketChannelEditVersions.set(channel.id, nextVersion);
    ticketChannelEditPending.delete(channel.id);
    ticketChannelEditRetryCounts.delete(channel.id);
}

function clearPersistedOptimisticState(channel, updatedChannel, version) {
    if (ticketChannelEditVersions.get(channel.id) !== version) {
        return;
    }

    // Keep the latest confirmed state in memory instead of immediately
    // falling back to a possibly stale discord.js channel cache.
    optimisticClaimStates.set(
        channel.id,
        getClaimedUserIdFromTopic(updatedChannel.topic)
    );

    const persistedDepartment =
        getTicketDepartmentFromParentId(
            updatedChannel.parentId
        );

    if (persistedDepartment) {
        optimisticDepartmentStates.set(
            channel.id,
            persistedDepartment.key
        );
    } else {
        optimisticDepartmentStates.delete(channel.id);
    }

    optimisticChannelNames.set(
        channel.id,
        updatedChannel.name || channel.name || ''
    );

    optimisticChannelTopics.set(
        channel.id,
        updatedChannel.topic || ''
    );
}

function clearFailedOptimisticState(channel, version) {
    if (ticketChannelEditVersions.get(channel.id) !== version) {
        return;
    }

    optimisticClaimStates.delete(channel.id);
    optimisticDepartmentStates.delete(channel.id);
    optimisticChannelNames.delete(channel.id);
    optimisticChannelTopics.delete(channel.id);
}

function startTicketChannelEditWorker(channelId) {
    if (
        ticketChannelEditWorkers.has(channelId)
    ) {
        return;
    }

    const worker = (async () => {
        // Small debounce so actions fired almost together can collapse
        // into one Discord API request.
        await new Promise(resolve =>
            setTimeout(resolve, 25)
        );

        while (true) {
            const job =
                ticketChannelEditPending.get(
                    channelId
                );

            if (!job) {
                break;
            }

            ticketChannelEditPending.delete(
                channelId
            );

            let updatedChannel = null;

            let lastError = null;

            for (let attempt = 1; attempt <= 3; attempt += 1) {
                try {
                    updatedChannel =
                        await job.channel.edit(
                            job.data
                        );

                    clearPersistedOptimisticState(
                        job.channel,
                        updatedChannel,
                        job.version
                    );

                    lastError = null;
                    break;
                } catch (error) {
                    lastError = error;

                    if (attempt < 3) {
                        await new Promise(resolve =>
                            setTimeout(resolve, 250 * attempt)
                        );
                    }
                }
            }

            if (!updatedChannel) {
                console.error(
                    `[${job.label} CHANNEL EDIT ERROR]`,
                    lastError
                );

                // Keep the accepted optimistic state. Discord channel-name
                // updates are heavily rate-limited, especially during rapid
                // Claim -> Unclaim -> Claim testing. Forgetting the optimistic
                // state here causes permissions and titles to fall back to
                // stale Discord cache data.
                if (
                    ticketChannelEditVersions.get(
                        channelId
                    ) === job.version
                ) {
                    const retryCount =
                        (ticketChannelEditRetryCounts.get(
                            channelId
                        ) || 0) + 1;

                    ticketChannelEditRetryCounts.set(
                        channelId,
                        retryCount
                    );

                    // Retry the latest desired state a few times in the
                    // background. Newer actions replace this state/version,
                    // so an old retry can never overwrite a newer action.
                    if (retryCount <= 6) {
                        setTimeout(() => {
                            if (
                                ticketChannelEditVersions.get(
                                    channelId
                                ) !== job.version
                            ) {
                                return;
                            }

                            const existing =
                                ticketChannelEditPending.get(
                                    channelId
                                );

                            if (!existing) {
                                ticketChannelEditPending.set(
                                    channelId,
                                    {
                                        channel:
                                            job.channel,
                                        data: {
                                            ...job.data
                                        },
                                        version:
                                            job.version,
                                        label:
                                            `${job.label} RETRY`,
                                        waiters: []
                                    }
                                );

                                startTicketChannelEditWorker(
                                    channelId
                                );
                            }
                        }, Math.min(
                            30000,
                            3000 * retryCount
                        ));
                    }
                }
            } else {
                ticketChannelEditRetryCounts.delete(
                    channelId
                );
            }

            for (
                const resolve of job.waiters
            ) {
                resolve(updatedChannel);
            }

            if (
                ticketChannelEditPending.has(
                    channelId
                )
            ) {
                await new Promise(resolve =>
                    setTimeout(resolve, 25)
                );
            }
        }
    })().finally(() => {
        ticketChannelEditWorkers.delete(
            channelId
        );

        // If another action arrived just as the worker finished,
        // immediately start a fresh worker for that latest state.
        if (
            ticketChannelEditPending.has(
                channelId
            )
        ) {
            startTicketChannelEditWorker(
                channelId
            );
        }
    });

    ticketChannelEditWorkers.set(
        channelId,
        worker
    );
}

function persistTicketChannelEdit(channel, data, version, label) {
    const channelId = channel.id;

    let resolveRequest;
    const requestPromise = new Promise(resolve => {
        resolveRequest = resolve;
    });

    const pending =
        ticketChannelEditPending.get(channelId);

    if (pending) {
        // Only keep the newest desired values. This prevents a rapid
        // Claim -> Unclaim -> Claim sequence from building a long queue
        // of obsolete Discord channel edits.
        pending.data = {
            ...pending.data,
            ...data
        };
        pending.version = version;
        pending.label = label;
        pending.waiters.push(resolveRequest);
    } else {
        ticketChannelEditPending.set(
            channelId,
            {
                channel,
                data: { ...data },
                version,
                label,
                waiters: [resolveRequest]
            }
        );
    }

    startTicketChannelEditWorker(
        channelId
    );

    return requestPromise;
}

async function sendTicketActionMessage(
    channel,
    message,
    allowedMentions = {},
    label = 'TICKET ACTION'
) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            const container =
                new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(message)
                    );

            return await channel.send({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
                allowedMentions
            });
        } catch (componentError) {
            console.error(
                `[${label} MESSAGE ERROR - ATTEMPT ${attempt}]`,
                componentError
            );

            try {
                return await channel.send({
                    content: message,
                    allowedMentions
                });
            } catch (plainError) {
                console.error(
                    `[${label} FALLBACK ERROR - ATTEMPT ${attempt}]`,
                    plainError
                );

                if (attempt < 3) {
                    await new Promise(resolve =>
                        setTimeout(resolve, 300 * attempt)
                    );
                }
            }
        }
    }

    return null;
}


const claimTitleReconcileTimers = new Map();

function syncTicketStateAfterHandoff(channel, updates = {}) {
    if (!channel) return;

    const channelId = channel.id;

    prepareTicketForHandoff(channel);

    optimisticClaimStates.set(channelId, null);

    if (updates.departmentKey) {
        optimisticDepartmentStates.set(
            channelId,
            updates.departmentKey
        );
    }

    if (updates.name) {
        optimisticChannelNames.set(
            channelId,
            updates.name
        );
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'topic')) {
        optimisticChannelTopics.set(
            channelId,
            updates.topic || ''
        );
    }

    if (updates.name && Object.prototype.hasOwnProperty.call(updates, 'topic')) {
        scheduleTicketStateSync(
            channel,
            {
                name: updates.name,
                topic: updates.topic || '',
                reason: updates.reason || 'Ticket handed off'
            },
            350
        );
    }
}

function scheduleClaimTitleReconciliation(channel) {
    if (!channel) return;

    const channelId = channel.id;
    const existingTimers =
        claimTitleReconcileTimers.get(channelId) || [];

    for (const timer of existingTimers) {
        clearTimeout(timer);
    }

    const timers = [];

    // Discord can finish an older Unclaim rename after the new Claim has
    // already succeeded. Re-check the real channel name a few times and make
    // the latest claim win visually as well as logically.
    const delays = [150, 1800, 7000, 25000, 75000];

    for (const delay of delays) {
        const timer = setTimeout(async () => {
            try {
                const claimedBy = getClaimedUserId(channel);

                if (!claimedBy) {
                    return;
                }

                let latestChannel = channel;

                try {
                    latestChannel =
                        await channel.fetch();
                } catch {}

                const currentName =
                    latestChannel.name ||
                    channel.name ||
                    getEffectiveChannelName(channel);

                const desiredName =
                    `claimed-${stripClaimedPrefix(currentName)}`;

                if (
                    String(currentName).toLowerCase() ===
                    desiredName.toLowerCase()
                ) {
                    optimisticChannelNames.set(
                        channelId,
                        desiredName
                    );
                    return;
                }

                const renamed =
                    await latestChannel.setName(
                        desiredName,
                        'Synchronise claimed ticket title'
                    );

                optimisticChannelNames.set(
                    channelId,
                    renamed.name || desiredName
                );
            } catch (error) {
                console.error(
                    '[CLAIM TITLE RECONCILE ERROR]',
                    error
                );
            }
        }, delay);

        timers.push(timer);
    }

    claimTitleReconcileTimers.set(
        channelId,
        timers
    );
}

async function fetchAllTicketMessages(channel) {
    const messages = [];
    let before = null;

    while (true) {
        const batch = await channel.messages.fetch({
            limit: 100,
            ...(before ? { before } : {}),
            cache: false
        });

        if (batch.size === 0) {
            break;
        }

        messages.push(...batch.values());

        const oldest = batch.last();
        before = oldest?.id || null;

        if (batch.size < 100 || !before) {
            break;
        }
    }

    return messages.sort(
        (a, b) =>
            a.createdTimestamp -
            b.createdTimestamp
    );
}

async function createTicketTranscript(channel) {
    const messages =
        await fetchAllTicketMessages(channel);

    const generatedAt =
        new Date().toLocaleString('en-AU', {
            timeZone: 'Australia/Melbourne',
            dateStyle: 'medium',
            timeStyle: 'medium'
        });

    const lines = [
        `Ticket transcript: #${channel.name}`,
        `Generated: ${generatedAt}`,
        ''
    ];

    if (messages.length === 0) {
        lines.push(
            'No messages were found in this ticket.'
        );
    }

    for (const message of messages) {
        const authorName =
            message.member?.displayName ||
            message.author?.globalName ||
            message.author?.username ||
            'Unknown User';

        const username =
            message.author?.username ||
            'unknown';

        const timestamp =
            new Date(
                message.createdTimestamp
            ).toLocaleString('en-AU', {
                timeZone:
                    'Australia/Melbourne',
                dateStyle: 'short',
                timeStyle: 'medium'
            });

        lines.push(
            `[${timestamp}] ${authorName} (@${username})${message.author?.bot ? ' [BOT]' : ''}`
        );

        if (message.content) {
            lines.push(message.content);
        }

        for (
            const attachment of
            message.attachments.values()
        ) {
            lines.push(
                `[Attachment] ${attachment.name || 'Attachment'}: ${attachment.url}`
            );
        }

        for (const embed of message.embeds || []) {
            if (embed.title) {
                lines.push(
                    `[Embed] ${embed.title}`
                );
            }

            if (embed.description) {
                lines.push(
                    embed.description
                );
            }
        }

        if (
            !message.content &&
            message.attachments.size === 0 &&
            (!message.embeds ||
                message.embeds.length === 0)
        ) {
            lines.push(
                '(No text content)'
            );
        }

        lines.push('');
    }

    const safeChannelName =
        String(channel.name || 'ticket')
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '') ||
        'ticket';

    return {
        attachment: Buffer.from(
            lines.join('\n'),
            'utf8'
        ),
        name:
            `${safeChannelName}.txt`
    };
}


// ======================================================

// READY

// ======================================================



client.once(

    'clientReady',

    async () => {



        console.log(

            `Logged in as ${client.user.tag}`

        );



        console.log(

            'MSRP Bot is online.'

        );



        const rest =

            new REST({

                version: '10'

            }).setToken(

                process.env.DISCORD_TOKEN

            );


        try {

            const globalCommands =
                await rest.get(
                    Routes.applicationCommands(
                        client.user.id
                    )
                );

            for (const command of globalCommands) {

                if (
                    command.name ===
                    'ticketsetup'
                ) {

                    await rest.delete(
                        Routes.applicationCommand(
                            client.user.id,
                            command.id
                        )
                    );

                    console.log(
                        'Deleted old global /ticketsetup command.'
                    );
                }
            }


            const guildCommands =
                await rest.get(
                    Routes.applicationGuildCommands(
                        client.user.id,
                        process.env.DISCORD_GUILD_ID
                    )
                );

            for (const command of guildCommands) {

                if (
                    command.name ===
                    'ticketsetup'
                ) {

                    await rest.delete(
                        Routes.applicationGuildCommand(
                            client.user.id,
                            process.env.DISCORD_GUILD_ID,
                            command.id
                        )
                    );

                    console.log(
                        'Deleted old guild /ticketsetup command.'
                    );
                }
            }

        } catch (error) {

            console.error(
                'Failed to remove old /ticketsetup command:',
                error
            );

        }



        try {



            await rest.put(

                Routes.applicationGuildCommands(

                    client.user.id,

                    process.env.DISCORD_GUILD_ID

                ),

                {

body: [
    sendTicketDashboardCommand.toJSON(),
    sessionDashboardCommand.data.toJSON(),
    sessionTimesCommand.data.toJSON(),
    reactionRole.command.toJSON()
]

                }

            );



            console.log(

                'Slash commands registered.'

            );



        } catch (error) {



            console.error(

                'Failed to register slash commands:',

                error

            );

        }

    }

);



// ======================================================

// INTERACTIONS

// ======================================================



client.on(

    'interactionCreate',

    async interaction => {



        try {



            // ==================================================

            // SLASH COMMANDS

            // ==================================================


if (
    interaction.commandName ===
    'reaction-role-message'
) {
    await reactionRole.execute(
        interaction
    );

    return;
}

if (
    interaction.isChatInputCommand()
) {

        const hasCommandPermission =
        await checkCommandPermission(
            interaction
        );

    if (!hasCommandPermission) {
        return;
    }

    if (
        interaction.commandName ===
        'send-ticket-dashboard'
    ) {
        await ticketSetup.execute(
            interaction
        );

        return;
    }

    if (
        interaction.commandName ===
        'send-session-dashboard'
    ) {
        await sessionDashboardCommand.execute(
            interaction
        );

        return;
    }

    if (
        interaction.commandName ===
        'set-session-times'
    ) {
        await sessionTimesCommand.execute(
            interaction
        );

        return;
    }

    return;
}


client.on(
    'messageReactionAdd',
    async (reaction, user) => {
        await reactionRole.handleReactionAdd(
            reaction,
            user
        );
    }
);


client.on(
    'messageReactionRemove',
    async (reaction, user) => {
        await reactionRole.handleReactionRemove(
            reaction,
            user
        );
    }
);

            // ==================================================
            // HAND OFF MODULE
            // ==================================================

            if (
                await handleTicketHandoffInteraction(
                    interaction
                )
            ) {
                return;
            }


            // ==================================================

            // TICKET TYPE SELECT

            // ==================================================



            if (

                interaction.isStringSelectMenu() &&

                interaction.customId ===

                'ticket_type_select'

            ) {



                const ticketType =

                    interaction.values[0];



                const typeConfig =

                    config.ticketTypes[

                        ticketType

                    ];



                if (!typeConfig) {



                    await interaction.reply({

                        content:

                            '❌ This ticket type does not exist.',

                        flags:

                            MessageFlags.Ephemeral

                    });



                    return;

                }



                const modal =

                    new ModalBuilder()

                        .setCustomId(

                            `ticket_form:${ticketType}`

                        )

                        .setTitle(

                            typeConfig.name ||

                            typeConfig.label ||

                            'Ticket'

                        );



                for (

                    const question of

                    (

                        typeConfig.questions ||

                        []

                    ).slice(0, 5)

                ) {



                    if (

                        question.type ===

                        'dropdown'

                    ) {



                        const configuredOptions =
                            Array.isArray(question.options)
                                ? [...question.options]
                                : [];

                        if (
                            isRulesQuestion(question) &&
                            !configuredOptions.some(
                                option =>
                                    String(option.value || '')
                                        .toLowerCase() ===
                                    'no'
                            )
                        ) {
                            configuredOptions.push({
                                label: 'No',
                                value: 'no'
                            });
                        }

                        const options =

                            configuredOptions.map(

                                option => {



                                    const builder =

                                        new StringSelectMenuOptionBuilder()

                                            .setLabel(

                                                option.label

                                            )

                                            .setValue(

                                                option.value

                                            );



                                    if (

                                        option.description

                                    ) {

                                        builder.setDescription(

                                            option.description

                                        );

                                    }



                                    return builder;

                                }

                            );



                        const select =

                            new StringSelectMenuBuilder()

                                .setCustomId(

                                    question.id

                                )

                                .setPlaceholder(

                                    question.placeholder ||

                                    'Select an option...'

                                )

                                .setMinValues(1)

                                .setMaxValues(1)

                                .setRequired(

                                    question.required ??

                                    true

                                )

                                .addOptions(

                                    options

                                );



                        modal.addLabelComponents(

                            new LabelBuilder()

                                .setLabel(

                                    question.label

                                )

                                .setStringSelectMenuComponent(

                                    select

                                )

                        );



                        continue;

                    }



                    const input =

                        new TextInputBuilder()

                            .setCustomId(

                                question.id

                            )

                            .setStyle(

                                question.style ===

                                'Short'

                                    ? TextInputStyle.Short

                                    : TextInputStyle.Paragraph

                            )

                            .setRequired(

                                question.required ??

                                true

                            );



                    if (

                        question.placeholder

                    ) {

                        input.setPlaceholder(

                            question.placeholder

                        );

                    }



                    if (

                        question.minLength !==

                        undefined

                    ) {

                        input.setMinLength(

                            question.minLength

                        );

                    }



                    if (

                        question.maxLength !==

                        undefined

                    ) {

                        input.setMaxLength(

                            question.maxLength

                        );

                    }



                    modal.addLabelComponents(

                        new LabelBuilder()

                            .setLabel(

                                question.label

                            )

                            .setTextInputComponent(

                                input

                            )

                    );

                }



                await interaction.showModal(

                    modal

                );



                return;

            }



            // ==================================================

            // MODALS

            // ==================================================



            if (

                interaction.isModalSubmit()

            ) {



                // ==================================================

                // CLOSE MODAL

                // ==================================================

                if (
                    interaction.customId ===
                    'ticket_close_modal'
                ) {
                    const channel = interaction.channel;

                    if (!channel || !channel.isTextBased()) {
                        await interaction.reply({
                            content: '❌ This ticket channel could not be found.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const ownerId = getTicketOwnerId(channel);
                    if (
                        ownerId === interaction.user.id &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            interaction.user.id
                        )
                    ) {
                        await interaction.reply({
                            content: '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const closePermission =
                        getTicketActionPermission(
                            interaction.member,
                            channel,
                            'close',
                            interaction.user.id
                        );

                    if (!closePermission.allowed) {
                        await interaction.reply({
                            content: closePermission.message,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const reason = interaction.fields
                        .getTextInputValue('close_reason')
                        .trim();

                    if (!reason) {
                        await interaction.reply({
                            content: '❌ A reason for closing the ticket is required.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    try {
                        await interaction.reply({
                            content: '✅ Closing ticket...',
                            flags: MessageFlags.Ephemeral
                        });

                        let transcriptFile = null;

                        try {
                            transcriptFile =
                                await createTicketTranscript(
                                    channel
                                );
                        } catch (transcriptError) {
                            console.error(
                                '[TRANSCRIPT GENERATION ERROR]',
                                transcriptError
                            );
                        }

                        void sendTicketCloseNotifications({
                            client,
                            closeLogChannelId:
                                CLOSE_LOG_CHANNEL_ID,
                            ownerId,
                            closedByUserId:
                                interaction.user.id,
                            channelName:
                                channel.name,
                            ticketTypeName:
                                getTicketTypeName(channel),
                            reason,
                            transcriptFile
                        });

                        const auditReason = (
                            `MSRP ticket closed by ${interaction.user.username} ` +
                            `(${interaction.user.id}): ${reason}`
                        ).slice(0, 512);

                        console.log(
                            `[TICKET CLOSE] ${channel.name} | ` +
                            `Closed by ${interaction.user.username} ` +
                            `(${interaction.user.id}) | ` +
                            `Reason: ${reason}`
                        );

                        await channel.delete(auditReason);

                    } catch (error) {
                        console.error(
                            '[CLOSE MODAL ERROR]',
                            error
                        );

                        try {
                            await interaction.editReply({
                                content: '❌ Something went wrong while closing this ticket.'
                            });
                        } catch {}
                    }

                    return;
                }

                // ==================================================

                // UNCLAIM MODAL

                // ==================================================

                if (
                    interaction.customId ===
                    'ticket_unclaim_modal'
                ) {
                    const channel = interaction.channel;

                    if (!channel || !channel.isTextBased()) {
                        await interaction.reply({
                            content:
                                '❌ This ticket channel could not be found.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const ownerId =
                        getTicketOwnerId(channel);

                    if (
                        ownerId === interaction.user.id &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            interaction.user.id
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (
                        !isSeniorSupportMember(
                            interaction.member
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ Only Senior Support Staff can unclaim a ticket.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const claimedBy =
                        getClaimedUserId(channel);

                    if (!claimedBy) {
                        await interaction.reply({
                            content:
                                '❌ No one has claimed this ticket.',
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    let notes = '';

                    try {
                        notes =
                            interaction.fields
                                .getTextInputValue(
                                    'unclaim_notes'
                                )
                                ?.trim() || '';
                    } catch {}

                    // Single source of truth: every Unclaim removes every
                    // claimed- prefix and clears claimed-by from the topic.
                    ticketState.unclaimTicket(
                        channel,
                        {
                            reason:
                                `Ticket unclaimed by ${interaction.user.tag}`,
                            delay: 0
                        }
                    );

                    await ticketPermissions.applyTicketPermissions(
                        channel,
                        {
                            claimedBy: null,
                            reason:
                                `Ticket unclaimed by ${interaction.user.tag}`
                        }
                    );

                    void ticketStatus
                        .setClaimButtonState(channel, false)
                        .catch(error => {
                            console.error(
                                '[UNCLAIM BUTTON STATUS ERROR]',
                                error
                            );
                        });

                    await interaction.reply({
                        content:
                            '✅ Ticket unclaim accepted.',
                        flags: MessageFlags.Ephemeral
                    });

                    const ownerMention =
                        ownerId
                            ? `<@${ownerId}>`
                            : 'Customer';

                    let message =
                        `${ownerMention} | ` +
                        'This ticket has been unclaimed. ' +
                        'A support member will be with you shortly.';

                    if (notes) {
                        message +=
                            '\n\n**Notes**\n' +
                            notes
                                .split('\n')
                                .map(
                                    line =>
                                        `> ${line}`
                                )
                                .join('\n');
                    }

                    // Send the public unclaim notice immediately so it is not
                    // delayed by Discord's channel-edit rate limit.
                    await sendTicketActionMessage(
                        channel,
                        message,
                        {
                            users:
                                ownerId
                                    ? [ownerId]
                                    : []
                        },
                        'UNCLAIM'
                    );

                    return;
                }

                // ==================================================

                // ==================================================

                // NORMAL TICKET FORM

                // ==================================================



                if (

                    interaction.customId.startsWith(

                        'ticket_form:'

                    )

                ) {



                    const ticketType =

                        interaction.customId.split(':')[1];



                    const typeConfig =

                        config.ticketTypes[

                            ticketType

                        ];



                    if (!typeConfig) {



                        await interaction.reply({

                            content:

                                '❌ This ticket type does not exist.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const answers = {};



                    for (

                        const question of

                        typeConfig.questions || []

                    ) {



                        try {



                            if (

                                question.type ===

                                'dropdown'

                            ) {



                                answers[

                                    question.id

                                ] =

                                    interaction.fields

                                        .getStringSelectValues(

                                            question.id

                                        )[0];



                            } else {



                                answers[

                                    question.id

                                ] =

                                    interaction.fields

                                        .getTextInputValue(

                                            question.id

                                        );

                            }



                        } catch (error) {



                            console.error(

                                `Failed to collect question "${question.id}":`,

                                error

                            );

                        }

                    }



                    const rulesQuestion =
                        (typeConfig.questions || [])
                            .find(isRulesQuestion);

                    if (
                        rulesQuestion &&
                        String(
                            answers[rulesQuestion.id] || ''
                        ).toLowerCase() === 'no'
                    ) {
                        await interaction.reply({
                            content:
                                getRulesDeclineMessage(),
                            flags:
                                MessageFlags.Ephemeral
                        });

                        return;
                    }


                    try {



                        await createTicket(

                            interaction,

                            ticketType,

                            answers

                        );



                    } catch (error) {



                        console.error(

                            'Ticket form submission error:',

                            error

                        );



                        if (

                            !interaction.replied &&

                            !interaction.deferred

                        ) {



                            await interaction.reply({

                                content:

                                    '❌ Something went wrong while creating your ticket.',

                                flags:

                                    MessageFlags.Ephemeral

                            });

                        }

                    }



                    return;

                }

            }



            // ==================================================

            // BUTTONS

            // ==================================================



if (
    interaction.isButton()
) {

    

    const handledSessionButton =
        await handleSessionButton(
            interaction
        );

    if (handledSessionButton) {
        return;
    }






                // ==================================================

                // RULES

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_rules'

                ) {



                    await interaction.reply({

                        content:

                            config.ticketRulesButton.message,

                        flags:

                            MessageFlags.Ephemeral

                    });



                    return;

                }



                // ==================================================

                // INFORMATION

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_information'

                ) {



                    await interaction.reply({

                        content:

                            config.informationButton.message,

                        flags:

                            MessageFlags.Ephemeral

                    });



                    return;

                }



                // ==================================================

                // TICKET CREATION

                // ==================================================



                if (

                    interaction.customId.startsWith(

                        'ticket\_'

                    ) &&

                    ![

                        'ticket_claim',

                        'ticket_close',

                        'ticket_handoff',

                        'ticket_unclaim'

                    ].includes(

                        interaction.customId

                    )

                ) {



                    const ticketType =

                        interaction.customId.replace(

                            'ticket\_',

                            ''

                        );



                    await createTicket(

                        interaction,

                        ticketType

                    );



                    return;

                }



// ==================================================
// CLAIM
// ==================================================

if (
    interaction.customId ===
    'ticket_claim'
) {
    const channel = interaction.channel;
    const userId = interaction.user.id;

    await interaction.deferReply({
        flags: MessageFlags.Ephemeral
    });

    await interaction.editReply({
        content: '⏳ Claiming ticket...'
    });

    if (
        !channel ||
        !channel.isTextBased()
    ) {
        await interaction.editReply({
            content:
                '❌ This ticket channel could not be found.'
        });

        return;
    }

    const ownerId =
        getTicketOwnerId(channel);

    if (
        ownerId === userId &&
        !isTicketOwnerStaffTestingAllowed(
            interaction.member,
            ownerId,
            userId
        )
    ) {
        await interaction.editReply({
            content:
                '❌ The user who created the ticket cannot use staff ticket buttons.'
        });

        return;
    }

    const claimPermission =
        getTicketActionPermission(
            interaction.member,
            channel,
            'claim',
            userId
        );

    if (!claimPermission.allowed) {
        await interaction.editReply({
            content:
                claimPermission.message
        });

        return;
    }

    if (
        activeClaimChannels.has(
            channel.id
        )
    ) {
        await interaction.editReply({
            content:
                '❌ Another claim action is already being processed for this ticket. Please try again.'
        });

        return;
    }

    activeClaimChannels.add(
        channel.id
    );

    try {
        const latestPermission =
            getTicketActionPermission(
                interaction.member,
                channel,
                'claim',
                userId
            );

        if (!latestPermission.allowed) {
            await interaction.editReply({
                content:
                    latestPermission.message
            });

            return;
        }

        const previousClaim =
            latestPermission.claimedBy;

        const isTakeover =
            Boolean(
                previousClaim &&
                previousClaim !== userId
            );

        const ownerMention =
            ownerId
                ? `<@${ownerId}>`
                : 'Customer';

        const ticketTypeName =
            getTicketTypeName(channel);

        /*
         * SINGLE SOURCE OF TRUTH:
         *
         * This immediately records the ticket as claimed in
         * ticketState and schedules exactly one Discord name/topic
         * update. Every Claim therefore targets:
         *
         * claimed-<current-ticket-name>
         *
         * and adds claimed-by:<userId> to the topic.
         */
        ticketState.claimTicket(
            channel,
            userId,
            {
                reason:
                    `Ticket claimed by ${interaction.user.tag}`,
                delay: 0
            }
        );

        await ticketPermissions.applyTicketPermissions(
            channel,
            {
                claimedBy: userId,
                reason:
                    `Ticket claimed by ${interaction.user.tag}`
            }
        );

        void ticketStatus
            .setClaimButtonState(channel, true)
            .catch(error => {
                console.error(
                    '[CLAIM BUTTON STATUS ERROR]',
                    error
                );
            });

        await interaction.editReply({
            content:
                isTakeover
                    ? '✅ Ticket taken over successfully.'
                    : '✅ Ticket claimed.'
        });

        const claimText =
            isTakeover
                ? `${ownerMention} | This ticket is now being handled by ${interaction.user}.`
                : `${ownerMention} | ${interaction.user} has claimed this ${ticketTypeName} ticket.`;

        const mentionUsers =
            [ownerId, userId]
                .filter(Boolean);

        try {
            await sendTicketActionMessage(
                channel,
                claimText,
                {
                    users: [
                        ...new Set(
                            mentionUsers
                        )
                    ]
                },
                'CLAIM'
            );
        } catch (messageError) {
            console.error(
                '[CLAIM MESSAGE ERROR]',
                messageError
            );

            try {
                await channel.send({
                    content: claimText
                });
            } catch (fallbackError) {
                console.error(
                    '[CLAIM FALLBACK MESSAGE ERROR]',
                    fallbackError
                );
            }
        }

    } catch (error) {
        console.error(
            '[CLAIM ERROR]',
            error
        );

        try {
            await interaction.editReply({
                content:
                    '❌ Something went wrong while claiming this ticket.'
            });
        } catch {}

    } finally {
        activeClaimChannels.delete(
            channel.id
        );
    }

    return;
}


                // ==================================================

                // CLOSE

                // ==================================================



                if (

                    interaction.customId ===

                    'ticket_close'

                ) {



                    const channel =

                        interaction.channel;



                    if (

                        !channel ||

                        !channel.isTextBased()

                    ) {



                        await interaction.reply({

                            content:

                                '❌ This ticket channel could not be found.',

                            flags:

                                MessageFlags.Ephemeral

                        });



                        return;

                    }



                    const ownerId =
                        getTicketOwnerId(
                            channel
                        );

                    if (
                        ownerId ===
                        interaction.user.id &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            interaction.user.id
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags:
                                MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const closePermission =
                        getTicketActionPermission(
                            interaction.member,
                            channel,
                            'close',
                            interaction.user.id
                        );

                    if (!closePermission.allowed) {
                        await interaction.reply({
                            content: closePermission.message,
                            flags: MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const modal =

                        new ModalBuilder()

                            .setCustomId(

                                'ticket_close_modal'

                            )

                            .setTitle(

                                'Close Ticket'

                            );



                    const reasonInput =

                        new TextInputBuilder()

                            .setCustomId(

                                'close_reason'

                            )

                            .setStyle(

                                TextInputStyle.Paragraph

                            )

                            .setRequired(true)

                            .setMinLength(1)

                            .setMaxLength(500)

                            .setPlaceholder(

                                'Enter the reason for closing this ticket...'

                            );



                    modal.addLabelComponents(

                        new LabelBuilder()

                            .setLabel(

                                'Reason for close'

                            )

                            .setTextInputComponent(

                                reasonInput

                            )

                    );



                    await interaction.showModal(

                        modal

                    );



                    return;

                }



                // ==================================================

                // UNCLAIM

                // ==================================================

                if (
                    interaction.customId ===
                    'ticket_unclaim'
                ) {
                    const channel =
                        interaction.channel;

                    if (
                        !channel ||
                        !channel.isTextBased()
                    ) {
                        await interaction.reply({
                            content:
                                '❌ This ticket channel could not be found.',
                            flags:
                                MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const ownerId =
                        getTicketOwnerId(channel);

                    if (
                        ownerId === interaction.user.id &&
                        !isTicketOwnerStaffTestingAllowed(
                            interaction.member,
                            ownerId,
                            interaction.user.id
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ The user who created the ticket cannot use staff ticket buttons.',
                            flags:
                                MessageFlags.Ephemeral
                        });
                        return;
                    }

                    if (
                        !isSeniorSupportMember(
                            interaction.member
                        )
                    ) {
                        await interaction.reply({
                            content:
                                '❌ Only Senior Support Staff can unclaim a ticket.',
                            flags:
                                MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const claimedBy =
                        getClaimedUserId(channel);

                    if (!claimedBy) {
                        await interaction.reply({
                            content:
                                '❌ No one has claimed this ticket.',
                            flags:
                                MessageFlags.Ephemeral
                        });
                        return;
                    }

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                'ticket_unclaim_modal'
                            )
                            .setTitle(
                                'Unclaim Ticket'
                            );

                    const notes =
                        new TextInputBuilder()
                            .setCustomId(
                                'unclaim_notes'
                            )
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setRequired(false)
                            .setPlaceholder(
                                'Add any notes for the next support member...'
                            )
                            .setMaxLength(1000);

                    modal.addLabelComponents(
                        new LabelBuilder()
                            .setLabel(
                                'Notes (Optional)'
                            )
                            .setTextInputComponent(
                                notes
                            )
                    );

                    try {
                        await interaction.showModal(
                            modal
                        );
                    } catch (error) {
                        console.error(
                            '[UNCLAIM BUTTON ERROR]',
                            error
                        );

                        if (
                            !interaction.replied &&
                            !interaction.deferred
                        ) {
                            try {
                                await interaction.reply({
                                    content:
                                        '❌ Discord could not open the unclaim form.',
                                    flags:
                                        MessageFlags.Ephemeral
                                });
                            } catch {}
                        }
                    }

                    return;
                }
            }



        } catch (error) {



            console.error(

                'UNHANDLED INTERACTION ERROR:',

                error

            );



            try {



                if (

                    interaction.replied ||

                    interaction.deferred

                ) {



                    await interaction.followUp({

                        content:

                            '❌ Something went wrong while processing that action.',

                        flags:

                            MessageFlags.Ephemeral

                    });



                } else {



                    await interaction.reply({

                        content:

                            '❌ Something went wrong while processing that action.',

                        flags:

                            MessageFlags.Ephemeral

                    });

                }



            } catch {}

        }

    }

);



// ======================================================

// LOGIN

// ======================================================



client.login(

    process.env.DISCORD_TOKEN

);