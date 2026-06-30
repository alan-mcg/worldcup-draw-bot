// points.js — calculates points for each draw independently

const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
function loadJSON(f) { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); }

function getTeamResults(teamId, matches) {
  const results = [];
  for (const m of matches) {
    if (!m.played || m.homeScore === null || m.awayScore === null) continue;
    const isHome = m.homeTeam === teamId;
    const isAway = m.awayTeam === teamId;
    if (!isHome && !isAway) continue;
    const ts = isHome ? m.homeScore : m.awayScore;
    const os = isHome ? m.awayScore : m.homeScore;
    const opponent = isHome ? m.awayTeam : m.homeTeam;
    const result = ts > os ? 'win' : ts < os ? 'loss' : 'draw';
    results.push({ matchId: m.id, date: m.date, stage: m.stage, opponent, teamScore: ts, oppScore: os, result });
  }
  return results;
}

function calcTeamPoints(teamId, matches, pointsConfig) {
  const results = getTeamResults(teamId, matches);
  let total = 0;
  for (const r of results) {
    const cfg = pointsConfig[r.stage];
    if (!cfg) continue;
    total += cfg[r.result] ?? 0;
  }
  return { total, results };
}

function calcDrawStandings(draw) {
  const matches      = loadJSON('matches.json');
  const teams        = loadJSON('teams.json');
  const pointsConfig = loadJSON('points_config.json');
  const teamsMap     = Object.fromEntries(teams.map(t => [t.id, t]));

  const standings = (draw.users || []).map(user => {
    let grandTotal = 0;
    let goalsScored = 0;
    const teamBreakdown = (user.teams || []).map(teamId => {
      const team = teamsMap[teamId];
      if (!team) return null;
      const { total, results } = calcTeamPoints(teamId, matches, pointsConfig);
      grandTotal += total;
      goalsScored += results.reduce((s, r) => s + (r.teamScore || 0), 0);
      return { team, points: total, results };
    }).filter(Boolean);
    return { user, teamBreakdown, grandTotal, goalsScored };
  }).sort((a, b) => b.grandTotal - a.grandTotal || b.goalsScored - a.goalsScored);

  return standings;
}

function buildLeaderboard(draw) {
  return calcDrawStandings(draw).map((s, i) => ({
    rank: i + 1,
    id: s.user.id,
    name: s.user.name,
    teams: s.teamBreakdown.map(t => `${t.team.flag} ${t.team.name} (${t.points}pts)`).join(', '),
    total: s.grandTotal,
    goalsScored: s.goalsScored
  }));
}

module.exports = { calcDrawStandings, buildLeaderboard, getTeamResults };
