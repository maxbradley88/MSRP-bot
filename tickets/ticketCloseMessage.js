const path = require('node:path');

const {
    ContainerBuilder,
    FileBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');

const DASHBOARD_IMAGE_PATH = path.join(
    __dirname,
    '..',
    'images',
    'ticket-dashboard.png'
);

const FOOTER_IMAGE_PATH = path.join(
    __dirname,
    '..',
    'images',
    'image.png'
);

function getTicketNumber(channelName) {
    const name = String(channelName || '');
    const match = name.match(/(?:^|-)(\d{3,})$/);

    if (match) {
        return match[1];
    }

    const parts = name.split('-').filter(Boolean);
    return parts.at(-1) || 'Unknown';
}

function buildCloseContainer({
    ticketNumber,
    closedByUserId,
    reason,
    transcriptFile
}) {
    const container = new ContainerBuilder()
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(
                    'attachment://ticket-dashboard.png'
                )
            )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## Ticket ${ticketNumber} Closed\n` +
                `Closed by <@${closedByUserId}>`
            )
        )
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true)
        )
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**Reason for close:** ${reason}`
            )
        );

    if (transcriptFile?.name) {
        container.addFileComponents(
            new FileBuilder().setURL(
                `attachment://${transcriptFile.name}`
            )
        );
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '*Transcript unavailable.*'
            )
        );
    }

    container
        .addSeparatorComponents(
            new SeparatorBuilder().setDivider(true)
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(
                    'attachment://image.png'
                )
            )
        );

    return container;
}

function buildFiles(transcriptFile) {
    const files = [
        {
            attachment: DASHBOARD_IMAGE_PATH,
            name: 'ticket-dashboard.png'
        }
    ];

    if (transcriptFile) {
        files.push(transcriptFile);
    }

    files.push({
        attachment: FOOTER_IMAGE_PATH,
        name: 'image.png'
    });

    return files;
}

function buildPayload(options) {
    return {
        components: [
            buildCloseContainer(options)
        ],
        files: buildFiles(options.transcriptFile),
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: {
            parse: []
        }
    };
}

async function sendTicketCloseNotifications({
    client,
    closeLogChannelId,
    ownerId,
    closedByUserId,
    channelName,
    reason,
    transcriptFile = null
}) {
    const ticketNumber = getTicketNumber(channelName);
    const tasks = [];

    let logChannel =
        client.channels.cache.get(closeLogChannelId) || null;

    if (!logChannel) {
        try {
            logChannel = await client.channels.fetch(
                closeLogChannelId
            );
        } catch (error) {
            console.error(
                '[CLOSE LOG CHANNEL FETCH ERROR]',
                error
            );
        }
    }

    if (logChannel?.isTextBased()) {
        tasks.push(
            logChannel.send(
                buildPayload({
                    ticketNumber,
                    closedByUserId,
                    reason,
                    transcriptFile
                })
            )
        );
    }

    if (ownerId) {
        tasks.push(
            (async () => {
                const user =
                    client.users.cache.get(ownerId) ||
                    await client.users.fetch(ownerId);

                await user.send(
                    buildPayload({
                        ticketNumber,
                        closedByUserId,
                        reason,
                        transcriptFile
                    })
                );
            })()
        );
    }

    const results = await Promise.allSettled(tasks);

    for (const result of results) {
        if (result.status === 'rejected') {
            console.error(
                '[CLOSE NOTIFICATION ERROR]',
                result.reason
            );
        }
    }
}

module.exports = {
    sendTicketCloseNotifications
};
