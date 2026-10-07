const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(
    __dirname,
    'sessionTimesData.json'
);

const DEFAULT_DATA = {
    monday: 'No session times',
    tuesday: 'No session times',
    wednesday: 'No session times',
    thursday: 'No session times',
    friday: 'No session times',
    saturday: 'No session times',
    sunday: 'No session times',
    lastUpdated: null
};

function loadSessionTimes() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            saveSessionTimes(DEFAULT_DATA);

            return {
                ...DEFAULT_DATA
            };
        }

        const raw =
            fs.readFileSync(
                DATA_FILE,
                'utf8'
            );

        const parsed =
            JSON.parse(raw);

        return {
            ...DEFAULT_DATA,
            ...parsed
        };

    } catch (error) {
        console.error(
            '[SESSION TIMES LOAD ERROR]',
            error
        );

        return {
            ...DEFAULT_DATA
        };
    }
}

function saveSessionTimes(data) {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                data,
                null,
                2
            ),
            'utf8'
        );

    } catch (error) {
        console.error(
            '[SESSION TIMES SAVE ERROR]',
            error
        );
    }
}

let sessionTimes =
    loadSessionTimes();

function setSessionTimes(times) {
    sessionTimes = {
        monday:
            times.monday ||
            'No session times',

        tuesday:
            times.tuesday ||
            'No session times',

        wednesday:
            times.wednesday ||
            'No session times',

        thursday:
            times.thursday ||
            'No session times',

        friday:
            times.friday ||
            'No session times',

        saturday:
            times.saturday ||
            'No session times',

        sunday:
            times.sunday ||
            'No session times',

        lastUpdated:
            Date.now()
    };

    saveSessionTimes(
        sessionTimes
    );
}

function getSessionTimes() {
    return {
        ...sessionTimes
    };
}

function hasSessionTimes() {
    return Boolean(
        sessionTimes.lastUpdated
    );
}

function getSessionTimesText() {
    if (!hasSessionTimes()) {
        return (
            '## Session Times\n\n' +
            'No session times have been set.'
        );
    }

    const updatedTimestamp =
        Math.floor(
            sessionTimes.lastUpdated / 1000
        );

    return (
        '## Session Times\n\n' +

        `**Monday:** ${sessionTimes.monday}\n` +
        `**Tuesday:** ${sessionTimes.tuesday}\n` +
        `**Wednesday:** ${sessionTimes.wednesday}\n` +
        `**Thursday:** ${sessionTimes.thursday}\n` +
        `**Friday:** ${sessionTimes.friday}\n` +
        `**Saturday:** ${sessionTimes.saturday}\n` +
        `**Sunday:** ${sessionTimes.sunday}\n\n` +

        `Last updated: <t:${updatedTimestamp}:F>`
    );
}

module.exports = {
    setSessionTimes,
    getSessionTimes,
    getSessionTimesText,
    hasSessionTimes
};