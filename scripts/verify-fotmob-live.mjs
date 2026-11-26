import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {
 candidateDateStrings,fetchFotMobDate,fetchFotMobDetails,findFotMobFixture,
 fotMobKickoff,parseFotMobPayload,fotMobTransportStatus
} from '../server/stats-providers/match-recovery.mjs';

const days=Math.min(10,Math.max(2,Number(process.env.FOTMOB_VERIFY_DAYS)||7));
const dateKey=date=>date.toISOString().slice(0,10).replaceAll('-','');
const dayDates=Array.from({length:days},(_,i)=>{
 const value=new Date();
 value.setUTCHours(0,0,0,0);
 value.setUTCDate(value.getUTCDate()-i);
 return dateKey(value);
});
let selected=null;
for(const date of dayDates){
 const payload=await fetchFotMobDate(date);
 if(!Array.isArray(payload?.leagues))continue;
 const candidates=[];
 for(const league of payload.leagues){
  for(const match of league.matches??[]){
   if(match?.id==null||!match?.home?.name||!match?.away?.name)continue;
   if(match.status?.finished!==true)continue;
   const kickoff=fotMobKickoff(match);
   if(kickoff===null)continue;
   candidates.push({match,league:league.name??'Unknown league',kickoff,date});
  }
 }
 if(candidates.length){selected=candidates[0];break;}
}
if(!selected){
 const transport=fotMobTransportStatus();
 throw new Error('FOTMOB_LIVE_VERIFY_NO_FINISHED_FIXTURE '+JSON.stringify(transport));
}
const {match,league,kickoff}=selected;
const expected=new Date(kickoff).toISOString();
const found=await findFotMobFixture(match.home.name,match.away.name,
 candidateDateStrings(expected),expected);
assert.ok(found?.match?.id!=null,'A real FotMob fixture must be found again by strict home/away/UTC matching');
assert.equal(String(found.match.id),String(match.id),
 'Fixture discovery must return the same unique FotMob ID, never another match with similar names');

const details=await fetchFotMobDetails(match.id,{force:true});
assert.ok(details&&typeof details==='object','FotMob matchDetails must return a JSON object');
const parsed=parseFotMobPayload(match,details);
assert.equal(parsed.finished,true,'The selected real match must be final at the details endpoint');
assert.ok(Number.isSafeInteger(parsed.homeScore)&&Number.isSafeInteger(parsed.awayScore),
 'The real FotMob response must expose both final score counters');
const eventList=details?.content?.matchFacts?.events?.events;
const statCoverage=[
 ['corners',Number.isInteger(parsed.cornersHome)&&Number.isInteger(parsed.cornersAway)],
 ['cards',Number.isInteger(parsed.cardsHome)&&Number.isInteger(parsed.cardsAway)],
 ['yellow',parsed.yellowCards!=null],
 ['red',parsed.redCards!=null],
 ['shots',parsed.statistics.shots?.home!=null&&parsed.statistics.shots?.away!=null],
 ['shotsOnTarget',parsed.statistics.shotsOnTarget?.home!=null&&parsed.statistics.shotsOnTarget?.away!=null],
 ['fouls',parsed.statistics.fouls?.home!=null&&parsed.statistics.fouls?.away!=null],
 ['possession',parsed.statistics.possession?.home!=null&&parsed.statistics.possession?.away!=null]
];
const summary={
 matchId:String(match.id),league,
 home:match.home.name,away:match.away.name,
 kickoff:expected,score:`${parsed.homeScore}-${parsed.awayScore}`,
 eventListAvailable:Array.isArray(eventList),
 goals:parsed.goalEvents.length,
 corners:parsed.cornerEvents.length,
 cards:parsed.cardEvents.length,
 statisticFields:statCoverage.filter(([,available])=>available).map(([name])=>name)
};
console.log('PASS FOTMOB LIVE FIXTURE '+JSON.stringify(summary));
assert.ok(summary.eventListAvailable,
 'The real match details must expose the incident-list structure used by settlement recovery');
