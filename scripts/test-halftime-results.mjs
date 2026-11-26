import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {HALFTIME_RESULT_SQL,extractConfirmedHalfTimeCandidate,
 persistHalfTimeCandidate} from '../server/ledger/halftime-results.mjs';
import {infoOf} from '../server/zizobet/normalize.mjs';
import {normalizeTeamStatistics} from '../server/match-statistics.mjs';
import {firstHalfScoreOnly,gradeAtVerifiedHalfTime,scorePeriodOf} from '../server/ledger/settler.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {snapshotRow} from '../server/ledger/match-snapshots.mjs';
import {deriveVerifiedSecondHalfStatistics} from '../server/ledger/results.mjs';
const observed='2026-11-11T20:45:30Z',status='2026-11-11T20:45:31Z';
const live={match_id:123,home:'Red FC',away:'Blue FC',home_score:2,away_score:1,
 periods_score:[{t1:2,t2:1}],feed_status:'HT',score_at:observed,
 feed_status_at:status,clock_at:'2026-11-11T20:45:32Z',raw:{provider:'ZIZOBET'}};
// Native Zizobet SetScores can report only one completed period at HT.
const feedMeta={statuses:new Map([['1_31','Half Time'],['1_30','1st half']])};
const htNative=infoOf({match_id:123,service:'LIVE'},
 {EventStatus:31,Score:'2:1',SetScores:['2:1']},feedMeta);
assert.deepEqual(htNative.periodsScore,[{t1:2,t2:1}]);
assert.equal(htNative.feedStatus,'Half Time');
const inPlay=infoOf({match_id:123,service:'LIVE'},
 {EventStatus:30,Score:'2:1',SetScores:['2:1']},feedMeta);
assert.equal(inPlay.periodsScore,undefined,
 'A single first-period value is not final before HT');
const candidate=extractConfirmedHalfTimeCandidate(live);
assert.equal(Date.parse(candidate.observedAt),Date.parse(live.clock_at),
 'HT confirmation uses the time of the provider clock snapshot, not frozen score/phase timestamps');
const secondPoll=extractConfirmedHalfTimeCandidate({...live,
 clock_at:'2026-11-11T20:45:38Z'});
assert.ok(Date.parse(secondPoll.observedAt)>Date.parse(candidate.observedAt),
 'A later unchanged 2:1 HT observation has a strictly newer independent snapshot time');
assert.equal(extractConfirmedHalfTimeCandidate({...live,clock_at:null}),null,
 'No new primary clock observation cannot confirm a repeated half-time score');
const persistedSnapshot=snapshotRow(live);
assert.equal(persistedSnapshot.clock_at,live.clock_at,
 'Durable match snapshots retain the match-info clock observation timestamp');

assert.deepEqual([candidate.home,candidate.away],[2,1]);
assert.equal(candidate.source,'ZIZOBET');
const withStats=extractConfirmedHalfTimeCandidate({...live,stats:{
 home:normalizeTeamStatistics({shots:10,shotsOnTarget:4,fouls:7,offsides:2,corners:6,yellow:1,red:0},{observedAt:status}),
 away:normalizeTeamStatistics({shots:5,shotsOnTarget:2,fouls:8,offsides:1,corners:4,yellow:2,red:0},{observedAt:status})
}});
assert.deepEqual(withStats.statistics,{
 shots:{home:10,away:5},shotsOnTarget:{home:4,away:2},fouls:{home:7,away:8},
 offsides:{home:2,away:1},corners:{home:6,away:4},yellow:{home:1,away:2},
 red:{home:0,away:0},cards:{home:1,away:2}
},'HT snapshot archives the cumulative first-half statistic counters');
assert.ok(HALFTIME_RESULT_SQL.includes('app_match_half_result'));
for(const phase of ['LIVE','PREMATCH','1H','']){
 assert.equal(extractConfirmedHalfTimeCandidate({...live,feed_status:phase}),null);
}
assert.equal(extractConfirmedHalfTimeCandidate({...live,raw:{provider:'YBETS'}}),null);
assert.equal(extractConfirmedHalfTimeCandidate({...live,raw:{provider:'FOTMOB'}}),null);
assert.equal(extractConfirmedHalfTimeCandidate({...live,home_score:3}),null,
 'At HT, current score and confirmed first period must agree');
assert.equal(extractConfirmedHalfTimeCandidate({...live,
 feed_status_at:'2026-11-11T20:50:00Z'}),null,'reject stale half time scores');
assert.equal(extractConfirmedHalfTimeCandidate({...live,feed_status:'2H',
 home_score:3,away_score:1}),null,'a later 2H snapshot cannot establish the cutoff for live bets placed after HT');
assert.equal(extractConfirmedHalfTimeCandidate({...live,feed_status:'FT',
 home_score:3,away_score:1}),null,'an FT snapshot cannot be backdated as the HT transition');
const half={home_team:'Red FC',away_team:'Blue FC',half_home_score:2,
 half_away_score:1,confirmed_at:'2026-11-11T20:46:00Z',statistics:withStats.statistics};
const pick=(market_name,outcome_name,opts={})=>({
 market_name,outcome_name,outcome_key:outcome_name,period:1,
 line:'',...opts
});
const check=(line,expected)=>assert.equal(gradeAtVerifiedHalfTime(line,half),expected,
 JSON.stringify(line));
check(pick('1st half - Total Goals','Over',{line:'2.5'}),'WON');
check(pick('1st half - Total Shots','Over',{line:'14.5'}),'WON');
check(pick('1st half - Total Shots on Target','Over',{line:'5.5'}),'WON');
check(pick('1st half - Total Fouls','Over',{line:'14.5'}),'WON');
check(pick('1st half - Total Offsides','Over',{line:'2.5'}),'WON');
check(pick('1st half - Total Corners','Over',{line:'9.5'}),'WON');
check(pick('1st half - Total Cards','Over',{line:'2.5'}),'WON');
check(pick('1st half - Total Goals','Under',{line:'2.5'}),'LOST');
check(pick('1st half - Result','1'),'WON');
check(pick('1st half - Result','2'),'LOST');
check(pick('Halftime - 3way','1'),'WON');
check(pick('1st half - Correct score','2:1'),'WON');
check(pick('1st half - Correct score','0:0'),'LOST');
check(pick('1st half - Both teams to score','Yes'),'WON');
check(pick('1st half - Double chance','X2'),'LOST');
check(pick('Draw No Bet first half','1'),'WON');
check(pick('1st half - Total Goals','Over',{line:'3.0'}),'VOID');
const noEvidence={...half,confirmed_at:null};
const acceptedAfterHT={...pick('1st half - Result','1'),
 placed_at:'2026-11-11T20:46:00Z'};
const priorHT={...half,first_seen_at:'2026-11-11T20:45:40Z'};
assert.equal(gradeAtVerifiedHalfTime(acceptedAfterHT,priorHT),null,
 'A bet accepted after known HT cannot auto-grade from that known past result');
assert.equal(gradeAtVerifiedHalfTime({...acceptedAfterHT,
 placed_at:'2026-11-11T20:40:00Z'},priorHT),'WON');
assert.equal(gradeAtVerifiedHalfTime(pick('1st half - Result','1'),noEvidence),null);
const frozen=pick('1X2','1',{period:undefined,
 accepted_contract:{providerPeriod:1}});
assert.equal(scorePeriodOf(frozen),1);
assert.equal(gradeAtVerifiedHalfTime(frozen,half),'WON');
assert.equal(gradeAtVerifiedHalfTime(pick('1X2','1',{period:0}),half),null);
for(const line of [
 pick('Full Time Result','1',{period:0}),
 pick('HT/FT','1/1'),
 pick('2nd half - Result','1',{period:2}),
 pick('Both teams to score in both halves','Yes'),
 pick('1st half - Exact cards','3'),
 pick('First corner','1'),
 pick('Anytime goalscorer','Yes')
]){
 assert.equal(firstHalfScoreOnly(line),false,'Other scopes require different evidence: '+line.market_name);
 assert.equal(gradeAtVerifiedHalfTime(line,half),null);
}
let sql='',args;
const firstPending=await persistHalfTimeCandidate(withStats,{execute:async(q,p)=>{
 sql=q;args=p;return {rowCount:1,rows:[{confirmed_at:null,correction_count:0}]};
}});
assert.equal(firstPending.confirmed,false,'One HT sample cannot confirm a financial cutoff');
assert.match(sql,/excluded\.observed_at>app_match_half_result\.observed_at/);
assert.match(sql,/confirmed_at=case/);
assert.match(sql,/interval '5 seconds'/);
assert.match(sql,/first_seen_at=case/);
assert.match(sql,/else null end/);
assert.equal(args[0],123);
assert.equal(JSON.parse(args[7]).shots.home,10,'persisted HT statistics use the new durable JSON argument');

// Exercise the actual PostgreSQL upsert: first observation pending, unchanged
// observation after five seconds confirmed, corrected signature pending again.
const halftimeDb=new PGlite();
try{
 await halftimeDb.exec(HALFTIME_RESULT_SQL);
 const persist=candidate=>persistHalfTimeCandidate(candidate,{
  execute:(query,params)=>halftimeDb.query(query,params)
 });
 const first=await persist(withStats);
 assert.equal(first.stored,true);
 assert.equal(first.confirmed,false);
 const later={...withStats,observedAt:new Date(Date.parse(withStats.observedAt)+6000).toISOString()};
 const confirmed=await persist(later);
 assert.equal(confirmed.confirmed,true,'Two independent matching HT samples at least five seconds apart confirm');
 const correction={...later,signature:'corrected-ht-signature',
  observedAt:new Date(Date.parse(later.observedAt)+6000).toISOString()};
 const reset=await persist(correction);
 assert.equal(reset.confirmed,false,'A corrected HT score resets the confirmation window');
 assert.equal(reset.corrections,1);
 const stored=(await halftimeDb.query(
  'select first_seen_at,signature_first_seen_at,confirmed_at,correction_count from app_match_half_result where match_id=$1',[123]
 )).rows[0];
 assert.equal(new Date(stored.first_seen_at).toISOString(),withStats.observedAt,
  'A score correction must not move the original 1H betting cutoff');
 assert.equal(new Date(stored.signature_first_seen_at).toISOString(),correction.observedAt,
  'The corrected HT signature starts a new verification interval');
 assert.equal(stored.confirmed_at,null);

 // A pre-existing legacy/unverified row with an old first_seen_at must not
 // count as the first Zizobet observation for the new two-snapshot rule.
 const oldObserved=new Date(Date.parse(withStats.observedAt)-30000).toISOString();
 const oldFirstSeen=new Date(Date.parse(oldObserved)-3600000).toISOString();
 await halftimeDb.query(
  'insert into app_match_half_result(match_id,home_team,away_team,half_home_score,half_away_score,signature,first_seen_at,signature_first_seen_at,observed_at,source) values($1,$2,$3,$4,$5,$6,$7::timestamptz,$7::timestamptz,$8::timestamptz,\'UNVERIFIED_LEGACY\')',
  [124,withStats.homeTeam,withStats.awayTeam,withStats.home,withStats.away,withStats.signature,oldFirstSeen,oldObserved]
 );
 const firstZizobet=await persist({...withStats,matchId:124});
 assert.equal(firstZizobet.confirmed,false,
  'Legacy first_seen_at cannot bypass the two independent Zizobet observations');
 const legacyRow=(await halftimeDb.query(
  'select first_seen_at,signature_first_seen_at,confirmed_at from app_match_half_result where match_id=$1',[124]
 )).rows[0];
 assert.equal(new Date(legacyRow.first_seen_at).toISOString(),withStats.observedAt);
 assert.equal(new Date(legacyRow.signature_first_seen_at).toISOString(),withStats.observedAt);
 assert.equal(legacyRow.confirmed_at,null);
 const secondZizobet=await persist({...withStats,matchId:124,
  observedAt:new Date(Date.parse(withStats.observedAt)+6000).toISOString()});
 assert.equal(secondZizobet.confirmed,true);
}finally{await halftimeDb.close();}

// A 2H counter may be derived only when the final and HT pairs have the same
// verified provider. FotMob FT minus Zizobet HT is not a valid 2H statistic.
const htStats={corners:{home:6,away:4}};
const mixed=deriveVerifiedSecondHalfStatistics(
 {source:'ZIZOBET'},
 {statistics:{corners:{home:17,away:9}},
  _settlementSources:{corners:[{provider:'fotmob'}]}},
 htStats
);
assert.deepEqual(mixed,{});
const sameSource=deriveVerifiedSecondHalfStatistics(
 {source:'ZIZOBET'},
 {statistics:{corners:{home:17,away:9}},
  _settlementSources:{corners:['ZIZOBET']}},
 htStats
);
assert.deepEqual(sameSource,{corners:{home:11,away:5}});
assert.deepEqual(deriveVerifiedSecondHalfStatistics(
 {source:'ADMIN'},
 {statistics:{corners:{home:17,away:9}},_settlementSources:{corners:['ADMIN']}},
 htStats
),{},'Manual FT totals cannot be mixed with Zizobet HT evidence');
// First-half corners/cards use the actual verified PRIMARY chronology; the
// half-time score alone is insufficient to decide their event totals.
const facts=[
 {team:'home',minute:12,phase:'First Half',seconds:null},
 {team:'home',minute:25,phase:'First Half',seconds:null},
 {team:'away',minute:41,phase:'First Half',seconds:null}
];
const cornerContract={kind:'half-total',event:'corner',half:1,side:'home',
 choice:'over',threshold:1.5};
const verifiedCorner=async(sql)=>{
 if(sql.startsWith('with covered as'))return {rows:[{
  home:2,away:1,total:3,count_home:2,count_away:1,complete:false,
  through_minute:45,open_recovery_gap:false,card_colors_verified:false,
  confirmed_at:'2026-11-11T20:46:00Z',observed_at:'2026-11-11T20:47:00Z',
  second_poll_at:'2026-11-11T20:47:00Z'
 }]};
 if(sql.includes('from app_match_half_result'))return {rows:[{
   confirmed_at:'2026-11-11T20:46:30Z'
 }]};
 if(sql.includes('select minute,seconds,team,phase,card_color'))return {rows:facts};
 throw Error('Unexpected query '+sql);
};
assert.equal(await gradeStoredEventContract({id:'a',match_id:123,live_contract:cornerContract},
 null,{execute:verifiedCorner}),'WON',
 '1H corner contract can settle from the confirmed HT primary chronology');
const noHT=async sql=>sql.includes('from app_match_half_result')?{rows:[]}:verifiedCorner(sql);
assert.equal(await gradeStoredEventContract({id:'a',match_id:123,live_contract:cornerContract},
 null,{execute:noHT}),null,'No HT confirmation => no 1H corner payout');

console.log('PASS HT-only grades 1st half at the recorded HT transition, rejects FT/2H and freezes real periods');
