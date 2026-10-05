console.log('🚀 INDEX.JS STARTED');

console.log('📦 Loading dotenv...');

require('dotenv').config();

console.log('✅ Dotenv loaded');
console.log('📦 Loading discord.js...');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    MessageFlags,
    ModalBuilder,
    LabelBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder
} = require('discord.js');

console.log('✅ discord.js loaded');

const ticketSetup = require('./tickets/ticketSetup');
const { createTicket } = require('./tickets/ticketCreate');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

client.once('clientReady', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🤖 MSRP Bot is online!`);

    const rest = new REST({ version: '10' })
        .setToken(process.env.DISCORD_TOKEN);

    try {
        await rest.put(
            Routes.applicationGuildCommands(
                client.user.id,
                process.env.DISCORD_GUILD_ID
            ),
            {
                body: [
                    ticketSetup.command.toJSON()
                ]
            }
        );

        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error('❌ Failed to register slash commands:', error);
    }
});

client.on('interactionCreate', async (interaction) => {

    // Slash commands
    if (interaction.isChatInputCommand()) {

       if (interaction.commandName === 'send-ticket-dashboard') {
    await ticketSetup.execute(interaction);
    return;
}

}

// ==========================================
// TICKET DROPDOWN
// ==========================================

// TICKET TYPE SELECTION
if (interaction.isStringSelectMenu()) {

    if (interaction.customId === 'ticket_type_select') {

        const ticketType = interaction.values[0];

        const config = require('./tickets/ticketConfig');
        const typeConfig = config.ticketTypes[ticketType];

        if (!typeConfig) {
            await interaction.reply({
                content: '❌ This ticket type does not exist.',
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        const questions = typeConfig.questions || [];

        const modal = new ModalBuilder()
            .setCustomId(`ticket_form:${ticketType}`)
            .setTitle(typeConfig.name);

        for (const question of questions.slice(0, 5)) {

            // ==========================================
            // DROPDOWN QUESTION
            // ==========================================

            if (question.type === 'dropdown') {
const options = question.options.map(option => {

    const builder = new StringSelectMenuOptionBuilder()
        .setLabel(option.label)
        .setValue(option.value);

    if (option.description) {
        builder.setDescription(option.description);
    }

    return builder;
});

const select = new StringSelectMenuBuilder()
    .setCustomId(question.id)
    .setPlaceholder(
        question.placeholder || 'Select an option...'
    )
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(question.required ?? true)
    .addOptions(options);

                const label = new LabelBuilder()
                    .setLabel(question.label)
                    .setStringSelectMenuComponent(select);

                modal.addLabelComponents(label);

                continue;
            }


            // ==========================================
            // TEXT QUESTION
            // ==========================================

            const input = new TextInputBuilder()
                .setCustomId(question.id)
                .setStyle(
                    question.style === 'Short'
                        ? TextInputStyle.Short
                        : TextInputStyle.Paragraph
                )
                .setRequired(question.required ?? true);

            if (question.placeholder) {
                input.setPlaceholder(question.placeholder);
            }

            if (question.minLength !== undefined) {
                input.setMinLength(question.minLength);
            }

            if (question.maxLength !== undefined) {
                input.setMaxLength(question.maxLength);
            }

            const label = new LabelBuilder()
                .setLabel(question.label)
                .setTextInputComponent(input);

            modal.addLabelComponents(label);
        }

        await interaction.showModal(modal);

        return;
    }
}


// TICKET FORM SUBMISSION
if (interaction.isModalSubmit()) {

    if (interaction.customId.startsWith('ticket_form:')) {

        const ticketType =
            interaction.customId.split(':')[1];

        const config =
            require('./tickets/ticketConfig');

        const typeConfig =
            config.ticketTypes[ticketType];

        if (!typeConfig) {

            await interaction.reply({
                content:
                    '❌ This ticket type does not exist.',
                flags: MessageFlags.Ephemeral
            });

            return;
        }

        const answers = {};

        // ==========================================
        // COLLECT ALL QUESTIONS
        // ==========================================

        for (const question of typeConfig.questions || []) {

            try {

                if (question.type === 'dropdown') {

                    const values =
                        interaction.fields.getStringSelectValues(
                            question.id
                        );

                    answers[question.id] =
                        values[0];

                } else {

                    answers[question.id] =
                        interaction.fields.getTextInputValue(
                            question.id
                        );
                }

            } catch (error) {

                console.error(
                    `❌ Failed to collect question "${question.id}":`,
                    error
                );

            }
        }


        // ==========================================
        // CREATE TICKET
        // ==========================================

        try {

            await createTicket(
                interaction,
                ticketType,
                answers
            );

        } catch (error) {

            console.error(
                '❌ Ticket form submission error:',
                error
            );

            if (
                !interaction.replied &&
                !interaction.deferred
            ) {

                await interaction.reply({
                    content:
                        '❌ Something went wrong while creating your ticket.',
                    flags: MessageFlags.Ephemeral
                });

            }

        }

        return;
    }
}


    // Ticket buttons
    if (interaction.isButton()) {

// ==========================================
// TICKET RULES
// ==========================================

if (interaction.customId === 'ticket_rules') {

    await interaction.reply({
        content: require('./tickets/ticketConfig').ticketRulesButton.message,
        flags: MessageFlags.Ephemeral
    });

    return;
}


// ==========================================
// INFORMATION
// ==========================================

if (interaction.customId === 'ticket_information') {

    await interaction.reply({
        content: require('./tickets/ticketConfig').informationButton.message,
        flags: MessageFlags.Ephemeral
    });

    return;
}


    // ==========================================
    // TICKET TYPES
    // ==========================================

    if (interaction.customId.startsWith('ticket_')) {

        const ticketType = interaction.customId.replace(
            'ticket_',
            ''
        );

        try {

            await createTicket(
                interaction,
                ticketType
            );

        } catch (error) {

            console.error(
                '❌ Ticket creation error:',
                error
            );

            if (!interaction.replied && !interaction.deferred) {

                await interaction.reply({
                    content:
                        '❌ Something went wrong while creating your ticket.',
                    ephemeral: true
                });

            }

        }

    }

}

});

console.log('🔄 Attempting to log in...');
console.log('🔑 Token loaded:', !!process.env.DISCORD_TOKEN);
console.log('🏠 Guild ID:', process.env.DISCORD_GUILD_ID);
client.login(process.env.DISCORD_TOKEN);