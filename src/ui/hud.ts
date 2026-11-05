import {
  canAfford, longestRoadFor, tradeRates, validCitySpots, validRaiderHexes, validRoadSpots,
  validSettlementSpots, victoryPoints,
} from '../game/rules';
import {
  Action, COSTS, DEV_INFO, DevCard, GameState, RESOURCES, RES_INFO, ResMap, Resource,
  WIN_POINTS, emptyRes, totalRes,
} from '../game/types';
import { Selectable } from '../render/scene';

type Mode = null | 'road' | 'settlement' | 'city';
type Modal =
  | null
  | { kind: 'trade'; tab: 'bank' | 'players'; give: ResMap; get: ResMap; bankGive: Resource | null; bankGet: Resource | null }
  | { kind: 'pick'; card: 'harvest' | 'embargo'; picks: Resource[] }
  | { kind: 'help' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const resChip = (r: Resource, n?: number) =>
  `<span class="chip" style="--c:${RES_INFO[r].color}">${RES_INFO[r].icon}${n !== undefined ? `<b>${n}</b>` : ''}</span>`;
const costHtml = (c: Partial<ResMap>) =>
  RESOURCES.filter((r) => c[r]).map((r) => `<span class="cost">${RES_INFO[r].icon}${(c[r] ?? 0) > 1 ? '×' + c[r] : ''}</span>`).join('');
const fmt = (m: Partial<ResMap>) => RESOURCES.filter((r) => (m[r] ?? 0) > 0).map((r) => resChip(r, m[r])).join('');
const DIE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

export class Hud {
  private state: GameState | null = null;
  private mode: Mode = null;
  private modal: Modal = null;
  private discard: ResMap = emptyRes();
  private discardKey = '';
  private logOpen = innerWidth > 900;
  private toastTimer = 0;
  onChange: () => void = () => {};

  constructor(private root: HTMLElement, private seat: number, private act: (a: Action) => void, private code: string) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || el.hasAttribute('disabled')) return;
      this.click(el.dataset.a!, el.dataset.v ?? '');
    });
  }

  setState(s: GameState) {
    this.state = s;
    // drop modes that no longer make sense
    if (s.current !== this.seat || s.stage !== 'actions') this.mode = null;
    if (this.modal?.kind === 'trade' && (s.current !== this.seat || s.stage !== 'actions')) this.modal = null;
    this.render();
  }

  toast(msg: string) {
    const t = this.root.querySelector<HTMLElement>('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 2800);
  }

  /** what the 3D board should let me click */
  selectable(): Selectable | null {
    const s = this.state;
    if (!s || s.phase === 'ended' || s.current !== this.seat) return null;
    const p = this.seat;
    if (s.phase === 'setup')
      return s.setupNeed === 'settlement'
        ? { kind: 'vertex', ids: validSettlementSpots(s, p), style: 'settlement' }
        : { kind: 'edge', ids: validRoadSpots(s, p) };
    if (s.stage === 'moveRaider') return { kind: 'hex', ids: validRaiderHexes(s) };
    if (s.stage === 'roadworks') return { kind: 'edge', ids: validRoadSpots(s, p) };
    if (s.stage !== 'actions') return null;
    if (this.mode === 'road') return { kind: 'edge', ids: validRoadSpots(s, p) };
    if (this.mode === 'settlement') return { kind: 'vertex', ids: validSettlementSpots(s, p), style: 'settlement' };
    if (this.mode === 'city') return { kind: 'vertex', ids: validCitySpots(s, p), style: 'city' };
    return null;
  }

  pick(kind: string, id: number) {
    const s = this.state;
    if (!s) return;
    if (kind === 'hex') this.act({ type: 'moveRaider', hex: id });
    else if (kind === 'edge') this.act({ type: 'buildRoad', edge: id });
    else if (kind === 'vertex') {
      const city = s.phase === 'main' && this.mode === 'city';
      this.act(city ? { type: 'buildCity', vertex: id } : { type: 'buildSettlement', vertex: id });
    }
    if (s.phase === 'main') this.mode = null;
  }

  // ---------------------------------------------------------------- clicks

  private click(a: string, v: string) {
    const s = this.state!;
    const m = this.modal;
    switch (a) {
      case 'roll': this.act({ type: 'roll' }); break;
      case 'end': this.act({ type: 'endTurn' }); break;
      case 'mode': this.mode = this.mode === v ? null : (v as Mode); break;
      case 'buyDev': this.act({ type: 'buyDev' }); break;
      case 'playDev': {
        const card = v as DevCard;
        if (card === 'harvest' || card === 'embargo') this.modal = { kind: 'pick', card, picks: [] };
        else this.act({ type: 'playDev', card });
        break;
      }
      case 'pickRes':
        if (m?.kind === 'pick') {
          m.picks.push(v as Resource);
          const need = m.card === 'harvest' ? 2 : 1;
          if (m.picks.length >= need) {
            this.act({ type: 'playDev', card: m.card, res: m.picks });
            this.modal = null;
          }
        }
        break;
      case 'trade':
        this.modal = { kind: 'trade', tab: 'bank', give: emptyRes(), get: emptyRes(), bankGive: null, bankGet: null };
        break;
      case 'tab': if (m?.kind === 'trade') m.tab = v as 'bank' | 'players'; break;
      case 'bankGive': if (m?.kind === 'trade') m.bankGive = v as Resource; break;
      case 'bankGet': if (m?.kind === 'trade') m.bankGet = v as Resource; break;
      case 'doBank':
        if (m?.kind === 'trade' && m.bankGive && m.bankGet) this.act({ type: 'bankTrade', give: m.bankGive, get: m.bankGet });
        break;
      case 'adj': {
        if (m?.kind !== 'trade') break;
        const [side, r, d] = v.split(':') as ['give' | 'get', Resource, string];
        const max = side === 'give' ? s.players[this.seat].hand[r] : 19;
        m[side][r] = Math.max(0, Math.min(max, m[side][r] + Number(d)));
        break;
      }
      case 'offer':
        if (m?.kind === 'trade') {
          this.act({ type: 'offerTrade', give: { ...m.give }, get: { ...m.get } });
          this.modal = null;
        }
        break;
      case 'accept': this.act({ type: 'acceptTrade', id: Number(v) }); break;
      case 'decline': this.act({ type: 'declineTrade', id: Number(v) }); break;
      case 'cancelOffer': this.act({ type: 'cancelTrade' }); break;
      case 'disc': {
        const [r, d] = v.split(':') as [Resource, string];
        this.discard[r] = Math.max(0, Math.min(s.players[this.seat].hand[r], this.discard[r] + Number(d)));
        break;
      }
      case 'doDiscard': this.act({ type: 'discard', cards: { ...this.discard } }); break;
      case 'steal': this.act({ type: 'steal', target: Number(v) }); break;
      case 'close': this.modal = null; break;
      case 'help': this.modal = { kind: 'help' }; break;
      case 'log': this.logOpen = !this.logOpen; break;
      case 'copy':
        navigator.clipboard?.writeText(this.code).then(() => this.toast('Room code copied'));
        break;
    }
    this.render();
    this.onChange();
  }

  // --------------------------------------------------------------- render

  private status(s: GameState): string {
    const cur = s.players[s.current];
    const mine = s.current === this.seat;
    const who = mine ? 'You' : esc(cur.name);
    if (s.phase === 'ended') return `🏆 ${esc(s.players[s.winner!].name)} wins!`;
    if (s.phase === 'setup')
      return mine ? `Place a ${s.setupNeed} (glowing spots)` : `${who} is placing a ${s.setupNeed}…`;
    switch (s.stage) {
      case 'roll': return mine ? 'Your turn – roll the dice!' : `${who} is about to roll…`;
      case 'discard': {
        const waiting = Object.keys(s.pendingDiscards).map((i) => esc(s.players[+i].name)).join(', ');
        return `The Raider strikes! Waiting for discards: ${waiting}`;
      }
      case 'moveRaider': return mine ? 'Move the Raider to a new tile' : `${who} is moving the Raider…`;
      case 'steal': return mine ? 'Choose who to steal from' : `${who} is choosing a victim…`;
      case 'roadworks': return mine ? `Place ${s.roadworksLeft} free road(s)` : `${who} is building roads…`;
      default:
        if (!mine) return `${who}'s turn`;
        if (this.mode) return `Click a glowing spot to build a ${this.mode} – or click the button again to cancel`;
        return 'Build, trade, or end your turn';
    }
  }

  render() {
    const s = this.state;
    if (!s) return;
    const me = s.players[this.seat];
    const mine = s.current === this.seat && s.phase === 'main';
    const actions = mine && s.stage === 'actions';

    const players = s.players.map((p, i) => {
      const vp = victoryPoints(s, i, i === this.seat);
      const badges = [
        s.longestRoad.owner === i ? `<span class="badge" title="Longest Road">🛣️ ${s.longestRoad.length}</span>` : '',
        s.strongestGuard.owner === i ? `<span class="badge" title="Strongest Guard">⚔️ ${s.strongestGuard.size}</span>` : '',
      ].join('');
      return `<div class="player ${i === s.current ? 'active' : ''}" style="--pc:${p.color}">
        <div class="pname"><span class="dot"></span>${esc(p.name)}${i === this.seat ? ' <small>(you)</small>' : ''}${p.connected ? '' : ' <small class="off">offline</small>'}</div>
        <div class="pstats">
          <span title="Victory points">⭐ ${vp}</span>
          <span title="Resource cards">🂠 ${totalRes(p.hand)}</span>
          <span title="Fortune cards">🃏 ${p.dev.length + p.newDev.length}</span>
          <span title="Guards played">🛡️ ${p.guards}</span>
          <span title="Longest road">🛤️ ${longestRoadFor(s, i)}</span>
        </div>${badges ? `<div class="badges">${badges}</div>` : ''}
      </div>`;
    }).join('');

    const dice = s.dice
      ? `<div class="dice"><span>${DIE[s.dice[0]]}</span><span>${DIE[s.dice[1]]}</span><b>${s.dice[0] + s.dice[1]}</b></div>`
      : '';

    const hand = RESOURCES.map((r) =>
      `<div class="card" style="--c:${RES_INFO[r].color}" title="${RES_INFO[r].label}"><span>${RES_INFO[r].icon}</span><b>${me.hand[r]}</b><small>${RES_INFO[r].label}</small></div>`,
    ).join('');

    const devCounts = new Map<DevCard, { ready: number; fresh: number }>();
    me.dev.forEach((c) => { const e = devCounts.get(c) ?? { ready: 0, fresh: 0 }; e.ready++; devCounts.set(c, e); });
    me.newDev.forEach((c) => { const e = devCounts.get(c) ?? { ready: 0, fresh: 0 }; e.fresh++; devCounts.set(c, e); });
    const devs = [...devCounts].map(([c, n]) => {
      const canPlay = c !== 'monument' && n.ready > 0 && !s.devPlayedThisTurn && s.current === this.seat && s.phase === 'main'
        && (s.stage === 'actions' || (s.stage === 'roll' && c === 'guard'));
      return `<button class="dev" data-a="playDev" data-v="${c}" ${canPlay ? '' : 'disabled'} title="${esc(DEV_INFO[c].text)}${n.fresh ? ' (bought this turn – playable next turn)' : ''}">
        ${DEV_INFO[c].icon} ${DEV_INFO[c].label} ×${n.ready + n.fresh}</button>`;
    }).join('');

    const bld = (what: 'road' | 'settlement' | 'city', label: string, icon: string, left: number) => {
      const ok = actions && canAfford(s, this.seat, what) && left > 0;
      return `<button class="build ${this.mode === what ? 'on' : ''}" data-a="mode" data-v="${what}" ${ok ? '' : 'disabled'}>
        <span>${icon} ${label}</span><span class="costs">${costHtml(COSTS[what])}</span><small>${left} left</small></button>`;
    };

    const controls = s.phase !== 'main' ? '' : `
      ${mine && s.stage === 'roll' ? `<button class="primary big" data-a="roll">🎲 Roll dice</button>` : ''}
      ${bld('road', 'Road', '🛤️', me.roadsLeft)}
      ${bld('settlement', 'Settlement', '🏠', me.settlementsLeft)}
      ${bld('city', 'City', '🏰', me.citiesLeft)}
      <button class="build" data-a="buyDev" ${actions && canAfford(s, this.seat, 'dev') && s.devDeck.length ? '' : 'disabled'}>
        <span>🃏 Fortune</span><span class="costs">${costHtml(COSTS.dev)}</span><small>${s.devDeck.length} left</small></button>
      <button class="build" data-a="trade" ${actions ? '' : 'disabled'}><span>🤝 Trade</span><small>bank · ports · players</small></button>
      ${mine && s.stage === 'actions' ? `<button class="primary" data-a="end">End turn ➜</button>` : ''}`;

    // incoming / outgoing trade offer banner
    let offer = '';
    const t = s.trade;
    if (t) {
      if (t.from === this.seat) {
        const declined = t.declined.map((i) => esc(s.players[i].name)).join(', ');
        offer = `<div class="offer">Your offer: give ${fmt(t.give)} for ${fmt(t.get)} ${declined ? `<small>Declined: ${declined}</small>` : '<small>waiting…</small>'}
          <button data-a="cancelOffer">Cancel</button></div>`;
      } else if (!t.declined.includes(this.seat)) {
        const can = RESOURCES.every((r) => me.hand[r] >= (t.get[r] ?? 0));
        offer = `<div class="offer incoming"><b>${esc(s.players[t.from].name)}</b> offers ${fmt(t.give)} and wants ${fmt(t.get)}
          <button class="primary" data-a="accept" data-v="${t.id}" ${can ? '' : 'disabled'}>Accept</button>
          <button data-a="decline" data-v="${t.id}">Decline</button></div>`;
      }
    }

    const log = s.log.slice(-60).map((l) => `<div>${esc(l)}</div>`).join('');

    this.root.innerHTML = `
      <div id="top">
        <div class="brand">⬢ Hexhold <button class="code" data-a="copy" title="Copy room code">Room ${esc(this.code)}</button></div>
        <div class="status">${this.status(s)}</div>
        ${dice}
        <div class="topbtns"><button data-a="help" title="Rules">?</button><button data-a="log" title="Game log">📜</button></div>
      </div>
      <div id="players">${players}</div>
      <div id="log" class="${this.logOpen ? 'open' : ''}"><h4>Log</h4><div class="lines">${log}</div></div>
      ${offer}
      <div id="bottom">
        <div class="hand">${hand}${devs ? `<div class="devs">${devs}</div>` : ''}</div>
        <div class="controls">${controls}</div>
      </div>
      ${this.modalHtml(s)}
      <div id="toast"></div>`;
    const lines = this.root.querySelector('#log .lines');
    if (lines) lines.scrollTop = lines.scrollHeight;
  }

  private modalHtml(s: GameState): string {
    const me = s.players[this.seat];
    const wrap = (title: string, body: string, closable = true) =>
      `<div class="modal-bg"><div class="modal"><h3>${title}</h3>${body}${closable ? '<button class="close" data-a="close">✕</button>' : ''}</div></div>`;

    if (s.phase === 'ended') {
      const ranking = s.players.map((p, i) => ({ p, vp: victoryPoints(s, i) })).sort((a, b) => b.vp - a.vp);
      return wrap(`🏆 ${esc(s.players[s.winner!].name)} wins!`,
        `<ol class="rank">${ranking.map((r) => `<li style="--pc:${r.p.color}"><span class="dot"></span>${esc(r.p.name)} – ${r.vp} pts</li>`).join('')}</ol>
         <p>Reload the page to start a new game.</p>`, false);
    }

    const need = s.stage === 'discard' ? s.pendingDiscards[this.seat] : 0;
    if (need) {
      const key = `${s.turnNumber}-${need}`;
      if (key !== this.discardKey) { this.discardKey = key; this.discard = emptyRes(); }
      const chosen = totalRes(this.discard);
      return wrap(`🌩️ The Raider strikes – discard ${need}`,
        `<div class="pickers">${RESOURCES.map((r) => `<div class="picker">${resChip(r, me.hand[r])}
          <button data-a="disc" data-v="${r}:-1">−</button><b>${this.discard[r]}</b><button data-a="disc" data-v="${r}:1">+</button></div>`).join('')}</div>
         <button class="primary" data-a="doDiscard" ${chosen === need ? '' : 'disabled'}>Discard ${chosen}/${need}</button>`, false);
    }

    if (s.stage === 'steal' && s.current === this.seat) {
      return wrap('Steal a card from…', `<div class="row">${s.stealFrom.map((i) =>
        `<button class="steal" style="--pc:${s.players[i].color}" data-a="steal" data-v="${i}"><span class="dot"></span>${esc(s.players[i].name)} (${totalRes(s.players[i].hand)} cards)</button>`).join('')}</div>`, false);
    }

    const m = this.modal;
    if (!m) return '';
    if (m.kind === 'help') {
      return wrap('How to play', `<div class="help">
        <p><b>Goal:</b> first to <b>${WIN_POINTS} points</b> on their turn wins. Settlement = 1, City = 2, Longest Road (5+) = 2, Strongest Guard (3+ guards) = 2, Monument = 1.</p>
        <p><b>Setup:</b> each player places a settlement + road, then again in reverse order. The second settlement collects the resources around it.</p>
        <p><b>Turn:</b> roll the dice – every tile with that number produces for settlements (1) and cities (2) on its corners. Then build, buy fortune cards, and trade.</p>
        <p><b>Rolling 7:</b> anyone with more than 7 cards discards half. The roller moves the Raider (blocks a tile) and steals a card from a neighbour of it.</p>
        <p><b>Building:</b> settlements need 2 spaces between them and must touch your road (except in setup). Roads must connect to your network.</p>
        <p><b>Trading:</b> 4:1 with the bank, 3:1 or 2:1 if you have a settlement on a harbour. Offer trades to other players any time during your turn.</p>
        <p><b>Fortune cards:</b> one per turn, not on the turn you bought it. Guards may be played before rolling.</p>
        <p><b>Camera:</b> drag to rotate, scroll/pinch to zoom.</p></div>`);
    }
    if (m.kind === 'pick') {
      const need = m.card === 'harvest' ? 2 : 1;
      return wrap(`${DEV_INFO[m.card].icon} ${DEV_INFO[m.card].label}: pick ${need - m.picks.length} resource(s)`,
        `<p>${DEV_INFO[m.card].text}</p><div class="row">${RESOURCES.map((r) =>
          `<button class="respick" data-a="pickRes" data-v="${r}">${RES_INFO[r].icon} ${RES_INFO[r].label}</button>`).join('')}</div>
          ${m.picks.length ? `<p>Picked: ${m.picks.map((r) => RES_INFO[r].icon).join(' ')}</p>` : ''}`);
    }
    // trade
    const rates = tradeRates(s, this.seat);
    const tabs = `<div class="tabs"><button class="${m.tab === 'bank' ? 'on' : ''}" data-a="tab" data-v="bank">Bank & harbours</button>
      <button class="${m.tab === 'players' ? 'on' : ''}" data-a="tab" data-v="players">Players</button></div>`;
    if (m.tab === 'bank') {
      const gives = RESOURCES.map((r) => `<button class="respick ${m.bankGive === r ? 'on' : ''}" data-a="bankGive" data-v="${r}" ${me.hand[r] >= rates[r] ? '' : 'disabled'}>
        ${rates[r]}× ${RES_INFO[r].icon}</button>`).join('');
      const gets = RESOURCES.map((r) => `<button class="respick ${m.bankGet === r ? 'on' : ''}" data-a="bankGet" data-v="${r}" ${s.bank[r] > 0 && r !== m.bankGive ? '' : 'disabled'}>
        1× ${RES_INFO[r].icon}</button>`).join('');
      return wrap('Trade', `${tabs}<p>You give</p><div class="row">${gives}</div><p>You get</p><div class="row">${gets}</div>
        <button class="primary" data-a="doBank" ${m.bankGive && m.bankGet && m.bankGive !== m.bankGet ? '' : 'disabled'}>Trade with bank</button>`);
    }
    const side = (k: 'give' | 'get') => `<div class="pickers">${RESOURCES.map((r) => `<div class="picker">${resChip(r, k === 'give' ? me.hand[r] : undefined)}
      <button data-a="adj" data-v="${k}:${r}:-1">−</button><b>${m[k][r]}</b><button data-a="adj" data-v="${k}:${r}:1">+</button></div>`).join('')}</div>`;
    return wrap('Trade', `${tabs}<p>You give</p>${side('give')}<p>You want</p>${side('get')}
      <button class="primary" data-a="offer" ${totalRes(m.give) && totalRes(m.get) ? '' : 'disabled'}>Offer to everyone</button>`);
  }
}
