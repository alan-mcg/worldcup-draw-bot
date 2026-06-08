# ⚽ World Cup Draw Bot 2026

> A self-hosted WhatsApp sweepstake bot for the 2026 FIFA World Cup.  
> Run multiple draws (work, family, friends), sync live scores automatically, and send a daily group message with standings, fixtures, results, and head-to-head rivalries.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)
![World Cup](https://img.shields.io/badge/FIFA%20World%20Cup-2026-gold)

---

## Features

- 🏆 **Multiple independent draws** — work, family, friends, all from one dashboard
- 📱 **Single WhatsApp group message** per draw — no per-user setup required
- 🔄 **Live fixture sync** via [API-Football](https://www.api-football.com/) (free tier, 100 req/day)
- ⚔️ **Rivalry alerts** — flags when two participants' teams play each other that day
- 🕗 **Kick-off times** displayed in Irish time
- 🗓️ **Auto-scheduler** — syncs scores every 2 hours, sends at 8pm daily
- 🌍 **All 48 correct 2026 teams** across Groups A–L pre-loaded
- 🆕 **2026 format support** — includes Round of 32 in points system

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/worldcup-draw-bot.git
cd worldcup-draw-bot

# 2. Install dependencies
npm install

# 3. Create your local data files from templates
npm run setup

# 4. Start the admin dashboard
npm start
```

Then open **http://localhost:3000** in your browser.

---

## Setup Guide

### 1. Live Scores — API-Football (free)

1. Sign up at [dashboard.api-football.com](https://dashboard.api-football.com/register)
2. Copy your API key from the dashboard
3. In the bot: **Settings tab** → paste key → **Save** → **Sync All Fixtures**

> The free plan gives **100 requests/day** — enough for daily syncing throughout the tournament.  
> World Cup identifiers: `league=1`, `season=2026` (pre-configured).

---

### 2. WhatsApp Groups — CallMeBot (free)

Each draw sends to its own WhatsApp group. Setup takes ~2 minutes per group:

1. Create a WhatsApp group and add all participants
2. Save **+34 644 80 21 26** in your contacts as "CallMeBot"
3. Add CallMeBot to the group
4. Send this message **in the group**:
   ```
   I allow callmebot to send me messages
   ```
5. CallMeBot replies with a **Group ID** and **API Key**
6. In the bot: open the draw → **WhatsApp Group Config** → paste both → **Save**

> 📖 Full guide: [callmebot.com/blog/free-api-whatsapp-messages](https://www.callmebot.com/blog/free-api-whatsapp-messages/)

---

### 3. Create Your Draws

1. Click **+ New Draw** in the sidebar
2. Give it a name (e.g. "Work Lads 🏢")
3. Add participants and assign up to 3 teams each
4. Enter your CallMeBot group credentials

---

## Daily Usage

### Via the Dashboard (recommended)

```bash
npm start
# Open http://localhost:3000
```

Each draw has **Preview** and **Send to Group** buttons. You can also preview messages for any past or future date.

### Via the Terminal

```bash
npm run dry-run     # Preview all draw messages without sending
npm run bot         # Send to all configured groups now
npm run sync        # Sync today's fixtures first, then preview
```

### Automated Daily Sends

```bash
npm run schedule
```

This runs a background process that:
- 🔄 Syncs fixtures from API-Football **every 2 hours**
- 📤 Sends the daily update to **all groups at 8pm**

**Keep it running in the background with [pm2](https://pm2.keymetrics.io/):**

```bash
npm install -g pm2
pm2 start scheduler.js --name worldcup-bot
pm2 save
pm2 startup   # auto-start on reboot
```

---

## Example WhatsApp Message

```
⚽ Work Lads 🏢 — Daily Update
📅 Thursday, 11 June
━━━━━━━━━━━━━━━━━━━━

🗓️ Today's Fixtures:
  🇲🇽 Mexico vs 🇿🇦 South Africa
  ⏰ 20:00 Irish time | Estadio Azteca, Mexico City
  📌 Group Stage

🔥 Draw Clashes Today!
  ⚔️  🇲🇽 Mexico (Dave)
      vs 🇿🇦 South Africa (Ciara)
      ⏰ 20:00 Irish time

━━━━━━━━━━━━━━━━━━━━
🏆 Work Lads 🏢 Standings

🥇 *Dave O'Brien* — 12 pts
    🇲🇽3pts 🇫🇷6pts 🇧🇷3pts
🥈 *Ciara Walsh* — 9 pts
    🇿🇦0pts 🇩🇪6pts 🇦🇷3pts
🥉 *Alice Murphy* — 7 pts
    🏴󠁧󠁢󠁥󠁮󠁧󠁿4pts 🇪🇸3pts 🇯🇵0pts

Good luck everyone! 🍀
```

---

## Points System

Customise in `data/points_config.json`.

| Stage          | Win | Draw | Loss |
|----------------|-----|------|------|
| Group          | 3   | 1    | 0    |
| Round of 32    | 4   | —    | 0    |
| Round of 16    | 6   | —    | 0    |
| Quarter-Final  | 10  | —    | 0    |
| Semi-Final     | 15  | —    | 0    |
| Third Place    | 18  | —    | 0    |
| Final (win)    | 25  | —    | —    |
| Final (runner-up) | — | —  | 12   |

---

## 2026 World Cup Groups

| Group | Teams |
|-------|-------|
| A | 🇲🇽 Mexico · 🇿🇦 South Africa · 🇰🇷 South Korea · 🇨🇿 Czechia |
| B | 🇨🇭 Switzerland · 🇨🇦 Canada · 🇶🇦 Qatar · 🇧🇦 Bosnia & Herz. |
| C | 🇧🇷 Brazil · 🇲🇦 Morocco · 🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland · 🇨🇲 Cameroon |
| D | 🇺🇸 USA · 🇵🇾 Paraguay · 🇦🇺 Australia · 🇹🇷 Türkiye |
| E | 🇩🇪 Germany · 🇪🇨 Ecuador · 🇨🇮 Ivory Coast · 🇨🇱 Chile |
| F | 🇳🇱 Netherlands · 🇯🇵 Japan · 🇸🇪 Sweden · 🇹🇳 Tunisia |
| G | 🇧🇪 Belgium · 🇮🇷 Iran · 🇪🇬 Egypt · 🇳🇿 New Zealand |
| H | 🇪🇸 Spain · 🇺🇾 Uruguay · 🇸🇦 Saudi Arabia · 🇺🇿 Uzbekistan |
| I | 🇫🇷 France · 🇸🇳 Senegal · 🇳🇴 Norway · 🇮🇶 Iraq |
| J | 🇦🇷 Argentina · 🇦🇹 Austria · 🇩🇿 Algeria · 🇨🇻 Cape Verde |
| K | 🇵🇹 Portugal · 🇨🇴 Colombia · 🇨🇩 DR Congo · 🇨🇼 Curaçao |
| L | 🏴󠁧󠁢󠁥󠁮󠁧󠁿 England · 🇭🇷 Croatia · 🇵🇦 Panama · 🇯🇴 Jordan |

---

## Project Structure

```
worldcup-draw-bot/
├── bot.js              # CLI: send to all draws
├── scheduler.js        # Auto-send + auto-sync daemon
├── server.js           # Admin dashboard (Express-style HTTP)
├── api_sync.js         # API-Football fixture sync
├── points.js           # Points calculation engine
├── whatsapp.js         # CallMeBot group sender + message builder
├── setup.js            # First-run setup script
├── package.json
├── .gitignore
│
└── data/
    ├── teams.json              ✅ tracked — all 48 WC teams
    ├── points_config.json      ✅ tracked — points rules
    ├── config.example.json     ✅ tracked — template (no secrets)
    ├── draws.example.json      ✅ tracked — template (no secrets)
    │
    ├── config.json             🔒 gitignored — your API key
    ├── draws.json              🔒 gitignored — participants + phone numbers
    └── matches.json            🔒 gitignored — populated by API sync

└── admin/
    └── index.html      # Dashboard UI (single-file, no build step)
```

> **Why are `config.json`, `draws.json`, and `matches.json` gitignored?**  
> They contain your API keys, WhatsApp credentials, and participants' phone numbers. The `.example.json` templates are tracked so anyone cloning the repo can get started with `npm run setup`.

---

## Requirements

- **Node.js 18+** — [nodejs.org](https://nodejs.org)
- **A WhatsApp account** (yours) to register with CallMeBot
- **API-Football account** (free) for live scores — optional, results can be entered manually

---

## Contributing

Pull requests welcome. Please open an issue first for significant changes.

