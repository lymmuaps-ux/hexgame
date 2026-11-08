// Plays many random games headlessly to exercise the rules engine.
import { applyAction, createGame, validCitySpots, validRoadSpots, validSettlementSpots, validRaiderHexes, tradeRates } from '../src/game/rules';
import { Action, GameState, RESOURCES, totalRes, emptyRes } from '../src/game/types';

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function choose(s: GameState): { p: number; a: Action } {
  if (s.stage === 'discard' && s.phase === 'main') {
    const p = Number(Object.keys(s.pendingDiscards)[0]);
    const need = s.pendingDiscards[p];
    const hand = { ...s.players[p].hand }; const cards = emptyRes();
    for (let i = 0; i < need; i++) { const r = pick(RESOURCES.filter((r) => hand[r] > 0)); hand[r]--; cards[r]++; }
    return { p, a: { type: 'discard', cards } };
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
  const opts: Action[] = [{ type: 'endTurn' }];
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

let wins = 0, totalTurns = 0;
const GAMES = 300;
for (let g = 0; g < GAMES; g++) {
  let s = createGame(['A', 'B', 'C', 'D'].slice(0, 2 + (g % 3)));
  for (let step = 0; step < 20000 && s.phase !== 'ended'; step++) {
    const { p, a } = choose(s);
    const r = applyAction(s, p, a);
    if (r.ok) {
      if (a.type === 'roll' && r.state.dice && r.state.dice[0] + r.state.dice[1] !== 7) {
        // the animation record must match exactly what each hand gained
        const rec = s.players.map(() => emptyRes());
        for (const it of r.state.production!.items) rec[it.p][it.r] += it.n;
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
  }
  if (s.phase === 'ended') { wins++; totalTurns += s.turnNumber; }
  void totalRes;
}
console.log(`${wins}/${GAMES} games finished, avg ${Math.round(totalTurns / wins)} turns`);
