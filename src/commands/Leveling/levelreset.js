import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { checkUserPermissions } from '../../utils/permissionGuard.js';
import { getUserLevelPrefix } from '../../utils/database/keys.js';
import { logger } from '../../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('levelreset')
    .setDescription('Reset the server level leaderboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),
  category: 'Leveling',

  async execute(interaction, config, client) {
    await InteractionHelper.safeDefer(interaction);

    const allowed = await checkUserPermissions(
      interaction,
      PermissionFlagsBits.ManageGuild,
      'You need Manage Server permission to use this command.'
    );
    if (!allowed) return;

    const prefix = getUserLevelPrefix(interaction.guildId);
    const keys = await client.db.list(prefix);
    let deleted = 0;
    let failed = 0;

    for (const key of Array.isArray(keys) ? keys : []) {
      const success = await client.db.delete(key);
