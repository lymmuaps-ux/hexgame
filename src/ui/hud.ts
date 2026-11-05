import {
  canAfford, longestRoadFor, tradeRates, validCitySpots, validRaiderHexes, validRoadSpots,
  validSettlementSpots, victoryPoints,
} from '../game/rules';
import {
  Action, COSTS, DEV_INFO, DevCard, GameState, RESOURCES, RES_INFO, ResMap, Resource,
  WIN_POINTS, emptyRes, totalRes,
} from '../game/types';
import { Selectable } from '../render/scene';
import { getLang, resLabel, setLang, t, tr } from '../i18n';

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
  // dice animation: while the dice are in the air we keep showing the pre-roll state
  private seenRoll: number | undefined | null = null;
  private rolling: GameState | null = null;
  private rollTimer = 0;
  // resource hand-out animation: cards still "in flight" are not shown in the counts yet
  private seenProd: number | undefined | null = null;
  private incoming: ResMap[] = [];
  private flights: { p: number; hex: number; r: Resource }[] = [];
  private flying = false;
  /** where a tile is on screen (provided by the 3D board) */
  hexScreenPos: (hex: number) => { x: number; y: number } = () => ({ x: innerWidth / 2, y: innerHeight / 2 });
  onChange: () => void = () => {};

  constructor(private root: HTMLElement, private seat: number, private act: (a: Action) => void, private code: string) {
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || el.hasAttribute('disabled')) return;
      this.click(el.dataset.a!, el.dataset.v ?? '');
    });
  }

  setState(s: GameState) {
    if (this.seenRoll === null) this.seenRoll = s.rollId;
    else if (s.rollId !== this.seenRoll && s.dice) {
      this.seenRoll = s.rollId;
      this.rolling = s;
      // fallback in case the board can't report the landing (e.g. the tab is hidden)
      clearTimeout(this.rollTimer);
      this.rollTimer = window.setTimeout(() => this.diceLanded(), 2600);
      this.render();
      return;
    }
    if (this.rolling) {
      this.rolling = s; // keep the newest state for the reveal
      return;
    }
    this.state = s;
    if (this.seenProd === null) this.seenProd = s.production?.id;
    else if (s.production && s.production.id !== this.seenProd) {
      this.seenProd = s.production.id;
      this.dealOut(s);
    }
    // drop modes that no longer make sense
    if (s.current !== this.seat || s.stage !== 'actions') this.mode = null;
    if (this.modal?.kind === 'trade' && (s.current !== this.seat || s.stage !== 'actions')) this.modal = null;
    this.render();
  }

  /** called when the 3D dice come to rest: reveal the result */
  diceLanded() {
    const s = this.rolling;
    if (!s) return;
    clearTimeout(this.rollTimer);
    this.rolling = null;
    this.showRollPop(s);
    this.setState(s);
    this.onChange();
  }

  private showRollPop(s: GameState) {
    if (!s.dice) return;
    const sum = s.dice[0] + s.dice[1];
    const who = s.rolledBy !== undefined ? s.players[s.rolledBy] : null;
    const el = document.createElement('div');
    el.className = `rollpop${sum === 7 ? ' seven' : ''}`;
    el.innerHTML = `<b>${sum}</b><span>${who ? t('pop.rolled', { name: esc(who.name) }) : t('pop.rolledAnon')}${sum === 7 ? t('pop.seven') : ''}</span>`;
    if (who) el.style.setProperty('--pc', who.color);
    (this.root.parentElement ?? document.body).appendChild(el);
    setTimeout(() => el.remove(), 2300);
  }

  /** queue one flying card per resource handed out, in turn order */
  private dealOut(s: GameState) {
    const items = [...(s.production?.items ?? [])].sort((a, b) => a.p - b.p || a.hex - b.hex);
    if (!items.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const it of items) {
      for (let k = 0; k < it.n; k++) {
        this.incoming[it.p] ??= emptyRes();
        this.incoming[it.p][it.r]++;
        this.flights.push({ p: it.p, hex: it.hex, r: it.r });
      }
    }
    if (!this.flying) this.nextFlight();
  }

  private nextFlight() {
    const f = this.flights.shift();
    if (!f) {
      this.flying = false;
      return;
    }
    this.flying = true;
    // keep the whole deal to roughly 3 seconds even when lots of cards come out
    const gap = Math.max(160, Math.min(420, 3000 / (this.flights.length + 1)));
    this.flyCard(f);
    setTimeout(() => this.nextFlight(), gap);
  }

  private flyCard(f: { p: number; hex: number; r: Resource }) {
    const layer = this.root.parentElement ?? document.body;
    const targetSel = f.p === this.seat ? `.hand .card[data-r="${f.r}"]` : `.player[data-p="${f.p}"]`;
    const target = this.root.querySelector<HTMLElement>(targetSel);
    let done = false;
    const arrive = () => {
      if (done) return;
      done = true;
      el.remove();
      const inc = this.incoming[f.p];
      if (inc && inc[f.r] > 0) inc[f.r]--;
      this.render();
      const t = this.root.querySelector<HTMLElement>(targetSel);
      if (t) {
        t.classList.remove('bump');
        void t.offsetWidth;
        t.classList.add('bump');
        const plus = document.createElement('div');
        plus.className = 'plusone';
        plus.textContent = `+1 ${RES_INFO[f.r].icon}`;
        const r = t.getBoundingClientRect();
        plus.style.left = `${r.left + r.width / 2}px`;
        plus.style.top = `${r.top}px`;
        layer.appendChild(plus);
        setTimeout(() => plus.remove(), 900);
      }
    };
    const el = document.createElement('div');
    el.className = 'flycard';
    el.style.setProperty('--c', RES_INFO[f.r].color);
    el.style.setProperty('--pc', this.state?.players[f.p].color ?? '#fff');
    el.innerHTML = `<span>${RES_INFO[f.r].icon}</span>`;
    layer.appendChild(el);
    const from = this.hexScreenPos(f.hex);
    const tr = target?.getBoundingClientRect();
    const to = tr ? { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 } : { x: from.x, y: from.y - 120 };
    const lift = Math.min(160, 60 + Math.hypot(to.x - from.x, to.y - from.y) * 0.25);
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - lift };
    const at = (p: { x: number; y: number }, sc: number, rot: number) =>
      ({ transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) scale(${sc}) rotate(${rot}deg)` });
    const spin = (Math.random() - 0.5) * 40;
    const dur = 750;
    const anim = el.animate(
      [
        { ...at(from, 0.2, 0), opacity: 0 },
        { ...at({ x: from.x, y: from.y - 40 }, 1.25, spin / 2), opacity: 1, offset: 0.22 },
        { ...at(mid, 1.1, spin), opacity: 1, offset: 0.6 },
        { ...at(to, 0.65, 0), opacity: 0.9 },
      ],
      { duration: dur, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'forwards' },
    );
    anim.onfinish = arrive;
    setTimeout(arrive, dur + 400); // hidden tabs may never finish the animation
  }

  toast(msg: string) {
    // lives outside the re-rendered HUD so a redraw can't wipe it
    let t = document.getElementById('toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      (this.root.parentElement ?? document.body).appendChild(t);
    }
    const el = t;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), Math.max(2800, msg.length * 55));
  }

  /** what the 3D board should let me click */
  selectable(): Selectable | null {
    const s = this.state;
    if (!s || this.rolling || s.phase === 'ended' || s.current !== this.seat) return null;
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
      case 'noSpot': this.toast(t(`noSpot.${v}`)); break;
      case 'lang': setLang(getLang() === 'ar' ? 'en' : 'ar'); return;
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
        navigator.clipboard?.writeText(this.code).then(() => this.toast(t('hud.codeCopied')));
        break;
    }
    this.render();
    this.onChange();
  }

  // --------------------------------------------------------------- render

  private status(s: GameState): string {
    if (this.rolling) {
      const r = this.rolling.rolledBy;
      return r === this.seat ? t('st.rollingMe') : t('st.rolling', { name: esc(this.rolling.players[r ?? s.current].name) });
    }
    const cur = s.players[s.current];
    const mine = s.current === this.seat;
    const who = { name: esc(cur.name) };
    if (s.phase === 'ended') return t('st.wins', { name: esc(s.players[s.winner!].name) });
    if (s.phase === 'setup') {
      const road = s.setupNeed === 'road';
      return mine ? t(road ? 'st.placeRoad' : 'st.placeSettlement') : t(road ? 'st.placingRoad' : 'st.placingSettlement', who);
    }
    switch (s.stage) {
      case 'roll': return mine ? t('st.yourRoll') : t('st.aboutRoll', who);
      case 'discard': {
        const names = Object.keys(s.pendingDiscards).map((i) => esc(s.players[+i].name)).join(getLang() === 'ar' ? '، ' : ', ');
        return t('st.discardWait', { names });
      }
      case 'moveRaider': return mine ? t('st.moveRaider') : t('st.movingRaider', who);
      case 'steal': return mine ? t('st.steal') : t('st.stealing', who);
      case 'roadworks': return mine ? t('st.roadworks', { n: s.roadworksLeft }) : t('st.roadworking', who);
      default:
        if (!mine) return t('st.turnOf', who);
        if (this.mode) {
          const n = this.selectable()?.ids.length ?? 0;
          return t('st.clickSpot', { what: t(`piece.${this.mode}`), n });
        }
        return t('st.actions');
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
        s.longestRoad.owner === i ? `<span class="badge" title="${t('hud.longestRoad')}">🛣️ ${s.longestRoad.length}</span>` : '',
        s.strongestGuard.owner === i ? `<span class="badge" title="${t('hud.strongestGuard')}">⚔️ ${s.strongestGuard.size}</span>` : '',
      ].join('');
      return `<div class="player ${i === s.current ? 'active' : ''}" data-p="${i}" style="--pc:${p.color}">
        <div class="pname"><span class="dot"></span>${esc(p.name)}${i === this.seat ? ` <small>${t('hud.you')}</small>` : ''}${p.connected ? '' : ` <small class="off">${t('hud.offline')}</small>`}</div>
        <div class="pstats">
          <span title="${t('hud.vp')}">⭐ ${vp}</span>
          <span title="${t('hud.cards')}">🂠 ${Math.max(0, totalRes(p.hand) - totalRes(this.incoming[i] ?? {}))}</span>
          <span title="${t('hud.devCards')}">🃏 ${p.dev.length + p.newDev.length}</span>
          <span title="${t('hud.guards')}">🛡️ ${p.guards}</span>
          <span title="${t('hud.longest')}">🛤️ ${longestRoadFor(s, i)}</span>
        </div>${badges ? `<div class="badges">${badges}</div>` : ''}
      </div>`;
    }).join('');

    const dice = this.rolling
      ? `<div class="dice rolling"><span>🎲</span><span>🎲</span></div>`
      : s.dice
      ? `<div class="dice"><span>${DIE[s.dice[0]]}</span><span>${DIE[s.dice[1]]}</span><b>${s.dice[0] + s.dice[1]}</b></div>`
      : '';

    const hand = RESOURCES.map((r) =>
      `<div class="card" data-r="${r}" style="--c:${RES_INFO[r].color}" title="${resLabel(r)}"><span>${RES_INFO[r].icon}</span><b>${Math.max(0, me.hand[r] - (this.incoming[this.seat]?.[r] ?? 0))}</b><small>${resLabel(r)}</small></div>`,
    ).join('');

    const devCounts = new Map<DevCard, { ready: number; fresh: number }>();
    me.dev.forEach((c) => { const e = devCounts.get(c) ?? { ready: 0, fresh: 0 }; e.ready++; devCounts.set(c, e); });
    me.newDev.forEach((c) => { const e = devCounts.get(c) ?? { ready: 0, fresh: 0 }; e.fresh++; devCounts.set(c, e); });
    const devs = [...devCounts].map(([c, n]) => {
      const canPlay = c !== 'monument' && n.ready > 0 && !s.devPlayedThisTurn && s.current === this.seat && s.phase === 'main'
        && (s.stage === 'actions' || (s.stage === 'roll' && c === 'guard'));
      return `<button class="dev" data-a="playDev" data-v="${c}" ${canPlay ? '' : 'disabled'} title="${esc(t(`devText.${c}`))}${n.fresh ? t('dev.fresh') : ''}">
        ${DEV_INFO[c].icon} ${t(`dev.${c}`)} ×${n.ready + n.fresh}</button>`;
    }).join('');

    const bld = (what: 'road' | 'settlement' | 'city', label: string, icon: string, left: number) => {
      const ok = actions && canAfford(s, this.seat, what) && left > 0;
      // affordable, but is there anywhere legal to put it?
      const spots = !ok ? 1 : (what === 'road' ? validRoadSpots : what === 'settlement' ? validSettlementSpots : validCitySpots)(s, this.seat).length;
      if (ok && spots === 0) {
        return `<button class="build blocked" data-a="noSpot" data-v="${what}" title="${esc(t(`noSpot.${what}`))}">
          <span>${icon} ${label}</span><span class="costs">${costHtml(COSTS[what])}</span><small>${t('btn.noSpot')}</small></button>`;
      }
      return `<button class="build ${this.mode === what ? 'on' : ''}" data-a="mode" data-v="${what}" ${ok ? '' : 'disabled'}>
        <span>${icon} ${label}</span><span class="costs">${costHtml(COSTS[what])}</span><small>${t('btn.left', { n: left })}</small></button>`;
    };

    const controls = s.phase !== 'main' ? '' : `
      ${mine && s.stage === 'roll' && !this.rolling ? `<button class="primary big" data-a="roll">${t('btn.roll')}</button>` : ''}
      ${bld('road', t('btn.road'), '🛤️', me.roadsLeft)}
      ${bld('settlement', t('btn.settlement'), '🏠', me.settlementsLeft)}
      ${bld('city', t('btn.city'), '🏰', me.citiesLeft)}
      <button class="build" data-a="buyDev" ${actions && canAfford(s, this.seat, 'dev') && s.devDeck.length ? '' : 'disabled'}>
        <span>🃏 ${t('btn.fortune')}</span><span class="costs">${costHtml(COSTS.dev)}</span><small>${t('btn.left', { n: s.devDeck.length })}</small></button>
      <button class="build" data-a="trade" ${actions ? '' : 'disabled'}><span>🤝 ${t('btn.trade')}</span><small>${t('btn.tradeSub')}</small></button>
      ${mine && s.stage === 'actions' ? `<button class="primary" data-a="end">${t('btn.end')}</button>` : ''}`;

    // incoming / outgoing trade offer banner
    let offer = '';
    const tradeOffer = s.trade;
    if (tradeOffer) {
      if (tradeOffer.from === this.seat) {
        const declined = tradeOffer.declined.map((i) => esc(s.players[i].name)).join(', ');
        offer = `<div class="offer">${t('offer.mine', { give: fmt(tradeOffer.give), get: fmt(tradeOffer.get) })} ${declined ? `<small>${t('offer.declined', { names: declined })}</small>` : `<small>${t('offer.waiting')}</small>`}
          <button data-a="cancelOffer">${t('offer.cancel')}</button></div>`;
      } else if (!tradeOffer.declined.includes(this.seat)) {
        const can = RESOURCES.every((r) => me.hand[r] >= (tradeOffer.get[r] ?? 0));
        offer = `<div class="offer incoming">${t('offer.incoming', { name: esc(s.players[tradeOffer.from].name), give: fmt(tradeOffer.give), get: fmt(tradeOffer.get) })}
          <button class="primary" data-a="accept" data-v="${tradeOffer.id}" ${can ? '' : 'disabled'}>${t('offer.accept')}</button>
          <button data-a="decline" data-v="${tradeOffer.id}">${t('offer.decline')}</button></div>`;
      }
    }

    const log = s.log.slice(-60).map((l) => `<div>${tr(l, true)}</div>`).join('');

    this.root.innerHTML = `
      <div id="top">
        <div class="brand">⬢ Hexhold <button class="code" data-a="copy" title="${t('hud.copyRoom')}">${t('hud.room', { code: esc(this.code) })}</button></div>
        <div class="status">${this.status(s)}</div>
        ${dice}
        <div class="topbtns"><button data-a="lang" class="langtop">${t('hud.switchLang')}</button><button data-a="help" title="${t('hud.rules')}">?</button><button data-a="log" title="${t('hud.logTitle')}">📜</button></div>
      </div>
      <div id="players">${players}</div>
      <div id="log" class="${this.logOpen ? 'open' : ''}"><h4>${t('hud.log')}</h4><div class="lines">${log}</div></div>
      ${offer}
      <div id="bottom">
        <div class="hand">${hand}${devs ? `<div class="devs">${devs}</div>` : ''}</div>
        <div class="controls">${controls}</div>
      </div>
      ${this.modalHtml(s)}
`;
    const lines = this.root.querySelector('#log .lines');
    if (lines) lines.scrollTop = lines.scrollHeight;
  }

  private modalHtml(s: GameState): string {
    const me = s.players[this.seat];
    const wrap = (title: string, body: string, closable = true) =>
      `<div class="modal-bg"><div class="modal"><h3>${title}</h3>${body}${closable ? '<button class="close" data-a="close">✕</button>' : ''}</div></div>`;

    if (s.phase === 'ended') {
      const ranking = s.players.map((p, i) => ({ p, vp: victoryPoints(s, i) })).sort((a, b) => b.vp - a.vp);
      return wrap(t('st.wins', { name: esc(s.players[s.winner!].name) }),
        `<ol class="rank">${ranking.map((r) => `<li style="--pc:${r.p.color}"><span class="dot"></span>${t('m.pts', { name: esc(r.p.name), n: r.vp })}</li>`).join('')}</ol>
         <p>${t('m.reload')}</p>`, false);
    }

    const need = s.stage === 'discard' ? s.pendingDiscards[this.seat] : 0;
    if (need) {
      const key = `${s.turnNumber}-${need}`;
      if (key !== this.discardKey) { this.discardKey = key; this.discard = emptyRes(); }
      const chosen = totalRes(this.discard);
      return wrap(t('m.discardTitle', { n: need }),
        `<div class="pickers">${RESOURCES.map((r) => `<div class="picker">${resChip(r, me.hand[r])}
          <button data-a="disc" data-v="${r}:-1">−</button><b>${this.discard[r]}</b><button data-a="disc" data-v="${r}:1">+</button></div>`).join('')}</div>
         <button class="primary" data-a="doDiscard" ${chosen === need ? '' : 'disabled'}>${t('m.discardBtn', { a: chosen, b: need })}</button>`, false);
    }

    if (s.stage === 'steal' && s.current === this.seat) {
      return wrap(t('m.stealTitle'), `<div class="row">${s.stealFrom.map((i) =>
        `<button class="steal" style="--pc:${s.players[i].color}" data-a="steal" data-v="${i}"><span class="dot"></span>${esc(s.players[i].name)} (${t('m.cardsN', { n: totalRes(s.players[i].hand) })})</button>`).join('')}</div>`, false);
    }

    const m = this.modal;
    if (!m) return '';
    if (m.kind === 'help') {
      return wrap(t('m.help'), `<div class="help">${t('help.body', { n: WIN_POINTS })}</div>`);
    }
    if (m.kind === 'pick') {
      const need = m.card === 'harvest' ? 2 : 1;
      return wrap(`${DEV_INFO[m.card].icon} ${t('m.pickTitle', { card: t(`dev.${m.card}`), n: need - m.picks.length })}`,
        `<p>${t(`devText.${m.card}`)}</p><div class="row">${RESOURCES.map((r) =>
          `<button class="respick" data-a="pickRes" data-v="${r}">${RES_INFO[r].icon} ${resLabel(r)}</button>`).join('')}</div>
          ${m.picks.length ? `<p>${t('m.picked', { list: m.picks.map((r) => RES_INFO[r].icon).join(' ') })}</p>` : ''}`);
    }
    // trade
    const rates = tradeRates(s, this.seat);
    const tabs = `<div class="tabs"><button class="${m.tab === 'bank' ? 'on' : ''}" data-a="tab" data-v="bank">${t('m.tabBank')}</button>
      <button class="${m.tab === 'players' ? 'on' : ''}" data-a="tab" data-v="players">${t('m.tabPlayers')}</button></div>`;
    if (m.tab === 'bank') {
      const gives = RESOURCES.map((r) => `<button class="respick ${m.bankGive === r ? 'on' : ''}" data-a="bankGive" data-v="${r}" ${me.hand[r] >= rates[r] ? '' : 'disabled'}>
        ${rates[r]}× ${RES_INFO[r].icon}</button>`).join('');
      const gets = RESOURCES.map((r) => `<button class="respick ${m.bankGet === r ? 'on' : ''}" data-a="bankGet" data-v="${r}" ${s.bank[r] > 0 && r !== m.bankGive ? '' : 'disabled'}>
        1× ${RES_INFO[r].icon}</button>`).join('');
      return wrap(t('m.trade'), `${tabs}<p>${t('m.give')}</p><div class="row">${gives}</div><p>${t('m.get')}</p><div class="row">${gets}</div>
        <button class="primary" data-a="doBank" ${m.bankGive && m.bankGet && m.bankGive !== m.bankGet ? '' : 'disabled'}>${t('m.doBank')}</button>`);
    }
    const side = (k: 'give' | 'get') => `<div class="pickers">${RESOURCES.map((r) => `<div class="picker">${resChip(r, k === 'give' ? me.hand[r] : undefined)}
      <button data-a="adj" data-v="${k}:${r}:-1">−</button><b>${m[k][r]}</b><button data-a="adj" data-v="${k}:${r}:1">+</button></div>`).join('')}</div>`;
    return wrap(t('m.trade'), `${tabs}<p>${t('m.give')}</p>${side('give')}<p>${t('m.want')}</p>${side('get')}
      <button class="primary" data-a="offer" ${totalRes(m.give) && totalRes(m.get) ? '' : 'disabled'}>${t('m.offer')}</button>`);
  }
}
