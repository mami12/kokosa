/**
 * Multiscores and Matchbet & 1st Goal markets.
 */
export function isMultiscoresMarket(name = '') {
  return /^\s*multi(?:ple)?\s*(?:correct\s*)?scores?\s*$/i.test(name);
}

export function gradeMultiscores(line, result) {
  const home = Number(result?.home_score);
  const away = Number(result?.away_score);
  if (!Number.isSafeInteger(home) || home < 0 ||
      !Number.isSafeInteger(away) || away < 0) return null;
  const raw = String(line?.outcome_name ?? line?.outcome_key ?? '').trim();
  const label = raw.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim();
  if (/^(?:x|draw|tie)$/.test(label)) return home === away ? 'WON' : 'LOST';

  const pairs = [];
  const regex = /(\d+)\s*[:\-]\s*(\d+)/g;
  let m;
  while ((m = regex.exec(raw)) !== null) pairs.push([Number(m[1]), Number(m[2])]);
  if (pairs.length) return pairs.some(([h,a]) => h === home && a === away) ? 'WON' : 'LOST';

  const other = label.match(/^(?:other\s+)?(home|away)(?:\s+team)?\s+win$/);
  if (!other) return null;

  // "Other home/away win" means a winner outside the exact scores displayed
  // by this same provider market. Capture that menu when the ticket is accepted;
  // never guess a score list after the bookmaker has removed the market.
  const offered = line?.accepted_contract?.nativeMarketOutcomes ??
    line?.nativeMarketOutcomes;
  if (!Array.isArray(offered) || offered.length === 0 || offered.length > 500) return null;
  const excluded = [];
  for (const item of offered) {
    const option = String(item?.outcomeName ?? item?.nativeOutcomeName ??
      item?.outcomeKey ?? item?.nativeOutcomeKey ?? '').trim();
    const match = option.match(/^(\d+)\s*[:\-]\s*(\d+)$/);
    if (match) excluded.push([Number(match[1]), Number(match[2])]);
  }
  if (!excluded.length) return null;
  const actualIsWinner = other[1] === 'home' ? home > away : away > home;
  if (!actualIsWinner) return 'LOST';
  return excluded.some(([h,a]) => h === home && a === away) ? 'LOST' : 'WON';
}

export function isMatchbetFirstGoalMarket(name = '') {
  const n = String(name).trim();
  return /^\s*(?:matchbet\s+(?:and|&)\s+1st\s+goal|first\s+goal\s+(?:and|&)\s+match\s+result|1st\s+goal\s+(?:and|&)\s+match\s+result|match\s+result\s+(?:and|&)\s+(?:1st|first)\s+goal|(?:1st|first)\s+goal\s+(?:and|&)\s+result)\s*$/i.test(n);
}

export function gradeMatchbetFirstGoal(line, result) {
  const home = Number(result?.home_score);
  const away = Number(result?.away_score);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  
  let first = null;
  if (home === 0 && away === 0) {
    first = 'none';
  } else if (home > 0 && away === 0) {
    first = '1';
  } else if (home === 0 && away > 0) {
    first = '2';
  } else {
    const rawFirst = result?.first_team_to_score ?? result?.stats?.first_goal?.team ?? result?.statistics?.first_goal?.team;
    if (rawFirst != null) {
      if (rawFirst === 1 || rawFirst === '1' || String(rawFirst).toLowerCase() === 'home') first = '1';
      else if (rawFirst === 2 || rawFirst === '2' || String(rawFirst).toLowerCase() === 'away') first = '2';
    }
  }
  if (!first) return null;
  
  const matchResult = home > away ? '1' : away > home ? '2' : 'X';
  const raw = String(line.outcome_name ?? line.outcome_key ?? '').trim().toLowerCase();

  if (/^(?:no\s+goal|none|pa\s+gola)$/i.test(raw)) {
    return (first === 'none') ? 'WON' : 'LOST';
  }

  // Format: "1st goal 1 / Result 1", "1st goal 2 / Result X"
  const slashM = raw.match(/(?:1st|first)\s*goal\s*([12]|home|away)\s*[/\\|]\s*result\s*([12xX]|home|draw|away)/i);
  if (slashM) {
    const pickFirst = /^(?:1|home)$/i.test(slashM[1]) ? '1' : '2';
    const pickRes = /^(?:1|home)$/i.test(slashM[2]) ? '1' : /^(?:2|away)$/i.test(slashM[2]) ? '2' : 'X';
    return (pickFirst === first && pickRes === matchResult) ? 'WON' : 'LOST';
  }

  // Reverse format: "Result 1 / 1st goal 1"
  const revM = raw.match(/result\s*([12xX]|home|draw|away)\s*[/\\|]\s*(?:1st|first)\s*goal\s*([12]|home|away)/i);
  if (revM) {
    const pickRes = /^(?:1|home)$/i.test(revM[1]) ? '1' : /^(?:2|away)$/i.test(revM[1]) ? '2' : 'X';
    const pickFirst = /^(?:1|home)$/i.test(revM[2]) ? '1' : '2';
    return (pickFirst === first && pickRes === matchResult) ? 'WON' : 'LOST';
  }
  
  const m = raw.match(/^([12xX]|home|draw|away)\s+(?:and|&)\s+(home|away|none|no goal|1|2)$/i);
  if (m) {
    const resCode = /^(?:1|home)$/i.test(m[1]) ? '1' : /^(?:2|away)$/i.test(m[1]) ? '2' : 'X';
    const firstSide = /^(?:none|no goal)$/i.test(m[2]) ? 'none' : /^(?:1|home)$/i.test(m[2]) ? '1' : '2';
    return (resCode === matchResult && firstSide === first) ? 'WON' : 'LOST';
  }
  
  return null;
}
