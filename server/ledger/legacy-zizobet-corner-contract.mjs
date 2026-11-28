import {nativeZizobetContractRow} from './native-zizobet-contract.mjs';
import {liveContract} from './live-contract-rules.mjs';
import {SUPPORTED_FACT_KINDS} from './match-event-facts.mjs';

/**
 * Rebuild an old event contract only from its immutable accepted Zizobet quote.
 * The provider title, outcome, line, period and purchase-time counters are
 * re-read together. No translated/AAMS title or later scoreboard may replace
 * the accepted quote. The grader still requires the matching confirmed event
 * chronology before any financial decision.
 */
export function recoverLegacyZizobetEventContract(line){
 let accepted=line?.accepted_contract;
 if(typeof accepted==='string'){
  try{accepted=JSON.parse(accepted);}catch{return null;}
 }
 if(!accepted||typeof accepted!=='object')return null;
 const hold=String(accepted.settlementHold??'');
 const recoverable=new Set([
  '','NATIVE_PARAMETERS_UNMAPPED','NATIVE_FINAL_RULE_UNMAPPED',
  'NATIVE_PERIOD_GOAL_UNMAPPED','NATIVE_STATISTIC_UNMAPPED','NATIVE_HTFT_UNMAPPED',
  'NATIVE_INTERVAL_BASELINE_UNVERIFIED','NATIVE_CONTRACT_REVIEW'
 ]);
 if(!recoverable.has(hold)||String(accepted.sourceProviderId??'').toUpperCase()!=='ZIZOBET')return null;
 const nativeName=String(accepted.nativeMarketName??accepted.providerMarketName??'')
  .trim().replace(/^\*\s*/,'');
 if(!nativeName||/\baams(?:[-\s]?logic)?\b/i.test(nativeName))return null;
 const row={
  provider_id:'ZIZOBET',
  market_key:accepted.providerMarketKey??line.market_key,
  market_name:accepted.providerMarketName??line.market_name,
  outcome_key:accepted.providerOutcomeKey??line.outcome_key,
  outcome_name:accepted.nativeOutcomeName??accepted.providerOutcomeName??line.outcome_name,
  line:accepted.line??line.line??'',
  period:accepted.providerPeriod??line.period??0,
  native_market_id:accepted.nativeMarketId??null,
  native_outcome_id:accepted.nativeOutcomeId??null,
  native_market_name:nativeName,
  native_outcome_name:accepted.nativeOutcomeName??null,
  native_parameters:accepted.nativeParameters??null
 };
 let normalized;
 try{
  normalized=nativeZizobetContractRow(row,{competitors:{
   home:accepted.homeTeamName??line.home_team,
   away:accepted.awayTeamName??line.away_team
  }});
 }catch{return null;}
 const quoted={
  ...line,...normalized,
  market_name:normalized?.market_name??nativeName,
  outcome_key:row.outcome_key,
  outcome_name:row.outcome_name,
  line:row.line,
  period:row.period
 };
 const counts=accepted.acceptedLiveSnapshot?.counters??{};
 let contract;
 try{contract=liveContract(quoted,{counts});}catch{return null;}
 if(!contract||!SUPPORTED_FACT_KINDS.has(contract.kind)||
    !['goal','corner','card','foul'].includes(contract.event)||
    String(contract.kind).startsWith('player-'))return null;
 return contract;
}

export function recoverLegacyZizobetCornerContract(line){
 const contract=recoverLegacyZizobetEventContract(line);
 return contract?.event==='corner'?contract:null;
}
