// messaging.js — Discord webhook sender + daily message builder

const https = require('https');

function sendDiscordMessage(webhookUrl, text) {
  return new Promise((resolve) => {
    if (!webhookUrl) return resolve({ success: false, error: 'No Discord webhook URL configured' });
    const body = JSON.stringify({ content: text });
    let url;
    try { url = new URL(webhookUrl); } catch(e) { return resolve({ success: false, error: 'Invalid webhook URL' }); }
    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', c => responseBody += c);
      res.on('end', () => {
        // Discord returns 204 No Content on success
        resolve({ success: res.statusCode === 204 || res.statusCode === 200, status: res.statusCode, body: responseBody });
      });
    });
    req.on('error', err => resolve({ success: false, error: err.message }));
    req.write(body);
    req.end();
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

function buildGroupMessage(draw, leaderboard, standings, todayMatches, teamsMap, date) {
  const dateObj = date ? new Date(date + 'T12:00:00Z') : new Date();
  const today = dateObj.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long' });
  const upcoming = todayMatches.filter(m => !m.played);
  const results  = todayMatches.filter(m => m.played);

  let msg = `⚽ **${draw.name} — Daily Update**\n`;
  msg += `📅 ${today}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (upcoming.length) {
    msg += `🗓️ **Today's Fixtures:**\n`;
    for (const m of upcoming) {
      const h = teamsMap[m.homeTeam], a = teamsMap[m.awayTeam];
      if (!h || !a) continue;
      msg += `  ${h.flag} **${h.name}** vs ${a.flag} **${a.name}**\n`;
      msg += `  ⏰ ${m.kickoff} Irish time`;
      if (m.venue) msg += ` | ${m.venue}`;
      msg += `\n  📌 ${stageStr(m.stage)}\n\n`;
    }
  }

  if (results.length) {
    msg += `📊 **Today's Results:**\n`;
    for (const m of results) {
      const h = teamsMap[m.homeTeam], a = teamsMap[m.awayTeam];
      if (!h || !a) continue;
      const winner = m.homeScore > m.awayScore ? h.name : m.homeScore < m.awayScore ? a.name : null;
      const emoji  = winner ? '✅' : '🟡';
      msg += `  ${emoji} ${h.flag} ${h.name} **${m.homeScore}–${m.awayScore}** ${a.flag} ${a.name}`;
      msg += ` _(${winner ? winner + ' win' : 'Draw'})_\n`;
    }
    msg += '\n';
  }

  if (!upcoming.length && !results.length) {
    msg += `😴 **No World Cup matches today**\n\n`;
  }

  const rivalries = findRivalries(todayMatches, draw.users || [], teamsMap);
  if (rivalries.length) {
    msg += `⚔️ **Draw Clashes Today**\n`;
    for (const r of rivalries) {
      msg += `  ${r.homeOwners.join('/')} (${r.home.flag} ${r.home.name}) vs ${r.awayOwners.join('/')} (${r.away.flag} ${r.away.name}) · ${r.kickoff}\n`;
    }
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏆 **${draw.name} Standings**\n\n`;
  const medals = ['🥇','🥈','🥉'];
  for (let i = 0; i < leaderboard.length; i++) {
    const row = leaderboard[i];
    const s   = standings.find(st => st.user.id === row.id);
    const teamLine = (s?.teamBreakdown || []).map(tb => `${tb.team.flag}${tb.points}pts`).join(' ');
    msg += `${medals[i] || (i+1) + '.'} **${row.name}** — ${row.total} pts\n`;
    if (teamLine) msg += `    ${teamLine}\n`;
  }

  msg += `\nGood luck everyone! 🍀`;
  return msg;
}

module.exports = { sendDiscordMessage, buildGroupMessage, findRivalries };
