import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {
 emitScopedMatchInfo,matchInfoRooms,liveMatchIds,createLiveMembershipPublisher,
 projectLiveIncidentSnapshot,createLiveIncidentPublisher
} from '../server/feed-delivery.mjs';

const rooms=new Map([
 ['feed:board:100',new Set(['board-socket'])],
 ['feed:detail:100:Cards',new Set(['detail-socket','board-socket'])],
 ['feed:slip:100',new Set(['slip-socket'])],
 ['feed:detail:200:all',new Set(['other-match-socket'])]
]);
const calls=[];
const io={
 sockets:{adapter:{rooms}},
 to(value){return {emit(event,payload){calls.push({rooms:value,event,payload});}};}
};

assert.deepEqual(matchInfoRooms(io,100),[
 'feed:board:100','feed:slip:100','feed:detail:100:Cards'
]);
assert.equal(matchInfoRooms(io,999).length,0,
 'A fixture with no board/detail/betslip subscribers has no match-info recipients');
const payload={match_id:100,home_score:1,away_score:0};
assert.equal(emitScopedMatchInfo(io,100,payload),3);
assert.equal(calls.length,1);
assert.deepEqual(calls[0].rooms,[
 'feed:board:100','feed:slip:100','feed:detail:100:Cards'
]);
assert.equal(calls[0].event,'match:info');
assert.equal(calls[0].payload,payload);
assert.equal(emitScopedMatchInfo(io,999,payload),0);
assert.equal(calls.length,1,'No empty/global socket broadcast is performed');

const fixtures=[
 {match_id:3},{match_id:1},{match_id:3},{id:2}
];
assert.deepEqual(liveMatchIds(fixtures),['1','2','3']);
const sent=[];
const publish=createLiveMembershipPublisher(ids=>sent.push(ids));
assert.equal(publish(fixtures),true,'First observed membership is published');
assert.deepEqual(sent,[['1','2','3']]);
assert.equal(publish([{id:1},{id:2},{id:3}]),false,
 'Order-only changes and duplicate rows do not trigger another board event');
assert.equal(sent.length,1);
assert.equal(publish([{id:1},{id:3},{id:4}]),true,
 'A real fixture membership change is published immediately');
assert.deepEqual(sent.at(-1),['1','3','4']);
assert.equal(publish([]),true,'An empty live board is a meaningful membership change');
assert.deepEqual(sent.at(-1),[]);

const at=100000;
const fixture={
 match_id:100,home:'Home FC',away:'Away FC',home_score:2,away_score:1,
 match_time_ms:300000,clock_at:new Date(70000),
 raw:{homeTeam:{id:'1'},awayTeam:{id:'2'}},
 stats:{
  '1':{Corners:3,YellowCards:1,RedCards:0,Fouls:7,ShotsOnTarget:4,Offsides:2,Shots:8},
  '2':{Corners:2,YellowCards:2,RedCards:0,Fouls:9,ShotsOnTarget:3,Offsides:1,Shots:6}
 }
};
const snapshot=projectLiveIncidentSnapshot(fixture,at);
assert.equal(snapshot.matchId,'100');
assert.deepEqual([snapshot.homeScore,snapshot.awayScore,snapshot.minute],[2,1,5]);
assert.deepEqual(snapshot.counters.corners,{home:3,away:2});
assert.deepEqual(snapshot.counters.yellowCards,{home:1,away:2});
assert.deepEqual(snapshot.counters.redCards,{home:0,away:0});
assert.deepEqual(snapshot.counters.fouls,{home:7,away:9});
assert.deepEqual(snapshot.counters.shotsOnTarget,{home:4,away:3});
assert.deepEqual(snapshot.counters.offsides,{home:2,away:1});
assert.deepEqual(snapshot.counters.shots,{home:8,away:6});

const incidentPackets=[];
const publishIncidents=createLiveIncidentPublisher(packet=>incidentPackets.push(packet));
assert.equal(publishIncidents([fixture],at),1,'Initial incident baseline is sent');
assert.equal(incidentPackets[0].matches.length,1);
assert.equal(publishIncidents([fixture],at+5000),0,
 'A new poll timestamp alone does not rebroadcast unchanged incident counters');
assert.equal(incidentPackets.length,1);
const changed={...fixture,stats:{
 ...fixture.stats,'1':{...fixture.stats['1'],Corners:4}
}};
assert.equal(publishIncidents([changed],at+10000),1,
 'A verified corner-counter change still produces a compact incident packet');
assert.equal(incidentPackets.length,2);
assert.equal(incidentPackets[1].matches[0].counters.corners.home,4);
assert.equal(incidentPackets[1].matches[0].at,at+10000);

console.log('PASS scoped match-info delivery, deduplicated live membership, and compact all-match incident alerts');
