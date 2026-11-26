import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {
 primaryLiveDecision,verifiedSecondLiveDecision,settleVerifiedLiveProposals,
 VERIFIED_LIVE_PROPOSALS_SQL
} from '../server/ledger/verified-live-settlement.mjs';

const now=Date.parse('2026-11-06T17:30:00Z');
const contract={version:1,kind:'sequence',event:'goal',target:2,side:'away',baseline:{home:1,away:0}};
const frame={
 source:'zizobet',clock:37,counts:{goal:2,corner:1},
 teams:{goal:{home:1,away:1},corner:{home:1,away:0}},
 coverage:{goalThrough:37,cornerThrough:37},
 events:[
  {id:'g1',type:'goal',team:'home',minute:10,seconds:600},
  {id:'g2',type:'goal',team:'away',minute:36,seconds:2160}
 ],ended:false
};
assert.equal(primaryLiveDecision(contract,frame),'WON');
assert.equal(primaryLiveDecision(contract,{...frame,source:'aiscore'}),null,
 'AiScore discovery cannot authorize money movements');
assert.equal(primaryLiveDecision({...contract,baseline:null},{...frame,coverage:{}}),null,
 'Without complete PRIMARY evidence or safe delta, no winner may be guessed');
assert.match(VERIFIED_LIVE_PROPOSALS_SQL,/app_live_event_cursor/);
assert.match(VERIFIED_LIVE_PROPOSALS_SQL,/app_live_event_recovery/);
const row={
 line_id:'line-a',ticket_id:'ticket-a',match_id:1,proposed_status:'WON',
 payload:{contract,frame,frameAt:new Date(now-30000).toISOString()},
 live_contract:contract,provider_frame:frame,
 placed_at:new Date(now-60000).toISOString(),
 preview_at:new Date(now-25000).toISOString(),
 frame_at:new Date(now-30000).toISOString(),
 second_seen_at:new Date(now-5000).toISOString(),
 open_recovery_gap:false,
};
assert.equal(verifiedSecondLiveDecision(row,{now}),'WON');
assert.equal(verifiedSecondLiveDecision({...row,open_recovery_gap:true},{now}),null);
assert.equal(verifiedSecondLiveDecision({...row,second_seen_at:new Date(now-24500)},{now}),null,
 'A second observation must be at least five seconds after the first proposal');
assert.equal(verifiedSecondLiveDecision({...row,second_seen_at:new Date(now-120000)},{now}),null,
 'No stale or out-of-order feed observation');
assert.equal(verifiedSecondLiveDecision({...row,provider_frame:{...frame,source:'aiscore'}},{now}),null);
assert.equal(verifiedSecondLiveDecision({...row,provider_frame:{...frame,
 teams:{...frame.teams,goal:{home:2,away:0}},coverage:{},
 events:[...frame.events.slice(0,1),{...frame.events[1],team:'home'}]}},{now}),null,
 'The two source observations must agree on the winner');
assert.equal(verifiedSecondLiveDecision({...row,live_contract:{...contract,target:3}},{now}),null,
 'Accepted contract may never be changed during settlement');
assert.equal(verifiedSecondLiveDecision({...row,proposed_status:'LOST'},{now}),null,
 'A stored verdict must agree with both live calculations');

const counted={source:'zizobet',clock:20,counts:{goal:1},teams:{goal:{home:1,away:0}},
 events:[],coverage:{},ended:false};
const firstOnly={version:1,kind:'sequence',event:'goal',target:1,side:'home',baseline:{home:0,away:0}};
const countersRow={...row,proposed_status:'WON',live_contract:firstOnly,
 payload:{contract:firstOnly,frame:counted,frameAt:row.payload.frameAt},
 provider_frame:counted};
assert.equal(primaryLiveDecision(firstOnly,counted),'WON',
 'Verified one-goal difference in PRIMARY counters is enough for Next Goal');
assert.equal(verifiedSecondLiveDecision(countersRow,{now}),'WON',
 'The retained PRIMARY per-team counters must survive the second verification');
const cornerRace={version:1,kind:'race',event:'corner',target:6,side:'home',baseline:{home:2,away:1}};
const cornerFrame={source:'zizobet',clock:50,counts:{corner:8},
 teams:{corner:{home:6,away:2}},events:[],coverage:{},ended:false};
assert.equal(primaryLiveDecision(cornerRace,cornerFrame),'WON',
 'Race to six corners can be proven by PRIMARY team counters without another API');
// Real money requires two independent snapshots AND a unique delta since
// purchase. A partial timeline alone may never select a first/next winner.
const cornerRow={...row,live_contract:cornerRace,proposed_status:'WON',
 payload:{contract:cornerRace,frame:cornerFrame,frameAt:row.payload.frameAt},
 provider_frame:cornerFrame};
assert.equal(verifiedSecondLiveDecision(cornerRow,{now}),'WON',
 'A safely reached Race-to-X corner threshold settles from two polls');
const ambiguousNext={...firstOnly,kind:'sequence',event:'goal',target:1,side:'home'};
const twoUnordered={...counted,counts:{goal:2},
 teams:{goal:{home:1,away:1}},events:[
  {id:'h',type:'goal',team:'home',minute:10,seconds:600},
  {id:'a',type:'goal',team:'away',minute:14,seconds:840}
 ],coverage:{goalThrough:20}};
const disputed={...row,live_contract:ambiguousNext,proposed_status:'WON',
 payload:{contract:ambiguousNext,frame:twoUnordered,frameAt:row.payload.frameAt},
 provider_frame:twoUnordered};
assert.equal(verifiedSecondLiveDecision(disputed,{now}),null,
 'Two events after acceptance must not be decided by final counters alone');
const timed={version:1,kind:'window',event:'goal',choice:true,from:10,to:20};
const timedFrame={...frame,teams:{goal:{home:1,away:1}}};
const timedRow={...row,live_contract:timed,proposed_status:'WON',
 payload:{contract:timed,frame:timedFrame,frameAt:row.payload.frameAt},
 provider_frame:timedFrame};
assert.equal(verifiedSecondLiveDecision(timedRow,{now}),null,
 'A past goal inside the quoted window is not proof of an event after LIVE purchase');
// A goal ordinal is global to the fixture. A double-poll single-goal
// transition from target-1 to target proves the result inside an OPEN minute
// band; two goals without a chronology must not guess the second scorer.
const goalInBand={version:1,kind:'nth-time',event:'goal',target:1,
 choice:'team-window',side:'home',from:6,to:10,
 entryBaseline:{home:0,away:0},entryClockMinute:6};
const numberedFrame=(h,a,clock)=>({source:'zizobet',clock,
 teams:{goal:{home:h,away:a}},counts:{goal:h+a},
 events:[],coverage:{},ended:false});
const numberedRow=(c,first,second,expected='WON')=>({
 ...row,live_contract:c,proposed_status:expected,
 payload:{contract:c,frame:first,frameAt:row.payload.frameAt},
 provider_frame:second
});
assert.equal(verifiedSecondLiveDecision(numberedRow(
 goalInBand,numberedFrame(1,0,8),numberedFrame(1,0,11)),{now}),'WON',
 'The first goal was reported within minute 6-10 before final verification');
assert.equal(verifiedSecondLiveDecision(numberedRow(
 {...goalInBand,side:'away'},numberedFrame(1,0,8),numberedFrame(1,0,9),'LOST'),{now}),'LOST',
 'The other team does not win a verified first-goal interval');
assert.equal(verifiedSecondLiveDecision(numberedRow(
 {...goalInBand,choice:'none',side:undefined},
 numberedFrame(1,0,8),numberedFrame(1,0,9),'LOST'),{now}),'LOST',
 'Neither loses when the exact Nth goal occurs inside the window');
const goal2={...goalInBand,target:2,entryBaseline:{home:1,away:0},side:'away'};
assert.equal(verifiedSecondLiveDecision(numberedRow(
 goal2,numberedFrame(1,1,8),numberedFrame(1,1,9)),{now}),'WON',
 'The first match goal is baseline and away scores global goal #2');
assert.equal(verifiedSecondLiveDecision(numberedRow(
 {...goal2,entryBaseline:{home:0,away:0}},
 numberedFrame(1,1,8),numberedFrame(1,1,9)),{now}),null,
 'Two events between snapshots do not reveal who scored goal #2');
assert.equal(verifiedSecondLiveDecision(numberedRow(
 goalInBand,numberedFrame(1,0,11),numberedFrame(1,0,12)),{now}),null,
 'A goal first observed after minute 10 is not attributed to minute 6-10');

// First-half race/next-goal markets can settle before HT, but the
// match-wide counters stop being a safe half-only source at minute 45.
const halfCornerFrame=(h,a,clock)=>({
 source:'zizobet',clock,teams:{corner:{home:h,away:a}},
 counts:{corner:h+a},events:[],coverage:{},ended:false
});
const halfRace={version:1,kind:'half-race',event:'corner',half:1,target:2,
 side:'home',baseline:{home:0,away:0}};
assert.equal(verifiedSecondLiveDecision(numberedRow(
 halfRace,halfCornerFrame(2,1,43),halfCornerFrame(2,1,44)),{now}),'WON',
 'First-half Race to 2 Corners settles once one team reaches two');
assert.equal(verifiedSecondLiveDecision(numberedRow(
 halfRace,halfCornerFrame(2,1,43),halfCornerFrame(2,1,45)),{now}),'WON',
 'A proven first-half race remains valid when the second poll arrives at HT with unchanged counters');
assert.equal(verifiedSecondLiveDecision(numberedRow(
 {...halfRace,half:2},halfCornerFrame(2,1,43),halfCornerFrame(2,1,44)),{now}),null,
 'Second-half Race to X cannot use whole-match counters as a half baseline');
const halfNext={version:1,kind:'half-next-event',event:'goal',half:1,target:1,
 side:'home',baseline:{home:0,away:0}};
assert.equal(verifiedSecondLiveDecision(numberedRow(
 halfNext,numberedFrame(1,0,41),numberedFrame(1,0,44)),{now}),'WON',
 'First-half Next Goal settles as soon as the unique next goal is confirmed');
assert.equal(verifiedSecondLiveDecision(numberedRow(
 halfNext,numberedFrame(1,0,41),numberedFrame(1,0,45)),{now}),'WON',
 'A first-half next goal remains proven when the second poll lands at HT');
assert.equal(verifiedSecondLiveDecision(numberedRow(
 halfNext,numberedFrame(0,1,41),numberedFrame(0,1,44),'LOST'),{now}),'LOST',
 'The wrong team loses the first-half Next Goal selection');
const player={version:1,kind:'player-goal',event:'goal',playerName:'Alice',choice:true};
const playerRow={...row,live_contract:player,proposed_status:'WON',
 payload:{contract:player,frame,frameAt:row.payload.frameAt},provider_frame:frame};
assert.equal(verifiedSecondLiveDecision(playerRow,{now}),null,
 'Score-only observations can never settle named-player wagers');


// General timed LIVE interval contracts use purchase-time baselines, not
// events from before the ticket or an unrelated full-time scoreboard.
// Only an irreversible post-purchase outcome while the interval is still
// running can be confirmed financially by two Zizobet polls.
const timeWindow={version:1,kind:'window-total',event:'goal',from:1,to:10,
 choice:'over',threshold:0.5,entryBaseline:{home:0,away:0},entryClockMinute:6};
const frameFor=(event,home,away,clock=8)=>({
 source:'zizobet',clock,teams:{[event]:{home,away}},
 counts:{[event]:home+away},events:[],coverage:{},ended:false
});
const timedProof=(contract,first,second,proposed='WON')=>({
 ...row,live_contract:contract,proposed_status:proposed,
 payload:{contract,frame:first,frameAt:row.payload.frameAt},
 provider_frame:second
});
assert.equal(verifiedSecondLiveDecision(timedProof(
 timeWindow,frameFor('goal',1,0),frameFor('goal',1,0)),{now}),'WON');
assert.equal(verifiedSecondLiveDecision(timedProof(
 {...timeWindow,choice:'under'},frameFor('goal',1,0),
 frameFor('goal',1,0),'LOST'),{now}),'LOST');
assert.equal(verifiedSecondLiveDecision(timedProof(
 {...timeWindow,kind:'window',choice:true},frameFor('goal',1,0),
 frameFor('goal',1,0)),{now}),'WON');
assert.equal(verifiedSecondLiveDecision(timedProof(
 {...timeWindow,kind:'window',choice:false},frameFor('goal',1,0),
 frameFor('goal',1,0),'LOST'),{now}),'LOST');
assert.equal(verifiedSecondLiveDecision(timedProof(
 {...timeWindow,event:'foul'},frameFor('foul',1,0),
 frameFor('foul',1,0)),{now}),'WON',
 'Foul windows follow the same post-bet counter rule');
assert.equal(verifiedSecondLiveDecision(timedProof(
 {...timeWindow,event:'corner',side:'home'},frameFor('corner',0,1),
 frameFor('corner',0,1)),{now}),null,
 'Away corner must not win home-only corner market');
assert.equal(verifiedSecondLiveDecision(timedProof(
 timeWindow,frameFor('goal',0,0),frameFor('goal',0,0)),{now}),null,
 'No future goal: not a proof of an Over win');
assert.equal(verifiedSecondLiveDecision(timedProof(
 timeWindow,frameFor('goal',1,0,11),frameFor('goal',1,0,11)),{now}),null,
 'Events first observed after the interval cannot be assigned to it');
assert.equal(verifiedSecondLiveDecision(timedProof(
 timeWindow,frameFor('goal',1,0,8),frameFor('goal',1,0,11)),{now}),'WON',
 'An in-window proven goal remains WON after interval closes before second confirmation');
assert.equal(verifiedSecondLiveDecision(timedProof(
 {...timeWindow,choice:'under'},frameFor('goal',1,0,8),
 frameFor('goal',1,0,11),'LOST'),{now}),'LOST',
 'An in-window lost UNDER remains lost when the second read arrives past the boundary');
assert.equal(verifiedSecondLiveDecision(timedProof(
 timeWindow,frameFor('goal',1,0,8),frameFor('goal',2,0,11)),{now}),null,
 'A new count after the window cannot be attributed to the earlier interval');
assert.equal(verifiedSecondLiveDecision(timedProof(
 timeWindow,frameFor('goal',1,0,8),
 {...frameFor('goal',1,0,11),source:'aiscore'}),{now}),null,
 'A second poll from a non-primary provider cannot confirm a LIVE payout even after the window closes');
assert.equal(verifiedSecondLiveDecision(timedProof(
 {...timeWindow,from:10,to:20},frameFor('goal',1,0,11),
 frameFor('goal',1,0,11)),{now}),null,
 'A fixture score cannot prove a goal inside an unstarted future interval');
assert.equal(verifiedSecondLiveDecision(timedProof(
 {...timeWindow,event:'card',cardColor:'yellow'},frameFor('card',1,0),
 frameFor('card',1,0)),{now}),null,
 'Combined yellow/red counts cannot confirm a yellow-only incident');
assert.equal(verifiedSecondLiveDecision(timedProof(
 timeWindow,frameFor('goal',1,0),frameFor('goal',0,1)),{now}),null,
 'A provider team correction between independent polls must not pay');

 // First-half totals use the same live milestone rule before HT.
 const halfCornerOver={version:1,kind:'half-total',event:'corner',half:1,
  choice:'over',threshold:2.5};
 const halfTotalCornerStartFrame=halfCornerFrame(2,1,42);
 assert.equal(primaryLiveDecision(halfCornerOver,halfTotalCornerStartFrame),'WON',
  'First-half corners Over 2.5 is irreversible at three corners');
 assert.equal(verifiedSecondLiveDecision(timedProof(halfCornerOver,
  halfTotalCornerStartFrame,halfCornerFrame(3,1,43)) ,{now}),'WON',
  'First-half Over settles before HT even if another corner arrives during confirmation');
 assert.equal(primaryLiveDecision({...halfCornerOver,half:2},
  totalsFrame('corner',2,1,70)),null,
  'Second-half corner totals never use the match-wide 1H+2H count');

 const firstHalfGoals={version:1,kind:'period-goal-total',event:'goal',half:1,
  selection:'over',target:0.5};
 const firstHalfGoalFrame=totalsFrame('goal',1,0,23);
 assert.equal(primaryLiveDecision(firstHalfGoals,firstHalfGoalFrame),'WON',
  'First-half goals Over 0.5 wins on the first goal');
 assert.equal(verifiedSecondLiveDecision(timedProof(firstHalfGoals,
  firstHalfGoalFrame,totalsFrame('goal',2,0,47)) ,{now}),'WON',
  'A proved first-half goal total remains settled when the second poll is in 2H');

 const halfYellow={version:1,kind:'half-total',event:'card',half:1,
  cardColor:'yellow',choice:'over',threshold:1.5};
 const halfYellowFrame={source:'zizobet',clock:38,teams:{
  card:{home:2,away:0},yellowCard:{home:2,away:0},redCard:{home:0,away:0}},
  counts:{card:2},cardColorsVerified:true,events:[],coverage:{},ended:false};
 assert.equal(verifiedSecondLiveDecision(timedProof(halfYellow,
  halfYellowFrame,halfYellowFrame),{now}),'WON',
  'First-half yellow totals settle early only with reconciled card colours');
 assert.equal(primaryLiveDecision(halfYellow,
  {...halfYellowFrame,cardColorsVerified:false}),null,
  'Unverified yellow/red counts cannot settle early');
 // Full-match totals now settle at the first irreversible milestone.
 // Over wins and Under loses only after the count passes the quoted line.
 const totalsFrame=(event,home,away,clock=64,extra={})=>({
  source:'zizobet',clock,counts:{[event]:home+away},
  teams:{[event]:{home,away},...(extra.teams??{})},
  cardColorsVerified:extra.cardColorsVerified===true,
  events:[],coverage:{},ended:false
 });
 const cornerOver={version:1,kind:'over',event:'corner',threshold:2.5};
 const cornerOverFrame=totalsFrame('corner',2,1);
 const cornerOverRow=timedProof(cornerOver,cornerOverFrame,cornerOverFrame);
 assert.equal(primaryLiveDecision(cornerOver,cornerOverFrame),'WON',
  'Total Corners Over 2.5 becomes irreversible at three corners');
 assert.equal(verifiedSecondLiveDecision(cornerOverRow,{now}),'WON',
  'Total Corners Over 2.5 settles after the second agreeing Zizobet observation');
 assert.equal(verifiedSecondLiveDecision(timedProof(cornerOver,
  cornerOverFrame,totalsFrame('corner',3,1,65)) ,{now}),'WON',
  'Additional corners between confirmation polls do not delay an already irreversible Over win');
 const cornerUnder={...cornerOver,kind:'under'};
 assert.equal(verifiedSecondLiveDecision(timedProof(cornerUnder,cornerOverFrame,
  cornerOverFrame,'LOST'),{now}),'LOST',
  'Total Corners Under 2.5 loses as soon as the third corner is confirmed');
 assert.equal(primaryLiveDecision(cornerOver,totalsFrame('corner',1,1)),null,
  'Over remains pending before the threshold is crossed');
 const exactCorners={version:1,kind:'exact',event:'corner',target:2};
 assert.equal(verifiedSecondLiveDecision(timedProof(exactCorners,cornerOverFrame,
  cornerOverFrame,'LOST'),{now}),'LOST',
  'An exact-two-corners selection loses immediately when a third arrives');
 const rangeCorners={version:1,kind:'range',event:'corner',min:1,max:2};
 assert.equal(verifiedSecondLiveDecision(timedProof(rangeCorners,cornerOverFrame,
  cornerOverFrame,'LOST'),{now}),'LOST',
  'A corner range loses as soon as the upper bound is exceeded');
 const atLeastCorners={version:1,kind:'atLeast',event:'corner',target:3};
 assert.equal(verifiedSecondLiveDecision(timedProof(atLeastCorners,cornerOverFrame,
  cornerOverFrame,'WON'),{now}),'WON',
  'At-least corner totals win at the threshold');
 const teamGoals={version:1,kind:'team-total-goals',event:'goal',side:'home',
  choice:'over',threshold:0.5};
 const teamGoalFrame=totalsFrame('goal',1,0);
 assert.equal(verifiedSecondLiveDecision(timedProof(teamGoals,teamGoalFrame,
  teamGoalFrame,'WON'),{now}),'WON',
  'Home team goals over 0.5 wins as soon as the first home goal is confirmed');

 // Yellow/red totals require the Zizobet event timeline to reconcile colours.
 const yellowOver={version:1,kind:'over',event:'card',cardColor:'yellow',threshold:1.5};
 const yellowFrame={
  source:'zizobet',clock:70,counts:{card:3},
  teams:{card:{home:2,away:1},yellowCard:{home:2,away:0},redCard:{home:0,away:1}},
  cardColorsVerified:true,events:[],coverage:{},ended:false
 };
 assert.equal(primaryLiveDecision(yellowOver,yellowFrame),'WON',
  'Yellow-card totals use reconciled yellow counters, not all cards combined');
 assert.equal(verifiedSecondLiveDecision(timedProof(yellowOver,yellowFrame,
  yellowFrame,'WON'),{now}),'WON');
 assert.equal(primaryLiveDecision(yellowOver,{...yellowFrame,cardColorsVerified:false}),null,
  'Unverified card colours cannot trigger an early payout');

const calls=[];
const runQuery=async(sql)=>{assert.match(sql,/app_live_settlement_preview/);return {rows:[row,
 {...row,line_id:'line-b',open_recovery_gap:true}]};};
const updateLine=async(id,status,ticketId)=>{calls.push({id,status,ticketId});return 1;};
const closeTicket=async id=>({ticketId:id,status:'WON'});
const off=await settleVerifiedLiveProposals({runQuery:()=>{throw Error('Disabled should not query');},
 enabled:false,updateLine,closeTicket,now:()=>now});
assert.equal(off.enabled,false);
const result=await settleVerifiedLiveProposals({runQuery,enabled:true,now:()=>now,updateLine,closeTicket});
assert.deepEqual({examined:result.examined,graded:result.graded,closed:result.closed.length},
 {examined:2,graded:1,closed:1});
assert.deepEqual(calls,[{id:'line-a',status:'WON',ticketId:'ticket-a'}]);

const {settleVerifiedEventFacts}=await import('../server/ledger/settler.mjs');
let eventScanSql='';
const eventUpdates=[];
const eventScan=await settleVerifiedEventFacts({
 runQuery:async(sql)=>{
  if(sql.includes('select l.*')){
   eventScanSql=sql;
   return {rows:[{id:'line-native',ticket_id:'ticket-native',match_id:77,
    market_key:'provider-market-77',market_name:'Next Corner',
    live_contract:{version:1,kind:'sequence',event:'corner',target:2,side:'home'}}]};
  }
  if(/select match_id,home_score/.test(sql))return {rows:[{match_id:77,home_score:1,away_score:0}]};
  throw Error('Unexpected event settlement query: '+sql);
 },
 grade:async()=> 'WON',
 update:async(lineId,status,ticketId)=>{eventUpdates.push({lineId,status,ticketId});return 1;},
 recalc:async ticketId=>({ticketId,status:'WON'})
});
assert.ok(eventScanSql.includes("l.live_contract is not null"));
assert.ok(!/market_key\s+like|providerMarketKey.*like/i.test(eventScanSql),
 'verified event settlement must not exclude a valid contract because its native market key has another format');
assert.deepEqual(eventUpdates,[{lineId:'line-native',status:'WON',ticketId:'ticket-native'}]);
assert.equal(eventScan.graded,1,
 'a supported frozen contract is scanned when its market key is not zz%@%');

console.log('PASS guarded double observation: primary-only, clock freshness, no recovery gaps, no stale contract and no duplicate writes');
