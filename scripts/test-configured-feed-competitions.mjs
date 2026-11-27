import assert from 'node:assert/strict';
import {rowOf} from '../server/zizobet/normalize.mjs';
import {isAllowedYbetsMatch} from '../server/ybets-feed.mjs';
import {normalizeMatch} from '../server/ybets-normalize.mjs';
import {selectPublishedMatches} from '../server/board-settings.mjs';

const meta={
 teams:new Map([[1,{ID:1,Name:'Home FC'}],[2,{ID:2,Name:'Away FC'}]]),
 regions:new Map([[1,{ID:1,Name:'England'}]]),
 champs:new Map([[10,{ID:10,Name:'Premier League'}],[11,{ID:11,Name:'League Two'}]]),
 statuses:new Map(),
 liveMarkets:new Map(),preMarkets:new Map(),positions:new Map()
};
const zizoGame=(champ,service='LIVE')=>({
 ID:100+champ,Sport:1,Team1:1,Team2:2,Region:1,Champ:champ,
 StartTime:'2026-11-27T17:00:00Z',MatchStatusID:service==='LIVE'?10:0
});
const zizoPremier=rowOf(zizoGame(10),meta,true);
const zizoLeagueTwo=rowOf(zizoGame(11),meta,true);
assert.ok(zizoPremier?.competition_rank!=null,'Zizobet LIVE approved competition gets rank');
assert.equal(zizoLeagueTwo?.competition_rank,null,'Zizobet LIVE non-approved competition is not published');
assert.equal(selectPublishedMatches([zizoLeagueTwo],{prematchLimit:0}).rows.length,0);

const ybetsMatch=(name,slug,status=1)=>({
 id:777,type:'match',status,start_time:'2026-11-27T17:00:00Z',
 tournament:{id:20,name,sport:{key:'soccer',type:'regular'},category:{id:1,slug,name:slug}},
 competitors:{home:{name:'Home FC'},away:{name:'Away FC'}}
});
const approved=ybetsMatch('Premier League','england',1);
const excluded=ybetsMatch('League Two','england',1);
assert.equal(normalizeMatch(approved).competition_rank!=null,true);
assert.equal(isAllowedYbetsMatch(approved),true);
assert.equal(normalizeMatch(excluded).competition_rank,null);
assert.equal(isAllowedYbetsMatch(excluded),false,
 'Ybets LIVE and PREMATCH use the same whitelist, not the former LIVE bypass');

console.log('PASS Zizobet and Ybets apply the same strict competition whitelist to LIVE and PREMATCH');
