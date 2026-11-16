/**
 * Global offer policy. These exclusions apply to NEW provider offers and
 * browser/socket projections, never to the immutable terms of past tickets.
 *
 * Zizobet's full-match API is an indivisible payload. We can discard unwanted
 * markets immediately on ingest, before normalization/storage/broadcast, but
 * cannot make its upstream getprematchgamefull/gamenew response omit them.
 */
const marketTitle=market=>String(
  market?.marketName??market?.market_name??market?.name??
  market?.nativeMarketName??market?.native_market_name??''
).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/[_–—]+/g,' ').replace(/\s+/g,' ').trim();

/** Retire incident/discipline prop markets about a NAMED player. Do not
 * retire aggregate shots/fouls/cards/corners, team goal markets or anonymous
 * first/next goal selections. Retain plain anytime goal scorer as requested. */
/** No player propositions or unsupported statistic families are offered. */
export function isRetiredPlayerOfferMarket(market){
 const title=marketTitle(market);
 if(!title)return false;
 const hasPlayerParameter=!!String(
   market?.player??market?.pl??market?.nativeParameters?.pl??market?.parameters?.pl??''
 ).trim();
 const playerMarket=hasPlayerParameter||
   /\\b(?:player|goalscorer|goal scorer|goalkeeper|goal keeper|scorer|assist|assists)\\b/.test(title)||
   /^(?!\\d)(?!total\\b)[\\p{L}][\\p{L}'., -]{1,95}\\s+(?:to\\s+|-\\s+|will\\s+)/u.test(title);
 const unsupportedStatistic=/\\b(?:asian\\s+handicap|handicap|fouls?|cards?|bookings?|tackles?|throw[ -]?ins?|saves?|goalkeeper\\s+saves?)\\b/.test(title);
 return playerMarket||unsupportedStatistic;
}
export const isHandicapOfferMarket = market =>
 market?.explicitlyExcluded === true || /\\bhandicap\\b/i.test(marketTitle(market));
export const isEarlyPayoutOfferMarket = market => /1x2\s*\(xup\)|early\s*payout/i.test(String(market?.name ?? market?.market_name ?? '')) || String(market?.native_market_id ?? market?.nativeMarketId ?? '') === '27073';
export const isExcludedOfferMarket = market =>
 isHandicapOfferMarket(market) || isEarlyPayoutOfferMarket(market) || isRetiredPlayerOfferMarket(market);
