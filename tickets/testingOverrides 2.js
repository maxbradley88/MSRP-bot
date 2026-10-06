// TEMPORARY MSRP TICKET TESTING OVERRIDES
//
// While this file exists with the setting below enabled, a ticket creator who
// also has an MSRP support role can use the ticket buttons as a normal staff
// member. Their normal role restrictions still apply:
// - Support / Reports & Appeals cannot take over an already claimed ticket.
// - They can only close or hand off tickets they personally claimed.
// - Senior Support keeps its normal override permissions.
//
// Delete this file (or change the value to false) and restart the bot to return
// to production behaviour where ticket creators cannot use staff buttons.

module.exports = {
    allowTicketCreatorStaffActions: true
};
