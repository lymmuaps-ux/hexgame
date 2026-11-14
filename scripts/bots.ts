// Bot tournament: plays bot-only games and reports win rates per level.
// Usage: npx tsx scripts/bots.ts [games] [base|guilds] [levels,comma,separated]
import { applyAction, createGame, victoryPoints } from '../src/game/rules';
import { decide, fallback, BotLevel } from '../src/game/ai';
import { GameState } from '../src/game/types';

const games = Number(process.argv[2] ?? 20);
const mode = (process.argv[3] ?? 'base') as 'base' | 'guilds';
const levels = (process.argv[4] ?? 'hard,normal,easy,easy').split(',') as BotLevel[];

const wins: Record<string, number> = {};
let stuck = 0, totalTurns = 0, slowest = 0, refused = 0;
for (let g = 0; g < games; g++) {
  // rotate seats so no level always sits first
  const seatLv = levels.map((_, i) => levels[(i + g) % levels.length]);
  let s: GameState = createGame(seatLv.map((l, i) => `${l}${i}`), Math.random, mode);
  let steps = 0;
  const offerAt = new Map<number, number>();
  while (s.phase !== 'ended' && steps < 6000) {
    steps++;
    let acted = false;
    // answers and discards first, then the player whose turn it is
    const order = [...s.players.keys()].sort((a, b) => (a === s.current ? 1 : 0) - (b === s.current ? 1 : 0));
    for (const p of order) {
      const t0 = performance.now();
      const age = s.trade?.from === p ? (steps - (offerAt.get(s.trade.id) ?? steps)) * 1000 : 0;
      let a = decide(s, p, seatLv[p], Math.random, age);
      slowest = Math.max(slowest, performance.now() - t0);
      if (!a) continue;
      let r = applyAction(s, p, a, Math.random);
      if (!r.ok) {
        refused++;
        if (refused < 10) console.log('refused', seatLv[p], JSON.stringify(a), r.error);
        a = fallback(s, p);
        if (!a) continue;
        r = applyAction(s, p, a, Math.random);
        if (!r.ok) continue;
      }
      if (a.type === 'offerTrade' && r.state.trade) offerAt.set(r.state.trade.id, steps);
      s = r.state;
      acted = true;
      break;
    }
    if (!acted) { console.log('no one can act', s.phase, s.stage, s.current); break; }
  }
  if (s.phase !== 'ended') { stuck++; continue; }
  const w = s.players.findIndex((_, i) => victoryPoints(s, i) >= (mode === 'guilds' ? 13 : 10));
  wins[seatLv[w]] = (wins[seatLv[w]] ?? 0) + 1;
  totalTurns += s.turnNumber;
}
const per: Record<string, number> = {};
levels.forEach((l) => (per[l] = (per[l] ?? 0) + 1));
console.log(`${games} ${mode} games, seats ${levels.join(',')}`);
for (const l of Object.keys(per)) console.log(`  ${l}: ${wins[l] ?? 0} wins (${(((wins[l] ?? 0) / games / per[l]) * 100).toFixed(0)}% per seat)`);
console.log(`  unfinished ${stuck}, avg turns ${(totalTurns / Math.max(1, games - stuck)).toFixed(0)}, slowest decision ${slowest.toFixed(0)} ms, refused ${refused}`);
