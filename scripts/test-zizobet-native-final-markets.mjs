import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {gradeLine,hasRequiredSettlementEvidence} from '../server/ledger/settler.mjs';
import {liveContract} from '../server/ledger/live-contract-rules.mjs';

const result={
 home_team:'Chelsea Women',away_team:'Paris Saint-Germain Women',
 home_score:2,away_score:1,half_home_score:1,half_away_score:1,
 corners_home:10,corners_away:6,cards_home:1,cards_away:2,source:'ZIZOBET'
};
const quote=(market_name,outcome_name,extra={})=>({
 market_name,outcome_name,outcome_key:outcome_name,line:'',period:0,...extra
});
const grade=(market,outcome,extra={})=>gradeLine(quote(market,outcome,extra),result);

for(const [market,selection,expected] of [
 ['1st half - Awayteam clean sheet','Yes','LOST'],
 ['1st half - Awayteam clean sheet','No','WON'],
 ['1st half - Hometeam clean sheet','Yes','LOST'],
 ['1st half - Hometeam clean sheet','No','WON'],
 ['2nd half - Awayteam clean sheet','Yes','WON'],
 ['2nd half - Awayteam clean sheet','No','LOST'],
 ['2nd half - Hometeam clean sheet','Yes','WON'],
 ['2nd half - Hometeam clean sheet','No','LOST'],
 ['Clean sheet awayteam','Yes','LOST'],
 ['Clean sheet awayteam','No','WON'],
 ['Clean sheet hometeam','Yes','LOST'],
 ['Clean sheet hometeam','No','WON']
]) {
 const ticket=quote(market,selection);
 assert.equal(gradeLine(ticket,result),expected,market+' '+selection);
 assert.equal(hasRequiredSettlementEvidence(ticket,result),true,
  'A named team and verified scoreboards are sufficient: '+market);
}

assert.equal(grade('Hometeam odd/even','Even'),'WON');
assert.equal(grade('Awayteam odd/even','Odd'),'WON');
assert.equal(grade('2nd half - Hometeam odd/even','Odd'),'WON');
assert.equal(grade('2nd half - Awayteam odd/even','Even'),'WON');

assert.equal(grade('Winning margin','Hometeam by 1'),'WON');
assert.equal(grade('Winning margin','Awayteam by 1'),'LOST');

assert.equal(grade('2nd half - Multigoals','1-2'),'WON');
assert.equal(grade('2nd half - Multigoals','2-3'),'LOST');
const fiveGoalResult={...result,home_score:3,away_score:2,half_home_score:1,half_away_score:0};
assert.equal(gradeLine(quote('Number of Goals 6+','4-5 goals'),fiveGoalResult),'WON');
assert.equal(gradeLine(quote('Number of Goals 6+','2-3 goals'),fiveGoalResult),'LOST');

const acceptedGrid={accepted_contract:{nativeMarketOutcomes:['1:0','2:0','2:1','0:1','0:2']}};
assert.equal(gradeLine(quote('Multiscores','X',acceptedGrid),result),'LOST');
assert.equal(gradeLine(quote('Multiscores','Other home win',acceptedGrid),result),'LOST');
assert.equal(gradeLine(quote('Multiscores','Other home win',acceptedGrid),
 {...result,home_score:3,away_score:1}),'WON');
assert.equal(gradeLine(quote('Multiscores','Other away win',acceptedGrid),
 {...result,home_score:0,away_score:3}),'WON');
assert.equal(gradeLine(quote('Multiscores','X',acceptedGrid),
 {...result,home_score:1,away_score:1}),'WON');
assert.equal(gradeLine(quote('Multiscores','Other home win'),result),null);

for(const [selection,choice] of [['Over','over'],['Under','under']]) {
 const contract=liveContract(quote(
  'Goal in first 10 min. (00:00 - 09:59) (0.5)',selection,{line:'0.5'}
 ));
 assert.deepEqual(
  [contract?.kind,contract?.event,contract?.from,contract?.to,contract?.choice,contract?.threshold],
  ['window-total','goal',0,9,choice,0.5]
 );
}
assert.equal(liveContract(quote(
 'Goal in first 10 min. (00:00 - 09:59) (0.5)','Over',{line:'1.5'}
)),null);

console.log('PASS Zizobet clean sheets, joined team labels, half/full multigoals, multiscores grid and opening 10-minute totals');
