/** Final-source comparison and market-scoped settlement evidence. */
export const SETTLEMENT_REVIEW_SQL=`
create table if not exists app_stat_review(match_id bigint primary key,payload jsonb not null,updated_at timestamptz not null default now());
create table if not exists app_settlement_override(line_id uuid primary key references app_ticket_line(id) on delete restrict,status text not null check(status in ('PENDING','WON','LOST','VOID')),actor_id uuid references app_user(id),reason text not null,source text not null,updated_at timestamptz not null default now());
alter table app_settlement_override drop constraint if exists app_settlement_override_status_check;
alter table app_settlement_override add constraint app_settlement_override_status_check check(status in ('PENDING','WON','LOST','VOID'));
`;
export const REVIEW_FIELDS=['corners','shots','shotsOnTarget','fouls','yellow','red','cards'];
const valid=v=>v!==null&&v!==undefined&&v!==''&&Number.isInteger(Number(v))&&Number(v)>=0;
const pair=value=>value&&valid(value.home)&&valid(value.away)?{home:Number(value.home),away:Number(value.away)}:null;
const same=(a,b)=>!!a&&!!b&&a.home===b.home&&a.away===b.away;
export function compareFinalStatistics(observations,{attempted=[],unavailable={}}={}){
 const sources=observations.filter(item=>item.final===true),conflicts={},consensus={};
 for(const field of REVIEW_FIELDS){
  const evidence={};
  for(const source of sources){const p=pair(source.values?.[field]);if(p)evidence[source.provider]={...p,observedAt:source.observedAt??null,fixtureId:source.fixtureId??null};}
  const variants=new Set(Object.values(evidence).map(({home,away})=>JSON.stringify([home,away])));
  if(variants.size>1)conflicts[field]=evidence;
  else if(variants.size===1){const p=Object.values(evidence)[0];consensus[field]={home:p.home,away:p.away};}
 }
 return {final:true,complete:true,attempted,unavailable,sources,consensus,conflicts,
  status:Object.keys(conflicts).length?'MANUAL_REVIEW':'VERIFIED',checkedAt:new Date().toISOString()};
}
export function settlementStatisticFields(line){
 if(Array.isArray(line.builder_legs))return [...new Set(line.builder_legs.flatMap(settlementStatisticFields))];
 const name=String(line.market_name??line.name??'').toLowerCase();
 // Event windows and sequence contracts use an incident timeline, not aggregate FT totals.
 if(/\b(?:next|first|last|race|interval|window|minute|minutes|between|within|before|after|sequence|nth|first half|second half|1st half|2nd half|1h|2h)\b/.test(name))return [];
 if(/yellow/.test(name))return ['yellow'];
 if(/red/.test(name))return ['red'];
 if(/card|booking|karton/.test(name))return ['cards'];
 if(/corner|korner/.test(name))return ['corners'];
 if(/shot.*(?:target|goal)|goditj.*port/.test(name))return ['shotsOnTarget'];
 if(/shot|goditj/.test(name))return ['shots'];
 if(/foul|faull/.test(name))return ['fouls'];
 return [];
}
const resultStatistics=result=>{
 let value=result?.statistics;
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{value={};}}
 return value??{};
};
const primaryPair=(result,field)=>{
 const stats=resultStatistics(result);
 if(field==='corners')return pair({home:result?.corners_home??stats.corners?.home,away:result?.corners_away??stats.corners?.away});
 if(field==='cards')return pair({home:result?.cards_home??stats.cards?.home,away:result?.cards_away??stats.cards?.away});
 return pair(stats[field]);
};
const hasAnyPrimary=(result,field)=>{
 const stats=resultStatistics(result);
 if(field==='corners')return result?.corners_home!=null||result?.corners_away!=null||stats.corners?.home!=null||stats.corners?.away!=null;
 if(field==='cards')return result?.cards_home!=null||result?.cards_away!=null||stats.cards?.home!=null||stats.cards?.away!=null;
 return stats[field]?.home!=null||stats[field]?.away!=null;
};
/** Attach only missing secondary consensus facts to a copy of the primary result.
 * Never overwrite either side of a partial primary value or a conflicting field.
 */
export function resolveSettlementStatistics(result){
 if(!result||typeof result!=='object')return result;
 const review=result.statistics_review;
 if(!review||typeof review!=='object')return result;
 const statistics={...resultStatistics(result)},resolved={...(result._settlementSources??{})};
 const output={...result,statistics};
 for(const field of REVIEW_FIELDS){
  const primary=primaryPair(result,field);
  if(primary){
   if(field==='cards')statistics.cards=primary;
   if(field==='corners')statistics.corners=primary;
   resolved[field]=[String(result.source??'ZIZOBET').toUpperCase()];continue;
  }
  if(hasAnyPrimary(result,field))continue;
  let candidate=pair(review.consensus?.[field]),providers=[];
  providers=(review.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.[field]),candidate))
   .map(source=>({provider:source.provider,observedAt:source.observedAt??null,fixtureId:source.fixtureId??null}));
  if(!candidate&&field==='cards'){
   const yellow=pair(review.consensus?.yellow),red=pair(review.consensus?.red);
   const yProviders=(review.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.yellow),yellow)).map(source=>source.provider);
   const rProviders=(review.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.red),red)).map(source=>source.provider);
   const shared=yProviders.filter(provider=>rProviders.includes(provider));
   if(yellow&&red&&shared.length){candidate={home:yellow.home+red.home,away:yellow.away+red.away};providers=shared.map(provider=>({provider,observedAt:review.checkedAt??null,fixtureId:null}));}
  }
  if(!candidate||review.conflicts?.[field]||!providers.length)continue;
  if(field==='corners'){output.corners_home=candidate.home;output.corners_away=candidate.away;statistics.corners=candidate;}
  else if(field==='cards'){output.cards_home=candidate.home;output.cards_away=candidate.away;statistics.cards=candidate;}
  else statistics[field]=candidate;
  resolved[field]=providers;
 }
 output._settlementSources=resolved;
 return output;
}
export function statisticsNeedReview(line,result){
 const fields=settlementStatisticFields(line);if(!fields.length)return false;
 const review=result?.statistics_review;
 if(fields.some(field=>review?.conflicts?.[field]))return true;
 for(const field of fields){
  if(primaryPair(result,field))continue;
  if(hasAnyPrimary(result,field))return true;
  if(result?.statistics_review_pending&&!review)return true;
  if(review&&(!review.complete||!pair(review.consensus?.[field])))return true;
 }
 return false;
}
