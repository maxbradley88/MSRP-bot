const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const runtimePath = path.join(__dirname, 'events.runtime.json');

const DEFAULT_DATA = {
    current: null
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadData() {
    try {
        const parsed = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
        return {
            ...clone(DEFAULT_DATA),
            ...parsed,
            current: parsed?.current || null
        };
    } catch {
        return clone(DEFAULT_DATA);
    }
}

function saveData(data) {
    const clean = {
        ...clone(DEFAULT_DATA),
        ...data,
        current: data?.current || null
    };

    fs.writeFileSync(runtimePath, JSON.stringify(clean, null, 2));
    return clean;
}

function makeId(prefix = 'event') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

module.exports = {
    runtimePath,
    loadData,
    saveData,
    makeId
};
