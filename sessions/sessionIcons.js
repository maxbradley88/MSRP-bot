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
            logo: null
        };
    }

    /*
     * Fetch the actual server emojis so we
     * aren't relying only on Discord's cache.
     */
    const emojis =
        await guild.emojis.fetch();

    const result = {};


    /*
     * Find the existing :logo: emoji.
     *
     * We DO NOT create this one because you
     * already have it in the server.
     */
    result.logo =
        emojis.find(
            emoji =>
                emoji.name?.toLowerCase() ===
                'logo'
        ) || null;


    /*
     * Create/reuse our white session icons.
     */
    for (
        const [key, icon]
        of Object.entries(ICONS)
    ) {
        let emoji =
            emojis.find(
                existing =>
                    existing.name ===
                    icon.name
            );

        if (!emoji) {
            try {
                console.log(
                    `[SESSION ICON] Creating :${icon.name}:`
                );

                emoji =
                    await createEmoji(
                        guild,
                        icon
                    );

                console.log(
                    `[SESSION ICON] Created :${icon.name}:`
                );

            } catch (error) {
                console.error(
                    `[SESSION ICON ERROR] ${icon.name}`,
                    error
                );

                emoji = null;
            }
        }

        result[key] = emoji;
    }


    if (!result.logo) {
        console.warn(
            '[SESSION DASHBOARD] Could not find a server emoji named :logo:'
        );
    }


    return result;
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