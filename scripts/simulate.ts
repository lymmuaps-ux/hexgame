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
  const opts: Action[] = [{ type: 'endTurn' }];
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
    if (r.ok) s = r.state;
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
