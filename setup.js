#!/usr/bin/env node
// setup.js — first-run setup
// Creates your live data files from the example templates.
// Run once after cloning: node setup.js

const fs   = require('fs');
const path = require('path');

const DATA = path.join(__dirname, 'data');

const files = [
  { from: 'config.example.json', to: 'config.json' },
  { from: 'draws.example.json',  to: 'draws.json'  },
];

// matches.json starts empty — populated by API-Football sync or manual entry
const emptyMatches = path.join(DATA, 'matches.json');

console.log('\n⚽  World Cup Draw Bot — First-run Setup\n');

let allGood = true;

for (const { from, to } of files) {
  const src  = path.join(DATA, from);
  const dest = path.join(DATA, to);
  if (fs.existsSync(dest)) {
    console.log(`  ✓  ${to} already exists — skipping`);
  } else {
    fs.copyFileSync(src, dest);
    console.log(`  ✅  Created ${to} from ${from}`);
    allGood = false;
  }
}

if (!fs.existsSync(emptyMatches)) {
  fs.writeFileSync(emptyMatches, '[]');
  console.log('  ✅  Created matches.json (empty — sync from API-Football to populate)');
}

console.log('\n📋  Next steps:');
console.log('  1.  npm install');
console.log('  2.  npm start  →  open http://localhost:3000');
console.log('  3.  Settings tab: paste your API-Football key → Sync All Fixtures');
console.log('  4.  Create a draw, add participants, assign teams');
console.log('  5.  Set up CallMeBot for each WhatsApp group (see README)\n');

if (!allGood) {
  console.log('  ⚠️   Edit data/config.json to add your API-Football key before syncing.\n');
}
