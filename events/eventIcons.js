const sharp = require('sharp');
const lucide = require('lucide-static');

const ICONS = {
    vote: { name: 'msrp_vote', lucide: 'Vote' },
    staff: { name: 'msrp_event_staff', lucide: 'Settings2' },
    join: { name: 'msrp_event_join', lucide: 'LogIn' },
    participants: { name: 'msrp_event_people', lucide: 'Users' },
    status: { name: 'msrp_event_status', lucide: 'Activity' },
    add: { name: 'msrp_event_add', lucide: 'CirclePlus' },
    remove: { name: 'msrp_event_remove', lucide: 'CircleMinus' },
    end: { name: 'msrp_event_end', lucide: 'CircleStop' },
    cancel: { name: 'msrp_event_cancel', lucide: 'CircleX' },
    configure: { name: 'msrp_event_configure', lucide: 'SlidersHorizontal' },
    calendar: { name: 'msrp_event_calendar', lucide: 'CalendarDays' },
    host: { name: 'msrp_event_host', lucide: 'UserRoundCog' },
    partnership: { name: 'msrp_event_partner', lucide: 'Handshake' },
    start: { name: 'msrp_event_start', lucide: 'Play' },
    winner: { name: 'msrp_event_winner', lucide: 'Trophy' }
};

function whiteSvg(exportName) {
    const svg = lucide[exportName];
    if (!svg) throw new Error(`Lucide icon ${exportName} was not found.`);

    return svg
        .replace('width="24"', 'width="128"')
        .replace('height="24"', 'height="128"')
        .replace(/currentColor/g, 'white');
}

async function ensureEventIcons(guild) {
    const result = {};

    for (const [key, spec] of Object.entries(ICONS)) {
        let emoji = guild.emojis.cache.find(existing => existing.name === spec.name);

        if (!emoji) {
            try {
                const png = await sharp(Buffer.from(whiteSvg(spec.lucide)))
                    .resize(128, 128)
                    .png()
                    .toBuffer();

                emoji = await guild.emojis.create({
                    attachment: png,
                    name: spec.name,
                    reason: 'MSRP event system icon'
                });
                console.log(`[EVENTS] Created icon ${spec.name}`);
            } catch (error) {
                console.warn(`[EVENTS] Could not create icon ${spec.name}:`, error?.message || error);
            }
        }

        if (emoji) result[key] = { id: emoji.id, name: emoji.name };
    }

    return result;
}

function getEventIcons(guild) {
    const result = {};

    for (const [key, spec] of Object.entries(ICONS)) {
        const emoji = guild.emojis.cache.find(existing => existing.name === spec.name);
        if (emoji) result[key] = { id: emoji.id, name: emoji.name };
    }

    return result;
}

module.exports = {
    ensureEventIcons,
    getEventIcons
};
