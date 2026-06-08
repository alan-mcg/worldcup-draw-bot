// api_sync.js — syncs World Cup 2026 fixtures from ESPN's public API
// No API key or account required. Completely free and open.

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function loadJSON(f) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
function saveJSON(f, d) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); }

function espnFetch(dateStr) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'site.api.espn.com',
      path: `/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=${dateStr}`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + body.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function mapStage(slug) {
  if (!slug) return 'group';
  const s = slug.toLowerCase();
  if (s.includes('group'))                    return 'group';
  if (s.includes('32'))                       return 'round_of_32';
  if (s.includes('16'))                       return 'round_of_16';
  if (s.includes('quarter'))                  return 'quarter_final';
  if (s.includes('semi'))                     return 'semi_final';
  if (s.includes('third') || s.includes('3rd')) return 'third_place';
  if (s.includes('final'))                    return 'final';
  return 'group';
}

function parseEvent(event) {
  const comp = event.competitions[0];
  const home = comp.competitors.find(c => c.homeAway === 'home');
  const away = comp.competitors.find(c => c.homeAway === 'away');
  const status = comp.status.type;
  const played = status.completed === true;
  const kickoffUtc = new Date(event.date);

  return {
    id:         'wc_' + event.id,
    espnId:     event.id,
    date:       kickoffUtc.toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' }),
    kickoff:    kickoffUtc.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin', hour12: false }),
    kickoffUTC: event.date,
    stage:      mapStage(event.season?.slug),
    homeTeam:   home?.team?.abbreviation || '',
    awayTeam:   away?.team?.abbreviation || '',
    homeScore:  played ? parseInt(home?.score || '0', 10) : null,
    awayScore:  played ? parseInt(away?.score || '0', 10) : null,
    played,
    venue:      comp.venue?.fullName || '',
    status:     status.name
  };
}

// Fetch all 104 WC2026 fixtures by iterating every day June 11 – July 19
async function syncAllFixtures() {
  console.log('🔄 Fetching all World Cup 2026 fixtures from ESPN...');

  const start = new Date('2026-06-11');
  const end   = new Date('2026-07-19');
  const seen  = new Set();
  const fetched = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10).replace(/-/g, '');
    try {
      const data = await espnFetch(dateStr);
      for (const event of (data.events || [])) {
        if (!seen.has(event.id)) {
          seen.add(event.id);
          fetched.push(parseEvent(event));
        }
      }
    } catch (e) {
      console.error(`  ⚠️  ${dateStr}: ${e.message}`);
    }
  }

  // Merge: preserve existing scores for already-played matches
  let existing = [];
  try { existing = loadJSON('matches.json'); } catch {}

  const existingById = Object.fromEntries(
    existing.filter(m => m.espnId).map(m => [m.espnId, m])
  );

  const merged = fetched.map(m => {
    const ex = existingById[m.espnId];
    return (ex && ex.played) ? ex : m;
  });

  // Keep manually-entered matches only if they don't overlap with an ESPN fixture
  const fetchedKeys = new Set(fetched.map(m => m.date + '|' + m.homeTeam + '|' + m.awayTeam));
  existing
    .filter(m => !m.espnId && !fetchedKeys.has(m.date + '|' + m.homeTeam + '|' + m.awayTeam))
    .forEach(m => merged.push(m));

  saveJSON('matches.json', merged);

  const config = loadJSON('config.json');
  config.last_synced = new Date().toISOString();
  saveJSON('config.json', config);

  console.log(`✅ Synced ${merged.length} fixtures`);
  return { synced: merged.length };
}

// Fetch only today's matches and update their scores
async function syncToday() {
  const today   = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
  const dateStr = today.replace(/-/g, '');
  console.log(`🔄 Syncing today's fixtures (${today})...`);

  try {
    const data = await espnFetch(dateStr);
    const todayEvents = (data.events || []).map(parseEvent);

    const matches = loadJSON('matches.json');
    let updated = 0;

    for (const m of todayEvents) {
      const idx = matches.findIndex(e => e.espnId === m.espnId);
      if (idx >= 0) { matches[idx] = m; }
      else { matches.push(m); }
      updated++;
    }

    saveJSON('matches.json', matches);

    const config = loadJSON('config.json');
    config.last_synced = new Date().toISOString();
    saveJSON('config.json', config);

    console.log(`✅ Updated ${updated} fixture(s) for today`);
    return { synced: updated };
  } catch (e) {
    console.error('❌ Sync failed:', e.message);
    return { synced: 0, error: e.message };
  }
}

module.exports = { syncAllFixtures, syncFixtures: syncAllFixtures, syncToday };
