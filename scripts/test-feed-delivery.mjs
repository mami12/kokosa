import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {
 emitScopedMatchInfo,matchInfoRooms,liveMatchIds,createLiveMembershipPublisher
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

console.log('PASS scoped match-info delivery, single union fanout, and deduplicated lightweight live membership');
