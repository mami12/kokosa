import {classifyZizobetCardEvents} from './zizobet/card-events.mjs';
import {zizobetEventIdentities} from './zizobet/event-identity.mjs';
import {zizobetEventTime} from './zizobet/event-time.mjs';

/** Display only provider-timed incidents; reception time is never an event minute. */
export function providerTimeline(matchId,rows,match={}){
 if(!Array.isArray(rows))return undefined;
 const events=new Map();
 const ordinals=new Map();
 const identities=zizobetEventIdentities(rows);
 const cardEvents=classifyZizobetCardEvents(rows,match);
 for(const [index,row] of rows.entries()){
  if(row.cancelled||row.canceled||row.disabled||row.isConfirmed===false||/cancelled|canceled|voided/i.test(String(row.status??''))){
   events.delete(identities[index].id);
   continue;
  }
  const eventTime=zizobetEventTime(row.gt??row.minute??row.time,row.clk??row.clock,row.injury);
  if(!Number.isFinite(eventTime.minute)||eventTime.minute>120)continue;
  const minute=eventTime.minute-eventTime.added;
  const added=eventTime.added;
  const team=/^(?:home|h|1)$/i.test(String(row.team))?'home':/^(?:away|a|2)$/i.test(String(row.team))?'away':null;
  if(!team)continue;
  const sourceType=String(row.type??'').toLowerCase();
  const color=cardEvents.colors.get(index);
  const type=sourceType==='score_change'||sourceType==='goal'?'goal':
   sourceType==='corner_kick'||sourceType==='corner'?'corner':
   /yellow/.test(sourceType)||color==='yellow'?'yellow_card':
   /red/.test(sourceType)||color==='red'?'red_card':
   cardEvents.cardIndices.has(index)?'card':
   /foul/.test(sourceType)?'foul':null;
  if(!type)continue;
  const ordinalKey=type+':'+team;
  const counterOrdinal=(ordinals.get(ordinalKey)??0)+1;
  ordinals.set(ordinalKey,counterOrdinal);
  const text={goal:'Goal',corner:'Corner',yellow_card:'Yellow card',
   red_card:'Red card',card:'Card (colour unknown)',foul:'Foul'}[type];
  // Zizobet incidents may carry a player as "pl", a structured "player",
  // or an explicit actor label. Preserve only a provider-supplied name:
  // never invent an actor from the team, jersey number or scoreboard.
  const playerName=value=>typeof value==='string'?value.trim():
    value&&typeof value==='object'?String(value.name??value.fullName??value.full_name??'').trim():'';
  const player=[row.pl,row.player,row.player_name,row.playerName,row.actor]
    .map(playerName).find(Boolean)??'';
  const identity=identities[index];
  const id=identity.id;
  events.set(id,{id,sequence:identity.sequence,matchId:String(matchId),type,minute,addedMinute:added,
   minuteLabel:eventTime.label,phase:row.phase??row.period??row.periodName??row.period_name??row.half??eventTime.phase,
   team,text,counterOrdinal,...(player?{player}:{})});
 }
 return [...events.values()].sort((a,b)=>a.minute-b.minute||a.addedMinute-b.addedMinute||a.sequence-b.sequence);
}


const timelineKind=event=>event?.type==='goal'?'goal':
 event?.type==='corner'?'corner':
 ['yellow_card','red_card','card'].includes(event?.type)?'card':
 event?.type==='foul'?'foul':null;
const compareTimelineEvents=(a,b)=>
 Number(a.minute)-Number(b.minute)||Number(a.addedMinute??0)-Number(b.addedMinute??0)||
 Number(a.sequence??0)-Number(b.sequence??0)||String(a.id??'').localeCompare(String(b.id??''));
function withTimelineOrdinals(events){
 const counts=new Map();
 return [...events].sort(compareTimelineEvents).map(event=>{
  const key=String(event.type??'')+':'+String(event.team??'');
  const next=(counts.get(key)??0)+1;
  const ordinal=Number.isSafeInteger(Number(event.counterOrdinal))&&Number(event.counterOrdinal)>0
   ?Number(event.counterOrdinal):next;
  counts.set(key,Math.max(next,ordinal));
  return {...event,counterOrdinal:ordinal};
 });
}
/** Add Dashboard-observed incidents without duplicating a previously stored event. */
export function mergeDashboardTimelineEvents(previous,incoming){
 const byId=new Map();
 for(const event of Array.isArray(previous)?previous:[])if(event?.id!=null)byId.set(String(event.id),event);
 for(const event of Array.isArray(incoming)?incoming:[])if(event?.id!=null)byId.set(String(event.id),event);
 return [...byId.values()].sort(compareTimelineEvents);
}
/**
 * A blank/partial TimeLines response must not erase incidents already observed
 * from the dashboard or a previous provider snapshot. Only a category whose
 * event list reconciles with the same Match counters may replace that category.
 */
export function mergeProviderTimeline(previous,incoming,{verifiedKinds=[],rawTimelineTruncated=false}={}){
 if(!Array.isArray(incoming))return Array.isArray(previous)?previous:undefined;
 if(!Array.isArray(previous)||!previous.length)return incoming;
 const verified=new Set(rawTimelineTruncated?[]:verifiedKinds);
 const oldEvents=withTimelineOrdinals(previous),newEvents=withTimelineOrdinals(incoming);
 const oldByKey=new Map(oldEvents.map(event=>[
  [event.type,event.team,event.counterOrdinal].join('|'),event
 ]));
 const newKeys=new Set(newEvents.map(event=>
  [event.type,event.team,event.counterOrdinal].join('|')
 ));
 const output=[];
 // A reconciled category is replaced by the provider's authoritative list.
 for(const event of newEvents)if(verified.has(timelineKind(event)))output.push(event);
 // For incomplete categories, update matching provisional/previous entries
 // and preserve every prior incident not present in the partial response.
 for(const event of newEvents){
  if(verified.has(timelineKind(event)))continue;
  const key=[event.type,event.team,event.counterOrdinal].join('|');
  const old=oldByKey.get(key);
  output.push(old
   ?{...old,...event,source:'zizobet-timeline',provisional:false,timestampQuality:'provider-timeline'}
   :event);
 }
 for(const event of oldEvents){
  if(verified.has(timelineKind(event)))continue;
  const key=[event.type,event.team,event.counterOrdinal].join('|');
  if(!newKeys.has(key))output.push(event);
 }
 const unique=new Map();
 for(const event of output){
  const key=event?.id!=null?String(event.id):
   [event?.type,event?.team,event?.counterOrdinal,event?.minute,event?.addedMinute].join('|');
  unique.set(key,event);
 }
 return [...unique.values()].sort(compareTimelineEvents);
}

/** Reuse only player labels for the exact same provider incident.
 * An incoming correction owns the event list: removed goals, corners, cards
 * and fouls cannot reappear just because an old snapshot contained a name.
 */
export function inheritEventPlayers(incoming,previous){
 if(!Array.isArray(incoming))return incoming;
 if(!Array.isArray(previous)||!previous.length)return incoming;
 const key=event=>{
  if(event?.id==null||String(event.id)===''||!Number.isFinite(Number(event.minute)))return null;
  return JSON.stringify([String(event.matchId??''),String(event.id),event.type,event.team,Number(event.minute)]);
 };
 const known=new Map();
 for(const event of previous){
  const id=key(event),name=typeof event?.player==='string'?event.player.trim():'';
  if(!id||!name)continue;
  if(known.has(id)&&known.get(id)!==name)known.set(id,null);
  else if(!known.has(id))known.set(id,name);
 }
 return incoming.map(event=>{
  if(typeof event?.player==='string'&&event.player.trim())return event;
  const id=key(event),name=id?known.get(id):null;
  return name?{...event,player:name}:event;
 });
}
