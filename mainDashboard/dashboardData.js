const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_FILE = path.join(__dirname, 'dashboardData.runtime.json');

const DEFAULTS = {
    dashboard: {
        channelId: null,
        messageId: null
    },
    notificationRoles: [
        {
            id: 'session-ping',
            name: 'Session Ping',
            roleId: '1557196999793840220'
        }
    ],
    partnershipConditions: {
        members: null,
        staff: null,
        representatives: null,
        activeCommunity: true,
        other: null,
        notes: null
    },
    rules: {
        game: 'Game rules have not been configured yet.',
        server: 'Server rules have not been configured yet.'
    },
    departments: [],
    partnerships: [],
    applications: {
        gameStaff: 'https://forms.gle/4rYbEj15hoLtyEd38',
        supportTeam: null
    },
    cocTeams: []
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function mergeDefaults(raw = {}) {
    return {
        ...clone(DEFAULTS),
        ...raw,
        dashboard: {
            ...clone(DEFAULTS.dashboard),
            ...(raw.dashboard || {})
        },
        partnershipConditions: {
            ...clone(DEFAULTS.partnershipConditions),
            ...(raw.partnershipConditions || {})
        },
        rules: {
            ...clone(DEFAULTS.rules),
            ...(raw.rules || {})
        },
        applications: {
            ...clone(DEFAULTS.applications),
            ...(raw.applications || {})
        },
        notificationRoles: Array.isArray(raw.notificationRoles)
            ? raw.notificationRoles
            : clone(DEFAULTS.notificationRoles),
        departments: Array.isArray(raw.departments) ? raw.departments : [],
        partnerships: Array.isArray(raw.partnerships) ? raw.partnerships : [],
        cocTeams: Array.isArray(raw.cocTeams) ? raw.cocTeams : []
    };
}

function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            const initial = mergeDefaults();
            saveData(initial);
            return initial;
        }

        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return mergeDefaults(parsed);
    } catch (error) {
        console.warn('[MAIN DASHBOARD] Could not read runtime data; using defaults:', error.message);
        return mergeDefaults();
    }
}

function saveData(data) {
    const clean = mergeDefaults(data);
    fs.writeFileSync(DATA_FILE, JSON.stringify(clean, null, 2));
    return clean;
}

function makeId(prefix) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

module.exports = {
    DATA_FILE,
    DEFAULTS,
    loadData,
    saveData,
    makeId
};
