import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {projectZizobetHistory,createZizobetHistoryArchive} from '../server/ledger/zizobet-match-history.mjs';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {startZizoFeed,timelineCounterMismatches} from '../server/zizobet-feed.mjs';
import {providerTimeline} from '../server/live-event-timeline.mjs';

const game=(score,clock,events,extra={})=>({
 Match:{GameID:7,Score:score,MatchTimeExtended:clock,MatchStatusID:10,EventStatus:10,
  CornersTeam1:0,CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0,...extra},
 TimeLines:events, gmk:[{v:99.9,mid:602}], hprs:[{v:88.8}]
});
const g1={id:'goal-1',type:'score_change',gt:10,clk:'10:05',team:1,
 player_name:'First Scorer'};
const g2={id:'goal-2',type:'score_change',gt:22,clk:'22:44',team:2,
 pl:'Second Scorer'};
const fixture={home:'Home United',away:'Away United',start_at:'2026-11-12T12:00:00Z'};

const projected=projectZizobetHistory(8000000000007,game('1:0','11:00',[g1]),fixture);
assert.equal(projected.events[0].playerName,'First Scorer',
 'The financial/parser path must recognize the same actor fields as the live UI');
assert.equal(projected.events[0].minute,10);
assert.equal(projected.events[0].minuteLabel,'10');
const lateCorners=normalizeLiveFrame({
 Match:{...game('0:0','90:00',[]).Match,MatchStatusID:40,EventStatus:40,
  MatchTimeExtended:'90:00',CornersTeam1:1,CornersTeam2:1},
 TimeLines:[
  {id:'late-corner-alias',type:'Corner',gt:'92',clk:'92:15',team:1},
  {id:'late-corner-native',type:'corner_kick',gt:'95',clk:'95:44',team:2}
 ]
});
assert.deepEqual(lateCorners.events.map(event=>[event.type,event.minute]),
 [['corner',92],['corner',95]],
 'Zizobet corner event types and 92/95-minute incidents enter primary event facts');

assert.equal(lateCorners.coverage.cornerThrough,130,
 'A reconciled FT event list with final 1-1 corner counters covers stoppage time');

// Some Zizobet incidents encode added time as the rounded next minute plus
// a clock still inside 45:xx / 90:xx instead of explicit "45+1"/"90+1".
const firstHalfAdded={
 Match:{Score:'1:0',MatchTimeExtended:'45:56',EventStatus:10,MatchStatusID:10,
  CornersTeam1:1,CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0},
 TimeLines:[
  {id:'goal-45-added',type:'score_change',team:1,gt:'46',clk:'45:56'},
  {id:'corner-45-added',type:'corner_kick',team:2,gt:'46',clk:'45:56'}
 ]
};
const firstHalfFrame=normalizeLiveFrame(firstHalfAdded);
assert.deepEqual(firstHalfFrame.events.map(e=>[e.type,e.minute,e.minuteLabel,e.phase]),[
 ['goal',46,'45+1','1st half'],['corner',46,'45+1','1st half']
],'gt=46 plus clk=45:56 must be recognized as first-half added time');
const firstHalfDisplay=providerTimeline(9001,firstHalfAdded.TimeLines,firstHalfAdded.Match);
assert.deepEqual(firstHalfDisplay.map(e=>[e.minute,e.addedMinute,e.minuteLabel,e.phase]),[
 [45,1,'45+1','1st half'],[45,1,'45+1','1st half']
],'The live display and settlement parser must use the same first-half added-time interpretation');

const secondHalfAdded={
 Match:{Score:'1:1',MatchTimeExtended:'90:18',EventStatus:10,MatchStatusID:10,
  CornersTeam1:0,CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0},
 TimeLines:[{id:'goal-90-added',type:'score_change',team:2,gt:'91',clk:'90:18'}]
};
const secondHalfFrame=normalizeLiveFrame(secondHalfAdded);
assert.deepEqual(secondHalfFrame.events.map(e=>[e.minute,e.minuteLabel,e.phase]),[
 [91,'90+1','2nd half']
],'gt=91 plus clk=90:18 must be recognized as second-half added time');
const secondHalfDisplay=providerTimeline(9002,secondHalfAdded.TimeLines,secondHalfAdded.Match);
assert.deepEqual(secondHalfDisplay.map(e=>[e.minute,e.addedMinute,e.minuteLabel,e.phase]),[
 [90,1,'90+1','2nd half']
],'The displayed 90+1 incident must retain second-half phase evidence');

// Exact duplicate Zizobet rows can represent two provider-counted incidents.
// Keep both from normalization through the independent history archive.
const repeatedCorners=[
 {id:'inter-45-corner',type:'corner_kick',team:1,gt:'45',clk:'45:00',pl:'Dimarco'},
 {id:'inter-45-corner',type:'corner_kick',team:1,gt:'45',clk:'45:00',pl:'Dimarco'}
];
const repeatedData=game('0:0','47:00',repeatedCorners,{CornersTeam1:2});
const repeatedFrame=normalizeLiveFrame(repeatedData);
assert.equal(repeatedFrame.events.filter(event=>event.type==='corner').length,2,
 'Both same-ID, same-clock corner rows survive the canonical frame');
assert.deepEqual(repeatedFrame.events.filter(event=>event.type==='corner').map(event=>event.sequence),[1,2]);
const repeatedProjection=projectZizobetHistory(8000000000017,repeatedData,fixture);
assert.equal(repeatedProjection.events.filter(event=>event.kind==='corner').length,2,
 'Both same-ID, same-clock corners are projected into match history');
assert.deepEqual(repeatedProjection.events.filter(event=>event.kind==='corner').map(event=>event.sequence),[1,2]);

const withFoul=projectZizobetHistory(8000000000007,game('1:0','11:00',[g1,
 {id:'foul-1',type:'foul_committed',team:2,gt:11,player:'Defender'}]),fixture);
assert.equal(withFoul.events.find(e=>e.kind==='foul')?.playerName,'Defender');
assert.deepEqual(projected.verifiedKinds,['goal','corner','card']);
const withPeriods=projectZizobetHistory(8000000000007,{...game('1:0','11:00',[g1]),
 Match:{...game('1:0','11:00',[g1]).Match,SetScores:['1:0','0:1']}},fixture);
assert.deepEqual(withPeriods.details.periodScores,[{home:1,away:0},{home:0,away:1}]);
assert.doesNotMatch(JSON.stringify(projected),/99\.9|88\.8|gmk|hprs/,
 'Never archive coefficients, only sporting facts');
assert.match(LEDGER_SQL,/app_zizobet_match_incident/);

const pg=new PGlite();
try{
 await pg.exec(LEDGER_SQL);
 const database={connect:async()=>({query:(sql,args=[])=>pg.query(sql,args),release(){}})};
 let clock=Date.parse('2026-11-12T12:11:00Z');
 const save=createZizobetHistoryArchive({database,now:()=>new Date(clock)});
 const id=8000000000007;
 const read=sql=>pg.query(sql,[id]);
 const initial=await save(id,game('1:0','11:00',[g1]),fixture);
 assert.equal(initial.stored,true);
 assert.equal(initial.confirmedKinds.length,0,'One upstream sample cannot confirm financial evidence');
 clock+=6000;
 const repeated=await save(id,game('1:0','11:00',[g1]),fixture);
 assert.equal(repeated.stored,false,'Identical sports summaries are not repeatedly written');
 assert.equal(repeated.reason,'EVIDENCE_REOBSERVED');
 assert.ok(repeated.confirmedKinds.includes('goal'),
  'A second identical provider sample must confirm canonical evidence');

 // The Inter-like duplicate timeline must create two independently keyed
 // archive rows even though ID, minute, clock and player are all identical.
 const duplicateMatchId=id+17;
 const firstDuplicate=await save(duplicateMatchId,repeatedData,fixture);
 assert.equal(firstDuplicate.eventCount,2);
 clock+=6000;
 const secondDuplicate=await save(duplicateMatchId,repeatedData,fixture);
 assert.ok(secondDuplicate.confirmedKinds.includes('corner'));
 const duplicateRows=(await pg.query(
  'select provider_event_id,sequence,minute,detail from app_zizobet_match_incident where match_id=$1 and kind=\'corner\' and active=true order by sequence',
  [duplicateMatchId])).rows;
 assert.deepEqual(duplicateRows.map(r=>[r.provider_event_id,r.sequence,r.minute]),[
  ['inter-45-corner',1,45],['inter-45-corner#000002',2,45]
 ],'Historical archive persists both repeated-ID incidents and their sequence');
 assert.deepEqual(duplicateRows.map(r=>r.detail.playerName),['Dimarco','Dimarco']);
 let rows=(await read('select kind,minute,detail,active from app_zizobet_match_incident where match_id=$1')).rows;
 assert.equal(rows.length,1);
 assert.equal(rows[0].detail.playerName,'First Scorer');
 let summary=(await read('select details from app_zizobet_match_history where match_id=$1')).rows[0].details;
 assert.deepEqual(summary.goals,{home:1,away:0});
 assert.equal(summary.home,'Home United');
 assert.equal(summary.corners.home,0);
 assert.ok(!('odds' in summary) && !('gmk' in summary));

 clock+=60000;
 await save(id,game('1:1','23:00',[g1,g2]),fixture);
 rows=(await read('select kind,minute,detail,active from app_zizobet_match_incident where match_id=$1 order by minute')).rows;
 assert.equal(rows.length,2);
 assert.equal(rows[1].detail.playerName,'Second Scorer');
 // Missing TimeLines does not erase previously archived incidents.
 clock+=60000;
 const noTimeline=game('1:1','24:00',undefined);
 delete noTimeline.TimeLines;
 await save(id,noTimeline,fixture);
 assert.equal((await read('select count(*)::int as n from app_zizobet_match_incident where match_id=$1 and active')).rows[0].n,2);
 summary=(await read('select details from app_zizobet_match_history where match_id=$1')).rows[0].details;
 assert.equal(summary.clockMinute,24);

 // Explicitly corrected complete timeline can deactivate a rescinded goal.
 clock+=60000;
 await save(id,game('1:0','25:00',[g1]),fixture);
 rows=(await read('select provider_event_id,active from app_zizobet_match_incident where match_id=$1 order by provider_event_id')).rows;
 assert.deepEqual(rows.map(r=>[r.provider_event_id,r.active]),
  [['goal-1',true],['goal-2',false]]);
 // Incomplete provider counts cannot retire any previous event.
 clock+=60000;
 await save(id,game('2:0','26:00',[g1]),fixture);
 assert.equal((await read("select active from app_zizobet_match_incident where match_id=$1 and provider_event_id='goal-1'")).rows[0].active,true);
 // Other matches have no ticket at all, yet they are archived independently.
 clock+=60000;
 await save(id+1,game('0:0','12:00',[]),{...fixture,home:'Other'});
 assert.equal((await pg.query('select count(*)::int as n from app_zizobet_match_history')).rows[0].n,3,
  'Original, duplicate-corner regression and independent fixture are archived separately');
}finally{await pg.close();}

// A fixture without a visitor or pending ticket still enters the detail poll.
const teams=[{ID:1,Name:'Home United',Sport:1},{ID:2,Name:'Away United',Sport:1}];
const regions=[{ID:1,Name:'England'}],champs=[{ID:1,Name:'Premier League'}];
const games=Array.from({length:5},(_,i)=>({
 ID:i+1,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,
 MatchStatusID:10,Score:'0:0',MatchTime:15,StartTime:'2026-11-12T12:00:00Z'
}));
const archiveCalls=[],detailReads=[],oddsCalls=[];
let now=Date.parse('2026-11-12T12:15:00Z');
const request=async url=>{
 if(url.includes('getheader/teams'))return teams;
 if(url.includes('getlivemarkets'))return {StatusNames:[{it:'1_10',nm:'1st half'}],PositionNames:[],MarketNames:[]};
 if(url.includes('getprematchmarketsbysport'))return [Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
 if(url.includes('headerformobilenew'))return {Games:games,Teams:teams,Regions:regions,Championats:champs};
 if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
 const id=Number(url.match(/live\/gamenew\/(\d+)/)?.[1]);
 if(id){detailReads.push(id);
  const response={...game('0:0','15:00',[]),Match:{...game('0:0','15:00',[]).Match,GameID:id}};
  if(id===5)delete response.gmk; // Suspended match still has real history.
  return response;
 }
 throw Error('Unexpected provider request '+url);
};
const feed=startZizoFeed({
 autoStart:false,historyEnabled:true,now:()=>now,request,
 archiveHistory:async (id,raw)=>{archiveCalls.push({id,raw});},
 connectMqtt:()=>({setLiveIds(){},stop(){},pause(){},resume(){}}),
 getWatchedIds:()=>[],onMatch:()=>{},onInfo:()=>{},onOdds:rows=>oddsCalls.push(rows)
});
try{
 await feed.tick();
 assert.deepEqual(detailReads,[1,2,3,4,5],
  'The larger bounded batch polls every fixture without leaving a growing queue');
 await feed.tick();
 assert.deepEqual(detailReads,[1,2,3,4,5],
  'The same fixtures are not fetched again before their next history interval');
 assert.equal(archiveCalls.length,5);
 assert.equal(oddsCalls.length,0,
  'Archive-only refresh must never publish new market odds');
 assert.ok(archiveCalls.every(v=>!('gmk' in v.raw)&&!('hprs' in v.raw)));
 now+=31000;
 await feed.tick();
 assert.equal(archiveCalls.length,10,'Background chronology is re-polled on the shorter 30-second interval');
}finally{feed.stop();await feed.drain();}

{
 // A status/period transition must refresh the full timeline immediately,
 // even when score, corners and cards have not changed at half-time.
 let at=Date.parse('2026-11-12T12:45:00Z');
 let status=10,clock=45,events=[];
 let detailReads=0;
 const publishedInfos=[];
 const liveHeader=()=>({
  ID:32,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,
  MatchStatusID:status,Score:'0:0',MatchTime:clock,MatchTimeExtended:String(clock).padStart(2,'0')+':00',
  StartTime:'2026-11-12T12:00:00Z',
  CornersTeam1:0,CornersTeam2:0,
  YellowCardsTeam1:0,YellowCardsTeam2:0,RedCardsTeam1:0,RedCardsTeam2:0
 });
 const request=async url=>{
  if(url.includes('getheader/teams'))return teams;
  if(url.includes('getlivemarkets'))return {StatusNames:[
   {it:'1_10',nm:'1st half'},{it:'1_12',nm:'Half time'},{it:'1_20',nm:'2nd half'}
  ],PositionNames:[],MarketNames:[]};
  if(url.includes('getprematchmarketsbysport'))return [Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
  if(url.includes('headerformobilenew'))return {Games:[liveHeader()],Teams:teams,Regions:regions,Championats:champs};
  if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
  if(url.includes('live/gamenew/32')){
   detailReads++;
   return {Match:{...liveHeader(),GameID:32,EventStatus:status},TimeLines:events,gmk:[]};
  }
  throw Error('Unexpected phase-change request '+url);
 };
 const phaseFeed=startZizoFeed({
  autoStart:false,historyEnabled:true,now:()=>at,request,
  archiveHistory:async()=>({stored:true,confirmedKinds:[]}),
  connectMqtt:()=>({setLiveIds(){},stop(){},pause(){},resume(){}}),
  onMatch(){},onInfo:info=>publishedInfos.push(info),onOdds(){}
 });
 try{
  await phaseFeed.tick();
  assert.equal(detailReads,1,'Initial live history snapshot is fetched');
  status=12; // Half-time status, with no score/statistic delta.
  events=[{id:'goal-32a',type:'score_change',gt:45,team:1}];
  at+=5000;
  await phaseFeed.tick();
  assert.equal(detailReads,2,'Entering half-time forces a new TimeLines request');
  assert.ok(publishedInfos.at(-1).events.some(event=>event.id==='goal-32a'),
   'The updated event list is published immediately after the phase transition');
  status=20;clock=46;
  events.push({id:'goal-32b',type:'score_change',gt:46,team:2});
  at+=5000;
  await phaseFeed.tick();
  assert.equal(detailReads,3,'Entering the second half also forces a new TimeLines request');
  assert.ok(publishedInfos.at(-1).events.some(event=>event.id==='goal-32b'),
   'Second-half events reach the published live chronology');
 }finally{phaseFeed.stop();await phaseFeed.drain();}
}

{
 // Pending-ticket matches use a short dedicated history cadence, independent
 // of the slower all-match archive rotation.
 let at=Date.parse('2026-11-12T13:00:00Z'),detailReads=0;
 const id=33;
 const liveHeader=()=>({
  ID:id,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,
  MatchStatusID:10,Score:'0:0',MatchTime:35,StartTime:'2026-11-12T12:25:00Z',
  CornersTeam1:0,CornersTeam2:0,YellowCardsTeam1:0,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0
 });
 const request=async url=>{
  if(url.includes('getheader/teams'))return teams;
  if(url.includes('getlivemarkets'))return {StatusNames:[{it:'1_10',nm:'1st half'}],PositionNames:[],MarketNames:[]};
  if(url.includes('getprematchmarketsbysport'))return [Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
  if(url.includes('headerformobilenew'))return {Games:[liveHeader()],Teams:teams,Regions:regions,Championats:champs};
  if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
  if(url.includes('live/gamenew/33')){
   detailReads++;
   return {Match:{...liveHeader(),GameID:id,EventStatus:10},TimeLines:[],gmk:[]};
  }
  throw Error('Unexpected watched-match request '+url);
 };
 const watchedFeed=startZizoFeed({
  autoStart:false,historyEnabled:true,now:()=>at,request,
  getWatchedIds:()=>[8000000000000+id],
  archiveHistory:async()=>({stored:true,confirmedKinds:[]}),
  connectMqtt:()=>({setLiveIds(){},stop(){},pause(){},resume(){}}),
  onMatch(){},onInfo(){},onOdds(){}
 });
 try{
  await watchedFeed.tick();
  assert.equal(detailReads,1,'Watched match receives its initial full timeline');
  at+=9000;
  await watchedFeed.tick();
  assert.equal(detailReads,2,'Pending-ticket timeline is re-polled inside 10 seconds');
 }finally{watchedFeed.stop();await watchedFeed.drain();}
}

{
 // A correct dashboard counter with an incomplete TimeLines list must cause
 // bounded quick re-polls until the provider timeline catches up.
 const mismatchMatch={
  Score:'0:0',MatchTime:37,MatchTimeExtended:'37:00',
  EventStatus:10,MatchStatusID:10,
  CornersTeam1:1,CornersTeam2:0,
  YellowCardsTeam1:0,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0
 };
 assert.deepEqual(timelineCounterMismatches({Match:mismatchMatch,TimeLines:[]}),['corner'],
  'The raw timeline/counter mismatch is identified without fabricating a corner minute');
 let at=Date.parse('2026-11-12T13:00:00Z'),detailReads=0,events=[];
 const liveHeader=()=>({
  ID:34,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,
  MatchStatusID:10,Score:'0:0',MatchTime:37,StartTime:'2026-11-12T12:23:00Z',
  CornersTeam1:1,CornersTeam2:0,
  YellowCardsTeam1:0,YellowCardsTeam2:0,RedCardsTeam1:0,RedCardsTeam2:0
 });
 const archiveCalls=[];
 const request=async url=>{
  if(url.includes('getheader/teams'))return teams;
  if(url.includes('getlivemarkets'))return {StatusNames:[{it:'1_10',nm:'1st half'}],PositionNames:[],MarketNames:[]};
  if(url.includes('getprematchmarketsbysport'))return [Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
  if(url.includes('headerformobilenew'))return {Games:[liveHeader()],Teams:teams,Regions:regions,Championats:champs};
  if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
  if(url.includes('live/gamenew/34')){
   detailReads++;
   return {Match:{...liveHeader(),GameID:34,EventStatus:10},TimeLines:events,gmk:[]};
  }
  throw Error('Unexpected incomplete-timeline request '+url);
 };
 const mismatchFeed=startZizoFeed({
  autoStart:false,historyEnabled:true,now:()=>at,request,
  archiveHistory:async(id,raw)=>{archiveCalls.push({id,raw});return {stored:true,confirmedKinds:[]};},
  connectMqtt:()=>({setLiveIds(){},stop(){},pause(){},resume(){}}),
  onMatch(){},onInfo(){},onOdds(){}
 });
 try{
  await mismatchFeed.tick();
  assert.equal(detailReads,1,'Initial raw timeline is captured');
  at+=5000;
  await mismatchFeed.tick();
  assert.equal(detailReads,2,'A scoreboard counter change immediately requests the raw timeline');
  at+=5000;
  await mismatchFeed.tick();
  assert.equal(detailReads,2,'Mismatch retry waits for its short bounded delay');
  at+=1000;
  await mismatchFeed.tick();
  assert.equal(detailReads,3,'An unreconciled corner total is retried after about six seconds');
  events=[{id:'corner-34',type:'corner_kick',team:1,gt:'37',clk:'37:10'}];
  at+=6000;
  await mismatchFeed.tick();
  assert.equal(detailReads,4,'The next poll sees the provider's corrected incident list');
  assert.ok(archiveCalls.at(-1).raw.TimeLines.some(event=>event.id==='corner-34'),
   'The newly published provider incident reaches the history archive');
  at+=6000;
  await mismatchFeed.tick();
  assert.equal(detailReads,4,'Once counters reconcile, the short retry loop stops');
 }finally{mismatchFeed.stop();await mismatchFeed.drain();}
}

{
 // A goal/corner change in the fast live header must bypass the 60-second
 // background-history interval and fetch the full TimeLines snapshot now.
 let at=Date.parse('2026-11-12T13:00:00Z');
 let score='0:0',homeCorners=0,events=[];
 let detailReads=0;
 const publishedInfos=[];
 const liveHeader=()=>({
  ID:31,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,
  MatchStatusID:10,Score:score,MatchTime:35,StartTime:'2026-11-12T12:25:00Z',
  CornersTeam1:homeCorners,CornersTeam2:0,
  YellowCardsTeam1:0,YellowCardsTeam2:0,RedCardsTeam1:0,RedCardsTeam2:0
 });
 const request=async url=>{
  if(url.includes('getheader/teams'))return teams;
  if(url.includes('getlivemarkets'))return {StatusNames:[{it:'1_10',nm:'1st half'}],PositionNames:[],MarketNames:[]};
  if(url.includes('getprematchmarketsbysport'))return [Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
  if(url.includes('headerformobilenew'))return {Games:[liveHeader()],Teams:teams,Regions:regions,Championats:champs};
  if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
  if(url.includes('live/gamenew/31')){
   detailReads++;
   return {Match:{...liveHeader(),GameID:31,EventStatus:10},TimeLines:events,gmk:[]};
  }
  throw Error('Unexpected event-trigger request '+url);
 };
 const liveFeed=startZizoFeed({
  autoStart:false,historyEnabled:true,now:()=>at,request,
  archiveHistory:async()=>({stored:true,confirmedKinds:[]}),
  connectMqtt:()=>({setLiveIds(){},stop(){},pause(){},resume(){}}),
  onMatch(){},onInfo:info=>publishedInfos.push(info),onOdds(){}
 });
 try{
  await liveFeed.tick();
  assert.equal(detailReads,1,'Initial background history snapshot is fetched');
  assert.deepEqual(publishedInfos.at(-1).events,[]);
  // The header already knows the new score and corner count. The incident list
  // arrives in the following full detail request without waiting a minute.
  score='1:0';homeCorners=1;
  events=[
   {id:'goal-31',type:'score_change',gt:36,team:1,player_name:'Scorer'},
   {id:'corner-31',type:'corner_kick',gt:37,team:1}
  ];
  at+=15000;
  await liveFeed.tick();
  assert.equal(detailReads,2,'A header score/stat change immediately fetches a fresh TimeLines detail');
  assert.deepEqual(publishedInfos.at(-1).events.map(e=>e.type),['goal','corner']);
  assert.deepEqual(publishedInfos.at(-1).events.map(e=>e.minute),[36,37]);
  await liveFeed.tick();
  assert.equal(detailReads,2,'Unchanged score and incident counters do not cause another detail request');
 }finally{liveFeed.stop();await liveFeed.drain();}
}


{
 // A provider may publish stoppage-time incidents after its first FT frame.
 // Continue polling for a fixed 45-minute recovery window even if coverage
 // remains incomplete; expiry never authorizes a financial result.
 const teams=[{ID:1,Name:'Home United',Sport:1},{ID:2,Name:'Away United',Sport:1}];
 const regions=[{ID:1,Name:'England'}],champs=[{ID:1,Name:'Premier League'}];
 const finishedHeader=()=>({
  ID:77,Sport:1,Team1:1,Team2:2,Region:1,Champ:1,MatchStatusID:40,
  Score:'2:1',MatchTime:90,StartTime:'2026-11-12T12:00:00Z',
  CornersTeam1:4,CornersTeam2:3,YellowCardsTeam1:1,YellowCardsTeam2:0,
  RedCardsTeam1:0,RedCardsTeam2:0
 });
 let now=Date.parse('2026-11-12T14:00:00Z'),detailReads=0;
 const archiveCalls=[],infos=[];
 const request=async url=>{
  if(url.includes('getheader/teams'))return teams;
  if(url.includes('getlivemarkets'))return {StatusNames:[{it:'1_10',nm:'1st half'}],PositionNames:[],MarketNames:[]};
  if(url.includes('getprematchmarketsbysport'))return [Object.fromEntries(Array.from({length:11},(_,i)=>[i+1,{ID:i+1,Name:'Result'}]))];
  if(url.includes('headerformobilenew'))return {Games:[finishedHeader()],Teams:teams,Regions:regions,Championats:champs};
  if(url.includes('sport/getheader/en'))return {EN:{Sports:{1:{Regions:{}}}}};
  if(url.includes('live/gamenew/77')){
   detailReads++;
   const timeline=[{id:'goal-90',type:'score_change',gt:89,team:1}];
   if(detailReads>=3)timeline.push({id:'goal-90-plus-3',type:'score_change',gt:'90+3',team:2});
   if(detailReads>=5)timeline.push({id:'goal-90-plus-6',type:'score_change',gt:'90+6',team:1});
   return {Match:{...finishedHeader(),GameID:77,EventStatus:40,
    MatchStatusID:40,MatchTimeExtended:'90:00'},TimeLines:timeline,gmk:[]};
  }
  throw Error('Unexpected post-FT history request '+url);
 };
 const feed=startZizoFeed({
  autoStart:false,historyEnabled:true,now:()=>now,request,
  archiveHistory:async(id,raw)=>{
   archiveCalls.push({id,raw});
   const confirmedKinds=archiveCalls.length>=2?['goal','corner','card']:[];
   return {stored:archiveCalls.length===1||archiveCalls.length>=3,
    verifiedKinds:['goal','corner','card'],confirmedKinds};
  },
  connectMqtt:()=>({setLiveIds(){},stop(){},pause(){},resume(){}}),
  getWatchedIds:()=>[],onMatch(){},onInfo:info=>infos.push(info),onOdds(){}
 });
 try{
  await feed.tick();
  assert.equal(detailReads,1,'FT fixture receives its first native detail snapshot');
  now+=61000;
  await feed.tick();
  assert.equal(detailReads,2,'second FT observation confirms the initial timeline');
  now+=61000;
  await feed.tick();
  assert.equal(detailReads,3,'confirmed FT does not immediately stop chronology polling');
  assert.ok(archiveCalls[2].raw.TimeLines.some(event=>event.gt==='90+3'),
   'the delayed 90+ incident is passed to the history archive');
  assert.ok(infos.at(-1).events.some(event=>event.minuteLabel==='90+3'),
   'the admin-facing match timeline receives the delayed 90+ event');
  now+=11*60_000;
  await feed.tick();
  assert.equal(detailReads,4,'An incomplete FT timeline continues to be polled within 45 minutes');
  now+=30*60_000;
  await feed.tick();
  assert.equal(detailReads,5,'Late 90+ corrections are still fetched near the end of the recovery window');
  assert.ok(archiveCalls[4].raw.TimeLines.some(event=>event.gt==='90+6'),
   'the late correction reaches the archive before polling expires');
  now+=6*60_000;
  await feed.tick();
  assert.equal(detailReads,5,'Post-FT polling stops after the fixed 45-minute bound');
 }finally{feed.stop();await feed.drain();}
}

console.log('PASS all-match Zizobet history, actor minute labels, 45-minute FT recovery bound, corrections and odds exclusion');
