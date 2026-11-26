import './fixtures/isolated-casino-env.mjs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { LEDGER_SQL } from '../server/ledger/schema.mjs';
import { placeSettlementTestTickets, listLogicalTickets } from '../server/ledger/bets.mjs';
import { recalcTicket } from '../server/ledger/settler.mjs';

const db = new PGlite();
const run = (sql, params = []) => db.query(sql, params);
const database = {
  async connect() {
    return { query: run, release() {} };
  },
};
const uuid = value => '00000000-0000-4000-8000-' + String(value).padStart(12,'0');

try {
  await db.exec(LEDGER_SQL);
  const user = (await run(
    "insert into app_user(username,password_hash,balance) values('settlement-test-player','isolated',2500) returning id"
  )).rows[0];

  const selection = {
    outcomeId: 'test-corners-over-2-5',
    oddsAtPlacement: 2.15,
    clientRequestId: uuid(1),
  };
  const resolve = async () => ({
    matchId: 990001,
    marketKey: 'zz300@corners',
    line: '2.5',
    outcomeKey: 'over',
    outcomeName: 'Over 2.5',
    marketName: 'Total Corners',
    matchName: 'Home vs Away',
    price: 2.15,
    kickoffAt: '2026-11-26T18:00:00.000Z',
    nativeMarketId: '300',
    nativeOutcomeId: 'over',
    nativeMarketName: 'Total Corners',
    nativeOutcomeName: 'Over 2.5',
    nativeParameters: { line: '2.5' },
    nativeMarketOutcomes: null,
    sourceProviderId: '990001',
    homeTeamName: 'Home',
    awayTeamName: 'Away',
    offerObservedAt: new Date('2026-11-26T17:00:00.000Z').toISOString(),
    liveContract: null,
    settlementHold: null,
  });

  const result = await placeSettlementTestTickets({
    user: { id: user.id, role: 'PLAYER', status: 'ACTIVE' },
    selections: [selection],
    family: 'total corners',
    runId: uuid(10),
  }, { database, resolve });

  assert.equal(result.test, true);
  assert.equal(result.placed.length, 1);
  const ticketId = result.placed[0].id;

  const initial = (await run('select balance from app_user where id=$1', [user.id])).rows[0];
  assert.equal(Number(initial.balance), 2400, 'test ticket creation debits the player stake');
  const ledger = (await run('select count(*)::int as count from app_transaction where user_id=$1', [user.id])).rows[0];
  assert.equal(ledger.count, 1, 'test ticket creation writes the normal BET_PLACED wallet transaction');

  const saved = (await run(
    'select is_settlement_test, settlement_test_family, status from app_ticket where id=$1', [ticketId]
  )).rows[0];
  assert.equal(saved.is_settlement_test, true);
  assert.equal(saved.settlement_test_family, 'total corners');
  assert.equal(saved.status, 'PENDING');

  const repeated = await placeSettlementTestTickets({
    user: { id: user.id, role: 'PLAYER', status: 'ACTIVE' },
    selections: [selection],
    family: 'total corners',
    runId: uuid(10),
  }, { database, resolve });
  assert.equal(repeated.placed[0].id, ticketId);
  assert.equal(repeated.placed[0].reused, true);
  assert.equal((await run('select count(*)::int as count from app_ticket where is_settlement_test is true')).rows[0].count, 1);

  await run("update app_ticket_line set status='WON' where ticket_id=$1", [ticketId]);
  const closed = await recalcTicket(ticketId, { database });
  assert.equal(closed.status, 'WON');
  assert.equal(Number((await run('select balance from app_user where id=$1',[user.id])).rows[0].balance), 2615, 'winning test ticket credits the accepted 2.15 payout');
  assert.equal((await run('select count(*)::int as count from app_transaction where user_id=$1',[user.id])).rows[0].count, 2, 'wallet records both stake debit and win credit');

  const insertNormalTicket = async (matchId, acceptedContract = null) => {
    const ticket = (await run(
      "insert into app_ticket(user_id,stake,total_odds,potential_payout,status) values($1,100,2,200,'PENDING') returning id",
      [user.id]
    )).rows[0].id;
    await run(
      "insert into app_ticket_line(ticket_id,match_id,market_key,line,outcome_key,outcome_name,market_name,match_name,odds_at_placement,status,accepted_contract) " +
      "values($1,$2,'1x2','','1','Home','1X2','Home vs Away',2,'PENDING',$3::jsonb)",
      [ticket, matchId, acceptedContract == null ? null : JSON.stringify(acceptedContract)]
    );
    return ticket;
  };
  const sameDay = await insertNormalTicket(990002, { kickoffAt: '2026-11-26T22:30:00.000Z' });
  const nextDay = await insertNormalTicket(990003, { kickoffAt: '2026-11-27T00:30:00.000Z' });
  const snapshotDay = await insertNormalTicket(990004, null);
  await run(
    'insert into app_match_snapshot(match_id,snapshot) values($1,$2::jsonb)',
    [990004, JSON.stringify({ start_at: '2026-11-26T20:00:00.000Z' })]
  );

  const daily = await listLogicalTickets({
    userId: user.id, statuses: null, matchDate: '2026-11-26', limit: 100,
  }, { runQuery: run });
  const dailyIds = new Set(daily.map(ticket => ticket.id));
  assert.equal(dailyIds.has(sameDay), true, 'kickoff on the selected Tirane date is included');
  assert.equal(dailyIds.has(snapshotDay), true, 'legacy tickets can use persisted match snapshot kickoff time');
  assert.equal(dailyIds.has(nextDay), false, 'kickoff after Tirane midnight belongs to the next date');
  assert.equal(dailyIds.has(ticketId), false, 'test tickets stay out of player My Bets');

  const testOnly = await listLogicalTickets({
    userId: user.id, statuses: null, onlySettlementTests: true, limit: 100,
  }, { runQuery: run });
  assert.deepEqual(testOnly.map(ticket => ticket.id), [ticketId]);

  console.log('PASS settlement test tickets: wallet debit/credit, idempotent placement, real settlement, and Tirane match-date filtering');
} finally {
  await db.close();
}
