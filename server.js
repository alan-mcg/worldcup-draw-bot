// server.js — admin dashboard + per-draw management + background auto-sync
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { calcDrawStandings, buildLeaderboard } = require('./points');
const { syncAllFixtures, syncToday } = require('./api_sync');

const DATA_DIR = path.join(__dirname, 'data');

const load = f => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
const save = (f, d) => fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2));
const parseBody = req => new Promise((res, rej) => {
  let b = '';
  req.on('data', c => b += c);
  req.on('end', () => { try { res(JSON.parse(b)); } catch { res({}); } });
  req.on('error', rej);
});
const serveHtml = (res, file) => {
  res.writeHead(200, {'Content-Type': 'text/html'});
  res.end(fs.readFileSync(path.join(__dirname, 'admin', file), 'utf8'));
};

// ── PIN SECURITY ─────────────────────────────────────
// PBKDF2 with 200,000 iterations — each hash takes ~200ms.
// Brute-forcing all 1,000,000 six-digit PINs would take ~55 hours.
// Random salt per draw prevents rainbow-table attacks.
// draws.json is gitignored so hashes never reach the repository.

function generateSalt() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPin(pin, salt) {
  return new Promise((resolve, reject) =>
    crypto.pbkdf2(String(pin), salt, 200000, 64, 'sha512', (err, key) =>
      err ? reject(err) : resolve(key.toString('hex'))
    )
  );
}

// ── BRUTE-FORCE RATE LIMITER ─────────────────────────
// 5 wrong guesses → 15-minute lockout per draw slug.
// In-memory only — resets on server restart (intentional for a World Cup bot).

const failedAttempts = new Map(); // slug → { count, lockUntil }

function checkLocked(slug) {
  const entry = failedAttempts.get(slug);
  if (!entry?.lockUntil) return null;
  if (Date.now() < entry.lockUntil) return Math.ceil((entry.lockUntil - Date.now()) / 60000);
  failedAttempts.delete(slug);
  return null;
}

function recordFail(slug) {
  const entry = failedAttempts.get(slug) || { count: 0 };
  entry.count++;
  if (entry.count >= 5) {
    entry.lockUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
  failedAttempts.set(slug, entry);
}

function recordSuccess(slug) {
  failedAttempts.delete(slug);
}

// ── SLUG + DRAW HELPERS ──────────────────────────────

function slugify(name) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]/g, '').toLowerCase().trim()
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'draw';
}

function findDrawBySlug(slug) {
  return load('draws.json').find(d => d.slug === slug) || null;
}

async function verifyDrawPin(slug, pin) {
  const lockedMins = checkLocked(slug);
  if (lockedMins) return { error: `Too many attempts — try again in ${lockedMins} min`, locked: true };

  const draw = findDrawBySlug(slug);
  if (!draw?.pinHash) return { error: 'Draw not found' };

  const hash = await hashPin(String(pin), draw.pinSalt);
  if (hash !== draw.pinHash) {
    recordFail(slug);
    return { error: 'Incorrect PIN' };
  }

  recordSuccess(slug);
  return { draw };
}

// ── ADMIN ROUTES (full dashboard) ───────────────────

const ROUTES = {
  'GET /':               (q,r) => serveHtml(r, 'index.html'),
  'GET /api/teams':      (q,r) => json(r, load('teams.json')),
  'GET /api/matches':    (q,r) => json(r, load('matches.json')),
  'GET /api/draws':      (q,r) => json(r, load('draws.json')),
  'GET /api/config':     (q,r) => json(r, load('config.json')),
  'POST /api/teams':     async (q,r) => { save('teams.json',  await parseBody(q)); json(r,{ok:true}); },
  'POST /api/matches':   async (q,r) => { save('matches.json',await parseBody(q)); json(r,{ok:true}); },
  'POST /api/draws':     async (q,r) => { save('draws.json',  await parseBody(q)); json(r,{ok:true}); },
  'POST /api/config':    async (q,r) => { save('config.json', await parseBody(q)); json(r,{ok:true}); },
  'GET /api/leaderboard':    apiLeaderboard,
  'POST /api/preview':       apiPreview,
  'POST /api/send':          apiSend,
  'POST /api/sync-today':    async (q,r) => { try { json(r, await syncToday());       } catch(e) { json(r,{error:e.message},500); } },
  'POST /api/sync-all':      async (q,r) => { try { json(r, await syncAllFixtures()); } catch(e) { json(r,{error:e.message},500); } },
};

async function apiLeaderboard(req, res) {
  const drawId = new URL('http://x' + req.url).searchParams.get('drawId');
  const draw   = load('draws.json').find(d => d.id === drawId);
  if (!draw) return json(res, { error: 'Draw not found' }, 404);
  json(res, { leaderboard: buildLeaderboard(draw), standings: calcDrawStandings(draw) });
}

async function apiPreview(req, res) {
  const body = await parseBody(req);
  const draw = load('draws.json').find(d => d.id === body.drawId);
  if (!draw) return json(res, { error: 'Draw not found' }, 404);
  json(res, buildPreview(draw, body.date));
}

async function apiSend(req, res) {
  const body = await parseBody(req);
  const draw = load('draws.json').find(d => d.id === body.drawId);
  if (!draw) return json(res, { error: 'Draw not found' }, 404);
  json(res, await sendToGroup(draw));
}

// ── SETUP ROUTE ──────────────────────────────────────

async function handleSetupCreate(req, res) {
  const { name, pin } = await parseBody(req);
  if (!name?.trim())              return json(res, { error: 'Draw name is required' }, 400);
  if (!/^\d{6}$/.test(String(pin))) return json(res, { error: 'PIN must be exactly 6 digits (numbers only)' }, 400);

  const draws = load('draws.json');
  const slug  = slugify(name.trim());

  if (draws.some(d => d.slug === slug))
    return json(res, { error: 'That draw name is already taken — please choose a different name.' }, 409);

  const salt = generateSalt();
  const pinHash = await hashPin(String(pin), salt);

  draws.push({
    id:          'draw_' + Date.now(),
    slug,
    name:        name.trim(),
    description: '',
    pinHash,
    pinSalt:     salt,
    group:       { callmebot_group_id: '', callmebot_apikey: '' },
    users:       []
  });
  save('draws.json', draws);
  json(res, { slug, manageUrl: `/manage/${slug}` });
}

// ── MANAGE ROUTES (per-draw, PIN-gated) ──────────────

async function handleManageApi(req, res, urlPath) {
  // /api/manage/:slug/:action
  const parts  = urlPath.split('/').filter(Boolean);
  const slug   = parts[2];
  const action = parts[3];
  const body   = await parseBody(req);

  if (action === 'verify') {
    const lockedMins = checkLocked(slug);
    if (lockedMins) return json(res, { ok: false, error: `Too many attempts — try again in ${lockedMins} min` });
    const result = await verifyDrawPin(slug, body.pin);
    if (result.error) return json(res, { ok: false, error: result.error });
    return json(res, { ok: true, name: result.draw.name });
  }

  const result = await verifyDrawPin(slug, body.pin);
  if (result.error) return json(res, { error: result.error }, result.locked ? 429 : 401);
  const { draw } = result;

  switch (action) {
    case 'data': {
      const { pinHash, pinSalt, ...safe } = draw;
      return json(res, safe);
    }
    case 'save': {
      const draws = load('draws.json');
      const idx   = draws.findIndex(d => d.slug === slug);
      draws[idx] = {
        ...draws[idx],
        ...(body.name !== undefined        && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.users !== undefined       && { users: body.users }),
        ...(body.group !== undefined       && { group: body.group }),
      };
      save('draws.json', draws);
      return json(res, { ok: true });
    }
    case 'preview':
      return json(res, buildPreview(draw, body.date));
    case 'send':
      return json(res, await sendToGroup(draw));
    default:
      return json(res, { error: 'Not found' }, 404);
  }
}

// ── SHARED HELPERS ───────────────────────────────────

function buildPreview(draw, date) {
  const { buildGroupMessage } = require('./whatsapp');
  const teams    = load('teams.json');
  const matches  = load('matches.json');
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]));
  const d        = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
  const message  = buildGroupMessage(
    draw, buildLeaderboard(draw), calcDrawStandings(draw),
    matches.filter(m => m.date === d), teamsMap
  );
  return { message, date: d };
}

async function sendToGroup(draw) {
  const { sendGroupWhatsApp } = require('./whatsapp');
  const preview = buildPreview(draw);
  const { callmebot_group_id, callmebot_apikey } = draw.group || {};
  const result  = await sendGroupWhatsApp(callmebot_group_id, callmebot_apikey, preview.message);
  return { sent: result.success, message: preview.message, result };
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

// ── AUTO-SYNC ────────────────────────────────────────

setInterval(() => {
  syncToday().catch(e => console.error('Auto-sync error:', e.message));
}, 30 * 60 * 1000);

function scheduleDailySend() {
  const config = load('config.json');
  const [h, m] = (config.send_time || '09:00').split(':').map(Number);
  const now    = new Date();
  const next   = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  setTimeout(() => {
    console.log(`\n🚀 [${new Date().toLocaleString()}] Sending daily updates...`);
    const { execSync } = require('child_process');
    try { execSync('node bot.js', { stdio: 'inherit', cwd: __dirname }); }
    catch (e) { console.error('Daily send error:', e.message); }
    scheduleDailySend();
  }, next - now);

  const hhmm = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  console.log(`   📤 Daily send scheduled for ${hhmm} (in ${Math.round((next - now) / 60000)} min)`);
}

// ── SERVER ───────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  const urlPath = req.url.split('?')[0];

  if (req.method === 'GET' && urlPath === '/setup')
    return serveHtml(res, 'setup.html');

  if (req.method === 'GET' && urlPath.startsWith('/manage/') && urlPath.length > '/manage/'.length)
    return serveHtml(res, 'manage.html');

  if (req.method === 'POST' && urlPath === '/api/setup/create')
    return handleSetupCreate(req, res);

  if (urlPath.startsWith('/api/manage/'))
    return handleManageApi(req, res, urlPath);

  const key = `${req.method} ${urlPath}`;
  const handler = ROUTES[key];
  if (handler) { try { await handler(req, res); } catch(e) { json(res, { error: e.message }, 500); } }
  else json(res, { error: 'Not found' }, 404);
});

server.listen(3000, () => {
  console.log('\n🌍 World Cup Bot     → http://localhost:3000');
  console.log('   🆕 New draw setup  → http://localhost:3000/setup\n');

  scheduleDailySend();

  const config = load('config.json');
  if (!config.last_synced) {
    console.log('   First run — fetching all fixtures from ESPN...');
    syncAllFixtures().catch(e => console.error('Initial sync error:', e.message));
  } else {
    syncToday().catch(e => console.error('Startup sync error:', e.message));
  }
});
