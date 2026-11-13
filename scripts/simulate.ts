// Plays many random games headlessly to exercise the rules engine.
import { applyAction, createGame, validCitySpots, validRoadSpots, validSettlementSpots, validRaiderHexes, tradeRates, validWallSpots, goodsRate } from '../src/game/rules';
import { Action, GameState, RESOURCES, totalRes, emptyRes, isGood, GOODS, TRACKS, TRACK_INFO, emptyGoods, improveCost } from '../src/game/types';

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function choose(s: GameState): { p: number; a: Action } {
  if (s.stage === 'discard' && s.phase === 'main') {
    const p = Number(Object.keys(s.pendingDiscards)[0]);
    const need = s.pendingDiscards[p];
    const hand: Record<string, number> = { ...s.players[p].hand, ...(s.players[p].goods ?? {}) };
    const cards = emptyRes(), goods = emptyGoods();
    for (let i = 0; i < need; i++) {
      const r = pick(Object.keys(hand).filter((k) => hand[k] > 0));
      hand[r]--;
      if (isGood(r)) goods[r]++; else cards[r as keyof typeof cards]++;
    }
    return { p, a: { type: 'discard', cards, goods } };
  }
  const p = s.current;
  if (s.phase === 'setup') {
    return s.setupNeed === 'settlement'
      ? { p, a: { type: 'buildSettlement', vertex: pick(validSettlementSpots(s, p)) } }
      : { p, a: { type: 'buildRoad', edge: pick(validRoadSpots(s, p)) } };
  }
  switch (s.stage) {
    case 'roll': return { p, a: !s.devPlayedThisTurn && s.players[p].dev.includes('guard') && Math.random() < 0.3 ? { type: 'playDev', card: 'guard' } : { type: 'roll' } };
    case 'moveRaider': return { p, a: { type: 'moveRaider', hex: pick(validRaiderHexes(s)) } };
    case 'steal': return { p, a: { type: 'steal', target: pick(s.stealFrom) } };
    case 'roadworks': return { p, a: { type: 'buildRoad', edge: pick(validRoadSpots(s, p)) } };
  }
  // trading: sometimes offer, others counter, the proposer accepts a counter
  if (s.trade && s.trade.from === p) {
    const c = s.trade.counters?.[0];
    if (c && Math.random() < 0.7) return { p, a: { type: 'acceptCounter', id: s.trade.id, p: c.p } };
    if (Math.random() < 0.5) {
      const other = pick(s.players.map((_, i) => i).filter((i) => i !== p));
      const oh = s.players[other].hand;
      const g = RESOURCES.find((r) => oh[r] > 0);
      if (g) return { p: other, a: { type: 'counterTrade', id: s.trade.id, give: { [g]: 1 }, get: { [pick([...RESOURCES])]: 1 } } };
    }
  }
  // science level 3: someone may pick a free resource out of turn
  if (s.aqueduct?.length && Math.random() < 0.6) return { p: s.aqueduct[0], a: { type: 'aqueduct', res: pick([...RESOURCES]) } };
  const opts: Action[] = [{ type: 'endTurn' }];
  if (s.mode === 'guilds' && s.stage === 'actions') {
    const me = s.players[p];
    for (const tr of TRACKS) if ((me.goods?.[TRACK_INFO[tr].good] ?? 0) >= improveCost(me.levels![tr])) opts.push({ type: 'improve', track: tr }, { type: 'improve', track: tr });
    const w = validWallSpots(s, p);
    if (w.length && me.hand.clay >= 2) opts.push({ type: 'buildWall', vertex: pick(w) });
    const g = GOODS.find((k) => (me.goods?.[k] ?? 0) >= goodsRate(s, p));
    if (g) opts.push({ type: 'bankTrade', give: g, get: pick([...RESOURCES, ...GOODS].filter((x) => x !== g)) });
  }
  const mine = RESOURCES.find((r) => s.players[p].hand[r] > 0);
  if (mine && !s.trade) opts.push({ type: 'offerTrade', give: { [mine]: 1 }, get: { [pick([...RESOURCES])]: 1 } });
  const me = s.players[p];
  const c = validCitySpots(s, p); if (c.length) opts.push({ type: 'buildCity', vertex: pick(c) }, { type: 'buildCity', vertex: pick(c) });
  const v = validSettlementSpots(s, p); if (v.length) opts.push({ type: 'buildSettlement', vertex: pick(v) }, { type: 'buildSettlement', vertex: pick(v) });
  const e = validRoadSpots(s, p); if (e.length) opts.push({ type: 'buildRoad', edge: pick(e) });
  opts.push({ type: 'buyDev' });
  if (me.dev.length) { const card = pick(me.dev); opts.push({ type: 'playDev', card, res: [pick([...RESOURCES]), pick([...RESOURCES])] }); }
  const rates = tradeRates(s, p);
  const give = RESOURCES.find((r) => me.hand[r] >= rates[r]);
  if (give) opts.push({ type: 'bankTrade', give, get: pick(RESOURCES.filter((r) => r !== give)) });
  return { p, a: pick(opts) };
}

let wins = 0, totalTurns = 0, guildGames = 0, metroGames = 0, maxLevel = 0;
const GAMES = 300;
for (let g = 0; g < GAMES; g++) {
  let s = createGame(['A', 'B', 'C', 'D'].slice(0, 2 + (g % 3)), Math.random, g % 2 ? 'guilds' : 'base');
  for (let step = 0; step < 20000 && s.phase !== 'ended'; step++) {
    const { p, a } = choose(s);
    const r = applyAction(s, p, a);
    if (r.ok) {
      if (a.type === 'roll' && r.state.dice && r.state.dice[0] + r.state.dice[1] !== 7) {
        // the animation record must match exactly what each hand gained
        const rec = s.players.map(() => emptyRes());
        for (const it of r.state.production!.items) if (!isGood(it.r)) rec[it.p][it.r] += it.n;
        r.state.players.forEach((pl, i) => RESOURCES.forEach((res) => {
          if (pl.hand[res] - s.players[i].hand[res] !== rec[i][res]) throw new Error('production record mismatch');
        }));
      }
      s = r.state;
    }
    else if (s.phase === 'setup' || ['roll', 'moveRaider', 'steal', 'discard'].includes(s.stage)) throw new Error(`stuck: ${r.error} ${JSON.stringify(a)} stage=${s.stage}`);
    // invariants
    for (const res of RESOURCES) {
      const sum = s.bank[res] + s.players.reduce((t, pl) => t + pl.hand[res], 0);
      if (sum !== 19) throw new Error(`resource leak ${res} ${sum}`);
      if (s.players.some((pl) => pl.hand[res] < 0) || s.bank[res] < 0) throw new Error('negative');
    }
    if (s.mode === 'guilds') {
      for (const pl of s.players) if (GOODS.some((k) => pl.goods![k] < 0)) throw new Error('negative goods');
      for (const tr of TRACKS) {
        const holders = Object.values(s.buildings).filter((b) => b.metro === tr);
        if (holders.length > 1) throw new Error('two metropolises for ' + tr);
        const owner = s.metropolis![tr];
        if ((owner === null) !== (holders.length === 0) || (owner !== null && holders[0].owner !== owner)) throw new Error('metropolis mismatch');
        if (owner !== null && s.players[owner].levels![tr] < 4) throw new Error('metropolis below level 4');
      }
    }
  }
  if (s.mode === 'guilds') {
    guildGames++;
    if (Object.values(s.metropolis!).some((x) => x !== null)) metroGames++;
    maxLevel = Math.max(maxLevel, ...s.players.flatMap((pl) => Object.values(pl.levels!)));
  }
  if (s.phase === 'ended') {
    wins++;
    totalTurns += s.turnNumber;
    const st = s.stats!;
    const rolled = st.rolls.reduce((a, b) => a + b, 0);
    const rollLines = s.log.filter((l) => l.startsWith('@log.rolls')).length;
    if (rolled !== rollLines && s.log.length < 200) throw new Error(`roll stats ${rolled} != ${rollLines}`);
    if (st.vp.length < 2 || !st.endedAt) throw new Error('missing vp history');
    s.players.forEach((pl, i) => {
      const built = Object.values(s.buildings).filter((b) => b.owner === i && b.kind === 'settlement').length;
      const direct = s.mode === 'guilds' ? 1 : 0; // the Guildlands setup city is built directly, not upgraded
      if (st.players[i].settlements - (st.players[i].cities - direct) !== built) throw new Error('settlement stats');
    });
  }
  void totalRes;
}
console.log(`${wins}/${GAMES} games finished, avg ${Math.round(totalTurns / wins)} turns · guildlands games: ${guildGames}, with a metropolis: ${metroGames}, max level reached: ${maxLevel}`);
