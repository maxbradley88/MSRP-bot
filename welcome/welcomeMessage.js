const path = require('node:path');
const {
    AttachmentBuilder,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    MessageFlags,
    SeparatorBuilder,
    TextDisplayBuilder
} = require('discord.js');

const WELCOME_CHANNEL_ID = '1547545699288350770';
const VERIFY_URL = 'https://discord.com/channels/1547522469122805891/1550761589269860352';
const IMAGE_PATH = path.join(__dirname, '..', 'images', 'image.png');

async function sendWelcomeMessage(member) {
    try {
        const channel = await member.client.channels.fetch(WELCOME_CHANNEL_ID);
        if (!channel?.isTextBased?.()) return;

        const image = new AttachmentBuilder(IMAGE_PATH, { name: 'welcome-footer.png' });
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## <@${member.id}> Joined!\n` +
                    `Welcome to the server! Please ensure you have verified with Melonly to gain access to all the channels. [Verify with Melonly](${VERIFY_URL})`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder())
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL('attachment://welcome-footer.png')
                )
            );

        await channel.send({
            flags: MessageFlags.IsComponentsV2,
            components: [container],
            files: [image],
            allowedMentions: { users: [member.id], parse: [] }
        });
    } catch (error) {
        console.warn('[WELCOME MESSAGE] Could not send welcome message:', error?.message || error);
    }
}

module.exports = {
    WELCOME_CHANNEL_ID,
    sendWelcomeMessage
};
