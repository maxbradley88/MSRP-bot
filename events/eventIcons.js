const sharp = require('sharp');
const lucide = require('lucide-static');

const ICONS = {
    event: { name: 'msrp_event', lucide: 'PartyPopper' },
    vote: { name: 'msrp_vote', lucide: 'Vote' },
    calendar: { name: 'msrp_event_calendar', lucide: 'CalendarDays' },
    join: { name: 'msrp_event_join', lucide: 'LogIn' },
    finish: { name: 'msrp_event_finish', lucide: 'CircleCheck' }
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
        }

        result[key] = { id: emoji.id, name: emoji.name };
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
