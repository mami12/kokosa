import assert from 'node:assert/strict';
import {competitionPriority,selectPublishedMatches,filterBoardSubscriptionPlan} from '../server/board-settings.mjs';
import {competitionDisplayOrder} from '../server/football-competitions.mjs';
import * as store from '../server/match-store.mjs';

const row=(id,country,name,service='PREMATCH',start='2026-11-27T18:00:00+01:00')=>{
 const rank=competitionDisplayOrder(country,name);
 return {match_id:id,active:true,status:service,service,category_slug:country,category_name:country,
   tournament_id:id,tournament_name:name,competition_rank:rank,first_seen_at:new Date(2026,0,1),
   start_at:start,home:'Home',away:'Away',sport_id:18};
};

// The exact user list is the only public board whitelist.
const fixtures=[
 row(1,'england','League One'),
 row(2,'sweden','Superettan'),
 row(3,'england','Premier League'),
 row(4,'italy','Serie A'),
 row(5,'germany','Bundesliga'),
 row(6,'spain','LaLiga'),
 row(7,'france','Ligue 1'),
 row(8,'world','FIFA World Cup'),
 row(9,'sweden','Allsvenskan'),
 row(10,'italy','Coppa Italia'),
 row(11,'england','Championship','LIVE'),
 row(12,'england','League Two','LIVE'),
];
assert.ok(fixtures.slice(0,9).every(r=>competitionPriority(r).rank!==null));
assert.equal(competitionPriority(fixtures[9]).rank,null,'unlisted Italian cup excluded');
assert.equal(competitionPriority(fixtures[11]).rank,null,'unlisted LIVE league excluded');

const selected=selectPublishedMatches(fixtures,{prematchLimit:0});
assert.deepEqual(selected.rows.map(r=>r.match_id),[11,8,3,1,5,6,4,7,9,2],
 'LIVE first; then exact competition order; kickoff date and provider arrival must not move higher-ranked competitions');
assert.equal(selected.summary.live,1);
assert.equal(selected.summary.availablePrematch,9);
assert.equal(selected.summary.visiblePrematch,9);
assert.equal(fixtures[0].listing_priority,undefined,'presentation sorting does not mutate feed facts');

const reversed=selectPublishedMatches([...fixtures].reverse(),{prematchLimit:0});
assert.deepEqual(reversed.rows.map(r=>r.match_id),selected.rows.map(r=>r.match_id),
 'same set and order regardless of source arrival order');

// The same rank is applied to LIVE competitions, not only PREMATCH competitions.
const liveOrder=selectPublishedMatches([
 row(20,'england','Championship','LIVE'),
 row(21,'world','FIFA World Cup','LIVE'),
 row(22,'england','Premier League','LIVE'),
 row(23,'italy','Serie A','LIVE'),
],{prematchLimit:0});
assert.deepEqual(liveOrder.rows.map(r=>r.match_id),[21,22,20,23]);

// PREMATCH date sorting happens only after competition priority.
const dateOrder=selectPublishedMatches([
 row(30,'england','Premier League','PREMATCH','2026-11-27T11:00:00+01:00'),
 row(31,'world','FIFA World Cup','PREMATCH','2026-11-28T22:00:00+01:00'),
 row(32,'world','FIFA World Cup','PREMATCH','2026-11-27T21:00:00+01:00'),
],{prematchLimit:0});
assert.deepEqual(dateOrder.rows.map(r=>r.match_id),[32,31,30]);

// In-memory endpoint, league totals and feed subscriptions contain only the whitelist.
store.clear();
store.upsert(fixtures);
assert.deepEqual(store.getMatches({catalog:true}).map(r=>r.match_id),[11,8,3,5,4,6,7,1,9,2]);
assert.ok(store.getLeagues().every(r=>r.slug!=='italy'||r.live+r.prematch>0));
assert.equal(store.getMatches({catalog:true}).some(r=>r.match_id===12),false);
assert.equal(store.getSubscriptionIds({liveLimit:0,prematchLimit:0}).live.includes(12),false);
assert.equal(store.getCounts().live,1);
const plan=filterBoardSubscriptionPlan({live:[11,12],prematch:[1,2,3,4,5,6,7,8,9,10],prematchSoon:[],prematchLater:[],unpriced:[]},selected.rows);
assert.deepEqual(plan.live,[11,12],'subscription helper preserves LIVE IDs; getSubscriptionIds excludes unlisted LIVE fixtures');
assert.equal(plan.prematch.includes(10),false);
store.clear();

console.log('PASS strict LIVE + PREMATCH competition whitelist, stable 100-item priority, leagues, counts and subscription filters');
