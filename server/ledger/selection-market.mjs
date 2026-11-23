/** Stable market GROUP identity. Quoted lines are alternatives within one provider market key.\n * Never group by translated names or generic marketType: those may describe different contracts. */
const marketGroupKey=value=>{
  const raw=String(value??'');
  return raw.match(/^(zz\d+)@/i)?.[1]??raw;
};
const identity=(match,key,selection)=>JSON.stringify([
  String(match),marketGroupKey(key),
  selection?.period??selection?.providerPeriod??''
]);

export function selectionMarketIdentity(selection) {
  const outcome = String(selection?.outcomeId ?? '').split('|');
  const market = String(selection?.marketId ?? '').split('|');
  const marketKey = selection?.marketKey ?? selection?.market_key;
  const isBuilder = outcome[0] === 'BB' || market[0] === 'BB' || String(marketKey ?? '').startsWith('BB:') ||
    String(outcome[1] ?? '').startsWith('BB:') || String(market[1] ?? '').startsWith('BB:');
  if (isBuilder && Array.isArray(selection?.builderLegs) && selection.builderLegs.length === 2) {
    const matchId = outcome[0] === 'BB' ? outcome[1] : outcome.length >= 4 ? outcome[0]
      : market[0] === 'BB' ? market[1] : selection.matchId ?? selection.match_id ?? market[0];
    // Builder options sharing the same two source market groups are alternatives,
    // even when one leg quotes a different numeric line.
    const legs = selection.builderLegs.map(leg => leg && typeof leg === 'object' ? selectionMarketIdentity({
      ...leg, matchId:leg.matchId ?? leg.match_id ?? matchId, builderLegs:undefined,
    }) : null);
    if (matchId != null && String(matchId) && legs.every(identity => identity !== null)) {
      return JSON.stringify([String(matchId), 'BB:markets', ...legs.sort()]);
    }
  }
  // Before server resolution the only trusted evidence is the saved template.
  if (outcome[0] === 'BB' && outcome.length >= 3 && outcome[1] && outcome[2]) {
    return JSON.stringify([outcome[1], `BB:${outcome[2]}`, '',selection?.period??'']);
  }
  if (outcome.length >= 4 && outcome[0] && outcome[1]) {
    return identity(outcome[0],outcome[1],selection);
  }
  // The resolver supplies authoritative fields, rather than browser metadata.
  const matchId = selection?.matchId ?? selection?.match_id;
  if (matchId != null && marketKey != null) {
    return identity(matchId,marketKey,selection);
  }
  if (market[0] === 'BB' && market.length >= 3 && market[1] && market[2]) {
    return JSON.stringify([market[1], `BB:${market[2]}`, '',selection?.period??'']);
  }
  if (market.length >= 3 && market[0] && market[1]) {
    return identity(market[0],market[1],selection);
  }
  if (selection?.matchId != null && selection?.marketId) {
    return identity(selection.matchId,selection.marketId,selection);
  }
  return null;
}

/** A logical slip may contain ONE outcome per match/provider market group.
 * Quoted lines (e.g. goal totals 1.5, 2.5, 3.5) are alternatives, not
 * independent picks. Different markets on the SAME match remain compatible.
 * Clicking another outcome REPLACES the previous one.
 * Historical columns already paid out remain intact in the database.
 */
export function toggleMarketSelection(previous, selection) {
  const sameOutcome = previous.some(pick => pick.outcomeId === selection.outcomeId);
  const identity = selectionMarketIdentity(selection);
  if (identity === null) {
    return sameOutcome
      ? previous.filter(pick => pick.outcomeId !== selection.outcomeId)
      : [...previous, selection];
  }
  const first = previous.findIndex(pick => selectionMarketIdentity(pick) === identity);
  // Remove all duplicate-market picks from an older client state as well.
  const remaining = previous.filter(pick => selectionMarketIdentity(pick) !== identity);
  if (sameOutcome) return remaining;
  if (first === -1) return [...remaining, selection];
  remaining.splice(Math.min(first,remaining.length), 0, selection);
  return remaining;
}

/** Guard the entire logical slip, including alternatives split into columns. */
export function assertDistinctSelectionMarkets(selections) {
  const seen = new Map();
  for (const selection of selections) {
    const identity = selectionMarketIdentity(selection);
    if (identity === null) continue; // The normal resolver rejects unidentified picks.
    const previous = seen.get(identity);
    // One selection per provider market group, including Corners markets.
    if (previous) {
      throw Object.assign(new Error('Lejohet vetëm një zgjedhje nga i njëjti grup tregu. Hiq zgjedhjen tjetër dhe provo përsëri.'), {
        status: 400, code: 'DUPLICATE_MARKET', outcomeId: selection.outcomeId,
      });
    }
    if (!previous) seen.set(identity, selection);
  }
}

/** Stable fixture identity shared by every market offered for the same match. */
export function selectionMatchIdentity(selection) {
  const outcome = String(selection?.outcomeId ?? '').split('|');
  const market = String(selection?.marketId ?? '').split('|');
  const explicit = selection?.matchId ?? selection?.match_id;
  const matchId = explicit ?? (outcome[0] === 'BB' ? outcome[1] :
    outcome.length >= 4 ? outcome[0] : market[0] === 'BB' ? market[1] :
    market.length >= 3 ? market[0] : null);
  return matchId == null || String(matchId).trim() === '' ? null : String(matchId);
}

/** Normal-player slip behavior: one pick for a fixture, across every market. */
export function toggleMatchSelection(previous, selection) {
  const sameOutcome = previous.some(pick => pick.outcomeId === selection.outcomeId);
  const matchId = selectionMatchIdentity(selection);
  if (matchId === null) return toggleMarketSelection(previous, selection);
  const first = previous.findIndex(pick => selectionMatchIdentity(pick) === matchId);
  const remaining = previous.filter(pick => selectionMatchIdentity(pick) !== matchId);
  if (sameOutcome) return remaining;
  if (first === -1) return [...remaining, selection];
  remaining.splice(Math.min(first, remaining.length), 0, selection);
  return remaining;
}

/** Backend guard for normal users; admin market-level rules remain unchanged. */
export function assertDistinctSelectionMatches(selections) {
  const seen = new Set();
  for (const selection of selections) {
    const matchId = selectionMatchIdentity(selection);
    if (matchId === null) continue;
    if (seen.has(matchId)) {
      throw Object.assign(new Error('Lejohet vetëm një zgjedhje për çdo ndeshje. Hiq zgjedhjen tjetër dhe provo përsëri.'), {
        status: 400, code: 'DUPLICATE_MATCH', outcomeId: selection.outcomeId,
      });
    }
    seen.add(matchId);
  }
}


const normalizedSelectionText = value => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const selectionMarketName = selection =>
  String(selection?.marketName ?? selection?.market_name ??
    selection?.nativeMarketName ?? selection?.native_market_name ?? '');

const selectionOutcomeName = selection =>
  String(selection?.outcomeName ?? selection?.outcome_name ??
    selection?.nativeOutcomeName ?? selection?.native_outcome_name ??
    selection?.outcomeCode ?? selection?.outcome_key ?? '');

const selectionPeriodScope = selection => {
  const title = normalizedSelectionText(selectionMarketName(selection));
  if (/\b(?:1st|first) half\b/.test(title)) return 'period:1';
  if (/\b(?:2nd|second) half\b/.test(title)) return 'period:2';
  const explicit = selection?.providerPeriod ?? selection?.provider_period ??
    selection?.period;
  if (explicit !== null && explicit !== undefined && explicit !== '') {
    return 'period:' + String(explicit);
  }
  return 'period:0';
};

function selectionMetric(selection) {
  const name = normalizedSelectionText(selectionMarketName(selection));
  const type = normalizedSelectionText(selection?.marketType ?? selection?.market_type);
  const marketKey = normalizedSelectionText(selection?.marketKey ?? selection?.market_key ?? '');
  const marketId = normalizedSelectionText(selection?.marketId ?? selection?.market_id ?? '');
  const marketText = [name, marketKey, marketId].join(' ');
  if (/\b(?:bet builder|same game combo|combo)\b/.test(name)) return null;
  if (/\b(?:corners?|corner kicks?|kendore|goditje kendore)\b/.test(name) || type === 'corners' || type === 'corner') return 'corners';
  if (/\b(?:cards?|bookings?|yellow card|red card|disciplin)\b/.test(name) ||
      type === 'cards' || type === 'card') return 'cards';
  if (/\b(?:shots? on target|on target shots?)\b/.test(name) || type === 'shots_on_target') return 'shots_on_target';
  if (/\b(?:shots?|attempts?)\b/.test(name) || type === 'shots') return 'shots';
  if (/\b(?:fouls?)\b/.test(name) || type === 'fouls' || type === 'foul') return 'fouls';
  if (/\b(?:offsides?|offside)\b/.test(name) || type === 'offsides') return 'offsides';
  if (/\b(?:throw ins?|throw ins)\b/.test(name) || type === 'throw_ins') return 'throw_ins';
  if (/\b(?:saves?|goalkeeper saves?)\b/.test(name) || type === 'saves') return 'saves';
  if (/\b(?:goals?|goal total)\b/.test(name) ||
      /(?:^|\s)(?:g|zz)?(?:home|away|total)?goals?(?:1h|2h|p1|p2)?(?:\s|$)/.test(marketText) ||
      ['goals','goal','total_goals'].includes(type)) return 'goals';
  return null;
}

/** Match the sportsbook's visible category taxonomy using untouched provider names. */
function isCornerSelection(selection) {
  // Do not use nullish precedence here. The normalized display title can be
  // generic ("Over/Under") while Zizobet's native title still identifies the
  // actual offer as a Corners market.
  const names = normalizedSelectionText([
    selection?.marketName, selection?.market_name,
    selection?.nativeMarketName, selection?.native_market_name,
    selection?.name, selection?.title
  ].filter(Boolean).join(' '));
  const types = normalizedSelectionText([
    selection?.marketType, selection?.market_type,
    selection?.nativeMarketType, selection?.native_market_type
  ].filter(Boolean).join(' '));
  const native = normalizedSelectionText([
    selection?.marketKey, selection?.market_key, selection?.extId, selection?.ext_id,
    selection?.nativeMarketId, selection?.native_market_id,
    selection?.outcomeId, selection?.marketId, selection?.market_id
  ].filter(Boolean).join(' '));
  // Provider keys, native titles, and translated display titles are all
  // independent evidence. Any one of them is sufficient to identify Corners.
  const cornerEvidence = /corner|kendore|kendet|goditje kendore/;
  return cornerEvidence.test(names) || cornerEvidence.test(types) ||
    cornerEvidence.test(native);
}

function selectionCategory(selection) {
  const name = normalizedSelectionText(selectionMarketName(selection));
  const type = normalizedSelectionText(selection?.marketType ?? selection?.market_type);
  // OddsButton sends outcomeId and marketId, not marketKey/extId. Zizobet's
  // native key (for example gCorners) is embedded in the pipe-delimited ID.
  // Extract it explicitly; normalizing the whole ID can otherwise leave a
  // generic "Over/Under" corner offer classified as Goals/Other.
  const outcomeParts = String(selection?.outcomeId ?? '').split('|');
  const marketParts = String(selection?.marketId ?? selection?.market_id ?? '').split('|');
  const embeddedMarketKey = outcomeParts.length >= 2 ? outcomeParts[1] :
    marketParts.length >= 2 ? marketParts[1] : '';
  const marketKey = normalizedSelectionText(selection?.marketKey ?? selection?.market_key ??
    selection?.extId ?? selection?.ext_id ?? embeddedMarketKey);
  const marketId = normalizedSelectionText(selection?.marketId ?? selection?.market_id ?? '');
  const categoryText = [name, marketKey, marketId].join(' ');
  if (/\b(?:bet builder|same game combo|combo)\b/.test(name)) return 'builder';
  if (/\bfull\s*time\s*result\s+goals\b|\bfulltime\s+result\s+goals\b/.test(name)) return 'result_goals';
  // Zizobet can label corner totals as generic Over/Under markets. Inspect
  // native market identifiers as well as the visible title before classifying.
  if (type === 'corners' || /(?:^|\s)(?:g|zz)?corners?(?:\s|$)|\bcorner kicks?\b|\bkendore\b|\bgoditje kendore\b/.test(categoryText)) return 'corners';
  if (type === 'cards' || /\bcards?\b|\bbookings?\b|yellow card|red card|disciplin/.test(categoryText)) return 'other';
  if (/\bplayers?\b|goalscorer|scorer|to be booked|player shots?/.test(categoryText)) return 'other';
  if (/\b(?:result|winner|1x2)\b.*\b(?:total|goals|btts|both teams)\b|\b(?:total|goals|btts)\b.*\b(?:both teams|btts)\b/.test(name)) return 'mixed';
  // All Goals markets share one fixture-level category, including full-time,
  // first/second-half, and home/away team goal totals. Period labels do not
  // make these separate combinable categories.
  if (selectionMetric(selection) === 'goals') return 'goals';
  if (/halftime\s*\/?\s*fulltime|half\s*time\s*\/\s*full\s*time|ht\s*\/\s*ft|\b(?:1st|2nd|first|second)\s+half\b|\bperiod\b/.test(name) ||
      Number(selection?.period ?? selection?.providerPeriod ?? 0) === 1 ||
      Number(selection?.period ?? selection?.providerPeriod ?? 0) === 2) return 'htft';
  if (/\b(?:1x2|match result|full time result|winner|double chance|draw no bet|moneyline|qualify|result)\b/.test(name) || type === '1x2') return 'main';
  if (type === 'over_under' || /\bgoals?\b|\btotal\b|over\s*\/?\s*under|both teams|btts|correct score|odd\s*\/\s*even/.test(name)) return 'goals';
  return 'other';
}

function isOverUnderChoice(selection) {
  const outcome = normalizedSelectionText(selectionOutcomeName(selection));
  const type = normalizedSelectionText(selection?.marketType ?? selection?.market_type);
  const name = normalizedSelectionText(selectionMarketName(selection));
  return /^(?:over|under)(?:\s|$)/.test(outcome) ||
    (type === 'over_under' && /\b(?:total|over under|over|under)\b/.test(name));
}

function isResultFamily(selection) {
  const name = normalizedSelectionText(selectionMarketName(selection));
  if (/\b(?:bet builder|same game combo)\b/.test(name) ||
      /\b(?:correct score|result btts|result and btts|result plus btts)\b/.test(name)) return false;
  return /\b(?:1x2|match result|full time result|match winner|winner|double chance|draw no bet|moneyline)\b/.test(name) ||
    normalizedSelectionText(selection?.marketType ?? selection?.market_type) === '1x2';
}

function isFullTimeResultGoalsMarket(selection) {
  const name = normalizedSelectionText(selectionMarketName(selection));
  return /\bfull\s*time\s*result\s+goals\b|\bfulltime\s+result\s+goals\b/.test(name);
}

function isSimpleGoalsTotal(selection) {
  const name = normalizedSelectionText(selectionMarketName(selection));
  return !isFullTimeResultGoalsMarket(selection) &&
    selectionMetric(selection) === 'goals' &&
    isOverUnderChoice(selection) &&
    selectionCategory(selection) === 'goals' &&
    !/\b(?:1st|first|2nd|second)\s+half\b/.test(name);
}

function isCorrectScoreFamily(selection) {
  const name = normalizedSelectionText(selectionMarketName(selection));
  return /\bcorrect score\b/.test(name) &&
    !/\brest of match\b/.test(name) &&
    !/\b(?:1st|first|2nd|second) half\b/.test(name);
}

function isUnderHalfGoals(selection) {
  if (selectionMetric(selection) !== 'goals' || !isOverUnderChoice(selection)) return false;
  const outcome = normalizedSelectionText(selectionOutcomeName(selection));
  if (!/^under(?:\s|$)/.test(outcome)) return false;
  const rawLine = String(selection?.marketLine ?? selection?.market_line ??
    selection?.line ?? selectionMarketName(selection).match(/\d+(?:\.\d+)?/)?.[0] ?? '')
    .trim().replace(',', '.');
  const parsedLine = rawLine.match(/\d+(?:\.\d+)?/)?.[0];
  return parsedLine === '0.5';
}

function isCorrectScoreZeroZero(selection) {
  if (!isCorrectScoreFamily(selection)) return false;
  const outcome = normalizedSelectionText(selectionOutcomeName(selection));
  return /^(?:0 0|0 0 exact|0 0 score)$/.test(outcome) ||
    /^(?:0|00)[-:]0$/.test(String(selectionOutcomeName(selection)).trim());
}

function isPrematchSelection(selection) {
  if (selection?.acceptedLiveSnapshot?.isLive === false ||
      selection?.accepted_live_snapshot?.is_live === false ||
      selection?.isLive === false) return true;
  const status = String(selection?.matchSnapshot?.status ??
    selection?.matchStatus ?? selection?.match_status ?? '').toUpperCase();
  return status === 'PREMATCH' || status === 'NOT_STARTED';
}

function isFirstGoalNoGoal(selection) {
  const market = normalizedSelectionText(selectionMarketName(selection));
  const outcome = normalizedSelectionText(selectionOutcomeName(selection));
  return /\b(?:first|1st) goal\b/.test(market) &&
    /^(?:no goal|none|no scorer|neither)$/.test(outcome);
}

function noGoalPrematchScenario(selection) {
  if (!isPrematchSelection(selection)) return false;
  return isUnderHalfGoals(selection) ||
    isCorrectScoreZeroZero(selection) ||
    isFirstGoalNoGoal(selection);
}

/** Returns a structured conflict for two selections from the same fixture.
 * Names are the original provider names; translations are never consulted.
 */
export function selectionConflict(first, second) {
  if (!first || !second) return null;
  if (first.outcomeId != null && second.outcomeId != null &&
      String(first.outcomeId) === String(second.outcomeId)) return null;
  const firstMatch = selectionMatchIdentity(first);
  const secondMatch = selectionMatchIdentity(second);
  if (firstMatch === null || secondMatch === null || firstMatch !== secondMatch) return null;
  const firstIsCorners = isCornerSelection(first);
  const secondIsCorners = isCornerSelection(second);

  const samePeriod = selectionPeriodScope(first) === selectionPeriodScope(second);
  const sameMarketGroup = selectionMarketIdentity(first) !== null &&
    selectionMarketIdentity(first) === selectionMarketIdentity(second);

  // Never allow two picks from the same provider market group, including
  // Corners lines. Different Corners market groups remain stackable.
  // Different Corners markets may combine with one another and with any
  // other market on the same fixture.
  if (firstIsCorners || secondIsCorners) return null;

  if ((isFullTimeResultGoalsMarket(first) && isSimpleGoalsTotal(second)) ||
      (isFullTimeResultGoalsMarket(second) && isSimpleGoalsTotal(first))) {
    return {
      code: 'RESULT_GOALS_TOTAL_CONFLICT',
      message: 'Full Time Result/Goals nuk mund të kombinohet me tregun e thjeshtë Goals për të njëjtën ndeshje.',
    };
  }

  // Explicit same-game combo exception: a main result market (1X2, Double
  // Chance, DNB, etc.) may be combined with full-time Goals Over/Under totals.
  if ((selectionCategory(first) === 'main' && isSimpleGoalsTotal(second)) ||
      (selectionCategory(second) === 'main' && isSimpleGoalsTotal(first))) return null;

  if ((isResultFamily(first) && isResultFamily(second)) ||
      (isCorrectScoreFamily(first) && isCorrectScoreFamily(second))) {
    return { code: 'RESULT_FAMILY', message: 'Rezultati, Double Chance, DNB dhe Correct Score nuk mund të kombinohen për të njëjtën ndeshje.' };
  }
  if ((isResultFamily(first) && isCorrectScoreFamily(second)) ||
      (isCorrectScoreFamily(first) && isResultFamily(second))) {
    return { code: 'RESULT_CORRELATION', message: 'Correct Score përcakton edhe rezultatin e ndeshjes; këto zgjedhje nuk mund të kombinohen.' };
  }

  const firstMetric = selectionMetric(first);
  const secondMetric = selectionMetric(second);
  if (samePeriod && firstMetric && firstMetric === secondMetric &&
      isOverUnderChoice(first) && isOverUnderChoice(second) &&
      !(firstIsCorners !== secondIsCorners)) {
    return { code: 'SAME_TOTAL_FAMILY', message: 'Lejohet vetëm një kuotë Over/Under për të njëjtën statistikë dhe pjesë të ndeshjes.' };
  }

  if (sameMarketGroup) {
    return { code: 'SAME_MARKET_GROUP', message: 'Lejohet vetëm një zgjedhje nga i njëjti treg.' };
  }

  if (noGoalPrematchScenario(first) && noGoalPrematchScenario(second)) {
    return { code: 'NO_GOAL_PREMATCH', message: 'Nën 0.5 gola, Correct Score 0:0 dhe First Goal: No Goal janë i njëjti skenar dhe nuk mund të kombinohen.' };
  }

  // Non-Corners selections retain the existing same-match restrictions.
  const firstCategory = selectionCategory(first);
  const secondCategory = selectionCategory(second);
  return {
    code: firstCategory === secondCategory ? 'SAME_MARKET_CATEGORY' : 'CORNER_REQUIRED',
    message: firstCategory === secondCategory
      ? 'Lejohet vetëm një bast nga e njëjta kategori tregu për të njëjtën ndeshje.'
      : 'Për të kombinuar dy zgjedhje nga e njëjta ndeshje, njëra duhet të jetë treg këndesh.',
  };
}

/** The first incompatibility between a candidate and the current betslip, if any. */
/** Return the first incompatible candidate/current-slip pair, with contextual exceptions. */
export function selectionConflictWithSlip(candidate, selections) {
  for (const existing of selections ?? []) {
    const conflict = selectionConflict(candidate, existing);
    if (conflict) return { ...conflict, existing };
  }
  return null;
}

/** Return the first incompatible pair already present in a slip. */
export function findSelectionConflict(selections) {
  const values = selections ?? [];
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const conflict = selectionConflict(values[i], values[j]);
      if (conflict) return { ...conflict, first: values[i], second: values[j] };
    }
  }
  return null;
}

/** Non-admin selection behavior: keep every offered market visible, but do
 * not add a quote that conflicts with an existing pick. Re-selecting a pick
 * removes it. No silent replacement of a different market is performed.
 */
export function toggleCompatibleSelection(previous, selection) {
  if (previous.some(pick => pick.outcomeId === selection.outcomeId)) {
    return previous.filter(pick => pick.outcomeId !== selection.outcomeId);
  }
  if (selectionConflictWithSlip(selection, previous)) return previous;
  return [...previous, selection];
}

/** Backend guard. Run on server-resolved offer rows as well as any early
 * structural check; client-supplied market labels are never authoritative.
 */
export function assertCompatibleSelections(selections) {
  const ids = new Set();
  for (const selection of selections ?? []) {
    const explicitId = selection?.outcomeId;
    const id = explicitId != null ? String(explicitId) : [
      selectionMatchIdentity(selection) ?? '',
      selection?.marketKey ?? selection?.market_key ?? selection?.marketId ?? '',
      selection?.line ?? selection?.marketLine ?? '',
      selection?.outcomeKey ?? selection?.outcome_key ?? selection?.outcomeName ?? ''
    ].join('|');
    if (id && ids.has(id)) {
      throw Object.assign(new Error('E njëjta zgjedhje nuk mund të shtohet dy herë në biletë.'), {
        status: 400, code: 'DUPLICATE_SELECTION', outcomeId: id,
      });
    }
    if (id) ids.add(id);
  }
  const conflict = findSelectionConflict(selections);
  if (!conflict) return;
  throw Object.assign(new Error(conflict.message), {
    status: 400,
    code: 'INCOMPATIBLE_SELECTIONS',
    outcomeId: conflict.second?.outcomeId,
    conflictingOutcomeId: conflict.first?.outcomeId,
    conflictCode: conflict.code,
  });
}
