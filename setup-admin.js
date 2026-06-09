#!/usr/bin/env node
// Run once to create the admin password: node setup-admin.js
// Re-run at any time to change it.
const readline = require('readline');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');

const DATA_DIR = path.join(__dirname, 'data');

async function hashPassword(pw, salt) {
  return new Promise((res, rej) =>
    crypto.pbkdf2(pw, salt, 200000, 64, 'sha512',
      (err, k) => err ? rej(err) : res(k.toString('hex')))
  );
}

async function main() {
  const rl  = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(r => rl.question(q, r));

  console.log('\n⚽  World Cup Bot — Admin Setup\n');

  const pw  = await ask('Set admin password (min 8 chars): ');
  const pw2 = await ask('Confirm password:                  ');
  rl.close();

  if (!pw)              { console.log('\n❌ Password cannot be empty.\n');             process.exit(1); }
  if (pw !== pw2)       { console.log('\n❌ Passwords do not match.\n');              process.exit(1); }
  if (pw.length < 8)   { console.log('\n❌ Password must be at least 8 characters.\n'); process.exit(1); }

  console.log('\n   Hashing password…');
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = await hashPassword(pw, salt);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(DATA_DIR, 'admin.json'),
    JSON.stringify({ passwordHash: hash, passwordSalt: salt }, null, 2)
  );

  console.log('✅ Admin password saved to data/admin.json (gitignored).');
  console.log('   Start the server: node server.js\n');
}

main().catch(e => { console.error(e); process.exit(1); });
