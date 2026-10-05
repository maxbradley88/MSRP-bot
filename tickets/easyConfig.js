module.exports = {

    // ==========================================
    // DASHBOARD
    // ==========================================

    dashboardText:
    '**Need assistance?**\nSelect the category below that best matches your request. Our support team will assist you as soon as possible.',

    // Dashboard image
    dashboardImage: './images/ticket-dashboard.png',

    // ==========================================
    // DASHBOARD BUTTONS
    // ==========================================
    //
    // These are buttons that open a private message.
    //
    // The Community Support button is configured
    // separately because it links directly to a channel.
    //
    // ==========================================


    // ------------------------------------------
    // TICKET RULES BUTTON
    // ------------------------------------------

    ticketRulesButton: {
        label: 'Ticket Rules',
        icon: 'clipboard-list',
        buttonColor: 'Secondary',

        message:
            '# Support Rules\n\n' +
'Welcome to our **Support Channel!** Here, you can receive assistance, report or appeal a decision, request an interview for a rank, and ask any questions you may have.\n\n' +
'Our friendly and dedicated staff are here to help you, but we ask that you treat them with the same respect and courtesy they show you. To ensure our support system remains **safe, fair, and welcoming environment** for everyone, please follow the rules below:\n\n' +
'## 1. Remain respectful to staff\n' +
'Please communicate with all staff members in a polite and respectful manner.\n\n' +
'## 2. Do not ping staff\n' +
'Please do not directly ping, mention, or mass-mention staff members regarding your ticket.\n\n' +
'## 3.Cooperate with staff requests\n' +
'Please cooperate with reasonable requests made by our staff while your ticket is being handled.\n\n' +
'## 4. Remember that staff are people too\n' +
'Our staff volunteer their time to assist the community. Please be patient and respectful while they work to resolve your request.\n\n' +
'## ⚠️ Failure to Follow the Rules\n' +
'Failure to comply with any of the above rules may result in your **ticket being voided and the situation being referred for further investigation.**\n\n' +
'By selecting **Yes** when creating a ticket, you confirm that you have read, understood, and agree to follow the rules of our Support System.\n\n' +
'---\n\n' +
'## MSRP Foundership Team'
    },


    // ------------------------------------------
    // INFORMATION BUTTON
    // ------------------------------------------

    informationButton: {
        label: 'Information',
        icon: 'circle-info',
        buttonColor: 'Secondary',

        message:
            '# Support System Information\n\n' +
'**General Support:**\n' +
'Answered by Support Staff (SS)\n' +
'General questions - Low maintenance issues.\n\n' +
'**Report:**\n' +
'Answered by Reports & Appeals Support (R/A)\n' +
'Make a report against a user or issue in the server. - include evidence\n\n' +
'**Appeal:**\n' +
'Answered by Reports & Appeals Support (R/A)\n' +
'Appeal any moderation made against you - must gave evidence\n\n' +
'**Other:**\n' +
'Answered by Support Staff (SS)\n' +
'Passed onto whoever required.' 
    },



    // ==========================================
    // GENERAL SETTINGS
    // ==========================================

    // How many normal tickets one user can have open
    maxTicketsPerUser: 2,

    // How many Senior Support tickets one user can have open
    maxSeniorTicketsPerUser: 1,


    // ==========================================
    // SERVER CHANNELS
    // ==========================================

    // Channel where the community support button takes you
    communitySupportChannelId: '1547546126008328232',

    // Channel where the ticket panel is posted
    dashboardChannelId: '1547544348508557393',

    // Channel where closed-ticket transcripts are stored
    transcriptChannelId: '1556207732833394698',


    // ==========================================
    // TICKET CATEGORIES
    // ==========================================

    // 1 = Support Staff
    supportCategoryId: '1549002104037965924',

    // 2 = Senior Support Staff
    seniorCategoryId: '1549002139253211199',

    // 3 = Reports & Appeals
    reportsAppealsCategoryId: '1556229657550921729',


    // ==========================================
    // STAFF ROLES
    // ==========================================

    // Support Staff
    supportStaffRoleId: '1556203938427183105',

    // Senior Support Staff
    seniorSupportStaffRoleId: '1556204783256346676',

    // Reports & Appeals
    reportsAppealsRoleId: '1556224456152719361',


    // ==========================================
    // TICKET TYPES
    // ==========================================

    ticketTypes: {

        // ==========================================
        // GENERAL SUPPORT
        // ==========================================

            general: {
            name: 'General Support',
            icon: 'circle-help',
            description: 'Get help with a general question or issue.',
            category: 1,
            roleId: '1556203938427183105',
            buttonColor: 'Primary',

            questions: [
                {
                    id: 'issue',
                    label: 'What do you need help with?',
                    placeholder: 'Describe your issue...',
                    style: 'Paragraph',
                    required: true
                },
                {
                    id: 'rules_read',
                    label: 'Have you read our rules?',
                    placeholder: 'Please confirm that you have read our rules.',
                    type: 'dropdown',
                    options: [
                        {
                            label: 'Yes',
                            value: 'yes'
                        },
                    ],
                    required: true
                }
            ]
        },


        // ==========================================
        // REQUEST A HIGHER UP
        // ==========================================

        higherup: {
            name: 'Request a Higher Up',
            icon: 'arrow-up-circle',
            description: 'Request assistance from a member of Senior Support Staff.',
            category: 2,
            roleId: '1556204783256346676',
            buttonColor: 'Secondary',

                 questions: [
                {
                    id: 'issue',
                    label: 'What do you need help with?',
                    placeholder: 'Describe your issue...',
                    style: 'Paragraph',
                    required: true
                },
                {
                    id: 'rules_read',
                    label: 'Have you read our rules?',
                    placeholder: 'Please confirm that you have read our rules.',
                    type: 'dropdown',
                    options: [
                        {
                            label: 'Yes',
                            value: 'yes'
                        },
                    ],
                    required: true
                }
            ]
        },



        // ==========================================
        // REPORT
        // ==========================================

        report: {
            name: 'Report',
            icon: 'triangle-alert',
            description: 'Report a user with evidence of rule-breaking.',
            category: 3,
            roleId: '1556224456152719361',
            buttonColor: 'Danger',

        questions: [
                {
                    id: 'Username',
                    label: 'Username',
                    placeholder: 'What is the robloxusername you are reporting?',
                    style: 'Short',
                    required: true
                },
                {
                    id: 'Information',
                    label: 'Information',
                    placeholder: 'Please provide infomation that will be useful to the staff in investigating this report.',
                    style: 'Paragraph',
                    required: true
                },
                {
                    id: 'Evidence',
                    label: 'Evidence',
                    placeholder: 'Please provided a link to any evidence regarding this report.',
                    style: 'Short',
                    required: false
                },
                {
                    id: 'rules_read',
                    label: 'Have you read our rules?',
                    placeholder: 'Please confirm that you have read our rules.',
                    type: 'dropdown',
                    options: [
                        {
                            label: 'Yes',
                            value: 'yes'
                        },
                    ],
                    required: true
                }
            ]
        },



        // ==========================================
        // APPEAL
        // ==========================================

        appeal: {
            name: 'Appeal',
            icon: 'clipboard-list',
            description: 'Submit an appeal for incorrect moderation.',
            category: 3,
            roleId: '1556224456152719361',
            buttonColor: 'Success',

            questions: [
                {
                    id: 'Username',
                    label: 'Username',
                    placeholder: 'What is your roblox username?',
                    style: 'Short',
                    required: true
                },
                {
                    id: 'Information',
                    label: 'Information',
                    placeholder: 'Please provide infomation that will be useful to the staff in investigating this appeal.',
                    style: 'Paragraph',
                    required: true
                },
                {
                    id: 'Evidence',
                    label: 'Evidence',
                    placeholder: 'Please provided a link to any evidence regarding this appeal.',
                    style: 'Short',
                    required: false
                },
                {
                    id: 'rules_read',
                    label: 'Have you read our rules?',
                    placeholder: 'Please confirm that you have read our rules.',
                    type: 'dropdown',
                    options: [
                        {
                            label: 'Yes',
                            value: 'yes'
                        },
                    ],
                    required: true
                }
            ]
        },
        
        


        // ==========================================
        // OTHER
        // ==========================================

        other: {
            name: 'Other',
            icon: 'ellipsis',
            description: 'Get support for other requests.',
            category: 1,
            roleId: '1556203938427183105',
            buttonColor: 'Secondary',
            
            questions: [
                {
                    id: 'issue',
                    label: 'What do you need help with?',
                    placeholder: 'Describe your issue...',
                    style: 'Paragraph',
                    required: true
                },
                {
                    id: 'rules_read',
                    label: 'Have you read our rules?',
                    placeholder: 'Please confirm that you have read our rules.',
                    type: 'dropdown',
                    options: [
                        {
                            label: 'Yes',
                            value: 'yes'
                        },
                    ],
                    required: true
                }
            ]
        }

    }

};