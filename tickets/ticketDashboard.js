const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextDisplayBuilder,
    MessageFlags
} = require('discord.js');

const config = require('./ticketConfig');
const path = require('node:path');

function createTicketDashboard(iconMap) {

    // ==========================================
    // TICKET DROPDOWN OPTIONS
    // ==========================================

    const ticketOptions = Object.entries(config.ticketTypes).map(
        ([ticketType, ticketConfig]) => {

            const option =
                new StringSelectMenuOptionBuilder()
                    .setLabel(ticketConfig.name)
                    .setValue(ticketType)
                    .setDescription(ticketConfig.description);

            const icon = iconMap?.[ticketType];

            if (icon) {
                option.setEmoji({
                    id: icon.id,
                    name: icon.name
                });
            }

            return option;
        }
    );


    // ==========================================
    // TICKET DROPDOWN
    // ==========================================

    const ticketDropdown = new StringSelectMenuBuilder()
        .setCustomId('ticket_type_select')
        .setPlaceholder('Select a ticket type...')
        .addOptions(ticketOptions);


    // ==========================================
    // TICKET RULES BUTTON
    // ==========================================

    const rulesButton = new ButtonBuilder()
        .setCustomId('ticket_rules')
        .setLabel(config.ticketRulesButton.label)
        .setStyle(
            ButtonStyle[config.ticketRulesButton.buttonColor]
        )
        .setEmoji({
            id: iconMap.ticketRules.id,
            name: iconMap.ticketRules.name
        });


    // ==========================================
    // INFORMATION BUTTON
    // ==========================================

console.log('RULES ICON:', iconMap.ticketRules);
console.log('INFORMATION ICON:', iconMap.information);
    const informationButton = new ButtonBuilder()
        .setLabel(config.informationButton.label)
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${config.guildId}/1547544258276364338`)
        .setEmoji({
            id: iconMap.information.id,
            name: iconMap.information.name
        });


    // ==========================================
    // COMMUNITY SUPPORT BUTTON
    // ==========================================

    const communitySupportButton = new ButtonBuilder()
        .setLabel('Community Support')
        .setStyle(ButtonStyle.Link)
        .setURL(
            `https://discord.com/channels/${config.guildId}/${config.communitySupportChannelId}`
        );


    // ==========================================
    // Applications reuses the exact main dashboard application response.
    const applicationsButton = new ButtonBuilder()
        .setCustomId('ticket_applications')
        .setLabel('Applications')
        .setStyle(ButtonStyle.Secondary);

    // Reuse the custom emoji created by the main information dashboard.
    if (iconMap?.applications) {
        applicationsButton.setEmoji(iconMap.applications);
    }


    // DASHBOARD CONTAINER
    // ==========================================

    const container = new ContainerBuilder()

        // IMAGE
        .addMediaGalleryComponents(
            new MediaGalleryBuilder()
                .addItems(
                    new MediaGalleryItemBuilder()
                        .setURL('attachment://ticket-dashboard.png')
                )
        )

        // DIVIDER
        .addSeparatorComponents(
            new SeparatorBuilder()
        )

        // TEXT
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(config.dashboardText)
        )

        // DIVIDER
        .addSeparatorComponents(
            new SeparatorBuilder()
        )

        // BUTTONS
        .addActionRowComponents(
            new ActionRowBuilder()
                .addComponents(
                    rulesButton,
                    applicationsButton,
                    informationButton
                )
        )

        // DIVIDER
        .addSeparatorComponents(
            new SeparatorBuilder()
        )

        // TICKET DROPDOWN
        .addActionRowComponents(
            new ActionRowBuilder()
                .addComponents(ticketDropdown)
        )

        // COMMUNITY SUPPORT: separate row because Discord select menus
        // must occupy their own action row.
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(communitySupportButton)
        )

        // DIVIDER
        .addSeparatorComponents(new SeparatorBuilder())

        // FOOTER IMAGE
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://image.png')
            )
        );


    return {
        flags: MessageFlags.IsComponentsV2,

        components: [
            container
        ],

        files: [
            {
                attachment: config.dashboardImage,
                name: 'ticket-dashboard.png'
            },
            {
                attachment: path.join(__dirname, '..', 'images', 'image.png'),
                name: 'image.png'
            }
        ]
    };
}


module.exports = {
    createTicketDashboard
};