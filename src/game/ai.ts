import { GEO } from './board';
import {
  applyAction, barbarianStrength, canAfford, handLimit, handSize, knightMoves, knightStrength, longestRoadFor,
  readyKnights, tradeRates, validCitySpots, validKnightSpots, validRaiderHexes, validRoadSpots, validSettlementSpots,
  validWallSpots, victoryPoints, goodsRate, ownCities,
} from './rules';
import {
  Action, BARBARIAN_STEPS, COSTS, DevCard, GOODS, GameState, PROGRESS, ProgressCard, RESOURCES, ResMap, Resource,
  TRACKS, TRACK_INFO, TileType, improveCost, totalRes, winPoints,
} from './types';

/**
 * Bot players. Every decision scores the position that each possible move leads to
 * (simulated with the real rules engine) and picks the best one. The score looks at
 * points, production (dice odds, resource variety and scarcity, harbours), how close
 * the hand is to the next build, room to expand, road and army races, the risk of a 7,
 * and in Guildlands goods, city improvements and barbarian defence.
 */
export type BotLevel = 'easy' | 'normal' | 'hard';

const PIPS = (n: number | null) => (n ? 6 - Math.abs(7 - n) : 0);

// ------------------------------------------------------------------ board analysis

/** how valuable each resource is on this board: scarce resources are worth more */
function resourceWeights(s: GameState): Record<Resource, number> {
  const total: Record<string, number> = {};
  RESOURCES.forEach((r) => (total[r] = 0.5));
  for (const h of s.hexes) if (h.type !== 'desert') total[h.type] += PIPS(h.number);
  const avg = RESOURCES.reduce((a, r) => a + total[r], 0) / RESOURCES.length;
  const w = {} as Record<Resource, number>;
  RESOURCES.forEach((r) => (w[r] = Math.max(0.7, Math.min(1.6, avg / total[r]))));
  // grain and ore build cities, timber and clay build roads: a little extra for the city pair later on
  w.ore *= 1.08;
  w.grain *= 1.08;
  return w;
}

/** expected production (in dice pips) a player gets of each resource */
function productionByRes(s: GameState, p: number): Record<Resource, number> {
  const prod = {} as Record<Resource, number>;
  RESOURCES.forEach((r) => (prod[r] = 0));
  for (const [v, b] of Object.entries(s.buildings)) {
    if (b.owner !== p) continue;
    for (const hi of GEO.vertices[Number(v)].hexes) {
      const h = s.hexes[hi];
      if (h.type === 'desert' || hi === s.raider) continue;
      prod[h.type] += PIPS(h.number) * (b.kind === 'city' ? 2 : 1);
    }
  }
  return prod;
}

/** how good a free corner is for a new settlement for player p */
function spotScore(s: GameState, p: number, v: number, w = resourceWeights(s), have = productionByRes(s, p)): number {
  let score = 0;
  const kinds = new Set<TileType>();
  for (const hi of GEO.vertices[v].hexes) {
    const h = s.hexes[hi];
    if (h.type === 'desert') continue;
    const pips = PIPS(h.number) * (hi === s.raider ? 0.4 : 1);
    // new resources are worth more than more of what we already make
    const novelty = have[h.type] < 2 ? 1.35 : have[h.type] > 8 ? 0.8 : 1;
    score += pips * w[h.type] * novelty;
    kinds.add(h.type);
    if (s.mode === 'guilds' && (h.type === 'timber' || h.type === 'wool' || h.type === 'ore')) score += pips * 0.15;
  }
  score += kinds.size * 0.8;
  // harbours on this corner
  for (const port of s.ports) {
    const e = GEO.edges[port.edge];
    if (e.a !== v && e.b !== v) continue;
    if (port.type === 'any') score += 1.5;
    else score += 1 + Math.min(4, have[port.type] * 0.35);
  }
  return score;
}

// ------------------------------------------------------------------- evaluation

/** evaluation weights (tuned with bot-vs-bot games, see scripts/bots.ts) */
export const DEFAULT_WEIGHTS = { prod: 3.2, kinds: 6, spot: 2.4, ready: 0.45, close: 0.3, card: 2.2, over: 7, road: 5, dev: 16, army: 8 };
let W = DEFAULT_WEIGHTS;
/** for tuning experiments only */
export function setWeights(w: typeof DEFAULT_WEIGHTS) { W = w; }

/** free corners that one more road would make settleable */
function nearSpots(s: GameState, p: number): number[] {
  const free = (v: number) => !s.buildings[v] && !(s.knights?.[v] && s.knights[v].owner !== p) && GEO.vertices[v].neighbors.every((n) => !s.buildings[n]);
  const out = new Set<number>();
  for (const e of validRoadSpots(s, p)) {
    const ed = GEO.edges[e];
    for (const end of [ed.a, ed.b]) if (free(end)) out.add(end);
  }
  for (const v of validSettlementSpots(s, p)) out.delete(v);
  return [...out];
}

interface Ctx {
  w: Record<Resource, number>;
  lead: number;
}

function ctxFor(s: GameState): Ctx {
  return { w: resourceWeights(s), lead: Math.max(...s.players.map((_, i) => victoryPoints(s, i, false))) };
}

/** what each build is worth to the player right now (0 if impossible) */
function buildTargets(s: GameState, p: number) {
  const pl = s.players[p];
  const t: { cost: Partial<ResMap>; value: number }[] = [];
  if (pl.citiesLeft > 0 && validCitySpots(s, p).length) t.push({ cost: COSTS.city, value: 125 });
  const spots = validSettlementSpots(s, p);
  if (pl.settlementsLeft > 0 && spots.length) t.push({ cost: COSTS.settlement, value: 110 });
  if (pl.roadsLeft > 0) t.push({ cost: COSTS.road, value: spots.length ? 10 : 30 });
  if (s.mode !== 'guilds' && s.devDeck.length) t.push({ cost: COSTS.dev, value: 40 });
  if (s.mode === 'guilds') {
    t.push({ cost: COSTS.knight, value: 28 });
    t.push({ cost: COSTS.activate, value: (s.barbarians ?? 0) >= 4 ? 30 : 10 });
  }
  return t;
}

function evaluate(s: GameState, p: number, c: Ctx): number {
  const pl = s.players[p];
  const vp = victoryPoints(s, p);
  if (vp >= winPoints(s)) return 1e7;
  let v = vp * 100;

  // production engine
  const prod = productionByRes(s, p);
  let kinds = 0;
  for (const r of RESOURCES) {
    v += prod[r] * c.w[r] * W.prod;
    if (prod[r] > 0) kinds++;
  }
  v += kinds * W.kinds;
  // harbours that fit what we produce
  for (const port of s.ports) {
    const e = GEO.edges[port.edge];
    if (s.buildings[e.a]?.owner !== p && s.buildings[e.b]?.owner !== p) continue;
    if (port.type === 'any') v += 6 + RESOURCES.reduce((a, r) => a + prod[r], 0) * 0.15;
    else v += 3 + prod[port.type] * 1.6;
  }

  // room to expand: the best corners we can settle now
  const spots = validSettlementSpots(s, p).map((x) => spotScore(s, p, x, c.w, prod)).sort((a, b) => b - a);
  if (spots.length) v += spots[0] * W.spot + (spots[1] ?? 0) * 0.8;
  else if (pl.settlementsLeft > 0) v -= 12;
  if (pl.settlementsLeft > 0) {
    const near = nearSpots(s, p).map((x) => spotScore(s, p, x, c.w, prod));
    if (near.length) v += Math.max(...near) * (spots.length ? 0.6 : 1.3);
  }

  // hand: closeness to builds, with a penalty for being over the 7-card limit
  const hand = pl.hand;
  let best = 0;
  for (const tgt of buildTargets(s, p)) {
    let missing = 0;
    for (const r of RESOURCES) missing += Math.max(0, (tgt.cost[r] ?? 0) - hand[r]);
    best = Math.max(best, tgt.value * (missing === 0 ? W.ready : W.close / (1 + missing) ** 1.2));
  }
  v += best;
  const cards = handSize(pl);
  v += Math.min(cards, 7) * W.card;
  const over = Math.max(0, cards - handLimit(s, p));
  v -= over * W.over;

  // road and army races
  const lr = longestRoadFor(s, p);
  if (s.longestRoad.owner !== p && lr >= 3) v += (lr - 2) * W.road;
  if (s.mode !== 'guilds') {
    v += [...pl.dev, ...pl.newDev].filter((x) => x !== 'monument').length * W.dev;
    if (s.strongestGuard.owner !== p && pl.guards >= 1) v += pl.guards * W.army;
  }

  // Guildlands extras
  if (s.mode === 'guilds' && pl.levels && pl.goods) {
    v += GOODS.reduce((a, g) => a + pl.goods![g], 0) * 7;
    for (const tr of TRACKS) {
      const lvl = pl.levels[tr];
      v += lvl * 11 + (lvl >= 3 ? 18 : 0);
      // close to a free (or takeable) metropolis
      const holder = s.metropolis?.[tr];
      if (lvl === 3 && (holder === null || holder === undefined)) v += 20;
    }
    v += (pl.progress?.length ?? 0) * 14;
    // knights: total strength, plus barbarian defence when the ship is near
    const mine = Object.values(s.knights ?? {}).filter((k) => k.owner === p);
    v += mine.reduce((a, k) => a + k.level, 0) * 6;
    const danger = ((s.barbarians ?? 0) / BARBARIAN_STEPS) ** 2;
    if (danger > 0) {
      const contrib = s.players.map((_, i) => knightStrength(s, i));
      const def = contrib.reduce((a, b) => a + b, 0);
      const myC = contrib[p];
      const exposed = ownCities(s, p).some((x) => !s.buildings[x].metro);
      if (def < barbarianStrength(s) && exposed && myC <= Math.min(...contrib)) v -= 75 * danger;
      if (myC > 0 && myC >= Math.max(...contrib)) v += 50 * danger;
      v += myC * 10 * danger;
    }
  }
  return v;
}

// ------------------------------------------------------------------- simulation

/** a light copy of the state for trying moves (logs and history aren't needed) */
function lite(s: GameState): GameState {
  return { ...s, log: [], chat: undefined, stats: undefined, production: undefined, fx: undefined };
}

function tryAction(s: GameState, p: number, a: Action): GameState | null {
  const r = applyAction(s, p, a, () => 0.5);
  return r.ok ? r.state : null;
}

function bestOf(s: GameState, p: number, cands: Action[], level: BotLevel, rng: () => number): { a: Action; gain: number } | null {
  const base = lite(s);
  const c = ctxFor(base);
  const v0 = evaluate(base, p, c);
  const scored: { a: Action; gain: number }[] = [];
  for (const a of cands) {
    const next = tryAction(base, p, a);
    if (!next) continue;
    scored.push({ a, gain: evaluate(next, p, c) - v0 });
  }
  if (!scored.length) return null;
  scored.sort((x, y) => y.gain - x.gain);
  // easy bots often pick a worse (but still positive) move, normal bots now and then
  const slip = level === 'easy' ? 0.45 : level === 'normal' ? 0.35 : 0;
  if (rng() < slip) {
    const ok = scored.filter((x) => x.gain > 0).slice(0, level === 'normal' ? 4 : undefined);
    if (ok.length) return ok[Math.floor(rng() * ok.length)];
  }
  return scored[0];
}

// --------------------------------------------------------------------- choices

/** the resource the player is shortest of for its most valuable build */
function mostNeeded(s: GameState, p: number): Resource {
  const hand = s.players[p].hand;
  let bestR: Resource = 'grain', bestScore = -1;
  for (const t of buildTargets(s, p)) {
    for (const r of RESOURCES) {
      const miss = (t.cost[r] ?? 0) - hand[r];
      if (miss > 0 && t.value / miss > bestScore) {
        bestScore = t.value / miss;
        bestR = r;
      }
    }
  }
  if (bestScore < 0) {
    const prod = productionByRes(s, p);
    bestR = RESOURCES.reduce((a, b) => (prod[b] < prod[a] ? b : a));
  }
  return bestR;
}

function leader(s: GameState, p: number): number {
  const others = s.players.map((_, i) => i).filter((i) => i !== p);
  return others.reduce((a, b) => (victoryPoints(s, b, false) > victoryPoints(s, a, false) ? b : a), others[0]);
}

/** the best tile for the robber: hurts the strongest opponents most, never ourselves */
function bestRaiderHex(s: GameState, p: number): number {
  const vps = s.players.map((_, i) => victoryPoints(s, i, false));
  let best = validRaiderHexes(s)[0], bestScore = -1e9;
  for (const hi of validRaiderHexes(s)) {
    const h = s.hexes[hi];
    const pips = PIPS(h.number);
    let score = 0;
    for (const v of GEO.hexVertices[hi]) {
      const b = s.buildings[v];
      if (!b) continue;
      const m = b.kind === 'city' ? 2 : 1;
      if (b.owner === p) score -= pips * m * 4;
      else score += pips * m * (1 + vps[b.owner] / 4) + (handSize(s.players[b.owner]) > 0 ? 1.5 : 0);
    }
    if (score > bestScore) {
      bestScore = score;
      best = hi;
    }
  }
  return best;
}

function discardChoice(s: GameState, p: number, need: number): Action {
  const pl = s.players[p];
  const hand: Record<string, number> = { ...pl.hand, ...(pl.goods ?? {}) };
  const out: Record<string, number> = {};
  const keepValue = (k: string) => {
    // goods and scarce/needed resources are kept longest
    if ((GOODS as readonly string[]).includes(k)) return 6;
    const r = k as Resource;
    let need2 = 0;
    for (const t of buildTargets(s, p)) need2 = Math.max(need2, (t.cost[r] ?? 0) > 0 ? t.value / 40 : 0);
    return need2 + resourceWeights(s)[r] - hand[k] * 0.6;
  };
  for (let i = 0; i < need; i++) {
    const k = Object.keys(hand).filter((x) => hand[x] > 0).sort((a, b) => keepValue(a) - keepValue(b))[0];
    hand[k]--;
    out[k] = (out[k] ?? 0) + 1;
  }
  const cards: Partial<ResMap> = {}, goods: Record<string, number> = {};
  for (const [k, n] of Object.entries(out)) ((GOODS as readonly string[]).includes(k) ? (goods[k] = n) : (cards[k as Resource] = n));
  return { type: 'discard', cards, goods };
}

/** setup: best corner, the second one chosen to complement the first */
function setupSettlement(s: GameState, p: number): Action {
  const w = resourceWeights(s);
  const have = productionByRes(s, p);
  const spots = validSettlementSpots(s, p);
  const second = Object.values(s.buildings).some((b) => b.owner === p);
  let best = spots[0], bestScore = -1;
  for (const v of spots) {
    let sc = spotScore(s, p, v, w, have);
    if (second) {
      // fill gaps: resources we don't have yet
      for (const hi of GEO.vertices[v].hexes) {
        const h = s.hexes[hi];
        if (h.type !== 'desert' && have[h.type] === 0) sc += PIPS(h.number) * 0.6;
      }
    }
    if (sc > bestScore) {
      bestScore = sc;
      best = v;
    }
  }
  return { type: 'buildSettlement', vertex: best };
}

/** a road towards the best corner that will be settleable next */
function bestRoad(s: GameState, p: number): Action | null {
  const roads = validRoadSpots(s, p);
  if (!roads.length) return null;
  const w = resourceWeights(s);
  const have = productionByRes(s, p);
  const free = (v: number) => !s.buildings[v] && !s.knights?.[v] && GEO.vertices[v].neighbors.every((n) => !s.buildings[n]);
  let best = roads[0], bestScore = -1e9;
  for (const e of roads) {
    const ed = GEO.edges[e];
    let sc = 0;
    for (const end of [ed.a, ed.b]) {
      if (s.buildings[end]?.owner === p) continue;
      if (free(end)) sc = Math.max(sc, spotScore(s, p, end, w, have) * 1.2);
      for (const n of GEO.vertices[end].neighbors) if (free(n)) sc = Math.max(sc, spotScore(s, p, n, w, have) * 0.75);
    }
    sc += Math.random() * 0.01;
    if (sc > bestScore) {
      bestScore = sc;
      best = e;
    }
  }
  return { type: 'buildRoad', edge: best };
}

/** Guildlands: pick the dice that pay us most and our rivals least */
function bestDice(s: GameState, p: number): [number, number] {
  let bestSum = 8, bestScore = -1e9;
  const vps = s.players.map((_, i) => victoryPoints(s, i, false));
  for (let sum = 2; sum <= 12; sum++) {
    if (sum === 7) continue;
    let sc = 0;
    for (const h of s.hexes) {
      if (h.number !== sum || h.id === s.raider) continue;
      for (const v of GEO.hexVertices[h.id]) {
        const b = s.buildings[v];
        if (!b) continue;
        const m = b.kind === 'city' ? 2 : 1;
        sc += b.owner === p ? m * 3 : -m * (0.6 + vps[b.owner] / 10);
      }
    }
    if (sc > bestScore) {
      bestScore = sc;
      bestSum = sum;
    }
  }
  const red = Math.max(1, bestSum - 6); // a low red die also helps progress-card draws
  return [red, bestSum - red];
}

// ---------------------------------------------------------------------- plans

/**
 * Builds we can't afford yet but could after a few bank/harbour trades of spare cards.
 * Each plan is the list of trades followed by the build.
 */
function tradePlans(s: GameState, p: number, maxTrades: number): Action[][] {
  const pl = s.players[p];
  const rates = tradeRates(s, p);
  const builds: { what: keyof typeof COSTS; acts: Action[] }[] = [];
  const add = (what: keyof typeof COSTS, acts: Action[]) => acts.length && builds.push({ what, acts });
  if (pl.citiesLeft > 0) add('city', validCitySpots(s, p).map((v) => ({ type: 'buildCity', vertex: v })));
  if (pl.settlementsLeft > 0) add('settlement', validSettlementSpots(s, p).map((v) => ({ type: 'buildSettlement', vertex: v })));
  if (pl.roadsLeft > 0) add('road', validRoadSpots(s, p).map((e) => ({ type: 'buildRoad', edge: e })));
  if (s.mode !== 'guilds' && s.devDeck.length) add('dev', [{ type: 'buyDev' }]);
  if (s.mode === 'guilds') {
    add('wall', validWallSpots(s, p).map((v) => ({ type: 'buildWall', vertex: v })));
    add('knight', validKnightSpots(s, p).slice(0, 6).map((v) => ({ type: 'buildKnight', vertex: v })));
  }
  const plans: Action[][] = [];
  for (const b of builds) {
    const cost = COSTS[b.what] as Partial<ResMap>;
    if (canAfford(s, p, b.what)) continue;
    const hand = { ...pl.hand };
    const trades: Action[] = [];
    let ok = true;
    for (const r of RESOURCES) {
      while (hand[r] < (cost[r] ?? 0)) {
        // pay with the spare resource that is cheapest to give away
        const give = RESOURCES.filter((g) => g !== r && hand[g] - (cost[g] ?? 0) >= rates[g]).sort((a, b) => rates[a] - rates[b] || hand[b] - hand[a])[0];
        if (!give || trades.length >= maxTrades) { ok = false; break; }
        hand[give] -= rates[give];
        hand[r]++;
        trades.push({ type: 'bankTrade', give, get: r });
      }
      if (!ok) break;
    }
    if (!ok || !trades.length) continue;
    for (const a of b.acts) plans.push([...trades, a]);
  }
  return plans;
}

function runPlan(s: GameState, p: number, plan: Action[]): GameState | null {
  let cur: GameState | null = s;
  for (const a of plan) {
    cur = tryAction(cur, p, a);
    if (!cur) return null;
  }
  return cur;
}

// ------------------------------------------------------------- candidate moves

function actionCandidates(s: GameState, p: number, level: BotLevel): Action[] {
  const pl = s.players[p];
  const out: Action[] = [];
  if (canAfford(s, p, 'city') && pl.citiesLeft > 0) for (const v of validCitySpots(s, p)) out.push({ type: 'buildCity', vertex: v });
  if (canAfford(s, p, 'settlement') && pl.settlementsLeft > 0) for (const v of validSettlementSpots(s, p)) out.push({ type: 'buildSettlement', vertex: v });
  if (canAfford(s, p, 'road') && pl.roadsLeft > 0) for (const e of validRoadSpots(s, p)) out.push({ type: 'buildRoad', edge: e });
  if (s.mode !== 'guilds' && canAfford(s, p, 'dev') && s.devDeck.length) out.push({ type: 'buyDev' });
  // fortune cards (base game)
  if (s.mode !== 'guilds' && !s.devPlayedThisTurn) {
    for (const card of new Set(pl.dev)) {
      if (card === 'monument') continue;
      if (card === 'harvest') {
        const r1 = mostNeeded(s, p);
        const tmp = structuredClone(s);
        tmp.players[p].hand[r1]++;
        out.push({ type: 'playDev', card, res: [r1, mostNeeded(tmp, p)] });
      } else if (card === 'embargo') {
        const counts = RESOURCES.map((r) => ({ r, n: s.players.reduce((a, o, i) => a + (i === p ? 0 : o.hand[r]), 0) }));
        counts.sort((a, b) => b.n - a.n);
        if (counts[0].n >= 2) out.push({ type: 'playDev', card, res: [counts[0].r] });
      } else out.push({ type: 'playDev', card: card as DevCard });
    }
  }
  // bank and harbour trades
  const rates = tradeRates(s, p);
  for (const g of RESOURCES) if (pl.hand[g] >= rates[g]) for (const r of RESOURCES) if (r !== g) out.push({ type: 'bankTrade', give: g, get: r });
  if (s.mode === 'guilds' && pl.goods && pl.levels) {
    const gr = goodsRate(s, p);
    for (const g of GOODS) if (pl.goods[g] >= gr) for (const r of RESOURCES) out.push({ type: 'bankTrade', give: g, get: r });
    for (const tr of TRACKS) if (pl.levels[tr] < 5 && pl.goods[TRACK_INFO[tr].good] >= improveCost(pl.levels[tr])) out.push({ type: 'improve', track: tr });
    if (canAfford(s, p, 'wall')) for (const v of validWallSpots(s, p)) out.push({ type: 'buildWall', vertex: v });
    if (canAfford(s, p, 'knight')) for (const v of validKnightSpots(s, p).slice(0, 12)) out.push({ type: 'buildKnight', vertex: v });
    const mine = Object.entries(s.knights ?? {}).filter(([, k]) => k.owner === p);
    if (canAfford(s, p, 'activate')) for (const [v, k] of mine) if (!k.active) out.push({ type: 'activateKnight', vertex: Number(v) });
    if (canAfford(s, p, 'promote')) for (const [v] of mine) out.push({ type: 'promoteKnight', vertex: Number(v) });
    for (const v of readyKnights(s, p)) {
      if (s.barbarianAttacked && GEO.hexVertices[s.raider].includes(v)) {
        const own = GEO.hexVertices[s.raider].some((x) => s.buildings[x]?.owner === p);
        if (own) out.push({ type: 'chaseRaider', vertex: v });
      }
      // displace weaker enemy knights that block us
      for (const to of knightMoves(s, v)) if (s.knights?.[to]) out.push({ type: 'moveKnight', from: v, to });
    }
    for (const card of new Set(pl.progress ?? [])) out.push(...progressChoices(s, p, card));
  }
  void level;
  return out;
}

function progressChoices(s: GameState, p: number, card: ProgressCard): Action[] {
  const need = PROGRESS[card].need;
  const base = { type: 'playProgress' as const, card };
  switch (need) {
    case 'none': return card === 'weightedDice' ? [] : [base];
    case 'good': return GOODS.map((g) => ({ ...base, good: g }));
    case 'res': return [{ ...base, res: mostNeeded(s, p) }];
    case 'player': return [{ ...base, target: leader(s, p) }];
    case 'knight': return Object.entries(s.knights ?? {}).filter(([, k]) => k.owner === p).map(([v]) => ({ ...base, vertex: Number(v) }));
    case 'city': return validWallSpots(s, p).map((v) => ({ ...base, vertex: v }));
    case 'spot': return validKnightSpots(s, p).slice(0, 8).map((v) => ({ ...base, vertex: v }));
    default: return [];
  }
}

// ---------------------------------------------------------------- player trades

/** a 1-for-1 offer to the table when one card is missing for a valuable build */
function tradeOffer(s: GameState, p: number): Action | null {
  const hand = s.players[p].hand;
  for (const t of buildTargets(s, p).sort((a, b) => b.value - a.value)) {
    if (t.value < 40) continue;
    const missing = RESOURCES.filter((r) => (t.cost[r] ?? 0) > hand[r]);
    const shortBy = missing.reduce((a, r) => a + (t.cost[r] ?? 0) - hand[r], 0);
    if (shortBy !== 1) continue;
    const spare = RESOURCES.filter((r) => hand[r] > (t.cost[r] ?? 0)).sort((a, b) => hand[b] - hand[a]);
    if (!spare.length) continue;
    return { type: 'offerTrade', give: { [spare[0]]: 1 }, get: { [missing[0]]: 1 } };
  }
  return null;
}

/** answer someone else's offer */
function answerTrade(s: GameState, p: number, level: BotLevel): Action {
  const t = s.trade!;
  const fromVp = victoryPoints(s, t.from, false);
  // never feed someone who is about to win (hard and normal bots)
  if (level !== 'easy' && fromVp >= winPoints(s) - 2) return { type: 'declineTrade', id: t.id };
  const next = tryAction(lite(s), p, { type: 'acceptTrade', id: t.id });
  if (!next) return { type: 'declineTrade', id: t.id };
  const c = ctxFor(s);
  const gain = evaluate(next, p, c) - evaluate(lite(s), p, c);
  // a hard bot also wants the deal to help itself more than the leader
  const margin = level === 'hard' ? 4 + (fromVp >= winPoints(s) - 4 ? 8 : 0) : 1;
  return gain > margin ? { type: 'acceptTrade', id: t.id } : { type: 'declineTrade', id: t.id };
}

// ------------------------------------------------------------------- main entry

const offeredOnTurn = new Map<number, number>();

/**
 * The next action for bot seat `p`, or null if it has nothing to do right now.
 * `ownOfferAge` (ms) lets the host withdraw a bot's offer nobody answered.
 */
export function decide(s: GameState, p: number, level: BotLevel, rng: () => number = Math.random, ownOfferAge = 0): Action | null {
  if (s.phase === 'ended') return null;
  const pl = s.players[p];
  if (!pl) return null;

  if (s.phase === 'order') {
    const round = s.orderRounds?.[s.orderRounds.length - 1] ?? [];
    return s.orderContenders?.includes(p) && !round.some((r) => r.p === p) ? { type: 'orderRoll' } : null;
  }
  if (s.stage === 'discard' && s.pendingDiscards[p]) return discardChoice(s, p, s.pendingDiscards[p]);
  if (s.aqueduct?.includes(p)) return { type: 'aqueduct', res: mostNeeded(s, p) };
  if (s.trade && s.trade.from !== p && !s.trade.declined.includes(p)) return answerTrade(s, p, level);
  if (s.current !== p) return null;

  if (s.phase === 'setup') {
    if (s.setupNeed === 'settlement') return setupSettlement(s, p);
    return bestRoad(s, p) ?? { type: 'endTurn' };
  }

  switch (s.stage) {
    case 'roll': {
      // before rolling: choose the dice, or send a knight away from our own tile
      if (s.mode === 'guilds' && pl.progress?.includes('weightedDice') && level !== 'easy') return { type: 'playProgress', card: 'weightedDice', dice: bestDice(s, p) };
      if (s.mode !== 'guilds' && !s.devPlayedThisTurn && pl.dev.includes('guard')) {
        const blocked = GEO.hexVertices[s.raider].some((v) => s.buildings[v]?.owner === p);
        const armyRace = pl.guards >= 2 && s.strongestGuard.owner !== p;
        if (blocked || armyRace) return { type: 'playDev', card: 'guard' };
      }
      return { type: 'roll' };
    }
    case 'moveRaider': return { type: 'moveRaider', hex: level === 'easy' && rng() < 0.4 ? validRaiderHexes(s)[Math.floor(rng() * validRaiderHexes(s).length)] : bestRaiderHex(s, p) };
    case 'steal': {
      const vps = s.stealFrom.map((i) => victoryPoints(s, i, false) * 10 + handSize(s.players[i]));
      return { type: 'steal', target: s.stealFrom[vps.indexOf(Math.max(...vps))] };
    }
    case 'roadworks': return bestRoad(s, p) ?? { type: 'endTurn' };
  }
  if (s.stage !== 'actions') return null;

  // our own offer is waiting for answers
  if (s.trade && s.trade.from === p) {
    const counter = s.trade.counters?.find((c) => tryAction(lite(s), p, { type: 'acceptCounter', id: s.trade!.id, p: c.p }));
    if (counter) {
      const c = ctxFor(s);
      const next = tryAction(lite(s), p, { type: 'acceptCounter', id: s.trade.id, p: counter.p })!;
      if (evaluate(next, p, c) > evaluate(lite(s), p, c)) return { type: 'acceptCounter', id: s.trade.id, p: counter.p };
    }
    const everyoneSaidNo = s.trade.declined.length >= s.players.length - 1;
    return everyoneSaidNo || ownOfferAge > 6000 ? { type: 'cancelTrade' } : null;
  }

  const best = bestOf(s, p, actionCandidates(s, p, level), level, rng);
  // compare with trading towards a build (hard bots look further ahead)
  const maxTrades = level === 'hard' ? 4 : level === 'normal' ? 2 : 1;
  const base = lite(s);
  const c = ctxFor(base);
  const v0 = evaluate(base, p, c);
  let plan: { a: Action; gain: number } | null = null;
  for (const pl of tradePlans(base, p, maxTrades)) {
    const end = runPlan(base, p, pl);
    if (!end) continue;
    const gain = evaluate(end, p, c) - v0;
    if (!plan || gain > plan.gain) plan = { a: pl[0], gain };
  }
  const threshold = level === 'easy' ? 2 : 0.5;
  if (plan && plan.gain > threshold && (!best || plan.gain > best.gain)) return plan.a;
  if (best && best.gain > threshold) return best.a;

  // nothing good to do alone: try a trade with the table once per turn
  if (level !== 'easy' && offeredOnTurn.get(p) !== s.turnNumber) {
    offeredOnTurn.set(p, s.turnNumber);
    const offer = tradeOffer(s, p);
    if (offer) return offer;
  }
  return { type: 'endTurn' };
}

/** something always legal to keep the game moving if a chosen move is refused */
export function fallback(s: GameState, p: number): Action | null {
  if (s.phase === 'order') return { type: 'orderRoll' };
  if (s.stage === 'discard' && s.pendingDiscards[p]) return discardChoice(s, p, s.pendingDiscards[p]);
  if (s.aqueduct?.includes(p)) return { type: 'aqueduct', res: 'grain' };
  if (s.trade && s.trade.from !== p) return { type: 'declineTrade', id: s.trade.id };
  if (s.current !== p) return null;
  if (s.phase === 'setup') return s.setupNeed === 'settlement' ? { type: 'buildSettlement', vertex: validSettlementSpots(s, p)[0] } : { type: 'buildRoad', edge: validRoadSpots(s, p)[0] };
  switch (s.stage) {
    case 'roll': return { type: 'roll' };
    case 'moveRaider': return { type: 'moveRaider', hex: validRaiderHexes(s)[0] };
    case 'steal': return { type: 'steal', target: s.stealFrom[0] };
    case 'roadworks': { const e = validRoadSpots(s, p)[0]; return e === undefined ? null : { type: 'buildRoad', edge: e }; }
  }
  if (s.trade && s.trade.from === p) return { type: 'cancelTrade' };
  return { type: 'endTurn' };
}

export const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dorian', 'Esme', 'Felix', 'Greta', 'Hugo'];
export const totalCards = (s: GameState, p: number) => totalRes(s.players[p].hand);
