import Phaser from 'phaser';
import type { PixelText } from './BitmapFont';
import { SoundManager } from '../../audio/SoundManager';
import { campaign } from '../../core/campaign/session';
import { type CampaignState, type Contract, freshState } from '../../core/campaign/state';
import type { MissionSnapshot } from '../../core/tactical/mission';
import { NAME_COLORS, NAME_MAX, checkName } from '../../core/data/names';
import { itemStatLine } from '../../core/HudState';
import { abilityDef, itemDef } from '../../core/rules/lookup';
import { abilityIcon, abilityKind, itemIcon } from '../legacy/icons';
import { portraitCanvas } from '../legacy/portraits';
import { enemySpriteId, hasSpritePortrait, spriteIdOf, spritePortraitCanvas } from '../iso/SpriteUnits';
import { addHiRes } from '../iso/HiRes';
import { ART, BASE_H, BASE_W, CANVAS_H, CANVAS_W, PAL, RES, type UiButton, UI_TITLE, ZOOM, applyResolution, button, goto, canApplyZoomLive, hex, label, panel, parseColor, uiAlphaToggle } from './Kit';
import { RES_PRESETS, type ResSetting, Settings, UI_ALPHAS, UI_SIZES, type UiAlpha, resPreset } from './Settings';
import { MissionLayout } from './MissionLayout';

// Okna, podpowiedzi, listy przewijane, pole tekstowe, opcje i zapis gry - odpowiedniki UI.modal / UI.toast / UI.tooltip,
// Settings.open, nameEditor i Game.save z Oldgame, zbudowane z obiektów Phasera (bez DOM-owej nakładki).

const D_MODAL = 1000;
const D_TIP = 1500;
const D_TOAST = 1600;

// ------------------------------------------------------------------ zapis gry (Oldgame/src/core/game.js)

const SAVE_KEY = 'pyl-i-rdza-save-v1';
/** Liczba ręcznych slotów zapisu (obok autozapisu pod SAVE_KEY). */
export const SAVE_SLOTS = 3;
const slotKey = (slot: number): string => `${SAVE_KEY}-slot${slot}`;

/** Opis slotu do listy zapisów (bez wczytywania całego stanu do kampanii). */
export interface SaveSlotInfo {
  slot: number;
  /** Czas zapisu (ms od epoki) albo null dla starych zapisów bez znacznika. */
  time: number | null;
  day: number;
  scrap: number;
  party: string[];
  level: number;
  /** Tytuł zlecenia, gdy zapisano w trakcie misji. */
  mission: string | null;
  /** Wersja gry, w której powstał zapis (null = stary zapis bez wersji). */
  gameVersion: string | null;
}

/** Misja w toku w zapisie: zlecenie, stan planszy i kampania z chwili wejścia na teren (do "Wyjdź" / "Zapisz i wyjdź"). */
export interface MissionResume {
  contract: Contract;
  snap: MissionSnapshot;
  entry: string;
}
type SavedState = Partial<CampaignState> & { savedAt?: number; gameVersion?: string; mission?: MissionResume | null };

const readState = (key: string): SavedState | null => {
  try {
    const s = JSON.parse(window.localStorage.getItem(key) ?? 'null') as SavedState | null;
    return s && s.version === 1 && Array.isArray(s.party) ? s : null;
  } catch {
    return null; // uszkodzony zapis traktujemy jak brak zapisu
  }
};

const writeState = (key: string): boolean => {
  try {
    const mission = Save.missionProvider?.() ?? null;
    window.localStorage.setItem(key, JSON.stringify({ ...campaign.state, savedAt: Date.now(), gameVersion: __GAME_VERSION__, ...(mission ? { mission } : {}) }));
    return true;
  } catch {
    return false;
  }
};

const applyState = (s: SavedState | null): boolean => {
  if (!s) return false;
  const { savedAt: _t, gameVersion: _v, mission, ...rest } = s;
  campaign.state = Object.assign(freshState(), rest);
  Save.pending = mission && mission.contract && mission.snap ? mission : null;
  return true;
};

export const Save = {
  /** Scena misji podaje tu stan misji do dołączenia do zapisu (null = zapis bez misji, np. w trakcie walki). */
  missionProvider: null as (() => MissionResume | null) | null,
  /** Misja z ostatnio wczytanego zapisu - enterLoaded() wraca na jej mapę. */
  pending: null as MissionResume | null,
  /** Autozapis (Kontynuuj). */
  write(): boolean {
    return writeState(SAVE_KEY);
  },
  exists(): boolean {
    try {
      return !!window.localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  },
  load(): boolean {
    return applyState(readState(SAVE_KEY));
  },
  clear(): void {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      /* brak dostępu do pamięci przeglądarki */
    }
  },
  /** Zapis do slotu 1..SAVE_SLOTS; uaktualnia też autozapis, żeby "Kontynuuj" wracał do tego samego miejsca. */
  writeSlot(slot: number): boolean {
    return writeState(slotKey(slot)) && writeState(SAVE_KEY);
  },
  /** Wczytuje slot do kampanii; po udanym wczytaniu autozapis wskazuje ten stan. */
  loadSlot(slot: number): boolean {
    const raw = readState(slotKey(slot));
    const ok = applyState(raw);
    if (ok) {
      // autozapis = kopia slotu (razem z misją w toku), a nie stan bieżącej sceny
      try {
        window.localStorage.setItem(SAVE_KEY, JSON.stringify(raw));
      } catch {
        /* brak miejsca - Kontynuuj zostaje przy starym autozapisie */
      }
    }
    return ok;
  },
  slotInfo(slot: number): SaveSlotInfo | null {
    const s = readState(slotKey(slot));
    if (!s) return null;
    const party = (s.party ?? []).filter((c) => !c.conditions?.dead);
    return {
      slot,
      time: typeof s.savedAt === 'number' ? s.savedAt : null,
      day: s.day ?? 1,
      scrap: s.scrap ?? 0,
      party: party.map((c) => c.name),
      level: party.length ? Math.max(...party.map((c) => c.level ?? 1)) : 1,
      mission: s.mission?.contract?.title ?? null,
      gameVersion: typeof s.gameVersion === 'string' ? s.gameVersion : null,
    };
  },
  anySlot(): boolean {
    for (let i = 1; i <= SAVE_SLOTS; i++) if (Save.slotInfo(i)) return true;
    return false;
  },
};

/** Po wczytaniu zapisu: misja w toku -> z powrotem na jej mapę, inaczej Przystań. */
export function enterLoaded(scene: Phaser.Scene): void {
  const m = Save.pending;
  if (m) goto(scene, 'WorldScene', { contract: m.contract, resume: m });
  else goto(scene, 'HubScene', {});
}

const fmtTime = (t: number | null): string => {
  if (t === null) return '';
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Okno slotów zapisu. `save`: zapisuje bieżącą kampanię (nadpisanie zajętego slotu wymaga potwierdzenia).
 * `load`: wczytuje wybrany slot do kampanii. Zwraca numer slotu albo null po anulowaniu / błędzie.
 */
export function openSaveSlots(scene: Phaser.Scene, mode: 'save' | 'load'): Promise<number | null> {
  return new Promise<number | null>((resolve) => {
    const W = 260, ROW = 34, H = 30 + SAVE_SLOTS * (ROW + 4) + 24;
    let result: number | null = null;
    const win = openWindow(scene, W, H, mode === 'save' ? 'Zapisz grę' : 'Wczytaj grę', () => resolve(result));
    for (let i = 1; i <= SAVE_SLOTS; i++) {
      const info = Save.slotInfo(i);
      const y = 22 + (i - 1) * (ROW + 4);
      const row = scene.add.container(8, y);
      row.add(scene.add.rectangle(0, 0, W - 16, ROW, 0x000000, 0.35).setOrigin(0).setStrokeStyle(1, PAL.edge));
      row.add(label(scene, 6, 4, `SLOT ${i}`, { size: 7, bold: true, color: PAL.amber }));
      if (info) {
        row.add(label(scene, 48, 4, fmtTime(info.time) + (info.gameVersion ? ` · v${info.gameVersion}` : ''), { size: 6, color: PAL.dim }));
        row.add(label(scene, 6, 14, info.mission ? `Dzień ${info.day} · misja: ${info.mission.length > 24 ? `${info.mission.slice(0, 23)}…` : info.mission}` : `Dzień ${info.day} · poz. ${info.level} · ${info.scrap} Złomu`, { size: 6, color: info.mission ? PAL.amber : undefined }));
        const names = info.party.join(', ') || '(brak żywych najemników)';
        row.add(label(scene, 6, 23, names.length > 34 ? `${names.slice(0, 33)}…` : names, { size: 5.5, color: PAL.dim }));
      } else row.add(label(scene, 6, 15, '— pusty —', { size: 6.5, color: PAL.dim }));
      const can = mode === 'save' || !!info;
      const act = button(scene, W - 16 - 58, (ROW - 15) / 2, mode === 'save' ? 'Zapisz' : 'Wczytaj', async () => {
        if (!can) return;
        if (mode === 'save') {
          if (info) {
            const ok = await dialog(scene, { title: 'Nadpisać zapis?', body: `Slot ${i} zawiera już zapis (dzień ${info.day}). Nadpisać go?`, buttons: [{ label: 'Anuluj', value: false }, { label: 'Nadpisz', value: true, danger: true }] });
            if (!ok) return;
          }
          if (Save.writeSlot(i)) {
            SoundManager.sfx('pickup');
            toast(scene, `Gra zapisana w slocie ${i}.`, 'good');
            result = i;
            win.close();
          } else toast(scene, 'Zapis nie powiódł się!', 'bad');
        } else if (Save.loadSlot(i) && campaign.state.party.length) {
          result = i;
          win.close();
        } else toast(scene, 'Nie udało się wczytać zapisu.', 'bad');
      }, { w: 54, h: 15, size: 6.5, primary: mode === 'save' || can });
      if (!can) act.box.setAlpha(0.4);
      row.add(act.box);
      win.add(row);
    }
    win.add(button(scene, W - 62, H - 20, 'Anuluj', () => win.close(), { w: 54, size: 7 }).box);
  });
}

// ------------------------------------------------------------------ portrety i ikony (malowane kodem z Oldgame/src/gfx)

interface PortraitSource {
  id?: string;
  recruitId?: string;
  /** Szablon wroga (EnemyId): szabrownicy mają portret PixelLab w src/assets/portraits/<templateId>.png. */
  templateId?: string;
  name?: string;
  classId?: string;
  ancestry?: string;
  look?: object;
}

const hashStr = (s: string): string => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
};

/**
 * Tekstura portretu o rozmiarze projektowym `size` (domyślnie 32). Portret jest malowany w 2x gęstości projektowej
 * (32 -> 64 px, 40 -> 80 px), a HiRes dokłada Scale2x do gęstości płótna - bez skalowania na GPU, więc jest ostry.
 * Wyświetlaj go w tym samym rozmiarze, w jakim został zamówiony. Klucz zawiera ART: po zmianie rozdzielczości
 * (applyResolution) powstaje nowa tekstura w nowej gęstości.
 */
export function portraitKey(scene: Phaser.Scene, ch: PortraitSource, size = 32): string {
  // najemnik albo wróg (szablon, np. raider_thug) z gotowym portretem (iso/SpriteUnits: popiersie PixelLab 64x64),
  // powiększany najbliższym sąsiadem - zgodny z postacią na mapie zamiast starego portretu malowanego kodem
  const sprite = spriteIdOf(ch) ?? enemySpriteId(ch.templateId);
  if (hasSpritePortrait(scene, sprite)) {
    const key = `porpl_${sprite}_${size}@${ART}`;
    if (!scene.textures.exists(key)) addHiRes(scene, key, spritePortraitCanvas(scene, sprite), { w: size, h: size, smooth: false });
    return key;
  }
  const id = hashStr(`${ch.recruitId ?? ch.id ?? ch.name}|${ch.classId}|${ch.ancestry}|${JSON.stringify(ch.look ?? {})}`);
  const key = `por_${id}_${size}@${ART}`;
  if (!scene.textures.exists(key)) addHiRes(scene, key, portraitCanvas(ch, size * 2) as HTMLCanvasElement, { w: size, h: size });
  return key;
}

/** Portret w ramce; (x, y) = lewy górny róg, size w pikselach projektowych. Tekstura 1:1 z pikselami ekranu. */
export function portrait(scene: Phaser.Scene, x: number, y: number, ch: PortraitSource, size = 32, frame: number = PAL.edge): Phaser.GameObjects.Container {
  const img = scene.add.image(0, 0, portraitKey(scene, ch, size)).setOrigin(0).setDisplaySize(size, size);
  const edge = scene.add.rectangle(0, 0, size, size).setOrigin(0).setStrokeStyle(1, frame);
  return scene.add.container(x, y, [img, edge]);
}

/** Ikona przedmiotu w gęstości płótna (HiRes): rozmiar projektowy `size`, bez skalowania na GPU. */
export function itemIconImage(scene: Phaser.Scene, x: number, y: number, id: string, size = 12): Phaser.GameObjects.Image {
  const def = itemDef(id);
  const key = `ico_${def?.icon ?? ''}_${def?.type ?? id}_${id}_${size}@${ART}`;
  if (!scene.textures.exists(key)) addHiRes(scene, key, itemIcon(def ?? id, 32) as HTMLCanvasElement, { w: size, h: size });
  return scene.add.image(x, y, key).setOrigin(0).setDisplaySize(size, size);
}

/** Ikona zdolności (Oldgame/src/gfx/icons.js: abilityIcon) - odznaka z glifem wg id/icon zdolności, malowana natywnie. */
export function abilityIconImage(scene: Phaser.Scene, x: number, y: number, id: string, size = 12): Phaser.GameObjects.Image {
  const def = abilityDef(id);
  const src = def ? { icon: def.icon, id: def.id, name: def.name, fx: def.fx } : id;
  const key = `abico_${abilityKind(src)}_${size}@${ART}`;
  if (!scene.textures.exists(key)) addHiRes(scene, key, abilityIcon(src, 24) as HTMLCanvasElement, { w: size, h: size });
  return scene.add.image(x, y, key).setOrigin(0).setDisplaySize(size, size);
}

const TYPE_LABEL: Record<string, string> = { weapon: 'broń', armor: 'pancerz', shield: 'tarcza', consumable: 'zużywalne', junk: 'złom', tech: 'technika', ammo: 'amunicja' };

/** Opis przedmiotu do podpowiedzi (port itemTip z Oldgame/src/scenes/meta/common.js). */
export function itemTip(id: string, extra = ''): string {
  const it = itemDef(id);
  if (!it) return id;
  const lines = [`${it.name}  (${TYPE_LABEL[it.type] ?? it.type}${it.level ? `, poz. ${it.level}` : ''})`, it.desc];
  if (it.type === 'weapon') {
    const w = it.weapon;
    lines.push(`Obrażenia ${w.damage} (${w.dmgType})${w.range ? ` · zasięg ${w.range}` : ' · wręcz'}${w.hands === 2 ? ' · dwuręczna' : ''}${w.traits.length ? ` · ${w.traits.join(', ')}` : ''}`);
  } else if (it.type === 'armor') {
    lines.push(`KP +${it.armor.ac} · limit Zrę. ${it.armor.dexCap}${it.armor.speedPenalty ? ` · prędkość −${it.armor.speedPenalty}` : ''}`);
  } else if (it.type === 'shield') {
    lines.push(`Tarcza: KP +${it.shield.ac} · twardość ${it.shield.hardness}`);
  } else {
    const st = itemStatLine(it);
    if (st) lines.push(st);
  }
  lines.push(`Cena: ${it.price} Złomu${extra}`);
  return lines.filter(Boolean).join('\n');
}

// ------------------------------------------------------------------ podpowiedź pod kursorem

export class Tip {
  private readonly box: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly text: PixelText;
  private owner: Phaser.GameObjects.GameObject | null = null;

  constructor(scene: Phaser.Scene, wrap = 200) {
    this.bg = scene.add.rectangle(0, 0, 10, 10, 0x120e0a, 0.97).setOrigin(0).setStrokeStyle(1, PAL.edgeHi);
    this.text = label(scene, 4, 3, '', { size: 6, wrap, lineSpacing: 1.5 });
    this.box = scene.add.container(0, 0, [this.bg, this.text]).setDepth(D_TIP).setVisible(false);
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.box.visible && this.place(p));
  }

  private place(p: Phaser.Input.Pointer): void {
    const k = this.box.scaleX, w = this.bg.width * k, h = this.bg.height * k;
    let x = p.worldX + 8, y = p.worldY + 8;
    if (x + w > BASE_W - 2) x = p.worldX - w - 6;
    if (y + h > BASE_H - 2) y = p.worldY - h - 6;
    this.box.setPosition(Math.max(2, x), Math.max(2, y));
  }

  /** Pokazuje `content()` po najechaniu na obiekt (obiekt musi być interaktywny). */
  attach<T extends Phaser.GameObjects.GameObject>(obj: T, content: () => string): T {
    obj.on('pointerover', (p: Phaser.Input.Pointer) => {
      const s = content();
      if (!s) return;
      this.owner = obj;
      this.text.setText(s);
      this.bg.setSize(this.text.displayWidth + 8, this.text.displayHeight + 7);
      this.box.setScale(Settings.uiScale).setVisible(true);
      this.place(p);
    });
    const hide = (): void => {
      if (this.owner === obj) this.hide();
    };
    obj.on('pointerout', hide);
    obj.on('pointerdown', hide);
    obj.once('destroy', hide);
    return obj;
  }

  hide(): void {
    this.owner = null;
    this.box.setVisible(false);
  }
}

// ------------------------------------------------------------------ komunikaty i okna modalne

export type Tone = 'good' | 'amber' | 'bad';
const TONE: Record<Tone, number> = { good: PAL.good, amber: PAL.amber, bad: PAL.bad };

export function toast(scene: Phaser.Scene, msg: string, tone: Tone = 'amber'): void {
  const t = label(scene, 0, 0, msg, { size: 7, color: TONE[tone], wrap: 280, align: 'center' }).setOrigin(0.5);
  const bg = scene.add.rectangle(0, 0, t.displayWidth + 16, t.displayHeight + 8, 0x120e0a, 0.96).setStrokeStyle(1, TONE[tone]);
  const box = scene.add.container(BASE_W / 2, 30, [bg, t]).setDepth(D_TOAST).setAlpha(0).setScale(Settings.uiScale);
  scene.tweens.add({ targets: box, alpha: 1, y: 36, duration: 160 });
  scene.tweens.add({ targets: box, alpha: 0, delay: 2200, duration: 400, onComplete: () => box.destroy() });
}

/** Czy nad sceną wisi okno modalne (skróty klawiszowe sceny powinny wtedy milczeć). */
export const modalOpen = (scene: Phaser.Scene): boolean => (scene.data.get('modals') ?? 0) > 0;

export interface Window {
  box: Phaser.GameObjects.Container;
  w: number;
  h: number;
  add<T extends Phaser.GameObjects.GameObject>(o: T): T;
  close(): void;
}

/** Zdarzenia Esc już obsłużone (jedno naciśnięcie zamyka jedno okno). */
const escSeen = new WeakSet<KeyboardEvent>();
/** Czy to naciśnięcie Esc zamknęło już okno (skróty sceny powinny je wtedy zignorować). */
export const escConsumed = (e: KeyboardEvent): boolean => escSeen.has(e);

/**
 * Okno na przyciemnionym tle, które połyka kliknięcia. `onClose` woła się raz przy zamknięciu.
 * Esc albo klik w tło zamyka najwyższe okno (Oldgame/src/core/settings.js:47-49), chyba że `dismiss: false`.
 */
export function openWindow(scene: Phaser.Scene, w: number, h: number, title: string, onClose?: () => void, opts: { dismiss?: boolean } = {}): Window {
  scene.data.set('modals', (scene.data.get('modals') ?? 0) + 1);
  const depth = D_MODAL + (scene.data.get('modals') as number) * 10;
  const back = scene.add.rectangle(0, 0, BASE_W, BASE_H, 0x000000, 0.66).setOrigin(0).setInteractive().setDepth(depth);
  const box = fitWindow(panel(scene, 0, 0, w, h, PAL.edgeHi, 0.98).setDepth(depth + 1), w, h);
  if (title) box.add(label(scene, 8, 6, title.toUpperCase(), { size: 9, bold: true, color: UI_TITLE }));
  // przełącznik przezroczystości wszystkich okien (● / ◐ / ○) w prawym górnym rogu nagłówka
  box.add(uiAlphaToggle(scene, w - 6, 5));
  let closed = false;
  const level = scene.data.get('modals') as number;
  const dismiss = opts.dismiss !== false;
  // tylko najwyższe okno reaguje na Esc (poziom = liczba otwartych okien w chwili otwarcia)
  const onEsc = (e: KeyboardEvent): void => {
    if (escSeen.has(e)) return; // Phaser potrafi wyemitować to samo zdarzenie drugi raz
    if (e.key === 'Escape' && dismiss && (scene.data.get('modals') as number) === level) {
      escSeen.add(e);
      win.close();
    }
  };
  if (dismiss) back.on('pointerdown', () => win.close());
  // klawisz rejestrujemy w następnej klatce, żeby Esc otwierający okno go od razu nie zamknął
  scene.time.delayedCall(0, () => !closed && scene.input.keyboard?.on('keydown', onEsc));
  const win: Window = {
    box, w, h,
    add(o) {
      box.add(o);
      return o;
    },
    close() {
      if (closed) return;
      closed = true;
      scene.input.keyboard?.off('keydown', onEsc);
      scene.data.set('modals', Math.max(0, ((scene.data.get('modals') as number) ?? 1) - 1));
      back.destroy();
      box.destroy();
      onClose?.();
    },
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.input.keyboard?.off('keydown', onEsc));
  return win;
}

/**
 * Skala i środek okna wg rozmiaru interfejsu (Opcje: Settings.uiScale), tak by okno zawsze mieściło się na ekranie.
 * Zawartość okna leży w kontenerze, więc skaluje się razem z nim (także obszary kliknięć).
 */
export function fitWindow(box: Phaser.GameObjects.Container, w: number, h: number): Phaser.GameObjects.Container {
  const ui = Settings.uiScale;
  const k = Math.max(Math.min(ui, 1), Math.min(ui, (BASE_W - 4) / w, (BASE_H - 4) / h));
  return box.setScale(k).setPosition(Math.round((BASE_W - w * k) / 2), Math.round((BASE_H - h * k) / 2));
}

export interface DialogButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

/** Okno z tekstem i przyciskami (port UI.modal). Esc / klik w tło = pierwsza wartość z listy. */
export function dialog<T>(scene: Phaser.Scene, o: { title: string; body: string; buttons: DialogButton<T>[]; w?: number; tone?: number }): Promise<T> {
  return new Promise<T>((resolve) => {
    const w = o.w ?? 260;
    const probe = label(scene, 0, 0, o.body, { size: 7, wrap: w - 20, lineSpacing: 2, color: o.tone ?? PAL.text });
    const h = Math.ceil(probe.displayHeight) + 54;
    // Esc / klik w tło = pierwsza wartość z listy
    const win = openWindow(scene, w, h, o.title, () => resolve(o.buttons[0].value));
    win.add(probe.setPosition(10, 22));
    let x = w - 8;
    for (const b of [...o.buttons].reverse()) {
      const btn = button(scene, 0, 0, b.label, () => {
        resolve(b.value);
        win.close();
      }, { primary: b.primary, danger: b.danger, size: 7 });
      const bw = (btn.box.list[1] as Phaser.GameObjects.Rectangle).width;
      x -= bw;
      btn.box.setPosition(x, h - 22);
      x -= 6;
      win.add(btn.box);
    }
  });
}

// ------------------------------------------------------------------ opcje (Oldgame/src/core/settings.js)

/** Okno opcji: dźwięk + wyciszenie, pełny ekran, rozmiar interfejsu, efekty retro, rozdzielczość. Esc / klik w tło zamyka. */
export function openOptions(scene: Phaser.Scene): Promise<void> {
  return new Promise<void>((resolve) => {
    const W = 400, H = 266;
    const win = openWindow(scene, W, H, 'Opcje', resolve);
    const L = 12, R = 200;
    const head = (x: number, y: number, t: string): void => void win.add(label(scene, x, y, t.toUpperCase(), { size: 6, bold: true, color: PAL.dim }));

    // --- dźwięk (lewa kolumna)
    head(L, 22, 'Dźwięk');
    const vol = SoundManager.getVolume();
    const rows: [keyof typeof vol, string][] = [['master', 'Głośność'], ['music', 'Muzyka'], ['sfx', 'Efekty']];
    rows.forEach(([k, name], i) => {
      const y = 33 + i * 16;
      win.add(label(scene, L, y, name, { size: 6.5 }));
      const bx = L + 48, bw = 72;
      const track = win.add(scene.add.rectangle(bx, y + 1, bw, 8, 0x000000, 0.6).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive({ useHandCursor: true }));
      const fill = win.add(scene.add.rectangle(bx + 1, y + 2, 1, 6, PAL.amber).setOrigin(0));
      const val = win.add(label(scene, bx + bw + 4, y, '', { size: 6, color: PAL.amber }));
      const paint = (): void => {
        const v = SoundManager.getVolume()[k];
        fill.setSize(Math.max(1, Math.round((bw - 2) * v)), 6);
        val.setText(`${Math.round(v * 100)}%`);
      };
      const set = (p: Phaser.Input.Pointer): void => {
        const local = (p.worldX - (win.box.x + bx * win.box.scaleX)) / (bw * win.box.scaleX);
        SoundManager.setVolume({ [k]: Math.round(Phaser.Math.Clamp(local, 0, 1) * 20) / 20 });
        paint();
      };
      track.on('pointerdown', (p: Phaser.Input.Pointer) => {
        set(p);
        if (k !== 'music') SoundManager.sfx('click');
      });
      track.on('pointermove', (p: Phaser.Input.Pointer) => p.isDown && set(p));
      paint();
    });
    const toggle = (x: number, y: number, name: string, get: () => boolean, set: (v: boolean) => void, tipText?: string): void => {
      win.add(label(scene, x, y + 2, name, { size: 6.5 }));
      const b = button(scene, x + 100, y, '', () => {
        set(!get());
        b.setLabel(get() ? 'Wł.' : 'Wył.');
      }, { w: 44, h: 12, size: 6 });
      b.setLabel(get() ? 'Wł.' : 'Wył.');
      win.add(b.box);
      if (tipText) win.add(label(scene, x, y + 12, tipText, { small: true, maxW: W - 12 - x, color: PAL.dim }));
    };
    toggle(L, 84, 'Wycisz wszystko', () => SoundManager.muted, (v) => (SoundManager.muted = v));

    // --- ekran
    head(L, 104, 'Ekran');
    const fs = button(scene, L, 114, '', () => {
      if (scene.scale.isFullscreen) scene.scale.stopFullscreen();
      else scene.scale.startFullscreen();
      scene.time.delayedCall(300, () => fs.setLabel(scene.scale.isFullscreen ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran'));
    }, { w: 168, h: 13, size: 6.5 });
    fs.setLabel(scene.scale.isFullscreen ? 'Wyjdź z pełnego ekranu' : 'Pełny ekran');
    win.add(fs.box);

    // --- efekty retro (prawa kolumna)
    head(R, 22, 'Efekty retro');
    toggle(R, 32, 'Linie skanowania', () => Settings.values.scanlines, (v) => Settings.set('scanlines', v), 'poziome pasy jak na monitorze CRT');
    toggle(R, 53, 'Ziarno filmu', () => Settings.values.grain, (v) => Settings.set('grain', v), 'migoczący szum obrazu');
    toggle(R, 74, 'Dithering', () => Settings.values.dither, (v) => Settings.set('dither', v), 'raster Bayera jak przy ograniczonej palecie');
    toggle(R, 95, 'Profil Amiga', () => Settings.values.amiga, (v) => Settings.set('amiga', v), 'A1200/PiStorm: 50 Hz, bez nakładek (restart)');
    toggle(R, 116, 'Układ okien misji', () => Settings.values.layout, (v) => MissionLayout.setEnabled(v), 'zapamiętuj pozycje i skale okien HUD');

    // --- rozmiar interfejsu (Oldgame/src/core/settings.js:56-57): skala okien, podpowiedzi i komunikatów
    head(L, 142, 'Rozmiar interfejsu');
    const uiMarks: [number, UiButton][] = [];
    const paintUi = (): void => {
      for (const [k, b] of uiMarks) b.setLabel((Math.abs(Settings.uiScale - k) < 0.01 ? '● ' : '○ ') + (UI_SIZES.find(([v]) => v === k)?.[1] ?? '').replace('Bardzo', 'B.'));
    };
    UI_SIZES.forEach(([k], i) => {
      const b = button(scene, L + i * 94, 152, '', () => {
        Settings.set('ui', k);
        fitWindow(win.box, W, H);
        paintUi();
      }, { w: 90, h: 13, size: 6 });
      uiMarks.push([k, b]);
      win.add(b.box);
    });
    paintUi();

    // --- przezroczystość okien UI (to samo co przełącznik ●/◐/○ w nagłówku każdego okna)
    head(L, 172, 'Przyciemnienie okien');
    const alphaMarks: [UiAlpha, UiButton][] = [];
    const paintAlpha = (): void => {
      for (const [k, b] of alphaMarks) b.setLabel((Settings.values.uiAlpha === k ? '● ' : '○ ') + (UI_ALPHAS.find(([v]) => v === k)?.[1] ?? ''));
    };
    UI_ALPHAS.forEach(([k], i) => {
      const b = button(scene, L + 148 + i * 76, 169, '', () => {
        Settings.set('uiAlpha', k);
        paintAlpha();
      }, { w: 72, h: 13, size: 6 });
      alphaMarks.push([k, b]);
      win.add(b.box);
    });
    const offAlpha = Settings.onChange(paintAlpha);
    win.box.once(Phaser.GameObjects.Events.DESTROY, offAlpha);
    paintAlpha();

    // --- rozdzielczość (dół, pełna szerokość); poza misją zmienia się od razu, w misji po ponownym uruchomieniu
    head(L, 188, 'Rozdzielczość obrazu');
    const marks: [ResSetting, UiButton][] = [];
    const zoomTxt = (z: number): string => (Number.isInteger(z) ? `${z}` : z.toFixed(2));
    const paintRes = (): void => {
      for (const [r, b] of marks) b.setLabel((Settings.values.res === r ? '● ' : '○ ') + resPreset(r).label);
      const want = resPreset(Settings.values.res);
      const now = `Teraz: ${CANVAS_W}×${CANVAS_H} (siatka ${BASE_W}×${BASE_H} ×${zoomTxt(ZOOM)})`;
      resNote.setText(want.id !== RES ? `${now} → po ponownym uruchomieniu: ${want.w}×${want.h}` : now);
      restart.box.setVisible(want.id !== RES);
    };
    RES_PRESETS.forEach((r, i) => {
      const b = button(scene, L + i * 76, 198, '', () => {
        Settings.set('res', r.id);
        if (canApplyZoomLive(scene.game)) applyResolution(scene.game, r.id);
        paintRes();
      }, { w: 72, h: 13, size: 6 });
      marks.push([r.id, b]);
      win.add(b.box);
    });
    const note = { small: true, maxW: W - L * 2, color: PAL.dim };
    const resNote = win.add(label(scene, L, 215, '', note));
    win.add(label(scene, L, 222, 'Domyślna: Full HD 1920×1080. Przy 640×480 (4:3) obraz ma czarne pasy.', note));
    win.add(label(scene, L, 229, 'W trakcie misji zmiana rozdzielczości wymaga ponownego uruchomienia.', note));
    const restart = button(scene, L, H - 22, 'Uruchom ponownie', async () => {
      const inMission = scene.scene.isActive('WorldScene');
      const ok = await dialog(scene, {
        title: 'Ponowne uruchomienie',
        body: inMission ? 'Gra zostanie przeładowana. Postęp bieżącej misji przepadnie (kampania wróci do ostatniego zapisu).' : 'Gra zostanie zapisana i przeładowana w nowej rozdzielczości.',
        buttons: [{ label: 'Anuluj', value: false }, { label: 'Uruchom ponownie', value: true, primary: true }],
      });
      if (!ok) return;
      if (!inMission && campaign.state.party.length && !scene.scene.isActive('TitleScene')) Save.write();
      window.location.reload();
    }, { w: 118, size: 6.5 });
    win.add(restart.box);
    paintRes();
    const resetLayout = button(scene, L + 124, H - 22, 'Domyślny układ okien', () => {
      MissionLayout.reset();
      SoundManager.sfx('click');
      toast(scene, 'Przywrócono domyślny układ okien misji');
    }, { w: 140, size: 6.5 });
    win.add(resetLayout.box);

    win.add(button(scene, W - 62, H - 22, 'Gotowe', () => win.close(), { w: 54, size: 7, primary: true }).box);
  });
}

// ------------------------------------------------------------------ imię najemnika (Oldgame/src/scenes/meta/nameedit.js)

export interface NamePromptOptions {
  value: string;
  color?: string | null;
  taken: () => string[];
  generate: () => string;
  /** Imię domyślne (przycisk "Przywróć"). */
  reset?: () => string;
}

/** Edycja imienia z klawiatury + losowanie + kolor. Zwraca null po anulowaniu. */
export function namePrompt(scene: Phaser.Scene, o: NamePromptOptions): Promise<{ name: string; color: string | null } | null> {
  return new Promise((resolve) => {
    const W = 270, H = 132;
    let value = o.value;
    let color: string | null = o.color ?? null;
    let result: { name: string; color: string | null } | null = null;
    const kb = scene.input.keyboard;
    // Phaser potrafi wyemitować to samo zdarzenie ponownie (kolejka klawiatury jest przetwarzana także przy ruchu myszy)
    const seen = new WeakSet<KeyboardEvent>();
    const onKey = (e: KeyboardEvent): void => {
      if (seen.has(e)) return;
      seen.add(e);
      if (e.key === 'Enter') return commit();
      if (e.key === 'Escape') return win.close();
      // Ctrl/Cmd+V: wklejenie imienia ze schowka (pole tekstowe w Oldgame pozwalało wkleić)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        void navigator.clipboard?.readText?.().then((t) => {
          value = [...(value + t.replace(/[\r\n\t]+/g, ' '))].slice(0, NAME_MAX).join('');
          paint();
        }).catch(() => {});
        return;
      }
      if (e.key === 'Backspace') value = [...value].slice(0, -1).join('');
      else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && [...value].length < NAME_MAX) value += e.key;
      else return;
      e.preventDefault();
      paint();
    };
    const win = openWindow(scene, W, H, 'Imię najemnika', () => {
      kb?.off('keydown', onKey);
      blink.remove();
      resolve(result);
    });
    win.add(scene.add.rectangle(10, 24, W - 20, 16, 0x000000, 0.6).setOrigin(0).setStrokeStyle(1, PAL.amber));
    const field = win.add(label(scene, 14, 27, '', { size: 9, bold: true }));
    const caret = win.add(scene.add.rectangle(0, 27, 1, 10, PAL.amber).setOrigin(0));
    const err = win.add(label(scene, 10, 44, '', { size: 6, color: PAL.bad }));
    const blink = scene.time.addEvent({ delay: 420, loop: true, callback: () => caret.setVisible(!caret.visible) });
    const paint = (): void => {
      field.setText(value).setColor(color ?? hex(PAL.text));
      caret.x = 14 + field.displayWidth + 1;
      err.setText(`${[...value].length}/${NAME_MAX} · pisz z klawiatury, Enter = zatwierdź`).setColor(hex(PAL.dim));
    };
    const commit = (): void => {
      const c = checkName(value, o.taken());
      if (!c.ok) {
        SoundManager.sfx('error');
        err.setText(c.error).setColor(hex(PAL.bad));
        return;
      }
      result = { name: c.name, color };
      SoundManager.sfx('pickup', { vol: 0.5 });
      win.close();
    };
    // kolor imienia
    win.add(label(scene, 10, 58, 'Kolor imienia', { size: 6, color: PAL.dim }));
    const marks: [string | null, Phaser.GameObjects.Rectangle][] = [];
    NAME_COLORS.forEach((c, i) => {
      const sw = win.add(scene.add.rectangle(70 + i * 14, 56, 10, 10, parseColor(c ?? undefined, PAL.text)).setOrigin(0).setInteractive({ useHandCursor: true }));
      if (!c) win.add(scene.add.rectangle(70 + i * 14, 56, 5, 10, PAL.amber).setOrigin(0));
      sw.on('pointerdown', () => {
        SoundManager.sfx('click');
        color = c;
        mark();
        paint();
      });
      marks.push([c, sw]);
    });
    const mark = (): void => marks.forEach(([c, sw]) => sw.setStrokeStyle(c === color ? 2 : 1, c === color ? 0xffffff : 0x000000));
    mark();
    win.add(button(scene, 10, 76, 'Losuj imię', () => {
      // do 8 prób, aż imię przejdzie walidację (Oldgame/src/scenes/meta/nameedit.js:29)
      for (let i = 0; i < 8; i++) {
        value = o.generate();
        if (checkName(value, o.taken()).ok) break;
      }
      SoundManager.sfx('dice', { vol: 0.4 });
      paint();
    }, { w: 70, size: 7 }).box);
    if (o.reset)
      win.add(button(scene, 86, 76, 'Przywróć', () => {
        value = o.reset!();
        paint();
      }, { w: 60, size: 7 }).box);
    win.add(button(scene, W - 128, H - 22, 'Anuluj', () => win.close(), { w: 54, size: 7 }).box);
    win.add(button(scene, W - 68, H - 22, 'Zatwierdź', () => commit(), { w: 60, size: 7, primary: true }).box);
    kb?.on('keydown', onKey);
    paint();
  });
}

// ------------------------------------------------------------------ lista przewijana kółkiem

export type RowBuilder<T> = (item: T, row: Phaser.GameObjects.Container, w: number, index: number) => void;

export class ScrollList<T> {
  readonly box: Phaser.GameObjects.Container;
  private items: T[] = [];
  private offset = 0;
  private readonly scene: Phaser.Scene;
  private readonly x: number;
  private readonly y: number;
  private readonly w: number;
  private readonly h: number;
  private readonly rowH: number;
  private readonly build: RowBuilder<T>;
  private readonly onWheel: (p: Phaser.Input.Pointer, over: unknown, dx: number, dy: number) => void;
  /** Tekst pokazywany, gdy lista jest pusta. */
  empty = '';

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, rowH: number, build: RowBuilder<T>, parent?: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.rowH = rowH;
    this.build = build;
    this.box = scene.add.container(x, y);
    parent?.add(this.box);
    this.onWheel = (p, _over, _dx, dy) => {
      if (!this.box.active || !this.box.visible) return;
      const m = this.box.getWorldTransformMatrix();
      if (p.worldX < m.tx || p.worldX > m.tx + this.w || p.worldY < m.ty || p.worldY > m.ty + this.h) return;
      this.scroll(dy > 0 ? 1 : -1);
    };
    scene.input.on('wheel', this.onWheel);
    this.box.once('destroy', () => scene.input.off('wheel', this.onWheel));
  }

  private get visible(): number {
    return Math.max(1, Math.floor(this.h / this.rowH));
  }

  scroll(d: number): void {
    const max = Math.max(0, this.items.length - this.visible);
    const next = Phaser.Math.Clamp(this.offset + d, 0, max);
    if (next === this.offset) return;
    this.offset = next;
    this.draw();
  }

  setItems(items: T[]): void {
    this.items = items;
    this.offset = Phaser.Math.Clamp(this.offset, 0, Math.max(0, items.length - this.visible));
    this.draw();
  }

  private draw(): void {
    this.box.removeAll(true);
    const n = this.visible, total = this.items.length;
    const bar = total > n;
    const w = this.w - (bar ? 5 : 0);
    if (!total && this.empty) this.box.add(label(this.scene, 2, 2, this.empty, { size: 6, color: PAL.dim, wrap: w - 4 }));
    for (let i = 0; i < n && this.offset + i < total; i++) {
      const row = this.scene.add.container(0, i * this.rowH);
      this.box.add(row);
      this.build(this.items[this.offset + i], row, w, this.offset + i);
    }
    if (bar) {
      const th = Math.max(8, (this.h * n) / total);
      const ty = ((this.h - th) * this.offset) / Math.max(1, total - n);
      this.box.add(this.scene.add.rectangle(this.w - 3, 0, 3, this.h, 0x000000, 0.4).setOrigin(0));
      this.box.add(this.scene.add.rectangle(this.w - 3, ty, 3, th, PAL.edge).setOrigin(0));
    }
  }

  get position(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }
}

/** Mały przycisk do wierszy list. */
export function miniButton(scene: Phaser.Scene, x: number, y: number, text: string, onClick: () => void, o: { w?: number; enabled?: boolean; primary?: boolean } = {}): UiButton {
  return button(scene, x, y, text, onClick, { size: 6, h: 11, w: o.w, enabled: o.enabled, primary: o.primary });
}

/** Pasek postępu (PW / PD). */
export function bar(scene: Phaser.Scene, x: number, y: number, w: number, h: number, ratio: number, color: number, back = 0x3a1410): Phaser.GameObjects.GameObject[] {
  const k = Phaser.Math.Clamp(ratio, 0, 1);
  return [scene.add.rectangle(x, y, w, h, back).setOrigin(0), scene.add.rectangle(x, y, Math.max(k > 0 ? 1 : 0, Math.round(w * k)), h, color).setOrigin(0)];
}
