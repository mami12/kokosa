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
 const text=String(line.market_name??line.name??'').toLowerCase();
 if(/yellow/.test(text))return ['yellow'];
 if(/red/.test(text))return ['red'];
 if(/card|booking|karton/.test(text))return ['cards'];
 if(/corner|korner/.test(text))return ['corners'];
 if(/shot.*(?:target|goal)|goditj.*port/.test(text))return ['shotsOnTarget'];
 if(/shot|goditj/.test(text))return ['shots'];
 if(/foul|faull/.test(text))return ['fouls'];
 return [];
}
const primaryPair=(result,field)=>{
 if(field==='corners')return pair({home:result?.corners_home,away:result?.corners_away});
 if(field==='cards')return pair({home:result?.cards_home,away:result?.cards_away});
 let stats=result?.statistics;if(typeof stats==='string'){try{stats=JSON.parse(stats);}catch{stats=null;}}
 return pair(stats?.[field]);
};
/** Attach only missing secondary consensus facts to a copy of the primary result.
 * The original Zizobet result columns and source are never replaced.
 */
export function resolveSettlementStatistics(result){
 if(!result||typeof result!=='object')return result;
 const review=result.statistics_review;
 if(!review||typeof review!=='object')return result;
 let statistics=result.statistics;
 if(typeof statistics==='string'){try{statistics=JSON.parse(statistics);}catch{statistics={};}}
 statistics={...(statistics??{})};
 const resolved={...(result._settlementSources??{})};
 const output={...result,statistics};
 for(const field of REVIEW_FIELDS){
  const primary=primaryPair(result,field);
  if(primary){
   if(field==='cards'&&!pair(statistics.cards))statistics.cards=primary;
   resolved[field]=[String(result.source??'ZIZOBET').toUpperCase()];continue;
  }
  let candidate=pair(review.consensus?.[field]);
  let providers=Object.entries(review.sources??{}).length?[]:[];
  providers=(review.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.[field]),candidate))
   .map(source=>({provider:source.provider,observedAt:source.observedAt??null,fixtureId:source.fixtureId??null}));
  if(!candidate&&field==='cards'){
   const yellow=pair(review.consensus?.yellow),red=pair(review.consensus?.red);
   const yProviders=(review.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.yellow),yellow)).map(source=>source.provider);
   const rProviders=(review.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.red),red)).map(source=>source.provider);
   const shared=yProviders.filter(provider=>rProviders.includes(provider));
   if(yellow&&red&&shared.length){candidate={home:yellow.home+red.home,away:yellow.away+red.away};providers=shared.map(provider=>({provider,observedAt:review.checkedAt??null,fixtureId:null}));}
  }
  if(!candidate||review.conflicts?.[field])continue;
  if(!providers.length)continue;
  if(field==='corners'){output.corners_home=candidate.home;output.corners_away=candidate.away;}
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
  if(result?.statistics_review_pending&&!review)return true;
  if(review?.complete!==true||!pair(review?.consensus?.[field])){
   if(review)return true;
  }
 }
 return false;
}
