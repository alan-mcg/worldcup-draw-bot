#!/usr/bin/env node
// setup.js — first-run setup

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');

const files = [
  { from: 'config.example.json', to: 'config.json' },
  { from: 'draws.example.json',  to: 'draws.json'  },
];

console.log('\n⚽  World Cup Draw Bot — First-run Setup\n');

for (const { from, to } of files) {
  const src  = path.join(DATA, from);
  const dest = path.join(DATA, to);
  if (fs.existsSync(dest)) {
    console.log(`  ✓  ${to} already exists — skipping`);
  } else {
    fs.copyFileSync(src, dest);
    console.log(`  ✅  Created ${to}`);
  }
}

if (!fs.existsSync(path.join(DATA, 'matches.json'))) {
  fs.writeFileSync(path.join(DATA, 'matches.json'), '[]');
}

// Auto-fetch all World Cup 2026 fixtures (no API key needed)
console.log('\n🔄 Fetching all World Cup 2026 fixtures...');
const { syncAllFixtures } = require('./api_sync');
syncAllFixtures()
  .then(r => {
    console.log(`✅  Loaded ${r.synced} fixtures\n`);
    printNextSteps();
  })
  .catch(e => {
    console.log(`⚠️   Could not fetch fixtures: ${e.message}`);
    console.log('    Run "npm run sync-all" once you have internet access.\n');
    printNextSteps();
  });

function printNextSteps() {
  console.log('📋  Next steps:');
  console.log('  1.  npm start  →  open http://localhost:3000');
  console.log('  2.  Create a draw, add participants, assign teams');
  console.log('  3.  Set up CallMeBot for each WhatsApp group (see README)\n');
}
