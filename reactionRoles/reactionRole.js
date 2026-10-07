const fs = require('fs');
const path = require('path');

const {
    SlashCommandBuilder,
    MessageFlags
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
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(
            data,
            null,
            2
        ),
        'utf8'
    );
}


function getEmojiKey(reaction) {
    if (reaction.emoji.id) {
        return reaction.emoji.id;
    }

    return reaction.emoji.name;
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


async function sendTemporaryMessage(
    channel,
    content
) {
    try {
        const message =
            await channel.send({
                content
            });

        setTimeout(() => {
            message.delete()
                .catch(() => {});
        }, 4000);

    } catch {}
}


const command =
    new SlashCommandBuilder()
        .setName(
            'reaction-role-message'
        )
        .setDescription(
            'Adds a reaction role to a message.'
        )

        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription(
                    'Role users will receive.'
                )
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName('message-id')
                .setDescription(
                    'ID of the Discord message.'
                )
                .setRequired(true)
        )

        .addStringOption(option =>
            option
                .setName('reaction')
                .setDescription(
                    'Custom server emoji, e.g. <:name:123456789>'
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
                '❌ Please use a custom Discord server emoji, for example `<:emoji:123456789012345678>`.'
        });

        return;
    }


    const guildEmoji =
        interaction.guild.emojis.cache.get(
            parsedEmoji.id
        );


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
                '❌ I cannot manage that role. Move my bot role above it.'
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
                '❌ I could not find that message in this server.'
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
                '❌ I could not add that reaction to the message.'
        });

        return;
    }


    const data =
        loadData();


    data[message.id] =
        data[message.id] || {};


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


    await interaction.editReply({
        content:
            `✅ Reaction role created.\n\n` +
            `${guildEmoji} → ${role}`
    });
}


async function handleReactionAdd(
    reaction,
    user
) {
    if (user.bot) {
        return;
    }


    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch {
            return;
        }
    }


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


    const config =
        messageData[
            emojiKey
        ];

    if (!config) {
        return;
    }


    const guild =
        reaction.message.guild;

    if (!guild) {
        return;
    }


    try {
        const member =
            await guild.members.fetch(
                user.id
            );

        const role =
            guild.roles.cache.get(
                config.roleId
            );

        if (!role) {
            return;
        }


        await member.roles.add(
            role,
            'Reaction role added'
        );


        await sendTemporaryMessage(
            reaction.message.channel,
            `<@${user.id}> Role added.`
        );

    } catch (error) {
        console.error(
            '[REACTION ROLE ADD ERROR]',
            error
        );
    }
}


async function handleReactionRemove(
    reaction,
    user
) {
    if (user.bot) {
        return;
    }


    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch {
            return;
        }
    }


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


    const config =
        messageData[
            emojiKey
        ];

    if (!config) {
        return;
    }


    const guild =
        reaction.message.guild;

    if (!guild) {
        return;
    }


    try {
        const member =
            await guild.members.fetch(
                user.id
            );

        const role =
            guild.roles.cache.get(
                config.roleId
            );

        if (!role) {
            return;
        }


        await member.roles.remove(
            role,
            'Reaction role removed'
        );


        await sendTemporaryMessage(
            reaction.message.channel,
            `<@${user.id}> Role removed.`
        );

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