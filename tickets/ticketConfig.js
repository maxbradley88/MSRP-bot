const easyConfig = require('./easyConfig');

module.exports = {

    guildId:
        process.env.DISCORD_GUILD_ID,

    dashboardText:
        easyConfig.dashboardText,

    dashboardImage:
        easyConfig.dashboardImage,

    ticketRulesButton:
        easyConfig.ticketRulesButton,

    informationButton:
        easyConfig.informationButton,


    // ==========================================
    // CHANNELS
    // ==========================================

    supportChannelId:
        easyConfig.dashboardChannelId,

    transcriptChannelId:
        easyConfig.transcriptChannelId,

    communitySupportChannelId:
        easyConfig.communitySupportChannelId,


    // ==========================================
    // CATEGORIES
    // ==========================================

    supportTicketCategoryId:
        easyConfig.supportCategoryId,

    seniorTicketCategoryId:
        easyConfig.seniorCategoryId,

    reportsAppealsTicketCategoryId:
        easyConfig.reportsAppealsCategoryId,


    // ==========================================
    // STAFF ROLES
    // ==========================================

    supportStaffRoleId:
        easyConfig.supportStaffRoleId,

    seniorSupportStaffRoleId:
        easyConfig.seniorSupportStaffRoleId,

    reportsAppealsStaffRoleId:
        easyConfig.reportsAppealsRoleId,

    // Used by the existing support-role checks
    reportsAppealsRoleId:
        easyConfig.reportsAppealsRoleId,


    // ==========================================
    // TICKET LIMITS
    // ==========================================

    maxSupportTicketsPerUser:
        easyConfig.maxSupportTicketsPerUser,

    maxSeniorTicketsPerUser:
        easyConfig.maxSeniorTicketsPerUser,

    maxReportsAppealsTicketsPerUser:
        easyConfig.maxReportsAppealsTicketsPerUser,


    // ==========================================
    // TICKET TYPES
    // ==========================================

    ticketTypes:
        easyConfig.ticketTypes
};