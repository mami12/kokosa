import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pool} from '../server/db.mjs';
import {SCHEMA_SQL} from '../server/schema.mjs';
import {LEDGER_SQL} from '../server/ledger/schema.mjs';
import {settleMatch} from '../server/ledger/settler.mjs';
import {frozenLiveContract} from '../server/ledger/live-contract-context.mjs';
import {nativeZizobetContractRow} from '../server/ledger/native-zizobet-contract.mjs';
import {SUPPORTED_FACT_KINDS} from '../server/ledger/match-event-facts.mjs';

const db=new PGlite();
const original={query:pool.query,connect:pool.connect};
const run=(sql,params=[])=>db.query(sql,params);
const userId=randomUUID(),matchId=88112726001;
const home='Home FC',away='Away FC';
const acceptedAt=Date.parse('2026-11-27T12:00:00Z');
const scheduled={service:'PREMATCH',start_at:'2030-01-01T20:00:00Z',home,away};
const quotes=[];
let nextMarketId=71000;

function offer(market,outcome,{line='',period=0,params={},hold=null}={}){
 const id=nextMarketId++;
 const marketKey='zz'+id+'@'+Buffer.from(JSON.stringify(params)).toString('base64url');
 const raw={
  provider_id:'ZIZOBET',native_market_id:String(id),native_market_name:market,
  native_parameters:params,market_key:marketKey,market_name:market,
  outcome_name:outcome,outcome_key:outcome,line,period
 };
 const normalized=nativeZizobetContractRow(raw,{competitors:{home,away}});
 const frozen=frozenLiveContract(normalized,scheduled,acceptedAt);
 if(frozen&&!SUPPORTED_FACT_KINDS.has(frozen.kind))
  throw new Error('Unsettleable frozen Zizobet contract: '+market+' -> '+frozen.kind);
 const accepted={
  version:1,sourceProviderId:'ZIZOBET',
  providerMarketName:market,providerOutcomeName:outcome,
  providerMarketKey:marketKey,providerOutcomeKey:outcome,
  providerPeriod:period,line, nativeMarketId:String(id),
  nativeMarketName:market,nativeParameters:params,
  homeTeamName:home,awayTeamName:away,
  ...(hold?{settlementHold:hold}:{})
 };
 const entry={
  market:normalized.market_name,outcome,line,period,marketKey,
  nativeMarketId:String(id),nativeMarketName:market,nativeParameters:params,
  accepted,liveContract:frozen
 };
 quotes.push(entry);
 return entry;
}

const cases=[
 {name:'FT goals Over',quote:offer('Full Time Total Goals','Over',{line:'2.5'}),expected:'WON'},
 {name:'FT goals Under',quote:offer('Full Time Total Goals','Under',{line:'2.5'}),expected:'LOST'},
 {name:'1H goals total',quote:offer('1st half - Total Goals','Over',{line:'0.5',period:1}),expected:'WON'},
 {name:'2H goals total',quote:offer('2nd half - Total Goals','Under',{line:'2.5',period:2}),expected:'WON'},
 {name:'FT corner total',quote:offer('Total Corners','Over',{line:'8.5'}),expected:'WON'},
 {name:'Home corner total',quote:offer('Home Team Total Corners','Over',{line:'5.5'}),expected:'WON'},
 {name:'Away corner total',quote:offer('Away Team Total Corners','Under',{line:'4.5'}),expected:'WON'},
 {name:'FT card total',quote:offer('Total Cards','Over',{line:'2.5'}),expected:'WON'},
 {name:'Yellow card total',quote:offer('Total Yellow Cards','Over',{line:'1.5'}),expected:'WON'},
 {name:'Red card total',quote:offer('Total Red Cards','Under',{line:'0.5'}),expected:'WON'},
 {name:'1H card total',quote:offer('1st half - Total Cards','Over',{line:'0.5',period:1}),expected:'WON'},
 {name:'Shots on target total',quote:offer('Total Shots on Target','Over',{line:'5.5'}),expected:'WON'},
 {name:'Fouls total',quote:offer('Total Fouls','Over',{line:'19.5'}),expected:'WON'},
 {name:'Result plus total',quote:offer('Result and Total','1 & Over 2.5'),expected:'WON'},
 {name:'Total plus BTTS',quote:offer('Total and BTTS','Over 2.5 & Yes',{line:'2.5'}),expected:'WON'},
 {name:'1H result plus BTTS',quote:offer('1st Half. Result and Both Teams To Score','1 & No',{period:1}),expected:'WON'},
 {name:'1H correlated result and total',quote:offer('1st Half Result and Total','1 & Over 0.5',{line:'0.5',period:1}),expected:'WON'},
 {name:'2H correlated result and total',quote:offer('2nd Half Result and Total','X & Over 1.5',{line:'1.5',period:2}),expected:'WON'},
 {name:'HT/FT',quote:offer('HT/FT','1/1'),expected:'WON'},
 {name:'Winning margin',quote:offer('Winning Margin','Home by 1'),expected:'WON'},
 {name:'Clean sheet negative selection',quote:offer('Clean sheet home team','No'),expected:'WON'},
 {name:'Corner odd/even',quote:offer('Total Corners Odd/Even','Even'),expected:'WON'},
 {name:'1H home corner total',quote:offer('1st half - Total corners Home team (3.5)','Over',{line:'3.5',period:1}),expected:'WON'},
 {name:'Half with most corners',quote:offer('Half with Most Corners','Draw'),expected:'WON'},
 {name:'Most corners',quote:offer('Most Corners','1'),expected:'WON'},
 {name:'Multi-Corners',quote:offer('Multi-Corners','Over',{line:'24.5'}),expected:'WON'},
 {name:'Native 5-minute home corner interval',quote:offer(
  'Total [total] Corners HomeTeam in 5 minutes interval [from]-[to]','Over',
  {line:'0.5',params:{p1:16,p2:20,h:0.5}}),expected:'WON'},
 {name:'Goal interval',quote:offer('Total goals in minutes 16-20 (5-minute interval)','Over',{line:'0.5'}),expected:'WON'},
 {name:'Card interval',quote:offer('Total cards in minutes 16-20 (5-minute interval)','Over',{line:'0.5'}),expected:'WON'},
 {name:'Unknown native composite stays pending',quote:offer('Unknown Compound Special','A + B',{
  hold:'NATIVE_FINAL_RULE_UNMAPPED'}),expected:'PENDING'}
];

try{
 await db.exec(LEDGER_SQL);
 await db.exec(SCHEMA_SQL);
 pool.query=(sql,params)=>run(sql,params);
 pool.connect=async()=>({query:run,release(){}});
 await run(
  'insert into app_user(id,username,password_hash,role,balance) values($1,$2,$3,$4,$5)',
  [userId,'market-family-money-flow','isolated','PLAYER',1000-cases.length*10]
 );
 const statistics={
  cards:{home:2,away:1},
  yellow:{home:2,away:1},
  red:{home:0,away:0},
  shotsOnTarget:{home:4,away:2},
  fouls:{home:9,away:11},
  periods:{
   firstHalf:{cards:{home:1,away:0},corners:{home:4,away:1}},
   secondHalf:{cards:{home:1,away:1},corners:{home:2,away:3}}
  }
 };
 await run(
  'insert into app_match_result(match_id,home_team,away_team,home_score,away_score,half_home_score,half_away_score,corners_home,corners_away,cards_home,cards_away,source,statistics) values($1,$2,$3,2,1,1,0,6,4,2,1,$4,$5::jsonb)',
  [matchId,home,away,'ADMIN',JSON.stringify(statistics)]
 );

 const stamp=new Date('2026-11-27T12:30:00Z');
 await run('insert into app_live_event_cursor(match_id,last_seen_at) values($1,$2)',[matchId,stamp]);
 const events={
  goal:[
   ['g1','home',17,'H1',null],
   ['g2','home',55,'H2',null],
   ['g3','away',72,'H2',null]
  ],
  corner:[
   ['c1','home',5,'H1',null],['c2','away',10,'H1',null],
   ['c3','home',17,'H1',null],['c4','home',25,'H1',null],
   ['c5','home',38,'H1',null],
   ['c6','away',51,'H2',null],['c7','home',60,'H2',null],
   ['c8','away',70,'H2',null],['c9','home',80,'H2',null],
   ['c10','away',89,'H2',null]
  ],
  card:[
   ['b1','home',18,'H1','yellow'],
   ['b2','home',56,'H2','yellow'],
   ['b3','away',74,'H2','yellow']
  ]
 };
 for(const [kind,rows] of Object.entries(events)){
  for(const [id,team,minute,phase,color] of rows){
   await run(
    'insert into app_match_event_fact(match_id,provider,provider_event_id,kind,team,minute,seconds,card_color,phase,active) values($1,$2,$3,$4,$5,$6,$7,$8,$9,true)',
    [matchId,'zizobet',id,kind,team,minute,minute*60+12,color,phase]
   );
  }
  const homeCount=rows.filter(row=>row[1]==='home').length;
  const awayCount=rows.filter(row=>row[1]==='away').length;
  await run(
   'insert into app_match_event_coverage(match_id,provider,kind,through_minute,count_home,count_away,complete,observed_at,confirmed_at,card_colors_verified) values($1,$2,$3,90,$4,$5,true,$6,$6,$7)',
   [matchId,'zizobet',kind,homeCount,awayCount,stamp,kind==='card']
  );
 }

 for(const [index,item] of cases.entries()){
  const ticketId=randomUUID(),lineId=randomUUID();
  const odds=2,stake=10;
  await run(
   "insert into app_ticket(id,user_id,booking_code,stake,total_odds,potential_payout,ticket_type,status) values($1,$2,$3,$4,$5,$6,'COMBO','PENDING')",
   [ticketId,userId,'MF'+String(index+1).padStart(3,'0'),stake,odds,stake*odds]
  );
  await run(
   'insert into app_ticket_line(id,ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,odds_at_placement,accepted_contract,live_contract,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13)',
   [lineId,ticketId,matchId,item.quote.marketKey,item.quote.line,
    item.quote.outcome,item.quote.outcome,item.quote.market,
    home+' vs '+away,odds,JSON.stringify(item.quote.accepted),
    item.quote.liveContract?JSON.stringify(item.quote.liveContract):null,'PENDING']
  );
  item.ticketId=ticketId;item.lineId=lineId;
 }

 const settled=await settleMatch(matchId);
 const expectedResolved=cases.filter(item=>item.expected!=='PENDING').length;
 assert.equal(settled.settled,expectedResolved,
  'The real settleMatch path must decide every supported market-family fixture');
 assert.equal(settled.awaitingEvidence,1,
  'An unknown native composite without a matching rule must stay PENDING');
 for(const item of cases){
  const ticket=(await run('select status from app_ticket where id=$1',[item.ticketId])).rows[0];
  const line=(await run('select status from app_ticket_line where id=$1',[item.lineId])).rows[0];
  assert.equal(ticket.status,item.expected,'Ticket payout status: '+item.name+' ('+item.quote.market+')');
  assert.equal(line.status,item.expected,'Ticket line status: '+item.name);
  const audit=(await run('select market_name,status,source from app_settlement_audit where line_id=$1',[item.lineId])).rows[0];
  if(item.expected==='PENDING')assert.equal(audit,undefined,'Pending quote must not create a settlement audit or wallet credit');
  else{
   assert.equal(audit.status,item.expected,'Audited financial decision: '+item.name);
   assert.match(String(audit.source).toUpperCase(),/(?:^|\\+)(?:ADMIN|ZIZOBET)(?:\\+|$)/,'Settlement audit source retains explicit primary authority');
  }
 }
 const wins=cases.filter(item=>item.expected==='WON').length;
 const losses=cases.filter(item=>item.expected==='LOST').length;
 const expectedBalance=1000-cases.length*10+wins*20;
 const balance=Number((await run('select balance from app_user where id=$1',[userId])).rows[0].balance);
 assert.equal(balance,expectedBalance,'Only proven WON tickets credit their payout; LOST/PENDING never do');
 assert.equal((await run("select count(*)::int as n from app_transaction where user_id=$1 and type='BET_WON'",[userId])).rows[0].n,wins);
 assert.equal((await run('select count(*)::int as n from app_settlement_audit')).rows[0].n,expectedResolved);

 const retry=await settleMatch(matchId);
 assert.equal(retry.settled,0,'Retry does not settle or pay any ticket twice');
 assert.equal(Number((await run('select balance from app_user where id=$1',[userId])).rows[0].balance),expectedBalance);
 assert.equal((await run("select count(*)::int as n from app_transaction where user_id=$1 and type='BET_WON'",[userId])).rows[0].n,wins);
 console.log('PASS '+expectedResolved+' actual Zizobet quote-to-contract-to-ticket settlement cases across goals, corners, cards, intervals, halves, combos, mixed and other markets; unknown contract stayed PENDING and payouts were idempotent');
}finally{
 pool.query=original.query;pool.connect=original.connect;
 await db.close();
}
