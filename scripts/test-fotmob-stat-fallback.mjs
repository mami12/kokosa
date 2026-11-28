import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parseFotMobPayload} from '../server/stats-providers/match-recovery.mjs';
import {validateHistoricalTimedEvents} from '../server/ledger/historical-timed-events.mjs';

const summary={status:{scoreStr:'2 - 1',finished:true},home:{score:2},away:{score:1}};
const details={
 header:{status:{finished:true,reason:{short:'Full-time'},scoreStr:'2 - 1'}},
 content:{stats:{Periods:{All:{stats:[
  {title:'Cards',stats:[
   {title:'Yellow Cards',stats:['2','1']},
   {title:'Red Cards',stats:['1','0']}
  ]},
  {title:'Shots',stats:[
   {title:'Total Shots',stats:['12','8']},
   {title:'Shots on Target',stats:['5','3']}
  ]}
 ]}}}}
};
const parsed=parseFotMobPayload(summary,details);
const partialDetailsStatus=parseFotMobPayload(
 {status:{finished:true,scoreStr:'2 - 1'},home:{score:2},away:{score:1}},
 {header:{status:{reason:{short:'Full-time'},scoreStr:'2 - 1'}}}
);
assert.equal(partialDetailsStatus.finished,true,
 'A partial details status must not shadow the independent finished date-list status');
const extended=parseFotMobPayload(
 {status:{finished:true,scoreStr:'2 - 1',reason:{short:'After penalties'}}},
 {header:{status:{finished:true,scoreStr:'2 - 1'}}}
);
assert.equal(extended.finished,false,
 'An explicit extra-time or penalty label must override a generic FT flag');

assert.equal(parsed.finished,true);
assert.deepEqual(parsed.yellowCards,{home:2,away:1});
assert.deepEqual(parsed.redCards,{home:1,away:0});
assert.deepEqual([parsed.cardsHome,parsed.cardsAway],[3,1],
 'total cards can be used only when both final yellow and red counts are independently present');
const partial=parseFotMobPayload(summary,{
 ...details,
 content:{stats:{Periods:{All:{stats:[
  {title:'Cards',stats:[{title:'Yellow Cards',stats:['2','1']}]}
 ]}}}}
});
assert.deepEqual(partial.yellowCards,{home:2,away:1});
assert.equal(partial.redCards,null);
assert.equal(partial.cardsHome,null);
assert.equal(partial.cardsAway,null,
 'a missing red-card category is not silently treated as zero');
// Real FotMob-shaped full-match payload: nested stat groups, percentage strings and stoppage-time incidents.
const fixture={
 status:{scoreStr:'1 - 0',finished:true},
 home:{score:1},away:{score:0}
};
const liveDetails={
 header:{status:{finished:true,reason:{short:'Full-time'},scoreStr:'1 - 0'}},
 content:{
  matchFacts:{events:{events:[
   {type:'Goal',eventId:101,isHome:true,time:'14',player:{id:10,name:'Home Scorer'},ownGoal:false},
   {type:'Corner',eventId:102,isHome:true,time:'45+3'},
   {type:'Corner',eventId:103,isHome:true,time:'90+4'},
   {type:'Card',eventId:104,isHome:true,time:'20',card:'Yellow',player:{id:11,name:'Booked Home'}},
   {type:'Card',eventId:105,isHome:false,time:'85',card:'Red',player:{id:12,name:'Sent Off Away'}}
  ]}},
  stats:{Periods:{All:{stats:[
   {title:'Corners',stats:['2','0']},
   {title:'Cards',stats:[
    {title:'Yellow Cards',stats:['1','0']},
    {title:'Red Cards',stats:['0','1']}
   ]},
   {title:'Shots',stats:[
    {title:'Total Shots',stats:['12','7']},
    {title:'Shots on Target',stats:['5','2']}
   ]},
   {title:'Fouls',stats:['9','13']},
   {title:'Possession',stats:['61%','39%']}
  ]}}}
 }
};
const actual=parseFotMobPayload(fixture,liveDetails);
assert.equal(actual.finished,true);
assert.deepEqual([actual.homeScore,actual.awayScore],[1,0]);
assert.deepEqual([actual.cornersHome,actual.cornersAway],[2,0]);
assert.deepEqual(actual.yellowCards,{home:1,away:0});
assert.deepEqual(actual.redCards,{home:0,away:1});
assert.deepEqual([actual.cardsHome,actual.cardsAway],[1,1]);
assert.deepEqual(actual.statistics.shots,{home:12,away:7});
assert.deepEqual(actual.statistics.shotsOnTarget,{home:5,away:2});
assert.deepEqual(actual.statistics.fouls,{home:9,away:13});
assert.deepEqual(actual.statistics.goalKicks,{home:8,away:6},
 'FotMob goal-kick totals are parsed as statistics, not event chronology or goals');
assert.deepEqual(actual.statistics.possession,{home:61,away:39},
 'FotMob percentage strings such as 61% are parsed instead of discarded');
assert.equal('goalEvents' in actual,false,'FotMob does not expose goal chronology to settlement');
assert.equal('halfHomeScore' in actual,false,'FotMob does not supply half-time scores');
assert.equal(actual.cornerTimelineAvailable,true);
assert.equal(actual.cardTimelineAvailable,true);
assert.deepEqual(actual.cornerEvents.map(event=>[event.minute,event.injury]),[[45,3],[90,4]],
 '45+3 and 90+4 event clock details survive normalization');
const verifiedCorners=validateHistoricalTimedEvents({
 source:'fotmob',kind:'corner',final:true,complete:true,timelineAvailable:true,
 homeCount:2,awayCount:0,homeScore:1,awayScore:0,events:actual.cornerEvents
});
assert.ok(verifiedCorners,'A complete FotMob corner timeline must reconcile to its own final counters');
const verifiedCards=validateHistoricalTimedEvents({
 source:'fotmob',kind:'card',final:true,complete:true,timelineAvailable:true,
 homeCount:1,awayCount:1,homeScore:1,awayScore:0,events:actual.cardEvents
});
assert.ok(verifiedCards,'Card colors and team totals must reconcile before settlement');
const noEventFixture={status:{scoreStr:'0 - 0',finished:true},home:{score:0},away:{score:0}};
const noEventDetails={
 header:{status:{finished:true,reason:{short:'Full-time'},scoreStr:'0 - 0'}},
 content:{matchFacts:{events:{events:[]}},stats:{Periods:{All:{stats:[
  {title:'Corners',stats:['0','0']},
  {title:'Cards',stats:[
   {title:'Yellow Cards',stats:['0','0']},
   {title:'Red Cards',stats:['0','0']}
  ]}
 ]}}}}
};
const noEvents=parseFotMobPayload(noEventFixture,noEventDetails);
assert.equal(noEvents.cornerTimelineAvailable,true);
assert.equal(noEvents.cardTimelineAvailable,true);
assert.ok(validateHistoricalTimedEvents({
 source:'fotmob',kind:'corner',final:true,complete:true,timelineAvailable:true,
 homeCount:0,awayCount:0,events:[]
}),'An explicitly present empty event list and explicit 0-0 counters verify no corners');
assert.ok(validateHistoricalTimedEvents({
 source:'fotmob',kind:'card',final:true,complete:true,timelineAvailable:true,
 homeCount:0,awayCount:0,events:[]
}),'An explicitly present empty event list and explicit 0-0 card counters verify no cards');

console.log('PASS FotMob final yellow/red facts remain separate; aggregate cards require both explicit categories');
