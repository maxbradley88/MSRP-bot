const fs = require('fs');
const path = require('path');

const {
    SlashCommandBuilder,
    MessageFlags,
    ButtonBuilder,
ButtonStyle,
ActionRowBuilder
} = require('discord.js');


const DATA_FILE =
    path.join(
        __dirname,
        'reactionRoles.json'
    );


function loadData() {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(
                DATA_FILE,
                '{}',
                'utf8'
            );

            return {};
        }

        return JSON.parse(
            fs.readFileSync(
                DATA_FILE,
                'utf8'
            )
        );

    } catch (error) {
        console.error(
            '[REACTION ROLE DATA LOAD ERROR]',
            error
        );

        return {};
    }
}


function saveData(data) {
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
            '[REACTION ROLE DATA SAVE ERROR]',
            error
        );
    }
}


function getEmojiKey(reaction) {
    return (
        reaction.emoji.id ||
        reaction.emoji.name
    );
}


function parseCustomEmoji(value) {
    const match =
        String(value).match(
            /^<a?:([a-zA-Z0-9_]+):(\d+)>$/
        );

    if (!match) {
        return null;
    }

    return {
        name: match[1],
        id: match[2]
    };
}


async function findMessage(
    guild,
    messageId
) {
    for (
        const channel of
        guild.channels.cache.values()
    ) {
        if (
            !channel.isTextBased() ||
            !channel.messages
        ) {
            continue;
        }

        try {
            const message =
                await channel.messages.fetch(
                    messageId
                );

            if (message) {
                return message;
            }

        } catch {}
    }

    return null;
}


async function sendDismissMessage(
    channel,
    userId,
    content
) {
    try {
        const dismissButton =
            new ButtonBuilder()
                .setCustomId(
                    `reaction_role_dismiss:${userId}`
                )
                .setLabel('Dismiss')
                .setStyle(
                    ButtonStyle.Secondary
                );

        const row =
            new ActionRowBuilder()
                .addComponents(
                    dismissButton
                );

        await channel.send({
            content,
            components: [
                row
            ],
            allowedMentions: {
                parse: []
            }
        });

    } catch (error) {
        console.error(
            '[REACTION ROLE DISMISS MESSAGE ERROR]',
            error
        );
    }
}


const command =
    new SlashCommandBuilder()

        .setName(
            'reaction-role-message'
        )

        .setDescription(
            'Adds a reaction role to a message.'
        )

        .addRoleOption(
            option =>
                option
                    .setName('role')
                    .setDescription(
                        'Role users will receive.'
                    )
                    .setRequired(true)
        )

        .addStringOption(
            option =>
                option
                    .setName('message-id')
                    .setDescription(
                        'ID of the Discord message.'
                    )
                    .setRequired(true)
        )

        .addStringOption(
            option =>
                option
                    .setName('reaction')
                    .setDescription(
                        'Custom server emoji.'
                    )
                    .setRequired(true)
        );


async function execute(interaction) {
    await interaction.deferReply({
        flags:
            MessageFlags.Ephemeral
    });


    const role =
        interaction.options.getRole(
            'role'
        );

    const messageId =
        interaction.options.getString(
            'message-id'
        );

    const reactionInput =
        interaction.options.getString(
            'reaction'
        );


    const parsedEmoji =
        parseCustomEmoji(
            reactionInput
        );


    if (!parsedEmoji) {
        await interaction.editReply({
            content:
                '❌ Please use a custom Discord server emoji.'
        });

        return;
    }


    let guildEmoji;

    try {
        guildEmoji =
            await interaction.guild.emojis.fetch(
                parsedEmoji.id
            );

    } catch {
        guildEmoji = null;
    }


    if (!guildEmoji) {
        await interaction.editReply({
            content:
                '❌ That emoji could not be found in this server.'
        });

        return;
    }


    const botMember =
        interaction.guild.members.me;


    if (
        role.position >=
        botMember.roles.highest.position
    ) {
        await interaction.editReply({
            content:
                '❌ I cannot manage that role. Move the bot role above it.'
        });

        return;
    }


    const message =
        await findMessage(
            interaction.guild,
            messageId
        );


    if (!message) {
        await interaction.editReply({
            content:
                '❌ I could not find that message.'
        });

        return;
    }


    try {
        await message.react(
            guildEmoji
        );

    } catch (error) {
        console.error(
            '[REACTION ROLE REACT ERROR]',
            error
        );

        await interaction.editReply({
            content:
                '❌ I could not add the reaction.'
        });

        return;
    }


    const data =
        loadData();


    if (!data[message.id]) {
        data[message.id] = {};
    }


    data[message.id][guildEmoji.id] = {
        roleId:
            role.id,

        channelId:
            message.channel.id,

        guildId:
            interaction.guild.id
    };


    saveData(
        data
    );


    console.log(
        `[REACTION ROLE CREATED] message=${message.id} emoji=${guildEmoji.id} role=${role.id}`
    );


    await interaction.editReply({
        content:
            `✅ Reaction role created.\n${guildEmoji} → ${role}`
    });
}


/*
 * ======================================================
 * REACTION ADDED
 * ======================================================
 */

async function handleReactionAdd(
    reaction,
    user
) {
    try {

        if (user.bot) {
            return;
        }


        if (user.partial) {
            try {
                await user.fetch();
            } catch {}
        }


        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error(
                    '[REACTION FETCH ERROR]',
                    error
                );

                return;
            }
        }


        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error(
                    '[REACTION MESSAGE FETCH ERROR]',
                    error
                );

                return;
            }
        }


        console.log(
            `[REACTION ADD] ${user.username} reacted with ${reaction.emoji.name}`
        );


        const data =
            loadData();


        const messageData =
            data[
                reaction.message.id
            ];


        if (!messageData) {
            console.log(
                '[REACTION ROLE] No configuration for this message.'
            );

            return;
        }


        const emojiKey =
            getEmojiKey(
                reaction
            );


        const roleConfig =
            messageData[
                emojiKey
            ];


        if (!roleConfig) {
            console.log(
                `[REACTION ROLE] No configuration for emoji ${emojiKey}.`
            );

            return;
        }


        const guild =
            reaction.message.guild;


        if (!guild) {
            return;
        }


        const member =
            await guild.members.fetch(
                user.id
            );


        const role =
            await guild.roles.fetch(
                roleConfig.roleId
            );


        if (!role) {
            console.error(
                '[REACTION ROLE] Configured role no longer exists.'
            );

            return;
        }


        /*
         * User already has the role.
         */
        if (
            member.roles.cache.has(
                role.id
            )
        ) {
await sendDismissMessage(
    reaction.message.channel,
    user.id,
    'You already have this role. Remove your reaction to remove the role.'
);

            return;
        }


        await member.roles.add(
            role,
            'MSRP reaction role'
        );


        console.log(
            `[REACTION ROLE ADDED] ${user.username} → ${role.name}`
        );

await sendDismissMessage(
    reaction.message.channel,
    user.id,
    'Your role has been added.'
);


    } catch (error) {
        console.error(
            '[REACTION ROLE ADD ERROR]',
            error
        );
    }
}


/*
 * ======================================================
 * REACTION REMOVED
 * ======================================================
 */

async function handleReactionRemove(
    reaction,
    user
) {
    try {

        if (user.bot) {
            return;
        }


        if (user.partial) {
            try {
                await user.fetch();
            } catch {}
        }


        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error(
                    '[REACTION REMOVE FETCH ERROR]',
                    error
                );

                return;
            }
        }


        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error(
                    '[REACTION REMOVE MESSAGE FETCH ERROR]',
                    error
                );

                return;
            }
        }


        console.log(
            `[REACTION REMOVE] ${user.username} removed ${reaction.emoji.name}`
        );


        const data =
            loadData();


        const messageData =
            data[
                reaction.message.id
            ];


        if (!messageData) {
            return;
        }


        const emojiKey =
            getEmojiKey(
                reaction
            );


        const roleConfig =
            messageData[
                emojiKey
            ];


        if (!roleConfig) {
            return;
        }


        const guild =
            reaction.message.guild;


        if (!guild) {
            return;
        }


        const member =
            await guild.members.fetch(
                user.id
            );


        const role =
            await guild.roles.fetch(
                roleConfig.roleId
            );


        if (!role) {
            return;
        }


        /*
         * Only try removing if they
         * actually have the role.
         */
        if (
            member.roles.cache.has(
                role.id
            )
        ) {
            await member.roles.remove(
                role,
                'MSRP reaction role removed'
            );


            console.log(
                `[REACTION ROLE REMOVED] ${user.username} → ${role.name}`
            );


await sendDismissMessage(
    reaction.message.channel,
    user.id,
    'Your role has been removed.'
);
        }


    } catch (error) {
        console.error(
            '[REACTION ROLE REMOVE ERROR]',
            error
        );
    }
}


module.exports = {
    command,
    execute,
    handleReactionAdd,
    handleReactionRemove
};