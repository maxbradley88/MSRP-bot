const easyConfig = require('./easyConfig');

module.exports = {
    guildId: process.env.DISCORD_GUILD_ID,

    // ==========================================
    // DASHBOARD
    // ==========================================

dashboardText: easyConfig.dashboardText,
dashboardImage: easyConfig.dashboardImage,

ticketRulesButton: easyConfig.ticketRulesButton,
informationButton: easyConfig.informationButton,


    // ==========================================
    // SERVER CHANNELS
    // ==========================================

  supportChannelId: easyConfig.dashboardChannelId,
transcriptChannelId: easyConfig.transcriptChannelId,
communitySupportChannelId: easyConfig.communitySupportChannelId,


    // ==========================================
    // TICKET CATEGORIES
    // ==========================================

supportTicketCategoryId: easyConfig.supportCategoryId,
seniorTicketCategoryId: easyConfig.seniorCategoryId,
reportsAppealsTicketCategoryId: easyConfig.reportsAppealsCategoryId,


    // ==========================================
    // STAFF ROLES
    // ==========================================

    supportStaffRoleId: easyConfig.supportStaffRoleId,
    seniorSupportStaffRoleId: easyConfig.seniorSupportStaffRoleId,


    // ==========================================
    // TICKET LIMITS
    // ==========================================

    maxTicketsPerUser: easyConfig.maxTicketsPerUser,
    maxSeniorTicketsPerUser: easyConfig.maxSeniorTicketsPerUser,


    // ==========================================
    // TICKET TYPES
    // ==========================================

    ticketTypes: easyConfig.ticketTypes

};