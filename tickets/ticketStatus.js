const { ButtonStyle } = require('discord.js');

const ticketMessageCache = new Map();

function componentHasCustomId(component, customId) {
    if (!component) return false;

    const raw = typeof component.toJSON === 'function'
        ? component.toJSON()
        : component;

    if (raw?.custom_id === customId) {
        return true;
    }

    return Array.isArray(raw?.components) &&
        raw.components.some(child => componentHasCustomId(child, customId));
}

function mutateTicketControls(component, claimed, handedOff = false) {
    if (!component) return component;

    const raw = typeof component.toJSON === 'function'
        ? component.toJSON()
        : JSON.parse(JSON.stringify(component));

    if (raw.custom_id === 'ticket_claim') {
        raw.style = claimed
            ? ButtonStyle.Secondary
            : ButtonStyle.Success;
    }

    if (raw.custom_id === 'ticket_handoff') {
        raw.style = handedOff
            ? ButtonStyle.Secondary
            : ButtonStyle.Primary;
    }

    if (raw.custom_id === 'ticket_add_user') {
        raw.style = ButtonStyle.Secondary;
        raw.disabled = !claimed;
    }

    if (Array.isArray(raw.components)) {
        raw.components = raw.components.map(child =>
            mutateTicketControls(child, claimed, handedOff)
        );
    }

    return raw;
}

function getTicketMessageIdFromTopic(channel) {
    const match = String(channel?.topic || '')
        .match(/(?:^|\|)ticket-message:(\d+)/);

    return match ? match[1] : null;
}

function rememberTicketMessage(channelId, messageId) {
    if (channelId && messageId) {
        ticketMessageCache.set(channelId, messageId);
    }
}

async function findTicketMessage(channel) {
    if (!channel?.messages) return null;

    const cachedId =
        ticketMessageCache.get(channel.id) ||
        getTicketMessageIdFromTopic(channel);

    if (cachedId) {
        try {
            const cachedMessage = await channel.messages.fetch(cachedId);
            if (cachedMessage) {
                rememberTicketMessage(channel.id, cachedMessage.id);
                return cachedMessage;
            }
        } catch {}
    }

    try {
        const messages = await channel.messages.fetch({ limit: 50 });

        const ticketMessage = messages.find(message =>
            Array.isArray(message.components) &&
            message.components.some(component =>
                componentHasCustomId(component, 'ticket_claim')
            )
        );

        if (ticketMessage) {
            rememberTicketMessage(channel.id, ticketMessage.id);
            return ticketMessage;
        }
    } catch (error) {
        console.error('[TICKET STATUS FIND ERROR]', error);
    }

    return null;
}

async function ensurePinned(message) {
    if (!message || message.pinned) return;

    try {
        await message.pin('Pin MSRP ticket control container');
    } catch (error) {
        console.error('[TICKET STATUS PIN ERROR]', error);
    }
}

async function setTicketControlState(channel, claimed, handedOff = false) {
    // One-time migration from the old channel-name status system.
    // Claim/Unclaim will never add this prefix again.
    if (/^claimed-/i.test(String(channel?.name || ''))) {
        const cleanName = String(channel.name)
            .replace(/^(?:claimed-)+/i, '')
            .slice(0, 100);

        void channel.setName(
            cleanName,
            'Remove legacy claimed- ticket prefix'
        ).catch(error => {
            console.error(
                '[TICKET STATUS LEGACY NAME CLEANUP ERROR]',
                error
            );
        });
    }

    const message = await findTicketMessage(channel);

    if (!message) {
        console.error(
            `[TICKET STATUS] Could not find ticket control message in ${channel?.id}`
        );
        return false;
    }

    const components = message.components.map(component =>
        mutateTicketControls(component, claimed, handedOff)
    );

    await message.edit({ components });
    await ensurePinned(message);

    return true;
}

async function setClaimButtonState(channel, claimed) {
    const handedOff = /(?:^|\|)handed-off:1(?:\||$)/.test(
        String(channel?.topic || '')
    );

    return setTicketControlState(
        channel,
        claimed,
        handedOff
    );
}

async function setHandoffButtonState(channel, handedOff) {
    const claimed = /(?:^|\|)claimed-by:\d+/.test(
        String(channel?.topic || '')
    );

    return setTicketControlState(
        channel,
        claimed,
        handedOff
    );
}

module.exports = {
    rememberTicketMessage,
    findTicketMessage,
    setClaimButtonState,
    setHandoffButtonState,
    setTicketControlState
};
