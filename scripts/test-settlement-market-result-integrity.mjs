import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence,settledOddsFor,
 scorePeriodOf,pendingEventReason} from '../server/ledger/settler.mjs';
import {finishedResultParameters,isFinished} from '../server/ledger/results.mjs';
const score={home_team:'Manchester City',away_team:'Manchester United',
 home_score:3,away_score:1,half_home_score:0,half_away_score:1,
 corners_home:3,corners_away:2,cards_home:3,cards_away:2};
const choice=(market_name,outcome_name,opts={})=>({market_name,outcome_name,
 outcome_key:outcome_name,line:'',...opts});
const grade=(market,outcome,opts={})=>gradeLine(choice(market,outcome,opts),score);

// A 1H/2H provider period MUST never use the FT 3-1.
assert.equal(scorePeriodOf(choice('1X2','1',{period:1})),1);
assert.equal(grade('1X2','1',{period:1}),'LOST');
assert.equal(grade('1X2','2',{period:1}),'WON');
assert.equal(grade('1X2','1',{period:2}),'WON');
assert.equal(grade('Both Teams To Score','Yes',{period:1}),'LOST');
assert.equal(grade('Both Teams To Score','Yes',{period:2}),'LOST');
assert.equal(grade('Both Teams To Score','Yes',{period:0}),'WON');
assert.equal(grade('Double Chance','1X',{period:1}),'LOST');
assert.equal(grade('Double Chance','X2',{period:1}),'WON');
assert.equal(grade('Odd/Even','Odd',{period:1}),'WON');
assert.equal(grade('Odd/Even','Even',{period:0}),'WON');
assert.equal(grade('Correct Score','0:1',{period:1}),'WON');
assert.equal(grade('Correct Score','3:0',{period:2}),'WON');
assert.equal(grade('1X2','1',{period:3}),null);
assert.equal(grade('1st Half Result','1',{period:2}),null);
assert.equal(grade('1X2','1',{period:1}), 'LOST');
assert.equal(gradeLine(choice('1X2','1',{period:1}),{...score,half_home_score:null}),null);
assert.equal(gradeLine(choice('1X2','1',{period:2}),{...score,half_home_score:5}),null);
assert.equal(hasRequiredSettlementEvidence(choice('1X2','1'),{...score,home_score:null}),false);
assert.equal(gradeLine(choice('1X2','1'),{...score,home_score:null}),null);

// Half-only corners cannot be inferred from the final match corner total.
assert.equal(grade('Total Corners','Over',{period:1,line:'0.5'}),null);
assert.equal(grade('Corner Result 1X2','1',{period:1}),null);

// Verified Zizobet FT statistics remain authoritative even when the
// optional secondary-provider comparison has not produced a review row.
const chelseaPsg={...score,source:'ZIZOBET',home_team:'Chelsea Women',
 away_team:'Paris Saint-Germain Women',home_score:1,away_score:0,
 half_home_score:0,half_away_score:0,corners_home:10,corners_away:3,
 statistics_review_pending:true,statistics_review:null};
const cornerGrade=(market,outcome,line='')=>gradeLine(
 {...choice(market,outcome),line},chelseaPsg);
assert.equal(hasRequiredSettlementEvidence(choice('Total Corners','Over',{line:'12.5'}),chelseaPsg),true);
assert.equal(cornerGrade('Total Corners (12.5)','Over'),'WON',
 '13 verified Zizobet corners beats 12.5');
assert.equal(cornerGrade('Hometeam total corners (8.5)','Over'),'WON',
 'compact Hometeam label uses Chelsea 10, not total corners');
assert.equal(cornerGrade('Awayteam total corners (3.5)','Over'),'LOST',
 'compact Awayteam label uses PSG 3, not total corners');
assert.equal(cornerGrade('Most corners','1'),'WON',
 'Most corners is a three-way corner winner market, not an unsupported total');
assert.equal(cornerGrade('Most corners','X'),'LOST');
assert.equal(cornerGrade('Most corners','2'),'LOST');

// Secondary-source review can still hold non-primary result rows.
const nonPrimaryPending={...chelseaPsg,source:'FEED'};
assert.equal(hasRequiredSettlementEvidence(choice('Total Corners','Over',{line:'12.5'}),nonPrimaryPending),false);

// Team-named clean sheet: Manchester City conceded 1; Man U conceded 3.
// Generic "Clean Sheet" cannot be allocated to an arbitrary team.
assert.equal(grade('Manchester City Clean Sheet','Yes'),'LOST');
assert.equal(grade('Manchester United Clean Sheet','No'),'WON');
assert.equal(grade('Clean Sheet','Yes'),null);
assert.equal(grade('Home and Away Clean Sheet','Yes'),null);
assert.equal(grade('1st half - Awayteam clean sheet','Yes'), 'WON',
 'First-half Awayteam clean sheet uses the away side of the verified HT score');
assert.equal(grade('1st half - Hometeam clean sheet','No'), 'WON',
 'First-half Hometeam clean sheet uses the verified HT score');
assert.equal(grade('2nd half - Awayteam clean sheet','No'), 'WON',
 'Second-half Awayteam clean sheet uses FT minus HT');
assert.equal(grade('2nd half - Hometeam clean sheet','Yes'), 'WON',
 'Second-half Hometeam clean sheet uses FT minus HT');
assert.equal(gradeLine(choice('Winning margin','Hometeam by 1'),{
 ...score,home_score:1,away_score:0
}), 'WON', 'Compact Hometeam winning-margin outcome resolves to the home side');
assert.equal(gradeLine(choice('Winning margin','Awayteam by 1'),{
 ...score,home_score:0,away_score:1
}), 'WON', 'Compact Awayteam winning-margin outcome resolves to the away side');
assert.equal(grade('Awayteam Odd/Even','Odd'), 'WON',
 'Awayteam odd/even is based on the away score');
assert.equal(grade('Hometeam Odd/Even','Odd'), 'WON',
 'Hometeam odd/even is based on the home score');

const multiscoreCatalogue=[
 '1:0','2:0','2:1','3:0','3:1','3:2','X','Other home win',
 '0:1','0:2','1:2','0:3','1:3','2:3','Other away win'
].map(name=>({name}));
assert.equal(gradeLine({
 ...choice('Multiscores','X'),accepted_contract:{nativeMarketOutcomes:multiscoreCatalogue}
},{...score,home_score:2,away_score:2}), 'WON',
 'Multiscores X means any draw scoreline');
assert.equal(gradeLine({
 ...choice('Multiscores','Other home win'),accepted_contract:{nativeMarketOutcomes:multiscoreCatalogue}
},{...score,home_score:5,away_score:0}), 'WON',
 'Other home win applies outside the explicit accepted score catalogue');
assert.equal(gradeLine({
 ...choice('Multiscores','Other home win'),accepted_contract:{nativeMarketOutcomes:multiscoreCatalogue}
},{...score,home_score:3,away_score:1}), 'LOST',
 'A listed scoreline is not an Other home win');
assert.equal(gradeLine({
 ...choice('Multiscores','Other away win'),accepted_contract:{nativeMarketOutcomes:multiscoreCatalogue}
},{...score,home_score:0,away_score:4}), 'WON',
 'Other away win applies outside the explicit accepted score catalogue');
assert.equal(gradeLine(choice('Multiscores','Other home win'),{
 ...score,home_score:5,away_score:0
}), null, 'Other without the accepted provider catalogue remains ungraded');

// A DNB code that is not 1 or 2 cannot be silently interpreted as LOST.
assert.equal(grade('Draw No Bet','Mystery'),null);
assert.equal(gradeLine(choice('Draw No Bet','Mystery'),{...score,home_score:1,away_score:1}),null);
const draw={...score,home_score:1,away_score:1,half_home_score:1,half_away_score:1};
assert.equal(gradeLine(choice('Draw No Bet','1'),draw),'WON');
assert.equal(settledOddsFor(choice('Draw No Bet','1'),draw,'WON'),1);
assert.equal(settledOddsFor(choice('Draw No Bet','Mystery'),draw,null),null);
assert.equal(settledOddsFor(choice('Draw No Bet','1'),score,'WON'),null);
assert.equal(gradeLine(choice('Draw No Bet','2',{period:1}),draw),'WON');
assert.equal(settledOddsFor(choice('Draw No Bet','2',{period:1}),draw,'WON'),1);
assert.equal(settledOddsFor(choice('Draw No Bet first half','2'),draw,'WON'),1);
assert.equal(settledOddsFor(choice('1st half - Draw no bet','2'),draw,'WON'),1);
assert.equal(gradeLine(choice('Draw No Bet first half','2'),score),'WON');
assert.equal(gradeLine(choice('Draw No Bet first half','1'),score),'LOST');
assert.equal(grade('Draw No Bet + BTTS','1'),null);

// Corners 4+ means four OR MORE, not exactly four. The legacy norm()
// erased '+' before detecting a lower-bound selection.
assert.equal(grade('Exact Corners','4+'),'WON');
assert.equal(grade('Exact Corners','5'),'WON');
assert.equal(grade('Exact Corners','4'),'LOST');
assert.equal(grade('Exact Corners','6+'),'LOST');
assert.equal(grade('Exact Corners','4 or more'),'WON');

// A missing red count is unknown, NOT zero, for either team.
const raw={match_id:99,home:'Home',away:'Away',home_score:2,away_score:1,
 score_at:'2026-11-11T20:00:00Z',stats:{
  home:{yellow:3,corners:5},away:{yellow:1,red:0,corners:4}}};
let params=finishedResultParameters(raw);
assert.equal(params[7],null,'Home yellow+red cannot be computed from yellow alone');
assert.equal(params[8],1);
params=finishedResultParameters({...raw,stats:{home:{yellow:3,red:0,corners:5},
 away:{yellow:1,red:0,corners:4}}});
assert.equal(params[7],3);
assert.equal(params[8],1);
params=finishedResultParameters({...raw,stats:{
 home:{yellow:1,red:0,corners:10,corners2H:6},
 away:{yellow:0,red:0,corners:3,corners2H:1}
}});
const cornerPeriods=JSON.parse(params[11]).cornerPeriods;
assert.deepEqual(cornerPeriods,{
 firstHalf:{home:4,away:2},secondHalf:{home:6,away:1},
 fullTime:{home:10,away:3},source:'ZIZOBET'
},'Zizobet 2H corner counters plus FT counters must reconstruct both halves');
params=finishedResultParameters({...raw,stats:{
 home:{yellow:1,red:0,corners:10,cornersHT:4},
 away:{yellow:0,red:0,corners:3,cornersHT:2}
}});
assert.deepEqual(JSON.parse(params[11]).cornerPeriods,{
 firstHalf:{home:4,away:2},secondHalf:{home:6,away:1},
 fullTime:{home:10,away:3},source:'ZIZOBET'
},'Zizobet HT corner counters plus FT counters must reconstruct both halves');
const finishedFrame={raw:{provider:'ZIZOBET'},feed_status:'FT',score_at:'2026-11-11T20:00:00Z',home_score:1,away_score:1};
assert.equal(isFinished(finishedFrame),true);
assert.equal(isFinished({...finishedFrame,raw:{provider:'FOTMOB'}}),false,
 'A secondary final-score frame must never qualify for settlement');
for(const status of ['After penalties','Penalties','Extra time','After match','Penalty shootout']){
 assert.equal(isFinished({...finishedFrame,feed_status:status}),false,
  status+' score could be non-regulation and must not settle 90m bets');
}

// Same fixture result and same quoted market/line must produce one
// deterministic answer for every ticket, regardless of which account or
// ticket row carries it. A 5-0 FT cannot make Over 2.5 both WON and LOST.
const blowout={...score,home_team:'Home FC',away_team:'Away FC',
 home_score:5,away_score:0,half_home_score:2,half_away_score:0};
for(const threshold of ['2.5','3.5','4.5']){
 assert.equal(gradeLine(choice('Total Goals','Over',{line:threshold}),blowout),'WON',
  'FT Over '+threshold+' is WON for 5-0');
 assert.equal(gradeLine(choice('Total Goals','Under',{line:threshold}),blowout),'LOST',
  'FT Under '+threshold+' is LOST for 5-0');
}
assert.equal(gradeLine(choice('Total Goals','Over',{line:'2.5',period:1}),blowout),'LOST',
 '1H Over 2.5 uses 2-0 at HT, not the 5-0 FT');
assert.equal(gradeLine(choice('Total Goals','Under',{line:'2.5',period:1}),blowout),'WON');
assert.equal(gradeLine(choice('Total Goals','Over',{line:'2.5',period:2}),blowout),'WON',
 '2H Over 2.5 uses FT minus HT: 3-0');
assert.equal(gradeLine(choice('Home Team Total Goals','Over',{line:'2.5'}),blowout),'WON');
assert.equal(gradeLine(choice('Away Team Total Goals','Over',{line:'0.5'}),blowout),'LOST');


const denmarkNorway={...score,home_team:'Denmark',away_team:'Norway',
 home_score:2,away_score:3,half_home_score:2,half_away_score:1};
for(const market of ['Full Time 1UP','Full Time 2UP','Full Time 3UP']){
 assert.equal(gradeLine(choice(market,'2'),denmarkNorway),null,
  market+' must use its frozen early-lead contract, never ordinary FT 1X2');
 assert.equal(gradeLine(choice(market,'X'),denmarkNorway),null,
  market+' draw requires the frozen native XUP contract');
}
for(const outcome of ['1','X','2']){
 const expected=outcome==='2'?'WON':'LOST';
 assert.equal(gradeLine(choice('3way',outcome),denmarkNorway),expected,
  'Bare 3way remains ordinary FT 1X2');
}


assert.equal(pendingEventReason({market_name:'Next Goal'},score),'NO_LIVE_CONTRACT',
 'an advanced quote without a frozen event contract must be diagnosed');
assert.equal(pendingEventReason({market_name:'Asian Handicap'},score),'NO_SETTLEMENT_RULE',
 'an unsupported market must expose the missing settlement rule');
assert.equal(pendingEventReason({market_name:'Next Goal'},null),'FINAL_RESULT_OR_LIVE_FACTS_UNVERIFIED');

console.log('PASS period-scoped score markets, DNB draw win at 1.00, clean sheets, exact bands, card unknowns');
