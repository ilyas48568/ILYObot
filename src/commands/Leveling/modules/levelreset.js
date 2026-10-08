import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { getLevelingConfig } from '../../services/leveling/leveling.js';
import { getUserLevelPrefix } from '../../utils/database/keys.js';
import { createEmbed } from '../../utils/embeds.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';

export default {
  data: new SlashCommandBuilder()
    .setName('levelreset')
    .setDescription('Reset the server level leaderboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const hasPermission = await checkUserPermissions(
      interaction,
      PermissionFlagsBits.ManageGuild,
      'You need ManageGuild permission to use this command.'
    );
    if (!hasPermission) return;

    const levelingConfig = await getLevelingConfig(client, interaction.guildId);
    if (!levelingConfig?.enabled) {
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          new EmbedBuilder()
            .setColor('#f1c40f')
            .setDescription('The leveling system is currently disabled on this server.')
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const prefix = getUserLevelPrefix(interaction.guildId);
    const keys = await client.db.list(prefix);
    const levelKeys = Array.isArray(keys) ? keys : [];

    if (levelKeys.length === 0) {
      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          createEmbed({
            title: 'No Level Data',
            description: 'There is no level leaderboard data to reset.',
            color: 'warning'
          })
        ],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    let deleted = 0;
    let failed = 0;

    for (const key of levelKeys) {
      const success = await client.db.delete(key);
      if (success) {
        deleted += 1;
      } else {
        failed += 1;
      }
    }

    if (failed > 0) {
      logger.error(
        `[ADMIN] ${interaction.user.tag} partially reset the level leaderboard in guild ${interaction.guildId}: deleted ${deleted}, failed ${failed}`
      );

      await InteractionHelper.safeEditReply(interaction, {
        embeds: [
          createEmbed({
            title: 'Leaderboard Reset Incomplete',
            description: `Deleted level data for ${deleted} member(s), but failed to delete data for ${failed} member(s). Check the bot logs.`,
            color: 'error'
          })
        ]
      });
      return;
    }

    await InteractionHelper.safeEditReply(interaction, {
      embeds: [
        createEmbed({
          title: 'Leaderboard Reset',
          description: `Successfully reset the level leaderboard. Deleted level data for ${deleted} member(s).`,
          color: 'success'
        })
      ]
    });

    logger.info(
      `[ADMIN] User ${interaction.user.tag} reset the level leaderboard in guild ${interaction.guildId}; deleted ${deleted} records`
    );
  }
};
