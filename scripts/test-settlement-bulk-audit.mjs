import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {updatePendingLinesBulk} from '../server/ledger/settler.mjs';

const db=new PGlite();
const pool={connect:async()=>({query:(text,values)=>db.query(text,values),release(){}})};
const ticketA='10000000-0000-4000-8000-000000000001';
const ticketB='10000000-0000-4000-8000-000000000002';
const lineA='20000000-0000-4000-8000-000000000001';
const lineB='20000000-0000-4000-8000-000000000002';
const lineC='20000000-0000-4000-8000-000000000003';
const matchId=9001;
try{
 await db.exec(`
  create table app_ticket(id uuid primary key,status text not null);
  create table app_ticket_line(
   id uuid primary key,ticket_id uuid not null,match_id bigint not null,
   market_key text,market_name text not null,line text,outcome_key text,
   outcome_name text not null,status text not null,settled_odds numeric,
   settlement_reason text);
  create table app_settlement_override(line_id uuid primary key);
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
 await db.query('insert into app_settlement_override(line_id) values($1)',[lineC]);
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
 const retry=await updatePendingLinesBulk(proposals,{database:pool});
 assert.equal(retry.length,0,'a retry cannot regrade a line or create another audit');
 assert.equal((await db.query('select count(*)::int as count from app_settlement_audit')).rows[0].count,1);
}finally{await db.close();}
console.log('PASS transactional bulk grading, duplicate prevention, manual override protection, source audit, and safe retries');
