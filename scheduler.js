// scheduler.js — auto-sends to all groups daily + syncs fixtures from API-Football
// node scheduler.js  (keep running, use pm2 in production)

const cron = require('node-cron');
const { execSync } = require('child_process');

const SEND_SCHEDULE = '0 20 * * *';   // 8:00 PM daily
const SYNC_SCHEDULE = '0 */2 * * *';  // Sync fixtures every 2 hours during tournament

console.log('⏰ World Cup Bot Scheduler started');
console.log('   📤 Sends at 8pm every day');
console.log('   🔄 Syncs API-Football every 2 hours');
console.log('   Use Ctrl+C to stop, or pm2 to run in background\n');

cron.schedule(SYNC_SCHEDULE, () => {
  console.log(`\n🔄 [${new Date().toLocaleString()}] Syncing today's fixtures...`);
  try { execSync('node -e "require(\'./api_sync\').syncToday()"', { stdio: 'inherit' }); }
  catch (e) { console.error('Sync error:', e.message); }
});

cron.schedule(SEND_SCHEDULE, () => {
  console.log(`\n🚀 [${new Date().toLocaleString()}] Sending daily updates...`);
  try { execSync('node bot.js', { stdio: 'inherit' }); }
  catch (e) { console.error('Bot error:', e.message); }
});
