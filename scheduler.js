// scheduler.js — auto-sends to all groups daily + syncs live scores
// node scheduler.js  (keep running, use pm2 in production)

const cron = require('node-cron');
const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');

const SYNC_SCHEDULE = '*/30 * * * *'; // Sync all fixtures every 30 minutes

// Read send_time from config.json so there's one place to change it
function getSendSchedule() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8'));
    const [hour, minute] = (config.send_time || '09:00').split(':');
    return `${parseInt(minute, 10)} ${parseInt(hour, 10)} * * *`;
  } catch {
    return '0 9 * * *'; // fallback: 9am
  }
}

const sendSchedule = getSendSchedule();

console.log('⏰ World Cup Bot Scheduler started');
console.log(`   📤 Sends daily at ${JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'config.json'), 'utf8')).send_time || '09:00'}`);
console.log('   🔄 Syncs all fixtures every 30 minutes');
console.log('   Use Ctrl+C to stop, or pm2 to run in background\n');

cron.schedule(SYNC_SCHEDULE, () => {
  console.log(`\n🔄 [${new Date().toLocaleString()}] Syncing all fixtures...`);
  try { execSync('node -e "require(\'./api_sync\').syncAllFixtures()"', { stdio: 'inherit' }); }
  catch (e) { console.error('Sync error:', e.message); }
});

cron.schedule(sendSchedule, () => {
  console.log(`\n🚀 [${new Date().toLocaleString()}] Sending daily updates...`);
  try { execSync('node bot.js', { stdio: 'inherit' }); }
  catch (e) { console.error('Bot error:', e.message); }
});
