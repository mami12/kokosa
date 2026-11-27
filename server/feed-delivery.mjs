import {CATEGORIES} from './market-delivery.mjs';
import {teamStatisticsFromRow} from './match-statistics.mjs';

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

const integer=value=>value!=null&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
function currentMinute(row,at){
 const elapsed=Number(row?.match_time_ms);
 if(!Number.isFinite(elapsed)||elapsed<0)return integer(row?.currentMinute??row?.current_minute);
 const clockAt=row?.clock_at??row?.clockAt;
 const anchor=clockAt==null?null:new Date(clockAt).getTime();
 const drift=Number.isFinite(anchor)?Math.max(0,at-anchor):0;
 return Math.floor((elapsed+drift)/60000);
}

/** Compact, global counters used only for provisional live incident alerts. */
export function projectLiveIncidentSnapshot(row,at=Date.now()){
 const id=String(row?.match_id??row?.matchId??row?.id??'').trim();
 if(!id)return null;
 const teams=teamStatisticsFromRow(row);
 const pair=field=>{
  const home=integer(teams.home?.[field]),away=integer(teams.away?.[field]);
  return home===null&&away===null?undefined:home===null||away===null?undefined:{home,away};
 };
 const counters={
  corners:pair('corners'),yellowCards:pair('yellow'),redCards:pair('red'),
  fouls:pair('fouls'),shotsOnTarget:pair('shotsOnTarget'),
  offsides:pair('offsides'),shots:pair('shots')
 };
 return {
  matchId:id,at,
  homeScore:integer(row?.home_score??row?.homeScore),
  awayScore:integer(row?.away_score??row?.awayScore),
  homeTeam:row?.home??row?.home_team??row?.homeTeam??null,
  awayTeam:row?.away??row?.away_team??row?.awayTeam??null,
  minute:currentMinute(row,at),counters
 };
}

/**
 * Keep global incident alerts without broadcasting full match records.
 * A fixture is sent only when its score, counters, or minute changes.
 */
export function createLiveIncidentPublisher(emit){
 if(typeof emit!=='function')throw new TypeError('emit must be a function');
 const previous=new Map();
 return (rows,at=Date.now())=>{
  const snapshots=(Array.isArray(rows)?rows:[])
   .map(row=>projectLiveIncidentSnapshot(row,at)).filter(Boolean);
  const current=new Set(),changed=[];
  for(const snapshot of snapshots){
   current.add(snapshot.matchId);
   const signature=JSON.stringify(snapshot);
   if(previous.get(snapshot.matchId)!==signature){
    previous.set(snapshot.matchId,signature);
    changed.push(snapshot);
   }
  }
  for(const id of previous.keys())if(!current.has(id))previous.delete(id);
  if(changed.length)emit({at,matches:changed});
  return changed.length;
 };
}
