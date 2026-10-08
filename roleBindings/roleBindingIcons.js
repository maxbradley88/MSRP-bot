const sharp = require('sharp');

const ICONS = {
    sync: {
        name: 'msrp_role_sync',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M102 46A42 42 0 0 0 31 34L20 46M20 46V22M20 46h24M26 82a42 42 0 0 0 71 12l11-12m0 0v24m0-24H84" fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    publish: {
        name: 'msrp_role_publish',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M64 92V20M38 46l26-26 26 26M24 78v25h80V78" fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    binding: {
        name: 'msrp_role_binding',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M48 80 38 90a22 22 0 0 1-31-31l20-20a22 22 0 0 1 31 0M80 48l10-10a22 22 0 0 1 31 31l-20 20a22 22 0 0 1-31 0M43 85l42-42" fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    name: {
        name: 'msrp_role_name',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><circle cx="64" cy="42" r="22" fill="none" stroke="white" stroke-width="9"/><path d="M24 108c4-25 19-38 40-38s36 13 40 38" fill="none" stroke="white" stroke-width="9" stroke-linecap="round"/></svg>`
    },
    add: {
        name: 'msrp_role_add',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M64 24v80M24 64h80" fill="none" stroke="white" stroke-width="10" stroke-linecap="round"/></svg>`
    },
    save: {
        name: 'msrp_role_save',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M24 22h68l14 14v70H22V22h2zM42 22v30h44V22M43 106V73h42v33" fill="none" stroke="white" stroke-width="8" stroke-linejoin="round"/></svg>`
    },
    remove: {
        name: 'msrp_role_remove',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M34 38h60M50 38V24h28v14M43 38l5 66h32l5-66M56 55v34M72 55v34" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    back: {
        name: 'msrp_role_back',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M58 30 24 64l34 34M27 64h77" fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    },
    prefix: {
        name: 'msrp_role_prefix',
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><path d="M24 101 52 27h18l28 74M34 76h54" fill="none" stroke="white" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    }
};

async function ensureRoleBindingIcons(guild) {
    if (!guild) return {};

    let emojis = guild.emojis.cache;
    try {
        emojis = await guild.emojis.fetch();
    } catch {}

    const result = {};
    for (const [key, icon] of Object.entries(ICONS)) {
        let emoji = emojis.find(existing => existing.name === icon.name) || guild.emojis.cache.find(existing => existing.name === icon.name);
        if (!emoji) {
            try {
                const image = await sharp(Buffer.from(icon.svg)).resize(128, 128).png().toBuffer();
                emoji = await guild.emojis.create({
                    attachment: image,
                    name: icon.name,
                    reason: 'MSRP role management dashboard icon'
                });
            } catch (error) {
                console.warn(`[ROLE ICON] Could not create ${icon.name}: ${error.message}`);
                emoji = null;
            }
        }
        result[key] = emoji;
    }
    return result;
}

function iconFor(guild, key) {
    const name = ICONS[key]?.name;
    if (!name || !guild) return null;
    const emoji = guild.emojis.cache.find(existing => existing.name === name);
    if (!emoji) return null;
    return { id: emoji.id, name: emoji.name, animated: emoji.animated || false };
}

function applyIcon(button, guild, key) {
    const emoji = iconFor(guild, key);
    if (emoji) button.setEmoji(emoji);
    return button;
}

module.exports = {
    ensureRoleBindingIcons,
    iconFor,
    applyIcon
};
