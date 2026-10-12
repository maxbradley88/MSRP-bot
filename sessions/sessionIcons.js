const sharp = require('sharp');

const ICONS = {
    sessionTimes: {
        name: 'msrp_session_times',
        svg: `
            <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
                <circle cx="64" cy="64" r="45" fill="none" stroke="white" stroke-width="8"/>
                <path d="M64 38v29l19 12" fill="none" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `
    },

    status: {
        name: 'msrp_session_status',
        svg: `
            <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
                <path d="M25 51c22-22 56-22 78 0" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>
                <path d="M39 68c14-14 36-14 50 0" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>
                <path d="M53 84c6-6 16-6 22 0" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>
                <circle cx="64" cy="98" r="5" fill="white"/>
            </svg>
        `
    },

    players: {
        name: 'msrp_players',
        svg: `
            <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
                <circle cx="64" cy="45" r="20" fill="none" stroke="white" stroke-width="8"/>
                <path d="M29 104c3-22 16-34 35-34s32 12 35 34" fill="none" stroke="white" stroke-width="8" stroke-linecap="round"/>
            </svg>
        `
    },

    staff: {
        name: 'msrp_staff',
        svg: `
            <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
                <path d="M64 17l37 15v26c0 25-14 43-37 53C41 101 27 83 27 58V32l37-15z"
                    fill="none"
                    stroke="white"
                    stroke-width="8"
                    stroke-linejoin="round"/>
                <path d="M47 63l12 12 24-27"
                    fill="none"
                    stroke="white"
                    stroke-width="8"
                    stroke-linecap="round"
                    stroke-linejoin="round"/>
            </svg>
        `
    },

    queue: {
        name: 'msrp_queue',
        svg: `
            <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
                <circle cx="49" cy="45" r="17" fill="none" stroke="white" stroke-width="8"/>
                <circle cx="91" cy="51" r="13" fill="none" stroke="white" stroke-width="8"/>
                <path d="M18 103c3-21 14-33 31-33 18 0 29 12 32 33"
                    fill="none"
                    stroke="white"
                    stroke-width="8"
                    stroke-linecap="round"/>
                <path d="M79 76c16 0 26 9 29 27"
                    fill="none"
                    stroke="white"
                    stroke-width="8"
                    stroke-linecap="round"/>
            </svg>
        `
    },

    join: {
        name: 'msrp_join',
        svg: `
            <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
                <path d="M42 25l55 39-55 39z"
                    fill="none"
                    stroke="white"
                    stroke-width="8"
                    stroke-linejoin="round"/>
            </svg>
        `
    },



    tick: {
        name: 'msrp_tick',
        svg: `
            <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
                <path d="M28 67l23 23 49-54"
                    fill="none"
                    stroke="white"
                    stroke-width="10"
                    stroke-linecap="round"
                    stroke-linejoin="round"/>
            </svg>
        `
    },
    vote: {
        name: 'msrp_vote',
        svg: `
            <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
                <rect x="22" y="61" width="84" height="48" rx="8"
                    fill="none"
                    stroke="white"
                    stroke-width="8"/>
                <path d="M45 61L38 31l44-11 8 32"
                    fill="none"
                    stroke="white"
                    stroke-width="8"
                    stroke-linejoin="round"/>
                <path d="M54 39l11 8 15-18"
                    fill="none"
                    stroke="white"
                    stroke-width="7"
                    stroke-linecap="round"
                    stroke-linejoin="round"/>
            </svg>
        `
    }
};


async function createEmoji(guild, icon) {
    const image = await sharp(
        Buffer.from(icon.svg)
    )
        .resize(128, 128)
        .png()
        .toBuffer();

    return await guild.emojis.create({
        attachment: image,
        name: icon.name,
        reason:
            'MSRP session dashboard icon'
    });
}


const ICON_RUNTIME_KEY = Symbol.for('msrp.sessionIcons.runtime');
const iconRuntime = globalThis[ICON_RUNTIME_KEY] || (globalThis[ICON_RUNTIME_KEY] = {
    byGuild: new Map(),
    ensurePromises: new Map(),
    lastRestFetchAt: new Map()
});

async function ensureSessionIcons(guild) {
    if (!guild) {
        return {
            sessionTimes: null,
            status: null,
            players: null,
            staff: null,
            queue: null,
            join: null,
            vote: null,
            tick: null,
            logo: null
        };
    }

    const cached = iconRuntime.byGuild.get(guild.id);
    if (cached) return cached;

    if (iconRuntime.ensurePromises.has(guild.id)) {
        return iconRuntime.ensurePromises.get(guild.id);
    }

    const promise = (async () => {
        // Start with discord.js' gateway/cache data. Do NOT call emojis.fetch()
        // on every dashboard refresh.
        let emojis = guild.emojis.cache;

        const expectedNames = new Set([
            'logo',
            ...Object.values(ICONS).map(icon => icon.name)
        ]);
        const missingAny = [...expectedNames].some(
            name => !emojis.find(e => e.name?.toLowerCase() === name.toLowerCase())
        );

        // At most one REST emoji refresh per guild every 30 minutes, and only
        // if something is actually missing from cache.
        const lastFetch = iconRuntime.lastRestFetchAt.get(guild.id) || 0;
        if (missingAny && Date.now() - lastFetch > 30 * 60 * 1000) {
            iconRuntime.lastRestFetchAt.set(guild.id, Date.now());
            try {
                emojis = await guild.emojis.fetch();
            } catch (error) {
                console.warn('[SESSION ICONS] Emoji REST refresh failed; using cache:', error?.message || error);
            }
        }

        const result = {};
        result.logo =
            emojis.find(emoji => emoji.name?.toLowerCase() === 'logo') ||
            guild.emojis.cache.find(emoji => emoji.name?.toLowerCase() === 'logo') ||
            null;

        for (const [key, icon] of Object.entries(ICONS)) {
            let emoji =
                emojis.find(existing => existing.name === icon.name) ||
                guild.emojis.cache.find(existing => existing.name === icon.name);

            if (!emoji) {
                try {
                    console.log(`[SESSION ICON] Creating :${icon.name}:`);
                    emoji = await createEmoji(guild, icon);
                } catch (error) {
                    console.error(`[SESSION ICON ERROR] ${icon.name}`, error);
                    emoji = null;
                }
            }
            result[key] = emoji;
        }

        if (!result.logo) {
            console.warn('[SESSION DASHBOARD] Could not find a server emoji named :logo:');
        }

        iconRuntime.byGuild.set(guild.id, result);
        return result;
    })().finally(() => {
        iconRuntime.ensurePromises.delete(guild.id);
    });

    iconRuntime.ensurePromises.set(guild.id, promise);
    return promise;
}


function buttonEmoji(emoji) {
    if (!emoji) {
        return null;
    }

    return {
        id: emoji.id,
        name: emoji.name,
        animated:
            emoji.animated || false
    };
}


module.exports = {
    ensureSessionIcons,
    buttonEmoji
};