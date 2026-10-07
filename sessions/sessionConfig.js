module.exports = {
    // Channel used for all session vote/start announcements.
    announcementChannelId: '1547544325792202782',
    sessionChannelId: '1547544325792202782',

    // Roles pinged when a vote starts and when a session starts.
    pingRoleIds: [
        '1557196999793840220',
        '1547541940197793832'
    ],
    announcementRoleIds: [
        '1557196999793840220',
        '1547541940197793832'
    ],

    // Role allowed to run session control commands.
    sessionControlRoleId: '1548126738876342272',

    // Existing staff role retained for anything else that uses it.
    staffRoleId: '1547535313096810546',

    joinUrl: 'https://erlc.gg/join/MSRPAU',
    fallbackJoinCode: 'MSRPAU',
    serverCode: 'MSRPAU',

    // Fallback values only. Melonly server info takes priority on the dashboard.
    serverName: 'Melbourne State Roleplay | Strict | VC | New',
    serverOwner:
        '[monkeyman443hi](https://www.roblox.com/users/3927928067/profile?friendshipSourceType=PlayerSearch)',

    dashboardRefreshMs: 30_000,
    refreshIntervalMs: 30_000,
    maxPlayers: 50,

    // Melonly currently has no documented public session-start endpoint.
    // We still attempt the helper, but failure will NOT block the Discord session.
    attemptMelonlyStart: false,

    // Shutdown flow.
    shutdownCountdownSeconds: 180,
    shutdownAnnouncementLifetimeMs: 60 * 60 * 1000,
    shutdownLockdownRefreshMs: 15_000,
    shutdownGameMessage:
        'The MSRP server will be shutting down in 3 minutes. Please wrap-up your role-plays'
};
