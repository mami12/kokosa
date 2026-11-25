import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {updatePendingLinesBulk,manualSettleLine} from '../server/ledger/settler.mjs';

const db=new PGlite();
const pool={connect:async()=>({query:(text,values)=>db.query(text,values),release(){}})};
const ticketA='10000000-0000-4000-8000-000000000001';
const ticketB='10000000-0000-4000-8000-000000000002';
const lineA='20000000-0000-4000-8000-000000000001';
const lineB='20000000-0000-4000-8000-000000000002';
const lineC='20000000-0000-4000-8000-000000000003';
const actor='30000000-0000-4000-8000-000000000001';
const matchId=9001;
try{
 await db.exec(`
  create table app_ticket(id uuid primary key,status text not null);
  create table app_ticket_line(
   id uuid primary key,ticket_id uuid not null,match_id bigint not null,
   market_key text,market_name text not null,line text,outcome_key text,
   outcome_name text not null,status text not null,settled_odds numeric,
   settlement_reason text,accepted_contract jsonb,live_contract jsonb);
  create table app_settlement_override(line_id uuid primary key,status text not null,actor_id uuid,reason text not null,source text not null,updated_at timestamptz default now());
  create table app_match_result(match_id bigint primary key,source text,home_score integer,away_score integer,corners_home integer,corners_away integer,cards_home integer,cards_away integer,statistics jsonb);
  create table app_stat_review(match_id bigint primary key,payload jsonb);
  create table app_settlement_audit(
   id bigserial primary key,line_id uuid not null,ticket_id uuid not null,match_id bigint not null,
   status text not null,market_key text,market_name text not null,outcome_name text not null,
   source text not null,reason text not null,facts jsonb not null,evidence_hash text not null,
   decided_at timestamptz not null default now(),
   unique(line_id,status,evidence_hash));
 `);
 await db.query('insert into app_ticket(id,status) values($1,$2),($3,$4)',
  [ticketA,'PENDING',ticketB,'WON']);
 await db.query(`insert into app_ticket_line
  (id,ticket_id,match_id,market_key,market_name,line,outcome_key,outcome_name,status)
  values($1,$2,$5,'zz100@native','Total Corners','8.5','over','Over 8.5','PENDING'),
        ($3,$4,$5,'zz101@native','Total Cards','2.5','over','Over 2.5','PENDING'),
        ($6,$2,$5,'zz102@native','Total Goals','1.5','over','Over 1.5','PENDING')`,
  [lineA,ticketA,lineB,ticketB,matchId,lineC]);
 await db.query("insert into app_settlement_override(line_id,status,actor_id,reason,source) values($1,'PENDING',$2,'Needs manual review','ADMIN')",[lineC,actor]);
 const line={id:lineA,ticket_id:ticketA,match_id:matchId,market_key:'zz100@native',
  market_name:'Total Corners',line:'8.5',outcome_key:'over',outcome_name:'Over 8.5'};
 const result={source:'ZIZOBET',home_score:2,away_score:0,corners_home:6,corners_away:4,
  statistics:{corners:{home:6,away:4}},_settlementSources:{corners:['ZIZOBET']}};
 const proposals=[
  {lineId:lineA,ticketId:ticketA,status:'WON',settledOdds:2.1,line,result},
  {lineId:lineA,ticketId:ticketA,status:'WON',settledOdds:2.1,line,result},
  {lineId:lineB,ticketId:ticketB,status:'LOST',line:{...line,id:lineB,ticket_id:ticketB,market_name:'Total Cards'},result},
  {lineId:lineC,ticketId:ticketA,status:'LOST',line:{...line,id:lineC},result}
 ];
 const changed=await updatePendingLinesBulk(proposals,{database:pool});
 assert.equal(changed.length,1,'duplicate proposals, closed tickets, and manual overrides are ignored');
 const rows=(await db.query('select id,status,settled_odds from app_ticket_line order by id')).rows;
 assert.equal(rows.find(row=>row.id===lineA).status,'WON');
 assert.equal(Number(rows.find(row=>row.id===lineA).settled_odds),2.1);
 assert.equal(rows.find(row=>row.id===lineB).status,'PENDING','non-pending ticket cannot be changed');
 assert.equal(rows.find(row=>row.id===lineC).status,'PENDING','manual override cannot be changed');
 const audit=(await db.query('select * from app_settlement_audit')).rows;
 assert.equal(audit.length,1,'changed line and audit row commit together');
 assert.equal(audit[0].source,'ZIZOBET');
 assert.equal(audit[0].reason,'VERIFIED_FACTS_MATCHED_ACCEPTED_MARKET_RULE');
 assert.equal(audit[0].facts.selection.marketName,'Total Corners');
 assert.deepEqual(audit[0].facts.statistics.corners.value,{home:6,away:4});
 let recalculated=null;
 const manual=await manualSettleLine(lineC,'WON',{
  actorId:actor,reason:'Kornerat u verifikuan manualisht nga burimi final',
  database:pool,recalc:async ticketId=>{recalculated=ticketId;return {ticketId,status:'WON',payout:2.1};}
 });
 assert.equal(manual.status,'WON');
 assert.equal(manual.ticketId,ticketA);
 assert.equal(recalculated,ticketA,'the manual decision uses the existing ticket recalculation hook');
 assert.equal((await db.query('select status from app_ticket_line where id=$1',[lineC])).rows[0].status,'WON');
 const manualOverride=(await db.query('select status,actor_id,reason,source from app_settlement_override where line_id=$1',[lineC])).rows[0];
 assert.equal(manualOverride.status,'WON');
 assert.equal(manualOverride.actor_id,actor);
 assert.equal(manualOverride.source,'ADMIN');
 assert.match(manualOverride.reason,/Kornerat/);
 const manualAudit=(await db.query('select status,source,reason,facts from app_settlement_audit where line_id=$1',[lineC])).rows[0];
 assert.equal(manualAudit.status,'WON');
 assert.equal(manualAudit.source,'ADMIN');
 assert.equal(manualAudit.facts.actorId,actor);
 assert.equal(manualAudit.facts.reason,manualOverride.reason);
 const retry=await updatePendingLinesBulk(proposals,{database:pool});
 assert.equal(retry.length,0,'a retry cannot regrade a line or create another audit');
 assert.equal((await db.query('select count(*)::int as count from app_settlement_audit')).rows[0].count,1);
}finally{await db.close();}
console.log('PASS transactional bulk grading, duplicate prevention, manual override protection, source audit, and safe retries');
