const sharp = require('sharp');
const lucide = require('lucide-static');

const ICONS = {
    notifications: { name: 'msrp_notifications', lucide: 'Bell' },
    partnership: { name: 'msrp_handoff', lucide: 'Handshake' },
    rules: { name: 'msrp_ticket_rules', lucide: 'ClipboardList' },
    departments: { name: 'msrp_departments', lucide: 'Building2' },
    applications: { name: 'msrp_applications', lucide: 'FileText' },
    chain: { name: 'msrp_chain', lucide: 'Network' }
};

function whiteSvg(exportName) {
    const svg = lucide[exportName];
    if (!svg) throw new Error(`Lucide icon ${exportName} was not found.`);

    return svg
        .replace('width="24"', 'width="128"')
        .replace('height="24"', 'height="128"')
        .replace(/currentColor/g, 'white');
}

async function ensureDashboardIcons(guild) {
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
                reason: 'MSRP main dashboard icon'
            });

            console.log(`[MAIN DASHBOARD] Created icon ${spec.name}`);
        }

        result[key] = {
            id: emoji.id,
            name: emoji.name
        };
    }

    return result;
}

function getDashboardIcons(guild) {
    const result = {};

    for (const [key, spec] of Object.entries(ICONS)) {
        const emoji = guild.emojis.cache.find(existing => existing.name === spec.name);
        if (emoji) {
            result[key] = { id: emoji.id, name: emoji.name };
        }
    }

    return result;
}

module.exports = {
    ICONS,
    ensureDashboardIcons,
    getDashboardIcons
};
