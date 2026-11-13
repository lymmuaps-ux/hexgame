import { DEV_DECK, GEO, Rng, generateBoard, shuffle } from './board';
import { M } from './msg';
import {
  Action, COSTS, FxEvent, GameState, GameStats, GOODS, GOODS_INFO, GoodsMap, TRACKS, TRACK_INFO, Track,
  emptyGoods, improveCost, isGood, winPoints, KNIGHTS_PER_LEVEL, Knight, PLAYER_COLORS, Player, ProductionItem, RESOURCES, RES_INFO, ResMap,
  Resource, emptyRes, totalRes,
} from './types';

// ------------------------------------------------------------------ setup

export function createGame(names: string[], rng: Rng = Math.random, mode: 'base' | 'guilds' = 'base'): GameState {
  const board = generateBoard(rng);
  const players: Player[] = names.map((name, i) => ({
    name, color: PLAYER_COLORS[i], hand: emptyRes(), dev: [], newDev: [], guards: 0,
    roadsLeft: 15, settlementsLeft: 5, citiesLeft: 4, connected: true,
    ...(mode === 'guilds' ? { goods: emptyGoods(), levels: { trade: 0, politics: 0, science: 0 } } : {}),
  }));
  const n = players.length;
  const forward = [...Array(n).keys()];
  const bank = emptyRes();
  RESOURCES.forEach((r) => (bank[r] = 19));
  return {
    mode,
    ...(mode === 'guilds' ? { metropolis: { trade: null, politics: null, science: null } } : {}),
    phase: 'setup', players, current: 0,
    setupOrder: [...forward, ...forward.slice().reverse()], setupIndex: 0,
    setupNeed: 'settlement', lastSetupVertex: null,
    stage: 'actions', afterRaider: 'actions', pendingDiscards: {}, stealFrom: [], roadworksLeft: 0,
    dice: null, hexes: board.hexes, ports: board.ports, raider: board.raider,
    buildings: {}, roads: {}, devDeck: shuffle(DEV_DECK(), rng), devPlayedThisTurn: false,
    longestRoad: { owner: null, length: 0 }, strongestGuard: { owner: null, size: 0 },
    trade: null, tradeSeq: 0, bank, log: [M('log.start')],
    winner: null, turnNumber: 0,
  };
}

// ---------------------------------------------------------------- queries

const has = (hand: ResMap, cost: Partial<ResMap>) => RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));
export const canAfford = (s: GameState, p: number, what: keyof typeof COSTS) => has(s.players[p].hand, COSTS[what]);

function vertexFree(s: GameState, v: number) {
  return !s.buildings[v] && !s.knights?.[v] && GEO.vertices[v].neighbors.every((n) => !s.buildings[n]);
}

/** can player `p` extend a road through vertex v (not blocked by an opponent building)? */
function vertexPassable(s: GameState, p: number, v: number) {
  const b = s.buildings[v];
  const k = s.knights?.[v];
  return (!b || b.owner === p) && (!k || k.owner === p);
}

export function validSettlementSpots(s: GameState, p: number): number[] {
  return GEO.vertices
    .filter((v) => {
      if (!vertexFree(s, v.id)) return false;
      if (s.phase === 'setup') return true;
      return v.edges.some((e) => s.roads[e] === p);
    })
    .map((v) => v.id);
}

export function validRoadSpots(s: GameState, p: number): number[] {
  return GEO.edges
    .filter((e) => {
      if (s.roads[e.id] !== undefined) return false;
      if (s.phase === 'setup') return e.a === s.lastSetupVertex || e.b === s.lastSetupVertex;
      return [e.a, e.b].some((v) => {
        if (s.buildings[v]?.owner === p) return true;
        if (!vertexPassable(s, p, v)) return false;
        return GEO.vertices[v].edges.some((oe) => oe !== e.id && s.roads[oe] === p);
      });
    })
    .map((e) => e.id);
}

export function validCitySpots(s: GameState, p: number): number[] {
  return Object.entries(s.buildings)
    .filter(([, b]) => b.owner === p && b.kind === 'settlement')
    .map(([v]) => Number(v));
}

export function validRaiderHexes(s: GameState): number[] {
  return s.hexes.filter((h) => h.id !== s.raider).map((h) => h.id);
}

export function tradeRates(s: GameState, p: number): ResMap {
  const rates = emptyRes();
  RESOURCES.forEach((r) => (rates[r] = 4));
  for (const port of s.ports) {
    const e = GEO.edges[port.edge];
    if (![e.a, e.b].some((v) => s.buildings[v]?.owner === p)) continue;
    if (port.type === 'any') RESOURCES.forEach((r) => (rates[r] = Math.min(rates[r], 3)));
    else rates[port.type] = 2;
  }
  return rates;
}

export function longestRoadFor(s: GameState, p: number): number {
  const mine = Object.keys(s.roads).map(Number).filter((e) => s.roads[e] === p);
  let best = 0;
  const used = new Set<number>();
  const walk = (v: number, len: number) => {
    best = Math.max(best, len);
    if (!vertexPassable(s, p, v) && len > 0) return;
    for (const e of GEO.vertices[v].edges) {
      if (s.roads[e] !== p || used.has(e)) continue;
      const edge = GEO.edges[e];
      used.add(e);
      walk(edge.a === v ? edge.b : edge.a, len + 1);
      used.delete(e);
    }
  };
  for (const e of mine) {
    const edge = GEO.edges[e];
    walk(edge.a, 0);
    walk(edge.b, 0);
  }
  return best;
}

/** public = excludes hidden Monument cards */
export function victoryPoints(s: GameState, p: number, includeHidden = true): number {
  let vp = 0;
  for (const b of Object.values(s.buildings)) if (b.owner === p) vp += (b.kind === 'city' ? 2 : 1) + (b.metro ? 2 : 0);
  if (s.longestRoad.owner === p) vp += 2;
  if (s.strongestGuard.owner === p) vp += 2;
  if (includeHidden) {
    const pl = s.players[p];
    vp += [...pl.dev, ...pl.newDev].filter((c) => c === 'monument').length;
  }
  return vp;
}

function stealCandidates(s: GameState, p: number): number[] {
  const set = new Set<number>();
  for (const v of GEO.hexVertices[s.raider]) {
    const b = s.buildings[v];
    if (b && b.owner !== p && totalRes(s.players[b.owner].hand) > 0) set.add(b.owner);
  }
  return [...set];
}

// ---------------------------------------------------------------- helpers

const fmtRes = (r: Partial<ResMap>) =>
  RESOURCES.filter((k) => (r[k] ?? 0) > 0).map((k) => `${r[k]} ${RES_INFO[k].icon}`).join(' ') || '—';

function pay(s: GameState, p: number, cost: Partial<ResMap>) {
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    s.players[p].hand[r] -= n;
    s.bank[r] += n;
  }
}

/** the recap statistics (created on demand, so games saved before this feature keep working) */
function stats(s: GameState): GameStats {
  return (s.stats ??= {
    rolls: Array(13).fill(0),
    vp: [],
    startedAt: Date.now(),
    players: s.players.map(() => ({
      produced: emptyRes(), blocked: 0, stolen: 0, robbed: 0, discarded: 0, trades: 0, bankTrades: 0,
      bought: 0, knights: 0, roads: 0, settlements: 0, cities: 0,
    })),
  });
}

// ------------------------------------------------------------ Guildlands helpers

const fmtGoods = (g: Partial<GoodsMap>) =>
  GOODS.filter((k) => (g[k] ?? 0) > 0).map((k) => `${g[k]} ${GOODS_INFO[k].icon}`).join(' ') || '—';
const cardIcon = (c: string) => (isGood(c) ? GOODS_INFO[c].icon : RES_INFO[c as Resource].icon);

/** resources + goods in a player's hand */
export function handSize(pl: Player) {
  return totalRes(pl.hand) + (pl.goods ? GOODS.reduce((t, k) => t + pl.goods![k], 0) : 0);
}

/** cards a player may hold when a 7 is rolled (each city wall adds 2) */
export function handLimit(s: GameState, p: number) {
  const walls = Object.values(s.buildings).filter((b) => b.owner === p && b.wall).length;
  return 7 + 2 * walls;
}

/** a player's cities (vertex ids) */
export function ownCities(s: GameState, p: number) {
  return Object.entries(s.buildings).filter(([, b]) => b.owner === p && b.kind === 'city').map(([v]) => Number(v));
}

export function validWallSpots(s: GameState, p: number) {
  if (s.mode !== 'guilds') return [];
  const walls = Object.values(s.buildings).filter((b) => b.owner === p && b.wall).length;
  if (walls >= 3) return [];
  return ownCities(s, p).filter((v) => !s.buildings[v].wall);
}

// ----------------------------------------------------------------- knights

/** knights a player has of one level */
export function knightCount(s: GameState, p: number, level: 1 | 2 | 3) {
  return Object.values(s.knights ?? {}).filter((k) => k.owner === p && k.level === level).length;
}

/** empty corners on a player's road network where a new knight may stand */
export function validKnightSpots(s: GameState, p: number) {
  if (s.mode !== 'guilds') return [];
  return GEO.vertices
    .filter((v) => !s.buildings[v.id] && !s.knights?.[v.id] && v.edges.some((e) => s.roads[e] === p))
    .map((v) => v.id);
}

/** why a knight can't act now (null if it can) */
function knightCantAct(s: GameState, k: Knight): string | null {
  if (!k.active) return M('err.knightInactive');
  if (k.activatedTurn === s.turnNumber) return M('err.knightJustActivated');
  if (k.actedTurn === s.turnNumber) return M('err.knightActed');
  return null;
}

/** corners reachable from `from` along the owner's own roads, without passing other pieces */
function reachable(s: GameState, p: number, from: number) {
  const seen = new Set<number>([from]);
  const queue = [from];
  const out: number[] = [];
  while (queue.length) {
    const v = queue.shift()!;
    for (const e of GEO.vertices[v].edges) {
      if (s.roads[e] !== p) continue;
      const ed = GEO.edges[e];
      const n = ed.a === v ? ed.b : ed.a;
      if (seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      // only free corners (or own buildings) can be walked through
      const b = s.buildings[n];
      if (!s.knights?.[n] && (!b || b.owner === p)) queue.push(n);
    }
  }
  return out;
}

/** where a knight on `from` may go: empty corners, or a weaker enemy knight's corner (displace) */
export function knightMoves(s: GameState, from: number) {
  const k = s.knights?.[from];
  if (!k) return [];
  return reachable(s, k.owner, from).filter((v) => {
    if (s.buildings[v]) return false;
    const other = s.knights?.[v];
    return !other || (other.owner !== k.owner && other.level < k.level);
  });
}

/** the nearest free corner on the owner's roads for a displaced knight (null: it leaves the board) */
function retreatSpot(s: GameState, owner: number, from: number) {
  return reachable(s, owner, from).find((v) => !s.buildings[v] && !s.knights?.[v]) ?? null;
}

/** knights of a player that may act this turn */
export function readyKnights(s: GameState, p: number) {
  return Object.entries(s.knights ?? {}).filter(([, k]) => k.owner === p && !knightCantAct(s, k)).map(([v]) => Number(v));
}

/** bank rate for goods: 4:1, or 2:1 with trade level 3 */
export function goodsRate(s: GameState, p: number) {
  return (s.players[p].levels?.trade ?? 0) >= 3 ? 2 : 4;
}

/** level 4 claims a free metropolis; level 5 takes it from someone who only has level 4 */
function claimMetropolis(s: GameState, p: number, track: Track) {
  const metros = (s.metropolis ??= { trade: null, politics: null, science: null });
  const level = s.players[p].levels![track];
  const holder = metros[track];
  if (level < 4 || holder === p) return;
  const holderLevel = holder === null ? 0 : s.players[holder].levels![track];
  if (holder !== null && !(level === 5 && holderLevel < 5)) return;
  const free = ownCities(s, p).find((v) => !s.buildings[v].metro);
  if (free === undefined) return; // no city to hold it yet
  if (holder !== null) {
    const old = Object.entries(s.buildings).find(([, b]) => b.metro === track);
    if (old) delete s.buildings[Number(old[0])].metro;
  }
  s.buildings[free] = { ...s.buildings[free], metro: track };
  metros[track] = p;
  fx(s, { t: 'metro', track, from: holder, to: p });
  log(s, M('log.metro', { name: s.players[p].name, track }));
}

function fx(s: GameState, e: FxEvent) {
  (s.fx ??= { id: 1, list: [] }).list.push(e);
}

function log(s: GameState, msg: string) {
  s.log.push(msg);
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
}

function updateLongestRoad(s: GameState) {
  const lens = s.players.map((_, i) => longestRoadFor(s, i));
  const holder = s.longestRoad.owner;
  const max = Math.max(...lens);
  if (holder !== null && lens[holder] >= 5 && lens[holder] === max) {
    s.longestRoad.length = lens[holder];
    return;
  }
  const leaders = lens.map((l, i) => (l === max ? i : -1)).filter((i) => i >= 0);
  const prev = holder;
  if (max >= 5 && leaders.length === 1) s.longestRoad = { owner: leaders[0], length: max };
  else s.longestRoad = { owner: null, length: max };
  if (s.longestRoad.owner !== prev) fx(s, { t: 'award', award: 'road', from: prev, to: s.longestRoad.owner });
  if (s.longestRoad.owner !== prev && s.longestRoad.owner !== null)
    log(s, M('log.longestRoad', { name: s.players[s.longestRoad.owner].name, n: max }));
}

function checkWin(s: GameState) {
  const p = s.current;
  if (victoryPoints(s, p) >= winPoints(s)) {
    s.phase = 'ended';
    s.winner = p;
    const st = stats(s);
    st.endedAt = Date.now();
    st.vp.push(s.players.map((_, i) => victoryPoints(s, i)));
    log(s, M('log.win', { name: s.players[p].name, n: victoryPoints(s, p) }));
  }
}

function produce(s: GameState, roll: number) {
  const gains = s.players.map(() => emptyRes());
  const goodGains = s.players.map(() => emptyGoods());
  const items: ProductionItem[] = [];
  const goodItems: ProductionItem[] = [];
  const guilds = s.mode === 'guilds';
  s.hexes.forEach((h) => {
    if (h.number !== roll || h.id === s.raider || h.type === 'desert') return;
    for (const v of GEO.hexVertices[h.id]) {
      const b = s.buildings[v];
      if (!b) continue;
      // Guildlands: a city on forest / pasture / mountains makes 1 resource + 1 good
      const good = guilds && b.kind === 'city' ? (GOODS.find((g) => GOODS_INFO[g].from === h.type) ?? null) : null;
      const n = b.kind === 'city' && !good ? 2 : 1;
      gains[b.owner][h.type] += n;
      items.push({ p: b.owner, hex: h.id, r: h.type, n });
      if (good) {
        goodGains[b.owner][good]++;
        goodItems.push({ p: b.owner, hex: h.id, r: good, n: 1 });
      }
    }
  });
  // what the Raider took away this roll
  const rh = s.hexes[s.raider];
  if (rh && rh.number === roll && rh.type !== 'desert')
    for (const v of GEO.hexVertices[rh.id]) {
      const b = s.buildings[v];
      if (b) stats(s).players[b.owner].blocked += b.kind === 'city' ? 2 : 1;
    }
  for (const r of RESOURCES) {
    const demand = gains.reduce((t, g) => t + g[r], 0);
    const takers = gains.filter((g) => g[r] > 0).length;
    if (demand > s.bank[r]) {
      if (takers > 1) {
        gains.forEach((g) => (g[r] = 0));
        log(s, M('log.bankOut', { res: r }));
      } else gains.forEach((g) => (g[r] = Math.min(g[r], s.bank[r])));
    }
  }
  // trim the per-tile record to what was actually paid out
  const left = gains.map((g) => ({ ...g }));
  const paid: ProductionItem[] = [];
  for (const it of items) {
    const r = it.r as Resource;
    const n = Math.min(it.n, left[it.p][r]);
    if (n <= 0) continue;
    left[it.p][r] -= n;
    paid.push({ ...it, n });
  }
  paid.push(...goodItems);
  s.production = { id: (s.production?.id ?? 0) + 1, items: paid };
  gains.forEach((g, i) => {
    const gg = goodGains[i];
    const nGoods = GOODS.reduce((t, k) => t + gg[k], 0);
    if (totalRes(g) === 0 && nGoods === 0) return;
    RESOURCES.forEach((r) => {
      s.players[i].hand[r] += g[r];
      s.bank[r] -= g[r];
      stats(s).players[i].produced[r] += g[r];
    });
    if (nGoods) {
      const pg = (s.players[i].goods ??= emptyGoods());
      GOODS.forEach((k) => (pg[k] += gg[k]));
      stats(s).players[i].goods = (stats(s).players[i].goods ?? 0) + nGoods;
    }
    log(s, M('log.receives', { name: s.players[i].name, cards: [fmtRes(g), fmtGoods(gg)].filter((x) => x !== '—').join(' ') || '—' }));
  });
  // science level 3: whoever got nothing from this roll may take a resource of their choice
  if (guilds) {
    s.aqueduct = s.players
      .map((pl, i) => ({ pl, i }))
      .filter(({ pl, i }) => (pl.levels?.science ?? 0) >= 3 && totalRes(gains[i]) === 0 && GOODS.every((k) => goodGains[i][k] === 0))
      .map(({ i }) => i);
  }
}

function startRaider(s: GameState, after: 'roll' | 'actions') {
  s.afterRaider = after;
  s.stage = 'moveRaider';
}

function nextSetup(s: GameState) {
  s.setupIndex++;
  s.setupNeed = 'settlement';
  s.lastSetupVertex = null;
  if (s.setupIndex >= s.setupOrder.length) {
    s.phase = 'main';
    s.current = 0;
    s.stage = 'roll';
    s.turnNumber = 1;
    stats(s).vp.push(s.players.map((_, i) => victoryPoints(s, i)));
    log(s, M('log.setupDone', { name: s.players[0].name }));
  } else s.current = s.setupOrder[s.setupIndex];
}

// ---------------------------------------------------------------- reducer

export type Result = { ok: true; state: GameState } | { ok: false; error: string };

export function applyAction(prev: GameState, p: number, a: Action, rng: Rng = Math.random): Result {
  const s: GameState = structuredClone(prev);
  try {
    const err = reduce(s, p, a, rng);
    if (err) return { ok: false, error: err };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
  return { ok: true, state: s };
}

function reduce(s: GameState, p: number, a: Action, rng: Rng): string | void {
  s.fx = { id: (s.fx?.id ?? 0) + 1, list: [] };
  if (s.phase === 'ended') return M('err.over');
  const me = s.players[p];
  if (!me) return M('err.unknownPlayer');
  const isTurn = p === s.current;

  // actions that may be taken out of turn
  if (a.type === 'discard') {
    if (s.stage !== 'discard' || !s.pendingDiscards[p]) return M('err.noDiscard');
    const need = s.pendingDiscards[p];
    const dg = a.goods ?? {};
    const nGoods = GOODS.reduce((t, k) => t + (dg[k] ?? 0), 0);
    if (totalRes(a.cards) + nGoods !== need) return M('err.discardExactly', { n: need });
    if (!has(me.hand, a.cards) || RESOURCES.some((r) => (a.cards[r] ?? 0) < 0)) return M('err.invalidCards');
    if (GOODS.some((k) => (dg[k] ?? 0) < 0 || (dg[k] ?? 0) > (me.goods?.[k] ?? 0))) return M('err.invalidCards');
    pay(s, p, a.cards);
    if (me.goods) GOODS.forEach((k) => (me.goods![k] -= dg[k] ?? 0));
    delete s.pendingDiscards[p];
    log(s, M('log.discards', { name: me.name, n: need }));
    fx(s, { t: 'discard', p, n: need });
    stats(s).players[p].discarded += need;
    if (Object.keys(s.pendingDiscards).length === 0) s.stage = 'moveRaider';
    return;
  }
  if (a.type === 'acceptTrade' || a.type === 'declineTrade') {
    const t = s.trade;
    if (!t || t.id !== a.id) return M('err.offerGone');
    if (t.from === p) return M('err.ownOffer');
    if (a.type === 'declineTrade') {
      if (!t.declined.includes(p)) t.declined.push(p);
      return;
    }
    const from = s.players[t.from];
    if (!has(me.hand, t.get)) return M('err.noRequested');
    if (!has(from.hand, t.give)) return M('err.offererLacks', { name: from.name });
    for (const r of RESOURCES) {
      const g = t.give[r] ?? 0, w = t.get[r] ?? 0;
      from.hand[r] += w - g;
      me.hand[r] += g - w;
    }
    fx(s, { t: 'trade', a: t.from, b: p, give: t.give, get: t.get });
    stats(s).players[t.from].trades++;
    stats(s).players[p].trades++;
    log(s, M('log.traded', { a: from.name, b: me.name, give: fmtRes(t.give), get: fmtRes(t.get) }));
    s.trade = null;
    return;
  }

  if (a.type === 'aqueduct') {
    if (!s.aqueduct?.includes(p)) return M('err.noAqueduct');
    if (!RESOURCES.includes(a.res) || s.bank[a.res] < 1) return M('err.bankOut');
    me.hand[a.res]++;
    s.bank[a.res]--;
    s.aqueduct = s.aqueduct.filter((x) => x !== p);
    log(s, M('log.aqueduct', { name: me.name, cards: `1 ${RES_INFO[a.res].icon}` }));
    s.production = { id: (s.production?.id ?? 0) + 1, items: [{ p, hex: s.raider, r: a.res, n: 1 }] };
    return;
  }
  if (a.type === 'counterTrade') {
    const t = s.trade;
    if (!t || t.id !== a.id) return M('err.offerGone');
    if (t.from === p) return M('err.ownOffer');
    const neg = RESOURCES.some((r) => (a.give[r] ?? 0) < 0 || (a.get[r] ?? 0) < 0);
    if (neg || totalRes(a.give) === 0 || totalRes(a.get) === 0) return M('err.offerBoth');
    if (!has(me.hand, a.give)) return M('err.noCards');
    const clean = (r: Partial<ResMap>) => Object.fromEntries(RESOURCES.filter((k) => (r[k] ?? 0) > 0).map((k) => [k, Math.floor(r[k]!)]));
    t.counters = [...(t.counters ?? []).filter((c) => c.p !== p), { p, give: clean(a.give), get: clean(a.get) }];
    t.declined = t.declined.filter((d) => d !== p);
    log(s, M('log.counter', { name: me.name, give: fmtRes(a.give), get: fmtRes(a.get) }));
    return;
  }
  if (a.type === 'acceptCounter') {
    const t = s.trade;
    if (!t || t.id !== a.id) return M('err.offerGone');
    if (t.from !== p) return M('err.notTurn');
    const c = t.counters?.find((x) => x.p === a.p);
    if (!c) return M('err.offerGone');
    const other = s.players[c.p];
    if (!has(me.hand, c.get)) return M('err.noCards');
    if (!has(other.hand, c.give)) return M('err.offererLacks', { name: other.name });
    for (const r of RESOURCES) {
      const g = c.get[r] ?? 0, w = c.give[r] ?? 0; // proposer gives what the counter asks for
      me.hand[r] += w - g;
      other.hand[r] += g - w;
    }
    fx(s, { t: 'trade', a: p, b: c.p, give: c.get, get: c.give });
    stats(s).players[p].trades++;
    stats(s).players[c.p].trades++;
    log(s, M('log.traded', { a: me.name, b: other.name, give: fmtRes(c.get), get: fmtRes(c.give) }));
    s.trade = null;
    return;
  }

  if (!isTurn) return M('err.notTurn');

  // ------------------------------------------------------------- setup phase
  if (s.phase === 'setup') {
    if (a.type === 'buildSettlement' && s.setupNeed === 'settlement') {
      if (!validSettlementSpots(s, p).includes(a.vertex)) return M('err.cantSettle');
      const asCity = s.mode === 'guilds' && s.setupIndex >= s.players.length;
      s.buildings[a.vertex] = { owner: p, kind: asCity ? 'city' : 'settlement' };
      if (asCity) {
        stats(s).players[p].cities++;
        me.citiesLeft--;
      } else {
        stats(s).players[p].settlements++;
        me.settlementsLeft--;
      }
      s.lastSetupVertex = a.vertex;
      s.setupNeed = 'road';
      if (s.setupIndex >= s.players.length) {
        const g = emptyRes();
        const items: ProductionItem[] = [];
        for (const h of GEO.vertices[a.vertex].hexes) {
          const t = s.hexes[h].type;
          if (t === 'desert') continue;
          g[t]++;
          items.push({ p, hex: h, r: t, n: 1 });
          stats(s).players[p].produced[t]++;
        }
        s.production = { id: (s.production?.id ?? 0) + 1, items };
        RESOURCES.forEach((r) => { me.hand[r] += g[r]; s.bank[r] -= g[r]; });
        log(s, M('log.foundGather', { name: me.name, cards: fmtRes(g) }));
      } else log(s, M('log.found', { name: me.name }));
      return;
    }
    if (a.type === 'buildRoad' && s.setupNeed === 'road') {
      if (!validRoadSpots(s, p).includes(a.edge)) return M('err.setupRoad');
      s.roads[a.edge] = p;
      stats(s).players[p].roads++;
      me.roadsLeft--;
      nextSetup(s);
      return;
    }
    return M(s.setupNeed === 'road' ? 'err.placeRoad' : 'err.placeSettlement');
  }

  // -------------------------------------------------------------- main phase
  switch (a.type) {
    case 'roll': {
      if (s.stage !== 'roll') return M('err.rolled');
      const d: [number, number] = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
      s.dice = d;
      stats(s).rolls[d[0] + d[1]]++;
      s.rollId = (s.rollId ?? 0) + 1;
      s.rolledBy = p;
      const sum = d[0] + d[1];
      log(s, M('log.rolls', { name: me.name, n: sum }));
      if (sum === 7) {
        s.pendingDiscards = {};
        s.players.forEach((pl, i) => {
          const n = handSize(pl);
          if (n > handLimit(s, i)) s.pendingDiscards[i] = Math.floor(n / 2);
        });
        log(s, M('log.raider'));
        s.afterRaider = 'actions';
        s.stage = Object.keys(s.pendingDiscards).length ? 'discard' : 'moveRaider';
      } else {
        produce(s, sum);
        s.stage = 'actions';
      }
      return;
    }
    case 'moveRaider': {
      if (s.stage !== 'moveRaider') return M('err.cantRaider');
      if (!validRaiderHexes(s).includes(a.hex)) return M('err.otherTile');
      s.raider = a.hex;
      log(s, M('log.movesRaider', { name: me.name }));
      const cands = stealCandidates(s, p);
      if (cands.length === 0) s.stage = s.afterRaider;
      else if (cands.length === 1) {
        stealCard(s, p, cands[0], rng);
        s.stage = s.afterRaider;
      } else {
        s.stealFrom = cands;
        s.stage = 'steal';
      }
      return;
    }
    case 'steal': {
      if (s.stage !== 'steal' || !s.stealFrom.includes(a.target)) return M('err.invalidTarget');
      stealCard(s, p, a.target, rng);
      s.stealFrom = [];
      s.stage = s.afterRaider;
      return;
    }
    case 'buildRoad': {
      const free = s.stage === 'roadworks';
      if (s.stage !== 'actions' && !free) return M('err.cantBuild');
      if (me.roadsLeft <= 0) return M('err.noRoads');
      if (!free && !canAfford(s, p, 'road')) return M('err.notEnough');
      if (!validRoadSpots(s, p).includes(a.edge)) return M('err.cantRoad');
      if (!free) pay(s, p, COSTS.road);
      s.roads[a.edge] = p;
      stats(s).players[p].roads++;
      me.roadsLeft--;
      if (free) {
        s.roadworksLeft--;
        if (s.roadworksLeft <= 0 || me.roadsLeft <= 0 || validRoadSpots(s, p).length === 0) s.stage = s.afterRaider;
      }
      updateLongestRoad(s);
      checkWin(s);
      return;
    }
    case 'buildSettlement': {
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (me.settlementsLeft <= 0) return M('err.noSettlements');
      if (!canAfford(s, p, 'settlement')) return M('err.notEnough');
      if (!validSettlementSpots(s, p).includes(a.vertex)) return M('err.cantSettle');
      pay(s, p, COSTS.settlement);
      s.buildings[a.vertex] = { owner: p, kind: 'settlement' };
      stats(s).players[p].settlements++;
      me.settlementsLeft--;
      log(s, M('log.buildSettlement', { name: me.name }));
      updateLongestRoad(s); // may break an opponent's road
      checkWin(s);
      return;
    }
    case 'buildCity': {
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (me.citiesLeft <= 0) return M('err.noCities');
      if (!canAfford(s, p, 'city')) return M('err.notEnough');
      if (!validCitySpots(s, p).includes(a.vertex)) return M('err.upgradeOwn');
      pay(s, p, COSTS.city);
      s.buildings[a.vertex] = { owner: p, kind: 'city' };
      stats(s).players[p].cities++;
      me.citiesLeft--;
      me.settlementsLeft++;
      log(s, M('log.buildCity', { name: me.name }));
      checkWin(s);
      return;
    }
    case 'buyDev': {
      if (s.stage !== 'actions') return M('err.cantBuy');
      if (s.mode === 'guilds') return M('err.noFortune');
      if (!s.devDeck.length) return M('err.deckEmpty');
      if (!canAfford(s, p, 'dev')) return M('err.notEnough');
      pay(s, p, COSTS.dev);
      me.newDev.push(s.devDeck.pop()!);
      log(s, M('log.buyDev', { name: me.name }));
      fx(s, { t: 'buyDev', p });
      stats(s).players[p].bought++;
      checkWin(s);
      return;
    }
    case 'playDev': {
      if (s.devPlayedThisTurn) return M('err.oneDev');
      if (a.card === 'monument') return M('err.monument');
      if (!(s.stage === 'actions' || (s.stage === 'roll' && a.card === 'guard'))) return M('err.cantPlay');
      const idx = me.dev.indexOf(a.card);
      if (idx < 0) return M('err.noCard');
      if (a.card === 'harvest') {
        const res = a.res ?? [];
        if (res.length !== 2 || res.some((r) => !RESOURCES.includes(r))) return M('err.pick2');
        const need = emptyRes();
        res.forEach((r) => need[r]++);
        if (!has(s.bank, need)) return M('err.bankLacks');
        res.forEach((r) => { me.hand[r]++; s.bank[r]--; });
        log(s, M('log.harvest', { name: me.name, cards: fmtRes(need) }));
      } else if (a.card === 'embargo') {
        const r = a.res?.[0];
        if (!r || !RESOURCES.includes(r)) return M('err.pick1');
        let got = 0;
        s.players.forEach((pl, i) => {
          if (i === p) return;
          got += pl.hand[r];
          pl.hand[r] = 0;
        });
        me.hand[r] += got;
        log(s, M('log.embargo', { name: me.name, res: r, n: got }));
      } else if (a.card === 'roadworks') {
        if (me.roadsLeft <= 0 || validRoadSpots(s, p).length === 0) return M('err.nowhereRoads');
        s.roadworksLeft = 2;
        s.afterRaider = 'actions';
        s.stage = 'roadworks';
        log(s, M('log.roadworks', { name: me.name }));
      } else if (a.card === 'guard') {
        me.guards++;
        stats(s).players[p].knights++;
        log(s, M('log.guard', { name: me.name }));
        if (me.guards >= 3 && me.guards > s.strongestGuard.size) {
          if (s.strongestGuard.owner !== p) log(s, M('log.strongestGuard', { name: me.name }));
          if (s.strongestGuard.owner !== p) fx(s, { t: 'award', award: 'guard', from: s.strongestGuard.owner, to: p });
          s.strongestGuard = { owner: p, size: me.guards };
        }
        startRaider(s, s.stage === 'roll' ? 'roll' : 'actions');
      }
      fx(s, { t: 'playDev', p, card: a.card });
      me.dev.splice(idx, 1);
      s.devPlayedThisTurn = true;
      checkWin(s);
      return;
    }
    case 'bankTrade': {
      if (s.stage !== 'actions') return M('err.cantTrade');
      if (a.give === a.get) return M('err.twoDifferent');
      if ((isGood(a.give) || isGood(a.get)) && s.mode !== 'guilds') return M('err.unknownAction');
      const rate = isGood(a.give) ? goodsRate(s, p) : tradeRates(s, p)[a.give];
      const have = isGood(a.give) ? (me.goods?.[a.give] ?? 0) : me.hand[a.give];
      if (have < rate) return M('err.needRate', { n: rate, res: a.give });
      if (!isGood(a.get) && s.bank[a.get] < 1) return M('err.bankOut');
      if (isGood(a.give)) me.goods![a.give] -= rate;
      else {
        me.hand[a.give] -= rate;
        s.bank[a.give] += rate;
      }
      if (isGood(a.get)) me.goods![a.get]++;
      else {
        me.hand[a.get]++;
        s.bank[a.get]--;
      }
      if (!isGood(a.give) && !isGood(a.get)) fx(s, { t: 'bank', p, give: a.give, n: rate, get: a.get });
      stats(s).players[p].bankTrades++;
      log(s, M('log.bankTrade', { name: me.name, n: rate, give: cardIcon(a.give), get: cardIcon(a.get) }));
      return;
    }
    case 'offerTrade': {
      if (s.stage !== 'actions') return M('err.cantTrade');
      const neg = RESOURCES.some((r) => (a.give[r] ?? 0) < 0 || (a.get[r] ?? 0) < 0);
      if (neg || totalRes(a.give) === 0 || totalRes(a.get) === 0) return M('err.offerBoth');
      if (!has(me.hand, a.give)) return M('err.noCards');
      s.trade = { id: ++s.tradeSeq, from: p, give: a.give, get: a.get, declined: [] };
      log(s, M('log.offers', { name: me.name, give: fmtRes(a.give), get: fmtRes(a.get) }));
      return;
    }
    case 'cancelTrade': {
      s.trade = null;
      return;
    }
    case 'improve': {
      if (s.mode !== 'guilds' || !me.levels || !me.goods) return M('err.unknownAction');
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (!TRACKS.includes(a.track)) return M('err.unknownAction');
      const level = me.levels[a.track];
      if (level >= 5) return M('err.maxLevel');
      if (!ownCities(s, p).length) return M('err.needCity');
      const good = TRACK_INFO[a.track].good;
      const cost = improveCost(level);
      if (me.goods[good] < cost) return M('err.needRate', { n: cost, res: good });
      me.goods[good] -= cost;
      me.levels[a.track] = level + 1;
      fx(s, { t: 'improve', p, track: a.track, level: level + 1 });
      log(s, M('log.improve', { name: me.name, track: a.track, n: level + 1 }));
      claimMetropolis(s, p, a.track);
      checkWin(s);
      return;
    }
    case 'buildWall': {
      if (s.mode !== 'guilds') return M('err.unknownAction');
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (!canAfford(s, p, 'wall')) return M('err.notEnough');
      if (!validWallSpots(s, p).includes(a.vertex)) return M('err.cantWall');
      pay(s, p, COSTS.wall);
      s.buildings[a.vertex] = { ...s.buildings[a.vertex], wall: true };
      log(s, M('log.wall', { name: me.name }));
      return;
    }
    case 'buildKnight': {
      if (s.mode !== 'guilds') return M('err.unknownAction');
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (knightCount(s, p, 1) >= KNIGHTS_PER_LEVEL) return M('err.noKnights');
      if (!canAfford(s, p, 'knight')) return M('err.notEnough');
      if (!validKnightSpots(s, p).includes(a.vertex)) return M('err.cantKnight');
      pay(s, p, COSTS.knight);
      (s.knights ??= {})[a.vertex] = { owner: p, level: 1, active: false };
      fx(s, { t: 'knight', p, act: 'build', at: a.vertex });
      log(s, M('log.knightBuild', { name: me.name }));
      updateLongestRoad(s); // a knight can cut an opponent's road
      return;
    }
    case 'activateKnight': {
      const k = s.knights?.[a.vertex];
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (!k || k.owner !== p) return M('err.notYourKnight');
      if (k.active) return M('err.knightActive');
      if (!canAfford(s, p, 'activate')) return M('err.notEnough');
      pay(s, p, COSTS.activate);
      k.active = true;
      k.activatedTurn = s.turnNumber;
      fx(s, { t: 'knight', p, act: 'activate', at: a.vertex });
      log(s, M('log.knightActivate', { name: me.name }));
      return;
    }
    case 'promoteKnight': {
      const k = s.knights?.[a.vertex];
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (!k || k.owner !== p) return M('err.notYourKnight');
      if (k.level >= 3) return M('err.knightMax');
      if (k.level === 2 && (me.levels?.politics ?? 0) < 3) return M('err.needPolitics');
      if (k.promotedTurn === s.turnNumber) return M('err.promotedThisTurn');
      if (knightCount(s, p, (k.level + 1) as 2 | 3) >= KNIGHTS_PER_LEVEL) return M('err.noKnights');
      if (!canAfford(s, p, 'promote')) return M('err.notEnough');
      pay(s, p, COSTS.promote);
      k.level = (k.level + 1) as 2 | 3;
      k.promotedTurn = s.turnNumber;
      fx(s, { t: 'knight', p, act: 'promote', at: a.vertex });
      log(s, M('log.knightPromote', { name: me.name, n: k.level }));
      return;
    }
    case 'moveKnight': {
      const k = s.knights?.[a.from];
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (!k || k.owner !== p) return M('err.notYourKnight');
      const why = knightCantAct(s, k);
      if (why) return why;
      const targets = knightMoves(s, a.from);
      if (!targets.includes(a.to)) return M('err.cantMoveKnight');
      const victim = s.knights![a.to];
      delete s.knights![a.from];
      if (victim) {
        // displace: the weaker knight retreats along its owner's roads, or leaves the board
        const retreat = retreatSpot(s, victim.owner, a.to);
        delete s.knights![a.to];
        if (retreat !== null) s.knights![retreat] = victim;
        fx(s, { t: 'knight', p, act: 'displace', at: a.from, to: a.to });
        log(s, M(retreat === null ? 'log.knightRouted' : 'log.knightDisplace', { name: me.name, victim: s.players[victim.owner].name }));
      } else {
        fx(s, { t: 'knight', p, act: 'move', at: a.from, to: a.to });
        log(s, M('log.knightMove', { name: me.name }));
      }
      s.knights![a.to] = { ...k, active: false, actedTurn: s.turnNumber };
      updateLongestRoad(s);
      return;
    }
    case 'chaseRaider': {
      const k = s.knights?.[a.vertex];
      if (s.stage !== 'actions') return M('err.cantBuild');
      if (!k || k.owner !== p) return M('err.notYourKnight');
      const why = knightCantAct(s, k);
      if (why) return why;
      if (!GEO.hexVertices[s.raider].includes(a.vertex)) return M('err.notNextToRaider');
      k.active = false;
      k.actedTurn = s.turnNumber;
      fx(s, { t: 'knight', p, act: 'chase', at: a.vertex });
      log(s, M('log.knightChase', { name: me.name }));
      startRaider(s, 'actions');
      return;
    }
    case 'endTurn': {
      if (s.stage !== 'actions') return M('err.finishStep');
      me.dev.push(...me.newDev);
      me.newDev = [];
      s.trade = null;
      s.devPlayedThisTurn = false;
      s.dice = null;
      s.current = (s.current + 1) % s.players.length;
      s.stage = 'roll';
      s.turnNumber++;
      s.aqueduct = [];
      stats(s).vp.push(s.players.map((_, i) => victoryPoints(s, i)));
      log(s, M('log.turn', { name: s.players[s.current].name }));
      return;
    }
  }
  return M('err.unknownAction');
}

function stealCard(s: GameState, p: number, target: number, rng: Rng) {
  const victim = s.players[target];
  const pool: Resource[] = [];
  RESOURCES.forEach((r) => { for (let i = 0; i < victim.hand[r]; i++) pool.push(r); });
  if (!pool.length) return;
  const r = pool[Math.floor(rng() * pool.length)];
  victim.hand[r]--;
  s.players[p].hand[r]++;
  log(s, M('log.steal', { name: s.players[p].name, victim: victim.name }));
  fx(s, { t: 'steal', from: target, to: p });
  stats(s).players[p].stolen++;
  stats(s).players[target].robbed++;
}
