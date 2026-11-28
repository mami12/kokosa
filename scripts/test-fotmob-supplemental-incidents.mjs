import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fotMobIncidents,storeSupplementalIncidents} from '../server/stats-providers/supplemental-incidents.mjs';

const details={
 header:{teams:[{id:11,name:'Home FC'},{id:22,name:'Away FC'}]},
 general:{homeTeam:{id:11,name:'Home FC'},awayTeam:{id:22,name:'Away FC'}},
 content:{
  matchFacts:{events:{events:[
   {type:'Goal',eventId:'goal-1',isHome:true,time:'12',player:{id:1,name:'Home Scorer'}},
   {type:'Corner Kick',eventId:'corner-1',teamId:22,time:'45+2'},
   {type:'YellowCard',eventId:'yellow-1',team:{id:11},time:{elapsed:67,extra:3},
    player:{id:2,name:'Booked Home'}},
   {type:'Card',eventId:'red-1',isHome:false,time:'88',card:'Red'},
   {type:'Foul',eventId:'foul-1',teamName:'Home FC',time:'90+4'}
  ]}},
  shotmap:{shots:[
   {id:'shot-1',isHome:true,min:77,minAdded:0,isOnTarget:true,playerName:'Shooter'}
  ]}
 }
};

const incidents=fotMobIncidents(details);
assert.equal(incidents.length,6,'Goals, corners, both card colours, fouls and shotmap shots are all extracted');
const find=(kind,id)=>incidents.find(item=>item.kind===kind&&item.providerEventId===id);
assert.deepEqual(
 [find('goal','goal-1')?.team,find('goal','goal-1')?.minute,find('goal','goal-1')?.playerName],
 ['home',12,'Home Scorer']
);
assert.deepEqual(
 [find('corner','corner-1')?.team,find('corner','corner-1')?.minute,find('corner','corner-1')?.addedMinute],
 ['away',45,2]
);
assert.deepEqual(
 [find('card','yellow-1')?.team,find('card','yellow-1')?.minute,find('card','yellow-1')?.addedMinute,find('card','yellow-1')?.cardColor],
 ['home',67,3,'yellow']
);
assert.deepEqual(
 [find('card','red-1')?.team,find('card','red-1')?.minute,find('card','red-1')?.cardColor],
 ['away',88,'red']
);
assert.deepEqual(
 [find('foul','foul-1')?.team,find('foul','foul-1')?.minute,find('foul','foul-1')?.addedMinute],
 ['home',90,4]
);
assert.deepEqual(
 [find('shot','shot-1')?.team,find('shot','shot-1')?.minute,find('shot','shot-1')?.onTarget],
 ['home',77,true]
);

const calls=[];
const stored=await storeSupplementalIncidents(101,'fotmob','fotmob-9001',incidents,{
 execute:async(sql,params=[])=>{calls.push({sql,params});return {rowCount:1};},
 payload:details,
 completeKinds:['goal','corner','card','foul','shot']
});
assert.deepEqual(stored,{stored:6});
assert.equal(calls.length,3,'Archive reconciles active rows, inserts incidents and stores the source snapshot');
const deactivation=calls.find(call=>call.sql.startsWith('update app_supplemental_match_incident'));
assert.deepEqual(deactivation.params[3],['goal','corner','card','foul','shot'],
 'Corners and cards participate in completeness/reconciliation, not only shots');
const insertion=calls.find(call=>call.sql.includes('insert into app_supplemental_match_incident'));
const savedRows=JSON.parse(insertion.params[3]);
assert.deepEqual(new Set(savedRows.map(row=>row.kind)),new Set(['goal','corner','card','foul','shot']));
assert.ok(savedRows.every(row=>row.provider==='undefined'||row.provider_event_id),
 'Every stored event retains a stable provider event identity');

const collector=readFileSync(new URL('../server/collector.mjs',import.meta.url),'utf8');
const service=readFileSync(new URL('../server/stats-providers/service.mjs',import.meta.url),'utf8');
assert.match(collector,/if\(displayStats&&!board\)await Promise\.all\(rows\.map\(row=>statsProviders\.warm\(row\)\)\)/,
 'Match detail waits for source enrichment before it reads supplemental incidents');
assert.match(service,/detailTimelineRequested/,
 'Opening a match explicitly requests the FotMob timeline even if aggregate stats are cached');
assert.match(service,/reconcileKind\('corner'/,
 'FotMob corner archive completeness is checked against independent team counters');
assert.match(service,/reconcileKind\('card'/,
 'FotMob card archive completeness is checked against independent team counters');
assert.match(service,/entry\.fotmobTimelineChecked=true/,
 'Successful archive refresh is cached to prevent repeated upstream calls');

console.log('PASS FotMob supplemental archive: goals, shots, corners, yellow/red cards, fouls, stoppage time, durable storage and awaited detail delivery');
