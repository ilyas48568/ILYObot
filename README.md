# Community Ticket and Staff Application Bot

A separate Discord bot project with two systems:

- Private support tickets with a create button and a close button.
- Staff applications submitted through a modal, delivered to a review channel, and reviewed with Approve / Decline buttons.

## Setup

1. Install Node.js 20.10 or newer.
2. Copy `.env.example` to `.env` in this folder.
3. Put your bot token in `DISCORD_TOKEN` and the application ID in `CLIENT_ID`.
4. Optionally set `GUILD_ID` to your test server ID. This makes slash commands appear in that server quickly. Leave it blank for global command registration.
5. From this folder, run:

   ```sh
   npm install
   npm start
   ```

Invite the bot with the `bot` and `applications.commands` scopes. It needs View Channels, Send Messages, Embed Links, Read Message History, and Manage Channels permissions. The bot registers its slash commands when it starts.

## Commands

- `/setup-ticket-panel panel_channel` posts the ticket panel. Optional fields let you choose a ticket category and support role.
- `/setup-application-panel panel_channel application_log_channel` posts the application panel. An optional staff role can restrict who can review submissions.

Application submissions are stored in `data.json`, which the bot creates automatically. Do not share `.env` or your bot token.
