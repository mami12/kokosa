/**
 * Multiscores and Matchbet & 1st Goal markets.
 */
export function isMultiscoresMarket(name = '') {
  return /^\s*multi\s*scores?\s*$/i.test(name);
}

export function gradeMultiscores(line, result) {
  const home = Number(result?.home_score);
  const away = Number(result?.away_score);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  const raw = String(line.outcome_name ?? line.outcome_key ?? '').trim();
  if (/\bother\b/i.test(raw)) return null;
  const pairs = [];
  const regex = /(\d+)\s*[:\-]\s*(\d+)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) {
    pairs.push([Number(m[1]), Number(m[2])]);
  }
  if (!pairs.length) return null;
  const matched = pairs.some(([h, a]) => h === home && a === away);
  return matched ? 'WON' : 'LOST';
}

export function isMatchbetFirstGoalMarket(name = '') {
  return /^\s*matchbet\s+and\s+1st\s+goal\s*$/i.test(name);
}

export function gradeMatchbetFirstGoal(line, result) {
  const home = Number(result?.home_score);
  const away = Number(result?.away_score);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  
  let first = null;
  if (home === 0 && away === 0) first = 'none';
  else if (home > 0 && away === 0) first = 'home';
  else if (home === 0 && away > 0) first = 'away';
  else if (result?.first_team_to_score) first = result.first_team_to_score;
  if (!first) return null;
  
  const matchResult = home > away ? '1' : away > home ? '2' : 'X';
  const raw = String(line.outcome_name ?? line.outcome_key ?? '').trim().toLowerCase();
  
  const m = raw.match(/^([12xX]|home|draw|away)\s+and\s+(home|away|none|no goal)$/i);
  if (!m) return null;
  
  const resCode = /^(?:1|home)$/i.test(m[1]) ? '1' : /^(?:2|away)$/i.test(m[1]) ? '2' : 'X';
  const firstSide = /^(?:none|no goal)$/i.test(m[2]) ? 'none' : /home/i.test(m[2]) ? 'home' : 'away';
  
  return (resCode === matchResult && firstSide === first) ? 'WON' : 'LOST';
}
