# Contributing

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/worldcup-draw-bot.git
cd worldcup-draw-bot
npm install
npm run setup
npm start
```

Open http://localhost:3000.

## Project Structure

| File | Purpose |
|------|---------|
| `server.js` | HTTP server + REST API for the dashboard |
| `admin/index.html` | Single-file dashboard UI (vanilla JS, no build step) |
| `bot.js` | CLI entry point — sends messages to all draws |
| `scheduler.js` | Cron-based auto-send + auto-sync daemon |
| `api_sync.js` | Fetches fixtures/results from API-Football |
| `points.js` | Points calculation engine (per draw) |
| `whatsapp.js` | CallMeBot sender + message builder |
| `setup.js` | First-run helper that creates live data files |

## Data Files

The `data/` directory has two types of files:

- **Tracked** (`*.example.json`, `teams.json`, `points_config.json`) — safe to commit
- **Gitignored** (`config.json`, `draws.json`, `matches.json`) — contain secrets/personal data, never commit these

## Guidelines

- Keep the project dependency-free apart from `node-cron` (no Express, no build tools)
- The dashboard is intentionally a single `admin/index.html` with no bundler — keep it that way
- Test with `npm run dry-run` before submitting changes to bot/messaging logic
- If you change the data file schema, update the `.example.json` templates too

## Reporting Issues

Please include:
- Node.js version (`node --version`)
- What you did, what you expected, what happened
- Any error output from the terminal
