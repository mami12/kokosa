const norm = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const methodOf = value => {
  const name = norm(value);
  if (/^(?:regular time|regulation time|regular|regulation)$/.test(name)) return 'regular-time';
  if (/^(?:overtime|extra time|extra time period)$/.test(name)) return 'overtime';
  if (/^(?:penalties|penalty|penalty shootout|shootout)$/.test(name)) return 'penalties';
  return null;
};

export function isWinningMethodMarket(name = '') {
  return /^winning\s+method$/i.test(String(name ?? '').trim());
}

export function parseWinningMethod(line = {}, teams = {}) {
  if (!isWinningMethodMarket(line.market_name ?? line.marketName)) return null;
  const outcome = String(line.outcome_name ?? line.outcome_key ?? '').trim();
  const match = outcome.match(/^(.*?)\s+(regular time|regulation time|overtime|extra time|penalties|penalty shootout)$/i);
  if (!match) return null;
  const label = norm(match[1]);
  const home = norm(teams.home ?? line.accepted_contract?.homeTeamName);
  const away = norm(teams.away ?? line.accepted_contract?.awayTeamName);
  const side = ['competitor 1','competitor1','home','home team','team 1','1'].includes(label) ||
    (home && label === home)
      ? 'home'
      : ['competitor 2','competitor2','away','away team','team 2','2'].includes(label) ||
        (away && label === away)
        ? 'away' : null;
  const method = methodOf(match[2]);
  return side && method ? { version: 1, kind: 'winning-method', side, method } : null;
}

/**
 * Winning Method describes how the tie as a whole was decided, not merely
 * the result of this leg. A final single-match score cannot prove it.
 * Only an explicitly verified Zizobet tie-winner/method observation is used.
 */
export function gradeWinningMethod(line, result) {
  const contract = parseWinningMethod(line, {
    home: result?.home_team,
    away: result?.away_team
  });
  if (!contract || String(result?.source ?? '').toUpperCase() !== 'ZIZOBET') return null;
  const evidence = result?.statistics?.winningMethod ?? result?.statistics?.winning_method;
  if (!evidence || evidence.verified !== true ||
      String(evidence.source ?? '').toUpperCase() !== 'ZIZOBET') return null;
  const winner = norm(evidence.winnerSide ?? evidence.tieWinner ?? evidence.winner);
  const home = norm(result?.home_team), away = norm(result?.away_team);
  const winnerSide = ['home','competitor1','team 1','1'].includes(winner) || (home && winner === home)
    ? 'home'
    : ['away','competitor2','team 2','2'].includes(winner) || (away && winner === away)
      ? 'away' : null;
  const method = methodOf(evidence.method);
  if (!winnerSide || !method) return null;
  return contract.side === winnerSide && contract.method === method ? 'WON' : 'LOST';
}
