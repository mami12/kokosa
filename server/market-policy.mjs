/**
 * Global offer policy. Exclusions apply before publication and at acceptance.
 * Historical ticket terms remain immutable; player contracts are never auto-settled.
 */
const clean=value=>String(value??'').normalize('NFD')
 .replace(/[\\u0300-\\u036f]/g,'').toLowerCase()
 .replace(/[_–—]+/g,' ').replace(/\\s+/g,' ').trim();
const titlesOf=market=>[
 market?.marketName,market?.market_name,market?.name,
 market?.nativeMarketName,market?.native_market_name,
 market?.accepted_contract?.providerMarketName,
 market?.accepted_contract?.nativeMarketName
].map(clean).filter(Boolean);
const nativeParams=market=>market?.nativeParameters??market?.native_parameters??
 market?.accepted_contract?.nativeParameters??market?.accepted_contract?.native_parameters??
 market?.parameters??{};
const hasPlayerParameter=market=>{
 const params=nativeParams(market);
 return [market?.player,market?.pl,params?.pl,params?.player,
  market?.accepted_contract?.nativeParameters?.pl].some(v=>v!=null&&String(v).trim()!=='');
};
const PLAYER_WORDS=/\\b(?:player|players|goalscorer|goal scorer|top scorer|scorer|assist|assists|goalkeeper|goal keeper)\\b/;
const UNSUPPORTED_STATS=/\\b(?:fouls?|cards?|bookings?|tackles?|throw[ -]?ins?|saves?)\\b/;
export function isPlayerOfferMarket(market){
 return hasPlayerParameter(market)||titlesOf(market).some(title=>PLAYER_WORDS.test(title));
}
export function isRetiredPlayerOfferMarket(market){
 return isPlayerOfferMarket(market)||titlesOf(market).some(title=>UNSUPPORTED_STATS.test(title));
}
export const isHandicapOfferMarket=market=>
 titlesOf(market).some(title=>/\\b(?:asian\\s+)?handicap\\b/.test(title));
export const isEarlyPayoutOfferMarket=market=>
 titlesOf(market).some(title=>/1x2\\s*\\(xup\\)|early\\s*payout/.test(title))||
 String(market?.native_market_id??market?.nativeMarketId??'')==='27073';
export const isExcludedOfferMarket=market=>
 isHandicapOfferMarket(market)||isEarlyPayoutOfferMarket(market)||
 isRetiredPlayerOfferMarket(market);
