import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {parseFotMobPayload} from '../server/stats-providers/match-recovery.mjs';

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
console.log('PASS FotMob final yellow/red facts remain separate; aggregate cards require both explicit categories');
