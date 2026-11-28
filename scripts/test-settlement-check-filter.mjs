import assert from 'node:assert/strict';
import {isAllowedTotalLine} from '../server/market-catalog.mjs';
import {isCurrentSettlementCheckQuote} from '../server/ledger/settlement-check.mjs';
import {isDecidedLiveNumberedGoalWindow} from '../server/ledger/decided-markets.mjs';
import {isSettlementCheckFixture} from '../server/fixture-dates.mjs';
import fs from 'node:fs';

const now=1000;
const dateNow=new Date('2026-11-25T12:00:00+01:00');
assert.equal(isSettlementCheckFixture({start_at:'2026-11-25T22:00:00+01:00',service:'PREMATCH'},dateNow),true,
 'Tirane calendar date permits fixtures scheduled later today');
assert.equal(isSettlementCheckFixture({start_at:'2026-11-26T10:00:00+01:00',service:'PREMATCH'},dateNow),false,
 'tomorrow prematch fixture is excluded');
assert.equal(isSettlementCheckFixture({start_at:'2026-12-25T10:00:00+01:00',service:'PREMATCH'},dateNow),false,
 'next month prematch fixture is excluded');
assert.equal(isSettlementCheckFixture({start_at:'2026-11-24T22:00:00+01:00',service:'LIVE',status:'LIVE'},dateNow),true,
 'a match still live remains selectable even if it started yesterday');
const market={id:'m1',status:'ACTIVE',suspended:false};
const fresh={id:'o1',status:'ACTIVE',odds:2.25,priceValidUntil:2000};
assert.equal(isCurrentSettlementCheckQuote(market,fresh,now),true,
 'an active quote with a future provider freshness deadline is selectable');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:now},now),false,
 'a quote expiring at this instant is stale');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:999},now),false,
 'an expired quote is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,priceValidUntil:null},now),false,
 'a quote without a freshness deadline is excluded');
assert.equal(isCurrentSettlementCheckQuote({...market,status:'SUSPENDED'},fresh,now),false,
 'a suspended market is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,status:'SUSPENDED'},now),false,
 'a suspended outcome is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,quoteSuspended:true},now),false,
 'a quote explicitly marked stale is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,decided:true},now),false,
 'a provider-decided outcome is excluded');
assert.equal(isCurrentSettlementCheckQuote(market,{...fresh,odds:1},now),false,
 'an invalid price is excluded');

const ordinalWindow={name:'Who scores goal 1 in minutes 46-60 (15-minute interval)',period:0};
const liveMatch=overrides=>({
 service:'LIVE',status:'LIVE',score_at:'2026-11-21T15:43:00.000Z',
 home_score:0,away_score:0,currentMinute:43,...overrides,
});
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:2}),ordinalWindow),true,
 'Goal 1 already occurred at 2-0 before minute 43, so every outcome in its 46-60 market is decided');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:1}),ordinalWindow),true,
 'the first match goal decides the full Goal 1 interval even before its window starts');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch(),ordinalWindow),false,
 'at 0-0 and minute 43, the future 46-60 interval is still open');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({currentMinute:46}),ordinalWindow),false,
 'at 0-0, the interval must not be decided at its opening minute');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({currentMinute:60}),ordinalWindow),false,
 'the interval remains open through minute 60');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({currentMinute:61}),ordinalWindow),true,
 'a no-goal result becomes decided only after minute 60 has elapsed');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:1}),{
 name:'Who scores goal 2 in minutes 46-60 (15-minute interval)',period:0,
}),false,'Goal 1 does not decide a market about Goal 2');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:2}),{
 name:'Who scores goal 2 in minutes 46-60 (15-minute interval)',period:0,
}),true,'Goal 2 already exists, so its interval market is fully decided');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({home_score:2,score_at:null}),ordinalWindow),false,
 'an unconfirmed placeholder score must not decide a live market');
assert.equal(isDecidedLiveNumberedGoalWindow(liveMatch({currentMinute:61,phase:'2H'}),{
 name:'Who scores goal 1 in minutes 41-45 (5-minute interval)',period:0,
}),true,'a completed first-half interval is excluded after the half has ended');

console.log('PASS settlement-check bulk quote freshness and active-status filters');


// The admin settlement-check path must request each selected fixture's full
// market snapshot, then serialize all stored offers (not the homepage subset).
const adminSource=fs.readFileSync(new URL('../server/ledger/admin.mjs',import.meta.url),'utf8');
assert.match(adminSource,/await refreshAll\?\.\(ids\)/,
 'the settlement check must await a full-detail refresh for the selected fixtures');
assert.match(adminSource,/withOdds\(rows,\s*Date\.now\(\),\s*\{\s*board:\s*false\s*\}\)/,
 'the settlement check must serialize all available markets, not the board projection');
assert.match(adminSource,/loadMatchDetailsFully\s*\?\?/,
 'the two selected fixtures must use the shared full-market batch loader');
const serverSource=fs.readFileSync(new URL('../server/index.mjs',import.meta.url),'utf8');
assert.match(serverSource,/loadMatchDetailsFully=async values/,
 'the server must expose a batch loader for full match details');
assert.match(serverSource,/Promise\.all\(ids\.map\(id=>collector\?\.focus\?\.\(id\)\)\)/,
 'the full-market snapshots for both selected matches must load concurrently');

const totalFamilies=[
 {market_name:'Total Goals'},
 {market_name:'Total Corners'},
 {market_name:'Total Cards'},
 {market_name:'Total Fouls'},
 {market_name:'Over/Under',native_market_name:'Total Corners Over/Under'},
 {market_name:'Over/Under',native_market_name:'Total Cards Over/Under'},
 {market_name:'Over/Under',native_market_name:'Total Fouls Over/Under'},
];
for(const market of totalFamilies){
 for(const line of ['0.5','1.5','2.5','7.5','10.5'])
  assert.equal(isAllowedTotalLine({...market,line}),true,market.native_market_name??market.market_name+' '+line+' should remain available');
 for(const line of ['1','2','3','4','5','6','7','8','0.25','0.75','1.25','1.75','2.25','2.75'])
  assert.equal(isAllowedTotalLine({...market,line}),false,(market.native_market_name??market.market_name)+' '+line+' must be hidden');
}
assert.equal(isAllowedTotalLine({market_name:'Correct Score',line:'3'}),true,
 'integer selections in non-total markets are not affected');
assert.equal(isAllowedTotalLine({market_name:'Total Goals',line:''}),true,
 'an offer with no identifiable total line is not guessed or rewritten');
const collectorSource=fs.readFileSync(new URL('../server/collector.mjs',import.meta.url),'utf8');
assert.match(collectorSource,/if\(!isAllowedTotalLine\(o\)\)continue;/,
 'the full-market serializer must remove integer and quarter totals');
assert.match(collectorSource,/if\(!isAllowedTotalLine\(o\)\|\|o\.price==null&&o\.suspended===true\)return;/,
 'the homepage market-count path must use the same total-line rule');

console.log('PASS only half-step Over/Under totals survive for goals, corners, cards and fouls on board and settlement reads');
console.log('PASS settlement-check fetches full markets for both selected fixtures');
