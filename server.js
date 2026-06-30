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
  res.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-cache'});
  res.end(fs.readFileSync(path.join(__dirname, 'admin', file), 'utf8'));
};

const MANIFEST = JSON.stringify({
  name: 'World Cup 2026 Sweepstake',
  short_name: 'SweepWC',
  description: 'Track your World Cup sweepstake draw',
  start_url: '/',
  display: 'standalone',
  background_color: '#ffffff',
  theme_color: '#16a34a',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
});

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="50" fill="#16a34a"/>
<text x="50" y="68" font-size="55" text-anchor="middle" font-family="serif">⚽</text>
</svg>`;

const SW_JS = `self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));`;

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

// ── AUDIT LOG ────────────────────────────────────────
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');
const MAX_AUDIT  = 500;


function audit(action, details = {}) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf8')); } catch {}
  const last = log[0];
  if (last && last.action === action && last.slug === details.slug &&
      Date.now() - new Date(last.ts).getTime() < 30000) return;
  log.unshift({ ts: new Date().toISOString(), action, ...details });
  if (log.length > MAX_AUDIT) log.length = MAX_AUDIT;
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(log));
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

async function verifyDrawPin(slug, pin, log = false) {
  const lockedMins = checkLocked(slug);
  if (lockedMins) {
    if (log) audit('draw_locked', { slug });
    return { error: `Too many attempts — try again in ${lockedMins} min`, locked: true };
  }

  const draw = findDrawBySlug(slug);
  if (!draw?.pinHash) return { error: 'Draw not found' };

  const hash = await hashPin(String(pin), draw.pinSalt);
  if (hash !== draw.pinHash) {
    recordFail(slug);
    if (log) audit('draw_login_fail', { slug, draw: draw.name });
    return { error: 'Incorrect PIN' };
  }

  recordSuccess(slug);
  if (log) audit('draw_login_success', { slug, draw: draw.name });
  return { draw };
}

// ── ADMIN ROUTES (full dashboard) ───────────────────

// Wraps a handler so it requires a valid admin session token
function adminOnly(fn) {
  return async (req, res) => {
    if (!checkAdminSession(req)) return json(res, { error: 'Unauthorised' }, 401);
    return fn(req, res);
  };
}

const ROUTES = {
  // ── Public pages ───────────────────────────────────
  'GET /':               (q,r) => serveHtml(r, 'index.html'),
  'GET /admin':          (q,r) => serveHtml(r, 'dashboard.html'),
  'GET /manifest.json':  (_,r) => { r.writeHead(200,{'Content-Type':'application/manifest+json'}); r.end(MANIFEST); },
  'GET /icon.svg':       (_,r) => { r.writeHead(200,{'Content-Type':'image/svg+xml'}); r.end(ICON_SVG); },
  'GET /sw.js':          (_,r) => { r.writeHead(200,{'Content-Type':'application/javascript'}); r.end(SW_JS); },

  // ── Auth ────────────────────────────────────────────
  'POST /api/draw-login':          handleDrawLogin,
  'POST /api/draw-accessed':       async (req,r) => { const b=await parseBody(req); if(b.slug&&b.draw) audit('draw_login_success',{slug:b.slug,draw:b.draw}); json(r,{ok:true}); },
  'POST /api/admin/login':         handleAdminLogin,
  'POST /api/admin/logout':        handleAdminLogout,
  'POST /api/admin/draws/delete':  handleAdminDeleteDraw,
  'GET /api/admin/audit':          adminOnly((_,r) => { let log=[]; try{log=JSON.parse(fs.readFileSync(AUDIT_FILE,'utf8'));}catch{} json(r,log); }),

  // ── Public reads (fixture/team data — no secrets) ──
  'GET /api/teams':        (_,r) => json(r, load('teams.json')),
  'GET /api/matches':      (_,r) => json(r, load('matches.json')),
  'GET /api/leaderboard':  apiLeaderboard,

  // ── Admin-only reads ────────────────────────────────
  // Strip pinHash/pinSalt before sending draws to client
  'GET /api/draws': adminOnly((_,r) => {
    const safe = load('draws.json').map(({ pinHash, pinSalt, ...d }) => d);
    json(r, safe);
  }),
  // Strip API key from config response
  'GET /api/config': adminOnly((_,r) => {
    const { football_data_api_key, ...safe } = load('config.json');
    json(r, safe);
  }),

  // ── Admin-only writes ───────────────────────────────
  'POST /api/teams':    adminOnly(async (q,r) => { save('teams.json',   await parseBody(q)); json(r,{ok:true}); }),
  'POST /api/matches':  adminOnly(async (q,r) => { save('matches.json', await parseBody(q)); json(r,{ok:true}); }),
  'POST /api/draws':    adminOnly(async (q,r) => { save('draws.json',   await parseBody(q)); json(r,{ok:true}); }),
  'POST /api/config':   adminOnly(async (q,r) => {
    // Never allow the API key to be overwritten via this endpoint
    const body = await parseBody(q);
    const existing = load('config.json');
    save('config.json', { ...body, football_data_api_key: existing.football_data_api_key });
    json(r, { ok: true });
  }),
  'POST /api/preview':    adminOnly(apiPreview),
  'POST /api/send':       adminOnly(apiSend),
  'POST /api/sync-today': adminOnly(async (_,r) => { try { json(r, await syncToday());       } catch(e) { json(r,{error:e.message},500); } }),
  'POST /api/sync-all':   adminOnly(async (_,r) => { try { json(r, await syncAllFixtures()); } catch(e) { json(r,{error:e.message},500); } }),
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

// ── ADMIN AUTH ───────────────────────────────────────
// Sessions are in-memory (reset on restart) — intentional for a WC bot.
// Password hash lives in data/admin.json which is gitignored.

const adminSessions = new Map(); // token → createdAt (ms)

function createAdminSession() {
  const token = crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now());
  // Expire sessions older than 24 h
  for (const [t, ts] of adminSessions)
    if (Date.now() - ts > 86_400_000) adminSessions.delete(t);
  return token;
}

function checkAdminSession(req) {
  const token = req.headers['x-admin-token'];
  if (!token) return false;
  const ts = adminSessions.get(token);
  if (!ts) return false;
  if (Date.now() - ts > 86_400_000) { adminSessions.delete(token); return false; }
  return true;
}

async function handleAdminLogin(req, res) {
  const lockedMins = checkLocked('admin');
  if (lockedMins) {
    audit('admin_locked', {});
    return json(res, { ok: false, error: `Too many attempts — try again in ${lockedMins} min` });
  }

  const { password } = await parseBody(req);
  let cfg;
  try { cfg = load('admin.json'); }
  catch { return json(res, { error: 'Admin not configured — run: node setup-admin.js' }, 503); }
  const hash = await hashPin(String(password || ''), cfg.passwordSalt);
  if (hash !== cfg.passwordHash) {
    recordFail('admin');
    audit('admin_login_fail', {});
    return json(res, { ok: false, error: 'Incorrect password' });
  }
  recordSuccess('admin');
  audit('admin_login_success', {});
  return json(res, { ok: true, token: createAdminSession() });
}

function handleAdminLogout(req, res) {
  adminSessions.delete(req.headers['x-admin-token']);
  json(res, { ok: true });
}

async function handleAdminDeleteDraw(req, res) {
  if (!checkAdminSession(req)) return json(res, { error: 'Unauthorised' }, 401);
  const { slug } = await parseBody(req);
  if (!slug) return json(res, { error: 'slug required' }, 400);
  const draws = load('draws.json').filter(d => d.slug !== slug && d.id !== slug);
  save('draws.json', draws);
  audit('draw_deleted', { slug });
  json(res, { ok: true });
}

// ── DRAW LOGIN (landing page) ────────────────────────

async function handleDrawLogin(req, res) {
  const { name, pin } = await parseBody(req);
  if (!name?.trim()) return json(res, { error: 'Enter your draw name' }, 400);
  const slug = slugify(name.trim());
  const result = await verifyDrawPin(slug, pin, true);
  if (result.error) return json(res, { ok: false, error: result.error, locked: result.locked });
  return json(res, { ok: true, slug });
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
    group:       { discord_webhook: '' },
    users:       []
  });
  save('draws.json', draws);
  audit('draw_created', { slug, draw: name.trim() });
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
    case 'assign-teams': {
      const { userNames, teamsPerPerson } = body;
      if (!Array.isArray(userNames) || !userNames.length)
        return json(res, { error: 'No participants provided' }, 400);
      const allTeams = load('teams.json');
      const n    = userNames.length;
      const need = n * teamsPerPerson;
      if (need > allTeams.length)
        return json(res, { error: `Need ${need} teams but only ${allTeams.length} available` }, 400);

      // Sort by FIFA rank ascending; unranked (0 or missing) go to the end
      const sorted = [...allTeams].sort((a, b) =>
        (a.fifaRank || 9999) - (b.fifaRank || 9999)
      );

      // Build teamsPerPerson tiers of n teams each, shuffle each tier
      const tiers = Array.from({ length: teamsPerPerson }, (_, t) => {
        const tier = sorted.slice(t * n, (t + 1) * n);
        for (let i = tier.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tier[i], tier[j]] = [tier[j], tier[i]];
        }
        return tier;
      });

      // Each person draws one team from each tier
      const users = userNames.map((name, i) => ({
        id:    'u' + (Date.now() + i),
        name:  name.trim(),
        teams: tiers.map(tier => tier[i].id)
      }));

      const draws = load('draws.json');
      const idx   = draws.findIndex(d => d.slug === slug);
      draws[idx]  = { ...draws[idx], teamsPerPerson, users };
      save('draws.json', draws);
      return json(res, { ok: true, users });
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
  const { buildGroupMessage } = require('./messaging');
  const teams    = load('teams.json');
  const matches  = load('matches.json');
  const teamsMap = Object.fromEntries(teams.map(t => [t.id, t]));
  const d        = date || new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
  const message  = buildGroupMessage(
    draw, buildLeaderboard(draw), calcDrawStandings(draw),
    matches.filter(m => m.date === d), teamsMap, d
  );
  return { message, date: d };
}

async function sendToGroup(draw) {
  const { sendDiscordMessage } = require('./messaging');
  const preview = buildPreview(draw);
  const { discord_webhook } = draw.group || {};
  const result  = await sendDiscordMessage(discord_webhook, preview.message);
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

  syncAllFixtures().catch(e => console.error('Startup sync error:', e.message));
});
