const fs = require('node:fs');
const path = require('node:path');

const runtimePath = path.join(__dirname, 'events.runtime.json');

const DEFAULT_DATA = {
    events: [],
    votes: []
};

function loadData() {
    try {
        const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
        return {
            events: Array.isArray(parsed.events) ? parsed.events : [],
            votes: Array.isArray(parsed.votes) ? parsed.votes : []
        };
    } catch {
        return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
}

function saveData(data) {
    fs.writeFileSync(runtimePath, JSON.stringify(data, null, 2));
}

function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = {
    loadData,
    saveData,
    makeId
};
