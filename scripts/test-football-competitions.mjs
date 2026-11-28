import assert from 'node:assert/strict';
import { competitionDecision, competitionDisplayOrder, buildCompetitionPolicy, isSyntheticFootballMatch } from '../server/football-competitions.mjs';

const requested = [["world","FIFA World Cup"],["world","FIFA Club World Cup"],["world","FIFA U-20 World Cup"],["world","FIFA U-17 World Cup"],["world","FIFA Women's World Cup"],["europe","UEFA Champions League"],["europe","UEFA Europa League"],["europe","UEFA Conference League"],["europe","UEFA Super Cup"],["europe","UEFA European Championship"],["europe","UEFA Nations League"],["europe","UEFA U-21 European Championship"],["europe","UEFA Youth League"],["south-america","Copa Libertadores"],["south-america","Copa Sudamericana"],["south-america","Copa América"],["africa","CAF Champions League"],["africa","CAF Confederation Cup"],["africa","Africa Cup of Nations"],["asia","AFC Champions League Elite"],["asia","AFC Asian Cup"],["north-america","CONCACAF Champions Cup"],["north-america","Gold Cup"],["england","Premier League"],["england","Championship"],["england","League One"],["germany","Bundesliga"],["germany","2. Bundesliga"],["germany","3. Liga"],["spain","LaLiga"],["spain","LaLiga 2"],["spain","Primera Federación"],["italy","Serie A"],["italy","Serie B"],["italy","Serie C"],["france","Ligue 1"],["france","Ligue 2"],["france","Ligue 3"],["netherlands","Eredivisie"],["netherlands","Eerste Divisie"],["portugal","Primeira Liga"],["portugal","Liga Portugal 2"],["turkey","Süper Lig"],["turkey","1. Lig"],["belgium","Pro League"],["belgium","Challenger Pro League"],["scotland","Scottish Premiership"],["scotland","Scottish Championship"],["sweden","Allsvenskan"],["sweden","Superettan"],["denmark","Superliga"],["denmark","1. Division"],["norway","Eliteserien"],["norway","1. divisjon"],["austria","Bundesliga"],["austria","2. Liga"],["switzerland","Super League"],["switzerland","Challenge League"],["poland","Ekstraklasa"],["poland","I liga"],["greece","Super League 1"],["greece","Super League 2"],["croatia","SuperSport HNL"],["croatia","Prva NL"],["czechia","Chance Liga"],["hungary","NB I"],["romania","SuperLiga"],["serbia","SuperLiga"],["ukraine","Premier League"],["bulgaria","First Professional League"],["slovakia","Niké Liga"],["brazil","Brasileirão Série A"],["brazil","Brasileirão Série B"],["argentina","Liga Profesional"],["argentina","Primera Nacional"],["mexico","Liga MX"],["mexico","Liga de Expansión MX"],["colombia","Categoría Primera A"],["colombia","Categoría Primera B"],["chile","Primera División"],["chile","Primera B"],["uruguay","Primera División"],["uruguay","Segunda División"],["ecuador","LigaPro Serie A"],["ecuador","LigaPro Serie B"],["egypt","Egyptian Premier League"],["morocco","Botola Pro"],["south-africa","Premier Division"],["algeria","Ligue 1"],["tunisia","Ligue 1"],["nigeria","NPFL"],["ghana","Ghana Premier League"],["saudi-arabia","Saudi Pro League"],["japan","J1 League"],["republic-of-korea","K League 1"],["china","Chinese Super League"],["qatar","Qatar Stars League"],["united-arab-emirates","UAE Pro League"],["iran","Persian Gulf Pro League"],["australia","A-League Men"]];
assert.equal(requested.length, 100, 'the configured list contains the complete 100 requested competitions');
requested.forEach(([country, name], index) => {
  const decision = competitionDecision({ name }, { slug: country });
  assert.equal(decision.allowed, true, `${country}: ${name} must be allowed`);
  assert.equal(decision.rank, index + 1, `${country}: ${name} must keep the exact supplied order`);
  assert.equal(competitionDisplayOrder(country, name), index + 1);
});

const aliases = [
  ['england','League 1','League One'], ['germany','2nd Bundesliga','2. Bundesliga'],
  ['germany','3 Liga','3. Liga'], ['spain','Segunda Division','LaLiga 2'],
  ['france','National','Ligue 3'], ['italy','Lega Pro','Serie C'],
  ['turkey','Super Lig','Süper Lig'], ['turkey','1 League','1. Lig'],
  ['poland','1 Liga','I liga'], ['croatia','HNL','SuperSport HNL'],
  ['brazil','Serie A','Brasileirão Série A'], ['argentina','Primera Division','Liga Profesional'],
  ['south-africa','Premiership','Premier Division'], ['nigeria','Premier League','NPFL'],
  ['republic-of-korea','K-League 1','K League 1'], ['united-arab-emirates','Pro League','UAE Pro League'],
  ['australia','A League','A-League Men'],
];
for (const [country, alias, canonical] of aliases) {
  assert.equal(competitionDisplayOrder(country, alias), competitionDisplayOrder(country, canonical), `${country}: ${alias} is a provider alias`);
}

const denied = [
  ['england','League Two'], ['england','National League'], ['germany','Regionalliga'],
  ['spain','Segunda División B'], ['italy','Serie D'], ['france','Ligue 4'],
  ['netherlands','Tweede Divisie'], ['portugal','Liga 3'], ['turkey','2. Lig'],
  ['scotland','League One'], ['sweden','Ettan'], ['japan','J2 League'],
  ['republic-of-korea','K League 2'], ['brazil','Brasileirão Série C'],
  ['argentina','Primera B'], ['mexico','Liga Premier'], ['egypt','Second Division'],
  ['usa','MLS'], ['england','FA Cup'], ['world','Club Friendlies'],
  ['world','World Cup Qualification'], ['asia','AFC Champions League Two'],
  ["europe","UEFA Women's Champions League"], ['world','Virtual Champions League'],
  ['cyberfifa','Premier League'], ['england','Premier League. Long-term bets (Singles only)'],
];
for (const [country, name] of denied) {
  assert.equal(competitionDecision({ name }, { slug: country }).allowed, false, `${country}: ${name} must be excluded`);
}

const policy = buildCompetitionPolicy(
  new Map([[101,{id:101,name:'Premier League',categoryId:1}],[102,{id:102,name:'League Two',categoryId:1}],[103,{id:103,name:'J1 League',categoryId:2}]]),
  new Map([[1,{slug:'england'}],[2,{slug:'japan'}]]),
);
assert.equal(policy.get(101).rank, 24);
assert.equal(policy.get(102).allowed, false);
assert.equal(policy.get(103).rank, 94);

// E-sports are excluded across provider naming variants, not just one league.
for (const name of [
  'eAdriatic League','ePremier League','eChampions League','eFootball Battle',
  'eSoccer World Cup','EA Sports FC 26','Cyber Football League','Virtual Football League','FIFA 24',
]) assert.equal(isSyntheticFootballMatch({ tournament_name: name }), true, name + ' must be excluded');
for (const flag of ['isEsport','is_esport','isEsports','is_esports','is_e_sports','isElectronicSport','isElectronicSports','isVirtual','isSimulated']) {
  assert.equal(isSyntheticFootballMatch({ [flag]: true, tournament_name: 'Premier League' }), true, flag + ' must exclude an explicitly marked e-sport/simulation');
}
assert.equal(isSyntheticFootballMatch({ tournament_name: 'EFL Championship', homeTeam: 'Leeds', awayTeam: 'Norwich' }), false,
  'real EFL football must remain eligible');
assert.equal(isSyntheticFootballMatch({ tournament_name: 'Eredivisie', homeTeam: 'Ajax', awayTeam: 'PSV' }), false,
  'the real Eredivisie must remain eligible');

console.log(`PASS competition filter and e-sports exclusion: ${requested.length} existing configured examples, ${denied.length} exclusions, broad provider flags and labels`);
