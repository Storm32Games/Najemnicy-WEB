import Phaser from 'phaser';
import { SoundManager } from '../../audio/SoundManager';
import { shortName } from '../../core/data/names';
import { ATTRS, ATTR_NAMES, PROF_NAMES, SKILLS, XP_PER_LEVEL } from '../../core/data/rules';
import type { SkillId } from '../../core/data/types';
import { itemStatLine } from '../../core/HudState';
import { abilityDef, ancestryOf, classDef, itemDef } from '../../core/rules/lookup';
import { getStat } from '../../core/rules/stats';
import type { Character, EquipSlot, ItemInstance } from '../../core/rules/types';
import { PAL, button, cut, label, parseColor, uiBg } from './Kit';
import { ScrollList, Tip, type Window, abilityIconImage, bar, itemIconImage, itemTip, openWindow, portrait } from './Widgets';

// Okno "Drużyna" na mapie misji: podgląd najemników jak w zakładce Drużyna Przystani (HubScene.draw_party),
// tylko do odczytu - ekwipunek zmienia się w misji kartą EKWIPUNEK, a skrytka drużyny zostaje w Przystani.

const W = 372, H = 258;
const SLOTS: [EquipSlot, string][] = [['weapon', 'Broń główna'], ['weapon2', 'Broń zapasowa'], ['armor', 'Pancerz'], ['shield', 'Tarcza']];
const signed = (n: number): string => (n >= 0 ? '+' : '') + n;
const DIM_OFF = 0x6a5f4c;

/** Jedna podpowiedź na scenę (Tip trzyma własny kontener nad oknami). */
function tipOf(scene: Phaser.Scene): Tip {
  let tip = scene.data.get('partyWinTip') as Tip | undefined;
  if (!tip) {
    tip = new Tip(scene);
    scene.data.set('partyWinTip', tip);
  }
  return tip;
}

/** Otwiera okno Drużyna dla `party`; `start` = indeks pokazanej postaci. */
export function openPartyWindow(scene: Phaser.Scene, party: Character[], start = 0, onClose?: () => void): Window {
  const tip = tipOf(scene);
  const win = openWindow(scene, W, H, 'Drużyna', () => {
    tip.hide();
    onClose?.();
  });
  let idx = Phaser.Math.Clamp(start, 0, Math.max(0, party.length - 1));
  let body: Phaser.GameObjects.Container | null = null;

  const draw = (): void => {
    tip.hide();
    body?.destroy();
    const B = (body = scene.add.container(0, 20));
    win.add(B);
    const L = (x: number, y: number, s: string, o: Parameters<typeof label>[4] = {}): ReturnType<typeof label> => {
      const t = label(scene, x, y, s, o);
      B.add(t);
      return t;
    };

    // ---- lista najemników (portrety)
    party.forEach((c, i) => {
      const y = i * 46, on = i === idx, dead = !!c.conditions.dead || c.hp <= 0;
      const bg = uiBg(scene.add.rectangle(6, y, 36, 43, on ? 0x3a2c1e : PAL.panel2, 1).setOrigin(0)).setStrokeStyle(1, on ? PAL.amber : PAL.edge).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        if (idx === i) return;
        SoundManager.sfx('click');
        idx = i;
        draw();
      });
      const p = portrait(scene, 9, y + 3, c, 30);
      if (dead) p.setAlpha(0.45);
      B.add([bg, p]);
      L(24, y + 35, cut(shortName(c.name), 8), { small: true, size: 5.5, color: dead ? PAL.bad : parseColor(c.nameColor, PAL.text) }).setOrigin(0.5, 0);
    });
    const ch = party[idx];
    if (!ch) return;

    // ---- nagłówek
    const X0 = 48;
    B.add(portrait(scene, X0, 0, ch, 40));
    L(X0 + 46, 0, cut(ch.name, 30), { small: true, size: 9, bold: true, color: parseColor(ch.nameColor, PAL.amber) });
    L(X0 + 46, 13, `${classDef(ch.classId)?.name ?? ch.classId} · ${ancestryOf(ch.ancestry).name} · poz. ${ch.level}`, { small: true, size: 6.5, color: PAL.amber });
    const xpK = (ch.xp || 0) / XP_PER_LEVEL, hpK = Math.max(0, ch.hp) / Math.max(1, ch.maxHp);
    L(X0 + 46, 24, 'PD', { small: true, size: 6, color: PAL.dim });
    B.add(bar(scene, X0 + 60, 26, 90, 4, xpK, PAL.amber, 0x3a2c10));
    L(X0 + 154, 24, `${ch.xp || 0}/${XP_PER_LEVEL}`, { small: true, size: 6 });
    L(X0 + 46, 33, 'PW', { small: true, size: 6, color: PAL.dim });
    B.add(bar(scene, X0 + 60, 35, 90, 4, hpK, hpK < 0.34 ? PAL.bad : PAL.good));
    L(X0 + 154, 33, `${Math.max(0, ch.hp)}/${ch.maxHp}`, { small: true, size: 6 });

    const Y0 = 46;
    const box = (x: number, y: number, w: number, h: number, title: string): void => {
      B.add(uiBg(scene.add.rectangle(x, y, w, h, 0x000000, 0.25).setOrigin(0), true).setStrokeStyle(1, PAL.edge));
      L(x + 3, y + 2, title.toUpperCase(), { small: true, size: 5.5, bold: true, color: PAL.amber });
    };
    const kv = (x: number, y: number, w: number, k: string, v: string, color: number = PAL.text): void => {
      L(x, y, k, { small: true, size: 6, color: PAL.dim });
      L(x + w, y, v, { small: true, size: 6, bold: true, color }).setOrigin(1, 0);
    };

    // ---- kolumna 1: cechy + obrona
    const C1 = X0, W1 = 84;
    box(C1, Y0, W1, 62, 'Cechy');
    ATTRS.forEach((a, i) => kv(C1 + 4, Y0 + 11 + i * 8, W1 - 8, ATTR_NAMES[a], signed(ch.attrs[a]), ch.attrs[a] > 0 ? PAL.good : ch.attrs[a] < 0 ? PAL.bad : PAL.text));
    box(C1, Y0 + 65, W1, 70, 'Obrona');
    const defs: [string, string, number?][] = [
      ['KP', String(getStat(ch, 'ac')), PAL.amber], ['Percepcja', signed(getStat(ch, 'perception'))], ['Wytrzymałość', signed(getStat(ch, 'fortitude'))],
      ['Refleks', signed(getStat(ch, 'reflex'))], ['Wola', signed(getStat(ch, 'will'))], ['KT klasy', String(getStat(ch, 'classDC'))], ['Prędkość', `${getStat(ch, 'speed')} pól`],
    ];
    defs.forEach(([k, v, col], i) => kv(C1 + 4, Y0 + 76 + i * 8, W1 - 8, k, v, col));

    // ---- kolumna 2: umiejętności + ekwipunek
    const C2 = C1 + W1 + 4, W2 = 112;
    box(C2, Y0, W2, 100, 'Umiejętności');
    new ScrollList<SkillId>(scene, C2 + 3, Y0 + 11, W2 - 5, 88, 8, (id, row, w) => {
      const rank = (id as string) === 'perception' ? ch.prof.perception : ch.prof.skills[id] ?? 0;
      const col = rank ? PAL.text : DIM_OFF;
      row.add([
        label(scene, 0, 0, SKILLS[id].name, { small: true, size: 6, color: col }),
        label(scene, w - 16, 0.5, PROF_NAMES[rank]?.slice(0, 4) ?? '', { small: true, size: 5, color: PAL.dim }).setOrigin(1, 0),
        label(scene, w - 1, 0, signed(getStat(ch, id)), { small: true, size: 6, bold: true, color: col }).setOrigin(1, 0),
      ]);
    }, B).setItems(Object.keys(SKILLS) as SkillId[]);
    box(C2, Y0 + 103, W2, 66, 'Ekwipunek');
    SLOTS.forEach(([slot, name], i) => {
      const y = Y0 + 113 + i * 14, inst = ch.equipment[slot];
      const hit = uiBg(scene.add.rectangle(C2 + 2, y, W2 - 4, 13, 0x000000, 0.3).setOrigin(0), true).setStrokeStyle(1, PAL.edge).setInteractive();
      if (inst) tip.attach(hit, () => `${name}\n${itemTip(inst.id)}`);
      B.add(hit);
      if (inst) B.add(itemIconImage(scene, C2 + 3, y + 1, inst.id, 11));
      L(C2 + 16, y + 3, inst ? cut(itemDef(inst.id)?.name ?? inst.id, 22) : `— ${name.toLowerCase()} —`, { small: true, size: 6, color: inst ? PAL.text : PAL.dim });
    });

    // ---- kolumna 3: zdolności + plecak
    const C3 = C2 + W2 + 4, W3 = W - C3 - 6;
    box(C3, Y0, W3, 62, 'Zdolności');
    new ScrollList<string>(scene, C3 + 3, Y0 + 11, W3 - 5, 50, 8, (id, row, w) => {
      const a = abilityDef(id);
      if (!a) return;
      const cost = a.actions === 'reaction' ? 'reakcja' : a.actions === 0 ? 'darmowa' : `${a.actions} akc.`;
      const hit = scene.add.rectangle(0, 0, w, 8, 0, 0).setOrigin(0).setInteractive();
      tip.attach(hit, () => `${a.name} [${cost}]${a.uses ? ` · ${ch.uses[a.id as keyof typeof ch.uses] ?? '?'} użyć` : ''}\n${a.desc}`);
      row.add([hit, abilityIconImage(scene, 0, 0, id, 7), label(scene, 9, 0, cut(a.name, 13), { small: true, size: 6, color: PAL.toxic }), label(scene, w - 1, 0.5, cost, { small: true, size: 5, color: PAL.dim }).setOrigin(1, 0)]);
    }, B).setItems(ch.abilities);

    box(C3, Y0 + 65, W3, 104, 'Plecak');
    const pack = new ScrollList<ItemInstance>(scene, C3 + 2, Y0 + 75, W3 - 3, 93, 13, (inst, row, w) => {
      const def = itemDef(inst.id);
      const hit = uiBg(scene.add.rectangle(0, 0, w, 12, 0x000000, 0.25).setOrigin(0), true).setInteractive();
      tip.attach(hit, () => itemTip(inst.id));
      let right = w;
      if (inst.qty > 1) {
        const q = label(scene, 0, 3, `×${inst.qty}`, { size: 6, small: true, color: PAL.amber });
        const qw = Math.ceil(q.displayWidth) + 4;
        right = w - qw - 1;
        row.add([hit, uiBg(scene.add.rectangle(right, 1, qw, 10, 0x000000, 0.45).setOrigin(0), true).setStrokeStyle(1, PAL.edge), q.setPosition(right + 2, 3)]);
        right -= 2;
      } else row.add(hit);
      const nm = label(scene, 14, 3, def?.name ?? inst.id, { size: 6, small: true, maxW: right - 14 });
      row.add([itemIconImage(scene, 1, 1, inst.id, 10), nm]);
      const stat = itemStatLine(def, true);
      const sx = 14 + nm.displayWidth + 4;
      if (stat && right - sx >= 14) row.add(label(scene, sx, 3, stat, { size: 5, small: true, color: PAL.dim, maxW: right - sx }));
    }, B);
    pack.empty = 'Pusty.';
    pack.setItems(ch.inventory);
  };

  draw();
  win.add(button(scene, W - 62, H - 20, 'Zamknij', () => win.close(), { w: 54, size: 7 }).box);
  return win;
}
