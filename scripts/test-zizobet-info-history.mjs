import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {providerTimeline} from '../server/live-event-timeline.mjs';
import {normalizeLiveFrame} from '../server/ledger/live-observation-store.mjs';
import {projectZizobetHistory} from '../server/ledger/zizobet-match-history.mjs';
import {shouldProcessFinalHistoryDetail,postFinalHistoryRetryDelay} from '../server/zizobet-feed.mjs';
import {infoOf,oddsOf,resolveMarketTitle} from '../server/zizobet/normalize.mjs';
import {providerResultPair,teamStatisticsFromRow} from '../server/match-statistics.mjs';

const raw=Array.from({length:12},(_,i)=>({
 id:'c'+i,type:'corner_kick',team:i%2===0?1:2,gt:i*6+1
}));
const displayed=providerTimeline('123',raw);
assert.equal(displayed.length,12,'Provider timeline retains all 12 events, never last eight');
assert.equal(displayed[0].minute,1);
assert.equal(displayed.at(-1).minute,67);
const frame=normalizeLiveFrame({
 Match:{Score:'0:0',MatchTimeExtended:'79:00',CornersTeam1:6,CornersTeam2:6},
 TimeLines:raw
});
assert.equal(frame.events.filter(e=>e.type==='corner').length,12,
 'All first-to-last corners remain in the evidence used for ticket grading');
assert.equal(frame.coverage.cornerThrough,79,'All twelve corners reconcile to scoreboard');

const cornerGame={EventStatus:40,MatchStatusID:40,Score:'1:0',
 RESULT_CORNERHT:'4:2',RESULT_CORNERFT:'10:3'};
assert.deepEqual(providerResultPair(cornerGame,'RESULT_CORNERHT'),{home:4,away:2});
assert.deepEqual(providerResultPair(cornerGame,'RESULT_CORNERFT'),{home:10,away:3});
const cornerInfo=infoOf({match_id:8081,service:'LIVE'},cornerGame,{statuses:new Map()});
assert.deepEqual(cornerInfo.stats.home,{corners:10,cornersHT:4,cornersFT:10,corners2H:6});
assert.deepEqual(cornerInfo.stats.away,{corners:3,cornersHT:2,cornersFT:3,corners2H:1});
const cornerTeams=teamStatisticsFromRow({
 raw:{homeTeam:{id:'home'},awayTeam:{id:'away'}},
 stats:{home:cornerInfo.stats.home,away:cornerInfo.stats.away}
});
assert.equal(cornerTeams.home.cornersHT,4);
assert.equal(cornerTeams.away.cornersFT,3);
const officialFinalFrame=normalizeLiveFrame({Match:{
 ...cornerGame,MatchTimeExtended:'90:00'
}});
assert.deepEqual(officialFinalFrame.teams.corner,{home:10,away:3});
assert.deepEqual(officialFinalFrame.cornerPeriods,{
 firstHalf:{home:4,away:2},secondHalf:{home:6,away:1},fullTime:{home:10,away:3}
});


const endedTimeline=[
 ...[[1,2],[45,2],[52,2]].map(([minute,team],i)=>({id:'away-c'+i,type:'corner_kick',team,gt:minute})),
 ...[[8,1],[10,1],[19,1],[30,1],[65,1],[69,1],[70,1],[71,1],[77,1],[85,1]].map(([minute,team],i)=>({id:'home-c'+i,type:'corner_kick',team,gt:minute}))
];
const noClockFinal=normalizeLiveFrame({Match:cornerGame,TimeLines:endedTimeline});
assert.equal(noClockFinal.clock,130,'An authoritative FT result closes event coverage without a clock');
assert.equal(noClockFinal.coverage.cornerThrough,130,
 'RESULT_CORNERFT reconciles the complete final corner timeline when the clock is omitted');

// Stoppage-time incidents are still part of regular-time settlement. This
// reproduces the reported 15 -> 17 corner case: two incidents arrive at 91' and 94'.
const lateTimeline=[
 ...Array.from({length:15},(_,i)=>({
  id:'pre-late-'+i,type:'corner_kick',team:i<8?1:2,gt:String(5+i*5)
 })),
 {id:'corner-91',type:'corner_kick',team:1,gt:'90',clk:'91:20'},
 {id:'corner-94',type:'corner_kick',team:2,gt:'90+4',clk:'94:06'}
];
const shownLate=providerTimeline('late-match',lateTimeline);
assert.equal(shownLate.length,17,'All 17 corners must remain in the displayed history');
assert.deepEqual(shownLate.slice(-2).map(e=>[e.minute,e.minuteLabel]),[
 [91,'90+1'],[94,'90+4']
],'gt=90 with a later clk and explicit 90+4 must retain stoppage time');
const lateMatch={MatchStatusID:40,Score:'1:0',CornersTeam1:8,CornersTeam2:7,
 RESULT_CORNERFT:'9:8'};
const lateData={Match:lateMatch,TimeLines:lateTimeline};
const lateFrame=normalizeLiveFrame(lateData);
assert.equal(lateFrame.ended,true,'MatchStatusID=40 is sufficient FT evidence');
assert.deepEqual(lateFrame.teams.corner,{home:9,away:8},
 'Use the final 17-corner provider counter, not the stale pre-90 counter');
assert.equal(lateFrame.events.filter(e=>e.type==='corner').length,17);
assert.equal(lateFrame.coverage.cornerThrough,130,
 'A reconciled final timeline covers stoppage time even when no final clock is supplied');
const lateHistory=projectZizobetHistory(8099,lateData,{home:'Inter',away:'Opponent'});
assert.ok(lateHistory.verifiedKinds.includes('corner'),
 'The 15+2 chronology reconciles and becomes verified Zizobet corner facts');
assert.equal(lateHistory.events.at(-2).minute,91);
assert.equal(lateHistory.events.at(-1).minute,94);

// A header can mark FT via MatchStatusID while the detailed endpoint omits
// EventStatus. That detail must be archived rather than silently discarded.
assert.equal(shouldProcessFinalHistoryDetail('ended',{MatchStatusID:40}),true);
assert.equal(shouldProcessFinalHistoryDetail('ended',{EventStatus:40}),true);
assert.equal(shouldProcessFinalHistoryDetail('ended',{}),true,
 'An omitted status on the detail response is not proof that timeline data is stale');
assert.equal(shouldProcessFinalHistoryDetail('ended',{EventStatus:30,MatchStatusID:40}),false,
 'An explicit non-final detail status is still rejected');
assert.equal(postFinalHistoryRetryDelay(2*60_000,60_000),30_000,
 'Late timeline publication is rechecked every 30 seconds in the first ten minutes after FT');
assert.equal(postFinalHistoryRetryDelay(11*60_000,60_000),300_000,
 'Post-FT recovery backs off only after the fast retry window');

const ui=readFileSync(new URL('../web/src/components/Tracker/PitchTracker.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/src/styles/zshop.css',import.meta.url),'utf8');
assert.doesNotMatch(ui,/\.slice\(0,\s*8\)/,
 'Eight visible rows must not delete old events from the match-history UI');
assert.match(ui,/className="zshop-tracker-events" role="region" tabIndex=\{0\}/,
 'History must be a scrollable, keyboard-accessible region');
assert.match(css,/\.zshop-tracker-events\{[^}]*max-height:[^}]*overflow-y:auto/,
 'Show approximately eight entries and allow scrolling all the way to minute one');

assert.equal(resolveMarketTitle('Correct score AAMS-logic',{}),'Correct score AAMS-logic',
 'AAMS labels are no longer rewritten into the standard Correct Score family');
assert.equal(resolveMarketTitle('Next Goal 1st',{}),'Next Goal 1st');
assert.equal(resolveMarketTitle('Next Goal 2nd',{}),'Next Goal 2nd');
const providerMeta={
 liveMarkets:new Map([[75001,{Name:'Next Goal 1st'}],[75002,{Name:'Next Goal 2nd'}]]),
 preMarkets:new Map(),
 positions:new Map([['h','1'],['a','2']]),
};
const quotes=[
 {mid:75001,id:901,pid:'h',v:2.1,seq:1},
 {mid:75002,id:902,pid:'a',v:3.2,seq:2},
];
const original=oddsOf({match_id:8080},quotes,providerMeta,true);
assert.equal(original.length,2);
assert.deepEqual(original.map(o=>o.marketName),['Next Goal 1st','Next Goal 2nd'],
 'Zizobet quote titles must not be collapsed into one generic Next Goal');
assert.notEqual(original[0].marketKey,original[1].marketKey);
assert.deepEqual(original.map(o=>o.price),[2.1,3.2],
 'Different goal ordinals retain their own quoted prices');
assert.deepEqual(original.map(o=>o.outcomeKey),['1','2'],
 'Original selection team identity is retained');
const aamsRows=oddsOf({match_id:8083,home:'Real Madrid U19',away:'PSV Eindhoven U19'},[
 {mid:75003,id:903,pid:'h',v:2.65}
],{
 liveMarkets:new Map([[75003,{Name:'Correct score AAMS-logic'}]]),
 preMarkets:new Map(),positions:new Map([['h','Any other score']])
},true);
assert.equal(aamsRows.length,0,'AAMS-logic offers are excluded before delivery or ticket acceptance');
assert.equal(original[0].marketKey.split('@').length,2,
 'Unmodified provider market parameters are encoded in the native key');

console.log('PASS Zizobet full event chronology; eight-row scroll viewport does not cut settling evidence');
