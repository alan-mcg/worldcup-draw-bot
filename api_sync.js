// api_sync.js — syncs live fixture/result data from API-Football (free: 100 req/day)
// API docs: https://www.api-football.com/documentation-v3
// Sign up free at: https://dashboard.api-football.com/register

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function loadJSON(f) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }
function saveJSON(f, d) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); }

function apiFetch(apiKey, endpoint) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'v3.football.api-sports.io',
      path: endpoint,
      method: 'GET',
      headers: { 'x-apisports-key': apiKey }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Map API-Football team IDs to our 3-letter codes
// These are the actual API-Football team IDs for WC 2026 teams
const TEAM_ID_MAP = {
  2:   'MEX', 4:   'POR', 6:   'BRA', 8:   'FRA', 9:   'ESP',
  10:  'GER', 14:  'MAR', 15:  'JPN', 18:  'BEL', 21:  'TUR',
  24:  'CRO', 25:  'ENG', 26:  'ARG', 27:  'GER', 29:  'NED',
  35:  'SCO', 36:  'SEN', 38:  'NOR', 45:  'ECU', 46:  'SUI',
  48:  'KOR', 56:  'URU', 57:  'COL', 60:  'AUS', 63:  'USA',
  68:  'SWE', 71:  'CAN', 76:  'SAU', 92:  'QAT', 94:  'IRN',
  95:  'AUT', 96:  'TUN', 101: 'IRQ', 104: 'CPV', 105: 'PAR',
  108: 'RSA', 111: 'EGY', 116: 'DZA', 119: 'BIH', 155: 'JOR',
  157: 'COD', 164: 'CIV', 174: 'CHI', 203: 'NZL', 261: 'CZE',
  272: 'UZB', 285: 'CMR', 401: 'PAN', 478: 'CUW'
};

function mapTeamId(apiId) {
  return TEAM_ID_MAP[apiId] || `UNK_${apiId}`;
}

function mapStage(round) {
  const r = (round || '').toLowerCase();
  if (r.includes('group'))          return 'group';
  if (r.includes('round of 32'))    return 'round_of_32';
  if (r.includes('round of 16'))    return 'round_of_16';
  if (r.includes('quarter'))        return 'quarter_final';
  if (r.includes('semi'))           return 'semi_final';
  if (r.includes('3rd') || r.includes('third')) return 'third_place';
  if (r.includes('final'))          return 'final';
  return 'group';
}

async function syncFixtures() {
  const config = loadJSON('config.json');
  const { api_key, league_id, season } = config.api_football;

  if (!api_key) {
    console.log('⚠️  No API-Football key set. Skipping sync.');
    return { synced: 0, error: 'No API key' };
  }

  console.log('🔄 Fetching fixtures from API-Football...');

  try {
    const data = await apiFetch(api_key, `/fixtures?league=${league_id}&season=${season}`);

    if (data.errors && Object.keys(data.errors).length) {
      const err = JSON.stringify(data.errors);
      console.error('❌ API error:', err);
      return { synced: 0, error: err };
    }

    const fixtures = data.response || [];
    console.log(`   Got ${fixtures.length} fixtures from API`);

    const existingMatches = loadJSON('matches.json');
    const existingById = Object.fromEntries(existingMatches.map(m => [m.apiId, m]));

    const updated = fixtures.map(f => {
      const apiId = String(f.fixture.id);
      const existing = Object.values(existingById).find(m => m.apiId === apiId) || {};
      const kickoffUtc = new Date(f.fixture.date);

      // Convert to Irish time for display
      const kickoff = kickoffUtc.toLocaleTimeString('en-IE', {
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Europe/Dublin', hour12: false
      });
      const date = kickoffUtc.toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' }); // YYYY-MM-DD

      const played = ['FT','AET','PEN','FT_PEN'].includes(f.fixture.status.short);

      return {
        id: existing.id || ('wc_' + apiId),
        apiId,
        date,
        kickoff,
        kickoffUTC: f.fixture.date,
        stage: mapStage(f.league.round),
        homeTeam: mapTeamId(f.teams.home.id),
        awayTeam: mapTeamId(f.teams.away.id),
        homeScore: played ? f.goals.home : null,
        awayScore: played ? f.goals.away : null,
        played,
        venue: f.fixture.venue?.name || '',
        status: f.fixture.status.short
      };
    });

    saveJSON('matches.json', updated);
    config.api_football.last_synced = new Date().toISOString();
    saveJSON('config.json', config);

    console.log(`✅ Synced ${updated.length} fixtures`);
    return { synced: updated.length };
  } catch (e) {
    console.error('❌ Sync failed:', e.message);
    return { synced: 0, error: e.message };
  }
}

async function syncToday() {
  const config = loadJSON('config.json');
  const { api_key, league_id, season } = config.api_football;
  if (!api_key) return { synced: 0, error: 'No API key' };

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
  console.log(`🔄 Syncing today's fixtures (${today})...`);

  try {
    const data = await apiFetch(api_key, `/fixtures?league=${league_id}&season=${season}&date=${today}`);
    if (data.errors && Object.keys(data.errors).length) return { synced: 0, error: JSON.stringify(data.errors) };

    const todayFixtures = data.response || [];
    const allMatches = loadJSON('matches.json');
    let updated = 0;

    for (const f of todayFixtures) {
      const apiId = String(f.fixture.id);
      const played = ['FT','AET','PEN','FT_PEN'].includes(f.fixture.status.short);
      const idx = allMatches.findIndex(m => m.apiId === apiId);

      const matchData = {
        id: idx >= 0 ? allMatches[idx].id : ('wc_' + apiId),
        apiId,
        date: today,
        kickoff: new Date(f.fixture.date).toLocaleTimeString('en-IE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Dublin', hour12: false }),
        kickoffUTC: f.fixture.date,
        stage: mapStage(f.league.round),
        homeTeam: mapTeamId(f.teams.home.id),
        awayTeam: mapTeamId(f.teams.away.id),
        homeScore: played ? f.goals.home : null,
        awayScore: played ? f.goals.away : null,
        played,
        venue: f.fixture.venue?.name || '',
        status: f.fixture.status.short
      };

      if (idx >= 0) { allMatches[idx] = matchData; }
      else { allMatches.push(matchData); }
      updated++;
    }

    saveJSON('matches.json', allMatches);
    config.api_football.last_synced = new Date().toISOString();
    saveJSON('config.json', config);
    console.log(`✅ Updated ${updated} fixtures for today`);
    return { synced: updated };
  } catch (e) {
    return { synced: 0, error: e.message };
  }
}

module.exports = { syncFixtures, syncToday };
