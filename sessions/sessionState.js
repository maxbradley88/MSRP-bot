const state = {
    status: 'offline',
    voteTarget: 0,
    voters: new Set(),
    startedAt: null,
    emptySince: null,
    shuttingDown: false
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
    clearEmptySince
};