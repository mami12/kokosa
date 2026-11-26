import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence,classify,gradeHeldNativeCombo} from '../server/ledger/settler.mjs';
import {isOrTotalMarket,parseOrTotalSelection,gradeOrTotalSelection} from '../server/ledger/or-total-combinations.mjs';

const result={source:'ZIZOBET',home_team:'Atletico Madrid',away_team:'Viking',
 home_score:2,away_score:0,half_home_score:1,half_away_score:0,corners_home:8,corners_away:2};
const examples=[
 ['Awayteam wins or total under 2.5','No','LOST'],
 ['Awayteam wins or total over 2.5','No','WON'],
 ['Hometeam wins or total under 2.5','Yes','WON']
];
for(const [market_name,outcome_name,expected] of examples){
 const line={market_name,outcome_name,outcome_key:outcome_name.toLowerCase(),line:'2.5',period:0};
 assert.equal(isOrTotalMarket(market_name),true,market_name+' recognized');
 assert.equal(classify(market_name),'CHANCE_MIX',market_name+' classified');
 assert.ok(parseOrTotalSelection(line),market_name+' parsed');
 assert.equal(hasRequiredSettlementEvidence(line,result),true,market_name+' has final evidence');
 assert.equal(gradeLine(line,result),expected,market_name+' grades correctly');
}
for(const [market,outcome,home,away,expected] of [
 ['Home team wins or total under 2.5','No',0,0,'LOST'],
 ['Home team wins or total under 2.5','No',1,0,'WON'],
 ['Awayteam wins or total over 2.5','Yes',0,3,'WON'],
 ['Draw or total goals under 2.5','Yes',1,1,'WON'],
 ['Draw or total goals over 2.5','No',1,1,'WON'],
 ['Awayteam wins or total under 2.5','Yes',0,1,'WON']
]){
 const selection=parseOrTotalSelection({market_name:market,outcome_name:outcome,line:'2.5'});
 assert.equal(gradeOrTotalSelection(selection,home,away),expected,market+' / '+outcome);
}
assert.equal(parseOrTotalSelection({market_name:'Awayteam wins or total under 2.5',outcome_name:'Yes',line:'3.5'}),null,
 'Title and accepted line cannot conflict');
assert.equal(parseOrTotalSelection({market_name:'Awayteam wins or total under 2.5',outcome_name:'Yes',line:'2.25'}),null,
 'Quarter totals are not forced through full win/loss grading');

const heldLine=(market_name,outcome_name,line)=>({
 market_name,outcome_name,outcome_key:outcome_name.toLowerCase(),market_key:'zz-test',
 line,period:0,accepted_contract:{
  sourceProviderId:'ZIZOBET',settlementHold:'NATIVE_FINAL_RULE_UNMAPPED',
  providerMarketName:market_name,providerOutcomeName:outcome_name,
  providerOutcomeKey:outcome_name.toLowerCase(),providerMarketKey:'zz-test',
  line,providerPeriod:0
 }
});
for(const [market,outcome,expected] of examples){
 const line=heldLine(market,outcome,'2.5');
 assert.equal(gradeHeldNativeCombo(line,result),expected,'Held historical combo: '+market);
}
for(const [outcome,expected] of [['1','WON'],['X','LOST'],['2','LOST']]){
 assert.equal(gradeLine({market_name:'Cornerbet',outcome_name:outcome,outcome_key:outcome},
  {...result,corners_home:8,corners_away:2}),expected,'Cornerbet '+outcome);
}
assert.equal(gradeLine({market_name:'Cornerbet',outcome_name:'X',outcome_key:'X'},
 {...result,corners_home:4,corners_away:4}),'WON','Cornerbet X wins on a tie');
const heldCorner=heldLine('Cornerbet','1','');
assert.equal(gradeHeldNativeCombo(heldCorner,result),'WON','Held Cornerbet uses only verified final corner counters');
for(const [market,outcome,threshold,expected] of [
 ['Total Corners awayteam 1.5','Under','1.5','LOST'],
 ['Total Corners awayteam 1.5','Over','1.5','WON'],
 ['Total Corners hometeam 7.5','Under','7.5','LOST'],
 ['Total Corners hometeam 7.5','Over','7.5','WON'],
 ['Total Corners 9.5','Under','9.5','LOST'],
 ['Total Corners 9.5','Over','9.5','WON']
]){
 const line={market_name:market,outcome_name:outcome,outcome_key:outcome.toLowerCase(),line:threshold,period:0};
 assert.equal(gradeLine(line,result),expected,market+' / '+outcome);
}
console.log('PASS OR combos, held historical combos, Cornerbet 1X2 and all corner-total scopes');
