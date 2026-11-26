import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {candidateDateStrings,fetchFotMobDate,fetchFotMobDetails,fotMobKickoff,findFotMobFixture,parseFotMobPayload,fotMobTransportStatus} from '../server/stats-providers/match-recovery.mjs';

const kickoff='2026-11-12T20:00:00.000Z',day='20261112';
const date={leagues:[{name:'Example League',matches:[
 {id:992011,home:{name:'FC Arsenal',shortName:'Arsenal'},
  away:{name:'Chelsea FC',shortName:'Chelsea'},time:'12.11.2026 21:00',
  status:{utcTime:kickoff,finished:false}},
 {id:992012,home:{name:'Chelsea',shortName:'CHE'},
  away:{name:'Arsenal',shortName:'ARS'},
  time:'12.11.2026 21:00',status:{utcTime:kickoff}},
 {id:992013,home:{name:'Arsenal Women'},
  away:{name:'Chelsea Women'},status:{utcTime:kickoff}}
]}]};
const dates=async()=>date;
assert.equal(fotMobKickoff(date.leagues[0].matches[0]),Date.parse(kickoff),
 'FotMob authoritative status.utcTime beats localized display-only time');
assert.equal(fotMobKickoff({time:{utcTime:kickoff}}),Date.parse(kickoff));
assert.equal(fotMobKickoff({time:{utc:'2026-11-12T21:00:00+01:00'}}),Date.parse(kickoff));
assert.equal(fotMobKickoff({time:'12.11.2026 21:00'}),null,
 'Never infer UTC from an ambiguous local-date display');
assert.equal(fotMobKickoff({time:'2026-11-12T21:00:00'}),null,
 'Timezone-free ISO text cannot confirm a financial fixture');
const found=await findFotMobFixture('Arsenal','Chelsea',[day],kickoff,{fetchDate:dates});
assert.equal(found.match.id,992011,'Home/away identities must retain order');
assert.equal(await findFotMobFixture('Chelsea','Arsenal',[day],kickoff,
 {fetchDate:dates}).then(f=>f?.match.id),992012);
assert.equal(await findFotMobFixture('Arsenal Women','Chelsea Women',[day],kickoff,
 {fetchDate:dates}).then(f=>f?.match.id),992013,
 'A women-team fixture is not interchangeable with the senior team');
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],
 '2026-11-12T23:00:00Z',{fetchDate:dates}),null,
 'Three-hour kickoff mismatch cannot authorize the wrong fixture');
const duplicate={leagues:[{name:'One',matches:[
 date.leagues[0].matches[0],
 {...date.leagues[0].matches[0],id:111222}
]}]};
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],kickoff,
 {fetchDate:async()=>duplicate}),null,'A second distinct ID must cause a hold');
const noNames={leagues:[{matches:[{id:22,home:{name:'Unrelated FC'},
 away:{name:'Chelsea FC'},status:{utcTime:kickoff}}]}]};
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],kickoff,
 {fetchDate:async()=>noNames}),null,'Fuzzy unrelated team identity never matches');
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],null,{fetchDate:dates}),null,
 'A missing original kickoff cannot authorize an external fixture');
assert.equal(await findFotMobFixture('Arsenal','Chelsea',[day],kickoff,
 {fetchDate:async()=>({leagues:[]})}),null);
// Provider label variants for the same senior club must resolve for every fixture lookup.
const interFixture={leagues:[{name:'Serie A',matches:[
 {id:887766,home:{name:'Inter FC',shortName:'Inter'},
  away:{name:'Cagliari Calcio',shortName:'Cagliari'},
  status:{utcTime:kickoff}}
]}]};
const inter=await findFotMobFixture('Inter Milan','Cagliari Calcio',[day],kickoff,
 {fetchDate:async()=>interFixture});
assert.equal(inter?.match.id,887766,
 'Zizobet Inter Milan must match FotMob Inter FC using the shared team identity');
assert.equal(await findFotMobFixture('Internazionale Milano','Cagliari',[day],kickoff,
 {fetchDate:async()=>interFixture}).then(x=>x?.match.id),887766,
 'Internazionale Milano must resolve to the same senior club');
assert.equal(await findFotMobFixture('Inter Miami','Cagliari',[day],kickoff,
 {fetchDate:async()=>interFixture}),null,
 'Inter Miami must never collapse into Inter Milan');
assert.equal(await findFotMobFixture('Inter Turku','Cagliari',[day],kickoff,
 {fetchDate:async()=>interFixture}),null,
 'Inter Turku must never collapse into Inter Milan');

console.log('PASS safe FotMob match discovery: UTC status time, aliases, home/away, kickoff, ambiguity and missing evidence');

if(process.env.FOTMOB_LIVE_VERIFY==='true'){
 const days=Math.min(10,Math.max(2,Number(process.env.FOTMOB_LIVE_VERIFY_DAYS)||7));
 const dates=Array.from({length:days},(_,index)=>{
  const day=new Date();day.setUTCHours(0,0,0,0);day.setUTCDate(day.getUTCDate()-index);
  return day.toISOString().slice(0,10).replaceAll('-','');
 });
 let verified=null,detailRequests=0;
 for(const day of dates){
  const payload=await fetchFotMobDate(day);
  if(!Array.isArray(payload?.leagues))continue;
  for(const league of payload.leagues){
   for(const match of league.matches??[]){
    if(match?.id==null||!match?.home?.name||!match?.away?.name||
       match.status?.finished!==true||fotMobKickoff(match)==null)continue;
    // A daily listing can contain AET fixtures before ordinary FT matches.
    // Check a bounded set of real detail responses and use only regulation FT.
    if(detailRequests>=12)break;
    detailRequests++;
    const details=await fetchFotMobDetails(match.id,{force:true});
    if(!details||typeof details!=='object')continue;
    const real=parseFotMobPayload(match,details);
    const eventList=details?.content?.matchFacts?.events?.events;
    if(!real.finished||!Number.isSafeInteger(real.homeScore)||
       !Number.isSafeInteger(real.awayScore)||!Array.isArray(eventList))continue;
    const kickoff=fotMobKickoff(match),kickoffIso=new Date(kickoff).toISOString();
    const matched=await findFotMobFixture(match.home.name,match.away.name,
     candidateDateStrings(kickoffIso),kickoffIso);
    if(String(matched?.match?.id??'')!==String(match.id))continue;
    verified={match,league:league.name??'Unknown league',details,real,kickoffIso};
    break;
   }
   if(verified||detailRequests>=12)break;
  }
  if(verified||detailRequests>=12)break;
 }
 assert.ok(verified,'FotMob live smoke could not find a real regulation-time finished fixture with matching details within the bounded sample');
 const {match,league,details,real,kickoffIso}=verified;
 const eventList=details.content.matchFacts.events.events;
const coverage=[
  ['corners',Number.isInteger(real.cornersHome)&&Number.isInteger(real.cornersAway)],
  ['cards',Number.isInteger(real.cardsHome)&&Number.isInteger(real.cardsAway)],
  ['yellow',real.yellowCards!=null],['red',real.redCards!=null],
  ['shots',real.statistics.shots?.home!=null&&real.statistics.shots?.away!=null],
  ['shotsOnTarget',real.statistics.shotsOnTarget?.home!=null&&real.statistics.shotsOnTarget?.away!=null],
  ['fouls',real.statistics.fouls?.home!=null&&real.statistics.fouls?.away!=null],
  ['possession',real.statistics.possession?.home!=null&&real.statistics.possession?.away!=null]
 ].filter(([,ok])=>ok).map(([name])=>name);
 console.log('PASS FOTMOB LIVE '+JSON.stringify({
  id:String(match.id),league:league,
  home:match.home.name,away:match.away.name,
  kickoff:kickoffIso,score:real.homeScore+'-'+real.awayScore,
  goalEvents:real.goalEvents.length,cornerEvents:real.cornerEvents.length,
  cardEvents:real.cardEvents.length,statistics:coverage
 }));
 const transport=fotMobTransportStatus();
 assert.equal(transport.paused,false,'FotMob did not rate-limit or block the successful live verification');
}

