import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalBuilder,
} from 'discord.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, 'data.json');
const COLORS = { primary: 0x5865F2, success: 0x57F287, danger: 0xED4245, warning: 0xFEE75C };

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { tickets: {}, applications: {} };
  }
}

const state = loadState();
state.tickets ??= {};
state.applications ??= {};

function saveState() {
  const tempPath = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempPath, STATE_PATH);
}

const commands = [
  new SlashCommandBuilder()
    .setName('setup-ticket-panel')
    .setDescription('Post a panel where members can create private support tickets.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option => option
      .setName('panel_channel')
      .setDescription('The channel where the ticket panel will be posted.')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
    .addChannelOption(option => option
      .setName('ticket_category')
      .setDescription('Optional category for newly created ticket channels.')
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(false))
    .addRoleOption(option => option
      .setName('support_role')
      .setDescription('Optional staff role that can see and manage tickets.')
      .setRequired(false)),

  new SlashCommandBuilder()
    .setName('setup-application-panel')
    .setDescription('Post a panel where members can apply to join the staff team.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption(option => option
      .setName('panel_channel')
      .setDescription('The public channel where the application panel will be posted.')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
    .addChannelOption(option => option
      .setName('application_log_channel')
      .setDescription('The private staff channel that receives applications.')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true))
    .addRoleOption(option => option
      .setName('staff_role')
      .setDescription('Optional role allowed to review applications.')
      .setRequired(false)),
].map(command => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function ephemeralReply(interaction, content) {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

function safeChannelName(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'member';
}

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
}

async function canReviewApplication(interaction, application) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!application.staffRoleId) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member?.roles.cache.has(application.staffRoleId)) return true;
  return false;
}

async function openApplicationModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('staff_application_form')
    .setTitle('Staff Application');
  const fields = [
    new TextInputBuilder().setCustomId('app_name').setLabel('Name or preferred name').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true),
    new TextInputBuilder().setCustomId('app_age').setLabel('Age').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(true),
    new TextInputBuilder().setCustomId('app_timezone').setLabel('Timezone and availability').setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true),
    new TextInputBuilder().setCustomId('app_reason').setLabel('Why do you want to join the staff team?').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true),
    new TextInputBuilder().setCustomId('app_experience').setLabel('Relevant experience (optional)').setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false),
  ];
  modal.addComponents(...fields.map(field => new ActionRowBuilder().addComponents(field)));
  await interaction.showModal(modal);
}

async function createTicket(interaction) {
  const guildId = interaction.guildId;
  const ticketKey = `${guildId}:${interaction.user.id}`;
  const existing = state.tickets[ticketKey];
  if (existing?.status === 'open' && existing.channelId) {
    const existingChannel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
    if (existingChannel) {
      await ephemeralReply(interaction, `You already have an open ticket: ${existingChannel}`);
      return;
    }
    delete state.tickets[ticketKey];
    saveState();
  }

  const setup = state.ticketPanels?.[guildId];
  if (!setup) {
    await ephemeralReply(interaction, 'The ticket system is not configured yet. Please contact a server administrator.');
    return;
  }

  const overwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.EmbedLinks] },
  ];
  if (setup.supportRoleId && interaction.guild.roles.cache.has(setup.supportRoleId)) {
    overwrites.push({
      id: setup.supportRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await interaction.guild.channels.create({
    name: `ticket-${safeChannelName(interaction.user.username)}`,
    type: ChannelType.GuildText,
    parent: setup.categoryId && interaction.guild.channels.cache.has(setup.categoryId) ? setup.categoryId : undefined,
    topic: `Ticket owner: ${interaction.user.id}`,
    permissionOverwrites: overwrites,
    reason: `Support ticket opened by ${interaction.user.tag}`,
  });

  state.tickets[ticketKey] = { channelId: channel.id, ownerId: interaction.user.id, status: 'open' };
  saveState();

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close Ticket').setStyle(ButtonStyle.Danger),
  );
  const supportMention = setup.supportRoleId ? `<@&${setup.supportRoleId}>` : '';
  await channel.send({
    content: `${interaction.user}${supportMention ? ` ${supportMention}` : ''}`,
    embeds: [new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('Support Ticket')
      .setDescription('Please describe your issue. A staff member will respond as soon as possible.')
      .addFields({ name: 'Opened by', value: `${interaction.user}`, inline: true })
      .setTimestamp()],
    components: [closeRow],
    allowedMentions: { users: [interaction.user.id], roles: setup.supportRoleId ? [setup.supportRoleId] : [] },
  });
  await interaction.editReply({ content: `Your ticket is ready: ${channel}` });
}

async function closeTicket(interaction) {
  const topic = interaction.channel?.topic ?? '';
  const ownerId = topic.match(/Ticket owner: (\d{17,20})/)?.[1];
  const isOwner = ownerId === interaction.user.id;
  const isManager = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  const setup = state.ticketPanels?.[interaction.guildId];
  const member = setup?.supportRoleId
    ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
    : null;
  const isSupport = setup?.supportRoleId && member?.roles.cache.has(setup.supportRoleId);
  if (!isOwner && !isManager && !isSupport) {
    await ephemeralReply(interaction, 'Only the ticket owner or support staff can close this ticket.');
    return;
  }

  await interaction.deferUpdate();
  if (ownerId) {
    await interaction.channel.permissionOverwrites.edit(ownerId, {
      ViewChannel: true,
      SendMessages: false,
      ReadMessageHistory: true,
    }).catch(() => {});
    const ticketKey = `${interaction.guildId}:${ownerId}`;
    if (state.tickets[ticketKey]) state.tickets[ticketKey].status = 'closed';
    saveState();
  }
  await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100)).catch(() => {});
  await interaction.message.edit({
    embeds: [new EmbedBuilder().setColor(COLORS.warning).setTitle('Ticket Closed').setDescription(`Closed by ${interaction.user}. Staff can delete this channel when it is no longer needed.`)],
    components: [],
  });
}

async function submitApplication(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const prior = state.applications[key];
  if (prior?.status === 'pending') {
    await ephemeralReply(interaction, 'You already have a staff application awaiting review.');
    return;
  }

  const setup = state.applicationPanels?.[interaction.guildId];
  const logChannel = setup && await interaction.guild.channels.fetch(setup.logChannelId).catch(() => null);
  if (!logChannel?.isTextBased()) {
    await ephemeralReply(interaction, 'The application review channel is unavailable. Please contact a server administrator.');
    return;
  }

  const appId = `${Date.now().toString(36)}-${interaction.user.id.slice(-5)}`;
  const application = {
    id: appId,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    username: interaction.user.tag,
    staffRoleId: setup.staffRoleId ?? null,
    status: 'pending',
  };
  const fields = [
    { name: 'Name / preferred name', value: interaction.fields.getTextInputValue('app_name') },
    { name: 'Age', value: interaction.fields.getTextInputValue('app_age') },
    { name: 'Timezone / availability', value: interaction.fields.getTextInputValue('app_timezone') },
    { name: 'Why do you want to join the staff team?', value: interaction.fields.getTextInputValue('app_reason') },
    { name: 'Relevant experience', value: interaction.fields.getTextInputValue('app_experience') || 'Not provided' },
  ];
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('New Staff Application')
    .setDescription(`Applicant: ${interaction.user} (${interaction.user.tag})\nApplication ID: \`${appId}\``)
    .addFields(...fields.map(field => ({ ...field, value: field.value.slice(0, 1024) })))
    .setFooter({ text: `Applicant ID: ${interaction.user.id}` })
    .setTimestamp();
  const reviewRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`application_review:approve:${appId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`application_review:decline:${appId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
  );
  const reviewMessage = await logChannel.send({ embeds: [embed], components: [reviewRow] });
  Object.assign(application, { logChannelId: logChannel.id, logMessageId: reviewMessage.id });
  state.applications[key] = application;
  saveState();
  await ephemeralReply(interaction, 'Your application has been submitted to the staff team. Thank you!');
}

async function reviewApplication(interaction, decision, appId) {
  const applicationEntry = Object.entries(state.applications).find(([, item]) => item.id === appId && item.guildId === interaction.guildId);
  if (!applicationEntry) {
    await ephemeralReply(interaction, 'This application could not be found.');
    return;
  }
  const [key, application] = applicationEntry;
  if (!(await canReviewApplication(interaction, application))) {
    await ephemeralReply(interaction, 'You do not have permission to review applications.');
    return;
  }
  if (application.status !== 'pending') {
    await ephemeralReply(interaction, 'This application has already been reviewed.');
    return;
  }

  application.status = decision === 'approve' ? 'approved' : 'declined';
  application.reviewedBy = interaction.user.id;
  application.reviewedAt = new Date().toISOString();
  saveState();

  const originalEmbed = interaction.message.embeds[0];
  const updatedEmbed = EmbedBuilder.from(originalEmbed)
    .setColor(decision === 'approve' ? COLORS.success : COLORS.danger)
    .addFields({ name: 'Decision', value: `${application.status === 'approved' ? 'Approved' : 'Declined'} by ${interaction.user.tag}` });
  await interaction.update({
    embeds: [updatedEmbed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`application_review:approve:${appId}`).setLabel('Approve').setStyle(ButtonStyle.Success).setDisabled(true),
      new ButtonBuilder().setCustomId(`application_review:decline:${appId}`).setLabel('Decline').setStyle(ButtonStyle.Danger).setDisabled(true),
    )],
  });

  const applicant = await client.users.fetch(application.userId).catch(() => null);
  await applicant?.send(`Your staff application in **${interaction.guild.name}** was ${application.status}.`).catch(() => {});
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const applicationId = process.env.CLIENT_ID || client.user.id;
  const guildId = process.env.GUILD_ID?.trim();
  try {
    const route = guildId
      ? Routes.applicationGuildCommands(applicationId, guildId)
      : Routes.applicationCommands(applicationId);
    await rest.put(route, { body: commands });
    console.log(`Registered ${commands.length} slash commands${guildId ? ` in guild ${guildId}` : ' globally'}.`);
  } catch (error) {
    console.error('Failed to register slash commands:', error);
  }
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup-ticket-panel') {
        if (!hasManageGuild(interaction)) return ephemeralReply(interaction, 'You need Manage Server permission to set up the ticket panel.');
        const panelChannel = interaction.options.getChannel('panel_channel');
        const category = interaction.options.getChannel('ticket_category');
        const supportRole = interaction.options.getRole('support_role');
        state.ticketPanels ??= {};
        state.ticketPanels[interaction.guildId] = {
          categoryId: category?.id ?? null,
          supportRoleId: supportRole?.id ?? null,
        };
        saveState();
        await panelChannel.send({
          embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('Community Support').setDescription('Need help? Click the button below to open a private support ticket.')],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_create').setLabel('Create Ticket').setStyle(ButtonStyle.Primary),
          )],
        });
        await ephemeralReply(interaction, `Ticket panel posted in ${panelChannel}.`);
        return;
      }

      if (interaction.commandName === 'setup-application-panel') {
        if (!hasManageGuild(interaction)) return ephemeralReply(interaction, 'You need Manage Server permission to set up the application panel.');
        const panelChannel = interaction.options.getChannel('panel_channel');
        const logChannel = interaction.options.getChannel('application_log_channel');
        const staffRole = interaction.options.getRole('staff_role');
        state.applicationPanels ??= {};
        state.applicationPanels[interaction.guildId] = { panelChannelId: panelChannel.id, logChannelId: logChannel.id, staffRoleId: staffRole?.id ?? null };
        saveState();
        await panelChannel.send({
          embeds: [new EmbedBuilder().setColor(COLORS.primary).setTitle('Join Our Staff Team').setDescription('Interested in helping our community? Click below to submit a staff application.')],
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('application_open').setLabel('Apply for Staff').setStyle(ButtonStyle.Primary),
          )],
        });
        await ephemeralReply(interaction, `Application panel posted in ${panelChannel}. Applications will be sent to ${logChannel}.`);
        return;
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === 'ticket_create') return await createTicket(interaction);
      if (interaction.customId === 'ticket_close') return await closeTicket(interaction);
      if (interaction.customId === 'application_open') return await openApplicationModal(interaction);
      if (interaction.customId.startsWith('application_review:')) {
        const [, decision, appId] = interaction.customId.split(':');
        if (!['approve', 'decline'].includes(decision)) return;
        return await reviewApplication(interaction, decision, appId);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'staff_application_form') return await submitApplication(interaction);
    }
  } catch (error) {
    console.error('Interaction error:', error);
    const message = 'Something went wrong while handling that action. Please contact a server administrator.';
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content: message }).catch(() => {});
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Create a .env file beside package.json and add your bot token.');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('Discord login failed. Check that DISCORD_TOKEN is the current bot token from the Discord Developer Portal.');
  console.error(error.message);
  process.exit(1);
});
