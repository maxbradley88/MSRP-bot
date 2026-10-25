'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getState, stopSession } = require('./sessionState');
const { deleteVoteAnnouncement } = require('./sessionVote');
const { refreshSessionDashboard } = require('./sessionDashboard');
const { sendShutdownAnnouncement } = require('./sessionShutdown');

const data = new SlashCommandBuilder()
    .setName('cancel-session-vote')
    .setDescription('Cancels the current vote and restores the Session Shutdown display.');

let cancellationInProgress = false;

async function execute(interaction) {
    if (getState().status !== 'vote') {
        await interaction.reply({
            content: 'There is no active session vote to cancel.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (cancellationInProgress) {
        await interaction.reply({
            content: 'The session vote is already being cancelled.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    cancellationInProgress = true;

    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // The last vote could have started a session while Discord acknowledged us.
        if (getState().status !== 'vote') {
            await interaction.editReply({
                content: 'The vote has already ended, so nothing was cancelled.'
            });
            return;
        }

        // Invalidate votes immediately, so any in-flight vote button clicks
        // cannot restart the cancelled session. This does NOT send :shutdown
        // to ER:LC or modify the existing post-shutdown join-lockdown policy.
        stopSession();

        const warnings = [];
        try {
            await deleteVoteAnnouncement(interaction.client);
        } catch (error) {
            console.error('[SESSION VOTE CANCEL] Could not remove the vote notice:', error);
            warnings.push('the previous vote announcement could not be removed');
        }

        try {
            const refreshed = await refreshSessionDashboard(interaction.client, {
                preferCached: true,
                forceInactive: true
            });
            if (!refreshed) {
                warnings.push('the session dashboard could not be found for updating');
            }
        } catch (error) {
            console.error('[SESSION VOTE CANCEL] Could not refresh the dashboard:', error);
            warnings.push('the session dashboard could not be refreshed');
        }

        // A new vote removes the persistent Session Shut Down announcement.
        // Restore that existing notice without shutting down the actual game.
        try {
            await sendShutdownAnnouncement(interaction.client);
        } catch (error) {
            console.error('[SESSION VOTE CANCEL] Could not restore the shutdown notice:', error);
            warnings.push('the Session Shutdown notice could not be posted');
        }

        await interaction.editReply({
            content: warnings.length
                ? `Session vote cancelled and votes cleared, but ${warnings.join('; ')}.`
                : '✅ Session vote cancelled. Votes cleared and Session Shutdown restored.'
        });
    } catch (error) {
        console.error('[SESSION VOTE CANCEL] Unexpected error:', error);
        const content = `Unable to cancel the session vote: ${String(error?.message || error).slice(0, 220)}`;
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content }).catch(() => {});
        } else {
            await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    } finally {
        cancellationInProgress = false;
    }
}

module.exports = { data, execute };
