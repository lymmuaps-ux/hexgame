import { GEO } from '../game/board';
import { GOODS_INFO, GameState } from '../game/types';
import { t } from '../i18n';
import type { LocalControls } from '../net/session';

/**
 * Interactive tutorial for Guildlands: a coach panel walks the player through a private
 * practice game. "Do" steps wait until the player has actually done the thing; the
 * tutorial can load the dice and hand out goods so each lesson happens right away.
 * Later stages (knights, barbarians, progress cards) add their own steps here.
 */

interface Step {
  key: string;
  /** element(s) to make glow while this step is shown */
  highlight?: string;
  /** set up the lesson (give goods, load the dice …) */
  enter?: (c: LocalControls) => void;
  /** a "do" step: done when this returns true. Steps without it show a Next button. */
  done?: (s: GameState) => boolean;
}

let turnAtStep = 0;
let raiderAtStep = -1;
const mine = (s: GameState) => Object.values(s.buildings).filter((b) => b.owner === 0);

/** load the dice so the next roll hits a tile next to the player's city, preferring one that makes goods */
function loadDiceForCity(c: LocalControls) {
  const s = c.state();
  const city = Object.entries(s.buildings).find(([, b]) => b.owner === 0 && b.kind === 'city');
  if (!city) return;
  const hexes = GEO.vertices[Number(city[0])].hexes.map((h) => s.hexes[h]).filter((h) => h.number && h.id !== s.raider);
  const goodsTypes = Object.values(GOODS_INFO).map((g) => g.from);
  const best = hexes.find((h) => goodsTypes.includes(h.type as never)) ?? hexes[0];
  if (!best?.number) return;
  const sum = best.number;
  const a = Math.max(1, Math.min(6, sum - 1 - Math.floor(Math.random() * 2)));
  const d1 = Math.min(6, Math.max(sum - 6, a));
  c.setNextRoll([d1, sum - d1]);
}

const STEPS: Step[] = [
  { key: 'welcome' },
  { key: 'settle', done: (s) => mine(s).length >= 1 },
  { key: 'road1', done: (s) => Object.values(s.roads).length >= 1 },
  { key: 'city', done: (s) => mine(s).some((b) => b.kind === 'city') },
  { key: 'road2', done: (s) => s.phase === 'main' },
  { key: 'roll', highlight: 'button[data-a=roll]', enter: loadDiceForCity, done: (s) => s.stage !== 'roll' },
  { key: 'goods', highlight: '.hand .card.good' },
  {
    key: 'improve1', highlight: 'button[data-a=improveOpen], .track:first-of-type button[data-a=improve]',
    enter: (c) => c.patch((s) => { s.players[0].goods!.cloth += 1; }),
    done: (s) => (s.players[0].levels?.trade ?? 0) >= 1,
  },
  {
    key: 'improve3', highlight: 'button[data-a=improveOpen], .track:first-of-type button[data-a=improve]',
    enter: (c) => c.patch((s) => { s.players[0].goods!.cloth += 5; }),
    done: (s) => (s.players[0].levels?.trade ?? 0) >= 3,
  },
  { key: 'bonuses' },
  {
    key: 'metro', highlight: 'button[data-a=improveOpen], .track:first-of-type button[data-a=improve]',
    enter: (c) => c.patch((s) => { s.players[0].goods!.cloth += 4; }),
    done: (s) => s.metropolis?.trade === 0,
  },
  { key: 'metroInfo' },
  {
    key: 'wall', highlight: 'button[data-a=mode][data-v=wall]',
    enter: (c) => c.patch((s) => { s.players[0].hand.clay += 2; }),
    done: (s) => mine(s).some((b) => b.wall),
  },
  { key: 'wallInfo' },
  // ---------------------------------------------------------------- knights
  { key: 'kIntro' },
  {
    key: 'kRecruit', highlight: 'button[data-a=mode][data-v=knight]',
    enter: (c) => c.patch((s) => { s.players[0].hand.wool += 1; s.players[0].hand.ore += 1; }),
    done: (s) => Object.values(s.knights ?? {}).some((k) => k.owner === 0),
  },
  {
    key: 'kActivate', highlight: 'button[data-a=knightsOpen], .kaction[data-v=kact]',
    enter: (c) => c.patch((s) => { s.players[0].hand.grain += 1; }),
    done: (s) => Object.values(s.knights ?? {}).some((k) => k.owner === 0 && k.active),
  },
  {
    key: 'kEndTurn', highlight: 'button[data-a=end]',
    enter: (c) => (turnAtStep = c.state().turnNumber),
    done: (s) => s.turnNumber > turnAtStep,
  },
  { key: 'kRoll', highlight: 'button[data-a=roll]', enter: (c) => c.setNextRoll([2, 3]), done: (s) => s.stage !== 'roll' },
  {
    key: 'kPromote', highlight: 'button[data-a=knightsOpen], .kaction[data-v=kpro]',
    enter: (c) => c.patch((s) => { s.players[0].hand.wool += 1; s.players[0].hand.ore += 1; }),
    done: (s) => Object.values(s.knights ?? {}).some((k) => k.owner === 0 && k.level >= 2),
  },
  {
    key: 'kMove', highlight: 'button[data-a=knightsOpen], .kaction[data-v=kmove]',
    // lay a road from the knight to a free corner so it has somewhere to go
    enter: (c) => c.patch((s) => {
      const v = Number(Object.entries(s.knights ?? {}).find(([, k]) => k.owner === 0)?.[0]);
      const e = GEO.vertices[v]?.edges.find((id) => {
        const ed = GEO.edges[id];
        const n = ed.a === v ? ed.b : ed.a;
        return s.roads[id] === undefined && !s.buildings[n] && !s.knights?.[n];
      });
      if (e !== undefined) {
        s.roads[e] = 0;
        s.players[0].roadsLeft--;
      }
    }),
    done: (s) => Object.values(s.knights ?? {}).some((k) => k.owner === 0 && k.actedTurn === s.turnNumber),
  },
  {
    key: 'kChase', highlight: 'button[data-a=knightsOpen], .kaction[data-v=kchase]',
    // wake the knight again and park the robber next to it for this lesson
    enter: (c) => c.patch((s) => {
      const [vs, k] = Object.entries(s.knights ?? {}).find(([, k]) => k.owner === 0) ?? [];
      if (!k || vs === undefined) return;
      k.active = true;
      delete k.activatedTurn;
      delete k.actedTurn;
      const hex = GEO.vertices[Number(vs)].hexes.find((h) => h !== s.raider) ?? GEO.vertices[Number(vs)].hexes[0];
      s.raider = hex;
      raiderAtStep = hex;
    }),
    done: (s) => s.raider !== raiderAtStep && s.stage === 'actions',
  },
  { key: 'kInfo' },
  { key: 'finish' },
];

export class Tutorial {
  private i = 0;
  private el: HTMLElement;
  private glowTimer = 0;
  private entered = -1;

  constructor(layer: HTMLElement, private c: LocalControls, private onLeave: () => void, private onCloseModal: () => void) {
    this.el = document.createElement('div');
    this.el.className = 'coach';
    layer.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'next') this.go(this.i + 1);
      else if (b.dataset.t === 'leave') this.onLeave();
      else if (b.dataset.t === 'practice') this.close();
    });
    // the HUD redraws often: keep re-applying the highlight
    this.glowTimer = window.setInterval(() => this.glow(), 400);
    this.render();
  }

  /** called with every new game state */
  onState(s: GameState) {
    const step = STEPS[this.i];
    if (!step) return;
    if (this.entered !== this.i) {
      this.entered = this.i;
      step.enter?.(this.c);
      // setting up the lesson may have changed the game: judge "done" on the current state
      s = this.c.state();
    }
    if (step.done?.(s)) {
      // let the player see what happened before moving on
      setTimeout(() => this.i === STEPS.indexOf(step) && this.go(this.i + 1), 900);
    }
  }

  private go(n: number) {
    this.i = Math.min(n, STEPS.length - 1);
    this.onCloseModal();
    this.render();
    this.onState(this.c.state());
  }

  private render() {
    const step = STEPS[this.i];
    const last = this.i === STEPS.length - 1;
    const doing = !!step.done;
    this.el.innerHTML = `
      <div class="coach-head"><b>🎓 ${t('tut.title')}</b><small>${t('tut.step', { a: this.i + 1, b: STEPS.length })}</small></div>
      <div class="coach-bar"><i style="width:${((this.i + 1) / STEPS.length) * 100}%"></i></div>
      <p>${t(`tut.s.${step.key}`)}</p>
      ${doing ? `<p class="coach-wait">👉 ${t('tut.waiting')}</p>` : ''}
      <div class="coach-btns">
        ${last ? `<button data-t="practice">${t('tut.practice')}</button><button class="primary" data-t="leave">${t('tut.done')}</button>`
          : `<button data-t="leave">${t('tut.skip')}</button>${doing ? '' : `<button class="primary" data-t="next">${t('tut.next')} ➜</button>`}`}
      </div>`;
    this.el.classList.remove('pop');
    void this.el.offsetWidth;
    this.el.classList.add('pop');
    this.glow();
  }

  private glow() {
    document.querySelectorAll('.tut-glow').forEach((e) => e.classList.remove('tut-glow'));
    const sel = STEPS[this.i]?.highlight;
    if (sel) document.querySelectorAll(sel).forEach((e) => e.classList.add('tut-glow'));
  }

  close() {
    clearInterval(this.glowTimer);
    document.querySelectorAll('.tut-glow').forEach((e) => e.classList.remove('tut-glow'));
    this.el.remove();
  }
}
