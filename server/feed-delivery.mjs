import {CATEGORIES} from './market-delivery.mjs';

/**
 * Deliver a single match-info update only to sockets that currently consume
 * that fixture through the board, match detail, or betslip.
 */
export function matchInfoRooms(io,matchId){
 if(!io?.sockets?.adapter?.rooms)return [];
 const id=String(matchId??'').trim();
 if(!id)return [];
 const rooms=io.sockets.adapter.rooms;
 const candidates=[
  'feed:board:'+id,
  'feed:slip:'+id,
  ...CATEGORIES.map(category=>'feed:detail:'+id+':'+category)
 ];
 return candidates.filter(room=>(rooms.get(room)?.size??0)>0);
}

export function emitScopedMatchInfo(io,matchId,payload){
 const rooms=matchInfoRooms(io,matchId);
 if(!rooms.length)return 0;
 // Socket.IO treats a room array as a union, so a socket subscribed through
 // both its board and betslip receives the event only once.
 io.to(rooms).emit('match:info',payload);
 return rooms.length;
}

export function liveMatchIds(rows){
 return [...new Set((Array.isArray(rows)?rows:[])
  .map(row=>String(row?.match_id??row?.matchId??row?.id??'').trim())
  .filter(Boolean))].sort();
}

/** Publish only meaningful live-list membership changes, not every clock poll. */
export function createLiveMembershipPublisher(emit){
 if(typeof emit!=='function')throw new TypeError('emit must be a function');
 let previous=null;
 return rows=>{
  const ids=liveMatchIds(rows),signature=ids.join(',');
  if(signature===previous)return false;
  previous=signature;
  emit(ids);
  return true;
 };
}
