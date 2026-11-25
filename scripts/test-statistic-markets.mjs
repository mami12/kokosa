/** Isolated team-stat contracts, feed facts and durable final-stat regression. */
import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {createLocalPool} from '../server/local-database.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {decodePushMessage} from '../server/push-decode.mjs';
import {normalizeTeamStatistics,mergeTeamStats,teamStatisticsFromRow,verifiedFinalStatistics,trackerTeamStatistics} from '../server/match-statistics.mjs';
import {isStatisticMarket,statisticMarketContract,hasStatisticEvidence,gradeStatisticLine} from '../server/ledger/statistic-markets.mjs';
import {hasRequiredSettlementEvidence,gradeLine} from '../server/ledger/settler.mjs';
import {compareFinalStatistics,resolveSettlementStatistics,statisticsNeedReview,settlementStatisticFields} from '../server/ledger/settlement-review.mjs';
const {FINISHED_RESULT_INSERT,finishedResultParameters}=await import('../server/ledger/results.mjs');
const {createMatchSnapshotStore}=await import('../server/ledger/match-snapshots.mjs');
const {pool}=await import('../server/db.mjs');
const now=Date.now(),at=new Date(now).toISOString(),old=new Date(now-300000).toISOString();
const raw=normalizeTeamStatistics({shotsOnTarget:'3',shots:'9',foulsCommitted:'12',yellowCards:'0',redCards:'0',corners:'0',offTarget:6,freeKicks:20,attacks:90},{observedAt:at});
assert.equal(raw.shotsOnTarget,3);assert.equal(raw.shots,9);assert.equal(raw.fouls,12);assert.equal(raw.corners,0);assert.equal(raw.yellow,0);assert.equal(raw.freeKicks,undefined);assert.equal(raw.offTarget,undefined);
for(const invalid of [null,undefined,'',false,true,{},-1,1.5,Infinity])assert.equal(normalizeTeamStatistics({shotsOnTarget:invalid}).shotsOnTarget,undefined);
const first={home:normalizeTeamStatistics({shotsOnTarget:3,corners:0},{observedAt:old})};
const merged=mergeTeamStats(first,{home:{fouls:4,shotsOnTarget:null,corners:undefined}},{observedAt:at});
assert.equal(merged.home.shotsOnTarget,3);assert.equal(merged.home.corners,0);assert.equal(merged.home._observedAt.shotsOnTarget,old);assert.equal(merged.home._observedAt.fouls,at);
const outdated=mergeTeamStats(merged,{home:normalizeTeamStatistics({fouls:99},{observedAt:old})});assert.equal(outdated.home.fouls,4,'older source statistic cannotreplace a newer count');assert.equal(outdated.home._observedAt.fouls,at);
const decoded=decodePushMessage({messageType:'match-info-snapshot',data:{matchId:900,scoreBoard:{results:{10:{shotsOnGoal:'2',totalShots:'7',fouls:'0'},20:{shots_on_target:'4',foulsCommitted:'9'}}}}}).info;
assert.equal(decoded.stats['10'].shotsOnTarget,2);assert.equal(decoded.stats['10'].shots,7);assert.equal(decoded.stats['10'].fouls,0);assert.equal(decoded.stats['20'].shotsOnTarget,4);assert.ok(decoded.stats['20']._observedAt.fouls);
const replayed=decodePushMessage({messageType:'match-info',data:{matchId:900,ts:now-300000,scoreBoard:{results:{10:{shotsOnTarget:'3'}}}}}).info;
assert.equal(replayed.stats['10']._observedAt.shotsOnTarget,old,'delayed source packet neverbecomes fresh justbecause itarrivednow');
const base={match_id:900,home:'Home',away:'Away',home_score:7,away_score:4,score_at:at,feed_status:'Finished',feed_status_at:at,raw:{homeTeam:{id:10},awayTeam:{id:20}}};
const row={...base,stats:{10:normalizeTeamStatistics({shotsOnTarget:3,shots:10,fouls:8},{observedAt:at}),20:normalizeTeamStatistics({shotsOnTarget:5,shots:12,fouls:11},{observedAt:at})}};
assert.equal(teamStatisticsFromRow(row).home.shotsOnTarget,3);
assert.equal(teamStatisticsFromRow({...row,raw:{competitors:[{id:10},{id:20}]}}).away.fouls,11);
assert.equal(trackerTeamStatistics({}).home.shotsOnTarget,null,'unknown never displays aszero');
assert.deepEqual(verifiedFinalStatistics(row),{shots:{home:10,away:12},shotsOnTarget:{home:3,away:5},fouls:{home:8,away:11}});
const stale={...base,stats:{home:normalizeTeamStatistics({shotsOnTarget:4},{observedAt:old}),away:normalizeTeamStatistics({fouls:2},{observedAt:at})}};
assert.deepEqual(verifiedFinalStatistics(stale),{fouls:{away:2}},'a final-phase flag does not refresh an oldstat');
const result={home_team:'Home',away_team:'Away',home_score:7,away_score:4,statistics:verifiedFinalStatistics(row)};
const total={market_name:'Total Shots on Target - Over/Under',line:'8.5',outcome_key:'over',outcome_name:'Over'};
assert.equal(statisticMarketContract({market_name:'Full time result'}),null);
assert.equal(statisticMarketContract(total).stat,'shotsOnTarget');assert.equal(gradeStatisticLine(total,result),'LOST','eightshots, not elevengoals');
assert.equal(gradeStatisticLine({...total,line:'7.5'},result),'WON');
assert.equal(gradeStatisticLine({...total,line:'8'},result),'VOID','integer push returns stake');
assert.equal(gradeStatisticLine({...total,market_name:'Shots on Target: Team 1 Total',line:'3.5'},result),'LOST','homeonly, not home+away');
assert.equal(gradeStatisticLine({...total,market_name:'Shots on Target: Team 2 Total',line:'3.5'},result),'WON');
assert.equal(gradeStatisticLine({...total,market_name:'Fouls. Total',line:'18.5'},result),'WON');
assert.equal(gradeStatisticLine({...total,market_name:'Total Shots',line:'21.5'},result),'WON','totalshots separatefromONTARGET');
assert.equal(gradeStatisticLine({market_name:'Shots on Target. 1X2',outcome_key:'2'},result),'WON');
assert.equal(gradeStatisticLine({market_name:'Fouls. 1X2',outcome_name:''},result),'VOID','missingselection is not home');
assert.equal(hasStatisticEvidence(total,{...result,statistics:{}}),false);
assert.equal(hasStatisticEvidence(total,{...result,statistics:{shotsOnTarget:{home:0}}}),false,'unknownaway is not zero');
for(const market_name of ['Player Shots on Target','First Half Total Shots on Target','Shots Off Target','Fouls Handicap','Total Shots Odd/Even','Next 10 minutes Total Shots','Total Shots + Total Goals']){
 assert.equal(statisticMarketContract({...total,market_name}).supported,false,market_name);
 assert.equal(hasStatisticEvidence({...total,market_name},result),false,market_name);
}
for(const market_name of ['Arsenal Total Shots on Target','Team Total Shots on Target','Chelsea Total Fouls Committed','Total Fouls Won','Total Fouls Drawn','Total Fouls Received','Total Fouls Suffered','Most Shots on Target (Draw No Bet)','Most Shots on Target']){
 const contract={...total,market_name,line:'5.5'};assert.equal(statisticMarketContract(contract).supported,false,market_name);
 assert.equal(gradeStatisticLine(contract,{...result,statistics:{shotsOnTarget:{home:2,away:8},fouls:{home:2,away:8}}}),'VOID','namedteam or differentfoul definition never gradesas matchtotal');
}
assert.equal(statisticMarketContract({...total,market_name:'Match Shots on Goal'}).supported,true);
for(const line of ['1.25','1.75','1.2'])assert.equal(statisticMarketContract({...total,line}).supported,false,'quarter/unknownline cannot begradedas a wholebinarywager');
// Fresh final-frame corner and card totals are accepted; stale LIVE snapshots are not.
const freshCards={...base,stats:{
  10:normalizeTeamStatistics({corners:6,yellow:2,red:1},{observedAt:at}),
  20:normalizeTeamStatistics({corners:4,yellow:1,red:0},{observedAt:at})
}};
assert.deepEqual(verifiedFinalStatistics(freshCards),{
 corners:{home:6,away:4},yellow:{home:2,away:1},red:{home:1,away:0}
});
const staleCards={...base,stats:{
  10:normalizeTeamStatistics({corners:6,yellow:2,red:1},{observedAt:old}),
  20:normalizeTeamStatistics({corners:4,yellow:1,red:0},{observedAt:old})
}};
assert.deepEqual(verifiedFinalStatistics(staleCards),{},
 'old LIVE corners and card colors are not promoted into the FT archive');

const zizoStatResult={source:'ZIZOBET',home_team:'Home',away_team:'Away',
 home_score:1,away_score:0,corners_home:null,corners_away:null,cards_home:null,cards_away:null,
 statistics:{},statistics_review_pending:false};
const primaryColorResult=resolveSettlementStatistics({
 source:'ZIZOBET',statistics:{
  yellow:{home:2,away:1},red:{home:1,away:0}
 },statistics_review:null
});
assert.deepEqual(primaryColorResult.statistics.cards,{home:3,away:1},
 'a complete Zizobet yellow+red pair supplies full-time total cards even without secondary review');
assert.equal(statisticsNeedReview({market_name:'Total Cards',line:'3.5'},primaryColorResult),false);
const missingZizoReview=compareFinalStatistics([{
 provider:'fotmob',final:true,fixtureId:'fm-900',observedAt:at,
 values:{corners:{home:6,away:4},shotsOnTarget:{home:3,away:2},
  yellow:{home:2,away:1},red:{home:1,away:0}}
}]);
const fallbackResult=resolveSettlementStatistics({...zizoStatResult,statistics_review:missingZizoReview});
assert.deepEqual([fallbackResult.corners_home,fallbackResult.corners_away],[6,4]);
assert.deepEqual(fallbackResult.statistics.shotsOnTarget,{home:3,away:2});
assert.deepEqual(fallbackResult.statistics.cards,{home:3,away:1},
 'generic cards may be derived only from same-provider yellow+red facts');
assert.equal(fallbackResult._settlementSources.corners[0].provider,'fotmob');
const totalCorners={market_name:'Total Corners',line:'9.5',outcome_key:'over',outcome_name:'Over'};
const totalCards={market_name:'Total Cards',line:'3.5',outcome_key:'over',outcome_name:'Over'};
const totalYellow={market_name:'Total Yellow Cards',line:'2.5',outcome_key:'over',outcome_name:'Over'};
const totalRed={market_name:'Total Red Cards',line:'0.5',outcome_key:'over',outcome_name:'Over'};
assert.equal(isStatisticMarket(totalCorners),true);
assert.equal(isStatisticMarket(totalCards),true);
assert.equal(statisticMarketContract(totalCards).stat,'cards');
assert.equal(statisticMarketContract(totalYellow).stat,'yellow');
assert.equal(statisticMarketContract(totalRed).stat,'red');
assert.equal(gradeStatisticLine(totalCorners,fallbackResult),'WON');
assert.equal(gradeStatisticLine(totalCards,fallbackResult),'WON');
assert.equal(gradeStatisticLine(totalYellow,fallbackResult),'WON');
assert.equal(gradeStatisticLine(totalRed,fallbackResult),'WON');
assert.equal(hasRequiredSettlementEvidence(totalCards,fallbackResult),true);
assert.equal(hasRequiredSettlementEvidence(totalYellow,fallbackResult),true);
assert.equal(hasRequiredSettlementEvidence(totalRed,fallbackResult),true);
assert.equal(gradeLine(totalCards,fallbackResult),'WON');
assert.equal(gradeLine(totalYellow,fallbackResult),'WON');
assert.equal(gradeLine(totalRed,fallbackResult),'WON',
 'yellow and red totals must bypass the legacy generic CARDS-family gate');
assert.deepEqual(settlementStatisticFields(totalCards),['cards']);
assert.deepEqual(settlementStatisticFields({market_name:'Next Corner'}),[],
 'event sequence markets do not inherit aggregate corner-stat conflicts');

const conflictingReview=compareFinalStatistics([
 {provider:'fotmob',final:true,values:{corners:{home:6,away:4},shotsOnTarget:{home:3,away:2},cards:{home:2,away:1}}},
 {provider:'bsd',final:true,values:{corners:{home:5,away:4},shotsOnTarget:{home:3,away:2},cards:{home:2,away:1}}}
]);
const conflictingResult=resolveSettlementStatistics({...zizoStatResult,statistics_review:conflictingReview});
assert.ok(conflictingReview.conflicts.corners);
assert.ok(!conflictingReview.conflicts.shotsOnTarget);
assert.equal(statisticsNeedReview(totalCorners,conflictingResult),true);
assert.equal(statisticsNeedReview(totalCards,conflictingResult),false,
 'a corner conflict does not block card markets with their own facts');
assert.equal(statisticsNeedReview({market_name:'Total Shots on Target',line:'4.5'},conflictingResult),false,
 'a resolved shots-on-target field remains independently usable');
assert.equal(statisticsNeedReview({market_name:'1X2'},conflictingResult),false,
 'aggregate-stat conflicts never block result markets');
assert.equal(statisticsNeedReview({market_name:'Next Corner'},conflictingResult),false,
 'aggregate-stat conflicts never block event-sequence markets');
const primaryConflictReview=compareFinalStatistics([
 {provider:'ZIZOBET',final:true,values:{corners:{home:6,away:4}}},
 {provider:'fotmob',final:true,values:{corners:{home:5,away:4}}}
]);
const primaryConflictResult=resolveSettlementStatistics({...zizoStatResult,
 corners_home:6,corners_away:4,statistics_review:primaryConflictReview});
assert.deepEqual([primaryConflictResult.corners_home,primaryConflictResult.corners_away],[6,4],
 'a secondary source never overwrites Zizobet values');
assert.equal(statisticsNeedReview(totalCorners,primaryConflictResult),true,
 'a genuine source conflict holds only the affected market');
const tempRoot=resolve('tmp');await mkdir(tempRoot,{recursive:true});const temp=await mkdtemp(join(tempRoot,'stat-market-')),db=createLocalPool({dataDir:join(temp,'database')});
try{
 await db.query(LEDGER_SQL);
 await db.query(FINISHED_RESULT_INSERT,finishedResultParameters(row));
 let stored=(await db.query('select * from app_match_result where match_id=900')).rows[0];
 assert.deepEqual(stored.statistics,result.statistics);assert.equal(gradeStatisticLine(total,stored),'LOST');
 const partial={...base,stats:{home:normalizeTeamStatistics({fouls:9},{observedAt:at})}};
 await db.query(FINISHED_RESULT_INSERT,finishedResultParameters(partial));
 stored=(await db.query('select * from app_match_result where match_id=900')).rows[0];
 assert.deepEqual(stored.statistics.shotsOnTarget,{home:3,away:5});assert.deepEqual(stored.statistics.fouls,{home:9,away:11});
 const laterCards={...base,stats:{
  home:normalizeTeamStatistics({corners:6,yellow:2,red:1},{observedAt:at}),
  away:normalizeTeamStatistics({corners:4,yellow:1,red:0},{observedAt:at})
 }};
 await db.query(FINISHED_RESULT_INSERT,finishedResultParameters(laterCards));
 stored=(await db.query('select * from app_match_result where match_id=900')).rows[0];
 assert.deepEqual([stored.corners_home,stored.corners_away],[6,4],
  'late final corner counters merge into the durable result');
 assert.deepEqual([stored.cards_home,stored.cards_away],[3,1],
  'late final yellow+red counters update the aggregate card columns');
 assert.deepEqual(stored.statistics.yellow,{home:2,away:1});
 assert.deepEqual(stored.statistics.red,{home:1,away:0});
 assert.deepEqual(stored.statistics.cards,{home:3,away:1});
 const snapshots=createMatchSnapshotStore(db.query.bind(db));await snapshots.save(row);
 const restored=(await createMatchSnapshotStore(db.query.bind(db)).load([900]))[0];
 assert.deepEqual(verifiedFinalStatistics(restored),result.statistics,'restart keeps independentstat evidence');
 await db.query('update app_match_result set settled_at=now() where match_id=900');
 await db.query(FINISHED_RESULT_INSERT,finishedResultParameters({...row,stats:{home:normalizeTeamStatistics({fouls:90},{observedAt:at})}}));
 stored=(await db.query('select * from app_match_result where match_id=900')).rows[0];assert.equal(stored.statistics.fouls.home,9,'settledstats cannotbe silently rewritten');
 console.log('PASS explicit provider SOT/fouls normalization, missing vszero, teamIDs, partial timestamps, FTfreshness, total/team/result contracts, goal-separation, unsupportedscopes, durableSQLmerge/restart and settledresult freeze');
}finally{await db.end();await pool.end();assert.ok(resolve(temp).startsWith(tempRoot+sep));await rm(temp,{recursive:true,force:true});}
