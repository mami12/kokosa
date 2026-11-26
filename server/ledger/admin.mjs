/**
 * Admin and manager panels.
 *
 * Same endpoints the UI already calls, with the original behaviour: admins see everything,
 * a manager only ever sees the players they own. Match control is implemented as overrides
 * (see overrides.mjs) because the feed would otherwise overwrite any edit on the next frame.
 */
import express from 'express';
import crypto from 'node:crypto';
import { requireAuth, hashPassword } from './auth.mjs';
import {assertAccountPassword} from './account-password-policy.mjs';
import * as ledger from './store.mjs';
import * as bets from './bets.mjs';
import * as overrides from './overrides.mjs';
import { settleMatch, settleAll, manualSettleLine } from './settler.mjs';
import { recentResults, storeResult, pendingSettlementReview } from './results.mjs';
import { query } from '../db.mjs';
import { getMatches as getMatchRows, getMatchById as getMatchRow, boostMatch } from '../matches.mjs';
import { withOdds, serializeMatch } from '../collector.mjs';
import { toClientMatch, toClientMatches } from './view.mjs';
import { marketCategories, marketFamily, MARKET_CATEGORY_IDS } from '../market-catalog.mjs';
import {isSyntheticFootballMatch} from '../football-competitions.mjs';
import {isSettlementCheckFixture,tiraneDateKey} from '../fixture-dates.mjs';
import {isDecidedLiveMarket, isDecidedLiveOutcome, isDecidedLiveNumberedGoalWindow, isZizobetNativeOffer} from './decided-markets.mjs';
import {isExcludedOfferMarket, isRetiredPlayerOfferMarket, isHandicapOfferMarket} from '../market-policy.mjs';
import {isCurrentSettlementCheckQuote} from './settlement-check.mjs';

export const adminRouter = express.Router();

const guard = (fn) => (req, res, next) => {
  const sendJson = res.json.bind(res);
  return Promise.resolve().then(async () => {
    let queued = false;
    let body;
    res.json = (value) => {
      queued = true;
      body = value;
      return res;
    };
    await fn(req, res, next);
    if (!queued) return;

    const mutatingRequest = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ||
      (req.method === 'GET' && req.path === '/admin/settlement');
    if (res.statusCode < 400 && mutatingRequest &&
        ['ADMIN', 'MANAGER'].includes(req.user?.role)) {
      try {
        const target = req.path.match(/\/(users|matches|markets|outcomes|tickets|lines)\/([^/]+)/);
        const safeKeys = ['username', 'role', 'managerId', 'initialBalance', 'amount', 'status', 'isSuspended', 'odds', 'price', 'homeScore', 'awayScore', 'country', 'competitionId', 'category', 'suspended', 'hidden', 'countrySlug', 'tournamentId', 'reason'];
        const input = Object.fromEntries(
          safeKeys.filter((key) => req.body?.[key] !== undefined).map((key) => [key, req.body[key]]),
        );
        const targetId = target?.[2] ?? body?.id ?? null;
        const targetType = target
          ? ({ users: 'user', matches: 'match', markets: 'market', outcomes: 'outcome', tickets: 'ticket', lines: 'ticket_line' })[target[1]]
          : req.path.includes('commission') ? 'settings' : 'system';
        await query(
          `insert into app_admin_audit
             (actor_id, actor_name, actor_role, action, target_type, target_id, details)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            req.user.id,
            req.user.username,
            req.user.role,
            `${req.method} ${req.path}`,
            targetType,
            targetId ? String(targetId) : null,
            JSON.stringify({ input }),
          ],
        );
      } catch (error) {
        console.error('[admin audit] failed to persist action', req.method, req.path, '-', error?.message);
        res.status(500);
        return sendJson({
          message: 'Veprimi u krye, por regjistri i auditimit nuk u ruajt. Kontakto administratorin.',
          error: 'audit log write failed',
        });
      }
    }
    return sendJson(body);
  }).catch((e) => {
    const status = Number(e?.status) >= 400 && Number(e?.status) < 600 ? Number(e.status) : 500;
    if (status >= 500) console.error('[app api]', req.method, req.originalUrl, '-', e?.message);
    res.json = sendJson;
    res.status(status);
    sendJson({ message: e?.message ?? 'error', error: e?.message ?? 'error' });
  });
};

const requireLedger = (req, res, next) =>
  ledger.isLedgerReady() ? next() : res.status(503).json({ message: 'ledger database unavailable' });

const deny = (res, what) => res.status(403).json({ message: `${what} only` });
const normalizedCompetitionPart = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

/** admin-only routes */
const admin = [
  requireLedger,
  requireAuth,
  (req, res, next) => (req.user?.role === 'ADMIN' ? next() : deny(res, 'admin')),
];
/** manager-only routes */
const manager = [
  requireLedger,
  requireAuth,
  (req, res, next) => (req.user?.role === 'MANAGER' ? next() : deny(res, 'manager')),
];
/** both, each scoped to what they may touch */
const staff = [
  requireLedger,
  requireAuth,
  (req, res, next) => (req.user?.role === 'ADMIN' || req.user?.role === 'MANAGER' ? next() : deny(res, 'staff')),
];

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const asAmount = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw badRequest('amount must be a positive number');
  const amount = Number(n.toFixed(2));
  if (amount <= 0) throw badRequest('amount must be at least 0.01');
  return amount;
};

const automatedCheckStake = 100;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const checkRequestId = (runId, outcomeId) => {
  const hex = crypto.createHash('sha256').update(`${runId}:${outcomeId}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

async function settlementCheckSelections(matchIds, refresh) {
  if (!Array.isArray(matchIds) || matchIds.length !== 2) throw badRequest('Zgjidh saktësisht dy ndeshje.');
  const ids = matchIds.map(value => Number(value));
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== 2) throw badRequest('Dy ndeshjet duhet të jenë të ndryshme.');
  const matches = [];
  for (const id of ids) {
    const row = await getMatchRow(id);
    if (!row || isSyntheticFootballMatch(row) || overrides.isMatchHidden(row)) throw badRequest('Një nga ndeshjet nuk është e disponueshme për këtë kontroll.');
    await refresh?.(id);
    const latest = await getMatchRow(id);
    const current = latest ?? row;
    const [quoted] = await withOdds([current], Date.now(), { board: false });
    const match = toClientMatch(quoted);
    if (!['LIVE', 'PREMATCH'].includes(match.status) || match.isSuspended || match.isHidden) throw badRequest('Zgjidh vetëm ndeshje aktive live ose para fillimit.');
    const isLiveMatch = match.status === 'LIVE' || current.service === 'LIVE' || current.live === true;
    if(!isSettlementCheckFixture({...current,status:isLiveMatch?'LIVE':match.status},new Date()))
      throw badRequest('Kontrolli pranon vetëm ndeshjet e sotme ose ndeshjet që janë aktualisht live.');
    const currentMin = isLiveMatch ? Number(current.currentMinute ?? current.minute ?? current.live_minute ?? (current.match_time_ms ? Math.floor(current.match_time_ms / 60000) : null)) : null;
    const homeScore = Number(current.home_score ?? current.homeScore ?? current.score?.home ?? 0);
    const awayScore = Number(current.away_score ?? current.awayScore ?? current.score?.away ?? 0);
    const totalGoals = homeScore + awayScore;
    const phase = String(current.period ?? current.phase ?? current.feed_status ?? '').toLowerCase();
    const inSecondHalfOrHT = /^(?:2h|ht|ft|2nd half|second half|break time|half time|halftime|ended|finished)\b/.test(phase);

    const seen = new Set(), selections = [], selectedMarkets = new Set(), quoteNow = Date.now();
    for (const market of match.markets ?? []) {
      if (market.status !== 'ACTIVE') continue;
      // Exclude markets we do NOT want (cards, fouls, shots on target, saves, tackles, throw-ins, offsides, player props, Asian handicap)
      if (isExcludedOfferMarket(market) || isRetiredPlayerOfferMarket(market) || isHandicapOfferMarket(market)) continue;
      const nativeZizobet = isZizobetNativeOffer(market, current);
      // A numbered-goal interval becomes unbettable as soon as that goal
      // ordinal has already happened, even if Zizobet still exposes the quote.
      // Also exclude a no-goal result only after the whole quoted interval ends.
      if (isLiveMatch && isDecidedLiveNumberedGoalWindow(current, market)) continue;
      // Zizobet is authoritative for its currently offered native contracts.
      // Local score/clock heuristics are fallback rules for non-native feeds only.
      if (isLiveMatch && !nativeZizobet) {
        if (isDecidedLiveMarket(current, market)) continue;
        // 1st half markets cannot be bet on in 2nd half or HT
        if (inSecondHalfOrHT && (Number(market.period ?? 0) === 1 || /\b(?:1st|first)\s*half\b|\bhalf.?time\b(?!\s*\/?\s*(?:fulltime|ft))/i.test(String(market.name ?? '')))) continue;
        // First goal markets cannot be bet on once a goal was scored
        const isFirstGoalTiming = /^(?:when will (?:the )?(?:first goal|goal 1) be scored|(?:first|1st) goal (?:time|interval)|time of (?:the )?first goal)(?:\b|$)/i.test(String(market.name ?? ''));
        if (isFirstGoalTiming && totalGoals >= 1) continue;
      }
      for (const outcome of market.outcomes ?? []) {
        if (!isCurrentSettlementCheckQuote(market, outcome, quoteNow) || seen.has(outcome.id)) continue;
        if (isLiveMatch && !nativeZizobet) {
          if (isDecidedLiveOutcome(current, { ...market, outcomeName: outcome.name, outcomeCode: outcome.key, outcome_name: outcome.name, outcome_key: outcome.key })) continue;
          // Check elapsed minute intervals: e.g. at min 20, outcome "1-10" or "1-15" is expired
          if (currentMin !== null && Number.isFinite(currentMin)) {
            const cleanLabel = String(outcome.name ?? '').replace(/\s*(?:st|nd|rd|th)?\s*(?:match|mins?\.?|minutes?\.?)?$/i, '').trim();
            const range = cleanLabel.match(/^(?:min(?:ute)?s?\s*)?(\d{1,3})(?::\d{2})?\s*[-–]\s*(\d{1,3})(?::\d{2})?/);
            if (range && Number(range[2]) <= currentMin) continue;
          }
        }
        seen.add(outcome.id);
        selectedMarkets.add(String(market.id ?? market.extId ?? market.key ?? market.name) + '|' + String(market.line ?? market.specifier ?? ''));
        selections.push({ outcomeId: outcome.id, oddsAtPlacement: Number(outcome.odds) });
      }
    }
    matches.push({id:match.id,name:`${match.homeTeam?.name ?? match.homeTeam ?? ''} vs ${match.awayTeam?.name ?? match.awayTeam ?? ''}`.trim(),status:match.status,marketCount:selectedMarkets.size,selections});
  }
  return matches;
}


const settlementCheckCategories = [
  { id: 'goals', name: 'Golat' },
  { id: 'corners', name: 'Kornerat' },
  { id: 'totals', name: 'Totale' },
  { id: 'intervals', name: 'Intervale' },
  { id: 'results', name: 'Rezultate' },
  { id: 'combos', name: 'Kombinime' },
  { id: 'other', name: 'Të tjera' },
];

async function settlementCheckMarketGroups({ category = null, family = null } = {}) {
  const now = new Date();
  const nowMs = now.getTime();
  const rows = (await getMatchRows({ catalog: true })).filter(row => {
    const service = String(row.service ?? '').toUpperCase();
    return ['LIVE', 'PREMATCH'].includes(service) &&
      isSettlementCheckFixture(row, now) &&
      !isSyntheticFootballMatch(row) && !overrides.isMatchHidden(row) &&
      !/^(?:ended|finished|cancelled|closed|uncovered)$/i.test(String(row.status ?? '')) &&
      !/^(?:ft|finished|ended|full.?time)$/i.test(String(row.feed_status ?? ''));
  });
  const serialized = await withOdds(rows, nowMs, { board: false });
  const grouped = new Map();

  for (const source of serialized) {
    const match = toClientMatch(source);
    const isLiveMatch = match.status === 'LIVE' || String(source.service ?? '').toUpperCase() === 'LIVE' || source.live === true;
    if (!['LIVE', 'PREMATCH'].includes(match.status) || match.isSuspended || match.isHidden) continue;
    const currentMinute = isLiveMatch
      ? Number(source.currentMinute ?? source.minute ?? source.live_minute ??
        (source.match_time_ms ? Math.floor(source.match_time_ms / 60000) : null))
      : null;
    const homeScore = Number(source.home_score ?? source.homeScore ?? source.score?.home ?? 0);
    const awayScore = Number(source.away_score ?? source.awayScore ?? source.score?.away ?? 0);
    const totalGoals = homeScore + awayScore;
    const phase = String(source.period ?? source.phase ?? source.feed_status ?? '').toLowerCase();
    const inSecondHalfOrHT = /^(?:2h|ht|ft|2nd half|second half|break time|half time|halftime|ended|finished)\b/.test(phase);
    const byFamily = new Map();
    const seen = new Set();

    for (const market of match.markets ?? []) {
      if (market.status !== 'ACTIVE' || isExcludedOfferMarket(market) ||
          isRetiredPlayerOfferMarket(market) || isHandicapOfferMarket(market)) continue;
      const identity = marketFamily(market);
      if (!identity || (family && identity.key !== family)) continue;
      const categories = marketCategories(identity.name).filter(id =>
        settlementCheckCategories.some(item => item.id === id));
      if (!categories.length || (category && !categories.includes(category))) continue;

      const nativeZizobet = isZizobetNativeOffer(market, source);
      if (isLiveMatch && isDecidedLiveNumberedGoalWindow(source, market)) continue;
      if (isLiveMatch && !nativeZizobet) {
        if (isDecidedLiveMarket(source, market)) continue;
        if (inSecondHalfOrHT && (Number(market.period ?? 0) === 1 ||
          /\b(?:1st|first)\s*half\b|\bhalf.?time\b(?!\s*\/?\s*(?:fulltime|ft))/i.test(String(market.name ?? '')))) continue;
        const firstGoalTime = /^(?:when will (?:the )?(?:first goal|goal 1) be scored|(?:first|1st) goal (?:time|interval)|time of (?:the )?first goal)(?:\b|$)/i.test(String(market.name ?? ''));
        if (firstGoalTime && totalGoals >= 1) continue;
      }

      const options = [];
      for (const outcome of market.outcomes ?? []) {
        if (seen.has(outcome.id) || !isCurrentSettlementCheckQuote(market, outcome, nowMs)) continue;
        if (isLiveMatch && !nativeZizobet) {
          if (isDecidedLiveOutcome(source, { ...market, outcomeName: outcome.name, outcomeCode: outcome.key,
            outcome_name: outcome.name, outcome_key: outcome.key })) continue;
          if (currentMinute !== null && Number.isFinite(currentMinute)) {
            const label = String(outcome.name ?? '').replace(/\s*(?:st|nd|rd|th)?\s*(?:match|mins?\.?|minutes?\.?)$/i, '').trim();
            const range = label.match(/^(?:min(?:ute)?s?\s*)?(\d{1,3})(?::\d{2})?\s*[-–]\s*(\d{1,3})(?::\d{2})?/);
            if (range && Number(range[2]) <= currentMinute) continue;
          }
        }
        seen.add(outcome.id);
        options.push({
          outcomeId: outcome.id, name: outcome.name, code: outcome.key ?? outcome.code ?? null,
          odds: Number(outcome.odds), marketName: market.name,
          line: String(market.line ?? market.specifier ?? ''),
          selection: { outcomeId: outcome.id, oddsAtPlacement: Number(outcome.odds) },
        });
      }
      if (!options.length) continue;
      if (!byFamily.has(identity.key)) {
        byFamily.set(identity.key, { key: identity.key, name: identity.name, categories, markets: [] });
      }
      byFamily.get(identity.key).markets.push({
        name: market.name, line: String(market.line ?? market.specifier ?? ''), options,
      });
    }

    for (const item of byFamily.values()) {
      const activeOptions = item.markets.reduce((sum, market) => sum + market.options.length, 0);
      const matchName = String(match.homeTeam?.name ?? match.homeTeam ?? '') + ' vs ' +
        String(match.awayTeam?.name ?? match.awayTeam ?? '');
      const candidate = {
        match: {
          id: String(match.id), name: matchName.trim(),
          home: String(match.homeTeam?.name ?? match.homeTeam ?? ''),
          away: String(match.awayTeam?.name ?? match.awayTeam ?? ''),
          status: isLiveMatch ? 'LIVE' : 'PREMATCH',
          startTime: source.startAt ?? source.start_at ?? null,
          league: match.tournament?.name ?? source.tournament?.name ?? '',
        },
        markets: item.markets, activeOptions, live: isLiveMatch,
      };
      const existing = grouped.get(item.key);
      if (!existing) {
        grouped.set(item.key, {
          key: item.key, name: item.name, categories: item.categories,
          matchesAvailable: 1, candidate,
        });
      } else {
        existing.matchesAvailable += 1;
        const oldRank = Number(existing.candidate.live) * 100000 + existing.candidate.activeOptions;
        const newRank = Number(candidate.live) * 100000 + candidate.activeOptions;
        if (newRank > oldRank) existing.candidate = candidate;
      }
    }
  }

  const result = [...grouped.values()].map(item => ({
    key: item.key, name: item.name, categories: item.categories,
    matchesAvailable: item.matchesAvailable,
    activeOptions: item.candidate.activeOptions,
    match: item.candidate.match,
    markets: item.candidate.markets,
  }));
  result.sort((a, b) => a.name.localeCompare(b.name));
  return { date: tiraneDateKey(now), groups: result };
}

const commissionRate = (value, label) => {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw badRequest(`${label} must be between 0 and 100`);
  }
  return Number(rate.toFixed(2));
};

adminRouter.get(
  '/admin/commission-rates',
  ...admin,
  guard(async (_req, res) => {
    const result = await query(
      'select single_pct as single, double_pct as double, multi_pct as multi, casino_pct as casino from app_commission_config where id = 1',
    );
    const row = result.rows[0] ?? { single: 3, double: 5, multi: 7, casino: 0 };
    res.json({ single: Number(row.single), double: Number(row.double), multi: Number(row.multi), casino: Number(row.casino ?? 0) });
  }),
);

adminRouter.patch(
  '/admin/commission-rates',
  ...admin,
  guard(async (req, res) => {
    const { single, double, multi, casino } = req.body ?? {};
    const rates = {
      single: commissionRate(single, 'single'),
      double: commissionRate(double, 'double'),
      multi: commissionRate(multi, 'multi'),
      casino: casino === undefined ? null : commissionRate(casino, 'casino'),
    };
    const result = await query(
      `update app_commission_config
          set single_pct = $1, double_pct = $2, multi_pct = $3, casino_pct = coalesce($5, casino_pct),
              updated_by = $4, updated_at = now()
        where id = 1
        returning single_pct as single, double_pct as double, multi_pct as multi, casino_pct as casino`,
      [rates.single, rates.double, rates.multi, req.user.id, rates.casino],
    );
    res.json(Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)])));
  }),
);

adminRouter.get(
  '/admin/audit-log',
  ...admin,
  guard(async (req, res) => res.json(await ledger.listAdminAudit({
    from: req.query.from,
    to: req.query.to,
    actorId: req.query.actorId,
    limit: req.query.limit,
  }))),
);

adminRouter.get(
  '/admin/transactions',
  ...admin,
  guard(async (req, res) => res.json(await ledger.listTransactions({
    role: 'ADMIN',
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  }))),
);

adminRouter.get(
  '/manager/transactions',
  ...manager,
  guard(async (req, res) => res.json(await ledger.listTransactions({
    role: 'MANAGER',
    userId: req.user.id,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  }))),
);

/** a manager may only touch the players they own */
async function assertOwned(req, userId) {
  const target = await ledger.getUserById(userId);
  if (!target) throw Object.assign(new Error('user not found'), { status: 404 });
  if (req.user.role === 'MANAGER' && target.managerId !== req.user.id) {
    throw Object.assign(new Error('this user belongs to another manager'), { status: 403 });
  }
  return target;
}

/* ------------------------------------------------------------------- stats */

/** dashboard numbers in the shape the admin screen expects */
adminRouter.get(
  '/admin/stats',
  ...admin,
  guard(async (_req, res) => {
    const base = await ledger.ledgerStats(null);
    const money = await query(
      `select
         coalesce(sum(stake) filter (where status = 'PENDING'), 0)          as open_stake,
         coalesce(sum(stake) filter (where status in ('WON','LOST')), 0)    as settled_stake,
         coalesce((select sum(amount) from app_transaction where type='BET_WON'), 0) as paid_out
       from app_ticket`,
    );
    const row = money.rows[0] ?? {};
    const managers = await ledger.managerFinancials();
    const commissionTotal = managers.reduce((sum, item) => sum + item.sportCommission, 0);
    const casinoCommission = managers.reduce((sum, item) => sum + item.casinoCommission, 0);
    res.json({
      users: base.users,
      activeBets: base.pendingTickets,
      totalStake: Number(row.open_stake ?? 0),
      revenue: Number(Number(row.settled_stake ?? 0) - Number(row.paid_out ?? 0) - commissionTotal),
      commission: commissionTotal,
      sportCommission: commissionTotal,
      casinoCommission,
      blocked: base.blocked,
      tickets: base.tickets,
      totalBalance: base.totalBalance,
      managers,
    });
  }),
);

/** the same view for a manager, scoped to the players they own */
adminRouter.get(
  '/manager/stats',
  ...manager,
  guard(async (req, res) => {
    const base = await ledger.ledgerStats(req.user.id);
    const financials = await ledger.managerFinancials(req.user.id);
    res.json({
      users: base.users,
      activeBets: base.pendingTickets,
      totalStake: base.pendingStake,
      revenue: financials.manager?.netDifference ?? 0,
      balance: financials.manager?.balance ?? req.user.balance,
      tickets: base.tickets,
      blocked: base.blocked,
      financials,
    });
  }),
);

/* ------------------------------------------------------------------- users */

const publicUsers = (rows) => rows;

adminRouter.get(
  '/admin/users',
  ...admin,
  guard(async (_req, res) => res.json(publicUsers(await ledger.listUsers({})))),
);

adminRouter.get(
  '/manager/users',
  ...manager,
  guard(async (req, res) => res.json(publicUsers(await ledger.listUsers({ managerId: req.user.id })))),
);

/**
 * Creates a login. An admin picks the role (ADMIN / MANAGER / PLAYER) and, for players, who
 * owns them; a manager can only create their own players. Any starting balance is written as
 * a real DEPOSIT so the ledger stays consistent.
 */
const createUser = (resolveRole) =>
  guard(async (req, res) => {
    const { username, password, initialBalance = 0, managerId = null } = req.body ?? {};
    if (!username || !password) throw badRequest('username and password are required');


    const name = String(username).trim();
    if (await ledger.findUserByUsername(name)) throw badRequest('this username is already taken');

    const role = resolveRole(req);
    assertAccountPassword(password,role,{staffMin:3});
    const owner = role !== 'PLAYER' ? null : req.user.role === 'MANAGER' ? req.user.id : managerId || null;

    const openingValue = Number(initialBalance);
    const opening = Number(openingValue.toFixed(2));
    if (!Number.isFinite(openingValue) || opening < 0 || (openingValue > 0 && opening === 0)) {
      throw badRequest('initial balance must be zero or at least 0.01');
    }
    const managedPlayer = role === 'PLAYER' && Boolean(owner);
    const user =
      req.user.role === 'MANAGER' || managedPlayer
        ? await ledger.createManagedPlayer({
            username: name,
            passwordHash: hashPassword(password),
            managerId: req.user.role === 'MANAGER' ? req.user.id : owner,
            initialBalance: opening,
          })
        : await ledger.createUser({ username: name, passwordHash: hashPassword(password), role, managerId: owner });

    if (req.user.role !== 'MANAGER' && !managedPlayer && opening > 0) {
      await ledger.moveMoney(user.id, opening, {
        type: 'DEPOSIT',
        description: 'Bilanci fillestar',
        allowNegative: true,
      });
    }

    res.json(await ledger.getUserById(user.id));
  });

adminRouter.post('/admin/users', ...admin, createUser((req) => {
  const role = String(req.body?.role ?? 'PLAYER').toUpperCase();
  return ['ADMIN', 'MANAGER', 'PLAYER'].includes(role) ? role : 'PLAYER';
}));
adminRouter.post('/manager/users', ...manager, createUser(() => 'PLAYER'));

/** edit username / password (admin), and the role (admin only) */
adminRouter.patch(
  '/admin/users/:id',
  ...admin,
  guard(async (req, res) => {
    const id = req.params.id;
    const { username, password, role } = req.body ?? {};

    if (username) {
      const taken = await ledger.findUserByUsername(String(username).trim());
      if (taken && taken.id !== id) throw badRequest('this username is already taken');
      await query('update app_user set username = $2, updated_at = now() where id = $1', [id, String(username).trim()]);
    }
    if (password) {
      const existing=await ledger.getUserById(id);
      if(!existing)throw badRequest('Përdoruesi nuk u gjet.');
      assertAccountPassword(password,role?String(role).toUpperCase():existing.role,{staffMin:3});
      await query('update app_user set password_hash = $2, updated_at = now() where id = $1', [id, hashPassword(password)]);
    }
    if (role) await ledger.updateUser(id, { role: String(role).toUpperCase() });

    res.json(await ledger.getUserById(id));
  }),
);

adminRouter.patch(
  '/manager/users/:id',
  ...manager,
  guard(async (req, res) => {
    const id = req.params.id;
    await assertOwned(req, id);
    const { username, password } = req.body ?? {};

    if (username) {
      const taken = await ledger.findUserByUsername(String(username).trim());
      if (taken && taken.id !== id) throw badRequest('this username is already taken');
      await query('update app_user set username = $2, updated_at = now() where id = $1', [id, String(username).trim()]);
    }
    if (password) {
      assertAccountPassword(password,'PLAYER',{staffMin:3});
      await query('update app_user set password_hash = $2, updated_at = now() where id = $1', [id, hashPassword(password)]);
    }

    res.json(await ledger.getUserById(id));
  }),
);

/** freeze / ban / reactivate */
const setStatus = (checkOwnership) =>
  guard(async (req, res) => {
    const id = req.params.id;
    if (checkOwnership) await assertOwned(req, id);

    const status = String(req.body?.status ?? '').toUpperCase();
    if (!['ACTIVE', 'FROZEN', 'BANNED'].includes(status)) throw badRequest('status must be ACTIVE, FROZEN or BANNED');
    if (id === req.user.id) throw badRequest('you cannot change your own status');

    res.json(await ledger.updateUser(id, { status }));
  });

adminRouter.patch('/admin/users/:id/status', ...admin, setStatus(false));
adminRouter.patch('/manager/users/:id/status', ...manager, setStatus(true));

/** The transfer rechecks ownership under the money lock, including safe retries
 * after the login has already been removed from the active account list. */
const removeUser = (checkOwnership) =>
  guard(async (req, res) => {
    const id = req.params.id;
    if (id === req.user.id) throw badRequest('you cannot delete your own account');

    const deleted = await ledger.deleteUser(id, req.user);
    if (!deleted) throw Object.assign(new Error('user not found'), { status: 404 });
    res.json({ success: true, ...deleted });
  });

adminRouter.delete('/admin/users/:id', ...admin, removeUser(false));
adminRouter.delete('/manager/users/:id', ...manager, removeUser(true));

/* ------------------------------------------------------------------- money */

/** deposit / withdraw, recorded in the ledger with the resulting balance */
const moveBalance = (sign, type, checkOwnership) =>
  guard(async (req, res) => {
    const id = req.params.id;
    if (checkOwnership) await assertOwned(req, id);

    const amount = asAmount(req.body?.amount);
    if (req.user.role === 'MANAGER') {
      const transfer = await ledger.moveManagerFunds(req.user.id, id, amount, sign > 0 ? 'deposit' : 'withdraw');
      return res.json({ ...transfer.user, manager: transfer.manager, transaction: transfer.playerTransaction });
    }
    const { user, transaction } = await ledger.moveMoney(id, sign * amount, {
      type,
      description: type === 'DEPOSIT' ? 'Depozitim nga paneli' : 'Tërheqje nga paneli',
    });
    res.json({ ...user, transaction });
  });

adminRouter.post('/admin/users/:id/deposit', ...admin, moveBalance(1, 'DEPOSIT', false));
adminRouter.post('/admin/users/:id/withdraw', ...admin, moveBalance(-1, 'WITHDRAWAL', false));
adminRouter.post('/manager/users/:id/deposit', ...manager, moveBalance(1, 'DEPOSIT', true));
adminRouter.post('/manager/users/:id/withdraw', ...manager, moveBalance(-1, 'WITHDRAWAL', true));

/* ------------------------------------------------ settlement check tickets */
adminRouter.get('/admin/settlement-check/catalog', ...admin, guard(async (req, res) => {
  const category = String(req.query.category ?? '').trim() || null;
  if (category && !settlementCheckCategories.some(item => item.id === category)) {
    throw badRequest('Kategoria e marketit nuk është e vlefshme.');
  }
  const catalog = await settlementCheckMarketGroups({ category });
  res.set('Cache-Control', 'no-store').json({
    date: catalog.date, categories: settlementCheckCategories,
    groups: catalog.groups.map(({ markets, ...group }) => group),
  });
}));
adminRouter.get('/admin/settlement-check/market', ...admin, guard(async (req, res) => {
  const family = String(req.query.family ?? '').trim();
  if (!family) throw badRequest('Zgjidh një market.');
  const catalog = await settlementCheckMarketGroups({ family });
  const group = catalog.groups.find(item => item.key === family);
  if (!group) return res.status(404).json({ message: 'Ky market nuk ka kuota aktive në ndeshjet e sotme.' });
  res.set('Cache-Control', 'no-store').json(group);
}));
adminRouter.post('/admin/settlement-check/place', ...admin, guard(async (req, res) => {
  const { playerId, family, runId } = req.body ?? {};
  if (!uuidPattern.test(String(runId ?? ''))) throw badRequest('Identifikuesi i kontrollit nuk është i vlefshëm. Rifresko dhe provo përsëri.');
  const player = await ledger.getUserById(playerId);
  if (!player || player.role !== 'PLAYER' || player.status !== 'ACTIVE') throw badRequest('Zgjidh një llogari lojtari aktive.');
  const selectedFamily = String(family ?? '').trim();
  if (!selectedFamily) throw badRequest('Zgjidh një market.');
  const catalog = await settlementCheckMarketGroups({ family: selectedFamily });
  const group = catalog.groups.find(item => item.key === selectedFamily);
  if (!group) throw badRequest('Ky market nuk ka më kuota aktive në ndeshjet e sotme.');
  const selections = group.markets.flatMap(market => market.options.map(option => ({
    ...option.selection,
    clientRequestId: checkRequestId(String(runId).toLowerCase(), option.outcomeId),
  })));
  const result = await bets.placeSettlementTestTickets({
    user: player, selections, family: selectedFamily, runId: String(runId).toLowerCase(),
  });
  res.json({
    test: true, player: player.username, family: selectedFamily, date: catalog.date,
    match: group.match, ticketCount: result.placed.length,
    stakePerTicket: result.stakePerTicket, placed: result.placed,
  });
}));
adminRouter.get('/admin/settlement-check/tickets', ...admin, guard(async (req, res) => {
  const playerId = String(req.query.playerId ?? '').trim() || null;
  const tickets = await bets.listLogicalTickets({
    userId: playerId, statuses: null, onlySettlementTests: true,
    limit: Math.min(500, Math.max(1, Number(req.query.limit) || 100)),
  });
  res.json(tickets);
}));

/* ----------------------------------------------------------------- tickets */

const listTickets = (scoped) =>
  guard(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 10000);
    res.json(await bets.listLogicalTickets({managerId:scoped?req.user.id:null,limit}));
  });

adminRouter.get('/admin/tickets', ...admin, listTickets(false));
adminRouter.get('/manager/tickets', ...manager, listTickets(true));

/**
 * Revert a ticket: refund the stake, void the lines and close it as REVERTED - the original
 * admin behaviour. Only open tickets can be reverted.
 */
const revertTicket = (scoped) =>
  guard(async (req, res) => {
    const id = req.params.id;
    const result = await bets.revertTicket(id, scoped ? req.user.id : null);
    res.json({ ...result, ticket: await bets.getTicketWithLines(id) });
  });

adminRouter.post('/admin/tickets/:id/revert', ...admin, revertTicket(false));
adminRouter.post('/manager/tickets/:id/revert', ...manager, revertTicket(true));

/* --------------------------------------------------- match control (overrides) */

const matchList = guard(async (req, res) => {
  const rows = await getMatchRows({
    service: req.query.status === 'LIVE' ? 'LIVE' : null,
    q: req.query.q ? String(req.query.q) : null,
    limit: Math.min(Number(req.query.limit) || 200, 2000),
    includeEnded: true,
  });
  const realRows = rows.filter(row => !isSyntheticFootballMatch(row));
  // The administration list needs fixture metadata, not every price in every
  // fixture. Keep the original full response unless the client opts in.
  if (req.query.summary === 'true') {
    const now = Date.now();
    const items = realRows.map((row) => ({
      ...toClientMatch(serializeMatch(row, [], now)),
      // Unknown until the selected detail loads; zero would imply no markets.
      marketCount: null,
    }));
    return res.json({ items, overrides: await overrides.list(), summary: true });
  }
  const withPrices = await withOdds(realRows);
  res.json({ items: toClientMatches(withPrices), overrides: await overrides.list() });
});

adminRouter.get('/admin/matches', ...admin, matchList);
adminRouter.get('/manager/matches', ...manager, matchList);
adminRouter.get('/admin/competition-visibility', ...admin, guard(async (_req,res) => {
  res.set('Cache-Control','no-store').json({items:await overrides.listCompetitionVisibility()});
}));
adminRouter.post('/admin/competition-visibility', ...admin, guard(async (req,res) => {
  res.json(await overrides.setCompetitionHidden(req.body?.countrySlug,req.body?.tournamentId,req.body?.hidden));
}));

const matchDetail = guard(async (req, res) => {
  const matchId = Number(req.params.id);
  if (!Number.isSafeInteger(matchId) || matchId <= 0) {
    return res.status(404).json({ message: 'match not found' });
  }
  let row = await getMatchRow(matchId);
  if (!row) return res.status(404).json({ message: 'match not found' });
  // Like the public detail view, ask the feed for this fixture's full markets.
  boostMatch(row.match_id);
  await req.app.locals.loadMatchDetailFully?.(row.match_id);
  row = await getMatchRow(matchId) ?? row;
  const [serialized] = await withOdds([row],Date.now(),{displayStats:true});
  const id = String(row.match_id);
  const relevantOverrides = (await overrides.list()).filter((entry) =>
    entry.kind === 'match' ? entry.ref === id : entry.ref.startsWith(`${id}|`));
  return res.json({ item: {...toClientMatch(serialized),fullMarketsReady:req.app.locals.matchMarketsReady?.(matchId)??true}, overrides: relevantOverrides });
});

adminRouter.get('/admin/matches/:id', ...admin, matchDetail);
adminRouter.get('/manager/matches/:id', ...manager, matchDetail);

adminRouter.post('/admin/markets/bulk-suspend', ...admin, guard(async (req, res) => {
  const country = String(req.body?.country ?? '').trim();
  const competitionId = String(req.body?.competitionId ?? '').trim();
  const category = String(req.body?.category ?? '').trim();
  const suspended = req.body?.suspended;
  if (!country || !competitionId || !category || typeof suspended !== 'boolean') {
    throw badRequest('Zgjidh shtetin, kampionatin, kategorinë dhe veprimin.');
  }
  if (category !== 'all' && !MARKET_CATEGORY_IDS.includes(category)) {
    throw badRequest('Kategori tregu e pavlefshme.');
  }

  const countryKey = normalizedCompetitionPart(country);
  const rows = (await getMatchRows({ limit: 2000 })).filter(row =>
    normalizedCompetitionPart(row.category_name) === countryKey &&
    String(row.tournament_id ?? row.tournament_name ?? '') === competitionId,
  );
  if (!rows.length) return res.json({ success: true, count: 0, suspended });

  const refs = [];
  for (const match of await withOdds(rows)) {
    for (const market of match.markets ?? []) {
      if (category !== 'all' && !marketCategories(market.name).includes(category)) continue;
      refs.push(`${match.id}|${market.key}|${market.line ?? ''}`);
    }
  }
  const count = await overrides.suspendMarkets(refs, suspended);
  res.json({ success: true, count, suspended });
}));

/** the toggle the UI sends is `isSuspended`; a market/outcome sends `status` */
const wantsSuspend = (body = {}) =>
  body.isSuspended !== undefined ? body.isSuspended === true : String(body.status ?? '').toUpperCase() === 'SUSPENDED';

adminRouter.patch(
  '/admin/matches/:id/suspend',
  ...admin,
  guard(async (req, res) => {
    const suspended = wantsSuspend(req.body);
    const list = await overrides.upsert('match', String(req.params.id), { suspended });
    res.json({ success: true, suspended, overrides: list });
  }),
);

/** marketId from the UI is `matchId|marketKey|line` */
adminRouter.patch(
  '/admin/markets/:id/suspend',
  ...admin,
  guard(async (req, res) => {
    const suspended = wantsSuspend(req.body);
    res.json({ success: true, suspended, overrides: await overrides.upsert('market', req.params.id, { suspended }) });
  }),
);

/**
 * Pin a price. The feed keeps sending its own price, so the override wins in the board view
 * and in bet validation until it is cleared - that is what makes the admin edit meaningful.
 */
adminRouter.patch(
  '/admin/outcomes/:id/odds',
  ...admin,
  guard(async (req, res) => {
    const price = Number(req.body?.odds ?? req.body?.price);
    if (!Number.isFinite(price) || price <= 1) throw badRequest('odds must be a number greater than 1');
    res.json({ success: true, overrides: await overrides.upsert('outcome', req.params.id, { price: Number(price.toFixed(3)) }) });
  }),
);

/** also accepted, matching the original route names */
adminRouter.patch(
  '/admin/markets/:id/odds-adjust',
  ...admin,
  guard(async (req, res) => {
    const price = Number(req.body?.odds ?? req.body?.price);
    if (!Number.isFinite(price) || price <= 1) throw badRequest('odds must be a number greater than 1');
    res.json({ success: true, overrides: await overrides.upsert('outcome', req.params.id, { price: Number(price.toFixed(3)) }) });
  }),
);
adminRouter.patch(
  '/admin/outcomes/:id/suspend',
  ...admin,
  guard(async (req, res) => {
    const suspended = wantsSuspend(req.body);
    res.json({ success: true, suspended, overrides: await overrides.upsert('outcome', req.params.id, { suspended }) });
  }),
);

/** clear one override (or every override when no ref is given) */
adminRouter.delete(
  '/admin/overrides',
  ...admin,
  guard(async (req, res) => {
    const { kind, ref } = req.query;
    if (kind && ref) return res.json({ success: true, overrides: await overrides.clear(String(kind), String(ref)) });
    if (kind) {
      await query('delete from app_feed_override where kind = $1', [String(kind)]);
      await overrides.refresh(true);
      return res.json({ success: true, overrides: await overrides.list() });
    }
    await query('delete from app_feed_override');
    await overrides.refresh(true);
    return res.json({ success: true, overrides: await overrides.list() });
  }),
);

/** what the admin screen shows on its feed-status card */
adminRouter.get(
  '/admin/feed-status',
  ...staff,
  guard(async (_req, res) => {
    const { matchStats } = await import('../matches.mjs');
    res.json({
      matches: matchStats(),
      overrides: (await overrides.list()).length,
      lastPass: null,
    });
  }),
);

/* --------------------------------------------------------------- settlement */

/** Read-only queue of actual pending fixture IDs and missing final evidence. */
adminRouter.get(
  '/admin/settlement/pending',
  ...admin,
  guard(async (req, res) => {
    res.json({ pending: await pendingSettlementReview(req.query.limit) });
  }),
);

/** Decide one unresolved selection without changing unrelated lines.
 * This is an API-only addition; the existing admin UI is left untouched.
 */
adminRouter.patch('/admin/settlement/lines/:id', ...admin, guard(async (req,res) => {
  const id=String(req.params.id??'');
  if(!uuidPattern.test(id))throw badRequest('ID e përzgjedhjes nuk është i vlefshëm.');
  const status=String(req.body?.status??'').toUpperCase();
  if(!['WON','LOST','PENDING'].includes(status))
    throw badRequest('Statusi duhet të jetë WON, LOST ose PENDING.');
  const result=await manualSettleLine(id,status,{actorId:req.user.id,reason:req.body?.reason});
  res.json({ok:true,...result});
}));

/** stored results plus a settlement pass (safe: idempotent) */
const runSettlementHandler = guard(async (_req, res) => {
  const lastPass = await settleAll();
  res.json({ results: await recentResults(50), lastPass });
});
adminRouter.get('/admin/settlement', ...admin, runSettlementHandler);
adminRouter.post('/admin/settlement', ...admin, runSettlementHandler);

/** settle, or correct, a match by hand: stores the score, then recalculates every ticket */
adminRouter.post(
  '/admin/matches/:id/settle',
  ...admin,
  guard(async (req, res) => {
    const matchId = Number(req.params.id);
    const body = req.body ?? {};
    const homeScore = Number(body.homeScore ?? body.home_score ?? NaN);
    const awayScore = Number(body.awayScore ?? body.away_score ?? NaN);

    if (Number.isFinite(homeScore) && Number.isFinite(awayScore)) {
      await storeResult(matchId, homeScore, awayScore, { homeTeam: body.homeTeam, awayTeam: body.awayTeam });
    }

    res.json({ ...(await settleMatch(matchId)), ok: true });
  }),
);

adminRouter.patch('/admin/matches/:id/visibility',...admin,guard(async(req,res)=>res.json(await overrides.setMatchHidden(req.params.id,req.body?.hidden))));
