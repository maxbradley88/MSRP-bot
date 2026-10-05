const sharp = require('sharp');
const lucide = require('lucide-static');

const icons = {
    general: {
        name: 'msrp_general',
        lucide: 'circle-help'
    },

    higherup: {
        name: 'msrp_higherup',
        lucide: 'arrow-up-circle'
    },

    report: {
        name: 'msrp_report',
        lucide: 'triangle-alert'
    },

    appeal: {
        name: 'msrp_appeal',
        lucide: 'clipboard-list'
    },

    other: {
        name: 'msrp_other',
        lucide: 'ellipsis'
    },

    ticketRules: {
        name: 'msrp_ticket_rules',
        lucide: 'clipboard-list'
    },

    information: {
        name: 'msrp_information_v2',
        lucide: 'info'
    },

    // ==========================================
    // TICKET ACTION ICONS
    // ==========================================

    claim: {
        name: 'msrp_claim',
        lucide: 'check'
    },

    close: {
        name: 'msrp_close',
        lucide: 'lock'
    },

    handoff: {
        name: 'msrp_handoff',
        lucide: 'handshake'
    }
};


// ==========================================
// CREATE LUCIDE SVG
// ==========================================

function createLucideSvg(icon) {

    const lucideIcons = {

        'arrow-up-circle':
            lucide.ArrowUpCircle,

        'info':
            lucide.Info,

        'circle-help':
            lucide.CircleHelp,

        'triangle-alert':
            lucide.TriangleAlert,

        'clipboard-list':
            lucide.ClipboardList,

        'handshake':
            lucide.Handshake,

        'ellipsis':
            lucide.Ellipsis,

        'check':
            lucide.Check,

        'lock':
            lucide.Lock

    };


    const svg =
        lucideIcons[icon];


    if (!svg) {

        throw new Error(
            `Lucide icon "${icon}" was not found.`
        );

    }


    return svg

        .replace(
            'width="24"',
            'width="128"'
        )

        .replace(
            'height="24"',
            'height="128"'
        )

        .replace(
            'currentColor',
            'white'
        );

}


// ==========================================
// SETUP TICKET ICONS
// ==========================================

async function setupTicketIcons(guild) {

    const emojiMap = {};


    for (
        const [ticketType, iconConfig]
        of Object.entries(icons)
    ) {

        let emoji =
            guild.emojis.cache.find(
                existing =>
                    existing.name ===
                    iconConfig.name
            );


        if (!emoji) {

            console.log(
                `🎨 Creating Discord icon: ${iconConfig.name}`
            );


            const svg =
                createLucideSvg(
                    iconConfig.lucide
                );


            const png =
                await sharp(
                    Buffer.from(svg)
                )

                    .resize(
                        128,
                        128
                    )

                    .png()

                    .toBuffer();


            emoji =
                await guild.emojis.create({

                    attachment:
                        png,

                    name:
                        iconConfig.name

                });


            console.log(
                `✅ Created ${iconConfig.name}`
            );

        }


        emojiMap[ticketType] = {

            id:
                emoji.id,

            name:
                emoji.name

        };

    }


    return emojiMap;
}


// ==========================================
// GET TICKET EMOJI
// ==========================================

function getTicketEmoji(
    guild,
    iconKey
) {

    const iconConfig =
        icons[iconKey];


    if (!iconConfig) {

        return null;

    }


    const emoji =
        guild.emojis.cache.find(
            existing =>
                existing.name ===
                iconConfig.name
        );


    if (!emoji) {

        return null;

    }


    return {

        id:
            emoji.id,

        name:
            emoji.name

    };

}


module.exports = {
    setupTicketIcons,
    getTicketEmoji
};