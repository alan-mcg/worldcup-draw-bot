// server.js — admin dashboard
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { calcDrawStandings, buildLeaderboard } = require('./points');
const DATA_DIR = path.join(__dirname, 'data');

const load = f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const save = (f, d) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2));
const parseBody = req => new Promise((res, rej) => {
  let b = '';
  req.on('data', c => b += c);
  req.on('end', () => { try { res(JSON.parse(b)); } catch { res({}); } });
  req.on('error', rej);
});

const ROUTES = {
  'GET /':                    (q,r) => { r.writeHead(200,{'Content-Type':'text/html'}); r.end(fs.readFileSync(path.join(__dirname,'admin','index.html'),'utf8')); },
  'GET /api/teams':           (q,r) => json(r, load('teams.json')),
  'GET /api/matches':         (q,r) => json(r, load('matches.json')),
  'GET /api/draws':           (q,r) => json(r, load('draws.json')),
  'GET /api/config':          (q,r) => json(r, load('config.json')),
  'POST /api/teams':          async (q,r) => { save('teams.json',  await parseBody(q)); json(r,{ok:true}); },
  'POST /api/matches':        async (q,r) => { save('matches.json',await parseBody(q)); json(r,{ok:true}); },
  'POST /api/draws':          async (q,r) => { save('draws.json',  await parseBody(q)); json(r,{ok:true}); },
  'POST /api/config':         async (q,r) => { save('config.json', await parseBody(q)); json(r,{ok:true}); },
  'GET /api/leaderboard':     apiLeaderboard,
  'POST /api/preview':        apiPreview,
  'POST /api/send':           apiSend,
  'POST /api/sync-today':     apiSyncToday,
  'POST /api/sync-all':       apiSyncAll,
};

async function apiLeaderboard(req, res) {
  const url = new URL('http://x' + req.url);
  const drawId = url.searchParams.get('drawId');
  const draws = load('draws.json');
  const draw = draws.find(d => d.id === drawId);
  if (!draw) return json(res, { error: 'Draw not found' }, 404);
  const standings = calcDrawStandings(draw);
  const lb = buildLeaderboard(draw);
  json(res, { leaderboard: lb, standings });
}

async function apiPreview(req, res) {
  const body = await parseBody(req);
  const draws = load('draws.json');
  const draw = draws.find(d => d.id === body.drawId);
  if (!draw) return json(res, { error: 'Draw not found' }, 404);
  const { buildGroupMessage } = require('./whatsapp');
  const teams = load('teams.json');
  const matches = load('matches.json');
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]));
  const date = body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
  const todayMatches = matches.filter(m => m.date === date);
  const standings = calcDrawStandings(draw);
  const lb = buildLeaderboard(draw);
  const message = buildGroupMessage(draw, lb, standings, todayMatches, teamsMap);
  json(res, { message, date });
}

async function apiSend(req, res) {
  const body = await parseBody(req);
  const draws = load('draws.json');
  const draw = draws.find(d => d.id === body.drawId);
  if (!draw) return json(res, { error: 'Draw not found' }, 404);
  const { sendGroupWhatsApp, buildGroupMessage } = require('./whatsapp');
  const teams = load('teams.json');
  const matches = load('matches.json');
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
  const todayMatches = matches.filter(m => m.date === today);
  const standings = calcDrawStandings(draw);
  const lb = buildLeaderboard(draw);
  const message = buildGroupMessage(draw, lb, standings, todayMatches, teamsMap);
  const { callmebot_group_id, callmebot_apikey } = draw.group || {};
  const result = await sendGroupWhatsApp(callmebot_group_id, callmebot_apikey, message);
  json(res, { sent: result.success, message, result });
}

async function apiSyncToday(req, res) {
  try {
    const { syncToday } = require('./api_sync');
    const result = await syncToday();
    json(res, result);
  } catch(e) { json(res, { error: e.message }, 500); }
}

async function apiSyncAll(req, res) {
  try {
    const { syncFixtures } = require('./api_sync');
    const result = await syncFixtures();
    json(res, result);
  } catch(e) { json(res, { error: e.message }, 500); }
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }
  const key = `${req.method} ${req.url.split('?')[0]}`;
  const handler = ROUTES[key];
  if (handler) { try { await handler(req, res); } catch(e) { json(res, { error: e.message }, 500); } }
  else json(res, { error: 'Not found' }, 404);
});

server.listen(3000, () => console.log('\n🌍 World Cup Bot → http://localhost:3000\n'));
