import Phaser from 'phaser';
import { MOODS, backdrop } from './fx/Backdrops';
import { glow } from './fx/Painter';
import type { PixelText } from './ui/BitmapFont';
import { SoundManager } from '../audio/SoundManager';
import { FOOD_LOW, foodLow, foodOf, foodStatus } from '../core/campaign/food';
import { BIOME_NAMES, FACTION_NAMES, MOOD_NAMES, TYPE_NAMES, difficulty, refreshBoard, storyHint } from '../core/campaign/contracts';
import { buy, buyPrice, healAtClinic, healCost, nomadDiscount, restDay, sell, sellPrice, shopStock } from '../core/campaign/economy';
import { campaign, hireCost, hireRecruit, recruitCharacter, tavernRecruits } from '../core/campaign/session';
import { type Contract, MAX_PARTY, campaignPartyLevel } from '../core/campaign/state';
import { generateName, plainName, shortName } from '../core/data/names';
import { RECRUITS } from '../core/data/recruits';
import { ATTRS, ATTR_NAMES, PROF_NAMES, SKILLS, XP_PER_LEVEL } from '../core/data/rules';
import type { RecruitDef, SkillId } from '../core/data/types';
import { itemStatLine } from '../core/HudState';
import { useConsumable } from '../core/rules/consumables';
import { SLOT_TYPE, equip, moveItem, unequip } from '../core/rules/equipment';
import { abilityDef, ancestryOf, classDef, conditionDef, enemyDef, itemDef } from '../core/rules/lookup';
import { getStat } from '../core/rules/stats';
import type { Character, EquipSlot, ItemInstance } from '../core/rules/types';
import { addUnit, unitLookOf } from './iso/UnitLooks';
import { BASE_W, Motes, PAL, button, campfire, cut, enter, goto, label, panel, parseColor } from './ui/Kit';
import { Save, ScrollList, enterLoaded, Tip, type Tone, abilityIconImage, bar, dialog, escConsumed, itemIconImage, itemTip, miniButton, modalOpen, namePrompt, openOptions, openSaveSlots, openWindow, portrait, toast } from './ui/Widgets';

// Przystań (port Oldgame/src/scenes/hub.js): tablica zleceń, handlarz, lecznica, drużyna, karczma, zapis.
// Diorama 3D zastąpiona malowanym tłem; okna DOM - panelami Phasera.

type Tab = 'board' | 'shop' | 'heal' | 'party' | 'tavern';
const TITLES: Record<Tab, string> = { board: 'Tablica zleceń', shop: 'Handlarz Nomadów', heal: 'Lecznica', party: 'Drużyna', tavern: 'Karczma' };
const TONE = { good: PAL.good, amber: PAL.amber, bad: PAL.bad } as const;
const SLOTS: [EquipSlot, string][] = [['weapon', 'Broń główna'], ['weapon2', 'Broń zapasowa'], ['armor', 'Pancerz'], ['shield', 'Tarcza']];
const OBJECTIVE: Record<string, string> = {
  eliminate: 'Wyeliminuj wszystkich wrogów.', rescue: 'Odnajdź i uratuj jeńca.', hunt: 'Wytrop i zabij cel polowania.', boss: 'Zabij Kostuchę.',
  hack: 'Włam się do serwera i wróć z danymi.', liberate: 'Pokonaj szabrowników i uwolnij osadników.',
  purge: 'Zniszcz gniazda i wybij zmutowaną faunę.', defend: 'Odeprzyj kolejne fale napastników.',
  forage: 'Zbierz rozrzucone zapasy żywności i wróć z nimi do strefy ewakuacji.',
};

const WX = 6, WY = 22, WW = 376, WH = 242; // okno zakładki
const BY = 20, BH = WH - BY - 4; // obszar treści wewnątrz okna
const signed = (n: number): string => (n >= 0 ? '+' : '') + n;
const fmtRep = signed;

export interface HubSceneData {
  tab?: Tab;
  /** Skrót z URL (?scene=HubScene&open=board|shop|clinic|heal|party|tavern), jak params.open w Oldgame/src/scenes/hub.js:35. */
  open?: string;
  notice?: string;
  noticeTone?: Tone;
}

type LabelOpts = Parameters<typeof label>[4];

export class HubScene extends Phaser.Scene {
  private bgUpdate: (t: number, dt: number) => void = () => {};
  private bgT = 0;
  private tab: Tab = 'board';
  private sel: string | null = null;
  private charIdx = 0;
  private top!: Phaser.GameObjects.Container;
  private menu!: Phaser.GameObjects.Container;
  private win!: Phaser.GameObjects.Container;
  private body!: Phaser.GameObjects.Container;
  private title!: PixelText;
  private tip!: Tip;
  private entry: HubSceneData = {};
  private t = 0;
  private fire: (t: number) => void = () => {};
  private dust: Motes | null = null;
  /** Figurki drużyny przy ognisku (malowane od nowa w redraw: nowa broń po "Załóż", nowy rekrut). */
  private partyFigs: Phaser.GameObjects.Sprite[] = [];

  constructor() {
    super('HubScene');
  }

  init(data: HubSceneData): void {
    this.entry = data ?? {};
  }

  private get st() {
    return campaign.state;
  }

  create(): void {
    enter(this);
    const st = this.st;
    if (!st.party.length) {
      this.scene.start('TitleScene');
      return;
    }
    refreshBoard(st);
    this.t = 0;
    this.sel = null;
    this.charIdx = 0;
    const alias: Record<string, Tab> = { board: 'board', shop: 'shop', heal: 'heal', clinic: 'heal', party: 'party', tavern: 'tavern' };
    this.tab = this.entry.tab ?? alias[this.entry.open ?? ''] ?? 'board';

    this.bgT = 0;
    this.bgUpdate = backdrop(this, 'hub', {
      mood: MOODS.dusk, seed: 2, orb: [430, 190, 20], farBase: 226, midBase: 234, midH: [40, 150], groundY: 236, clouds: 9,
      props: (g) => {
        // latarnie przy placu z ciepłą poświatą
        for (const x of [402, 462]) {
          glow(g, x + 1, 194, 16, 12, '#ffc070', 0.35, { levels: 4 });
          g.fillStyle = '#1c1612';
          g.fillRect(x, 196, 2, 44);
          g.fillRect(x - 3, 191, 8, 1);
          g.fillStyle = '#ffe0a0';
          g.fillRect(x - 2, 192, 6, 4);
          g.fillStyle = '#c08040';
          g.fillRect(x, 197, 1, 43);
        }
      },
    });
    this.fire = campfire(this, 432, 254, 1.4, 2);
    this.partyFigs = [];
    this.townFolk();
    this.dust = new Motes(this, 50, { x: 380, y: 150, w: 100, h: 120 }, 0xf0c080, 8, 1, 6, 0.4, 1);

    this.top = this.add.container(0, 0);
    this.menu = this.add.container(388, 22);
    this.win = panel(this, WX, WY, WW, WH);
    this.title = label(this, 8, 5, '', { size: 10, bold: true, color: PAL.amber });
    this.body = this.add.container(0, BY);
    this.win.add([this.title, this.body]);
    this.tip = new Tip(this);

    this.input.keyboard?.on('keydown-ESC', (e: KeyboardEvent) => !modalOpen(this) && !escConsumed(e) && this.open('board'));
    this.redraw();
    if (this.entry.notice) toast(this, this.entry.notice, this.entry.noticeTone ?? 'amber');
    Save.write();
    SoundManager.music('town');
    SoundManager.ambience('town');
  }

  /** Mieszkańcy Przystani przy placu - klik otwiera ich zakładkę (Oldgame/src/scenes/hub.js:61-67, 283-287). */
  private townFolk(): void {
    const folk: [string, number, number, Tab | null, { classId: string; look: Record<string, unknown> }][] = [
      ['Lecznica', 392, 226, 'heal', { classId: 'medic', look: { skin: '#e0b896', hair: '#9a9a9a', hairStyle: 2, cloth: '#d9d2c0', accent: '#c43d2f' } }],
      ['Tablica zleceń', 420, 222, 'board', { classId: 'soldier', look: { skin: '#c99a74', hair: '#3a2a20', cloth: '#5b6b4a', accent: '#c9a23a' } }],
      ['Handlarz Nomadów', 470, 226, 'shop', { classId: 'scout', look: { skin: '#a9785a', hair: '#d8c9a0', hairStyle: 3, cloth: '#8a7a55', accent: '#b4532a', mask: true } }],
      ['Mechanik', 448, 220, null, { classId: 'techie', look: { skin: '#c9a07a', hair: '#222222', hairStyle: 4, cloth: '#3f5666', accent: '#8fd14f' } }],
      // wartownik przy wejściu na plac (Oldgame/src/scenes/hub.js:66)
      ['Wartownik', 404, 238, null, { classId: 'scavenger', look: { body: 'light', skin: '#d0a583', hair: '#1c1c1c', hairStyle: 2, cloth: '#4a3f36', accent: '#f2a93b' } }],
    ];
    // tablica ogłoszeń przy żołnierzu
    const g = this.add.graphics().setDepth(1);
    g.fillStyle(0x2a1c12).fillRect(427, 200, 2, 22).fillRect(441, 200, 2, 22);
    g.fillStyle(0x6a4a2a).fillRect(425, 196, 20, 12);
    g.fillStyle(0xe8dcc0).fillRect(427, 198, 5, 4).fillRect(434, 199, 4, 5).fillRect(439, 198, 4, 3);
    const caption = label(this, 0, 0, '', { size: 6, bold: true, color: PAL.amber }).setDepth(30).setVisible(false);
    for (const [name, x, y, tab, src] of folk) {
      const sp = addUnit(this, x, y, `npc_${name}`, unitLookOf(src as Parameters<typeof unitLookOf>[0])).setDepth(2).setFlipX(x > 432).setAlpha(0.92);
      sp.setInteractive({ useHandCursor: !!tab });
      sp.on('pointerover', () => {
        caption.setText(name + (tab ? ' — kliknij' : '')).setPosition(Math.min(BASE_W - caption.width - 2, Math.max(2, x - caption.width / 2)), y - 40).setVisible(true);
        sp.setAlpha(1);
      });
      sp.on('pointerout', () => {
        caption.setVisible(false);
        sp.setAlpha(0.92);
      });
      if (tab) sp.on('pointerdown', () => !modalOpen(this) && this.open(tab));
    }
  }

  update(_time: number, delta: number): void {
    this.bgT += Math.min(delta / 1000, 0.1);
    this.bgUpdate(this.bgT, Math.min(delta / 1000, 0.1));
    const dt = Math.min(delta / 1000, 0.1);
    this.t += dt;
    this.fire(this.t);
    this.dust?.update(dt);
  }

  // ================================================================== rama

  private redraw(): void {
    this.tip.hide();
    this.drawParty();
    this.drawTop();
    this.drawMenu();
    this.title.setText(TITLES[this.tab].toUpperCase());
    this.body.removeAll(true);
    this[`draw_${this.tab}`]();
  }

  /** Drużyna przy ognisku: wygląd z ekwipunku (wariant sprite'a z bronią w ręku, UnitLooks.unitLookOf). */
  private drawParty(): void {
    for (const f of this.partyFigs) f.destroy();
    this.partyFigs = this.st.party.map((ch, i) => addUnit(this, 398 + i * 22, 262 - (i % 2) * 5, `pc_${ch.recruitId ?? ch.id}`, unitLookOf(ch)).setDepth(3).setFlipX(i > 1));
  }

  private open(tab: Tab): void {
    if (this.tab !== tab) SoundManager.sfx('door', { vol: 0.5 });
    this.tab = tab;
    this.redraw();
  }

  private L(x: number, y: number, s: string, o: LabelOpts = {}, parent: Phaser.GameObjects.Container = this.body): PixelText {
    const t = label(this, x, y, s, o);
    parent.add(t);
    return t;
  }

  private drawTop(): void {
    const st = this.st, T = this.top;
    T.removeAll(true);
    T.add(this.add.rectangle(0, 0, BASE_W, 17, PAL.panel, 0.95).setOrigin(0));
    T.add(this.add.rectangle(0, 17, BASE_W, 1, PAL.edge).setOrigin(0));
    let x = 8;
    const put = (k: string, v: string, color: number = PAL.text): void => {
      const a = this.L(x, 4, k, { size: 7, color: k ? PAL.text : color, bold: !k }, T);
      x += a.displayWidth;
      if (v) x += this.L(x, 4, v, { size: 7, bold: true, color }, T).displayWidth;
      x += 14;
    };
    put('', 'PRZYSTAŃ', PAL.amber);
    put('Złom: ', String(st.scrap), PAL.amber);
    put('Dzień: ', String(st.day));
    const fx = x;
    const fs = foodStatus(st);
    put('Żywność: ', `${foodOf(st)} dn.`, TONE[fs.tone]);
    T.add(this.tip.attach(this.add.rectangle(fx, 2, x - fx - 10, 13, 0, 0).setOrigin(0).setInteractive(), () =>
      `Zapasy Przystani: ${fs.label}. Ocaleni zjadają 1 dzień zapasów dziennie.\nGdy zapasy spadną do ${FOOD_LOW} dn., na tablicy pojawia się zlecenie zaopatrzenia; głód obniża reputację u Ocalonych.`));
    const nx = x;
    put('Nomadzi: ', fmtRep(st.rep.nomads), st.rep.nomads >= 0 ? PAL.good : PAL.bad);
    // podpowiedź jak w Oldgame/src/scenes/hub.js:88
    T.add(this.tip.attach(this.add.rectangle(nx, 2, x - nx - 10, 13, 0, 0).setOrigin(0).setInteractive(), () => `Rabat u handlarzy: ${Math.round(nomadDiscount(st) * 100)}%`));
    put('Ocaleni: ', fmtRep(st.rep.survivors), st.rep.survivors >= 0 ? PAL.good : PAL.bad);
    // prawy napis skrócony, gdy nie mieści się obok wartości (doszła Żywność)
    const right = this.L(BASE_W - 8, 5, `Poziom drużyny: ${campaignPartyLevel(st)} · Ukończone: ${st.completed.length}`, { size: 6, color: PAL.dim }, T).setOrigin(1, 0);
    if (BASE_W - 8 - right.displayWidth < x - 8) right.setText(`Poz. ${campaignPartyLevel(st)} · Ukończ. ${st.completed.length}`);
  }

  private drawMenu(): void {
    const st = this.st, M = this.menu;
    M.removeAll(true);
    let y = 0;
    const add = (text: string, fn: () => void, o: { primary?: boolean; danger?: boolean } = {}): void => {
      M.add(button(this, 0, y, text, fn, { w: 86, h: 15, size: 6.5, ...o }).box);
      y += 19;
    };
    const tabBtn = (tab: Tab, text: string, o: { danger?: boolean } = {}): void => add(text, () => this.open(tab), { primary: this.tab === tab, ...o });
    tabBtn('board', 'Tablica zleceń' + (st.contracts.some((c) => c.story) ? ' ★' : ''));
    tabBtn('shop', 'Handlarz');
    tabBtn('heal', 'Lecznica');
    tabBtn('party', 'Drużyna');
    if (st.party.length < MAX_PARTY || st.party.some((c) => c.conditions.dead)) tabBtn('tavern', 'Karczma', { danger: this.tab !== 'tavern' });
    y += 6;
    add('Opcje', () => void openOptions(this));
    add('Zapisz grę', () => void openSaveSlots(this, 'save'));
    add('Wczytaj grę', () => void this.loadSlot());
    add('Menu główne', () => void this.mainMenu());
  }

  /** Wczytanie slotu z miasta (miasto startuje od nowa ze stanem z zapisu). */
  private async loadSlot(): Promise<void> {
    if ((await openSaveSlots(this, 'load')) !== null) enterLoaded(this);
  }

  /** Menu główne gry: zapis / wczytanie (3 sloty), wyjście z zapisem lub bez. */
  private async mainMenu(): Promise<void> {
    type Pick = 'stay' | 'save' | 'load' | 'quit' | 'quitNoSave';
    const pick = await new Promise<Pick>((resolve) => {
      const W = 150, H = 128;
      let res: Pick = 'stay';
      const win = openWindow(this, W, H, 'Menu główne', () => resolve(res));
      const items: [Pick, string, { primary?: boolean; danger?: boolean }][] = [
        ['save', 'Zapisz grę', {}],
        ['load', 'Wczytaj grę', {}],
        ['quit', 'Zapisz i wyjdź', { primary: true }],
        ['quitNoSave', 'Wyjdź bez zapisu', { danger: true }],
        ['stay', 'Wróć do gry', {}],
      ];
      items.forEach(([id, text, o], i) => win.add(button(this, 15, 22 + i * 20, text, () => {
        res = id;
        win.close();
      }, { w: W - 30, h: 15, size: 6.5, ...o }).box));
    });
    switch (pick) {
      case 'save':
        await openSaveSlots(this, 'save');
        return;
      case 'load':
        return this.loadSlot();
      case 'quit':
        Save.write();
        goto(this, 'TitleScene');
        return;
      case 'quitNoSave': {
        const ok = await dialog(this, { title: 'Wyjść bez zapisu?', body: 'Zmiany od ostatniego zapisu zostaną utracone.', buttons: [{ label: 'Zostań', value: false }, { label: 'Wyjdź bez zapisu', value: true, danger: true }] });
        if (ok) goto(this, 'TitleScene');
        return;
      }
    }
  }

  /** Wiersz przedmiotu: ikona, nazwa (xN), krótka statystyka; zwraca szerokość zajętą z prawej przez `right`. */
  private itemRow(row: Phaser.GameObjects.Container, w: number, id: string, qty: number, extra = ''): void {
    const def = itemDef(id);
    const hit = this.add.rectangle(0, 0, w, 12, 0x000000, 0.25).setOrigin(0).setInteractive();
    this.tip.attach(hit, () => itemTip(id));
    row.add([hit, itemIconImage(this, 1, 1, id, 10)]);
    const name = label(this, 14, 2, cut((def?.name ?? id) + (qty > 1 ? ` ×${qty}` : ''), 24), { size: 6 });
    row.add(name);
    const stat = extra || itemStatLine(def, true);
    if (stat) row.add(label(this, 14 + name.displayWidth + 4, 2.5, cut(stat, 14), { size: 5, color: PAL.dim }));
  }

  // ================================================================== tablica zleceń

  private draw_board(): void {
    const st = this.st, lvl = campaignPartyLevel(st);
    const cur = st.contracts.find((c) => c.id === this.sel) ?? st.contracts[0] ?? null;
    this.sel = cur?.id ?? null;
    const LW = 168;
    new ScrollList<Contract>(this, 6, 0, LW, 180, 30, (c, row, w) => {
      const on = c === cur, d = difficulty(c.level, lvl);
      const bg = this.add.rectangle(0, 0, w, 27, on ? 0x3a2c1e : PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, on ? PAL.edgeHi : c.story ? PAL.blood : PAL.edge).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        SoundManager.sfx('click');
        this.sel = c.id;
        this.redraw();
      });
      // szerokości w pikselach czcionki 6x8: lewe napisy przycinamy, żeby nie wchodziły na prawe
      const reward = label(this, w - 4, 1, `${c.reward.scrap} Z`, { color: PAL.amber }).setOrigin(1, 0);
      const diff = label(this, w - 4, 18, d.label, { color: TONE[d.tone] }).setOrigin(1, 0);
      row.add([
        bg,
        label(this, 4, 1, (c.story ? '★ ' : c.type === 'forage' && foodLow(st) ? '! ' : '') + c.title, { color: c.story ? PAL.amber : c.type === 'forage' && foodLow(st) ? PAL.bad : PAL.text, maxW: w - 12 - reward.width }),
        reward,
        label(this, 4, 10, `${c.giver} · ${FACTION_NAMES[c.faction]}`, { color: PAL.dim, maxW: w - 8 }),
        label(this, 4, 18, `${TYPE_NAMES[c.type]} · poz. ${c.level} · ${BIOME_NAMES[c.biome]}`, { color: PAL.toxic, maxW: w - 12 - diff.width }),
        diff,
      ]);
    }, this.body).setItems(st.contracts);
    if (!st.contracts.length) this.L(8, 4, 'Tablica jest pusta. Odpocznij, a ktoś coś dopisze.', { size: 7, color: PAL.dim, wrap: LW - 8 });
    this.L(6, 186, storyHint(st), { size: 5.5, color: PAL.dim, wrap: LW });

    const DX = LW + 14, DW = WW - DX - 8;
    this.body.add(this.add.rectangle(DX - 4, 0, DW + 8, BH - 2, 0x000000, 0.25).setOrigin(0).setStrokeStyle(1, PAL.edge));
    if (!cur) {
      this.L(DX, 6, 'Wybierz zlecenie z listy.', { size: 7, color: PAL.dim });
      return;
    }
    const d = difficulty(cur.level, lvl);
    // wszystkie napisy szczegółów mieszczą się w szerokości panelu DW (zawijanie / przycięcie), a opis zaczyna się pod nimi
    const title = this.L(DX, 4, cur.title, { size: 9, bold: true, color: PAL.amber, maxW: DW });
    const giver = this.L(DX, 6 + title.displayHeight, `Zleceniodawca: ${cur.giver} (${FACTION_NAMES[cur.faction]})`, { size: 6, color: PAL.dim, wrap: DW });
    const descY = giver.y + giver.displayHeight + 3;
    const desc = this.L(DX, descY, cur.desc, { size: 7, wrap: DW, lineSpacing: 2 });
    let y = Math.max(66, descY + desc.displayHeight + 6);
    const row = (k: string, v: string, color: number = PAL.text): void => {
      const kl = this.L(DX, y, `${k}: `, { size: 6.5, color: PAL.dim });
      const vl = this.L(DX + kl.displayWidth, y, v, { size: 6.5, color, wrap: DW - kl.displayWidth });
      y += Math.max(10, vl.displayHeight + 2);
    };
    const itemName = cur.objective.itemId ? itemDef(cur.objective.itemId)?.name ?? cur.objective.itemId : '';
    row('Cel', cur.type === 'retrieve' ? `Odzyskaj: ${itemName}.` : OBJECTIVE[cur.type] ?? TYPE_NAMES[cur.type]);
    row('Miejsce', `${BIOME_NAMES[cur.biome]}, ${MOOD_NAMES[cur.mood]}`);
    row('Trudność', `${d.label} (zlecenie poz. ${cur.level} vs drużyna ${lvl})`, TONE[d.tone]);
    row('Podróż', `${cur.travelDays || 1} dn.`);
    const foes = new Map<string, number>();
    for (const id of cur.enemies) foes.set(enemyDef(id)?.name ?? id, (foes.get(enemyDef(id)?.name ?? id) ?? 0) + 1);
    row('Zwiad', [...foes].map(([n, k]) => `${k}× ${n}`).join(', '));
    y += 2;
    const rw = cur.reward;
    const rep = (Object.entries(rw.rep) as [string, number][]).map(([f, v]) => `${f === 'nomads' ? 'Nomadzi' : 'Ocaleni'} ${fmtRep(v)}`);
    row('Nagroda', [...(rw.food ? [`${rw.food} dn. żywności`] : []), `${rw.scrap} Złomu`, `${rw.xp} PD`, ...rw.items.map((id) => itemDef(id)?.name ?? id), ...rep].join(' · '), PAL.amber);
    this.body.add(button(this, DX + DW - 120, BH - 26, 'Przyjmij zlecenie ▶', () => void this.accept(cur), { primary: true, w: 120, h: 20, size: 8 }).box);
  }

  private async accept(c: Contract): Promise<void> {
    const alive = this.st.party.filter((p) => !p.conditions.dead && p.hp > 0);
    if (!alive.length) return toast(this, 'Brak sprawnych najemników!', 'bad');
    const hurt = alive.filter((x) => x.hp < x.maxHp * 0.6);
    if (hurt.length) {
      const ok = await dialog(this, {
        title: 'Ranni najemnicy',
        body: `${hurt.map((h) => plainName(h.name)).join(', ')} — nie w pełni sił. Wyruszyć mimo to?`,
        buttons: [{ label: 'Wróć do Przystani', value: false }, { label: 'Wyruszamy', value: true, primary: true }],
      });
      if (!ok) return;
    }
    SoundManager.sfx('door');
    Save.write();
    goto(this, 'TravelScene', { contract: c });
  }

  // ================================================================== handlarz

  private draw_shop(): void {
    const st = this.st, lvl = campaignPartyLevel(st);
    const CW = 178;
    this.L(6, 0, `TOWARY (rabat ${Math.round(nomadDiscount(st) * 100)}%)`, { size: 6, bold: true, color: PAL.amber });
    new ScrollList<string>(this, 6, 10, CW, 196, 14, (id, row, w) => {
      const price = buyPrice(id, st);
      this.itemRow(row, w - 40, id, 1);
      row.add(miniButton(this, w - 38, 1, `${price} Z`, () => {
        const r = buy(st, id);
        if (!r.ok) {
          SoundManager.sfx('error');
          return toast(this, r.reason ?? 'Nie można kupić.', 'bad');
        }
        SoundManager.sfx('buy');
        this.redraw();
      }, { w: 38, enabled: st.scrap >= price }).box);
    }, this.body).setItems(shopStock(st, lvl));

    this.body.add(this.add.rectangle(CW + 11, 0, 1, BH - 4, PAL.edge).setOrigin(0));
    const RX = CW + 17;
    this.L(RX, 0, 'TWOJE RZECZY (sprzedaż)', { size: 6, bold: true, color: PAL.amber });
    const mine: { inst: ItemInstance; src: string; arr: ItemInstance[] }[] = st.stash.map((inst) => ({ inst, src: 'Skrytka', arr: st.stash }));
    for (const c of st.party) for (const inst of c.inventory) mine.push({ inst, src: shortName(c.name), arr: c.inventory });
    const list = new ScrollList<(typeof mine)[number]>(this, RX, 10, CW - 6, 196, 14, ({ inst, src, arr }, row, w) => {
      const price = sellPrice(inst.id, st);
      this.itemRow(row, w - 44, inst.id, inst.qty, src);
      row.add(miniButton(this, w - 42, 1, price ? `+${price} Z` : '—', () => {
        if (!sell(st, inst, arr)) return;
        SoundManager.sfx('coin');
        this.redraw();
      }, { w: 42, enabled: price > 0 }).box);
    }, this.body);
    list.empty = 'Nic do sprzedania.';
    list.setItems(mine);
  }

  // ================================================================== lecznica

  private draw_heal(): void {
    const st = this.st;
    this.L(6, 0, '„Pokaż rękę. Nie, drugą. Ta wygląda, jakby przeżyła wojnę.” — Doktor Mika', { size: 6, italic: true, color: PAL.dim, wrap: 230 });
    st.party.forEach((c, i) => {
      const y = 20 + i * 40, dead = !!c.conditions.dead, k = healCost(c);
      const conds = Object.keys(c.conditions).map((id) => conditionDef(id)?.name ?? id);
      const hp = c.hp / Math.max(1, c.maxHp);
      this.body.add(this.add.rectangle(6, y, 230, 36, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, PAL.edge));
      this.body.add(portrait(this, 9, y + 3, c, 30));
      this.L(44, y + 3, cut(c.name, 26), { size: 7, bold: true, color: parseColor(c.nameColor, PAL.text) });
      this.L(44, y + 13, cut(`${classDef(c.classId)?.name ?? c.classId} poz. ${c.level}${conds.length ? ' · ' + conds.join(', ') : ''}`, 42), { size: 5.5, color: PAL.dim });
      this.body.add(bar(this, 44, y + 22, 100, 4, hp, hp < 0.34 ? PAL.bad : PAL.good));
      this.L(148, y + 20, `PW ${Math.max(0, c.hp)}/${c.maxHp}`, { size: 6 });
      this.body.add(button(this, 180, y + 4, dead ? 'Poległ' : k ? `Ulecz (${k} Z)` : 'Zdrów', () => {
        if (!healAtClinic(st, c)) {
          SoundManager.sfx('error');
          return toast(this, 'Za mało Złomu.', 'bad');
        }
        SoundManager.sfx('heal');
        this.redraw();
      }, { w: 52, h: 13, size: 6, enabled: !dead && k > 0 }).box);
    });
    const total = st.party.filter((c) => !c.conditions.dead).reduce((a, c) => a + healCost(c), 0);
    const SX = 246;
    this.body.add(button(this, SX, 20, total ? `Ulecz wszystkich (${total} Z)` : 'Wszyscy zdrowi', () => {
      if (st.scrap < total) {
        SoundManager.sfx('error');
        return toast(this, 'Za mało Złomu.', 'bad');
      }
      for (const c of st.party) healAtClinic(st, c);
      SoundManager.sfx('heal');
      this.redraw();
    }, { w: 122, h: 18, size: 7, primary: true, enabled: total > 0 }).box);
    this.body.add(this.add.rectangle(SX, 46, 122, 86, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, PAL.edge));
    this.L(SX + 5, 50, 'ODPOCZYNEK', { size: 7, bold: true, color: PAL.amber });
    this.L(SX + 5, 62, 'Prześpij noc w kwaterze: pełne PW i zdolności, ale mija dzień — tablica zleceń się zmienia.', { size: 6, wrap: 112, lineSpacing: 2 });
    this.body.add(button(this, SX + 5, 110, 'Odpocznij (następny dzień)', () => {
      const food = restDay(st);
      SoundManager.sfx('heal');
      toast(this, `Dzień ${st.day}. Wypoczęci.${food.notes.length ? ' ' + food.notes.join(' ') : ''}`, food.notes.length ? 'bad' : 'good');
      this.redraw();
    }, { w: 112, h: 15, size: 6 }).box);
  }

  // ================================================================== drużyna

  private draw_party(): void {
    const st = this.st;
    if (this.charIdx >= st.party.length) this.charIdx = 0;
    const ch = st.party[this.charIdx];
    st.party.forEach((c, i) => {
      const y = i * 46, on = i === this.charIdx;
      const bg = this.add.rectangle(6, y, 36, 43, on ? 0x3a2c1e : PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, on ? PAL.amber : PAL.edge).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        SoundManager.sfx('click');
        this.charIdx = i;
        this.redraw();
      });
      this.body.add([bg, portrait(this, 9, y + 3, c, 30)]);
      this.L(24, y + 35, cut(shortName(c.name), 8), { size: 5.5, color: parseColor(c.nameColor, PAL.text) }).setOrigin(0.5, 0);
    });
    if (!ch) return;
    const X0 = 48;
    // ---- nagłówek
    this.body.add(portrait(this, X0, 0, ch, 40));
    const nm = this.L(X0 + 46, 0, cut(ch.name, 26), { size: 9, bold: true, color: parseColor(ch.nameColor, PAL.amber) });
    this.body.add(miniButton(this, X0 + 52 + nm.displayWidth, 0, '✎ Zmień imię', () => void this.rename(ch), { w: 56 }).box);
    this.L(X0 + 46, 13, `${classDef(ch.classId)?.name ?? ch.classId} · ${ancestryOf(ch.ancestry).name} · poz. ${ch.level}`, { size: 6.5, color: PAL.amber });
    const xpK = (ch.xp || 0) / XP_PER_LEVEL, hpK = ch.hp / Math.max(1, ch.maxHp);
    this.L(X0 + 46, 24, 'PD', { size: 6, color: PAL.dim });
    this.body.add(bar(this, X0 + 60, 26, 90, 4, xpK, PAL.amber, 0x3a2c10));
    this.L(X0 + 154, 24, `${ch.xp || 0}/${XP_PER_LEVEL}`, { size: 6 });
    this.L(X0 + 46, 33, 'PW', { size: 6, color: PAL.dim });
    this.body.add(bar(this, X0 + 60, 35, 90, 4, hpK, hpK < 0.34 ? PAL.bad : PAL.good));
    this.L(X0 + 154, 33, `${Math.max(0, ch.hp)}/${ch.maxHp}`, { size: 6 });

    const Y0 = 46;
    const box = (x: number, y: number, w: number, h: number, title: string): void => {
      this.body.add(this.add.rectangle(x, y, w, h, 0x000000, 0.25).setOrigin(0).setStrokeStyle(1, PAL.edge));
      this.L(x + 3, y + 2, title.toUpperCase(), { size: 5.5, bold: true, color: PAL.amber });
    };
    const kv = (x: number, y: number, w: number, k: string, v: string, color: number = PAL.text, dim = false): void => {
      this.L(x, y, k, { size: 6, color: dim ? 0x6a5f4c : PAL.dim });
      this.L(x + w, y, v, { size: 6, bold: true, color }).setOrigin(1, 0);
    };
    // ---- kolumna 1: cechy + obrona
    const C1 = X0, W1 = 92;
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
    const skillIds = Object.keys(SKILLS) as SkillId[];
    new ScrollList<SkillId>(this, C2 + 3, Y0 + 11, W2 - 5, 88, 8, (id, row, w) => {
      const rank = (id as string) === 'perception' ? ch.prof.perception : ch.prof.skills[id] ?? 0;
      const a = label(this, 0, 0, SKILLS[id].name, { size: 6, color: rank ? PAL.text : 0x6a5f4c });
      const v = label(this, w - 1, 0, signed(getStat(ch, id)), { size: 6, bold: true, color: rank ? PAL.text : 0x6a5f4c }).setOrigin(1, 0);
      const p = label(this, w - 16, 0.5, PROF_NAMES[rank]?.slice(0, 4) ?? '', { size: 5, color: PAL.dim }).setOrigin(1, 0);
      row.add([a, p, v]);
    }, this.body).setItems(skillIds);
    box(C2, Y0 + 103, W2, 66, 'Ekwipunek');
    SLOTS.forEach(([slot, name], i) => {
      const y = Y0 + 113 + i * 14, inst = ch.equipment[slot];
      const hit = this.add.rectangle(C2 + 2, y, W2 - 4, 13, 0x000000, 0.3).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => this.pickEquip(ch, slot, name));
      if (inst) this.tip.attach(hit, () => `${name}\n${itemTip(inst.id)}`);
      this.body.add(hit);
      if (inst) this.body.add(itemIconImage(this, C2 + 3, y + 1, inst.id, 11));
      // jedna linia na gniazdo: nazwa przedmiotu, a w pustym gnieździe jego rodzaj (rodzaj jest też w podpowiedzi)
      this.L(C2 + 16, y + 3, inst ? cut(itemDef(inst.id)?.name ?? inst.id, 22) : `— ${name.toLowerCase()} —`, { size: 6, color: inst ? PAL.text : PAL.dim });
    });
    // ---- kolumna 3: zdolności, plecak, skrytka
    const C3 = C2 + W2 + 4, W3 = WW - C3 - 6;
    box(C3, Y0, W3, 62, 'Zdolności');
    new ScrollList<string>(this, C3 + 3, Y0 + 11, W3 - 5, 50, 8, (id, row, w) => {
      const a = abilityDef(id);
      if (!a) return;
      const cost = a.actions === 'reaction' ? 'reakcja' : a.actions === 0 ? 'darmowa' : `${a.actions} akc.`;
      const hit = this.add.rectangle(0, 0, w, 8, 0, 0).setOrigin(0).setInteractive();
      this.tip.attach(hit, () => `${a.name} [${cost}]${a.uses ? ` · ${ch.uses[a.id as keyof typeof ch.uses] ?? '?'} użyć` : ''}\n${a.desc}`);
      row.add([hit, abilityIconImage(this, 0, 0, id, 7), label(this, 9, 0, cut(a.name, 13), { size: 6, color: PAL.toxic }), label(this, w - 1, 0.5, cost, { size: 5, color: PAL.dim }).setOrigin(1, 0)]);
    }, this.body).setItems(ch.abilities);

    box(C3, Y0 + 65, W3, 50, 'Plecak');
    const pack = new ScrollList<ItemInstance>(this, C3 + 2, Y0 + 75, W3 - 3, 39, 13, (inst, row, w) => {
      const def = itemDef(inst.id);
      const usable = def?.type === 'consumable' && def.consumable.effect === 'heal';
      this.itemRow(row, w - (usable ? 40 : 14), inst.id, inst.qty, ' ');
      if (usable)
        row.add(miniButton(this, w - 39, 1, 'Użyj', () => {
          const before = ch.hp;
          useConsumable(ch, inst, [ch]);
          SoundManager.sfx('heal');
          toast(this, `${shortName(ch.name)}: +${ch.hp - before} PW`, 'good');
          this.redraw();
        }, { w: 24 }).box);
      row.add(miniButton(this, w - 13, 1, '→', () => {
        moveItem(inst, ch.inventory, st.stash);
        this.redraw();
      }, { w: 13 }).box);
    }, this.body);
    pack.empty = 'Pusty.';
    pack.setItems(ch.inventory);

    box(C3, Y0 + 118, W3, 51, 'Skrytka drużyny');
    const stash = new ScrollList<ItemInstance>(this, C3 + 2, Y0 + 128, W3 - 3, 39, 13, (inst, row, w) => {
      this.itemRow(row, w - 14, inst.id, inst.qty, ' ');
      row.add(miniButton(this, w - 13, 1, '←', () => {
        moveItem(inst, st.stash, ch.inventory);
        this.redraw();
      }, { w: 13 }).box);
    }, this.body);
    stash.empty = 'Pusta.';
    stash.setItems(st.stash);
  }

  private async rename(ch: Character): Promise<void> {
    const others = (): string[] => this.st.party.filter((c) => c !== ch).map((c) => c.name);
    const rec = RECRUITS.find((r) => r.id === ch.recruitId);
    const r = await namePrompt(this, {
      value: ch.name, color: ch.nameColor ?? null, taken: others,
      generate: () => generateName({ ancestry: ch.ancestry, classId: ch.classId, gender: rec?.gender, taken: others() }),
      reset: rec ? () => rec.name : undefined,
    });
    if (!r) return;
    ch.name = r.name;
    if (r.color) ch.nameColor = r.color;
    else delete ch.nameColor;
    this.redraw();
  }

  private pickEquip(ch: Character, slot: EquipSlot, name: string): void {
    const st = this.st, cur = ch.equipment[slot];
    const cands = [...st.stash.map((i) => ({ i, from: st.stash })), ...ch.inventory.map((i) => ({ i, from: ch.inventory }))].filter((x) => itemDef(x.i.id)?.type === SLOT_TYPE[slot]);
    type Row = { i: ItemInstance; from: ItemInstance[] | null };
    const rows: Row[] = [...(cur ? [{ i: cur, from: null }] : []), ...cands];
    const W = 230, H = 150;
    const win = openWindow(this, W, H, `Wybierz: ${name}`);
    const list = new ScrollList<Row>(this, 8, 22, W - 16, 98, 14, ({ i, from }, row, w) => {
      this.itemRow(row, w - 44, i.id, i.qty);
      row.add(miniButton(this, w - 42, 1, from ? 'Załóż' : 'Zdejmij', () => {
        if (!from) unequip(ch, slot, st.stash);
        else {
          const hadShield = !!ch.equipment.shield;
          const r = equip(ch, slot, i, from, st.stash);
          if (!r.ok) {
            SoundManager.sfx('error');
            return toast(this, r.reason ?? 'Nie można założyć.', 'bad');
          }
          if (hadShield && !ch.equipment.shield) toast(this, 'Broń dwuręczna: tarcza trafiła do skrytki.');
        }
        SoundManager.sfx('pickup');
        win.close();
        this.redraw();
      }, { w: 42, primary: !!from }).box);
    }, win.box);
    list.empty = 'Brak pasujących przedmiotów w skrytce ani plecaku.';
    list.setItems(rows);
    win.add(button(this, W - 62, H - 22, 'Zamknij', () => win.close(), { w: 54, size: 7 }).box);
  }

  // ================================================================== karczma

  private draw_tavern(): void {
    const st = this.st, cost = hireCost(st), lvl = campaignPartyLevel(st);
    const slots = MAX_PARTY - st.party.length;
    this.L(6, 0, slots > 0 ? `W drużynie brakuje ${slots} os. Najemnicy żądają ${cost} Złomu za podpis.` : 'Drużyna kompletna.', { size: 6.5, color: PAL.dim });
    const fallen = st.flags.fallen ?? [];
    if (fallen.length) this.L(6, 9, cut('Polegli: ' + fallen.join(', '), 90), { size: 6, color: PAL.bad });
    const list = new ScrollList<RecruitDef>(this, 6, 20, WW - 12, 192, 38, (r, row, w) => {
      const ch = recruitCharacter(r, r.name, lvl);
      row.add(this.add.rectangle(0, 0, w, 35, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, PAL.edge));
      row.add(portrait(this, 3, 3, ch, 29));
      row.add(label(this, 37, 2, r.name, { size: 7, bold: true }));
      row.add(label(this, 37, 11, `${classDef(r.classId)?.name ?? r.classId} · ${ancestryOf(ch.ancestry).name} · poz. ${lvl} · PW ${ch.maxHp} · KP ${getStat(ch, 'ac')}`, { size: 5.5, color: PAL.amber }));
      row.add(label(this, 37, 19, cut(r.bio, 132), { size: 5.5, italic: true, color: PAL.dim, wrap: w - 130, lineSpacing: 1 }));
      row.add(button(this, w - 84, 10, `Zatrudnij (${cost} Z)`, () => {
        const res = hireRecruit(st, r);
        if (!res.ok) {
          SoundManager.sfx('error');
          return toast(this, res.reason ?? 'Nie można zatrudnić.', 'bad');
        }
        SoundManager.sfx('buy');
        this.scene.restart({ tab: st.party.length < MAX_PARTY ? 'tavern' : 'party' });
      }, { w: 80, h: 14, size: 6, enabled: slots > 0 && st.scrap >= cost }).box);
    }, this.body);
    list.empty = 'Nikogo więcej w karczmie nie ma.';
    list.setItems(tavernRecruits(st));
  }
}
