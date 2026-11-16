import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';
import {gradeStoredEventContract} from '../server/ledger/match-event-facts.mjs';
import {isExcludedOfferMarket} from '../server/market-policy.mjs';

const interval=liveContract({
 market_name:'When will goal 2 be scored',
 outcome_name:'50+',
 market_key:'zz-test'
});
assert.deepEqual(interval,{
 version:1,kind:'nth-time',event:'goal',target:2,choice:'range',from:50,to:130
});

// At half-time, the first goal exists but goal #2 has not happened. The 50+
// interval is still ahead, so a half-time snapshot cannot mark it LOST.
const observed=new Date('2026-11-16T19:00:00.000Z');
const calls=[];
const halftime=await gradeStoredEventContract({
 id:'line-50-plus',match_id:123,
 live_contract:interval
 },null,{execute:async(sql)=>{
  calls.push(sql);
  return {rows:[{
   total:1,home:1,away:0,color_total:0,color_home:0,color_away:0,
   window_count:0,color_window_count:0,window_home:0,window_away:0,
   rolling_boundary_uncertain:false,ambiguous_order:false,minute_only:false,
   through_minute:45,count_home:1,count_away:0,complete:false,
   observed_at:observed,confirmed_at:observed,card_colors_verified:false,
   second_poll_at:observed,archive_poll_at:null,open_recovery_gap:false,
   last_team:'home',last_same_time:1,nth_team:null,nth_minute:null,nth_same_time:null,
   race_home:null,race_away:null,race_home_time:null,race_away_time:null
  }]};
 }});
assert.equal(halftime,null,'50+ stays pending at half-time');
assert.equal(calls.length,1,'only the Zizobet evidence query is used');

// A later Zizobet timeline proves the second goal occurred inside 50+.
const later=await gradeStoredEventContract({
 id:'line-50-plus',match_id:123,live_contract:interval
 },null,{execute:async()=>({rows:[{
  total:2,home:1,away:1,color_total:0,color_home:0,color_away:0,
  window_count:1,color_window_count:0,window_home:0,window_away:1,
  rolling_boundary_uncertain:false,ambiguous_order:false,minute_only:false,
  through_minute:61,count_home:1,count_away:1,complete:false,
  observed_at:observed,confirmed_at:observed,card_colors_verified:false,
  second_poll_at:observed,archive_poll_at:null,open_recovery_gap:false,
  last_team:'away',last_same_time:1,nth_team:'away',nth_minute:55,nth_same_time:1,
  race_home:null,race_away:null,race_home_time:null,race_away_time:null
 }]})});
assert.equal(later,'WON','a Zizobet-confirmed goal #2 in 50+ wins');

// No backup API may be queried to rescue missing primary evidence.
const providerQueries=[];
const noPrimary=await gradeStoredEventContract({
 id:'line-primary-only',match_id:124,
 live_contract:{version:1,kind:'window-total',event:'goal',from:50,to:60,choice:'over',threshold:0.5}
 },{home_score:1,away_score:0},{execute:async(sql)=>{
  providerQueries.push(sql);
  return {rows:[]};
 }});
assert.equal(noPrimary,null);
assert.equal(providerQueries.length,1,'missing Zizobet evidence remains pending without backup-provider queries');
assert.match(providerQueries[0],/provider=\$16::text/);

// Offers that the operator does not use are rejected at the global ingest gate.
for(const name of [
 'Asian Handicap','Total Fouls','Total Cards','Player Shots On Target',
 'Anytime Goalscorer','First Goal Scorer','Goalkeeper Saves','Total Tackles','Throw-ins'
])assert.equal(isExcludedOfferMarket({market_name:name}),true,name+' must be excluded');
assert.equal(isExcludedOfferMarket({market_name:'Total Goals'}),false);
assert.equal(isExcludedOfferMarket({market_name:'Total Corners'}),false);
assert.equal(isExcludedOfferMarket({market_name:'Full Time Result'}),false);
assert.equal(isExcludedOfferMarket({market_name:'Total Goals',pl:'player-42'}),true,
 'a native player parameter retires the market even if the display title hides the player');

console.log('PASS Zizobet-only settlement, 50+ halftime protection, and excluded-market policy');
