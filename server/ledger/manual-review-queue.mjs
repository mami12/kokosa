import {query} from '../db.mjs';
import {eventMarketRequirement} from './event-market-policy.mjs';
import {settlementStatisticFields} from './settlement-review.mjs';
import {isProvenTwoWayTotalPush} from './settler.mjs';

const NOTICE_LIFETIME_MS=48*60*60*1000;
const text=value=>String(value??'').trim();
const nowDate=value=>{const n=new Date(value).getTime();return Number.isFinite(n)?n:0;};
/** Why this specific selection should be reviewed, never an automatic decision. */
export function reviewReason(row,now=Date.now()){
 const market=text(row.market_name);
 // Scoring Type is a goal-method contract. The current Zizobet timeline
 // adapter preserves own-goal hints, but not verified penalty/header/foot data.
 // Keep this explicit reason even when an earlier attempt marked the line VOID.
 if(/\bscoring type\b/i.test(market)&&['PENDING','VOID'].includes(row.line_status))
  return 'MISSING_GOAL_METHOD_EVIDENCE';
 if(row.line_status==='VOID'){
  // A confirmed two-way integer Over/Under push is already a valid settlement,
  // not an API anomaly for the administrator to resolve manually.
  if(isProvenTwoWayTotalPush(row,row))return null;
  return 'VOID_NEEDS_CONFIRMATION';
 }
 if(row.line_status!=='PENDING'||row.ticket_status!=='PENDING')return null;
 // Native offers accepted without a proven settlement rule are visible to
 // staff immediately, even while their match is still LIVE.
 if(row.accepted_contract?.settlementHold||row.settlement_reason==='NATIVE_RULE_REVIEW')
  return 'NATIVE_CONTRACT_REVIEW';
 const review=row.statistics_review;
 if(row.result_id!=null){
  const fields=settlementStatisticFields(row);
  if(fields.some(field=>review?.conflicts?.[field]))return 'CONFLICTING_API_STATISTICS';
  if(eventMarketRequirement(row)||/\b(?:interval|minute|next goal|next corner|race to|early payout)\b/i.test(market))return 'MISSING_EVENT_TIMELINE';
  if(fields.length||/\b(?:half|period)\b/i.test(market))return 'MISSING_MARKET_STATISTICS';
  // Every unresolved final-market selection deserves an admin decision.
  return 'UNRESOLVED_FINAL_SELECTION';
 }
 // A live/prematch market cannot be called invalid merely because it has no FT.
 const status=text(row.feed_status??row.match_status).toLowerCase();
 if(/^(?:live|1h|2h|first half|second half|prematch|scheduled)$/.test(status))return null;
 if(now-nowDate(row.placed_at)<6*60*60*1000)return null;
 return 'MISSING_FINAL_RESULT';
}
export async function manualReviewQueue({runQuery=query,limit=150,now=Date.now()}={}){
 const cap=Math.min(2000,Math.max(1,Math.trunc(Number(limit)||150)));
 const scanLimit=Math.min(20000,cap*10);
 const rows=(await runQuery(`select l.id as line_id,l.ticket_id,l.match_id,l.market_key,l.line,l.outcome_key,
    l.outcome_name,l.market_name,l.match_name,l.status as line_status,l.odds_at_placement,
    l.accepted_contract,l.live_contract,
    l.accepted_contract->'acceptedLiveSnapshot' as placement_snapshot,
    l.settlement_reason,
    t.status as ticket_status,t.placed_at,t.stake,t.original_potential_payout,
    u.username,r.match_id as result_id,r.home_score,r.away_score,r.statistics as final_statistics,
    r.half_home_score,r.half_away_score,r.corners_home,r.corners_away,r.cards_home,r.cards_away,
    sr.payload as statistics_review,m.status as match_status,m.feed_status,
    o.status as override_status,n.first_seen_at
    from app_ticket_line l
    join app_ticket t on t.id=l.ticket_id
    left join app_user u on u.id=t.user_id
    left join app_match_result r on r.match_id=l.match_id
    left join app_stat_review sr on sr.match_id=l.match_id
    left join matches m on m.match_id=l.match_id
    left join app_settlement_override o on o.line_id=l.id
    left join app_manual_review_notice n on n.line_id=l.id
    where l.status in ('PENDING','VOID')
      and t.status not in ('CANCELLED','REVERTED','CASHED_OUT')
      and (o.line_id is null or o.status='PENDING')
      and (l.status='VOID' or r.match_id is not null or t.placed_at<now()-interval '6 hours'
        or coalesce(l.accepted_contract->>'settlementHold','')<>'')
    order by case when l.status='VOID' then 0 else 1 end,t.placed_at desc
    limit $1`,[scanLimit])).rows;
 const items=[];
 for(const row of rows){
  const reason=reviewReason(row,now);if(!reason)continue;
  let firstSeenAt=row.first_seen_at;
  if(!firstSeenAt){
   const notice=await runQuery(`insert into app_manual_review_notice(line_id,first_seen_at)
    values($1,$2) on conflict(line_id) do update set first_seen_at=app_manual_review_notice.first_seen_at
    returning first_seen_at`,[row.line_id,new Date(now)]);
   firstSeenAt=notice.rows[0].first_seen_at;
  }
  const noticeExpiresAt=new Date(nowDate(firstSeenAt)+NOTICE_LIFETIME_MS);
  items.push({noticeExpiresAt:noticeExpiresAt.toISOString(),notificationActive:now<noticeExpiresAt.getTime(),lineId:row.line_id,ticketId:row.ticket_id,matchId:String(row.match_id),
   marketKey:row.market_key,marketLine:row.line??'',marketName:row.market_name,
   matchName:row.match_name,outcomeKey:row.outcome_key,outcomeName:row.outcome_name,
   lineStatus:row.line_status,ticketStatus:row.ticket_status,username:row.username??null,
   placedAt:row.placed_at,stake:row.stake,odds:row.odds_at_placement,
   potentialPayout:row.original_potential_payout,
   finalScore:row.result_id!=null?row.home_score+' - '+row.away_score:null,
   placementSnapshot:row.placement_snapshot??null,
   liveContract:row.live_contract??null,
   finalStatistics:row.final_statistics??null,
   reason,conflicts:row.statistics_review?.conflicts??null});
  if(items.length>=cap)break;
 }
 const matchIds=[...new Set(items.map(item=>Number(item.matchId)).filter(id=>Number.isSafeInteger(id)&&id>0))];
 const eventsByMatch=new Map(),coverageByMatch=new Map();
 if(matchIds.length){
  const eventRows=(await runQuery(`with confirmed as (
    select c.match_id,c.kind as coverage_kind,c.through_minute,c.complete,
      c.confirmed_at,c.count_home,c.count_away,c.card_colors_verified,
      f.provider_event_id,f.kind as event_kind,f.team,f.minute,f.seconds,
      case when f.supplemental_verified then f.supplemental_player_name
        when f.aiscore_verified then f.aiscore_player_name
        when f.fotmob_verified then f.fotmob_player_name
        else f.player_name end as player_name,
      f.card_color,f.own_goal,f.phase,
      row_number() over(partition by c.match_id,c.kind
        order by f.minute,f.seconds nulls last,f.provider_event_id) as event_index
    from app_match_event_coverage c
    left join app_match_event_fact f
      on f.match_id=c.match_id and f.provider=c.provider
      and f.kind=c.kind and f.active=true
    where c.match_id=any($1::bigint[]) and c.provider='zizobet'
      and c.confirmed_at is not null
      and c.kind in ('goal','corner','card','foul')
  )
  select * from confirmed where event_index<=250
  order by match_id,minute,seconds nulls last,provider_event_id`,[matchIds])).rows;
  for(const row of eventRows){
   const id=String(row.match_id),kind=String(row.coverage_kind??'');
   if(!coverageByMatch.has(id))coverageByMatch.set(id,new Map());
   if(kind&&!coverageByMatch.get(id).has(kind)){
    coverageByMatch.get(id).set(kind,{
     kind,throughMinute:Number(row.through_minute),complete:row.complete===true,
     confirmedAt:row.confirmed_at,countHome:Number(row.count_home),countAway:Number(row.count_away),
     cardColorsVerified:row.card_colors_verified===true
    });
   }
   if(row.event_kind&&row.provider_event_id!=null){
    if(!eventsByMatch.has(id))eventsByMatch.set(id,[]);
    eventsByMatch.get(id).push({
     id:String(row.provider_event_id),kind:String(row.event_kind),team:String(row.team),
     minute:Number(row.minute),seconds:row.seconds==null?null:Number(row.seconds),
     playerName:row.player_name??null,cardColor:row.card_color??null,
     ownGoal:row.own_goal??null,phase:row.phase??null,verified:true
    });
   }
  }
 }
 for(const item of items){
  const id=String(item.matchId);
  item.eventTimeline=eventsByMatch.get(id)??[];
  item.eventCoverage=[...(coverageByMatch.get(id)?.values()??[])];
  item.eventTimelineSource=item.eventTimeline.length?'ZIZOBET_CONFIRMED':'UNAVAILABLE';
 }
 return {items,count:items.length,notificationCount:items.filter(item=>item.notificationActive).length,hasMore:items.length>=cap||rows.length===scanLimit};
}
