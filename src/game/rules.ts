import { DEV_DECK, GEO, Rng, generateBoard, shuffle } from './board';
import {
  Action, COSTS, DEV_INFO, GameState, PLAYER_COLORS, Player, RESOURCES, RES_INFO, ResMap,
  Resource, WIN_POINTS, emptyRes, totalRes,
} from './types';

// ------------------------------------------------------------------ setup

export function createGame(names: string[], rng: Rng = Math.random): GameState {
  const board = generateBoard(rng);
  const players: Player[] = names.map((name, i) => ({
    name, color: PLAYER_COLORS[i], hand: emptyRes(), dev: [], newDev: [], guards: 0,
    roadsLeft: 15, settlementsLeft: 5, citiesLeft: 4, connected: true,
  }));
  const n = players.length;
  const forward = [...Array(n).keys()];
  const bank = emptyRes();
  RESOURCES.forEach((r) => (bank[r] = 19));
  return {
    phase: 'setup', players, current: 0,
    setupOrder: [...forward, ...forward.slice().reverse()], setupIndex: 0,
    setupNeed: 'settlement', lastSetupVertex: null,
    stage: 'actions', afterRaider: 'actions', pendingDiscards: {}, stealFrom: [], roadworksLeft: 0,
    dice: null, hexes: board.hexes, ports: board.ports, raider: board.raider,
    buildings: {}, roads: {}, devDeck: shuffle(DEV_DECK(), rng), devPlayedThisTurn: false,
    longestRoad: { owner: null, length: 0 }, strongestGuard: { owner: null, size: 0 },
    trade: null, tradeSeq: 0, bank, log: ['The island has been discovered. Place your first settlements!'],
    winner: null, turnNumber: 0,
  };
}

// ---------------------------------------------------------------- queries

const has = (hand: ResMap, cost: Partial<ResMap>) => RESOURCES.every((r) => hand[r] >= (cost[r] ?? 0));
export const canAfford = (s: GameState, p: number, what: keyof typeof COSTS) => has(s.players[p].hand, COSTS[what]);

function vertexFree(s: GameState, v: number) {
  return !s.buildings[v] && GEO.vertices[v].neighbors.every((n) => !s.buildings[n]);
}

/** can player `p` extend a road through vertex v (not blocked by an opponent building)? */
function vertexPassable(s: GameState, p: number, v: number) {
  const b = s.buildings[v];
  return !b || b.owner === p;
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
  for (const b of Object.values(s.buildings)) if (b.owner === p) vp += b.kind === 'city' ? 2 : 1;
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
  RESOURCES.filter((k) => (r[k] ?? 0) > 0).map((k) => `${r[k]} ${RES_INFO[k].icon}`).join(' ') || 'nothing';

function pay(s: GameState, p: number, cost: Partial<ResMap>) {
  for (const r of RESOURCES) {
    const n = cost[r] ?? 0;
    s.players[p].hand[r] -= n;
    s.bank[r] += n;
  }
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
  if (s.longestRoad.owner !== prev && s.longestRoad.owner !== null)
    log(s, `🛣️ ${s.players[s.longestRoad.owner].name} now holds the Longest Road (${max}).`);
}

function checkWin(s: GameState) {
  const p = s.current;
  if (victoryPoints(s, p) >= WIN_POINTS) {
    s.phase = 'ended';
    s.winner = p;
    log(s, `🏆 ${s.players[p].name} wins with ${victoryPoints(s, p)} points!`);
  }
}

function produce(s: GameState, roll: number) {
  const gains = s.players.map(() => emptyRes());
  s.hexes.forEach((h) => {
    if (h.number !== roll || h.id === s.raider || h.type === 'desert') return;
    for (const v of GEO.hexVertices[h.id]) {
      const b = s.buildings[v];
      if (b) gains[b.owner][h.type] += b.kind === 'city' ? 2 : 1;
    }
  });
  for (const r of RESOURCES) {
    const demand = gains.reduce((t, g) => t + g[r], 0);
    const takers = gains.filter((g) => g[r] > 0).length;
    if (demand > s.bank[r]) {
      if (takers > 1) {
        gains.forEach((g) => (g[r] = 0));
        log(s, `The bank ran out of ${RES_INFO[r].label} – nobody receives any.`);
      } else gains.forEach((g) => (g[r] = Math.min(g[r], s.bank[r])));
    }
  }
  gains.forEach((g, i) => {
    if (totalRes(g) === 0) return;
    RESOURCES.forEach((r) => {
      s.players[i].hand[r] += g[r];
      s.bank[r] -= g[r];
    });
    log(s, `${s.players[i].name} receives ${fmtRes(g)}`);
  });
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
    log(s, `Setup complete. ${s.players[0].name}, roll the dice!`);
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
  if (s.phase === 'ended') return 'The game is over.';
  const me = s.players[p];
  if (!me) return 'Unknown player.';
  const isTurn = p === s.current;

  // actions that may be taken out of turn
  if (a.type === 'discard') {
    if (s.stage !== 'discard' || !s.pendingDiscards[p]) return 'You do not need to discard.';
    const need = s.pendingDiscards[p];
    if (totalRes(a.cards) !== need) return `You must discard exactly ${need} cards.`;
    if (!has(me.hand, a.cards) || RESOURCES.some((r) => (a.cards[r] ?? 0) < 0)) return 'Invalid cards.';
    pay(s, p, a.cards);
    delete s.pendingDiscards[p];
    log(s, `${me.name} discards ${need} cards.`);
    if (Object.keys(s.pendingDiscards).length === 0) s.stage = 'moveRaider';
    return;
  }
  if (a.type === 'acceptTrade' || a.type === 'declineTrade') {
    const t = s.trade;
    if (!t || t.id !== a.id) return 'That offer is no longer available.';
    if (t.from === p) return 'You cannot respond to your own offer.';
    if (a.type === 'declineTrade') {
      if (!t.declined.includes(p)) t.declined.push(p);
      return;
    }
    const from = s.players[t.from];
    if (!has(me.hand, t.get)) return 'You do not have the requested cards.';
    if (!has(from.hand, t.give)) return `${from.name} no longer has those cards.`;
    for (const r of RESOURCES) {
      const g = t.give[r] ?? 0, w = t.get[r] ?? 0;
      from.hand[r] += w - g;
      me.hand[r] += g - w;
    }
    log(s, `🤝 ${from.name} traded ${fmtRes(t.give)} to ${me.name} for ${fmtRes(t.get)}`);
    s.trade = null;
    return;
  }

  if (!isTurn) return 'It is not your turn.';

  // ------------------------------------------------------------- setup phase
  if (s.phase === 'setup') {
    if (a.type === 'buildSettlement' && s.setupNeed === 'settlement') {
      if (!validSettlementSpots(s, p).includes(a.vertex)) return 'You cannot settle there.';
      s.buildings[a.vertex] = { owner: p, kind: 'settlement' };
      me.settlementsLeft--;
      s.lastSetupVertex = a.vertex;
      s.setupNeed = 'road';
      if (s.setupIndex >= s.players.length) {
        const g = emptyRes();
        for (const h of GEO.vertices[a.vertex].hexes) {
          const t = s.hexes[h].type;
          if (t !== 'desert') g[t]++;
        }
        RESOURCES.forEach((r) => { me.hand[r] += g[r]; s.bank[r] -= g[r]; });
        log(s, `${me.name} founds a settlement and gathers ${fmtRes(g)}`);
      } else log(s, `${me.name} founds a settlement.`);
      return;
    }
    if (a.type === 'buildRoad' && s.setupNeed === 'road') {
      if (!validRoadSpots(s, p).includes(a.edge)) return 'The road must touch your new settlement.';
      s.roads[a.edge] = p;
      me.roadsLeft--;
      nextSetup(s);
      return;
    }
    return `Place a ${s.setupNeed} first.`;
  }

  // -------------------------------------------------------------- main phase
  switch (a.type) {
    case 'roll': {
      if (s.stage !== 'roll') return 'You already rolled.';
      const d: [number, number] = [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
      s.dice = d;
      const sum = d[0] + d[1];
      log(s, `🎲 ${me.name} rolls ${sum}`);
      if (sum === 7) {
        s.pendingDiscards = {};
        s.players.forEach((pl, i) => {
          const n = totalRes(pl.hand);
          if (n > 7) s.pendingDiscards[i] = Math.floor(n / 2);
        });
        log(s, '🌩️ The Raider stirs!');
        s.afterRaider = 'actions';
        s.stage = Object.keys(s.pendingDiscards).length ? 'discard' : 'moveRaider';
      } else {
        produce(s, sum);
        s.stage = 'actions';
      }
      return;
    }
    case 'moveRaider': {
      if (s.stage !== 'moveRaider') return 'You cannot move the Raider now.';
      if (!validRaiderHexes(s).includes(a.hex)) return 'Choose a different tile.';
      s.raider = a.hex;
      log(s, `${me.name} moves the Raider.`);
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
      if (s.stage !== 'steal' || !s.stealFrom.includes(a.target)) return 'Invalid target.';
      stealCard(s, p, a.target, rng);
      s.stealFrom = [];
      s.stage = s.afterRaider;
      return;
    }
    case 'buildRoad': {
      const free = s.stage === 'roadworks';
      if (s.stage !== 'actions' && !free) return 'You cannot build now.';
      if (me.roadsLeft <= 0) return 'No roads left.';
      if (!free && !canAfford(s, p, 'road')) return 'Not enough resources.';
      if (!validRoadSpots(s, p).includes(a.edge)) return 'You cannot build a road there.';
      if (!free) pay(s, p, COSTS.road);
      s.roads[a.edge] = p;
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
      if (s.stage !== 'actions') return 'You cannot build now.';
      if (me.settlementsLeft <= 0) return 'No settlements left.';
      if (!canAfford(s, p, 'settlement')) return 'Not enough resources.';
      if (!validSettlementSpots(s, p).includes(a.vertex)) return 'You cannot settle there.';
      pay(s, p, COSTS.settlement);
      s.buildings[a.vertex] = { owner: p, kind: 'settlement' };
      me.settlementsLeft--;
      log(s, `🏠 ${me.name} builds a settlement.`);
      updateLongestRoad(s); // may break an opponent's road
      checkWin(s);
      return;
    }
    case 'buildCity': {
      if (s.stage !== 'actions') return 'You cannot build now.';
      if (me.citiesLeft <= 0) return 'No cities left.';
      if (!canAfford(s, p, 'city')) return 'Not enough resources.';
      if (!validCitySpots(s, p).includes(a.vertex)) return 'Upgrade one of your settlements.';
      pay(s, p, COSTS.city);
      s.buildings[a.vertex] = { owner: p, kind: 'city' };
      me.citiesLeft--;
      me.settlementsLeft++;
      log(s, `🏰 ${me.name} upgrades to a city.`);
      checkWin(s);
      return;
    }
    case 'buyDev': {
      if (s.stage !== 'actions') return 'You cannot buy now.';
      if (!s.devDeck.length) return 'The fortune deck is empty.';
      if (!canAfford(s, p, 'dev')) return 'Not enough resources.';
      pay(s, p, COSTS.dev);
      me.newDev.push(s.devDeck.pop()!);
      log(s, `🃏 ${me.name} buys a fortune card.`);
      checkWin(s);
      return;
    }
    case 'playDev': {
      if (s.devPlayedThisTurn) return 'Only one fortune card per turn.';
      if (a.card === 'monument') return 'Monuments score automatically.';
      if (!(s.stage === 'actions' || (s.stage === 'roll' && a.card === 'guard'))) return 'You cannot play that now.';
      const idx = me.dev.indexOf(a.card);
      if (idx < 0) return 'You do not have a playable card of that kind.';
      if (a.card === 'harvest') {
        const res = a.res ?? [];
        if (res.length !== 2 || res.some((r) => !RESOURCES.includes(r))) return 'Pick 2 resources.';
        const need = emptyRes();
        res.forEach((r) => need[r]++);
        if (!has(s.bank, need)) return 'The bank does not have those.';
        res.forEach((r) => { me.hand[r]++; s.bank[r]--; });
        log(s, `${DEV_INFO.harvest.icon} ${me.name} plays Harvest: ${fmtRes(need)}`);
      } else if (a.card === 'embargo') {
        const r = a.res?.[0];
        if (!r || !RESOURCES.includes(r)) return 'Pick a resource.';
        let got = 0;
        s.players.forEach((pl, i) => {
          if (i === p) return;
          got += pl.hand[r];
          pl.hand[r] = 0;
        });
        me.hand[r] += got;
        log(s, `${DEV_INFO.embargo.icon} ${me.name} plays Embargo on ${RES_INFO[r].label} and collects ${got}.`);
      } else if (a.card === 'roadworks') {
        if (me.roadsLeft <= 0 || validRoadSpots(s, p).length === 0) return 'Nowhere to build roads.';
        s.roadworksLeft = 2;
        s.afterRaider = 'actions';
        s.stage = 'roadworks';
        log(s, `${DEV_INFO.roadworks.icon} ${me.name} plays Roadworks.`);
      } else if (a.card === 'guard') {
        me.guards++;
        log(s, `${DEV_INFO.guard.icon} ${me.name} sends a Guard.`);
        if (me.guards >= 3 && me.guards > s.strongestGuard.size) {
          if (s.strongestGuard.owner !== p) log(s, `⚔️ ${me.name} now has the Strongest Guard.`);
          s.strongestGuard = { owner: p, size: me.guards };
        }
        startRaider(s, s.stage === 'roll' ? 'roll' : 'actions');
      }
      me.dev.splice(idx, 1);
      s.devPlayedThisTurn = true;
      checkWin(s);
      return;
    }
    case 'bankTrade': {
      if (s.stage !== 'actions') return 'You cannot trade now.';
      if (a.give === a.get) return 'Pick two different resources.';
      const rate = tradeRates(s, p)[a.give];
      if (me.hand[a.give] < rate) return `You need ${rate} ${RES_INFO[a.give].label}.`;
      if (s.bank[a.get] < 1) return 'The bank is out of that resource.';
      me.hand[a.give] -= rate;
      s.bank[a.give] += rate;
      me.hand[a.get]++;
      s.bank[a.get]--;
      log(s, `${me.name} trades ${rate} ${RES_INFO[a.give].icon} with the bank for 1 ${RES_INFO[a.get].icon}`);
      return;
    }
    case 'offerTrade': {
      if (s.stage !== 'actions') return 'You cannot trade now.';
      const neg = RESOURCES.some((r) => (a.give[r] ?? 0) < 0 || (a.get[r] ?? 0) < 0);
      if (neg || totalRes(a.give) === 0 || totalRes(a.get) === 0) return 'Offer something and ask for something.';
      if (!has(me.hand, a.give)) return 'You do not have those cards.';
      s.trade = { id: ++s.tradeSeq, from: p, give: a.give, get: a.get, declined: [] };
      log(s, `${me.name} offers ${fmtRes(a.give)} for ${fmtRes(a.get)}`);
      return;
    }
    case 'cancelTrade': {
      s.trade = null;
      return;
    }
    case 'endTurn': {
      if (s.stage !== 'actions') return 'Finish your current step first.';
      me.dev.push(...me.newDev);
      me.newDev = [];
      s.trade = null;
      s.devPlayedThisTurn = false;
      s.dice = null;
      s.current = (s.current + 1) % s.players.length;
      s.stage = 'roll';
      s.turnNumber++;
      log(s, `— ${s.players[s.current].name}'s turn —`);
      return;
    }
  }
  return 'Unknown action.';
}

function stealCard(s: GameState, p: number, target: number, rng: Rng) {
  const victim = s.players[target];
  const pool: Resource[] = [];
  RESOURCES.forEach((r) => { for (let i = 0; i < victim.hand[r]; i++) pool.push(r); });
  if (!pool.length) return;
  const r = pool[Math.floor(rng() * pool.length)];
  victim.hand[r]--;
  s.players[p].hand[r]++;
  log(s, `${s.players[p].name} steals a card from ${victim.name}.`);
}
