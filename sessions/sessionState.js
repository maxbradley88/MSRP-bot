const fs = require('fs');
const path = require('path');

const runtimePath = path.join(__dirname, 'sessionRuntimeData.json');

function loadRuntime() {
    try {
        return JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    } catch {
        return {};
    }
}

const runtime = loadRuntime();

const state = {
    status: 'offline',
    voteTarget: 0,
    voters: new Set(),
    startedAt: null,
    emptySince: null,
    shuttingDown: false,

    dashboardChannelId: runtime.dashboardChannelId || null,
    dashboardMessageId: runtime.dashboardMessageId || null,
    voteAnnouncementChannelId: null,
    voteAnnouncementMessageId: null,
    sessionAnnouncementChannelId: null,
    sessionAnnouncementMessageId: null,

    shutdownAnnouncementChannelId: runtime.shutdownAnnouncementChannelId || null,
    shutdownAnnouncementMessageId: runtime.shutdownAnnouncementMessageId || null,
    shutdownAnnouncementExpiresAt: runtime.shutdownAnnouncementExpiresAt || null,

    shutdownLockdownEnabled: Boolean(runtime.shutdownLockdownEnabled),
    shutdownGraceUserIds: new Set(runtime.shutdownGraceUserIds || []),

    lastMelonlySnapshot: null,
    lastErlcHealth: null,
    lastUpdatedAt: null
};

function saveRuntime() {
    try {
        fs.writeFileSync(
            runtimePath,
            JSON.stringify({
                dashboardChannelId: state.dashboardChannelId,
                dashboardMessageId: state.dashboardMessageId,
                shutdownAnnouncementChannelId: state.shutdownAnnouncementChannelId,
                shutdownAnnouncementMessageId: state.shutdownAnnouncementMessageId,
                shutdownAnnouncementExpiresAt: state.shutdownAnnouncementExpiresAt,
                shutdownLockdownEnabled: state.shutdownLockdownEnabled,
                shutdownGraceUserIds: [...state.shutdownGraceUserIds]
            }, null, 2)
        );
    } catch (error) {
        console.error('[SESSION RUNTIME SAVE ERROR]', error);
    }
}

function getState() {
    return state;
}

function setStatus(status) {
    state.status = status;
}

function startVote(target) {
    state.status = 'vote';
    state.voteTarget = target;
    state.voters.clear();
    state.startedAt = null;
    state.emptySince = null;
    state.shuttingDown = false;
}

function addVote(userId) {
    state.voters.add(userId);
}

function removeVote(userId) {
    state.voters.delete(userId);
}

function hasVoted(userId) {
    return state.voters.has(userId);
}

function getVoteCount() {
    return state.voters.size;
}

function startSession() {
    state.status = 'active';
    state.startedAt = Date.now();
    state.voteTarget = 0;
    state.voters.clear();
    state.emptySince = null;
    state.shuttingDown = false;

    // A new session disables the post-shutdown join lockdown.
    state.shutdownLockdownEnabled = false;
    state.shutdownGraceUserIds.clear();
    saveRuntime();
}

function startShutdown() {
    state.status = 'shutting-down';
    state.shuttingDown = true;
}

function stopSession() {
    state.status = 'offline';
    state.startedAt = null;
    state.voteTarget = 0;
    state.voters.clear();
    state.emptySince = null;
    state.shuttingDown = false;
}

function setEmptySince(timestamp) {
    state.emptySince = timestamp;
}

function clearEmptySince() {
    state.emptySince = null;
}

function setDashboardMessage(channelId, messageId) {
    state.dashboardChannelId = channelId;
    state.dashboardMessageId = messageId;
    saveRuntime();
}

function setVoteAnnouncement(channelId, messageId) {
    state.voteAnnouncementChannelId = channelId;
    state.voteAnnouncementMessageId = messageId;
}

function clearVoteAnnouncement() {
    state.voteAnnouncementChannelId = null;
    state.voteAnnouncementMessageId = null;
}

function setSessionAnnouncement(channelId, messageId) {
    state.sessionAnnouncementChannelId = channelId;
    state.sessionAnnouncementMessageId = messageId;
}

function clearSessionAnnouncement() {
    state.sessionAnnouncementChannelId = null;
    state.sessionAnnouncementMessageId = null;
}

function setShutdownAnnouncement(channelId, messageId, expiresAt) {
    state.shutdownAnnouncementChannelId = channelId;
    state.shutdownAnnouncementMessageId = messageId;
    state.shutdownAnnouncementExpiresAt = expiresAt || null;
    saveRuntime();
}

function clearShutdownAnnouncement() {
    state.shutdownAnnouncementChannelId = null;
    state.shutdownAnnouncementMessageId = null;
    state.shutdownAnnouncementExpiresAt = null;
    saveRuntime();
}

function enableShutdownLockdown(graceUserIds = []) {
    state.shutdownLockdownEnabled = true;
    state.shutdownGraceUserIds = new Set(
        (graceUserIds || []).map(value => String(value))
    );
    saveRuntime();
}

function enterPostShutdownLockdown() {
    state.shutdownLockdownEnabled = true;
    state.shutdownGraceUserIds.clear();
    saveRuntime();
}

function disableShutdownLockdown() {
    state.shutdownLockdownEnabled = false;
    state.shutdownGraceUserIds.clear();
    saveRuntime();
}

function setApiSnapshot({ melonly, erlc, updatedAt = Date.now() }) {
    state.lastMelonlySnapshot = melonly;
    state.lastErlcHealth = erlc;
    state.lastUpdatedAt = updatedAt;
}

module.exports = {
    getState,
    setStatus,
    startVote,
    addVote,
    removeVote,
    hasVoted,
    getVoteCount,
    startSession,
    startShutdown,
    stopSession,
    setEmptySince,
    clearEmptySince,
    setDashboardMessage,
    setVoteAnnouncement,
    clearVoteAnnouncement,
    setSessionAnnouncement,
    clearSessionAnnouncement,
    setShutdownAnnouncement,
    clearShutdownAnnouncement,
    enableShutdownLockdown,
    enterPostShutdownLockdown,
    disableShutdownLockdown,
    setApiSnapshot
};
