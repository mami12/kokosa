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
 // Player props and event windows use player/event evidence, not aggregate FT totals.
 if(/\b(?:player|players|scorer|assist|to be booked|to receive a card)\b/.test(name)||
    /\b(?:next|first|last|race|interval|window|minute|minutes|between|within|before|after|sequence|nth|first half|second half|1st half|2nd half|1h|2h)\b/.test(name))return [];
 if(/yellow/.test(name))return ['yellow'];
 if(/red/.test(name))return ['red'];
 if(/card|booking|karton/.test(name))return ['cards'];
 if(/corner|korner/.test(name))return ['corners'];
 if(/shot.*(?:target|goal)|goditj.*port/.test(name))return ['shotsOnTarget'];
  if(/offsides?|offside/.test(name))return ['offsides'];
 if(/shot|goditj/.test(name))return ['shots'];
 if(/foul|faull/.test(name))return ['fouls'];
 return [];
}
const resultStatistics=result=>{
 let value=result?.statistics;
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{value={};}}
 return value??{};
};
const primaryValues=(result,field)=>{
 const stats=resultStatistics(result),raw=field==='corners'?
  {home:result?.corners_home??stats.corners?.home,away:result?.corners_away??stats.corners?.away}:
  field==='cards'?
  {home:result?.cards_home??stats.cards?.home,away:result?.cards_away??stats.cards?.away}:
  stats[field]??{};
 return {home:valid(raw.home)?Number(raw.home):null,away:valid(raw.away)?Number(raw.away):null};
};
const primaryPair=(result,field)=>{
 const values=primaryValues(result,field);
 return values.home===null||values.away===null?null:values;
};
const hasAnyPrimary=(result,field)=>{
 const values=primaryValues(result,field);
 return values.home!==null||values.away!==null;
};
const reviewCandidate=(review,field)=>{
 let candidate=pair(review?.consensus?.[field]),providers=[];
 providers=(review?.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.[field]),candidate))
  .map(source=>({provider:source.provider,observedAt:source.observedAt??null,fixtureId:source.fixtureId??null}));
 if(!candidate&&field==='cards'){
  const yellow=pair(review?.consensus?.yellow),red=pair(review?.consensus?.red);
  const y=(review?.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.yellow),yellow)).map(source=>source.provider);
  const r=(review?.sources??[]).filter(source=>source.final===true&&same(pair(source.values?.red),red)).map(source=>source.provider);
  const shared=y.filter(provider=>r.includes(provider));
  if(yellow&&red&&shared.length){
   candidate={home:yellow.home+red.home,away:yellow.away+red.away};
   providers=shared.map(provider=>({provider,observedAt:review.checkedAt??null,fixtureId:null}));
  }
 }
 return {candidate,providers};
};
/** Attach only missing secondary consensus facts to a copy of the primary result.
 * A partial primary pair may be completed only when the secondary source agrees
 * with every side already known. The original score/source are never replaced.
 */
export function resolveSettlementStatistics(result){
 if(!result||typeof result!=='object')return result;
 const review=result.statistics_review&&typeof result.statistics_review==='object'?result.statistics_review:null;
 const statistics={...resultStatistics(result)},resolved={...(result._settlementSources??{})};
 const output={...result,statistics};
 for(const field of REVIEW_FIELDS){
  let primary=primaryValues(result,field);
  // Full-time total cards can be reconstructed only from both verified Zizobet
  // color counts; an aggregate-only count cannot identify yellow vs red.
  if(field==='cards'&&primary.home===null&&primary.away===null){
   const yellow=primaryPair(result,'yellow'),red=primaryPair(result,'red');
   if(yellow&&red)primary={home:yellow.home+red.home,away:yellow.away+red.away};
  }
  if(primary.home!==null&&primary.away!==null){
   if(field==='corners'){output.corners_home=primary.home;output.corners_away=primary.away;statistics.corners=primary;}
   else if(field==='cards'){output.cards_home=primary.home;output.cards_away=primary.away;statistics.cards=primary;}
   else statistics[field]=primary;
   const source=String(result.source??'ZIZOBET').toUpperCase();
   resolved[field]=[source==='FEED'?'ZIZOBET':source];continue;
  }
  if(!review||review.conflicts?.[field])continue;
  const {candidate,providers}=reviewCandidate(review,field);
  if(!candidate||!providers.length)continue;
  if((primary.home!==null&&primary.home!==candidate.home)||
     (primary.away!==null&&primary.away!==candidate.away))continue;
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
 for(const field of fields){
  if(review?.conflicts?.[field])return true;
  let primary=primaryValues(result,field);
  if(field==='cards'&&primary.home===null&&primary.away===null){
   const yellow=primaryPair(result,'yellow'),red=primaryPair(result,'red');
   if(yellow&&red)primary={home:yellow.home+red.home,away:yellow.away+red.away};
  }
  if(primary.home!==null&&primary.away!==null)continue;
  const {candidate}=reviewCandidate(review,field);
  if(primary.home!==null||primary.away!==null){
   if(!candidate||(primary.home!==null&&primary.home!==candidate.home)||
      (primary.away!==null&&primary.away!==candidate.away))return true;
   continue;
  }
  if(result?.statistics_review_pending&&!review)return true;
  if(review&&(!review.complete||!candidate))return true;
 }
 return false;
}
