import Phaser from 'phaser';
import { MOODS, backdrop } from './fx/Backdrops';
import type { PixelText } from './ui/BitmapFont';
import { SoundManager } from '../audio/SoundManager';
import { type DebriefSummary, applyMissionResult } from '../core/campaign/debrief';
import { campaign } from '../core/campaign/session';
import type { Contract } from '../core/campaign/state';
import { XP_PER_LEVEL } from '../core/data/rules';
import { abilityDef, classDef, itemDef } from '../core/rules/lookup';
import type { MissionResult } from '../core/tactical/mission';
import { addUnit, unitLookOf } from './iso/UnitLooks';
import { BASE_W, Motes, PAL, button, campfire, cut, enter, goto, label, panel, parseColor } from './ui/Kit';
import { Save, Tip, itemIconImage, itemTip, portrait } from './ui/Widgets';

// Podsumowanie misji (port Oldgame/src/scenes/debrief.js): rozliczenie w src/core/campaign/debrief.ts,
// tu tylko animowane odsłanianie nagród i awansów -> Przystań / zwycięstwo / koniec gry.

export interface DebriefSceneData {
  result: MissionResult;
  contract: Contract;
}

const HEAD: Record<string, [string, number]> = { success: ['ZLECENIE WYKONANE', PAL.good], retreat: ['ODWRÓT', PAL.amber], fail: ['PORAŻKA', PAL.bad] };
const PX = 24, PY = 14, PW = BASE_W - 48, PH = 228;

export class DebriefScene extends Phaser.Scene {
  private bgUpdate: (t: number, dt: number) => void = () => {};
  private bgT = 0;
  private input_!: DebriefSceneData;
  private sum!: DebriefSummary;
  private queue: { t: number; fn: () => void }[] = [];
  private t = 0;
  private count: { text: PixelText; to: number; v: number } | null = null;
  private fire: (t: number) => void = () => {};
  private dust: Motes | null = null;
  private box!: Phaser.GameObjects.Container;
  private tip!: Tip;

  constructor() {
    super('DebriefScene');
  }

  init(data: DebriefSceneData): void {
    this.input_ = data;
    // dev: ?scene=DebriefScene pokazuje przykładowy wynik (Oldgame/src/scenes/debrief.js:51)
    if (!data?.result && import.meta.env.DEV && new URLSearchParams(window.location.search).get('scene') === 'DebriefScene') {
      const c = campaign.state.contracts[0];
      if (c) this.input_ = { contract: c, result: { contractId: c.id, result: 'success', xp: c.reward.xp, loot: [], scrap: 25, casualties: [] } };
    }
  }

  create(): void {
    enter(this);
    if (!this.input_?.result) {
      this.scene.start('HubScene');
      return;
    }
    this.t = 0;
    this.queue = [];
    this.count = null;
    const sum = (this.sum = applyMissionResult(campaign.state, this.input_.result, this.input_.contract));
    const ok = sum.result === 'success';
    // Oldgame/src/scenes/debrief.js:44 - po TPK zapis zostaje (ekran porażki proponuje "Wczytaj ostatni zapis").
    if (!sum.tpk) Save.write();

    this.bgT = 0;
    this.bgUpdate = backdrop(this, 'debrief', ok
      ? { mood: MOODS.dusk, seed: 8, orb: [240, 222, 24], farBase: 240, midBase: 246, midH: [40, 150], groundY: 248, clouds: 9 }
      : { mood: MOODS.night, seed: 8, orb: [400, 30, 10], farBase: 240, midBase: 246, midH: [40, 150], groundY: 248, clouds: 6 });
    this.fire = campfire(this, BASE_W / 2, 264, 1.3, 2);
    campaign.state.party.forEach((ch, i, a) => addUnit(this, BASE_W / 2 + (i - (a.length - 1) / 2) * 30 + (i >= a.length / 2 ? 14 : -14), 266, `pc_${ch.recruitId ?? ch.id}`, unitLookOf(ch)).setDepth(3).setFlipX(i >= a.length / 2));
    this.dust = new Motes(this, 50, { x: 0, y: 150, w: BASE_W, h: 120 }, 0xf0c080, 9, 1, 3, 0.4, 1);

    this.box = panel(this, PX, PY, PW, PH, PAL.edgeHi, 0.96).setDepth(10);
    this.tip = new Tip(this);
    const [head, col] = HEAD[sum.result] ?? ['KONIEC', PAL.amber];
    this.box.add(label(this, PW / 2, 6, head, { size: 14, bold: true, color: col }).setOrigin(0.5, 0));
    this.box.add(label(this, PW / 2, 24, sum.contract?.title ?? this.input_.contract.title, { size: 7, color: PAL.dim }).setOrigin(0.5, 0));
    this.script();

    SoundManager.music(ok ? 'victory' : 'defeat');
    SoundManager.ambience('wind');
  }

  private reveal<T extends Phaser.GameObjects.GameObject & { setAlpha(a: number): unknown }>(o: T, sfx?: Parameters<typeof SoundManager.sfx>[0]): T {
    o.setAlpha(0);
    this.box.add(o);
    this.tweens.add({ targets: o, alpha: 1, duration: 380 });
    if (sfx) SoundManager.sfx(sfx);
    return o;
  }

  private script(): void {
    const r = this.sum;
    let t = 0.4;
    const at = (d: number, fn: () => void): void => {
      this.queue.push({ t: (t += d), fn });
    };
    const LX = 10, RX = 196, RW = PW - RX - 10;
    let ly = 42;
    const line = (s: string, color: number = PAL.text, size = 7): PixelText => {
      const tx = label(this, LX, ly, s, { size, color, wrap: RX - LX - 10 });
      ly += tx.displayHeight + 4;
      return tx;
    };
    at(0.2, () => {
      const k = this.reveal(label(this, LX, ly, 'Złom: ', { size: 9 }), 'coin');
      const v = this.reveal(label(this, LX + k.displayWidth, ly, '+0', { size: 9, bold: true, color: PAL.amber }));
      ly += 14;
      this.count = { text: v, to: r.scrap, v: 0 };
    });
    if (r.stolen) at(0.3, () => this.reveal(line(`(w tym ${r.stolen} z kradzieży Szczura)`, PAL.dim, 6)));
    at(0.8, () => this.reveal(line(`Doświadczenie: +${r.xp} PD dla każdego żywego najemnika`, PAL.toxic)));
    const rep = Object.entries(r.rep) as [string, number][];
    if (rep.length) at(0.5, () => this.reveal(line('Reputacja: ' + rep.map(([f, v]) => `${f === 'nomads' ? 'Nomadzi' : 'Ocaleni'} ${v > 0 ? '+' : ''}${v}`).join(', '), rep.some(([, v]) => v < 0) ? PAL.bad : PAL.good)));
    if (r.food) at(0.5, () => this.reveal(line(`Żywność dla Przystani: +${r.food} dn. zapasów`, PAL.good), 'pickup'));
    if (r.foodNotes.length) at(0.4, () => this.reveal(line(r.foodNotes.join(' '), PAL.bad, 6)));
    if (r.civiliansLost.length) at(0.45, () => this.reveal(line(`Zginęli od waszego ognia: ${r.civiliansLost.join(', ')}${r.civilianFine ? ` (-${r.civilianFine} Złomu z nagrody)` : ''}`, PAL.bad, 6)));
    if (r.items.length)
      at(0.5, () => {
        this.reveal(line('Łup:', PAL.dim, 6), 'pickup');
        // cały łup: te same przedmioty łączone w stosy (xN); gdy lista z nazwami nie mieści się w panelu - zwarta siatka ikon
        const stacks = new Map<string, number>();
        for (const id of r.items) stacks.set(id, (stacks.get(id) ?? 0) + 1);
        const list = [...stacks.entries()];
        const reserve = (r.fallen.length ? 14 : 0) + (r.story ? 14 : 0) + (r.foodNotes.length ? 14 : 0) + (r.civiliansLost.length ? 14 : 0);
        const room = PH - 28 - reserve - ly;
        const namedRows = Math.ceil(list.length / 2);
        if (namedRows * 13 <= room) {
          list.forEach(([id, n], i) => {
            const x = LX + (i % 2) * 90, y = ly + Math.floor(i / 2) * 13;
            const hit = this.add.rectangle(x, y, 86, 12, 0x000000, 0.3).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive();
            this.tip.attach(hit, () => itemTip(id));
            this.reveal(hit);
            this.reveal(itemIconImage(this, x + 1, y + 1, id, 10));
            this.reveal(label(this, x + 14, y + 2.5, cut(itemDef(id)?.name ?? id, n > 1 ? 14 : 17) + (n > 1 ? ` ×${n}` : ''), { size: 5.5 }));
          });
          ly += namedRows * 13 + 4;
        } else {
          const CELL = 15, cols = Math.floor((RX - LX - 8) / CELL);
          list.forEach(([id, n], i) => {
            const x = LX + (i % cols) * CELL, y = ly + Math.floor(i / cols) * CELL;
            const hit = this.add.rectangle(x, y, CELL - 1, CELL - 1, 0x000000, 0.3).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive();
            this.tip.attach(hit, () => itemTip(id, n > 1 ? `\nZdobyto: ×${n}` : ''));
            this.reveal(hit);
            this.reveal(itemIconImage(this, x + 1, y + 1, id, 12));
            if (n > 1) this.reveal(label(this, x + CELL - 2, y + CELL - 7, String(n), { size: 5, bold: true, color: PAL.amber }).setOrigin(1, 0));
          });
          ly += Math.ceil(list.length / cols) * CELL + 4;
        }
      });
    if (r.fallen.length) at(0.6, () => this.reveal(line('Polegli: ' + r.fallen.join(', '), PAL.bad), 'death'));
    if (r.story) at(0.6, () => this.reveal(line(r.win ? '★ Kostucha nie żyje!' : '★ Wątek fabularny posunął się naprzód.', PAL.amber), 'levelup'));

    // najemnicy: pasek PD dobiega do nowej wartości, awans z listą nowych zdolności
    r.members.forEach(({ member: m, before, levelsGained, newAbilities }, i) => {
      at(i === 0 ? 0.5 : 0.35, () => {
        const y = 42 + i * 42;
        this.reveal(this.add.rectangle(RX, y, RW, 38, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, levelsGained ? PAL.amber : PAL.edge));
        this.reveal(portrait(this, RX + 3, y + 3, m, 32));
        this.reveal(label(this, RX + 40, y + 3, cut(m.name, 24), { size: 7, bold: true, color: parseColor(m.nameColor, PAL.text) }));
        const sub = this.reveal(label(this, RX + 40, y + 13, `${classDef(m.classId)?.name ?? m.classId} · poz. ${before.level}`, { size: 6, color: PAL.dim }));
        this.reveal(this.add.rectangle(RX + 40, y + 24, RW - 90, 4, 0x3a2c10).setOrigin(0));
        const fill = this.reveal(this.add.rectangle(RX + 40, y + 24, 1, 4, PAL.amber).setOrigin(0));
        const xpt = this.reveal(label(this, RX + RW - 46, y + 22, `${before.xp}/${XP_PER_LEVEL}`, { size: 6 }));
        const full = RW - 90;
        const state = { k: before.xp / XP_PER_LEVEL };
        const end = levelsGained + (m.xp || 0) / XP_PER_LEVEL;
        this.tweens.add({
          targets: state, k: end, duration: 1100, ease: 'Sine.easeInOut',
          onUpdate: () => {
            const frac = state.k >= end ? end - Math.floor(end) : state.k - Math.floor(state.k);
            fill.setSize(Math.max(1, Math.round(full * frac)), 4);
            xpt.setText(`${Math.round(frac * XP_PER_LEVEL)}/${XP_PER_LEVEL}`);
          },
          onComplete: () => {
            xpt.setText(`${m.xp || 0}/${XP_PER_LEVEL}`);
            if (!levelsGained) return;
            SoundManager.sfx('levelup');
            sub.setText(`${classDef(m.classId)?.name ?? m.classId} · poz. ${before.level} → ${m.level} · PW ${before.maxHp} → ${m.maxHp}`).setColor('#f2a93b');
            const names = newAbilities.map((id) => abilityDef(id)?.name ?? id);
            this.reveal(label(this, RX + 40, y + 30, cut(`AWANS!${names.length ? ' Nowe: ' + names.join(', ') : ''}`, 48), { size: 5.5, bold: true, color: PAL.toxic }));
          },
        });
      });
    });
    at(1.6, () => {
      const next = r.tpk ? 'Dalej ▶' : r.win ? 'Epilog ▶' : 'Wróć do Przystani ▶';
      const b = button(this, 10, PH - 24, next, () => this.leave(), { primary: true, w: 120, h: 18, size: 8 });
      this.reveal(b.box);
      this.input.keyboard?.once('keydown-ENTER', () => this.leave());
    });
  }

  private leave(): void {
    const r = this.sum;
    if (r.tpk) goto(this, 'GameOverScene', { fallen: r.fallen });
    else if (r.win) goto(this, 'VictoryScene');
    else goto(this, 'HubScene');
  }

  update(_time: number, delta: number): void {
    this.bgT += Math.min(delta / 1000, 0.1);
    this.bgUpdate(this.bgT, Math.min(delta / 1000, 0.1));
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    this.fire(this.t);
    this.dust?.update(dt);
    while (this.queue.length && this.queue[0].t <= this.t) this.queue.shift()!.fn();
    const c = this.count;
    if (c && c.v !== c.to) {
      const step = Math.max(1, Math.ceil(Math.abs(c.to - c.v) * dt * 4));
      c.v = c.v < c.to ? Math.min(c.to, c.v + step) : Math.max(c.to, c.v - step);
      c.text.setText(`${c.v >= 0 ? '+' : ''}${c.v}`);
    }
  }
}
