import { longestRoadFor, victoryPoints } from '../game/rules';
import { DEV_INFO, DevCard, GameState, RESOURCES, RES_INFO, totalRes } from '../game/types';
import { getLang, resLabel, t } from '../i18n';

/** Post-game recap: standings, final hands, dice chart, points over time, stats table, awards. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** chance (in 36) of each dice total */
const WAYS = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];
/** chart colour for a player: the white player is drawn grey so the line stays visible on the light card */
const chartColor = (c: string) => (c.toLowerCase() === '#f5f5f5' ? '#8a8f98' : c);

function diceChart(rolls: number[]) {
  const total = rolls.reduce((a, b) => a + b, 0);
  const W = 560, H = 230, L = 34, B = 30, T = 26;
  const plotW = W - L - 10, plotH = H - B - T;
  const maxV = Math.max(1, ...rolls.slice(2), ...WAYS.map((w) => (w / 36) * total));
  const top = Math.ceil(maxV / 2) * 2 || 2;
  const step = top <= 6 ? 1 : top <= 12 ? 2 : top <= 30 ? 5 : 10;
  const y = (v: number) => T + plotH - (v / top) * plotH;
  const slot = plotW / 11;
  const bw = Math.min(24, slot - 8);
  const most = Math.max(...rolls.slice(2));
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(t('recap.diceTitle'))}">`;
  for (let v = 0; v <= top; v += step) {
    svg += `<line x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`;
  }
  for (let n = 2; n <= 12; n++) {
    const cx = L + slot * (n - 2) + slot / 2;
    const v = rolls[n];
    const exp = (WAYS[n] / 36) * total;
    const h = (v / top) * plotH;
    const x = cx - bw / 2, yt = y(v);
    const r = Math.min(4, h);
    const hot = v === most && v > 0;
    // column: 4px rounded data-end, square at the baseline
    if (h > 0)
      svg += `<path d="M${x},${T + plotH} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${T + plotH} Z" class="bar${hot ? ' hot' : ''}"/>`;
    // expected count marker
    svg += `<line x1="${cx - bw / 2 - 4}" x2="${cx + bw / 2 + 4}" y1="${y(exp)}" y2="${y(exp)}" class="expected"/>`;
    if (hot) svg += `<text x="${cx}" y="${yt - 6}" class="value" text-anchor="middle">${v}</text>`;
    svg += `<text x="${cx}" y="${H - 10}" class="tick${n === 7 ? ' seven' : ''}" text-anchor="middle">${n}</text>`;
    // generous invisible hover target
    svg += `<rect x="${cx - slot / 2}" y="${T}" width="${slot}" height="${plotH}" class="hit" data-tip="${esc(
      t('recap.diceTip', { n, v, e: exp.toFixed(1) }),
    )}"/>`;
  }
  return svg + `<line x1="${L}" x2="${W - 8}" y1="${T + plotH}" y2="${T + plotH}" class="axis"/></svg>`;
}

function pointsChart(s: GameState) {
  const hist = s.stats?.vp ?? [];
  if (hist.length < 2) return '';
  const W = 560, H = 240, L = 30, R = 90, B = 28, T = 16;
  const plotW = W - L - R, plotH = H - B - T;
  const maxV = Math.max(10, ...hist.flat());
  const x = (i: number) => L + (i / (hist.length - 1)) * plotW;
  const y = (v: number) => T + plotH - (v / maxV) * plotH;
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${esc(t('recap.vpTitle'))}">`;
  for (let v = 0; v <= maxV; v += 2) svg += `<line x1="${L}" x2="${L + plotW}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${v}</text>`;
  svg += `<text x="${L}" y="${H - 8}" class="tick">${t('recap.turnAxis', { n: 1 })}</text><text x="${L + plotW}" y="${H - 8}" class="tick" text-anchor="end">${t('recap.turnAxis', { n: hist.length })}</text>`;
  // end labels: nudge apart only by a few px; the legend carries identity when they converge
  const ends = s.players.map((p, i) => ({ i, v: hist[hist.length - 1][i] ?? 0 })).sort((a, b) => b.v - a.v);
  let lastY = -99;
  const labelY = new Map<number, number>();
  for (const e of ends) {
    let ly = y(e.v) + 4;
    if (ly - lastY < 13) ly = lastY + 13;
    labelY.set(e.i, ly);
    lastY = ly;
  }
  s.players.forEach((p, i) => {
    const col = chartColor(p.color);
    // step line: points only change at the end of a turn
    let d = `M${x(0)},${y(hist[0][i] ?? 0)}`;
    for (let k = 1; k < hist.length; k++) d += ` H${x(k)} V${y(hist[k][i] ?? 0)}`;
    svg += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = hist.length - 1, v = hist[last][i] ?? 0;
    svg += `<circle cx="${x(last)}" cy="${y(v)}" r="5" fill="${col}" class="enddot"/>`;
    svg += `<text x="${x(last) + 10}" y="${labelY.get(i)}" class="endlabel">${esc(p.name)} · ${v}</text>`;
  });
  // hover columns: one per turn, listing everyone's points
  for (let k = 0; k < hist.length; k++) {
    const tip = `${t('recap.turnAxis', { n: k + 1 })}: ` + s.players.map((p, i) => `${p.name} ${hist[k][i] ?? 0}`).join(' · ');
    const w = plotW / Math.max(1, hist.length - 1);
    svg += `<rect x="${x(k) - w / 2}" y="${T}" width="${w}" height="${plotH}" class="hit" data-tip="${esc(tip)}"/>`;
  }
  return svg + `</svg>`;
}

function awards(s: GameState) {
  const st = s.stats;
  if (!st) return '';
  const P = st.players;
  const pick = (score: (i: number) => number, key: string, icon: string, unit: string) => {
    const vals = P.map((_, i) => score(i));
    const best = Math.max(...vals);
    if (best <= 0) return '';
    const who = vals.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    const names = who.map((i) => `<span class="dot" style="--pc:${s.players[i].color}"></span>${esc(s.players[i].name)}`).join(' & ');
    return `<div class="award-tile"><div class="ai">${icon}</div><div><b>${t(`recap.aw.${key}`)}</b><div class="aw-who">${names}</div><small>${t(unit, { n: best })}</small></div></div>`;
  };
  return [
    pick((i) => totalRes(P[i].produced), 'lucky', '🍀', 'recap.u.res'),
    pick((i) => P[i].stolen, 'robber', '🦹', 'recap.u.steals'),
    pick((i) => P[i].robbed, 'robbed', '😭', 'recap.u.robbed'),
    pick((i) => P[i].blocked, 'blocked', '🌩️', 'recap.u.blocked'),
    pick((i) => P[i].trades, 'trader', '🤝', 'recap.u.trades'),
    pick((i) => P[i].bankTrades, 'banker', '🏦', 'recap.u.bank'),
    pick((i) => P[i].roads, 'roads', '🛤️', 'recap.u.roads'),
    pick((i) => P[i].knights, 'knights', '🛡️', 'recap.u.knights'),
    pick((i) => P[i].discarded, 'discard', '🗑️', 'recap.u.discard'),
  ].join('');
}

export function recapHtml(s: GameState, seat: number): string {
  const st = s.stats;
  const winner = s.players[s.winner ?? 0];
  const mins = st?.endedAt ? Math.max(1, Math.round((st.endedAt - st.startedAt) / 60000)) : null;
  const totalRolls = st ? st.rolls.reduce((a, b) => a + b, 0) : 0;

  // standings with a points breakdown
  const rows = s.players
    .map((p, i) => ({ p, i, vp: victoryPoints(s, i) }))
    .sort((a, b) => b.vp - a.vp)
    .map(({ p, i, vp }, rank) => {
      const mine = Object.values(s.buildings).filter((b) => b.owner === i);
      const sett = mine.filter((b) => b.kind === 'settlement').length, city = mine.filter((b) => b.kind === 'city').length;
      const mon = [...p.dev, ...p.newDev].filter((c) => c === 'monument').length;
      const parts = [
        sett && `🏠×${sett}`, city && `🏰×${city} (${city * 2})`,
        s.longestRoad.owner === i && `🛣️ +2`, s.strongestGuard.owner === i && `⚔️ +2`, mon && `🏛️×${mon}`,
      ].filter(Boolean).join(' · ');
      return `<tr class="${i === s.winner ? 'win' : ''}"><td class="rank">${rank === 0 ? '🏆' : rank + 1}</td>
        <td><span class="dot" style="--pc:${p.color}"></span>${esc(p.name)}${i === seat ? ` <small>${t('hud.you')}</small>` : ''}</td>
        <td class="num"><b>${vp}</b></td><td class="breakdown">${parts}</td></tr>`;
    }).join('');

  // what each player ended with
  const hands = s.players.map((p, i) => {
    const res = RESOURCES.map((r) => `<span class="chip" style="--c:${RES_INFO[r].color}" title="${resLabel(r)}">${RES_INFO[r].icon}<b>${p.hand[r]}</b></span>`).join('');
    const counts = new Map<DevCard, number>();
    [...p.dev, ...p.newDev].forEach((c) => counts.set(c, (counts.get(c) ?? 0) + 1));
    const devs = [...counts].map(([c, n]) => `<span class="devchip">${DEV_INFO[c].icon} ${t(`dev.${c}`)} ×${n}</span>`).join('') || `<small class="muted">${t('recap.noCards')}</small>`;
    return `<div class="hand-card" style="--pc:${p.color}"><div class="hc-name"><span class="dot"></span>${esc(p.name)}</div>
      <div class="hc-row">${res}</div><div class="hc-row">${devs}</div>
      <div class="hc-row muted"><small>🛡️ ${p.guards} · 🛤️ ${longestRoadFor(s, i)} · ${t('recap.piecesLeft', { r: p.roadsLeft, s: p.settlementsLeft, c: p.citiesLeft })}</small></div></div>`;
  }).join('');

  // dice highlights
  let diceBits = '';
  if (st && totalRolls) {
    const most = Math.max(...st.rolls.slice(2));
    const mostNums = st.rolls.map((v, n) => (n >= 2 && v === most ? n : 0)).filter(Boolean).join(', ');
    const never = st.rolls.map((v, n) => (n >= 2 && v === 0 ? n : 0)).filter(Boolean);
    diceBits = `<div class="stat-tiles">
      <div class="stat"><span>${t('recap.rolls')}</span><b>${totalRolls}</b></div>
      <div class="stat"><span>${t('recap.mostRolled')}</span><b>${mostNums}</b><small>${t('recap.times', { n: most })}</small></div>
      <div class="stat"><span>${t('recap.sevens')}</span><b>${st.rolls[7]}</b><small>${t('recap.expected', { n: ((6 / 36) * totalRolls).toFixed(1) })}</small></div>
      <div class="stat"><span>${t('recap.never')}</span><b>${never.length ? never.join(', ') : '—'}</b></div></div>`;
  }

  // per-player numbers
  const statRows: [string, (i: number) => number | string][] = st ? [
    ...RESOURCES.map((r) => [`${RES_INFO[r].icon} ${resLabel(r)}`, (i: number) => st.players[i].produced[r]] as [string, (i: number) => number]),
    [t('recap.s.produced'), (i) => totalRes(st.players[i].produced)],
    [t('recap.s.blocked'), (i) => st.players[i].blocked],
    [t('recap.s.stolen'), (i) => st.players[i].stolen],
    [t('recap.s.robbed'), (i) => st.players[i].robbed],
    [t('recap.s.discarded'), (i) => st.players[i].discarded],
    [t('recap.s.trades'), (i) => st.players[i].trades],
    [t('recap.s.bank'), (i) => st.players[i].bankTrades],
    [t('recap.s.bought'), (i) => st.players[i].bought],
    [t('recap.s.knights'), (i) => st.players[i].knights],
    [t('recap.s.built'), (i) => `${st.players[i].roads} / ${st.players[i].settlements} / ${st.players[i].cities}`],
  ] : [];
  const table = statRows.length ? `<div class="table-wrap"><table class="stats">
    <thead><tr><th></th>${s.players.map((p) => `<th><span class="dot" style="--pc:${p.color}"></span>${esc(p.name)}</th>`).join('')}</tr></thead>
    <tbody>${statRows.map(([label, f], k) => `<tr class="${k === RESOURCES.length ? 'sum' : ''}"><th>${label}</th>${s.players.map((_, i) => `<td class="num">${f(i)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>` : '';

  const legend = s.players.map((p) => `<span class="lg"><i style="background:${chartColor(p.color)}"></i>${esc(p.name)}</span>`).join('');

  return `<div class="recap" dir="${getLang() === 'ar' ? 'rtl' : 'ltr'}">
    <div class="recap-hero" style="--pc:${winner.color}"><div class="trophy">🏆</div>
      <div><h2>${t('recap.winner', { name: esc(winner.name) })}</h2>
      <p>${t('recap.length', { n: s.turnNumber })}${mins ? ` · ${t('recap.minutes', { n: mins })}` : ''}</p></div></div>
    <section><h4>${t('recap.standings')}</h4><table class="standings">${rows}</table></section>
    <section><h4>${t('recap.hands')}</h4><div class="hands">${hands}</div></section>
    ${st && totalRolls ? `<section><h4>${t('recap.diceTitle')}</h4>${diceBits}
      <p class="chart-sub">${t('recap.diceSub')}</p><div class="chart-box">${diceChart(st.rolls)}</div></section>` : ''}
    ${st && st.vp.length > 1 ? `<section><h4>${t('recap.vpTitle')}</h4><div class="legend">${legend}</div><div class="chart-box">${pointsChart(s)}</div></section>` : ''}
    ${awards(s) ? `<section><h4>${t('recap.awards')}</h4><div class="award-grid">${awards(s)}</div></section>` : ''}
    ${table ? `<section><h4>${t('recap.stats')}</h4>${table}</section>` : ''}
    <div class="recap-actions"><button data-a="close">${t('recap.viewBoard')}</button><button class="primary" data-a="newgame">${t('recap.newGame')}</button></div>
    <div class="chart-tip" hidden></div>
  </div>`;
}

/** hover tooltips for any element with data-tip inside the recap */
export function bindRecapTips(root: HTMLElement) {
  const tip = root.querySelector<HTMLElement>('.chart-tip');
  if (!tip) return;
  root.querySelectorAll<SVGElement>('[data-tip]').forEach((el) => {
    const show = (e: PointerEvent) => {
      tip.textContent = el.dataset.tip ?? '';
      tip.hidden = false;
      const box = root.getBoundingClientRect();
      tip.style.left = `${e.clientX - box.left + root.scrollLeft + 12}px`;
      tip.style.top = `${e.clientY - box.top + root.scrollTop + 12}px`;
      el.classList.add('hover');
    };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', () => {
      tip.hidden = true;
      el.classList.remove('hover');
    });
  });
}
