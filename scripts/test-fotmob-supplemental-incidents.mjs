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
assert.equal(incidents.length,3,'FotMob incident archive contains corners and cards only');
const find=(kind,id)=>incidents.find(item=>item.kind===kind&&item.providerEventId===id);
assert.equal(find('goal','goal-1'),undefined,'FotMob goals are excluded from the incident archive');
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
assert.equal(find('foul','foul-1'),undefined,'FotMob fouls are aggregate statistics, not event evidence');
assert.equal(find('shot','shot-1'),undefined,'FotMob shots are aggregate statistics, not incident evidence');

const calls=[];
const stored=await storeSupplementalIncidents(101,'fotmob','fotmob-9001',incidents,{
 execute:async(sql,params=[])=>{calls.push({sql,params});return {rowCount:1};},
 payload:details,
 completeKinds:['corner','card']
});
assert.deepEqual(stored,{stored:3});
assert.equal(calls.length,3,'Archive reconciles active rows, inserts incidents and stores the source snapshot');
const deactivation=calls.find(call=>call.sql.startsWith('update app_supplemental_match_incident'));
assert.deepEqual(deactivation.params[3],['goal','corner','card','foul','shot'],
 'Corners and cards participate in completeness/reconciliation, not only shots');
const insertion=calls.find(call=>call.sql.includes('insert into app_supplemental_match_incident'));
const savedRows=JSON.parse(insertion.params[3]);
assert.deepEqual(new Set(savedRows.map(row=>row.kind)),new Set(['corner','card']));
assert.ok(savedRows.every(row=>typeof row.provider_event_id==='string'&&row.provider_event_id.length>0),
 'Every stored event retains a stable provider event identity');

// Repeated source IDs in one response must not make PostgreSQL process the
// same ON CONFLICT target twice in a single INSERT batch.
const duplicateCalls=[];
const duplicateRows=[
 {providerEventId:'same-corner',kind:'corner',team:'home',minute:12,sourceOrder:1,raw:{id:'same-corner'}},
 {providerEventId:'same-corner',kind:'corner',team:'home',minute:12,sourceOrder:1,
  playerName:'Corner taker',raw:{id:'same-corner',player:'Corner taker'}},
 {providerEventId:'other-corner',kind:'corner',team:'away',minute:13,sourceOrder:2,raw:{id:'other-corner'}}
];
assert.deepEqual(await storeSupplementalIncidents(101,'fotmob','fotmob-9001',duplicateRows,{
 execute:async(sql,params=[])=>{duplicateCalls.push({sql,params});return {rowCount:1};}
}),{stored:2});
const duplicateInsert=duplicateCalls.find(call=>call.sql.includes('insert into app_supplemental_match_incident'));
const duplicateSaved=JSON.parse(duplicateInsert.params[3]);
assert.equal(duplicateSaved.length,2);
assert.equal(new Set(duplicateSaved.map(row=>row.provider_event_id+'|'+row.kind)).size,2,
 'No INSERT batch may contain duplicate primary-key identities');
assert.equal(duplicateSaved.find(row=>row.provider_event_id==='same-corner').player_name,'Corner taker',
 'Duplicate copies retain the most complete event representation');

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

console.log('PASS FotMob supplemental archive: separate corner/card chronology, stoppage time and durable source-labelled storage');
