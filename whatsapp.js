// whatsapp.js — CallMeBot group sender + message builder

const https = require('https');

function sendGroupWhatsApp(groupId, apiKey, text) {
  return new Promise((resolve) => {
    if (!groupId || !apiKey) {
      return resolve({ success: false, error: 'Missing groupId or apiKey — check Settings' });
    }
    const encoded = encodeURIComponent(text);
    const url = `https://api.callmebot.com/whatsapp.php?groupid=${encodeURIComponent(groupId)}&text=${encoded}&apikey=${apiKey}`;
    https.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        const success = res.statusCode === 200 && !body.toLowerCase().includes('error');
        resolve({ success, status: res.statusCode, body });
      });
    }).on('error', err => resolve({ success: false, error: err.message }));
  });
}

function findRivalries(todayMatches, users, teamsMap) {
  const teamOwners = {};
  for (const user of users) {
    for (const teamId of (user.teams || [])) {
      if (!teamOwners[teamId]) teamOwners[teamId] = [];
      teamOwners[teamId].push(user.name.split(' ')[0]);
    }
  }
  const rivalries = [];
  for (const m of todayMatches) {
    if (m.played) continue;
    const ho = teamOwners[m.homeTeam], ao = teamOwners[m.awayTeam];
    if (ho?.length && ao?.length) {
      const h = teamsMap[m.homeTeam], a = teamsMap[m.awayTeam];
      if (h && a) rivalries.push({ home: h, homeOwners: ho, away: a, awayOwners: ao, kickoff: m.kickoff });
    }
  }
  return rivalries;
}

function stageStr(s) {
  return { group:'Group Stage', round_of_32:'Round of 32', round_of_16:'Round of 16', quarter_final:'Quarter Final', semi_final:'Semi Final', third_place:'Third Place', final:'Final' }[s] || s;
}

function buildGroupMessage(draw, leaderboard, standings, todayMatches, teamsMap) {
  const today = new Date().toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long' });
  const upcoming = todayMatches.filter(m => !m.played);
  const results  = todayMatches.filter(m => m.played);

  let msg = `⚽ *${draw.name} — Daily Update*\n`;
  msg += `📅 ${today}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Fixtures
  if (upcoming.length) {
    msg += `🗓️ *Today's Fixtures:*\n`;
    for (const m of upcoming) {
      const h = teamsMap[m.homeTeam], a = teamsMap[m.awayTeam];
      if (!h || !a) continue;
      msg += `  ${h.flag} *${h.name}* vs ${a.flag} *${a.name}*\n`;
      msg += `  ⏰ ${m.kickoff} Irish time`;
      if (m.venue) msg += ` | ${m.venue}`;
      msg += `\n  📌 ${stageStr(m.stage)}\n\n`;
    }
  }

  if (results.length) {
    msg += `📊 *Today's Results:*\n`;
    for (const m of results) {
      const h = teamsMap[m.homeTeam], a = teamsMap[m.awayTeam];
      if (!h || !a) continue;
      const winner = m.homeScore > m.awayScore ? h.name : m.homeScore < m.awayScore ? a.name : null;
      const emoji  = winner ? '✅' : '🟡';
      msg += `  ${emoji} ${h.flag} ${h.name} *${m.homeScore}–${m.awayScore}* ${a.flag} ${a.name}`;
      msg += ` _(${winner ? winner + ' win' : 'Draw'})_\n`;
    }
    msg += '\n';
  }

  if (!upcoming.length && !results.length) {
    msg += `😴 *No World Cup matches today*\n\n`;
  }

  // Rivalries
  const rivalries = findRivalries(todayMatches, draw.users || [], teamsMap);
  if (rivalries.length) {
    msg += `🔥 *Draw Clashes Today!*\n`;
    for (const r of rivalries) {
      msg += `  ⚔️  ${r.home.flag} ${r.home.name} _(${r.homeOwners.join('/')})_\n`;
      msg += `      vs ${r.away.flag} ${r.away.name} _(${r.awayOwners.join('/')})_\n`;
      msg += `      ⏰ ${r.kickoff} Irish time\n`;
    }
    msg += '\n';
  }

  // Leaderboard
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏆 *${draw.name} Standings*\n\n`;
  const medals = ['🥇','🥈','🥉'];
  for (let i = 0; i < leaderboard.length; i++) {
    const row = leaderboard[i];
    const s   = standings.find(st => st.user.id === row.id);
    const teamLine = (s?.teamBreakdown || []).map(tb => `${tb.team.flag}${tb.points}pts`).join(' ');
    msg += `${medals[i] || (i+1) + '.'} *${row.name}* — ${row.total} pts\n`;
    if (teamLine) msg += `    ${teamLine}\n`;
  }

  msg += `\nGood luck everyone! 🍀`;
  return msg;
}

module.exports = { sendGroupWhatsApp, buildGroupMessage, findRivalries };
