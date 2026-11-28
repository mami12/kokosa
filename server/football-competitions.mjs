/** Strict match whitelist and fixed display priority for the football board. */
export const normalizeCompetition = value => String(value ?? '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
/** Explicit virtual/video-game football markers, independent of league depth.
 * FIFA is also the real governing body: never ban a real World Cup simply
 * because its official name contains FIFA. Team age/gender suffixes are real.
 */
export function isSyntheticFootballMatch(match={}) {
  const tournament=match.tournament??{},category=tournament.category??match.category??{},raw=match.raw??match.rawData??{};
  const sport=match.sport??tournament.sport??category.sport??raw.sport??{};
  const explicitFlags=[
    match.isEsport,match.is_esport,match.isEsports,match.is_esports,match.is_e_sports,
    match.isElectronicSport,match.isElectronicSports,match.isSimulated,match.is_simulated,
    match.isVirtual,match.is_virtual,match.isSynthetic,match.is_synthetic,
    tournament.isEsport,tournament.is_esport,tournament.isEsports,tournament.is_esports,tournament.is_e_sports,
    tournament.isElectronicSport,tournament.isElectronicSports,tournament.isSimulated,tournament.isVirtual,
    category.isEsport,category.is_esport,category.isEsports,category.is_esports,category.is_e_sports,
    category.isElectronicSport,category.isElectronicSports,category.isSimulated,category.isVirtual,
    sport.isEsport,sport.is_esport,sport.isEsports,sport.is_esports,sport.is_e_sports,
    sport.isElectronicSport,sport.isElectronicSports,raw.isEsport,raw.is_esport,raw.isEsports,
    raw.is_esports,raw.isSimulated,raw.isVirtual,raw.isSynthetic,
  ];
  if(explicitFlags.some(value=>value===true)||match.is_real===false||raw.is_real===false)return true;

  const values=[
    match.tournament_name,match.tournamentName,tournament.name,tournament.tournament_name,
    match.category_slug,match.categorySlug,match.category_name,match.categoryName,
    category.slug,category.name,match.sport_name,match.sportName,match.sport_type,
    match.sportType,sport.name,sport.slug,sport.type,sport.discipline,
    tournament.sport_name,tournament.sportName,tournament.sport_type,
    category.sport_name,category.sportName,category.sport_type,
  ];
  const text=values.filter(value=>typeof value==='string'||typeof value==='number')
    .map(value=>normalizeCompetition(value)).filter(Boolean).join(' ');
  const competition=normalizeCompetition(match.tournament_name??match.tournamentName??tournament.name??'');
  // Explicit e-sport formats, virtual leagues and computer-generated matches.
  // This includes provider names such as eAdriatic, ePremier and eChampions,
  // without matching real EFL competitions or the real Eredivisie.
  if(/\b(?:e\s?soccer(?:battle)?|e\s?football(?:battle)?|e\s?sports?(?:battle)?|e\s?(?:basketball|hockey|tennis|cricket|racing|adriatic)|cyber\w*|virtual|simulat(?:ed|ion)|srl|replays?|ereplays?|ehighlights|video games?|computer games?|vsport|volta|fantasy|short football|h2h gg)\b/.test(text))return true;
  if(/\b(?:(?!european\b|english\b|eastern\b|euro\b)e[a-z]{4,}|e\s+(?!uropean\b|nglish\b|astern\b|uro\b)[a-z]{3,})\s+(?:league|cup|championship|tournament|series)\b/.test(text))return true;
  if(/\bfifa\s+e\s?(?:world|nations|club)\s+cup\b/.test(text))return true;
  const realFifa=/\bfifa(?:\s+\d{2}(?:\d{2})?)?\s+(?:(?:club|women s|womens|u\s?\d{2})\s+)?world cup\b|\bfifa(?:\s+\d{2}(?:\d{2})?)?\s+(?:world cup\s+)?(?:qualifiers?|qualifications?)\b/.test(competition);
  if(/\b(?:ea sports fc|ea fc)(?:\s*\d{2})?\b/.test(text)||(!realFifa&&/\bfifa\s*(?:1\d|2\d)\b/.test(text)))return true;
  if(!realFifa&&(/^(?:fifa|electronic(?: leagues?|sports?)?|e leagues?)(?:\s|$)/.test(text)||/^fifa$/.test(competition)))return true;
  const teams=[match.home??match.homeTeam,match.away??match.awayTeam]
    .filter(Boolean).map(team=>typeof team==='string'?team:team?.name??'').join(' ');
  if(/\((?:v|sim|srl|virtual|replay|replays|esports?)\)/i.test(teams))return true;
  return /\b2\s*x\s*(?:[1-9]|1[0-5])\s*(?:min(?:ute)?s?)?\b/i.test([competition,teams].join(' '));
}

const syntheticCategory = /^(?:cyber|ereplay|replay|virtual|crypto|computer|vsport|express|special|short-football)/;
const rules = [];
function addRule(scope, label, aliases = [], tier = null) {
  const names = [label, ...aliases].map(normalizeCompetition).filter(Boolean);
  rules.push({ rank: rules.length + 1, scope: scope === 'global' ? null : new Set(scope.map(normalizeCompetition)), label, names, tier });
}
addRule("global", "FIFA World Cup", ["World Cup"], null);
addRule("global", "FIFA Club World Cup", ["Club World Cup"], null);
addRule("global", "FIFA U-20 World Cup", ["FIFA U20 World Cup","FIFA U-20 World Cup","U20 World Cup","U-20 World Cup","Under 20 World Cup"], null);
addRule("global", "FIFA U-17 World Cup", ["FIFA U17 World Cup","FIFA U-17 World Cup","U17 World Cup","U-17 World Cup","Under 17 World Cup"], null);
addRule("global", "FIFA Women's World Cup", ["FIFA Women World Cup","FIFA Women's World Cup","Women's World Cup","Women World Cup"], null);
addRule("global", "UEFA Champions League", ["Champions League"], null);
addRule("global", "UEFA Europa League", ["Europa League"], null);
addRule("global", "UEFA Conference League", ["Conference League"], null);
addRule("global", "UEFA Super Cup", ["European Super Cup"], null);
addRule("global", "UEFA European Championship", ["European Championship","UEFA Euro","Euro"], null);
addRule("global", "UEFA Nations League", ["Nations League"], null);
addRule("global", "UEFA U-21 European Championship", ["UEFA U21 European Championship","U21 European Championship","European U21 Championship"], null);
addRule("global", "UEFA Youth League", [], null);
addRule("global", "Copa Libertadores", ["CONMEBOL Libertadores"], null);
addRule("global", "Copa Sudamericana", ["CONMEBOL Sudamericana"], null);
addRule("global", "Copa América", ["Copa America","CONMEBOL Copa America"], null);
addRule("global", "CAF Champions League", [], null);
addRule("global", "CAF Confederation Cup", [], null);
addRule("global", "Africa Cup of Nations", ["African Cup of Nations","AFCON"], null);
addRule("global", "AFC Champions League Elite", ["AFC Champions League"], null);
addRule("global", "AFC Asian Cup", ["Asian Cup"], null);
addRule("global", "CONCACAF Champions Cup", ["CONCACAF Champions League"], null);
addRule("global", "Gold Cup", ["CONCACAF Gold Cup"], null);
addRule(["england"], "Premier League", ["English Premier League"], 1);
addRule(["england"], "Championship", ["EFL Championship"], 2);
addRule(["england"], "League One", ["League 1","EFL League One"], 3);
addRule(["germany"], "Bundesliga", ["1 Bundesliga","1. Bundesliga"], 1);
addRule(["germany"], "2. Bundesliga", ["2 Bundesliga","2nd Bundesliga"], 2);
addRule(["germany"], "3. Liga", ["3 Liga","3rd Liga"], 3);
addRule(["spain"], "LaLiga", ["La Liga","Primera Division"], 1);
addRule(["spain"], "LaLiga 2", ["LaLiga2","La Liga 2","Segunda Division"], 2);
addRule(["spain"], "Primera Federación", ["Primera Federacion","Primera RFEF"], 3);
addRule(["italy"], "Serie A", [], 1);
addRule(["italy"], "Serie B", [], 2);
addRule(["italy"], "Serie C", ["Lega Pro"], 3);
addRule(["france"], "Ligue 1", ["League 1"], 1);
addRule(["france"], "Ligue 2", ["League 2"], 2);
addRule(["france"], "Ligue 3", ["League 3","National","Championnat National","National 1"], 3);
addRule(["netherlands"], "Eredivisie", [], 1);
addRule(["netherlands"], "Eerste Divisie", [], 2);
addRule(["portugal"], "Primeira Liga", ["Liga Portugal","Liga Portugal 1"], 1);
addRule(["portugal"], "Liga Portugal 2", ["Segunda Liga","Liga Portugal Segunda"], 2);
addRule(["turkey"], "Süper Lig", ["Super Lig","Super League"], 1);
addRule(["turkey"], "1. Lig", ["1 Lig","1 League"], 2);
addRule(["belgium"], "Pro League", ["Jupiler Pro League"], 1);
addRule(["belgium"], "Challenger Pro League", ["First Division B"], 2);
addRule(["scotland"], "Scottish Premiership", ["Premiership","Scotland Premiership"], 1);
addRule(["scotland"], "Scottish Championship", ["Championship","Scotland Championship"], 2);
addRule(["sweden"], "Allsvenskan", [], 1);
addRule(["sweden"], "Superettan", [], 2);
addRule(["denmark"], "Superliga", ["Superligaen"], 1);
addRule(["denmark"], "1. Division", ["1 Division","1st Division"], 2);
addRule(["norway"], "Eliteserien", [], 1);
addRule(["norway"], "1. divisjon", ["1 Divisjon","1st Division","OBOS Ligaen"], 2);
addRule(["austria"], "Bundesliga", [], 1);
addRule(["austria"], "2. Liga", ["2 Liga","2nd Liga"], 2);
addRule(["switzerland"], "Super League", [], 1);
addRule(["switzerland"], "Challenge League", [], 2);
addRule(["poland"], "Ekstraklasa", [], 1);
addRule(["poland"], "I liga", ["1 Liga","Division 1"], 2);
addRule(["greece"], "Super League 1", ["Super League"], 1);
addRule(["greece"], "Super League 2", [], 2);
addRule(["croatia"], "SuperSport HNL", ["HNL","1 HNL"], 1);
addRule(["croatia"], "Prva NL", ["1 NL"], 2);
addRule(["czechia","czech-republic"], "Chance Liga", ["First League","1 Liga"], 1);
addRule(["hungary"], "NB I", ["NB 1"], 1);
addRule(["romania"], "SuperLiga", ["Liga 1"], 1);
addRule(["serbia"], "SuperLiga", ["Super Liga"], 1);
addRule(["ukraine"], "Premier League", [], 1);
addRule(["bulgaria"], "First Professional League", ["Parva Liga","First League"], 1);
addRule(["slovakia"], "Niké Liga", ["Nike Liga","Super Liga"], 1);
addRule(["brazil"], "Brasileirão Série A", ["Brasileirao Serie A","Campeonato Brasileiro Serie A","Serie A"], 1);
addRule(["brazil"], "Brasileirão Série B", ["Brasileirao Serie B","Campeonato Brasileiro Serie B","Serie B"], 2);
addRule(["argentina"], "Liga Profesional", ["Liga Profesional de Futbol","Primera Division"], 1);
addRule(["argentina"], "Primera Nacional", [], 2);
addRule(["mexico"], "Liga MX", [], 1);
addRule(["mexico"], "Liga de Expansión MX", ["Liga de Expansion MX","Expansion MX","Liga de Ascenso"], 2);
addRule(["colombia"], "Categoría Primera A", ["Categoria Primera A","Primera A"], 1);
addRule(["colombia"], "Categoría Primera B", ["Categoria Primera B","Primera B"], 2);
addRule(["chile"], "Primera División", ["Primera Division","Liga de Primera"], 1);
addRule(["chile"], "Primera B", [], 2);
addRule(["uruguay"], "Primera División", ["Primera Division"], 1);
addRule(["uruguay"], "Segunda División", ["Segunda Division"], 2);
addRule(["ecuador"], "LigaPro Serie A", ["LigaPro Primera A","Serie A"], 1);
addRule(["ecuador"], "LigaPro Serie B", ["LigaPro Primera B","Serie B"], 2);
addRule(["egypt"], "Egyptian Premier League", ["Premier League"], 1);
addRule(["morocco"], "Botola Pro", ["Botola Pro 1"], 1);
addRule(["south-africa"], "Premier Division", ["Premiership","Premier League"], 1);
addRule(["algeria"], "Ligue 1", [], 1);
addRule(["tunisia"], "Ligue 1", [], 1);
addRule(["nigeria"], "NPFL", ["Premier League","Nigeria Premier League"], 1);
addRule(["ghana"], "Ghana Premier League", ["Premier League"], 1);
addRule(["saudi-arabia"], "Saudi Pro League", ["Professional League","Pro League"], 1);
addRule(["japan"], "J1 League", [], 1);
addRule(["republic-of-korea","south-korea","korea-republic"], "K League 1", ["K-League 1"], 1);
addRule(["china","china-pr"], "Chinese Super League", ["Super League"], 1);
addRule(["qatar"], "Qatar Stars League", ["Stars League"], 1);
addRule(["united-arab-emirates","uae"], "UAE Pro League", ["Pro League","Professional League"], 1);
addRule(["iran"], "Persian Gulf Pro League", ["Pro League"], 1);
addRule(["australia"], "A-League Men", ["A League Men","A League"], 1);

function nameMatches(name, aliases) {
  return aliases.some(alias => name === alias || (name.startsWith(alias + ' group ') && /^group [a-z0-9]+$/.test(name.slice(alias.length + 1))));
}
function countrySlugOf(tournament = {}, category = {}) {
  return normalizeCompetition(category.slug ?? tournament.category?.slug ?? tournament.categorySlug ?? '');
}
export function competitionDecision(tournament = {}, category = {}) {
  const country = countrySlugOf(tournament, category);
  const name = normalizeCompetition(tournament.name ?? tournament.tournament_name ?? tournament.tournamentName ?? '');
  if (!name) return { allowed: false, reason: 'not-configured', country, rank: null, tier: null };
  if (isSyntheticFootballMatch({ tournament, category }) || tournament.isEsport === true || syntheticCategory.test(country.replaceAll(' ', '-'))) {
    return { allowed: false, reason: 'synthetic', country, rank: null, tier: null };
  }
  if (/\b(?:outrights?|long term|singles only)\b/.test(name)) {
    return { allowed: false, reason: 'not-a-match', country, rank: null, tier: null };
  }
  const rule = rules.find(item => (!item.scope || item.scope.has(country)) && nameMatches(name, item.names));
  return rule ? { allowed: true, reason: 'configured', country, rank: rule.rank, tier: rule.tier, competition: rule.label }
    : { allowed: false, reason: 'not-configured', country, rank: null, tier: null };
}

/**
 * Attach the fixed rank to a provider row. Unlisted fixtures are omitted from
 * the public board; a watched, already-accepted ticket may retain an unranked
 * row solely for evidence capture and settlement.
 */
export function rankCompetitionRow(row, { allowUnlisted = false } = {}) {
  if (!row) return null;
  const categorySlug = row.category_slug ?? row.tournament?.category?.slug ?? '';
  const tournamentName = row.tournament_name ?? row.tournament?.name ?? '';
  const decision = competitionDecision(
    { ...(row.tournament ?? {}), ...row, name: tournamentName, categorySlug, tournament: row.tournament, category: row.category },
    { ...(row.category ?? {}), slug: categorySlug },
  );
  if (!decision.allowed) {
    return allowUnlisted ? { ...row, competition_rank: null } : null;
  }
  return { ...row, competition_rank: decision.rank };
}

export function competitionDisplayOrder(categorySlug, tournamentName) {
  const decision = competitionDecision({ name: tournamentName, categorySlug }, { slug: categorySlug });
  return decision.allowed ? decision.rank : null;
}

export function buildCompetitionPolicy(tournaments, categories) {
  return new Map([...tournaments].map(([id, tournament]) => [
    id, competitionDecision(tournament, categories.get(tournament.categoryId) ?? { slug: tournament.categorySlug }),
  ]));
}

export const isEuropeanFootballCountry = country => rules.some(rule => rule.scope?.has(normalizeCompetition(country)) && rule.tier != null);
export const competitionTierLimit = country => Math.max(0, ...rules.filter(rule => rule.scope?.has(normalizeCompetition(country))).map(rule => rule.tier ?? 0));
