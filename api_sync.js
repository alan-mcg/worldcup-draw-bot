// api_sync.js — syncs World Cup 2026 fixtures from football-data.org (free tier)

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const WC_SEASON = '2026';

// football-data.org uses URY; our teams.json uses URU
const TLA_MAP = { URY: 'URU' };

function loadJSON(f) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
function saveJSON(f, d) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); }

function getApiKey() {
  try { return loadJSON('config.json').football_data_api_key || ''; } catch { return ''; }
}

function fdRequest(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.football-data.org',
      path:     urlPath,
      method:   'GET',
      headers:  { 'X-Auth-Token': getApiKey(), 'User-Agent': 'WorldCupDrawBot/1.0' }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          if (json.errorCode) return reject(new Error(json.message || 'API error ' + json.errorCode));
          resolve(json);
        } catch (e) { reject(new Error('Invalid JSON: ' + body.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function mapStage(stage) {
  return {
    GROUP_STAGE:    'group',
    ROUND_OF_32:    'round_of_32',
    ROUND_OF_16:    'round_of_16',
    QUARTER_FINALS: 'quarter_final',
    SEMI_FINALS:    'semi_final',
    THIRD_PLACE:    'third_place',
    FINAL:          'final',
  }[stage] || 'group';
}

function parseMatch(m) {
  const played     = m.status === 'FINISHED';
  const kickoffUtc = new Date(m.utcDate);
  return {
    id:         'wc_' + m.id,
    sourceId:   String(m.id),
    date:       kickoffUtc.toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' }),
    kickoff:    kickoffUtc.toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin', hour12: false }),
    kickoffUTC: m.utcDate,
    stage:      mapStage(m.stage),
    group:      m.group || '',
    homeTeam:   TLA_MAP[m.homeTeam?.tla] || m.homeTeam?.tla || '',
    awayTeam:   TLA_MAP[m.awayTeam?.tla] || m.awayTeam?.tla || '',
    homeScore:  played ? (m.score?.fullTime?.home ?? null) : null,
    awayScore:  played ? (m.score?.fullTime?.away ?? null) : null,
    played,
    venue:      '',
    status:     m.status
  };
}

async function syncAllFixtures() {
  console.log('🔄 Fetching all World Cup 2026 fixtures...');

  const data    = await fdRequest(`/v4/competitions/WC/matches?season=${WC_SEASON}`);
  const fetched = (data.matches || []).map(parseMatch);

  let existing = [];
  try { existing = loadJSON('matches.json'); } catch {}

  // Never drop existing played matches with valid scores — even if the API stops returning them
  const preserved = existing.filter(m => m.played && m.homeScore !== null && m.awayScore !== null);
  const preservedIds = new Set(preserved.map(m => m.sourceId).filter(Boolean));

  // Use fresh API data for anything not already locked in
  const updated = fetched.filter(m => !preservedIds.has(m.sourceId));
  const merged = [...preserved, ...updated];

  // Keep manually-entered matches not covered by either set
  const mergedKeys = new Set(merged.map(m => m.date + '|' + m.homeTeam + '|' + m.awayTeam));
  existing
    .filter(m => !m.sourceId && !mergedKeys.has(m.date + '|' + m.homeTeam + '|' + m.awayTeam))
    .forEach(m => merged.push(m));

  saveJSON('matches.json', merged);

  const config = loadJSON('config.json');
  config.last_synced = new Date().toISOString();
  saveJSON('config.json', config);

  console.log(`✅ Synced ${merged.length} fixtures`);
  return { synced: merged.length };
}

async function syncToday() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
  console.log(`🔄 Syncing today's fixtures (${today})...`);

  try {
    const data        = await fdRequest(`/v4/competitions/WC/matches?season=${WC_SEASON}&dateFrom=${today}&dateTo=${today}`);
    const todayEvents = (data.matches || []).map(parseMatch);

    const matches = loadJSON('matches.json');
    let updated = 0;

    for (const m of todayEvents) {
      const idx = matches.findIndex(e => e.sourceId === m.sourceId);
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
