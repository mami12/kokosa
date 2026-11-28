import assert from 'node:assert/strict';
import {parseFotMobPayload} from '../server/stats-providers/match-recovery.mjs';
import {fotMobIncidents} from '../server/stats-providers/supplemental-incidents.mjs';
import {statisticMarketContract,gradeStatisticLine} from '../server/ledger/statistic-markets.mjs';

const summary={home:{score:1},away:{score:1},status:{reason:{short:'FT'}}};
const details={
 header:{status:{finished:true,reason:{short:'FT'},scoreStr:'1-1'},teams:[{id:1,name:'Home'},{id:2,name:'Away'}]},
 general:{homeTeam:{id:1,name:'Home'},awayTeam:{id:2,name:'Away'}},
 content:{
  stats:{Periods:{All:{stats:[
   {title:'Total Shots',stats:['10','7']},
   {title:'Fouls',stats:['14','10']},
   {title:'Goal Kicks',stats:['8','6']},
   {title:'Corners',stats:['5','3']}
  ]}}},
  matchFacts:{events:{events:[
   {id:'g1',type:'Goal',isHome:true,time:'23',player:{id:1,name:'Scorer'}},
   {id:'c1',type:'Corner',isHome:true,time:'25'},
   {id:'y1',type:'Card',isHome:false,time:'40',card:'Yellow'}
  ]}}
 }
};
const parsed=parseFotMobPayload(summary,details);
assert.deepEqual(parsed.statistics.goalKicks,{home:8,away:6});
assert.deepEqual(parsed.statistics.fouls,{home:14,away:10});
assert.equal('goalEvents' in parsed,false,'FotMob has no goal event output');
assert.equal('halfHomeScore' in parsed,false,'FotMob has no halftime scoreboard');
assert.deepEqual(parsed.cornerEvents.map(e=>e.kind),['corner']);
assert.deepEqual(parsed.cardEvents.map(e=>e.kind),['card']);
assert.deepEqual(fotMobIncidents(details).map(e=>e.kind).sort(),['card','corner']);
assert.equal(fotMobIncidents(details).some(e=>e.kind==='goal'),false);

const goals={market_name:'Total Goals',line:'1.5',outcome_name:'Over'};
assert.equal(statisticMarketContract(goals).supported,false,
 'FotMob match-score data is not a source for goal market settlement');
const goalKicks={market_name:'Total Goal Kicks',line:'10.5',outcome_name:'Over'};
assert.equal(statisticMarketContract(goalKicks).supported,true);
assert.equal(statisticMarketContract(goalKicks).stat,'goalKicks');
assert.equal(gradeStatisticLine(goalKicks,{statistics:parsed.statistics}),'WON');
console.log('PASS FotMob statistics only: goal-kicks/fouls, corners/cards chronology, no goal/scorer/HT evidence');
