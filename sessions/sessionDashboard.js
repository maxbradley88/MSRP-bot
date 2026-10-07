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
    ActionRowBuilder
} = require('discord.js');

const {
    getState
} = require('./sessionState');

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


/*
 * Count members with the staff role.
 */
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


/*
 * Decorative button interaction IDs.
 *
 * These buttons don't actually perform an
 * action when clicked.
 */
const DISPLAY_BUTTONS = [
    'session_status',
    'session_player_count',
    'session_staff_count',
    'session_queue_count'
];


/*
 * Builds the full Components V2 dashboard.
 */
function buildSessionDashboard({
    guild,
    playerCount = 0,
    queueCount = 0
}) {
    const state =
        getState();

    const staffCount =
        getStaffCount(guild);

    const now =
        Math.floor(
            Date.now() / 1000
        );

    /*
     * We consider voting separate from an
     * actually-active session.
     */
    const isOnline =
        state.status === 'active' ||
        state.status === 'shutting-down';

    const isVoting =
        state.status === 'vote';


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
                name: 'session-dashboard.png'
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
                name: 'session-footer.png'
            }
        );


    /*
     * ==========================================
     * TOP BUTTONS
     * ==========================================
     */

    const sessionTimesButton =
        new ButtonBuilder()
            .setCustomId(
                'session_times'
            )
            .setLabel(
                'Session Times'
            )
            .setEmoji('🕒')
            .setStyle(
                ButtonStyle.Secondary
            );

    const statusButton =
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
            .setEmoji('📶')
            .setStyle(
                isOnline
                    ? ButtonStyle.Success
                    : isVoting
                        ? ButtonStyle.Primary
                        : ButtonStyle.Danger
            );


    /*
     * ==========================================
     * INFORMATION BUTTONS
     * ==========================================
     */

    const playerButton =
        new ButtonBuilder()
            .setCustomId(
                'session_player_count'
            )
            .setLabel(
                `Player count: ${playerCount}/50`
            )
            .setEmoji('👤')
            .setStyle(
                ButtonStyle.Secondary
            );

    const staffButton =
        new ButtonBuilder()
            .setCustomId(
                'session_staff_count'
            )
            .setLabel(
                `Staff: ${staffCount}`
            )
            .setEmoji('🛡️')
            .setStyle(
                ButtonStyle.Secondary
            );

    const queueButton =
        new ButtonBuilder()
            .setCustomId(
                'session_queue_count'
            )
            .setLabel(
                `Queue: ${queueCount}`
            )
            .setEmoji('👥')
            .setStyle(
                ButtonStyle.Secondary
            );


    /*
     * ==========================================
     * JOIN BUTTON
     * ==========================================
     *
     * Discord link buttons cannot be disabled,
     * so offline uses a normal disabled button.
     */

    let joinButton;

    if (isOnline) {
        joinButton =
            new ButtonBuilder()
                .setLabel(
                    'Join'
                )
                .setEmoji('▶️')
                .setStyle(
                    ButtonStyle.Link
                )
                .setURL(
                    JOIN_URL
                );
    } else {
        joinButton =
            new ButtonBuilder()
                .setCustomId(
                    'session_join_disabled'
                )
                .setLabel(
                    'Join'
                )
                .setEmoji('▶️')
                .setStyle(
                    ButtonStyle.Secondary
                )
                .setDisabled(true);
    }


    /*
     * ==========================================
     * VOTE BUTTON
     * ==========================================
     */

    let voteButton = null;

    if (isVoting) {
        voteButton =
            new ButtonBuilder()
                .setCustomId(
                    'session_vote'
                )
                .setLabel(
                    `Vote: ${state.voters.size}/${state.voteTarget}`
                )
                .setEmoji('🗳️')
                .setStyle(
                    ButtonStyle.Primary
                );
    }


    /*
     * Discord only allows 5 buttons per row.
     *
     * Player, Staff, Queue, Join = 4.
     * Vote becomes the fifth when voting.
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

            /*
             * Top image
             */
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

            /*
             * Session Times | Status
             */
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

            /*
             * Server information
             */
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(
                        '## :logo: Server Information\n\n' +

                        `- **Server name:** ${SERVER_NAME}\n` +
                        `- **Server owner:** ${SERVER_OWNER}\n` +
                        `- **Server Code:** ${SERVER_CODE}\n` +
                        `- **Last update:** <t:${now}:R>`
                    )
            )

            .addSeparatorComponents(
                divider()
            )

            /*
             * Player / Staff / Queue / Join / Vote
             */
            .addActionRowComponents(
                informationRow
            )

            .addSeparatorComponents(
                divider()
            )

            /*
             * Bottom image
             */
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


/*
 * Use this whenever the dashboard needs
 * to be sent for the first time.
 */
async function sendSessionDashboard(
    channel,
    options = {}
) {
    const dashboard =
        buildSessionDashboard({
            guild: channel.guild,
            ...options
        });

    return await channel.send({
        ...dashboard,
        flags: [
            'IsComponentsV2'
        ]
    });
}


/*
 * Decorative buttons acknowledge the click
 * but don't actually do anything.
 */
async function handleDisplayButton(
    interaction
) {
    if (
        !DISPLAY_BUTTONS.includes(
            interaction.customId
        )
    ) {
        return false;
    }

    await interaction.deferUpdate();

    return true;
}


module.exports = {
    buildSessionDashboard,
    sendSessionDashboard,
    handleDisplayButton
};