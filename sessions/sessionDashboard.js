const path = require('path');

const {
    AttachmentBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
    ActionRowBuilder,
    MessageFlags
} = require('discord.js');

const {
    getState
} = require('./sessionState');

const {
    ensureSessionIcons,
    buttonEmoji
} = require('./sessionIcons');


const STAFF_ROLE_ID =
    '1547535313096810546';

const JOIN_URL =
    'https://erlc.gg/join/MSRPAU';

const SERVER_NAME =
    'Melbourne State Roleplay | Strict | VC | New';

const SERVER_OWNER =
    '[Monkeyman443hi](https://www.roblox.com/users/3927928067/profile?friendshipSourceType=PlayerSearch)';

const SERVER_CODE =
    'MSRPAU';


function divider() {
    return new SeparatorBuilder()
        .setSpacing(
            SeparatorSpacingSize.Small
        )
        .setDivider(true);
}


function getStaffCount(guild) {
    if (!guild) {
        return 0;
    }

    return guild.members.cache.filter(
        member =>
            member.roles.cache.has(
                STAFF_ROLE_ID
            ) &&
            !member.user.bot
    ).size;
}


function applyEmoji(
    button,
    emoji
) {
    const formatted =
        buttonEmoji(emoji);

    if (formatted) {
        button.setEmoji(
            formatted
        );
    }

    return button;
}


async function buildSessionDashboard({
    guild,
    playerCount = 0,
    queueCount = 0
}) {
    const state =
        getState();

    const icons =
        await ensureSessionIcons(
            guild
        );

    const staffCount =
        getStaffCount(guild);

    const now =
        Math.floor(
            Date.now() / 1000
        );

    const isOnline =
        state.status === 'active' ||
        state.status === 'shutting-down';

    const isVoting =
        state.status === 'vote';


    /*
     * ==========================================
     * ACTUAL SERVER LOGO EMOJI
     * ==========================================
     */

    const logoEmoji =
        icons.logo
            ? icons.logo.toString()
            : '';


    /*
     * ==========================================
     * IMAGES
     * ==========================================
     */

    const topImage =
        new AttachmentBuilder(
            path.join(
                __dirname,
                '..',
                'images',
                'ticket-dashboard.png'
            ),
            {
                name:
                    'session-dashboard.png'
            }
        );

    const bottomImage =
        new AttachmentBuilder(
            path.join(
                __dirname,
                '..',
                'images',
                'image.png'
            ),
            {
                name:
                    'session-footer.png'
            }
        );


    /*
     * ==========================================
     * SESSION TIMES
     * ==========================================
     */

    const sessionTimesButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(
                    'session_times'
                )
                .setLabel(
                    'Session Times'
                )
                .setStyle(
                    ButtonStyle.Secondary
                ),
            icons.sessionTimes
        );


    /*
     * ==========================================
     * ONLINE/OFFLINE STATUS
     * ==========================================
     */

    const statusButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(
                    'session_status'
                )
                .setLabel(
                    isOnline
                        ? 'Online'
                        : isVoting
                            ? 'Voting'
                            : 'Offline'
                )
                .setStyle(
                    isOnline
                        ? ButtonStyle.Success
                        : isVoting
                            ? ButtonStyle.Primary
                            : ButtonStyle.Danger
                )
                .setDisabled(true),
            icons.status
        );


    /*
     * ==========================================
     * PLAYER COUNT
     * ==========================================
     */

    const playerButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(
                    'session_player_count'
                )
                .setLabel(
                    `Player count: ${playerCount}/50`
                )
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(true),
            icons.players
        );


    /*
     * ==========================================
     * STAFF COUNT
     * ==========================================
     */

    const staffButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(
                    'session_staff_count'
                )
                .setLabel(
                    `Staff: ${staffCount}`
                )
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(true),
            icons.staff
        );


    /*
     * ==========================================
     * QUEUE
     * ==========================================
     */

    const queueButton =
        applyEmoji(
            new ButtonBuilder()
                .setCustomId(
                    'session_queue_count'
                )
                .setLabel(
                    `Queue: ${queueCount}`
                )
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(true),
            icons.queue
        );


    /*
     * ==========================================
     * JOIN
     * ==========================================
     */

    let joinButton;

    if (isOnline) {
        joinButton =
            applyEmoji(
                new ButtonBuilder()
                    .setLabel(
                        'Join'
                    )
                    .setStyle(
                        ButtonStyle.Link
                    )
                    .setURL(
                        JOIN_URL
                    ),
                icons.join
            );

    } else {
        joinButton =
            applyEmoji(
                new ButtonBuilder()
                    .setCustomId(
                        'session_join_disabled'
                    )
                    .setLabel(
                        'Join'
                    )
                    .setStyle(
                        ButtonStyle.Secondary
                    )
                    .setDisabled(true),
                icons.join
            );
    }


    /*
     * ==========================================
     * VOTE
     * ==========================================
     */

    let voteButton =
        null;

    if (isVoting) {
        voteButton =
            applyEmoji(
                new ButtonBuilder()
                    .setCustomId(
                        'session_vote'
                    )
                    .setLabel(
                        `Vote: ${state.voters.size}/${state.voteTarget}`
                    )
                    .setStyle(
                        ButtonStyle.Primary
                    ),
                icons.vote
            );
    }


    /*
     * ==========================================
     * BUTTON ROWS
     * ==========================================
     */

    const informationRow =
        new ActionRowBuilder()
            .addComponents(
                playerButton,
                staffButton,
                queueButton,
                joinButton
            );

    if (voteButton) {
        informationRow.addComponents(
            voteButton
        );
    }


    /*
     * ==========================================
     * COMPONENTS V2 CONTAINER
     * ==========================================
     */

    const container =
        new ContainerBuilder()

            .addMediaGalleryComponents(
                new MediaGalleryBuilder()
                    .addItems(
                        new MediaGalleryItemBuilder()
                            .setURL(
                                'attachment://session-dashboard.png'
                            )
                    )
            )

            .addSeparatorComponents(
                divider()
            )

            .addActionRowComponents(
                new ActionRowBuilder()
                    .addComponents(
                        sessionTimesButton,
                        statusButton
                    )
            )

            .addSeparatorComponents(
                divider()
            )

            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        `## ${logoEmoji}${logoEmoji ? ' | ' : ''}Server Information\n\n` +

                        `- **Server name:** ${SERVER_NAME}\n` +
                        `- **Server owner:** ${SERVER_OWNER}\n` +
                        `- **Server Code:** ${SERVER_CODE}\n` +
                        `- **Last update:** <t:${now}:R>`
                    )
            )

            .addSeparatorComponents(
                divider()
            )

            .addActionRowComponents(
                informationRow
            )

            .addSeparatorComponents(
                divider()
            )

            .addMediaGalleryComponents(
                new MediaGalleryBuilder()
                    .addItems(
                        new MediaGalleryItemBuilder()
                            .setURL(
                                'attachment://session-footer.png'
                            )
                    )
            );


    return {
        components: [
            container
        ],

        files: [
            topImage,
            bottomImage
        ]
    };
}


async function sendSessionDashboard(
    channel,
    options = {}
) {
    const dashboard =
        await buildSessionDashboard({
            guild:
                channel.guild,

            ...options
        });

    return await channel.send({
        ...dashboard,

        flags:
            MessageFlags.IsComponentsV2
    });
}


/*
 * Kept here so existing sessionButtons.js
 * does not need to change.
 */
async function handleDisplayButton(
    interaction
) {
    const ids = [
        'session_status',
        'session_player_count',
        'session_staff_count',
        'session_queue_count'
    ];

    if (
        !ids.includes(
            interaction.customId
        )
    ) {
        return false;
    }

    /*
     * They're disabled anyway, but this keeps
     * compatibility if we enable one later.
     */
    await interaction.deferUpdate();

    return true;
}


module.exports = {
    buildSessionDashboard,
    sendSessionDashboard,
    handleDisplayButton
};