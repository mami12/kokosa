import assert from 'node:assert/strict';
import {parseFotMobPayload} from '../server/stats-providers/match-recovery.mjs';
import {fotMobIncidents} from '../server/stats-providers/supplemental-incidents.mjs';

// FotMob is an aggregate-statistics and corner/card verification source only.
// Its score fields are used for fixture/counter reconciliation, never as goal
// chronology, scorer identity, halftime score, or goal-market evidence.
const summary={
 home:{score:1},away:{score:1},
 status:{reason:{short:'FT'}}
};
const details={
 header:{status:{finished:true,reason:{short:'FT'},scoreStr:'1-1'},
  teams:[{id:10,name:'Home'},{id:20,name:'Away'}]},
 general:{homeTeam:{id:10,name:'Home'},awayTeam:{id:20,name:'Away'}},
 content:{matchFacts:{events:{events:[
  {id:'g1',type:'Goal',isHome:true,time:'12',player:{id:1,name:'Goal Scorer'}},
  {id:'c1',type:'Corner',isHome:false,time:'22'},
  {id:'y1',type:'Card',isHome:true,time:'33',card:'Yellow'},
  {id:'f1',type:'Foul',isHome:false,time:'40'}
 ]}}}
};
const parsed=parseFotMobPayload(summary,details);
assert.equal(parsed.finished,true);
assert.equal(parsed.homeScore,1);
assert.equal(parsed.awayScore,1);
assert.equal('goalEvents' in parsed,false,'FotMob cannot expose a goal timeline to settlement');
assert.equal('halfHomeScore' in parsed,false,'FotMob cannot provide a halftime score');
assert.equal('halfAwayScore' in parsed,false,'FotMob cannot provide a halftime score');
assert.equal('scorers' in parsed,false,'FotMob cannot supply scorer identities');
assert.deepEqual(parsed.cornerEvents.map(e=>[e.team,e.minute]),[['away',22]]);
assert.deepEqual(parsed.cardEvents.map(e=>[e.team,e.minute,e.cardColor]),[['home',33,'yellow']]);
assert.equal(parsed.cornerTimelineAvailable,true);
assert.equal(parsed.cardTimelineAvailable,true);

const incidents=fotMobIncidents(details);
assert.deepEqual(incidents.map(e=>e.kind).sort(),['card','corner'],
 'The supplemental archive stores only corner and card incidents');
assert.equal(incidents.some(e=>e.kind==='goal'||e.kind==='foul'||e.kind==='shot'),false);
console.log('PASS FotMob limited to aggregate statistics and corner/card evidence; no goals, scorers or halftime');
