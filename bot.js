// bot.js — sends daily update to all configured draws
// node bot.js           → send to all draws
// node bot.js --dry-run → preview all messages
// node bot.js --sync    → sync fixtures from API-Football first

const fs   = require('fs');
const path = require('path');
const { calcDrawStandings, buildLeaderboard } = require('./points');
const { sendGroupWhatsApp, buildGroupMessage } = require('./whatsapp');

function loadJSON(f) { return JSON.parse(fs.readFileSync(path.join(__dirname, 'data', f), 'utf8')); }

async function runDailyUpdate(dryRun = false, syncFirst = false) {
  console.log(`\n⚽ World Cup Draw Bot ${dryRun ? '[DRY RUN]' : ''}`);
  console.log(`⏰ ${new Date().toLocaleString('en-IE', { timeZone: 'Europe/Dublin' })}\n`);

  if (syncFirst) {
    const { syncToday } = require('./api_sync');
    await syncToday();
  }

  const draws   = loadJSON('draws.json');
  const teams   = loadJSON('teams.json');
  const matches = loadJSON('matches.json');
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]));
  const today   = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
  const todayMatches = matches.filter(m => m.date === today);

  console.log(`📋 ${draws.length} draw(s) | ${todayMatches.length} match(es) today\n`);

  for (const draw of draws) {
    const name = draw.name;
    console.log(`\n── Draw: ${name} (${(draw.users||[]).length} participants) ──`);

    const standings  = calcDrawStandings(draw);
    const leaderboard = buildLeaderboard(draw);

    leaderboard.forEach((l, i) => console.log(`  ${i+1}. ${l.name}: ${l.total}pts`));

    const message = buildGroupMessage(draw, leaderboard, standings, todayMatches, teamsMap);

    if (dryRun) {
      console.log(`\n${'─'.repeat(50)}`);
      console.log(`📱 MESSAGE PREVIEW — ${name}`);
      console.log('─'.repeat(50));
      console.log(message);
      console.log('─'.repeat(50));
      continue;
    }

    const { callmebot_group_id, callmebot_apikey } = draw.group || {};
    if (!callmebot_group_id || !callmebot_apikey) {
      console.log(`⚠️  Skipping "${name}" — no WhatsApp group configured`);
      continue;
    }

    process.stdout.write(`📤 Sending to "${name}" group... `);
    const result = await sendGroupWhatsApp(callmebot_group_id, callmebot_apikey, message);
    console.log(result.success ? '✅ Sent!' : `❌ Failed: ${result.error || result.body}`);

    // Pause between draws to be polite to CallMeBot
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n✨ Done!');
}

const args    = process.argv.slice(2);
const dryRun  = args.includes('--dry-run') || args.includes('-d');
const sync    = args.includes('--sync');
runDailyUpdate(dryRun, sync);
