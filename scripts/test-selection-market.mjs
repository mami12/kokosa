import assert from 'node:assert/strict';
import {
  assertDistinctSelectionMarkets, assertCompatibleSelections, selectionMarketIdentity,
  selectionConflict, toggleMarketSelection, toggleMatchSelection, toggleCompatibleSelection, findSelectionConflict
} from '../server/ledger/selection-market.mjs';
import {buildBetslipColumns} from '../web/src/utils/betslipColumns.ts';

const pick=(outcomeId,extra={})=>({outcomeId,...extra});
for(const key of ['g6257','gBothScore','gCorrectScore','gGoalTime','gCorners','gCards','gPlayer']){
  const home=pick(`100|${key}||1`),draw=pick(`100|${key}||X`),away=pick(`100|${key}||2`);
  const other=pick('101|g6257||1');
  let slip=[home,other];
  slip=toggleMarketSelection(slip,away);
  assert.deepEqual(slip,[away,other],`${key}: new option replaces previous same-market outcome`);
  slip=toggleMarketSelection(slip,draw);
  assert.deepEqual(slip,[draw,other],`${key}: cannot create an extra column with same-market options`);
  slip=toggleMarketSelection(slip,draw);
  assert.deepEqual(slip,[other],`${key}: clicking the selected outcome removes it`);
  assert.throws(()=>assertDistinctSelectionMarkets([home,away]),
    error=>error.status===400&&error.code==='DUPLICATE_MARKET',
    `${key}: only one selection is allowed per market, including Corners`);
}
const over=pick('100|g6379|2.5|Over'),under=pick('100|g6379|2.5|Under');
const line35=pick('100|g6379|3.5|Under');
const half1=pick('100|g6379p1|2.5|Under');
assert.deepEqual(toggleMarketSelection([over,line35,half1],under),[under,half1],
  'All quoted lines of the same goal-total market replace one another');
assert.throws(()=>assertDistinctSelectionMarkets([under,line35,half1]),
  error=>error.code==='DUPLICATE_MARKET');
assert.equal(selectionMarketIdentity(over),selectionMarketIdentity(line35));
assert.notEqual(selectionMarketIdentity(over),selectionMarketIdentity(half1),
  'Distinct first-half market key remains a separate bettable group');
// The restriction applies to every market family, not just totals.
for(const key of ['gGoals','gCorners','gCards','gGoalTime','gPlayer','gTeamFouls','gShotsOnTarget']){
 const low=pick(`100|${key}|1.5|Over`), high=pick(`100|${key}|3.5|Under`);
 assert.equal(selectionMarketIdentity(low),selectionMarketIdentity(high),`${key}: lines belong to one group`);
 assert.deepEqual(toggleMarketSelection([low],high),[high],`${key}: replace previous line`);
 assert.throws(()=>assertDistinctSelectionMarkets([low,high]),
   error=>error.code==='DUPLICATE_MARKET',`${key}: reject multiple selections from the same market`);
}
// Other fixtures and other actual provider market keys are independent.
assert.notEqual(selectionMarketIdentity(over),selectionMarketIdentity(pick('101|g6379|2.5|Over')));
assert.notEqual(selectionMarketIdentity(over),selectionMarketIdentity(pick('100|g6379p1|2.5|Over')));
// Zizobet embeds line/interval/threshold parameters after @. Those
// parameters are alternatives within the same native market ID, not new
// independent markets that can be stacked on one ticket.
const nativeA=pick('100|zz6379@eyJwMSI6IjEifQ|2.5|Over');
const nativeB=pick('100|zz6379@eyJwMSI6IjIifQ|3.5|Under');
assert.equal(selectionMarketIdentity(nativeA),selectionMarketIdentity(nativeB));
assert.throws(()=>assertDistinctSelectionMarkets([nativeA,nativeB]),
 error=>error.code==='DUPLICATE_MARKET');
assert.deepEqual(toggleMarketSelection([nativeA],nativeB),[nativeB]);
assert.notEqual(selectionMarketIdentity(nativeA),
 selectionMarketIdentity(pick('100|zz6380@eyJwMSI6IjEifQ|2.5|Over')));
assert.notEqual(selectionMarketIdentity({...nativeA,period:0}),
 selectionMarketIdentity({...nativeB,period:1}),
 'First-half and full-time markets stay separate when the provider reuses a native ID');
// IDs and frozen source contracts, never translated names, drive identity.
assert.equal(selectionMarketIdentity(over),selectionMarketIdentity({matchId:100,marketKey:'g6379',line:'2.5'}));
assert.deepEqual(toggleMarketSelection(
 [{...over,matchId:'faked',marketId:'different',marketName:'Lart/Poshte'}],
 {...under,matchId:'fake',marketId:'elsewhere',marketName:'Total Goals'}),
 [{...under,matchId:'fake',marketId:'elsewhere',marketName:'Total Goals'}]);
assert.throws(()=>assertDistinctSelectionMarkets([
 {matchId:100,marketKey:'g6379',line:null},
 {matchId:'100',marketKey:'g6379',line:''}
]),error=>error.code==='DUPLICATE_MARKET');
assert.doesNotThrow(()=>assertDistinctSelectionMarkets([
 {matchId:'100',marketKey:'g1',line:''},
 {matchId:'100',marketKey:'g2',line:'',marketName:'Same display name'}
]));
// Legacy app fixtures sometimes expose a local marketId instead of native ID.
const aliasA=pick('one',{matchId:'100',marketId:'market-local',marketLine:'',period:0});
const aliasB=pick('two',{matchId:'100',marketId:'market-local',period:0});
assert.deepEqual(toggleMarketSelection([aliasA],aliasB),[aliasB]);
const builderOption=(template,line='2.5',period='')=>({
 outcomeId:`BB|100|${template}`,matchId:'100',builderLegs:[
 {marketId:`100|gBtts${period}|`,outcomeId:`100|gBtts${period}||Yes`},
 {marketId:`100|gTotal${period}|${line}`,outcomeId:`100|gTotal${period}|${line}|Over`},
 ]
});
const yesOver=builderOption('template-yes-over');
const noUnder={...builderOption('template-no-under'),builderLegs:[
 {marketId:'100|gTotal|2.5',outcomeId:'100|gTotal|2.5|Under'},
 {marketId:'100|gBtts|',outcomeId:'100|gBtts||No'}
]};
assert.equal(selectionMarketIdentity(yesOver),selectionMarketIdentity(noUnder));
assert.deepEqual(toggleMarketSelection([yesOver],noUnder),[noUnder],
 'Same two source markets in different builder template cannot create parallel columns');
const sameIdRepeated=[over,under,over,line35];
assert.deepEqual(toggleMarketSelection(sameIdRepeated,under),[],
 'Clicking a selected option also cleans up duplicate outcomes and lines from old slip state');
assert.deepEqual(toggleMarketSelection(sameIdRepeated,pick('100|g6379|2.5|Exact')),[pick('100|g6379|2.5|Exact')],
 'A new option removes every old line from that market group');
// Different markets on the same fixture continue to build a normal COMBO.
const distinct=[
 {outcomeId:'100|1x2||1',matchId:'100',marketId:'100|1x2|',odds:2},
 {outcomeId:'100|btts||Yes',matchId:'100',marketId:'100|btts|',odds:1.8},
 {outcomeId:'101|1x2||2',matchId:'101',marketId:'101|1x2|',odds:2.2}
];
const slip=buildBetslipColumns(distinct);
assert.equal(slip.automaticSystem,false);
assert.equal(slip.columns.length,1);
assert.equal(slip.columns[0].length,3);
const changed=toggleMarketSelection(distinct,{...distinct[0],outcomeId:'100|1x2||X'});
assert.equal(buildBetslipColumns(changed).columns.length,1);
assert.deepEqual(changed.map(v=>v.outcomeId),['100|1x2||X','100|btts||Yes','101|1x2||2']);

// Normal users may combine one Corners selection with one non-Corners selection from the same fixture.
const matchResult=pick('200|g1x2||1',{matchId:'200',marketId:'200|g1x2|',marketName:'Match Result',marketType:'1x2'});
const doubleChance=pick('200|gdc||1X',{matchId:'200',marketId:'200|gdc|',marketName:'Double Chance'});
const drawNoBet=pick('200|gdnb||1',{matchId:'200',marketId:'200|gdnb|',marketName:'Draw No Bet'});
const matchTotal=pick('200|g6379|2.5|Over',{matchId:'200',marketId:'200|g6379|2.5',marketName:'Total Goals',marketType:'over_under',marketLine:'2.5',outcomeName:'Over 2.5'});
const fullTimeResultGoals=pick('200|gFTResultGoals||HomeOver',{matchId:'200',marketId:'200|gFTResultGoals|',marketName:'Full Time Result/Goals',marketType:'result_goals',outcomeName:'Home & Over 1.5'});
const corners=pick('200|gCorners|2.5|Over',{matchId:'200',marketId:'200|gCorners|2.5',marketName:'Total Corners',marketType:'over_under',marketLine:'2.5',outcomeName:'Over 2.5'});
const cards=pick('200|gCards|4.5|Over',{matchId:'200',marketId:'200|gCards|4.5',marketName:'Total Cards',marketType:'over_under',marketLine:'4.5',outcomeName:'Over 4.5'});
const otherFixture=pick('201|g1x2||1',{matchId:'201',marketId:'201|g1x2|',marketName:'Match Result'});
assert.deepEqual(toggleCompatibleSelection([matchResult,otherFixture],matchTotal),[matchResult,otherFixture,matchTotal],
  'Goals totals can combine with the main result market from the same fixture');
assert.deepEqual(toggleCompatibleSelection([matchResult,otherFixture],corners),[matchResult,otherFixture,corners],
  'Corners can combine with result markets');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,corners,otherFixture]));
assert.doesNotThrow(()=>assertCompatibleSelections([matchTotal,corners,otherFixture]));
assert.doesNotThrow(()=>assertCompatibleSelections([cards,corners,otherFixture]));
assert.equal(selectionConflict(matchResult,doubleChance),null,
  '1X2 + Double Chance are distinct markets');
assert.equal(selectionConflict(matchResult,drawNoBet),null,
  '1X2 + Draw No Bet are distinct markets');
assert.deepEqual(toggleCompatibleSelection([matchResult],doubleChance),[matchResult,doubleChance],
  'A different main-result market remains selectable');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,doubleChance,drawNoBet]));

const goalOver=pick('200|gGoals|1.5|Over',{matchId:'200',marketId:'200|gGoals|1.5',marketName:'Total Goals',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5'});
const goalUnderAlt=pick('200|gGoals|3.5|Under',{matchId:'200',marketId:'200|gGoals|3.5',marketName:'Total Goals',marketType:'over_under',marketLine:'3.5',outcomeName:'Under 3.5'});
assert.equal(selectionConflict(goalOver,goalUnderAlt)?.code,'SAME_MARKET_GROUP',
  'Alternate lines from the same Goals market remain mutually exclusive');
const cornersUnder=pick('200|gCorners|4.5|Under',{matchId:'200',marketId:'200|gCorners|4.5',marketName:'Total Corners',marketType:'over_under',marketLine:'4.5',outcomeName:'Under 4.5'});
assert.equal(selectionConflict(corners,cornersUnder)?.code,'SAME_MARKET_GROUP',
  'Different lines from the same Total Corners market cannot be combined');
const raceCorners=pick('200|gRaceCorners||7',{matchId:'200',marketId:'200|gRaceCorners|',marketName:'Race to 7 Corners',outcomeName:'First to 7'});
const raceCornersAgain=pick('200|gRaceCorners||10',{matchId:'200',marketId:'200|gRaceCorners|',marketName:'Race to 10 Corners',outcomeName:'First to 10'});
assert.equal(selectionConflict(corners,raceCorners),null,
  'Total Corners can combine with Race to X Corners');
assert.equal(selectionConflict(corners,raceCornersAgain),null,
  'A different Corners market, Race to X, can combine with Total Corners');
assert.equal(selectionConflict(raceCorners,raceCornersAgain)?.code,'SAME_MARKET_GROUP',
  'Two Race to X choices from the same market cannot be combined');
const firstCornerMarket=pick('200|gFirstCorner||Home',{matchId:'200',marketId:'200|gFirstCorner|',marketName:'First Corner',outcomeName:'Home'});
assert.equal(selectionConflict(corners,firstCornerMarket),null,
  'Total Corners and First Corner are different markets and can combine');
assert.doesNotThrow(()=>assertCompatibleSelections([corners,raceCornersAgain,firstCornerMarket]),
  'Backend accepts different Corners markets on one match');
assert.throws(()=>assertCompatibleSelections([corners,cornersUnder]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend rejects two selections from Total Corners');
assert.throws(()=>assertDistinctSelectionMarkets([corners,cornersUnder]),
  error=>error.code==='DUPLICATE_MARKET',
  'Structural duplicate-market guard rejects repeated Corners market');
assert.deepEqual(toggleCompatibleSelection([corners],cornersUnder),[corners],
  'Client refuses a second selection from the same Corners market');
const cardsUnder=pick('200|gCards|5.5|Under',{matchId:'200',marketId:'200|gCards|5.5',marketName:'Total Cards',marketType:'over_under',marketLine:'5.5',outcomeName:'Under 5.5'});
assert.equal(selectionConflict(cards,cardsUnder)?.code,'SAME_MARKET_GROUP',
  'Only one quote from the same Total Cards market is allowed');
assert.equal(findSelectionConflict([matchResult,goalOver,goalUnderAlt])?.code,'SAME_MARKET_GROUP',
  'A second Goals quote is blocked even when 1X2 is selected');
assert.throws(()=>assertCompatibleSelections([matchResult,goalOver,goalUnderAlt]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Backend rejects 1X2 + Over 1.5 + Over/Under 2.5');
assert.throws(()=>assertDistinctSelectionMarkets([matchResult,goalOver,goalUnderAlt]),
  error=>error.code==='DUPLICATE_MARKET',
  'Structural duplicate-market guard blocks a second Goals total despite a main market');
assert.deepEqual(toggleCompatibleSelection([matchResult,goalOver],goalUnderAlt),
  [matchResult,goalOver],
  'Frontend refuses a second Goals total even when a main market is selected');
assert.equal(selectionConflict(matchResult,matchTotal),null,
  'Main result + total goals are compatible');


// Main market + one full-time Goals total must work in both LIVE and PREMATCH.
const dcGoal = {...matchTotal, outcomeId:'200|g6379|1.5|Over', marketId:'200|g6379|1.5', marketLine:'1.5', outcomeName:'Over 1.5'};
const goalLine35 = {...matchTotal, outcomeId:'200|g6379|3.5|Under', marketId:'200|g6379|3.5', marketLine:'3.5', outcomeName:'Under 3.5'};
for (const status of ['LIVE','PREMATCH']) {
  const main = {...doubleChance, matchSnapshot:{status}};
  const totalA = {...dcGoal, matchSnapshot:{status}};
  const totalB = {...goalLine35, matchSnapshot:{status}};
  assert.deepEqual(toggleCompatibleSelection([main],totalA),[main,totalA],
    `Double Chance + Over 1.5 is accepted for ${status}`);
  assert.deepEqual(toggleCompatibleSelection([main,totalA],totalB),[main,totalA],
    `Double Chance + a second Goals total is blocked for ${status}`);
  assert.throws(()=>assertCompatibleSelections([main,totalA,totalB]),
    error=>error.code==='INCOMPATIBLE_SELECTIONS',
    `Backend blocks Double Chance + multiple Goals totals for ${status}`);
}
assert.throws(()=>assertCompatibleSelections([goalOver,goalUnderAlt]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  'Multiple goal totals without a main market remain blocked');

// One selection per visible market category for the same fixture, even when
// the provider gives the offers different market IDs and different names.
const nextGoal=pick('200|gNextGoal||Home',{matchId:'200',marketId:'200|gNextGoal|',marketName:'Next Goal',outcomeName:'Home'});
assert.equal(selectionConflict(goalOver,nextGoal),null,
  'Total Goals and Next Goal are different provider markets');
assert.deepEqual(toggleCompatibleSelection([goalOver],nextGoal),[goalOver,nextGoal],
  'The slip accepts a different Goals market from the same match');
assert.doesNotThrow(()=>assertCompatibleSelections([goalOver,nextGoal]),
  'The backend accepts different provider market IDs from one statistic category');

assert.equal(selectionConflict(corners,raceCorners),null,
  'Total Corners and Race to X Corners can be combined');
const cardsOther=pick('200|gCards||Over',{matchId:'200',marketId:'200|gCards|',marketName:'Total Cards',outcomeName:'Over'});
const playerOther=pick('200|gBooked||Yes',{matchId:'200',marketId:'200|gBooked|',marketName:'Player to be Booked',outcomeName:'Yes'});
assert.equal(selectionConflict(cardsOther,playerOther),null,
  'Different market IDs can combine even when both were previously classified as Other');
assert.equal(selectionConflict(goalOver,corners),null,
  'Different visible categories remain compatible within one match');
assert.equal(selectionConflict(matchResult,corners),null,
  'Corners must combine with full-time result markets');
assert.equal(selectionConflict(corners,matchResult),null,
  'Corners must combine with full-time result markets in either selection order');
// A Corners pick must bypass every same-match conflict check, even if the
// provider reuses a market identity or the other pick belongs to a restricted family.
const cornerWithSharedIdentity = pick('200|gCorners|2.5|Over', {
  matchId:'200', marketId:'200|shared-market|2.5',
  marketKey:'gCorners', marketName:'Total Corners', marketType:'over_under'
});
const nonCornerWithSharedIdentity = pick('200|gCorners|2.5|Yes', {
  matchId:'200', marketId:'200|shared-market|2.5',
  marketName:'Correct Score', marketType:'other'
});
assert.equal(selectionConflict(cornerWithSharedIdentity, nonCornerWithSharedIdentity)?.code,'SAME_MARKET_GROUP',
  'A Corners pick cannot bypass a duplicate market group');
assert.equal(selectionConflict(nonCornerWithSharedIdentity, cornerWithSharedIdentity)?.code,'SAME_MARKET_GROUP',
  'The duplicate market restriction works in either selection order');
assert.throws(()=>assertDistinctSelectionMarkets([cornerWithSharedIdentity, nonCornerWithSharedIdentity]),
  error=>error.code==='DUPLICATE_MARKET',
  'Structural guard rejects a duplicated Corners market group');
const genericallyNamedCorners = pick('200|zzCorners@total|2.5|Over', {
  matchId:'200', marketId:'200|zzCorners@total|2.5',
  marketKey:'gCorners', marketName:'Over/Under',
  marketType:'over_under', marketLine:'2.5', outcomeName:'Over 2.5'
});
assert.equal(selectionConflict(matchResult,genericallyNamedCorners),null,
  'Native corner market key identifies a generic Over/Under title as Corners');
// The canonical server resolver keeps the generic display title in
// marketName and the actual Zizobet title in nativeMarketName. Native title
// evidence must win even when the display title is generic.
const resolvedZizobetCorner = pick('200|zz901@total|5.5|Over', {
  matchId:'200', marketKey:'zz901@total', marketId:'200|zz901@total|5.5',
  marketName:'Over/Under', marketType:'over_under',
  nativeMarketName:'Total Corners Over/Under', nativeMarketId:'901'
});
const resolvedNonCornerSameGroup = pick('200|zz901@total|5.5|Yes', {
  matchId:'200', marketKey:'zz901@total', marketId:'200|zz901@total|5.5',
  marketName:'Correct Score', marketType:'other'
});
assert.equal(selectionConflict(resolvedZizobetCorner, resolvedNonCornerSameGroup)?.code,'SAME_MARKET_GROUP',
  'Native Corners title does not bypass the one-selection-per-market rule');
assert.equal(selectionConflict(resolvedNonCornerSameGroup, resolvedZizobetCorner)?.code,'SAME_MARKET_GROUP',
  'The native market duplicate rule works in either selection order');
assert.throws(()=>assertDistinctSelectionMarkets([resolvedZizobetCorner, resolvedNonCornerSameGroup]),
  error=>error.code==='DUPLICATE_MARKET');
assert.throws(()=>assertCompatibleSelections([resolvedZizobetCorner, resolvedNonCornerSameGroup]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');
// Mirrors the actual frontend payload after the native provider title is
// forwarded from Market -> OddsButton -> BetSelection. No opaque native key
// or synthetic gCorners identifier is required for classification.
const oddsButtonNativeTitleCorner = pick('200|zz901@total|5.5|Over', {
  matchId:'200', marketId:'200|zz901@total|5.5',
  marketName:'Over/Under', nativeMarketName:'Total Corners Over/Under',
  marketType:'over_under', marketLine:'5.5', outcomeName:'Over 5.5'
});
assert.equal(selectionConflict(matchResult, oddsButtonNativeTitleCorner), null,
  'Frontend Corners pick is recognized from the preserved native Zizobet title');
assert.equal(selectionConflict(oddsButtonNativeTitleCorner, matchTotal), null,
  'Native-title Corners pick combines with Goals in the frontend');
assert.equal(selectionConflict(oddsButtonNativeTitleCorner, cornersUnder),null,
  'Different provider market IDs remain distinct even when both display Total Corners');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult, oddsButtonNativeTitleCorner, cornersUnder]),
  'Server accepts distinct Corners market IDs alongside the main result');
// This mirrors the exact object built by OddsButton: marketKey/extId are not
// sent to the betslip, so category detection must read the native key in outcomeId.
const actualOddsButtonCorner = pick('200|gCorners|2.5|Over', {
  matchId:'200', marketId:'local-market-id',
  marketName:'Over/Under', marketType:'over_under',
  marketLine:'2.5', outcomeName:'Over 2.5'
});
const firstHalfTotal=pick('200|gGoals1h|1.5|Over',{matchId:'200',marketId:'200|gGoals1h|1.5',marketName:'1st Half Total Goals',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5',period:1});
const sameGameCombo=pick('200|BB|template-a',{matchId:'200',marketId:'200|BB|template-a',marketName:'Bet Builder'});
for (const other of [matchResult, matchTotal, cards, firstHalfTotal, sameGameCombo]) {
  assert.equal(selectionConflict(other, actualOddsButtonCorner), null,
    'A native gCorners selection from the real OddsButton payload combines with every market family');
  assert.equal(selectionConflict(actualOddsButtonCorner, other), null,
    'Corners compatibility is independent of selection order');
}
assert.equal(selectionConflict(actualOddsButtonCorner, cornersUnder)?.code,'SAME_MARKET_GROUP',
  'Two odds from the same gCorners market are blocked');
const albanianCornerTitle = pick('200|local-corner-market|10.5|Over', {
  matchId:'200', marketId:'local-corner-id',
  marketName:'Totali i goditjeve këndore (10.5)',
  marketType:'over_under', marketLine:'10.5', outcomeName:'Lart'
});
assert.equal(selectionConflict(matchResult, albanianCornerTitle), null,
  'Albanian translated corner title combines with Match Result');
const albanianSecondCorner = {...albanianCornerTitle, outcomeId:'200|local-corner-market|11.5|Under', marketLine:'11.5', outcomeName:'Poshtë'};
assert.equal(selectionConflict(albanianCornerTitle, albanianSecondCorner)?.code,'SAME_MARKET_GROUP',
  'Two Albanian quotes from the same Corners market are blocked');
// Zizobet sometimes gives the offer a local outcome ID, so OddsButton
// must carry extId/marketKey into the selection. This applies identically
// to live and prematch fixtures.
for (const status of ['LIVE','PREMATCH']) {
 const extIdCorner = pick(`200|local-outcome-${status}|10.5|Over`, {
  matchId:'200', marketId:'local-corner-${status}', extId:'gCorners',
  marketKey:'gCorners', marketName:'Over/Under', marketType:'over_under',
  marketLine:'10.5', outcomeName:'Over 10.5',
  matchSnapshot:{status}
 });
 assert.equal(selectionConflict(matchResult, extIdCorner), null,
  `Result + Corners must combine for ${status}`);
 assert.equal(selectionConflict(extIdCorner, actualOddsButtonCorner), null,
  `Different Corners market IDs combine for ${status}`);
}
// Corners must remain combinable with all distinct market categories
// for both live and prematch selections, even when the visible label is generic.
for (const status of ['LIVE','PREMATCH']) {
 const resultPick = {...matchResult, matchSnapshot:{status}};
 const cornerPick = pick(`200|local-corner-${status}|10.5|Over`, {
  matchId:'200', marketId:`local-corner-${status}`, extId:'gCorners',
  marketKey:'gCorners', marketName:'Over/Under', marketType:'over_under',
  marketLine:'10.5', outcomeName:'Over 10.5', matchSnapshot:{status}
 });
 assert.equal(selectionConflict(resultPick, cornerPick), null,
  `Result + Corners are compatible in ${status}`);
 assert.equal(selectionConflict(cornerPick, matchTotal), null,
  `Corners + Goals are compatible in ${status}`);
 assert.equal(selectionConflict(cornerPick, cards), null,
  `Corners + Cards are compatible in ${status}`);
}
const actualSecondCorner = pick('200|gCorners|5.5|Under', {
  matchId:'200', marketId:'another-local-market-id',
  marketName:'Over/Under', marketType:'over_under',
  marketLine:'5.5', outcomeName:'Under 5.5'
});
assert.equal(selectionConflict(actualOddsButtonCorner, actualSecondCorner)?.code,'SAME_MARKET_GROUP',
  'Two generic Over/Under quotes from the same gCorners market are blocked');
assert.equal(selectionConflict(actualOddsButtonCorner, matchTotal), null,
  'Corners remain compatible with Goals despite generic Over/Under labels');
assert.equal(selectionConflict(actualOddsButtonCorner, matchResult), null,
  'A corner selection combines with 1X2 on the same match');
// Every provider Corners market family is stackable, not only Total Corners.
// Cover translated labels, team-most-corners, handicaps, team totals, race-to,
// first-corner, and period/interval variants with generic Over/Under labels.
const allCornerMarketTypes = [
  {marketName:'Skuadra me me shume goditje kendore', marketType:'other'},
  {marketName:'Over/Under', marketType:'team_with_most_corners'},
  {marketName:'Over/Under', marketType:'corner_handicap'},
  {marketName:'Home Team Total', marketType:'home_team_corners'},
  {marketName:'Race to 5', marketType:'race_to_corners'},
  {marketName:'First Corner', marketType:'first_corner'},
  {marketName:'2nd Half Total', marketType:'corners_2h'},
  {marketName:'Over/Under', extId:'gMostCorners'},
  {marketName:'Over/Under', marketKey:'gCornerHandicap'},
];
const allCornerSelections = allCornerMarketTypes.map((fields,index)=>pick(
  `200|corner-family-${index}|1|Home`,
  {matchId:'200',marketId:`local-corner-family-${index}`,outcomeName:'Home',...fields}
));
for (const cornerPick of allCornerSelections) {
  assert.equal(selectionConflict(matchResult,cornerPick),null,
    'Every Corners market family combines with 1X2');
  assert.equal(selectionConflict(cornerPick,matchTotal),null,
    'Every Corners market family combines with Goals');
}
assert.equal(findSelectionConflict(allCornerSelections),null,
  'All distinct Corners market families can coexist on one fixture');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,...allCornerSelections]),
  'Backend accepts all Corners market families together with non-Corners markets');
assert.deepEqual(toggleCompatibleSelection([matchResult,...allCornerSelections.slice(0,-1)],allCornerSelections.at(-1)),
  [matchResult,...allCornerSelections],
  'Client accepts all Corners market families together on the same fixture');

// Corners acceptance is independent of line magnitude, including zero and
// unusually large provider lines, for both client and backend validation.
for (const line of ['0','0.5','7.5','1000.5','1000000.5']) {
 const cornerLine = pick(`200|gCorners|${line}|Over`, {
  matchId:'200', marketId:`200|gCorners|${line}`,
  marketName:`Total Corners (${line})`, marketType:'over_under',
  marketLine:line, outcomeName:`Over ${line}`
 });
 const anotherCornerLine = pick(`200|gCorners|${line}|Under`, {
  matchId:'200', marketId:`200|gCorners|${line}`,
  marketName:`Total Corners (${line})`, marketType:'over_under',
  marketLine:line, outcomeName:`Under ${line}`
 });
 assert.equal(selectionConflict(cornerLine, anotherCornerLine)?.code,'SAME_MARKET_GROUP',
  `Total Corners line ${line} cannot be selected twice`);
 assert.throws(()=>assertCompatibleSelections([matchResult,cornerLine,anotherCornerLine]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS',
  `Backend rejects duplicate Total Corners picks at line ${line}`);
 assert.deepEqual(toggleCompatibleSelection([matchResult,cornerLine],anotherCornerLine),
  [matchResult,cornerLine],
  `Client blocks second Total Corners pick at line ${line}`);
}
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult, actualOddsButtonCorner, matchTotal]),
  'Main result + Goals + Corners are allowed together');
assert.deepEqual(toggleCompatibleSelection([matchResult, actualOddsButtonCorner], matchTotal),
  [matchResult, actualOddsButtonCorner, matchTotal],
  'The client allows a goal total alongside an existing main result + Corners');
assert.equal(selectionConflict(matchResult,firstHalfTotal),null,
  '1X2 and a first-half Goals market are distinct markets');
assert.equal(selectionConflict(matchResult,sameGameCombo),null,
  '1X2 and Bet Builder are distinct markets');
assert.equal(selectionConflict(firstHalfTotal,sameGameCombo),null,
  'First-half Goals and Bet Builder are distinct markets');
assert.equal(selectionConflict(matchResult,{...sameGameCombo,matchId:'201',marketId:'201|BB|template-a'}),null,
  'Selections from different fixtures remain compatible');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,firstHalfTotal]));
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,sameGameCombo]));
assert.doesNotThrow(()=>assertCompatibleSelections([firstHalfTotal,sameGameCombo]));
assert.throws(()=>assertCompatibleSelections([goalOver,goalUnderAlt]),
  error=>error.code==='INCOMPATIBLE_SELECTIONS');
assert.equal(selectionConflict(matchResult,matchTotal),null,
  'Result and Goals can combine without requiring a corner market');
assert.equal(selectionConflict(fullTimeResultGoals,goalOver),null,
  'Full Time Result/Goals and Total Goals are different markets');
assert.equal(selectionConflict(goalOver,fullTimeResultGoals),null,
  'Different markets remain compatible in either selection order');
assert.equal(selectionConflict(fullTimeResultGoals,cards),null,
  'Different non-Corners market categories combine on one match');
assert.doesNotThrow(()=>assertCompatibleSelections([matchResult,matchTotal]),
  'Backend accepts Result + Goals without Corners');
assert.doesNotThrow(()=>assertCompatibleSelections([goalOver,cards]),
  'Backend accepts Goals + Cards as different markets');
assert.doesNotThrow(()=>assertCompatibleSelections([fullTimeResultGoals,goalOver]),
  'Backend accepts different full-time goal market groups');
assert.deepEqual(toggleCompatibleSelection([fullTimeResultGoals],goalOver),[fullTimeResultGoals,goalOver],
  'Player betslip accepts Full Time Result/Goals + Total Goals from distinct markets');
assert.equal(selectionConflict(goalOver,cards),null,
  'Goals and Cards are distinct markets and can combine');
assert.equal(selectionConflict(sameGameCombo,goalOver),null,
  'Bet Builder and Goals are distinct markets and can combine');
assert.equal(selectionConflict(sameGameCombo,corners),null,
  'Bet Builder can combine with Corners');
assert.equal(selectionConflict(firstHalfTotal,corners),null,
  'First-half goals can combine with Corners');
assert.equal(selectionConflict(matchTotal,corners),null,
  'Full-time goals can combine with Corners');
const firstHalfGoals={...goalUnderAlt,outcomeId:'200|gGoals1h|1.5|Under',marketId:'200|gGoals1h|1.5',marketName:'1st Half Total Goals',marketLine:'1.5',period:1};
assert.equal(selectionConflict(goalOver,firstHalfGoals),null,
  'Full-time Goals and first-half Goals are distinct markets');
assert.doesNotThrow(()=>assertCompatibleSelections([goalOver,firstHalfGoals]),
  'Backend accepts full-time Goals + first-half Goals from separate markets');
const secondHalfGoals={...goalUnderAlt,outcomeId:'200|gGoals2h|1.5|Under',marketId:'200|gGoals2h|1.5',marketName:'2nd Half Total Goals',marketLine:'1.5',period:2};
assert.equal(selectionConflict(goalOver,secondHalfGoals),null,
  'Full-time Goals and second-half Goals are distinct markets');
const homeTeamGoals=pick('200|gHomeGoals|1.5|Over',{matchId:'200',marketId:'200|gHomeGoals|1.5',marketKey:'gHomeGoals',marketName:'Home Team Total Goals',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5'});
const awayTeamGoals=pick('200|gAwayGoals|1.5|Over',{matchId:'200',marketId:'200|gAwayGoals|1.5',marketKey:'gAwayGoals',marketName:'Away Team Total Goals',marketType:'over_under',marketLine:'1.5',outcomeName:'Over 1.5'});
assert.equal(selectionConflict(homeTeamGoals,awayTeamGoals),null,
  'Home Team Goals and Away Team Goals are distinct markets');
assert.equal(selectionConflict(goalOver,homeTeamGoals),null,
  'Simple Total Goals and Home Team Goals are distinct markets');
assert.doesNotThrow(()=>assertCompatibleSelections([homeTeamGoals,awayTeamGoals]),
  'Backend accepts Home Team Goals + Away Team Goals from distinct markets');

const correctScore=pick('200|gCorrectScore||0:0',{matchId:'200',marketId:'200|gCorrectScore|',marketName:'Correct Score',outcomeName:'0:0'});
assert.equal(selectionConflict(matchResult,correctScore),null,
  'Match Result and Correct Score are separate provider markets');
assert.equal(selectionConflict(doubleChance,correctScore),null,
  'Double Chance and Correct Score are separate provider markets');

const prematch={status:'PREMATCH'};
const underHalf=pick('200|gGoals|0.5|Under',{matchId:'200',marketId:'200|gGoals|0.5',marketName:'Total Goals',marketType:'over_under',marketLine:'0.5',outcomeName:'Under 0.5',matchSnapshot:prematch});
const zeroZero=pick('200|gCorrectScore||0:0',{matchId:'200',marketId:'200|gCorrectScore|',marketName:'Correct Score',outcomeName:'0:0',matchSnapshot:prematch});
const noFirstGoal=pick('200|gFirstGoal||None',{matchId:'200',marketId:'200|gFirstGoal|',marketName:'First Goal',outcomeName:'No Goal',matchSnapshot:prematch});
assert.equal(selectionConflict(underHalf,zeroZero),null,
  'Under 0.5 and Correct Score are different markets');
assert.equal(selectionConflict(underHalf,noFirstGoal),null,
  'Under 0.5 and First Goal are different markets');
assert.equal(selectionConflict(zeroZero,noFirstGoal),null,
  'Correct Score and First Goal are different markets');
assert.doesNotThrow(()=>assertCompatibleSelections([underHalf,zeroZero,noFirstGoal]));
const resolvedUnder = {matchId:'200',marketKey:'gGoals',line:'0.5',outcomeKey:'Under',outcomeName:'Under 0.5',
  marketName:'Total Goals',marketType:'over_under',acceptedLiveSnapshot:{isLive:false}};
const resolvedFirstGoal = {matchId:'200',marketKey:'gFirstGoal',line:'',outcomeKey:'None',outcomeName:'No Goal',
  marketName:'First Goal',acceptedLiveSnapshot:{isLive:false}};
assert.equal(selectionConflict(resolvedUnder,resolvedFirstGoal),null,
  'Server-resolved selections from different market keys can combine');
assert.doesNotThrow(()=>assertCompatibleSelections([resolvedUnder,resolvedFirstGoal]));

const bttsNo=pick('200|gBtts||No',{matchId:'200',marketId:'200|gBtts|',marketName:'Both Teams To Score',outcomeName:'No',matchSnapshot:prematch});
assert.equal(selectionConflict(underHalf,bttsNo),null,
  'Under 0.5 and BTTS are different markets');
const liveNoFirstGoal={...noFirstGoal,matchSnapshot:{status:'LIVE'}};
assert.equal(selectionConflict(underHalf,liveNoFirstGoal),null,
  'Different non-Corners markets can combine in live matches');

assert.equal(selectionConflict(matchResult,otherFixture),null);
assert.deepEqual(toggleCompatibleSelection([matchResult],matchResult),[],
  'Clicking a selected outcome removes it');
// Admin retains the pre-existing behavior: different markets on the same match coexist.
assert.deepEqual(toggleMarketSelection([matchResult],matchTotal),[matchResult,matchTotal]);
assert.doesNotThrow(()=>assertDistinctSelectionMarkets([matchResult,matchTotal]));
// The stricter legacy helper remains available to older callers, but is not used for player slips.
assert.deepEqual(toggleMatchSelection([matchResult],matchTotal),[matchTotal]);

console.log('PASS compatible same-match combinations, result-family exclusions, statistic totals, periods, correlated no-goal picks, and backend-resolved contracts.');
