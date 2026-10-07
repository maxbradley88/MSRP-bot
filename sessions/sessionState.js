const state = {
    status: 'offline',
    voteTarget: 0,
    voters: new Set(),
    startedAt: null,
    emptySince: null,
    shuttingDown: false,
    dashboardMessageId: null,
    voteMessageId: null
};

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
    state.voteMessageId = null;
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

function getVoters() {
    return [...state.voters];
}

function startSession() {
    state.status = 'active';
    state.startedAt = Date.now();
    state.voteTarget = 0;
    state.voters.clear();
    state.emptySince = null;
    state.shuttingDown = false;
    state.voteMessageId = null;
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
    state.voteMessageId = null;
}

function setEmptySince(timestamp) {
    state.emptySince = timestamp;
}

function clearEmptySince() {
    state.emptySince = null;
}

function setDashboardMessageId(messageId) {
    state.dashboardMessageId = messageId || null;
}

function setVoteMessageId(messageId) {
    state.voteMessageId = messageId || null;
}

module.exports = {
    getState,
    setStatus,
    startVote,
    addVote,
    removeVote,
    hasVoted,
    getVoteCount,
    getVoters,
    startSession,
    startShutdown,
    stopSession,
    setEmptySince,
    clearEmptySince,
    setDashboardMessageId,
    setVoteMessageId
};
