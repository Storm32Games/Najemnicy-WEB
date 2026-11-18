import Phaser from 'phaser';
import { PixelText, pixelText } from './ui/BitmapFont';
import { D20_SETTLE, D20_SIZE, D20_TUMBLE, DIE_SETTLE, DIE_SIDES, DIE_TUMBLE, DMG_DIE_SIZE, type DieColor, type DieSides, dieTexKey, paintDieSheet } from './ui/DiceArt';
import { SoundManager } from '../audio/SoundManager';
import {
  type ActionButton,
  type HudChange,
  HudState,
  type InitEntry,
  type InventoryRow,
  type LogEntry,
  type LogTone,
  abilityRows,
  backpackRows,
  degreeName,
  classLabel,
  conditionChips,
  equipmentRows,
  itemStatLine,
  hpRatio,
  hpTone,
  stateLabel,
  statPairs,
  type CivilianRow,
} from '../core/HudState';
import type { Character, EquipSlot } from '../core/rules/types';
import { itemDef } from '../core/rules/lookup';
import { normWeapon } from '../core/rules/stats';
import { TurnPhase } from '../core/TurnManager';
import { BASE_H, BASE_W, PAL, SMALL_TEXT, UI_TITLE, ZOOM, button as kitButton, fitCamera, label, parseColor, uiAlphaToggle, uiBg } from './ui/Kit';
import { fitText } from './ui/FontGlyphs';
import { MissionLayout, type MissionLayoutData } from './ui/MissionLayout';
import { openPartyWindow } from './ui/PartyWindow';
import { type Window as UiWindow, abilityIconImage, itemIconImage, modalOpen, openOptions, openWindow, portraitKey } from './ui/Widgets';

// HUD misji - port Oldgame/src/mission/hud.js (DOM) do Phasera, w stylu terminala CRT.
//   góra:         karty drużyny (portret, PW, AP, stany), w walce + karty wrogów  <- H.party_ / H.initBar
//   środek góra:  runda / tura                                         <- H.initBar
//   prawy górny:  przyciski: pomoc, opcje, tempo, mapa, ekwipunek       <- H.menu
//   panel akcji:  bronie (klik = wybór) + akcje walki; przesuwany        <- C.refreshBar
//   lewy dół:     opis pola/wroga pod kursorem                         <- H.showInfo
//   prawy dół:    dziennik walki (kółko = przewijanie, zwijany)        <- H.log
//   panel (I):    karta postaci: statystyki, wyposażenie, plecak       <- H.sheet
// Menu, pasek rundy, panel akcji, karta postaci i dziennik mają własną skalę (−/+ w nagłówku; kółko nad nagłówkiem
// poza dziennikiem), własną czcionkę (a/A w nagłówku: treść panelu w tej samej szerokości okna) i dają się przesuwać
// za nagłówek; PPM na nagłówku = pozycja, skala i czcionka domyślna.
// Menu i panel akcji mają osobny układ dla eksploracji i dla walki (przełączany sam przy zmianie trybu). Karty drużyny mają stałą, mniejszą czcionkę.
// Karty drużyny (w walce razem z kartami wrogów) przesuwa się, przeciągając kartę / ramkę; skala: uchwyt w prawym
// dolnym rogu kart (jak w dzienniku). Domyślnie leżą poziomo przy górnej krawędzi; upuszczone dalej od górnej / dolnej
// krawędzi układają się pionowo, a przyciągnięte z powrotem do krawędzi - znowu poziomo.
// Cały stan pochodzi z HudState (src/core); polecenia wracają przez hud.command().

// ------------------------------------------------------------------ paleta / czcionka

// Paleta Oldgame (Oldgame/index.html :root + mission/hud.js) - te same kolory co PAL w ui/Kit.ts.
// Nazwy zostały po dawnym zielonym terminalu: green = "dobrze/aktywne", greenDim = zwykła rdzawa ramka.
const C = {
  bg: 0x120e0b, // tło .m-card / paneli
  green: PAL.good,
  greenDim: PAL.edge,
  amber: PAL.amber,
  amberDim: 0x4a3417, // tło aktywnego przycisku .m-ab.act
  red: PAL.bad,
  redDim: 0x5a1e16,
  grey: PAL.dim,
  greyDim: 0x4a3c2c,
  white: PAL.text,
} as const;

/** Tekst dziennika: cały szary, kolorowe są tylko imiona najemników (kolor wybrany przy werbunku / w Drużynie). */
const LOG_GREY = 0x9c958a;
/** Kolory banera (palety Oldgame .m-log). */
const TONE: Record<LogTone, number> = { dim: LOG_GREY, good: PAL.good, bad: PAL.bad, amber: PAL.amber, hd: PAL.text };
/** Kolory paska PW na kartach drużyny (hpCol('pc') z Oldgame/src/mission/hud.js). */
const HP_FILL = { good: PAL.good, amber: PAL.amber, bad: PAL.bad } as const;

const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);

const M = 4; // margines od krawędzi
const LH = 9; // wysokość linii tekstu

// geometria paneli
/** Karta najemnika (port .m-card z Oldgame/src/mission/hud.js): duży portret, imię na dole portretu, pasek PW pod nim. */
const PC_PT = 40;
/** Kolor podopiecznych (uwolnionych cywili): ramka, imię, pasek PW - jak paski nad nimi na mapie. */
const C_CIV = 0x5ab4e0;
/** Opis karty cywila zlecenia. */
const civilianTip = (c: CivilianRow): string =>
  c.state === 'dead'
    ? `${c.ch.name} · nie żyje (zginął od ognia drużyny)`
    : c.state === 'freed'
      ? `${c.ch.name} · podopieczny · PW ${Math.max(0, c.ch.hp)}/${c.ch.maxHp} · chybiony strzał na linii ognia albo wybuch obok może go zranić`
      : `${c.ch.name} · w niewoli — znajdź i uwolnij`;
const PARTY_W = PC_PT + 4;
const PC_HPB = 9;
const PARTY_H = 2 + PC_PT + 1 + PC_HPB + 2;
const PC_GAP = 3;
/** Przesunięcie kursora (px projektowe), od którego wciśnięcie karty staje się przeciąganiem, a nie kliknięciem. */
const PARTY_DRAG_MIN = 3;
/** Odległość kursora od górnej / dolnej krawędzi, przy której karty drużyny przechodzą w układ poziomy. */
const PARTY_EDGE = 14;
/** Menu po prawej (port .m-menu): siatka 2 kolumn ("Odwrót" + "Wyjdź z gry" w ostatnim rzędzie). */
const BTN_W = 78;
const BTN_H = 12;
const BTN_GAP = 2;
const MENU_ROWS = 6;
const LOG_W = 196;
const LOG_LINES = 9;
const LOG_H = 13 + LOG_LINES * LH + 3;
const SHEET_W = 186;
const SHEET_X = M + PARTY_W + 4;
/** Prawa kolumna: siatka przycisków 2 x 6 + panel celów. */
const RCOL_W = BTN_W * 2 + 4;
/** Nagłówek menu (uchwyt do przesuwania + przyciski skali). */
const MENU_HEAD = 11;
/** Początek celów zlecenia w treści menu (pod przyciskami, w pikselach treści przed skalą czcionki). */
const OBJ_BODY = (BTN_H + BTN_GAP) * MENU_ROWS + 2;
/** Środek góry: między kartami drużyny a prawą kolumną. */
const MID_X0 = M + PARTY_W + 4;
const MID_X1 = BASE_W - M - RCOL_W - 4;
const TOP_W = MID_X1 - MID_X0;
const SHEET_Y = M + LH + 6;
/** Pasek rundy (sam napis; wrogowie są kartami obok drużyny). */
const TOP_H = LH;
/** Pasek akcji: dół, między kartami drużyny a dziennikiem. */
const AB_X = M + PARTY_W + 4;
const AB_W = BASE_W - M - LOG_W - 4 - AB_X;
const AB_COLS = 2;
const AB_BH = 11;
/** Przesunięcia przycisków nagłówka (●, a, A, −, +) od prawej krawędzi "+" i ich łączna szerokość. */
const CTRL_DX = [-37, -28, -19, -9, 0] as const;
const CTRL_W = 44;
/** Kafel broni w panelu akcji (ikona + nazwa + obrażenia). */
const WT_H = 13;

type BtnVariant = 'normal' | 'primary' | 'danger';
/** Panele ze skalą i pozycją (bez kart drużyny - te tylko się przesuwają). */
type PanelId = 'menu' | 'top' | 'actions' | 'sheet' | 'log';
type DragTarget = PanelId | 'party' | 'partySize' | 'logSize' | 'logH' | 'logThumb';

interface Button {
  bg: Phaser.GameObjects.Rectangle;
  text: PixelText;
  enabled: boolean;
  hovered: boolean;
  color: number;
  set(label: string, enabled: boolean): void;
  /** Zmiana stylu (np. "Odwrót" czerwony -> "Powrót" bursztynowy). */
  style(v: BtnVariant): void;
}

/** Pozycje przesuniętych paneli (null = domyślna); na poziomie modułu, żeby przetrwały kolejne misje. */
const panelPos: Record<PanelId, { x: number; y: number } | null> = { menu: null, top: null, actions: null, sheet: null, log: null };
/** Skala paneli (1 = bazowa); mniejsza skala = mniejsza czcionka, bo panel skaluje się w całości. */
const panelScale: Record<PanelId, number> = { menu: 1, top: 1, actions: 1, sheet: 1, log: 1 };
/**
 * Stopień czcionki paneli (a / A w nagłówku), niezależny od skali okna: 0 = czcionka skaluje się razem z panelem,
 * +-n = n pikseli płótna na piksel czcionki więcej / mniej. Szerokość panelu zostaje, treść zawija się / przycina.
 */
const fontStep: Record<PanelId, number> = { menu: 0, top: 0, actions: 0, sheet: 0, log: 0 };
const FONT_STEP_MAX = 6;
/** Granice skali czcionki względem panelu. */
const FONT_MIN = 0.5;
const FONT_MAX = 3;
/** Panele z dodatkowym, najmniejszym stopniem skali okna. */
const EXTRA_SMALL: readonly PanelId[] = ['menu', 'log', 'actions'];
/** Karty drużyny: pozycja (null = lewy górny róg) i układ (poziomy po upuszczeniu przy górnej / dolnej krawędzi). */
let partyPos: { x: number; y: number } | null = null;
let partyHoriz = true;
let partyScale = 1;
/**
 * Dostępne skale paneli: k / ZOOM (1 piksel projektowy = k pikseli płótna), żeby czcionka bitmapowa i ramki
 * trafiały w siatkę ekranu. Zakres ~0.5x - 1.5x; liczone na bieżąco, bo ZOOM może się zmienić między misjami.
 */
function panelScales(extra = false): number[] {
  const out: number[] = [];
  // extra = jeden stopień mniej (menu, dziennik, akcje), o ile pozwala rozdzielczość (co najmniej 1 piksel płótna)
  for (let k = Math.max(1, Math.ceil(ZOOM / 2) - (extra ? 1 : 0)); k <= Math.floor(ZOOM * 1.5); k++) out.push(k / ZOOM);
  // przy ułamkowym ZOOM (HD, QHD, 640x480) skala 1 nie wypada na całkowite k - dokładamy ją, bo to domyślna skala paneli
  if (!out.some((v) => Math.abs(v - 1) < 1e-6)) out.push(1);
  return out.sort((a, b) => a - b);
}
/**
 * Skala czcionki panelu (względem panelu) dla stopnia `step` przy skali panelu `s`: tekst trafia w całe piksele
 * płótna (round(ZOOM * s) + step pikseli płótna na piksel czcionki). Bez ograniczeń - sprawdza wywołujący.
 */
function fontScaleRaw(step: number, s: number): number {
  if (!step) return 1;
  const m = ZOOM * s;
  return Math.max(1, Math.round(m) + step) / m;
}
const fontScaleOf = (id: PanelId): number => Phaser.Math.Clamp(fontScaleRaw(fontStep[id], panelScale[id]), FONT_MIN, FONT_MAX);
/** Mniejsza, stała czcionka kart drużyny (~3/4, w całych pikselach płótna). */
function cardFontScale(): number {
  const m = ZOOM * partyScale;
  return Math.min(1, Math.max(1, Math.round(m * 0.75)) / m);
}
function nearestScale(list: number[], s: number): number {
  let best = 0;
  list.forEach((v, i) => Math.abs(v - s) < Math.abs(list[best]! - s) && (best = i));
  return best;
}
/** Przy zmianie skali przesuniętego panelu trzymamy krawędź bliższą brzegowi ekranu (w środku - środek). */
function keepAnchor(x: number, w0: number, w1: number, total: number): number {
  const c = x + w0 / 2;
  if (c < total / 3) return x;
  if (c > (total * 2) / 3) return Math.round(x + w0 - w1);
  return Math.round(c - w1 / 2);
}
/**
 * Menu i panel akcji mają osobny układ (pozycja, skala okna, czcionka) w eksploracji i w walce: w walce panel akcji
 * ma dużo więcej przycisków, więc zwykle chce się go mniejszego / gdzie indziej. Aktywny tryb siedzi w panelPos /
 * panelScale / fontStep (reszta kodu czyta tylko je); drugi tryb czeka w modeStore i podmienia się przy zmianie trybu.
 */
type ModePanel = 'menu' | 'actions';
type LayoutMode = 'explore' | 'combat';
const MODE_PANELS: readonly ModePanel[] = ['menu', 'actions'];
/** Klucz zapisu układu walki (eksploracja zostaje pod starym kluczem panelu - zgodność z dawnymi zapisami). */
const COMBAT_KEY = (id: ModePanel): string => `${id}@walka`;
interface ModeState {
  pos: { x: number; y: number } | null;
  scale: number;
  font: number;
}
const freshMode = (): Record<ModePanel, ModeState> => ({ menu: { pos: null, scale: 1, font: 0 }, actions: { pos: null, scale: 1, font: 0 } });
const modeStore: Record<LayoutMode, Record<ModePanel, ModeState>> = { explore: freshMode(), combat: freshMode() };
let layoutMode: LayoutMode = 'explore';
const modeName = (m: LayoutMode = layoutMode): string => (m === 'combat' ? 'walka' : 'eksploracja');
/** Bieżące wartości menu / akcji -> modeStore aktywnego trybu. */
function stashMode(): void {
  for (const id of MODE_PANELS) modeStore[layoutMode][id] = { pos: panelPos[id] ? { ...panelPos[id]! } : null, scale: panelScale[id], font: fontStep[id] };
}
/** modeStore trybu `m` -> bieżące wartości menu / akcji. */
function loadMode(m: LayoutMode): void {
  layoutMode = m;
  for (const id of MODE_PANELS) {
    const st = modeStore[m][id];
    panelPos[id] = st.pos ? { ...st.pos } : null;
    panelScale[id] = st.scale;
    fontStep[id] = st.font;
  }
}
/** Zmiana trybu (eksploracja <-> walka); true = układ menu / akcji się zmienił. */
function switchMode(m: LayoutMode): boolean {
  if (m === layoutMode) return false;
  stashMode();
  loadMode(m);
  return true;
}

/** Rozmiar dziennika (zmieniany uchwytem w prawym dolnym rogu). */
let logSize = { w: LOG_W, h: LOG_H };
const LOG_MIN_W = 120;

/** Układ domyślny wszystkich okien (PPM na nagłówku resetuje pojedynczy panel). */
function resetLayout(): void {
  for (const k of Object.keys(panelPos) as PanelId[]) {
    panelPos[k] = null;
    panelScale[k] = 1;
    fontStep[k] = 0;
  }
  modeStore.explore = freshMode();
  modeStore.combat = freshMode();
  partyPos = null;
  partyHoriz = true;
  partyScale = 1;
  logSize = { w: LOG_W, h: LOG_H };
}
/** Wczytanie zapisanego układu (opcja "Zapamiętuj układ okien misji"). */
function loadLayout(): void {
  const d = MissionLayout.load();
  if (!d) return;
  for (const k of Object.keys(panelPos) as PanelId[]) {
    if (d.panelPos && k in d.panelPos) panelPos[k] = d.panelPos[k] ?? null;
    if (d.panelScale?.[k]) panelScale[k] = d.panelScale[k]!;
    if (d.fontStep?.[k] !== undefined) fontStep[k] = Phaser.Math.Clamp(d.fontStep[k]!, -FONT_STEP_MAX, FONT_STEP_MAX);
  }
  // menu / akcje: eksploracja pod kluczem panelu, walka pod COMBAT_KEY (brak = jak w eksploracji, np. stary zapis)
  for (const id of MODE_PANELS) {
    const ex: ModeState = { pos: panelPos[id], scale: panelScale[id], font: fontStep[id] };
    modeStore.explore[id] = ex;
    const ck = COMBAT_KEY(id);
    const cb: ModeState = { ...ex, pos: ex.pos ? { ...ex.pos } : null };
    if (d.panelPos && ck in d.panelPos) cb.pos = d.panelPos[ck] ?? null;
    if (d.panelScale?.[ck]) cb.scale = d.panelScale[ck]!;
    if (d.fontStep?.[ck] !== undefined) cb.font = Phaser.Math.Clamp(d.fontStep[ck]!, -FONT_STEP_MAX, FONT_STEP_MAX);
    modeStore.combat[id] = cb;
  }
  loadMode(layoutMode);
  if (d.partyPos !== undefined) partyPos = d.partyPos;
  if (d.partyHoriz !== undefined) partyHoriz = d.partyHoriz;
  if (d.partyScale) partyScale = d.partyScale;
  if (d.logSize) logSize = { w: Math.max(LOG_MIN_W, Math.round(d.logSize.w)), h: Math.max(LOG_HEAD + 3 * LH + 3, Math.round(d.logSize.h)) };
}
function layoutSnapshot(): MissionLayoutData {
  stashMode();
  const pos: Record<string, { x: number; y: number } | null> = { ...panelPos };
  const scale: Record<string, number> = { ...panelScale };
  const font: Record<string, number> = { ...fontStep };
  for (const id of MODE_PANELS) {
    const ex = modeStore.explore[id], cb = modeStore.combat[id], ck = COMBAT_KEY(id);
    pos[id] = ex.pos;
    scale[id] = ex.scale;
    font[id] = ex.font;
    pos[ck] = cb.pos;
    scale[ck] = cb.scale;
    font[ck] = cb.font;
  }
  return { panelPos: pos, panelScale: scale, partyPos, partyHoriz, partyScale, logSize: { ...logSize }, fontStep: font };
}
const saveLayout = (): void => MissionLayout.save(layoutSnapshot());
MissionLayout.setSource(layoutSnapshot);
MissionLayout.onReset(resetLayout);
const LOG_HEAD = 13; // nagłówek + linia

/** Przesunięcie pióra po napisie (suma szerokości znaków z odstępami). */
const advance = (s: string): number => (s ? PixelText.measure(s + '.') - PixelText.measure('.') : 0);

/** Dzieli linię dziennika na fragmenty: imiona najemników w ich kolorach, reszta szara. */
function splitNames(text: string, names: readonly { name: string; color: number }[]): { text: string; color: number }[] {
  const out: { text: string; color: number }[] = [];
  let grey = '';
  for (let i = 0; i < text.length; ) {
    const hit = names.find((n) => text.startsWith(n.name, i) && !/[\p{L}\d]/u.test(text[i - 1] ?? '') && !/[\p{L}\d]/u.test(text[i + n.name.length] ?? ''));
    if (hit) {
      if (grey) out.push({ text: grey, color: LOG_GREY });
      grey = '';
      out.push({ text: hit.name, color: hit.color });
      i += hit.name.length;
    } else grey += text[i++];
  }
  if (grey) out.push({ text: grey, color: LOG_GREY });
  return out;
}

interface DisplayLine {
  text: string;
  tone: LogTone;
}

export interface UISceneData {
  hud: HudState;
}

/**
 * Równoległa scena HUD nad WorldScene. Uruchamiana przez `scene.launch('UIScene', { hud })`.
 */
export class UIScene extends Phaser.Scene {
  private hud!: HudState;

  private partyLayer!: Phaser.GameObjects.Container;
  /** Wciśnięta karta: kliknięcie (bez przesunięcia) wykonuje `click`, przesunięcie = przeciąganie drużyny. */
  private partyPress: { x: number; y: number; moved: boolean; click: (() => void) | null } | null = null;
  /** Skalowanie kart za róg: lewy górny róg i obrys kart (przed skalą) z chwili chwycenia. */
  private partyResize: { x0: number; y0: number; w: number; h: number } | null = null;
  private roundText!: PixelText;
  private topPanel!: Phaser.GameObjects.Container;
  private topGrip!: Phaser.GameObjects.Rectangle;
  private topScaleBtns: PixelText[] = [];
  private menuPanel!: Phaser.GameObjects.Container;
  private menuH = MENU_HEAD + OBJ_BODY;
  private menuBody!: Phaser.GameObjects.Container;
  /** Szerokość treści menu przed skalą czcionki. */
  private menuW = RCOL_W;
  private actH = 0;
  private sheetH = 0;
  private hoverBox!: Phaser.GameObjects.Container;

  private btnInv!: Button;
  private btnParty!: Button;
  /** Otwarte okno Drużyna (ui/PartyWindow) albo null. */
  private partyWin: UiWindow | null = null;
  private btnHelp!: Button;
  private btnGroup!: Button;
  private btnSpeed!: Button;
  private btnRetreat!: Button;
  private btnQuit!: Button;
  private btnSave!: Button;
  private btnLoad!: Button;
  private btnOptions!: Button;
  private btnZoomOut!: Button;
  private btnZoomIn!: Button;
  private objLayer!: Phaser.GameObjects.Container;
  private actionLayer!: Phaser.GameObjects.Container;
  private rollBox: Phaser.GameObjects.Container | null = null;
  private dmgBox: Phaser.GameObjects.Container | null = null;
  private helpBox: Phaser.GameObjects.Container | null = null;
  private shownPrompt = 0;
  private promptWin: UiWindow | null = null;

  private hoverBg!: Phaser.GameObjects.Rectangle;
  private hoverText!: PixelText;

  // dziennik
  private logPanel!: Phaser.GameObjects.Container;
  private logBody!: Phaser.GameObjects.Container;
  private logBg!: Phaser.GameObjects.Rectangle;
  /** Linie dziennika: każda to kilka fragmentów (imię w kolorze najemnika, reszta szara). */
  private logLineTexts: PixelText[][] = [];
  private logMeasure!: PixelText;
  private logWrapCache = new Map<number, string[]>();
  private logScroll = 0; // linii od dołu
  private logUnseen = 0;
  private logCollapsed = false;
  private logSeenId = 0;
  private logNewBtn!: PixelText;
  private logColBtn!: PixelText;
  private logScrollBar!: Phaser.GameObjects.Graphics;
  private logUpBtn!: PixelText;
  private logDownBtn!: PixelText;
  private logTrack!: Phaser.GameObjects.Rectangle;
  private logNewBg!: Phaser.GameObjects.Rectangle;
  private logHeadLine!: Phaser.GameObjects.Graphics;
  private logGrip!: Phaser.GameObjects.Rectangle;
  private logScaleBtns: PixelText[] = [];
  private logResize!: Phaser.GameObjects.Rectangle;
  private logResizeMark!: Phaser.GameObjects.Graphics;
  /** Dolna krawędź dziennika: przeciągnięcie = rozciąganie w dół / w górę (sama wysokość). */
  private logResizeB!: Phaser.GameObjects.Rectangle;
  private logLayoutKey = '';

  // karta postaci / ekwipunek
  private sheet!: Phaser.GameObjects.Container;
  private sheetFooter: PixelText | null = null;
  /** Szerokość treści karty przed skalą czcionki. */
  private sheetW = SHEET_W;

  // przeciąganie paneli za nagłówek
  private drag: { target: DragTarget; dx: number; dy: number } | null = null;
  private logRepeat: Phaser.Time.TimerEvent | null = null;
  private logThumb = { y: 0, h: 0, trackY: 0, trackH: 0 };

  private banner: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('UIScene');
  }

  init(data: UISceneData): void {
    this.hud = data.hud;
    this.logWrapCache = new Map();
    this.logLineTexts = [];
    this.logScroll = 0;
    this.logUnseen = 0;
    this.logSeenId = 0;
    this.logScaleBtns = [];
    this.logLayoutKey = '';
    this.sheetFooter = null;
    this.drag = null;
    this.banner = null;
    this.rollBox = null;
    this.dmgBox = null;
    this.helpBox = null;
    this.shownPrompt = 0;
    this.promptWin = null;
  }

  create(): void {
    if (!this.hud) throw new Error('UIScene: brak HudState - uruchom przez scene.launch("UIScene", { hud })');
    fitCamera(this);
    loadLayout();
    switchMode(this.hud.inCombat ? 'combat' : 'explore');

    // ---- lewy górny: drużyna
    this.partyLayer = this.add.container(M, M);
    this.partyPress = null;

    // ---- środek góra: runda / tura (wrogowie są kartami obok drużyny)
    this.topPanel = this.add.container(MID_X0, M);
    this.roundText = this.text(TOP_W / 2, 0, '').setOrigin(0.5, 0);
    this.topGrip = this.dragHandle('top', 10, LH);
    this.topScaleBtns = this.scaleButtons('top', 0, 0);
    this.topPanel.add([this.topGrip, this.roundText, ...this.topScaleBtns]);

    // ---- prawy górny: menu misji jak w Oldgame/src/mission/hud.js (H.menu: 2 kolumny, "Odwrót" na całą szerokość)
    //      + ekwipunek; bronie wybiera się w panelu akcji; "Koniec tury" jest w pasku akcji walki, jak tam.
    //      Całe menu (nagłówek, przyciski, cele) to jeden panel: skalowany i przesuwany za nagłówek.
    const MP = (this.menuPanel = this.add.container(0, 0));
    MP.add([
      this.panelRect(0, 0, RCOL_W, MENU_HEAD - 1),
      this.dragHandle('menu', RCOL_W - 3 - CTRL_W - 2, MENU_HEAD - 1),
      this.text(3, 1, 'MENU', UI_TITLE),
      ...this.scaleButtons('menu', RCOL_W - 3, 1),
    ]);
    // treść menu (przyciski + cele) w osobnym kontenerze ze skalą czcionki
    this.menuBody = this.add.container(0, MENU_HEAD);
    this.objLayer = this.add.container(0, OBJ_BODY);
    MP.add(this.menuBody);
    this.buildMenu();
    this.actionLayer = this.add.container(0, 0);

    // ---- lewy dół: opis pod kursorem
    //      (skala jak panel akcji - leży tuż pod nim; zaczepiony lewym dolnym rogiem)
    this.hoverBg = this.panelRect(0, -12, 10, 12).setVisible(false);
    this.hoverText = this.text(3, -11, '').setVisible(false);
    this.hoverBox = this.add.container(M, BASE_H - M, [this.hoverBg, this.hoverText]);

    this.createLog();
    this.sheet = this.add.container(SHEET_X, SHEET_Y).setVisible(false);

    // ---- przeciąganie paneli (dziennik, ekwipunek) za nagłówek
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onDragMove(p));
    this.input.on('pointerup', () => {
      const thumb = this.drag?.target === 'logThumb';
      const press = this.partyPress;
      this.partyPress = null;
      if (this.drag?.target === 'party' && press && !press.moved) press.click?.();
      if (this.drag && this.drag.target !== 'logThumb') saveLayout();
      this.drag = null;
      this.stopLogRepeat();
      if (thumb) this.drawLog();
    });
    this.input.on('gameout', () => {
      if (this.drag && this.drag.target !== 'logThumb') saveLayout();
      this.drag = null;
    });

    // ---- klawiatura (jak w starym HUD: Spacja, I, X, Esc, 1-9)
    // (Oldgame/src/scenes/mission.js:640-651: H, F, G, Tab, Spacja, Esc, 1-9)
    const kb = this.input.keyboard;
    const blocked = (): boolean => modalOpen(this) || !!this.hud.prompt;
    kb?.on('keydown-SPACE', (e: KeyboardEvent) => {
      e.preventDefault?.();
      if (!blocked() && !this.hud.helpOpen) this.hud.command({ kind: 'endTurn' });
    });
    kb?.on('keydown-I', () => !blocked() && this.toggleSheet());
    kb?.on('keydown-P', () => !blocked() && this.openParty());
    kb?.on('keydown-X', () => !blocked() && this.hud.command({ kind: 'swapWeapons' }));
    kb?.on('keydown-H', () => !blocked() && this.hud.toggleHelp());
    // dziennik: PgUp / PgDn = strona, Home = najstarsze, End = najnowsze
    kb?.on('keydown-PAGE_UP', () => !blocked() && this.scrollLog(this.logLines() - 1));
    kb?.on('keydown-PAGE_DOWN', () => !blocked() && this.scrollLog(-(this.logLines() - 1)));
    kb?.on('keydown-HOME', () => !blocked() && this.scrollLog(1e6));
    kb?.on('keydown-END', () => !blocked() && this.scrollLog(-1e6));
    kb?.on('keydown-F', () => !blocked() && this.hud.command({ kind: 'cycleSpeed' }));
    kb?.on('keydown-G', () => !blocked() && this.hud.command({ kind: 'toggleGroup' }));
    kb?.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault?.();
      if (!blocked()) this.hud.command({ kind: 'cycleMember' });
    });
    kb?.on('keydown-ESC', () => {
      if (blocked()) return;
      if (this.hud.helpOpen) this.hud.toggleHelp(false);
      else if (this.hud.inventoryOpen) this.hud.toggleInventory(false);
      else this.hud.command({ kind: 'cancel' });
    });
    kb?.on('keydown', (e: KeyboardEvent) => {
      if (blocked() || this.hud.helpOpen) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1) return;
      if (this.hud.inventoryOpen) {
        const row = this.usableRows()[n - 1];
        if (row?.inst) this.useItem(row.inst.uid);
        return;
      }
      if (this.hud.inCombat && this.hud.actions.length) {
        const b = this.hud.actions[n - 1];
        if (b?.enabled && this.hud.canAct) this.hud.command({ kind: 'action', id: b.id });
        else if (b) SoundManager.sfx('error', { vol: 0.4 });
        return;
      }
      if (n <= this.hud.party.length) this.hud.command({ kind: 'selectMember', index: n - 1 });
    });

    // ---- kółko myszy nad dziennikiem = przewijanie
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (this.logCollapsed || !this.logBg.getBounds().contains(p.x, p.y)) return;
      this.scrollLog(dy > 0 ? -2 : 2);
    });

    // ---- subskrypcja modelu
    const off = this.hud.on((c) => this.onHudChange(c));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
    // "Domyślny układ okien" w Opcjach (stan modułu zeruje już resetLayout)
    const offLayout = MissionLayout.onReset(() => {
      this.drawParty();
      for (const id of Object.keys(panelPos) as PanelId[]) this.relayout(id);
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, offLayout);


    this.drawParty();
    this.placePanel('top');
    this.drawTurn();
    this.drawLog();
    this.drawHover();
    this.drawObjectives();
    this.drawActions();
  }

  private onHudChange(c: HudChange): void {
    // początek / koniec walki: menu i panel akcji przechodzą na układ (skala, czcionka, pozycja) drugiego trybu
    if (switchMode(this.hud.inCombat ? 'combat' : 'explore')) {
      this.relayout('menu');
      if (c !== 'actions' && c !== 'stats' && c !== 'turn' && c !== 'inventory') this.drawActions();
    }
    switch (c) {
      case 'stats':
        this.drawParty();
        this.drawTurn();
        this.drawActions();
        if (this.hud.inventoryOpen) this.drawSheet();
        break;
      case 'turn':
        this.drawTurn();
        this.drawParty();
        this.drawActions();
        if (this.hud.inventoryOpen) this.drawSheet();
        break;
      case 'log':
        this.drawLog();
        break;
      case 'hover':
        this.drawHover();
        break;
      case 'inventory':
        this.drawSheet();
        this.drawTurn();
        this.drawActions();
        break;
      case 'banner':
        this.showBanner();
        break;
      case 'objectives':
        this.drawObjectives();
        this.drawTurn();
        break;
      case 'actions':
        this.drawActions();
        break;
      case 'initiative':
        this.drawParty();
        this.drawTurn();
        break;
      case 'roll':
        this.showRoll();
        break;
      case 'damage':
        this.showDamage();
        break;
      case 'prompt':
        this.showPrompt();
        break;
      case 'settings':
        this.drawTurn();
        break;
      case 'help':
        this.drawHelp();
        break;
    }
  }

  // ================================================================== prymitywy

  /** Tekst HUD: czcionka bitmapowa 6x8 z czarnym obrysem; size >= 11 = pogrubienie (bez skalowania). */
  private text(x: number, y: number, s: string, color: number = PAL.text, size = 8): PixelText {
    return pixelText(this, x, y, s, { color, bold: size >= 11 });
  }

  private recolor(t: PixelText, color: number, _glow = true): PixelText {
    return t.setColor(color);
  }

  /** Tło panelu, które połyka kliknięcia (żeby nie przechodziły do WorldScene). */
  private panelRect(x: number, y: number, w: number, h: number, stroke: number = C.greenDim): Phaser.GameObjects.Rectangle {
    return uiBg(this.add.rectangle(x, y, w, h, C.bg, 1).setOrigin(0).setStrokeStyle(1, stroke).setInteractive());
  }



  /** Przycisk menu w stylu starego .btn (Oldgame/index.html): brązowe tło, rdzawa ramka, twardy cień. */
  private button(x: number, y: number, w: number, label: string, onClick: () => void, variant: BtnVariant = 'normal', parent?: Phaser.GameObjects.Container): Button {
    const edgeOf = (v: BtnVariant): number => (v === 'primary' ? PAL.amber : v === 'danger' ? PAL.blood : PAL.edge);
    const inkOf = (v: BtnVariant): number => (v === 'primary' ? PAL.amber : v === 'danger' ? PAL.bad : PAL.text);
    let edge = edgeOf(variant);
    let ink = inkOf(variant);
    const shadow = this.add.rectangle(x + 1, y + 1, w, BTN_H, 0x000000, 0.8).setOrigin(0);
    const bg = this.add.rectangle(x, y, w, BTN_H, PAL.panel2, 1).setOrigin(0).setStrokeStyle(1, edge).setInteractive({ useHandCursor: true });
    const text = this.text(x + w / 2, y + 2, label, ink).setOrigin(0.5, 0);
    parent?.add([shadow, bg, text]);
    const b: Button = {
      bg, text, enabled: true, hovered: false, color: ink,
      set: (l, enabled) => {
        b.enabled = enabled;
        text.setText(fitText(l, w - 4));
        const hot = b.hovered && enabled;
        bg.setFillStyle(hot ? 0x3a2c1e : PAL.panel2, 1).setStrokeStyle(1, hot ? PAL.edgeHi : edge);
        text.setColor(hot ? 0xffffff : ink);
        bg.setAlpha(enabled ? 1 : 0.55);
        text.setAlpha(enabled ? 1 : 0.4);
      },
      style: (v) => {
        if (edgeOf(v) === edge && inkOf(v) === ink) return;
        edge = edgeOf(v);
        ink = inkOf(v);
        b.color = ink;
        b.set(raw, b.enabled);
      },
    };
    let raw = label;
    const set = b.set;
    b.set = (l, enabled) => {
      raw = l;
      set(l, enabled);
    };
    bg.on('pointerover', () => {
      b.hovered = true;
      if (b.enabled) SoundManager.sfx('hover');
      b.set(raw, b.enabled);
    });
    bg.on('pointerout', () => {
      b.hovered = false;
      b.set(raw, b.enabled);
    });
    bg.on('pointerdown', () => {
      if (!b.enabled) {
        SoundManager.sfx('error', { vol: 0.4 });
        return;
      }
      SoundManager.sfx('click');
      onClick();
    });
    b.set(label, true);
    return b;
  }

  // ================================================================== drużyna (port H.party_)

  private drawParty(): void {
    const L = this.partyLayer;
    L.removeAll(true);
    const hud = this.hud;
    const { cells, w: gw, h: gh } = this.partyLayout();
    const grip = { x: gw, y: gh };
    // karty mają stałą, mniejszą czcionkę (bez a / A): fc = skala tekstu, NH = wysokość wiersza tekstu
    const fc = cardFontScale();
    const NH = Math.ceil(LH * fc);
    const ty = (rowY: number, rowH: number): number => rowY + Math.max(0, Math.round((rowH - LH * fc) / 2));
    const small = (x: number, y: number, s: string, color: number): PixelText => this.text(x, y, s, color).setScale(fc);
    this.partyCards().forEach((it, i) => {
      const { ch, foe, init, civ } = it;
      const y = 0;
      const card = cells[i]!;
      const isCurrent = civ ? false : foe ? !!init?.current : ch === hud.active;
      const turn = foe ? isCurrent : isCurrent && hud.inCombat && hud.phase !== TurnPhase.ENEMY_TURN && ch.hp > 0;
      const st = civ ? (civ.state === 'dead' ? 'NIE ŻYJE' : civ.state === 'captive' ? 'W NIEWOLI' : null) : stateLabel(ch);
      const dead = civ ? civ.state === 'dead' : !!ch.conditions.dead || (foe && ch.hp <= 0);
      // ramka jak .m-card / .sel / .act / .down; wrogowie w czerwonej ramce, podopieczni (cywile) w niebieskiej
      const edge = civ ? (civ.state === 'dead' ? PAL.blood : civ.state === 'freed' ? C_CIV : PAL.edge) : turn || isCurrent ? PAL.amber : foe ? C.red : ch.hp <= 0 ? PAL.blood : PAL.edge;
      const shadow = uiBg(this.add.rectangle(2, y + 2, PARTY_W, PARTY_H, 0x000000, 0.5).setOrigin(0), true);
      const bg = uiBg(this.add.rectangle(0, y, PARTY_W, PARTY_H, foe ? 0x1a0d0a : 0x120e0b, 1).setOrigin(0).setStrokeStyle(2, edge).setInteractive({ cursor: 'move' }));
      const pi = civ ? -1 : hud.party.indexOf(ch);
      this.partyGrab(bg, foe || pi < 0 ? null : () => this.hud.command({ kind: 'selectMember', index: pi }));
      bg.on('pointerover', () => this.hud.setHover(civ ? civilianTip(civ) : foe ? this.foeTip(ch, init) : this.memberTip(ch)));
      bg.on('pointerout', () => this.hud.setHover(null));
      const parts: Phaser.GameObjects.GameObject[] = [shadow, bg];
      if (turn) parts.push(this.add.rectangle(-1, y - 1, PARTY_W + 2, PARTY_H + 2).setOrigin(0).setStrokeStyle(1, PAL.amber, 0.45));

      // portret: tekstura w natywnej gęstości (1 teksel = 1 piksel płótna), więc jest ostry
      const px = 2, py = y + 2;
      const img = this.add.image(px, py, portraitKey(this, ch, PC_PT)).setOrigin(0);
      if (dead || ch.hp <= 0) img.setTint(dead ? 0x555555 : 0x8a8a8a);
      if (civ?.state === 'captive') img.setAlpha(0.6);
      parts.push(img, this.add.rectangle(px, py, PC_PT, PC_PT).setOrigin(0).setStrokeStyle(1, 0x000000));

      // imię na dole portretu (.m-nm)
      parts.push(this.add.rectangle(px, py + PC_PT - NH - 1, PC_PT, NH + 1, 0x000000, 0.72).setOrigin(0));
      const nameCol = civ ? C_CIV : turn || isCurrent ? PAL.amber : foe ? C.red : parseColor(ch.nameColor, PAL.text);
      parts.push(small(px + 1, ty(py + PC_PT - NH - 1, NH + 1), fitText(ch.name, Math.floor((PC_PT - 2) / fc)), nameCol));

      // stan (POLEGŁ / NIEPRZYT.) na środku portretu (.m-pt .st)
      if (st) {
        parts.push(this.add.rectangle(px, py + 14, PC_PT, NH + 1, 0x000000, 0.8).setOrigin(0));
        parts.push(small(px + PC_PT / 2, ty(py + 14, NH + 1), fitText(st, Math.floor((PC_PT - 2) / fc)), civ?.state === 'captive' ? PAL.amber : PAL.bad).setOrigin(0.5, 0));
      }

      // górny rząd na portrecie: pipsy akcji w turze + chipy stanów (.m-row)
      const g = this.add.graphics();
      parts.push(g);
      let cx = px + 1;
      if (turn && !foe) {
        for (let k = 0; k < hud.maxAp; k++) {
          g.fillStyle(0x000000, 1).fillCircle(cx + 2.5, py + 3.5, 3);
          g.lineStyle(1, PAL.amber, 1).strokeCircle(cx + 2.5, py + 3.5, 2);
          if (k < hud.ap) g.fillStyle(PAL.amber, 1).fillCircle(cx + 2.5, py + 3.5, 2);
          cx += 6;
        }
        cx += 1;
      }
      const chips = conditionChips(ch);
      const pips = turn && !foe;
      const maxChips = pips ? 1 : 3;
      chips.slice(0, maxChips).forEach((chip, k) => {
        const col = chip.bad ? PAL.bad : PAL.amber;
        const rowY = pips ? py + 8 : py + 1 + k * (NH + 1);
        const t = small(px + 2, ty(rowY, NH), chip.label, col);
        const r = this.add.rectangle(px + 1, rowY, Math.ceil(PixelText.measure(chip.label) * fc) + 3, NH, 0x000000, 0.7).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive();
        r.on('pointerover', () => this.hud.setHover(`${chip.name}${chip.value > 1 ? ' ' + chip.value : ''}: ${chip.desc}`));
        r.on('pointerout', () => this.hud.setHover(null));
        parts.push(r, t);
      });

      // pasek PW z liczbą w środku (.m-hpb)
      const hy = py + PC_PT + 1;
      g.fillStyle(0x000000, 1).fillRect(px, hy, PC_PT, PC_HPB);
      g.fillStyle(civ ? C_CIV : HP_FILL[hpTone(ch)], 1).fillRect(px + 1, hy + 1, Math.round((PC_PT - 2) * (dead ? 0 : Math.max(0, Math.min(1, hpRatio(ch))))), PC_HPB - 2);
      g.lineStyle(1, 0x2a2018, 1).strokeRect(px + 0.5, hy + 0.5, PC_PT - 1, PC_HPB - 1);
      const hp = `${Math.max(0, ch.hp)}/${ch.maxHp}${ch.tempHp ? '+' + ch.tempHp : ''}`;
      parts.push(small(px + PC_PT / 2, ty(hy, PC_HPB), fitText(hp, Math.floor(PC_PT / fc)), 0xffffff).setOrigin(0.5, 0));

      L.add(this.add.container(card.x, card.y, parts));
    });
    // uchwyt skali w prawym dolnym rogu (jak w dzienniku): przeciągnięcie skaluje wszystkie karty
    const mark = this.add.graphics().fillStyle(PAL.edgeHi, 1);
    for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) mark.fillRect(grip.x - 3 - j * 2, grip.y - 7 + i * 2, 1, 1);
    const handle = this.add.rectangle(grip.x, grip.y, 9, 9, C.amber, 0).setOrigin(1, 1).setInteractive({ cursor: 'nwse-resize' });
    handle.on('pointerover', () => {
      handle.setFillStyle(C.amber, 0.25);
      this.hud.setHover(`Przeciągnij róg: skala kart (${Math.round(partyScale * 100)}%) · przeciągnij kartę: przesuń · PPM na karcie: domyślnie`);
    });
    handle.on('pointerout', () => {
      handle.setFillStyle(C.amber, 0);
      this.hud.setHover(null);
    });
    handle.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      const { w, h } = this.partyLayout();
      this.partyResize = { x0: this.partyLayer.x, y0: this.partyLayer.y, w, h };
      this.children.bringToTop(this.partyLayer);
      this.drag = { target: 'partySize', dx: 0, dy: 0 };
    });
    L.add([mark, handle]);
    this.placeParty();
  }

  /** Karty w panelu drużyny: najemnicy, a w walce za nimi wrogowie (w kolejności inicjatywy, jeśli jest). */
  private partyCards(): { ch: Character; foe: boolean; init: InitEntry | null; civ?: CivilianRow }[] {
    const hud = this.hud;
    const out: { ch: Character; foe: boolean; init: InitEntry | null; civ?: CivilianRow }[] = hud.party.map((ch) => ({ ch, foe: false, init: hud.initiative.find((e) => e.ch === ch) ?? null }));
    // cywile zlecenia (jeniec, osadnicy - portrety PixelLab): w niewoli, podopieczni z PW, zabici
    for (const c of hud.civilians) out.push({ ch: c.ch, foe: false, init: null, civ: c });
    if (!hud.inCombat) return out;
    const fromInit = hud.initiative.filter((e) => e.side === 'enemy');
    if (fromInit.length) for (const e of fromInit) out.push({ ch: e.ch, foe: true, init: e });
    else for (const ch of hud.foes) out.push({ ch, foe: true, init: null });
    return out;
  }

  /**
   * Rozkład kart: rzędy (poziomo) albo kolumny (pionowo), zawijane, żeby panel mieścił się na ekranie
   * (domyślnie poziomy kończy się przed menu). w / h = obrys kart (uchwyt skali w prawym dolnym rogu).
   */
  private partyLayout(): { cells: { x: number; y: number }[]; w: number; h: number } {
    const n = Math.max(1, this.partyCards().length);
    const sx = PARTY_W + PC_GAP, sy = PARTY_H + PC_GAP;
    const avail = partyHoriz ? (partyPos ? BASE_W - 2 * M : MID_X1 - M) : BASE_H - 2 * M;
    const per = Math.max(1, Math.floor((avail / partyScale + PC_GAP) / (partyHoriz ? sx : sy)));
    const cells = Array.from({ length: n }, (_, i) => {
      const a = i % per, b = Math.floor(i / per);
      return partyHoriz ? { x: a * sx, y: b * sy } : { x: b * sx, y: a * sy };
    });
    const first = Math.min(n, per), lines = Math.ceil(n / per);
    if (partyHoriz) return { cells, w: first * sx - PC_GAP, h: lines * sy - PC_GAP };
    return { cells, w: lines * sx - PC_GAP, h: first * sy - PC_GAP };
  }

  /** Rozmiar panelu drużyny na ekranie (po skali). */
  private partySize(): { w: number; h: number } {
    const { w, h } = this.partyLayout();
    return { w: w * partyScale, h: h * partyScale };
  }

  /** Karty w całości na ekranie; domyślnie poziomo przy górnej krawędzi. Pasek rundy i karta postaci idą pod nie. */
  private placeParty(): void {
    const { w, h } = this.partySize();
    const pos = partyPos ?? { x: M, y: M };
    this.partyLayer.setScale(partyScale).setPosition(
      Phaser.Math.Clamp(Math.round(pos.x), 0, Math.max(0, Math.round(BASE_W - w))),
      Phaser.Math.Clamp(Math.round(pos.y), 0, Math.max(0, Math.round(BASE_H - h))),
    );
    if (!panelPos.top) this.placePanel('top');
    if (!panelPos.sheet && this.sheet) this.placePanel('sheet');
  }

  /** Dół kart, gdy leżą w miejscu domyślnym (górna krawędź) - tam zaczynają się pasek rundy i karta postaci. */
  private partyBottom(): number {
    return partyPos ? M : Math.round(this.partyLayer.y + this.partySize().h + 2);
  }

  /** Karta / ramka: LPM + przeciągnięcie = przesuń panel, LPM bez ruchu = `click`, PPM = miejsce i skala domyślne. */
  private partyGrab(r: Phaser.GameObjects.Rectangle, click: (() => void) | null): void {
    r.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.drag = null;
        partyPos = null;
        partyHoriz = true;
        partyScale = 1;
        this.drawParty();
        saveLayout();
        SoundManager.sfx('click');
        return;
      }
      this.partyPress = { x: p.worldX, y: p.worldY, moved: false, click };
      this.drag = { target: 'party', dx: p.worldX - this.partyLayer.x, dy: p.worldY - this.partyLayer.y };
    });
  }

  /**
   * Uchwyt w prawym dolnym rogu kart: lewy górny róg stoi, skala = rzut kursora na przekątną obrysu kart
   * z chwili chwycenia, zaokrąglona do skal w całych pikselach płótna (panelScales).
   */
  private resizeParty(p: Phaser.Input.Pointer): void {
    const r = this.partyResize;
    if (!r) return;
    const dx = p.worldX - r.x0, dy = p.worldY - r.y0;
    const want = (dx * r.w + dy * r.h) / (r.w * r.w + r.h * r.h);
    const list = panelScales();
    const next = list[nearestScale(list, want)]!;
    if (Math.abs(next - partyScale) < 1e-6) return;
    partyScale = next;
    if (partyPos) partyPos = { x: r.x0, y: r.y0 };
    SoundManager.sfx('click', { vol: 0.5 });
    this.drawParty();
    this.hud.setHover(`Skala kart: ${Math.round(partyScale * 100)}%`);
  }

  /**
   * Przeciąganie kart: przy górnej / dolnej krawędzi układ poziomy (przyklejony do krawędzi), dalej pionowy.
   * Do pierwszych PARTY_DRAG_MIN px to jeszcze kliknięcie (wybór najemnika).
   */
  private dragParty(p: Phaser.Input.Pointer, d: { dx: number; dy: number }): void {
    const press = this.partyPress;
    if (press && !press.moved) {
      if (Math.hypot(p.worldX - press.x, p.worldY - press.y) < PARTY_DRAG_MIN) return;
      press.moved = true;
      this.children.bringToTop(this.partyLayer);
    }
    const nearEdge = p.worldY < PARTY_EDGE || p.worldY > BASE_H - PARTY_EDGE;
    const far = p.worldY > PARTY_EDGE * 3 && p.worldY < BASE_H - PARTY_EDGE * 3;
    const flip = nearEdge !== partyHoriz && (nearEdge || far);
    if (flip) {
      partyHoriz = nearEdge;
      // chwycona karta zostaje mniej więcej pod kursorem
      const { w, h } = this.partySize();
      d.dx = Phaser.Math.Clamp(d.dx, 2, w - 2);
      d.dy = Phaser.Math.Clamp(d.dy, 2, Math.min(h, PARTY_H * partyScale) - 2);
      SoundManager.sfx('click', { vol: 0.5 });
    }
    partyPos = { x: p.worldX - d.dx, y: p.worldY - d.dy };
    const { h } = this.partySize();
    if (partyHoriz && nearEdge) partyPos.y = p.worldY < BASE_H / 2 ? M : BASE_H - M - h;
    if (flip) this.drawParty();
    else this.placeParty();
    partyPos = { x: this.partyLayer.x, y: this.partyLayer.y };
  }

  /** Opis wroga pod kursorem (dawny pasek wrogów / inicjatywy). */
  private foeTip(ch: Character, e: InitEntry | null): string {
    const ini = e ? ` · inicjatywa ${e.init}${e.down ? ' · powalony' : ''}${e.done ? ' · już działał' : ''}` : '';
    return `${ch.name} (${classLabel(ch)}) · PW ${Math.max(0, ch.hp)}/${ch.maxHp}${ch.hp <= 0 ? ' · martwy' : ''}${ini}`;
  }

  /** Opis najemnika pod kursorem (podpowiedź karty z Oldgame: imię, poziom, KP, percepcja, prędkość, stany). */
  private memberTip(ch: Character): string {
    const stats = statPairs(ch).map(([k, v]) => `${k} ${v}`).join(' · ');
    const conds = conditionChips(ch).map((c) => c.name + (c.value > 1 ? ' ' + c.value : '')).join(', ');
    return `${ch.name} · ${classLabel(ch)} · ${stats}${conds ? ' · ' + conds : ''}`;
  }

  // ================================================================== runda + wrogowie (port H.initBar)

  private drawTurn(): void {
    const hud = this.hud;
    const enemy = hud.phase === TurnPhase.ENEMY_TURN;
    const name = hud.active?.name.toUpperCase() ?? '—';
    const cur = hud.initiative.find((e) => e.current);
    const f = fontScaleOf('top');
    const txt = !hud.inCombat
      ? cut(`EKSPLORACJA · LIDER: ${name}`, 36)
      : cut(`RUNDA ${hud.round} · ${enemy ? `TURA: ${(cur?.ch.name ?? 'WRÓG').toUpperCase()}` : `TURA: ${name}`}`, 36);
    this.roundText.setText(fitText(txt, Math.floor((TOP_W - CTRL_W - 8) / f))).setScale(f);
    this.recolor(this.roundText, enemy ? C.red : C.amber);
    // uchwyt paska rundy = sam napis; sterowanie (● a A − +) zaraz za nim
    const tw = Math.ceil(PixelText.measure(this.roundText.text) * f);
    const th = this.topH();
    const gx = Math.round(TOP_W / 2 - tw / 2) - 2;
    this.topGrip.setPosition(gx, 0).setSize(tw + 4, th);
    this.topGrip.input?.hitArea.setSize(tw + 4, th);
    this.layoutCtrls(this.topScaleBtns, gx + tw + 4 + CTRL_W + 2);
    for (const b of this.topScaleBtns) b.setY(Math.round((th - LH) / 2));

    const locked = !hud.canAct;
    this.btnHelp.set('STEROWANIE [H]', true);
    this.btnOptions.set('OPCJE', true);
    this.btnSpeed.set(hud.speed >= 4 ? 'x4 BEZ KOŚCI [F]' : `TEMPO x${hud.speed} [F]`, true);
    this.btnGroup.set(hud.groupMove ? 'RUCH: DRUŻ. [G]' : 'RUCH: SOLO [G]', !hud.inCombat);
    this.btnZoomOut.set('MAPA −', true);
    this.btnZoomIn.set('MAPA +', true);
    this.btnInv.set(hud.inventoryOpen ? 'ZAMKNIJ EKW. [I]' : 'EKWIPUNEK [I]', true);
    // okno Drużyna tylko poza walką: na początku walki przycisk gaśnie, a otwarte okno się zamyka
    this.btnParty.set('DRUŻYNA [P]', !hud.inCombat);
    if (hud.inCombat) this.partyWin?.close();
    this.btnRetreat.style(hud.contractDone ? 'primary' : 'danger');
    this.btnRetreat.set(hud.contractDone ? 'POWRÓT' : 'ODWRÓT', !locked || (hud.inCombat && !enemy && !hud.busy));
    this.btnSave.set('ZAPISZ GRĘ', !locked && !hud.inCombat);
    this.btnLoad.set('WCZYTAJ GRĘ', !locked || (hud.inCombat && !enemy && !hud.busy));
    this.btnQuit.set('WYJDŹ Z GRY', !locked || (hud.inCombat && !enemy && !hud.busy));
  }

  /**
   * Przyciski menu w kontenerze treści: skala = czcionka menu, szerokość logiczna = RCOL_W / skala
   * (większa czcionka = te same rozmiary okna, krótsze napisy).
   */
  private buildMenu(): void {
    const B = this.menuBody;
    B.remove(this.objLayer);
    B.removeAll(true);
    const f = fontScaleOf('menu');
    B.setScale(f);
    const W = (this.menuW = Math.floor(RCOL_W / f));
    const bw = Math.floor((W - 4) / 2);
    const bx = 0, bx2 = W - bw, row = (i: number): number => (BTN_H + BTN_GAP) * i;
    this.btnHelp = this.button(bx, row(0), bw, '', () => this.hud.toggleHelp(), 'normal', B);
    this.btnOptions = this.button(bx2, row(0), bw, '', () => !modalOpen(this) && void openOptions(this), 'normal', B);
    this.btnSpeed = this.button(bx, row(1), bw, '', () => this.hud.command({ kind: 'cycleSpeed' }), 'normal', B);
    this.btnGroup = this.button(bx2, row(1), bw, '', () => this.hud.command({ kind: 'toggleGroup' }), 'normal', B);
    this.btnZoomOut = this.button(bx, row(2), bw, '', () => this.hud.command({ kind: 'zoom', f: 1 / 1.25 }), 'normal', B);
    this.btnZoomIn = this.button(bx2, row(2), bw, '', () => this.hud.command({ kind: 'zoom', f: 1.25 }), 'normal', B);
    this.btnInv = this.button(bx, row(3), bw, '', () => this.toggleSheet(), 'normal', B);
    this.btnParty = this.button(bx2, row(3), bw, '', () => this.openParty(), 'normal', B);
    this.btnRetreat = this.button(bx, row(4), bw, '', () => this.hud.command({ kind: 'retreat' }), 'danger', B);
    this.btnSave = this.button(bx2, row(4), bw, '', () => !modalOpen(this) && this.hud.command({ kind: 'save' }), 'normal', B);
    this.btnLoad = this.button(bx, row(5), bw, '', () => !modalOpen(this) && this.hud.command({ kind: 'load' }), 'normal', B);
    this.btnQuit = this.button(bx2, row(5), bw, '', () => this.hud.command({ kind: 'quit' }), 'normal', B);
    B.add(this.objLayer);
  }

  // ================================================================== cele zlecenia (port H.objective)

  private drawObjectives(): void {
    const L = this.objLayer;
    L.removeAll(true);
    const rows = this.hud.objectives;
    const f = fontScaleOf('menu'), W = this.menuW;
    this.menuH = MENU_HEAD + Math.ceil((OBJ_BODY - 2) * f);
    if (!rows.length) {
      this.placePanel('menu');
      return;
    }
    const items: Phaser.GameObjects.GameObject[] = [];
    const title = this.text(3, 1, 'ZLECENIE', UI_TITLE);
    const name = this.text(3, LH + 3, this.hud.objectiveTitle.toUpperCase() || '—', PAL.amber).setWordWrapWidth(W - 6);
    items.push(title, name);
    let y = LH + 3 + Math.ceil(name.height) + 2;
    for (const r of rows) {
      const box = r.go ? '►' : r.done ? '☑' : '☐';
      const col = r.bad ? PAL.bad : r.go ? PAL.toxic : r.done ? PAL.good : r.dim ? PAL.dim : PAL.text;
      const t = this.text(4, y, `${box} ${r.text}`, col, 7).setWordWrapWidth(W - 8);
      if (r.done && !r.go) t.setAlpha(0.75);
      items.push(t);
      y += Math.max(LH, Math.ceil(t.height)) + 1;
      if (r.go) this.tweens.add({ targets: t, alpha: { from: 1, to: 0.45 }, duration: 500, yoyo: true, repeat: -1 });
    }
    y += 1;
    const shadow = uiBg(this.add.rectangle(2, 2, W, y, 0x000000, 0.5).setOrigin(0), true);
    const bg = uiBg(this.add.rectangle(0, 0, W, y, PAL.panel, 1).setOrigin(0).setStrokeStyle(1, PAL.edge).setInteractive());
    const line = this.add.graphics().lineStyle(1, PAL.edge, 1).lineBetween(2, LH + 1.5, W - 2, LH + 1.5);
    L.add([shadow, bg, line, ...items]);
    this.menuH = MENU_HEAD + Math.ceil((OBJ_BODY + y) * f);
    this.placePanel('menu');
  }

  // ================================================================== pasek akcji walki (port C.refreshBar / H.abBtn)

  /**
   * Panel akcji (przesuwany za nagłówek jak dziennik, PPM na nagłówku = pozycja domyślna).
   * Na górze dostępne bronie: klik w broń = dobycie jej (zostaje do kolejnej zmiany; w walce 1 akcja).
   * Poza walką panel pokazuje tylko bronie.
   */
  private drawActions(): void {
    const L = this.actionLayer;
    L.removeAll(true);
    const ch = this.hud.active;
    const list = this.hud.actions;
    const weapons = ch && !ch.attacks ? this.weaponSlots(ch) : [];
    if (!list.length && !weapons.length) {
      L.setVisible(false);
      this.drawHover();
      return;
    }
    L.setVisible(true);
    const W = AB_W;
    // treść (bronie + akcje) w kontenerze ze skalą czcionki; szerokość logiczna = AB_W / skala
    const f = fontScaleOf('actions');
    const BW = Math.floor(W / f);
    const bw = Math.floor((BW - 2) / AB_COLS);
    const wRows = Math.ceil(weapons.length / AB_COLS);
    const aRows = Math.ceil(list.length / AB_COLS);
    const wy = 12;
    const ay = wRows * (WT_H + 1) + (list.length ? 3 : 0);
    const bodyH = ay + aRows * (AB_BH + 1) + 2;
    const h = wy + Math.ceil(bodyH * f);

    const bg = this.panelRect(0, 0, W, h, C.amberDim);
    const g = this.add.graphics();
    const pips = list.length > 0 && this.hud.inCombat;
    if (pips) {
      for (let k = 0; k < this.hud.maxAp; k++) {
        g.fillStyle(k < this.hud.ap ? C.amber : C.amberDim, 1).fillRect(W - 4 - (this.hud.maxAp - k) * 6, 3, 4, 5);
      }
    }
    const right = W - (pips ? this.hud.maxAp * 6 + 6 : 0) - 3;
    const headTxt = (this.hud.actionsHead ?? (ch ? `BROŃ — ${ch.name}` : '')).toUpperCase();
    const head = this.text(3, 1, fitText(headTxt, right - CTRL_W - 8), UI_TITLE);
    const grip = this.dragHandle('actions', right - CTRL_W - 2, 11);
    const body = this.add.container(0, wy).setScale(f);
    L.add([bg, grip, head, g, ...this.scaleButtons('actions', right, 1), body]);
    if (list.length) body.add(this.add.graphics().lineStyle(1, C.amberDim, 1).lineBetween(2, ay - 1.5, BW - 2, ay - 1.5));
    weapons.forEach((slot, i) => {
      const x = 2 + (i % AB_COLS) * bw;
      const y = Math.floor(i / AB_COLS) * (WT_H + 1);
      body.add(this.weaponTile(x, y, bw - 2, ch!, slot));
    });
    list.forEach((b, i) => {
      const x = 2 + (i % AB_COLS) * bw;
      const y = ay + Math.floor(i / AB_COLS) * (AB_BH + 1);
      // skróty 1-9 tylko w walce (w eksploracji cyfry wybierają najemnika)
      body.add(this.actionButton(x, y, bw - 2, b, i < 9 && this.hud.inCombat ? String(i + 1) : ''));
    });

    // pozycja: domyślnie nad dolną krawędzią; przesunięty panel trzyma lewy górny róg
    this.actH = h;
    this.placePanel('actions');
  }

  /**
   * Bronie postaci do wyboru (sloty z bronią; bez broni - sama Pięść w slocie głównym).
   * Stała kolejność (wg uid przedmiotu), żeby kafle nie zamieniały się miejscami po wyborze.
   */
  private weaponSlots(ch: Character): EquipSlot[] {
    const e = ch.equipment;
    if (!e.weapon2) return ['weapon'];
    return (e.weapon?.uid ?? '') <= e.weapon2.uid ? ['weapon', 'weapon2'] : ['weapon2', 'weapon'];
  }

  /** Kafel broni: wybrana ma bursztynową ramkę; klik w inną = jej dobycie. */
  private weaponTile(x: number, y: number, w: number, ch: Character, slot: EquipSlot): Phaser.GameObjects.GameObject[] {
    const sel = slot === 'weapon';
    const inst = ch.equipment[slot];
    const def = itemDef(inst?.id);
    const wp = normWeapon(inst);
    const stat = def ? itemStatLine(def, true) : `${wp.dmg} ${wp.range ? 'z' + wp.range : 'wręcz'}`;
    const on = sel || this.hud.canAct;
    const fill = sel ? C.amberDim : PAL.panel2;
    const stroke = sel ? C.amber : on ? PAL.edge : C.greyDim;
    const r = this.add.rectangle(x, y, w, WT_H, fill, 0.95).setOrigin(0).setStrokeStyle(1, stroke).setInteractive({ useHandCursor: !sel && on });
    const out: Phaser.GameObjects.GameObject[] = [r];
    let tx = x + 2;
    if (inst) {
      out.push(itemIconImage(this, tx, y + 1, inst.id, 11).setAlpha(on ? 1 : 0.5));
      tx += 13;
    }
    const cost = !sel && this.hud.inCombat;
    const right = x + w - (cost ? 6 : 2);
    const nm = this.text(tx, y + 2, '', sel ? C.white : on ? PAL.text : C.grey, 7);
    const st = this.text(right, y + 2, stat, sel ? C.amber : C.grey, 7).setOrigin(1, 0);
    nm.setText(fitText(wp.name, Math.max(12, right - st.width - 3 - tx)));
    out.push(nm, st);
    if (cost) out.push(this.add.graphics().fillStyle(on ? C.amber : C.greyDim, 1).fillRect(x + w - 4, y + 5, 3, 3));
    const tip = `${wp.name}${def ? ' · ' + itemStatLine(def) : ''} · ${sel ? 'wybrana broń' : `kliknij, aby dobyć${this.hud.inCombat ? ' (1 akcja)' : ''} [X]`}`;
    r.on('pointerover', () => {
      if (!sel && on) {
        r.setFillStyle(0x3a2c1e, 1).setStrokeStyle(1, PAL.edgeHi);
        SoundManager.sfx('hover');
      }
      this.hud.setHover(tip);
    });
    r.on('pointerout', () => {
      r.setFillStyle(fill, 0.95).setStrokeStyle(1, stroke);
      this.hud.setHover(null);
    });
    r.on('pointerdown', () => {
      if (sel) return;
      if (!on) {
        SoundManager.sfx('error', { vol: 0.4 });
        return;
      }
      SoundManager.sfx('click');
      this.hud.command({ kind: 'swapWeapons' });
    });
    return out;
  }

  private actionButton(x: number, y: number, w: number, b: ActionButton, key: string): Phaser.GameObjects.GameObject[] {
    const on = b.enabled && this.hud.canAct;
    const col = b.active ? C.amber : on ? PAL.edge : C.greyDim;
    const r = this.add.rectangle(x, y, w, AB_BH, b.active ? C.amberDim : PAL.panel2, 0.95).setOrigin(0).setStrokeStyle(1, col).setInteractive({ useHandCursor: on });
    const out: Phaser.GameObjects.GameObject[] = [r];
    let tx = x + 2;
    if (key) {
      out.push(this.text(tx, y + 1, key, on ? C.amber : C.greyDim, 7));
      tx += 6;
    }
    if (b.id.startsWith('ab:')) {
      out.push(abilityIconImage(this, tx, y + 1, b.id.slice(3), 9).setAlpha(on ? 1 : 0.4));
      tx += 10;
    }
    const pips = typeof b.cost === 'number' ? Math.min(3, b.cost) : b.cost === 'r' ? 1 : 0;
    out.push(this.text(tx, y + 1, fitText(b.label, Math.max(12, x + w - pips * 4 - 3 - tx)), on ? (b.active ? C.amber : C.white) : C.grey, 7));
    if (pips) {
      const g = this.add.graphics();
      for (let k = 0; k < pips; k++) {
        const px = x + w - 3 - (pips - k) * 4;
        if (b.cost === 'r') g.lineStyle(1, on ? C.amber : C.greyDim, 1).strokeRect(px, y + 4, 3, 3);
        else g.fillStyle(on ? C.amber : C.greyDim, 1).fillRect(px, y + 4, 3, 3);
      }
      out.push(g);
    }
    r.on('pointerover', () => {
      if (on) r.setFillStyle(0x3a2c1e, 1).setStrokeStyle(1, PAL.edgeHi);
      this.hud.setHover(b.tip ?? b.label);
    });
    r.on('pointerout', () => {
      r.setFillStyle(b.active ? C.amberDim : PAL.panel2, 0.95).setStrokeStyle(1, col);
      this.hud.setHover(null);
    });
    r.on('pointerdown', () => {
      if (!on) {
        SoundManager.sfx('error', { vol: 0.4 });
        return;
      }
      SoundManager.sfx('click');
      this.hud.command({ kind: 'action', id: b.id });
    });
    return out;
  }

  // ================================================================== rzut k20 (port G.showD20Roll)

  /**
   * Pikselowa kość k20 (ui/DiceArt; zielona najemników, czerwona wrogów): toczy się z odbiciami, osiada ścianką do gracza i pokazuje wynik,
   * potem linia "14 + 7 = 21 vs KP 18 — Sukces" w kolorze stopnia. Naturalne 20 / 1 dostają rozbłysk.
   * Kontrakt bez zmian: hud.roll + r.duration (tempo x2 / x4 skraca lub pomija pokaz w HudState.showRoll).
   */
  private showRoll(): void {
    const r = this.hud.roll;
    if (!r) return;
    this.rollBox?.destroy();
    const color: DieColor = r.mine ? 'green' : 'red';
    const { key: texKey, face } = this.dieTexture(20, color, D20_SIZE);
    const S = D20_SIZE;
    const cx = Math.round(BASE_W / 2), top = Math.round(BASE_H * 0.17);
    const box = this.add.container(cx, top).setDepth(900);
    this.rollBox = box;
    // kolory stopni jak w Oldgame/src/gfx/dice.js (DEG_COL); dla rzutów wroga sukces = zagrożenie
    const DEG_COL = [0xff5a45, 0xb0a49a, 0x8fe06a, 0xffd24a];
    const col = r.mine ? DEG_COL[r.degree] ?? C.white : r.degree >= 2 ? (r.degree === 3 ? 0xff5a45 : 0xffa040) : 0x9ab8a0;
    const nat = r.d20 === 20 ? 1 : r.d20 === 1 ? -1 : 0;
    const dieY = 12 + S / 2;

    const lab = this.text(0, 0, cut(r.label, 34), C.amber, 7).setOrigin(0.5, 0);
    const shadow = this.add.ellipse(0, dieY + S / 2 - 1, 30, 8, 0x000000, 0.55);
    const burst = this.add.graphics().setPosition(0, dieY).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    const die = this.add.image(0, dieY, texKey, 't0');
    const num = this.text(0, 0, String(r.d20), nat > 0 ? 0xfff0a0 : nat < 0 ? 0xffb0a0 : 0xfff6e0, 11).setOrigin(0.5, 0.5).setVisible(false);
    // tabliczka z wynikiem
    const sign = r.mod >= 0 ? '+' : '-';
    const lineStr = `${r.d20} ${sign} ${Math.abs(r.mod)} = ${r.total} vs KP ${r.dc} — ${degreeName(r.degree)}`;
    const line = this.text(0, 0, lineStr, col, 8).setOrigin(0.5, 0);
    const pw = Math.ceil(Math.max(line.width, lab.width)) + 14, ph = 13;
    const py = dieY + S / 2 + 5;
    const plate = this.add.container(0, py).setAlpha(0);
    const pbg = uiBg(this.add.rectangle(0, 0, pw, ph, C.bg, 1).setOrigin(0.5, 0).setStrokeStyle(1, col));
    line.setPosition(0, 3);
    plate.add([pbg, line]);
    box.add([shadow, burst, die, num, lab, plate]);
    box.setAlpha(0);
    this.tweens.add({ targets: box, alpha: 1, duration: 70 });
    SoundManager.sfx('dice', { vol: 0.6 });

    // toczenie: 62% czasu pokazu przypada na lot kości przy x1 (~0.55 s), reszta na odczyt
    const roll = Math.max(160, Math.round(Math.min(620, r.duration * 0.52)));
    const settle = Math.round(roll * 0.22);
    const dirX = Math.random() < 0.5 ? -1 : 1;
    const st = { k: 0 };
    const tumble = this.tweens.add({
      targets: st, k: 1, duration: roll, ease: 'Linear',
      onUpdate: () => {
        const k = st.k;
        // klatki zwalniają pod koniec (ease-out), kość skacze coraz niżej i dojeżdża do środka
        const spin = 1 - Math.pow(1 - k, 1.7);
        die.setFrame(`t${Math.floor(spin * D20_TUMBLE * 1.6) % D20_TUMBLE}`);
        const hop = Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 16;
        die.setPosition(Math.round(dirX * (1 - k) * (1 - k) * 46), Math.round(dieY - hop));
        shadow.setPosition(die.x, dieY + S / 2 - 1).setScale(1 - hop / 40);
      },
      onComplete: () => {
        die.setPosition(0, dieY);
        shadow.setPosition(0, dieY + S / 2 - 1).setScale(1);
        let f = 0;
        const step = (): void => {
          if (!die.active) return;
          if (f < D20_SETTLE) {
            die.setFrame(`s${f++}`);
            this.time.delayedCall(Math.max(16, settle / D20_SETTLE), step);
            return;
          }
          die.setFrame('end');
          // liczba na ściance frontowej: wyskok 2x -> 1x
          num.setPosition(Math.round(-S / 2 + face.x), Math.round(dieY - S / 2 + face.y) + 1).setVisible(true).setScale(2);
          this.time.delayedCall(90, () => num.active && num.setScale(1));
          this.tweens.add({ targets: die, scale: { from: 1.12, to: 1 }, duration: 110, ease: 'Quad.easeOut' });
          this.tweens.add({ targets: plate, alpha: 1, y: { from: py + 3, to: py }, duration: 90 });
          if (nat !== 0) {
            // naturalne 20: złote promienie; naturalne 1: czerwony błysk i drżenie
            const c = nat > 0 ? 0xffd24a : 0xff4030;
            burst.clear();
            for (let i = 0; i < 12; i++) {
              const a = (i / 12) * Math.PI * 2, r0 = S / 2 - 4, r1 = S / 2 + (i % 2 ? 9 : 16);
              burst.fillStyle(c, i % 2 ? 0.5 : 0.85);
              burst.fillTriangle(Math.cos(a - 0.09) * r0, Math.sin(a - 0.09) * r0, Math.cos(a + 0.09) * r0, Math.sin(a + 0.09) * r0, Math.cos(a) * r1, Math.sin(a) * r1);
            }
            burst.setAlpha(1).setScale(0.7);
            this.tweens.add({ targets: burst, scale: 1.15, angle: nat > 0 ? 25 : 0, alpha: { from: 1, to: nat > 0 ? 0.45 : 0 }, duration: 320, ease: 'Quad.easeOut' });
            if (nat > 0) die.setTint(0xfff0c0);
            else {
              die.setTint(0xc08080);
              this.tweens.add({ targets: [die, num], x: { from: -2, to: 2 }, duration: 40, yoyo: true, repeat: 2, onComplete: () => { die.x = 0; num.x = Math.round(-S / 2 + face.x); } });
            }
          }
        };
        step();
      },
    });
    this.tweens.add({
      targets: box, alpha: 0, delay: r.duration - 150, duration: 150,
      onComplete: () => {
        tumble.remove();
        box.destroy();
        if (this.rollBox === box) this.rollBox = null;
      },
    });
  }

  /** Tekstura (arkusz klatek) kości o danej liczbie ścianek i kolorze - generowana raz, potem z cache. */
  private dieTexture(sides: DieSides, color: DieColor, size: number): { key: string; face: { x: number; y: number } } {
    const key = dieTexKey(sides, color, size);
    if (!this.textures.exists(key)) {
      const sh = paintDieSheet(sides, color, size);
      const tex = this.textures.addCanvas(key, sh.pc.toCanvas());
      if (tex) for (const f of sh.frames) tex.add(f.name, 0, f.x, f.y, f.w, f.h);
      this.registry.set(key + ':face', sh.face);
    }
    const face = (this.registry.get(key + ':face') as { x: number; y: number } | undefined) ?? { x: size / 2, y: size / 2 };
    return { key, face };
  }

  /**
   * Rzut obrażeń PF2e: rząd kości k4/k6/k8/k10/k12 (bez k100) toczy się z boku, osiada i pokazuje wyniki,
   * potem tabliczka "(4+2+3) ×2 +5 = 23". Kości dodane po krytyku (deadly / fatal) mają złotą obwódkę.
   * Zielone = najemnicy, czerwone = przeciwnicy. Pokaz pod kością k20 (ta zdążyła już zniknąć).
   */
  private showDamage(): void {
    const r = this.hud.damage;
    if (!r) return;
    this.dmgBox?.destroy();
    const color: DieColor = r.mine ? 'green' : 'red';
    const S = DMG_DIE_SIZE;
    const MAX = 8;
    const all = [...r.dice.map((x) => ({ ...x, post: false })), ...r.post.map((x) => ({ ...x, post: true }))];
    const shown = all.slice(0, MAX);
    const gap = S + 2;
    const cx = Math.round(BASE_W / 2), top = Math.round(BASE_H * 0.17);
    const box = this.add.container(cx, top).setDepth(901);
    this.dmgBox = box;
    const dieY = 12 + S / 2;
    const lab = this.text(0, 0, cut(r.label, 34), C.amber, 7).setOrigin(0.5, 0);
    box.add(lab);
    const col = r.heal ? 0x7ff0d0 : r.mine ? 0x8fe06a : 0xff7a5a;
    const roll = Math.max(140, Math.round(Math.min(520, r.duration * 0.48)));
    const settle = Math.round(roll * 0.22);
    const dirX = Math.random() < 0.5 ? -1 : 1;
    const x0 = -((shown.length - 1) * gap) / 2;
    const items = shown.map((it, i) => {
      const sides = (DIE_SIDES as readonly number[]).includes(it.sides) ? (it.sides as DieSides) : 6;
      const { key, face } = this.dieTexture(sides, color, S);
      const hx = Math.round(x0 + i * gap);
      const shadow = this.add.ellipse(hx, dieY + S / 2 - 1, 20, 6, 0x000000, 0.55);
      const ring = it.post ? this.add.circle(hx, dieY, S / 2 + 1).setStrokeStyle(1, 0xffd24a, 0.9).setVisible(false) : null;
      const die = this.add.image(hx, dieY, key, `t${(i * 5) % DIE_TUMBLE}`);
      const num = this.text(0, 0, String(it.value), it.value === it.sides ? 0xfff0a0 : 0xfff6e0, 8).setOrigin(0.5, 0.5).setVisible(false);
      const kl = this.text(hx, dieY + S / 2 + 1, `k${it.sides}`, C.grey, 7).setOrigin(0.5, 0).setAlpha(0);
      box.add([shadow, ...(ring ? [ring] : []), die, num, kl]);
      return { hx, die, num, kl, shadow, ring, face, phase: i * 0.37 };
    });
    const ty = dieY + S / 2 + 10;
    if (all.length > MAX) {
      box.add(this.text(Math.round(x0 + shown.length * gap - gap / 2 + 4), dieY - 3, `+${all.length - MAX}`, C.grey, 7).setOrigin(0, 0.5));
    }
    const line = this.text(0, 3, r.text, col, 8).setOrigin(0.5, 0);
    const pw = Math.ceil(Math.max(line.width, lab.width)) + 14;
    const plate = this.add.container(0, ty).setAlpha(0);
    plate.add([uiBg(this.add.rectangle(0, 0, pw, 13, C.bg, 1).setOrigin(0.5, 0).setStrokeStyle(1, col)), line]);
    box.add(plate);
    box.setAlpha(0);
    this.tweens.add({ targets: box, alpha: 1, duration: 60 });
    SoundManager.sfx('dice', { vol: 0.45 });

    const st = { k: 0 };
    const tumble = this.tweens.add({
      targets: st, k: 1, duration: roll, ease: 'Linear',
      onUpdate: () => {
        const k = st.k;
        const spin = 1 - Math.pow(1 - k, 1.7);
        for (const it of items) {
          it.die.setFrame(`t${Math.floor(spin * DIE_TUMBLE * 1.6 + it.phase * DIE_TUMBLE) % DIE_TUMBLE}`);
          const hop = Math.abs(Math.sin(k * Math.PI * 2.5 + it.phase)) * (1 - k) * 12;
          it.die.setPosition(Math.round(it.hx + dirX * (1 - k) * (1 - k) * 40), Math.round(dieY - hop));
          it.shadow.setPosition(it.die.x, dieY + S / 2 - 1).setScale(1 - hop / 30);
        }
      },
      onComplete: () => {
        let f = 0;
        for (const it of items) {
          it.die.setPosition(it.hx, dieY);
          it.shadow.setPosition(it.hx, dieY + S / 2 - 1).setScale(1);
        }
        const step = (): void => {
          if (!box.active) return;
          if (f < DIE_SETTLE) {
            for (const it of items) it.die.setFrame(`s${f}`);
            f++;
            this.time.delayedCall(Math.max(16, settle / DIE_SETTLE), step);
            return;
          }
          for (const it of items) {
            it.die.setFrame('end');
            it.num.setPosition(Math.round(it.hx - S / 2 + it.face.x), Math.round(dieY - S / 2 + it.face.y) + 1).setVisible(true).setScale(2);
            this.time.delayedCall(80, () => it.num.active && it.num.setScale(1));
            this.tweens.add({ targets: it.die, scale: { from: 1.12, to: 1 }, duration: 100, ease: 'Quad.easeOut' });
            it.kl.setAlpha(1);
            it.ring?.setVisible(true);
          }
          this.tweens.add({ targets: plate, alpha: 1, y: { from: ty + 3, to: ty }, duration: 90 });
        };
        step();
      },
    });
    this.tweens.add({
      targets: box, alpha: 0, delay: r.duration - 140, duration: 140,
      onComplete: () => {
        tumble.remove();
        box.destroy();
        if (this.dmgBox === box) this.dmgBox = null;
      },
    });
  }

  // ================================================================== pytania (port UI.modal)

  private showPrompt(): void {
    const p = this.hud.prompt;
    if (!p) {
      // odpowiedź przyszła z zewnątrz (np. koniec misji) - zamknij okno
      this.promptWin?.close();
      return;
    }
    if (p.id === this.shownPrompt) return;
    this.promptWin?.close();
    this.shownPrompt = p.id;
    // jak Widgets.dialog, ale z uchwytem okna; Esc / klik w tło = pierwsza opcja
    const w = p.w ?? 280;
    // rozmowa: portrety po bokach (najemnik z lewej, rozmówca - np. nomad - z prawej), treść pomiędzy
    const PS = 40;
    const sp = p.speakers;
    const padL = sp?.left ? PS + 18 : 10;
    const padR = sp?.right ? PS + 18 : 10;
    const probe = label(this, 0, 0, p.body, { size: 7, wrap: w - padL - padR, lineSpacing: 2, color: PAL.text });
    const h = Math.max(Math.ceil(probe.displayHeight), sp ? PS + 14 : 0) + 54;
    let answered = false;
    const reply = (v: string | null): void => {
      if (answered) return;
      answered = true;
      if (this.hud.prompt?.id === p.id) this.hud.answer(v);
    };
    const win = openWindow(this, w, h, p.title, () => {
      if (this.promptWin === win) this.promptWin = null;
      reply(p.options[0]?.value ?? null);
    });
    this.promptWin = win;
    win.add(probe.setPosition(padL, 22));
    const speaker = (who: NonNullable<typeof sp>['left'], x: number): void => {
      if (!who) return;
      const key = portraitKey(this, who.ch, PS);
      win.add(this.add.image(x, 22, key).setOrigin(0).setDisplaySize(PS, PS));
      win.add(this.add.rectangle(x, 22, PS, PS).setOrigin(0).setStrokeStyle(1, PAL.edgeHi));
      const cap = label(this, x + PS / 2, 25 + PS, who.caption ?? who.ch.name, { size: 6, color: PAL.amber });
      win.add(cap.setOrigin(0.5, 0));
    };
    speaker(sp?.left, 9);
    speaker(sp?.right, w - 9 - PS);
    let x = w - 8;
    for (const o of [...p.options].reverse()) {
      const btn = kitButton(this, 0, 0, o.label, () => {
        reply(o.value);
        win.close();
      }, { primary: o.primary, danger: o.danger, size: 7 });
      const bw = (btn.box.list[1] as Phaser.GameObjects.Rectangle).width;
      x -= bw;
      btn.box.setPosition(x, h - 22);
      x -= 6;
      win.add(btn.box);
    }
  }

  // ================================================================== sterowanie (port H.help)

  private drawHelp(): void {
    this.helpBox?.destroy();
    this.helpBox = null;
    if (!this.hud.helpOpen) return;
    const W = 460;
    const lines: [string, string][] = [
      ['KAMERA', 'WASD / strzałki lub PPM / środkowy + przeciągnięcie = przesuwanie; kółko, + / - = zoom, 0 = reset; Q/E obrót kamery; Spacja w eksploracji = wycentruj.'],
      ['EKSPLORACJA', 'LPM na pole = ruch (G = drużyna / solo); LPM na skrzynię / cel / jeńca = interakcja; LPM na wroga = zasadzka (drużyna zaczyna, wróg odsłonięty). Strefę ewakuacji wyznaczają zielone słupki.'],
      ['WALKA', '3 akcje na turę. Pola ruchu: niebieskie 1 akcja, żółte 2, pomarańczowe 3. Czerwony kontur = wróg w zasięgu, zielony = cel wsparcia. Kolejne ataki: kara PWA -5/-10.'],
      ['KLAWISZE', '1-9 przyciski akcji (w eksploracji: wybór najemnika), Spacja = koniec tury, Esc / PPM = anuluj, Tab = następny najemnik, I = ekwipunek, X = zmiana broni (albo klik w broń w panelu akcji), PgUp/PgDn/Home/End = przewijanie dziennika, F = tempo x1/x2/x4, G = ruch drużyny/solo, H = ta pomoc.'],
      ['PANELE', 'Ekwipunek i dziennik można przesuwać, przeciągając za nagłówek (LPM). Dziennik: dolna krawędź = wysokość, róg prawy dolny = rozmiar. W nagłówku każdego panelu: − / + = skala okna (czcionka zmienia się razem z nim), a / A = mniejsza / większa czcionka przy tym samym oknie, ● = przezroczystość. Menu i panel akcji pamiętają osobny układ (skala, czcionka, miejsce) w eksploracji i w walce. Karty drużyny (w walce także wrogów) przesuwa się, przeciągając kartę; prawy dolny róg kart = skala wszystkich kart; daleko od górnej / dolnej krawędzi układają się pionowo, przy krawędzi poziomo. PPM na karcie = domyślnie. PPM na nagłówku = domyślne miejsce i rozmiar.'],
      ['KOŚCI', 'Testy i ataki: k20 + modyfikator vs KP / ST - zielona kość = najemnicy, czerwona = wrogowie. Wynik o 10 ponad ST = krytyczny sukces, o 10 poniżej = krytyczna porażka; naturalna 20 / 1 przesuwa o stopień. Obrażenia i leczenie: osobny rzut kośćmi broni lub zdolności (k4, k6, k8, k10, k12) + premia; krytyk = ×2, udany rzut obronny = połowa. Przerażenie i ukryty cel połowią wynik k20.'],
      ['ZASADY', 'Osłona +2 KP; flankowanie = cel odsłonięty. Powaleni potrzebują Pierwszej pomocy, inaczej umierają. Gdy padnie cała drużyna - nikt nie wraca.'],
    ];
    // Czcionka ma stały rozmiar (6x8); okno pomocy używa drobnego druku (SMALL_TEXT - całe piksele płótna przy każdej
    // rozdzielczości), żeby długie opisy mieściły się w ramce z zapasem.
    const build = (k: number): { items: Phaser.GameObjects.GameObject[]; w: number; h: number } => {
      const w = Math.floor(W / k);
      const items: Phaser.GameObjects.GameObject[] = [this.text(w / 2, 4, 'STEROWANIE  [H / Esc]', C.amber).setOrigin(0.5, 0)];
      const col = 6 + Math.max(...lines.map(([h]) => PixelText.measure(h))) + 8;
      let y = 16;
      for (const [h, t] of lines) {
        items.push(this.text(6, y, h, C.amber, 7));
        const body = this.text(col, y, t, C.white, 7).setWordWrapWidth(w - col - 6);
        items.push(body);
        y += Math.ceil(body.height) + 4;
      }
      return { items, w, h: y + 22 };
    };
    // drobny druk od razu (w pełnej skali tekst dochodził do ramki / wychodził poza nią przy większej skali UI)
    const k = SMALL_TEXT;
    const lay = build(k);
    const box = this.add.container(0, 0).setDepth(950).setScale(k);
    box.setPosition(Math.round(BASE_W / 2 - (lay.w * k) / 2), Math.max(4, Math.round(BASE_H / 2 - (lay.h * k) / 2)));
    const bg = uiBg(this.add.rectangle(0, 0, lay.w, lay.h, C.bg, 1).setOrigin(0).setStrokeStyle(1, C.amber).setInteractive());
    bg.on('pointerdown', () => this.hud.toggleHelp(false));
    // nagłówek: przezroczystość okien (jak w pozostałych oknach); dół: przycisk Zamknij
    const alpha = uiAlphaToggle(this, lay.w - 6, 4, PAL.dim, (tip) => this.hud.setHover(tip));
    const close = kitButton(this, 0, 0, 'Zamknij', () => this.hud.toggleHelp(false), { size: 7, h: 14 });
    const cw = (close.box.list[1] as Phaser.GameObjects.Rectangle).width;
    close.box.setPosition(lay.w - 6 - cw, lay.h - 19);
    box.add([bg, ...lay.items, alpha, close.box]);
    this.helpBox = box;
  }

  // ================================================================== opis pod kursorem (port H.showInfo)

  private drawHover(): void {
    const s = this.hud.hover;
    const show = !!s;
    this.hoverBg.setVisible(show);
    this.hoverText.setVisible(show);
    if (!s) return;
    const sc = panelScale.actions * fontScaleOf('actions');
    this.hoverBox.setScale(sc);
    const maxW = Math.floor((BASE_W - LOG_W - M * 3 - 6) / sc);
    this.hoverText.setText(s);
    let txt = s;
    while (this.hoverText.width > maxW && txt.length > 4) {
      txt = txt.slice(0, -2);
      this.hoverText.setText(txt + '…');
    }
    this.hoverBg.setSize(this.hoverText.width + 6, 12);
    this.hoverBg.setStrokeStyle(1, C.greenDim);
  }

  // ================================================================== przesuwane panele

  /** Niewidoczny uchwyt na nagłówku panelu: LPM + przeciągnięcie = przesuń, PPM = pozycja domyślna. */
  private dragHandle(target: PanelId, w: number, h: number): Phaser.GameObjects.Rectangle {
    const r = this.add.rectangle(0, 0, w, h, C.amber, 0).setOrigin(0).setInteractive({ cursor: 'move' });
    r.on('pointerover', () => {
      r.setFillStyle(C.amber, 0.08);
      const how = target === 'log' ? '− +' : 'kółko / − +';
      const mode = (MODE_PANELS as readonly PanelId[]).includes(target) ? ` (${modeName()})` : '';
      this.hud.setHover(`Przeciągnij: przesuń · ${how}: okno ${Math.round(panelScale[target] * 100)}%${mode} · a / A: czcionka · PPM: domyślnie`);
    });
    r.on('pointerout', () => {
      r.setFillStyle(C.amber, 0);
      this.hud.setHover(null);
    });
    // kółko nad nagłówkiem panelu = skala (nad dziennikiem kółko przewija - obsługa w create())
    if (target !== 'log') r.on('wheel', (_p: Phaser.Input.Pointer, _dx: number, dy: number) => dy && this.setPanelScale(target, dy > 0 ? -1 : 1));
    r.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) {
        this.drag = null;
        if (target === 'log') logSize = { w: LOG_W, h: LOG_H };
        panelPos[target] = null;
        panelScale[target] = 1;
        fontStep[target] = 0;
        this.relayout(target);
        saveLayout();
        SoundManager.sfx('click');
        return;
      }
      const box = this.panelBox(target);
      // przeciągany panel na wierzch (żeby po przesunięciu nie chował się pod innym)
      this.children.bringToTop(box);
      this.drag = { target, dx: p.worldX - box.x, dy: p.worldY - box.y };
    });
    return r;
  }

  /**
   * Sterowanie w nagłówku panelu: przezroczystość okien (●/◐/○), czcionka (a / A) i skala okna (− / +).
   * `right` = prawa krawędź "+"; kolejność jak CTRL_DX.
   */
  private scaleButtons(id: PanelId, right: number, y: number): PixelText[] {
    const alpha = uiAlphaToggle(this, 0, y, PAL.dim, (tip) => this.hud.setHover(tip));
    const ctl = (glyph: string, act: () => void, tip: () => string): PixelText => {
      const b = this.text(0, y, glyph, PAL.dim).setOrigin(1, 0).setInteractive({ useHandCursor: true });
      b.on('pointerdown', (p: Phaser.Input.Pointer) => !p.rightButtonDown() && act());
      b.on('pointerover', () => {
        b.setColor(C.amber);
        this.hud.setHover(tip());
      });
      b.on('pointerout', () => {
        b.setColor(PAL.dim);
        this.hud.setHover(null);
      });
      return b;
    };
    const fontTip = (dir: number) => (): string => `${dir < 0 ? 'Mniejsza' : 'Większa'} czcionka (${Math.round(fontScaleOf(id) * 100)}% panelu${mode()}) · PPM na nagłówku: domyślnie`;
    const mode = (): string => ((MODE_PANELS as readonly PanelId[]).includes(id) ? `, ${modeName()}` : '');
    const sizeTip = (dir: number) => (): string => `${dir < 0 ? 'Zmniejsz' : 'Powiększ'} okno (skala ${Math.round(panelScale[id] * 100)}%${mode()}) · PPM na nagłówku: domyślnie`;
    const out = [
      alpha,
      ctl('a', () => this.setFontStep(id, -1), fontTip(-1)),
      ctl('A', () => this.setFontStep(id, 1), fontTip(1)),
      ctl('−', () => this.setPanelScale(id, -1), sizeTip(-1)),
      ctl('+', () => this.setPanelScale(id, 1), sizeTip(1)),
    ];
    this.layoutCtrls(out, right);
    return out;
  }

  /** Rozstawienie przycisków z scaleButtons od prawej krawędzi `right`. */
  private layoutCtrls(btns: PixelText[], right: number): void {
    btns.forEach((b, i) => b.setX(Math.round(right + CTRL_DX[i]!)));
  }

  private panelBox(id: PanelId): Phaser.GameObjects.Container {
    if (id === 'log') return this.logPanel;
    return id === 'menu' ? this.menuPanel : id === 'top' ? this.topPanel : id === 'actions' ? this.actionLayer : this.sheet;
  }

  /** Rozmiar panelu przed skalowaniem. */
  private panelSize(id: PanelId): { w: number; h: number } {
    if (id === 'menu') return { w: RCOL_W, h: this.menuH };
    if (id === 'top') return { w: TOP_W, h: this.topH() };
    if (id === 'actions') return { w: AB_W, h: this.actH };
    if (id === 'log') return { w: logSize.w, h: this.logCollapsed ? 12 : logSize.h };
    return { w: SHEET_W, h: this.sheetH };
  }

  /** Wysokość paska rundy (napis w skali czcionki). */
  private topH(): number {
    return Math.max(TOP_H, Math.ceil(LH * fontScaleOf('top')));
  }

  /** Skala + pozycja panelu: przesunięty trzyma lewy górny róg (w granicach ekranu), inaczej miejsce domyślne. */
  private placePanel(id: PanelId): void {
    if (id === 'log') {
      this.drawLog();
      return;
    }
    const box = this.panelBox(id);
    const s = panelScale[id];
    const { w, h } = this.panelSize(id);
    const sw = w * s, sh = h * s;
    box.setScale(s);
    const pos = panelPos[id];
    if (pos) {
      box.setPosition(Phaser.Math.Clamp(Math.round(pos.x), Math.round(30 - sw), BASE_W - 30), Phaser.Math.Clamp(Math.round(pos.y), 0, Math.round(BASE_H - 12 * s)));
    } else if (id === 'menu') box.setPosition(Math.round(BASE_W - M - sw), M);
    else if (id === 'top') box.setPosition(Math.round(MID_X0 + (TOP_W - sw) / 2), this.partyBottom());
    else if (id === 'actions') box.setPosition(AB_X, Math.round(BASE_H - M - 14 * s * fontScaleOf('actions') - sh));
    else if (partyPos) box.setPosition(SHEET_X, SHEET_Y);
    else box.setPosition(M, this.partyBottom() + LH + 4);
    if (id === 'actions') this.drawHover();
  }

  private setPanelScale(id: PanelId, dir: number): void {
    const list = panelScales(EXTRA_SMALL.includes(id));
    const i = nearestScale(list, panelScale[id]);
    const n = Phaser.Math.Clamp(i + dir, 0, list.length - 1);
    if (n === i) {
      SoundManager.sfx('error', { vol: 0.3 });
      return;
    }
    const box = this.panelBox(id);
    const { w, h } = this.panelSize(id);
    const s0 = panelScale[id], s1 = list[n]!;
    panelScale[id] = s1;
    if (panelPos[id]) panelPos[id] = { x: keepAnchor(box.x, w * s0, w * s1, BASE_W), y: keepAnchor(box.y, h * s0, h * s1, BASE_H) };
    SoundManager.sfx('click');
    this.relayout(id);
    saveLayout();
    const mode = (MODE_PANELS as readonly PanelId[]).includes(id) ? ` (${modeName()})` : '';
    this.hud.setHover(`Skala okna: ${Math.round(s1 * 100)}%${mode}`);
  }

  /** a / A: czcionka panelu o stopień mniejsza / większa (szerokość panelu bez zmian). */
  private setFontStep(id: PanelId, dir: number): void {
    const f0 = fontScaleOf(id);
    let step = fontStep[id];
    // pomijamy stopnie, które nie zmieniają czcionki (np. 1 piksel płótna to minimum)
    for (;;) {
      step += dir;
      const f = fontScaleRaw(step, panelScale[id]);
      if (Math.abs(step) > FONT_STEP_MAX || f < FONT_MIN - 1e-6 || f > FONT_MAX + 1e-6) {
        SoundManager.sfx('error', { vol: 0.3 });
        return;
      }
      if (Math.abs(f - f0) > 1e-6) break;
    }
    fontStep[id] = step;
    SoundManager.sfx('click');
    this.relayout(id);
    saveLayout();
    this.hud.setHover(`Czcionka: ${Math.round(fontScaleOf(id) * 100)}% panelu`);
  }

  /** Przebudowa panelu po zmianie skali / czcionki. */
  private relayout(id: PanelId): void {
    if (id === 'menu') {
      this.buildMenu();
      this.drawTurn();
      this.drawObjectives();
    } else if (id === 'top') {
      this.drawTurn();
      this.placePanel('top');
    } else if (id === 'actions') this.drawActions();
    else if (id === 'sheet') {
      if (this.hud.inventoryOpen) this.drawSheet();
      else this.placePanel('sheet');
    } else {
      this.logLayoutKey = '';
      this.drawLog();
    }
  }

  private onDragMove(p: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d) return;
    if (!p.isDown) {
      this.drag = null;
      return;
    }
    if (d.target === 'party') {
      this.dragParty(p, d);
      return;
    }
    if (d.target === 'partySize') {
      this.resizeParty(p);
      return;
    }
    if (d.target === 'logSize' || d.target === 'logH') {
      // prawy dolny róg: lewy górny stoi w miejscu, panel nie wychodzi poza ekran (rozmiar w pikselach panelu przed skalą)
      const x0 = this.logPanel.x, y0 = this.logPanel.y, s = panelScale.log;
      const minH = LOG_HEAD + 3 * LH + 3;
      const w = d.target === 'logH' ? logSize.w : Phaser.Math.Clamp(Math.round((p.worldX - d.dx - x0) / s), LOG_MIN_W, Math.max(LOG_MIN_W, Math.floor((BASE_W - x0) / s)));
      const h = Phaser.Math.Clamp(Math.round((p.worldY - d.dy - y0) / s), minH, Math.max(minH, Math.floor((BASE_H - y0) / s)));
      if (w !== logSize.w || h !== logSize.h) {
        logSize = { w, h };
        this.drawLog();
      }
      return;
    }
    if (d.target === 'logThumb') {
      // przeciąganie suwaka dziennika: góra toru = najstarsze, dół = najnowsze
      const t = this.logThumb;
      const maxScroll = Math.max(0, this.logDisplayLines().length - this.logLines());
      const free = Math.max(1, t.trackH - t.h);
      const pos = Phaser.Math.Clamp(((p.worldY - this.logPanel.y) / panelScale.log - d.dy - t.trackY) / free, 0, 1);
      const next = Math.round((1 - pos) * maxScroll);
      if (next !== this.logScroll) {
        this.logScroll = next;
        this.drawLog();
      }
      return;
    }
    const id = d.target;
    const box = this.panelBox(id);
    if (!box.visible) {
      this.drag = null;
      return;
    }
    const s = panelScale[id];
    const w = this.panelSize(id).w * s;
    // panel może wyjechać częściowo poza ekran, ale nagłówek i 30 px szerokości zostają widoczne
    const x = Phaser.Math.Clamp(Math.round(p.worldX - d.dx), Math.round(30 - w), BASE_W - 30);
    const y = Phaser.Math.Clamp(Math.round(p.worldY - d.dy), 0, Math.round(BASE_H - 12 * s));
    box.setPosition(x, y);
    panelPos[id] = { x, y };
  }

  // ================================================================== dziennik (port H.log)

  private createLog(): void {
    this.logPanel = this.add.container(0, 0);
    this.logBg = this.panelRect(0, 0, LOG_W, LOG_H);

    const head = this.text(3, 1, 'DZIENNIK', UI_TITLE);
    this.logHeadLine = this.add.graphics();
    this.logGrip = this.dragHandle('log', 10, 12);
    this.logColBtn = this.text(0, 1, '[-]', PAL.dim).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.logColBtn.on('pointerdown', () => {
      SoundManager.sfx('click');
      this.logCollapsed = !this.logCollapsed;
      this.drawLog();
    });

    // − / + = skala całego panelu (czcionka maleje / rośnie razem z nim), jak w pozostałych panelach
    this.logScaleBtns = this.scaleButtons('log', 0, 1);

    this.logMeasure = this.text(0, 0, '', C.grey).setVisible(false);
    // linie dziennika w kontenerze ze skalą czcionki
    this.logBody = this.add.container(0, LOG_HEAD);
    this.logScrollBar = this.add.graphics();

    // przewijanie: ▲ / ▼ (przytrzymanie = powtarzanie), klik w tor = strona, suwak do przeciągania
    const arrow = (glyph: string, dir: number): PixelText => {
      const b = this.text(0, 0, glyph, PAL.dim, 7).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => {
        SoundManager.sfx('click', { vol: 0.5 });
        this.scrollLog(dir);
        this.logRepeat?.remove();
        this.logRepeat = this.time.addEvent({
          delay: 70, startAt: -230, loop: true,
          callback: () => (this.input.activePointer.isDown ? this.scrollLog(dir) : this.stopLogRepeat()),
        });
      });
      b.on('pointerout', () => this.stopLogRepeat());
      b.on('pointerup', () => this.stopLogRepeat());
      return b;
    };
    this.logUpBtn = arrow('▲', 1);
    this.logDownBtn = arrow('▼', -1);
    this.logTrack = this.add.rectangle(0, 0, 7, 10, C.amber, 0).setOrigin(0).setInteractive({ useHandCursor: true });
    this.logTrack.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const t = this.logThumb;
      const ly = (p.worldY - this.logPanel.y) / panelScale.log;
      if (ly >= t.y && ly <= t.y + t.h) this.drag = { target: 'logThumb', dx: 0, dy: ly - t.y };
      else this.scrollLog(ly < t.y ? this.logLines() - 1 : -(this.logLines() - 1));
    });

    // ciemny tekst na bursztynie: bez obrysu (jasne tło samo daje kontrast)
    this.logNewBg = this.add.rectangle(0, 0, 10, 10, C.amber, 1).setOrigin(0.5, 0).setVisible(false);
    this.logNewBtn = this.text(0, 0, '', C.bg)
      .setFontStyle('plain')
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);
    this.logNewBtn.on('pointerdown', () => {
      SoundManager.sfx('click');
      this.logScroll = 0;
      this.logUnseen = 0;
      this.drawLog();
    });

    // uchwyt zmiany rozmiaru (prawy dolny róg)
    this.logResizeMark = this.add.graphics();
    this.logResize = this.add.rectangle(0, 0, 9, 9, C.amber, 0).setOrigin(1, 1).setInteractive({ cursor: 'nwse-resize' });
    this.logResize.on('pointerover', () => this.logResize.setFillStyle(C.amber, 0.2));
    this.logResize.on('pointerout', () => this.logResize.setFillStyle(C.amber, 0));
    this.logResize.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      // od teraz pozycja jawna: zmiana rozmiaru trzyma lewy górny róg
      const x0 = this.logPanel.x, y0 = this.logPanel.y, s = panelScale.log;
      panelPos.log = { x: x0, y: y0 };
      this.drag = { target: 'logSize', dx: p.worldX - x0 - logSize.w * s, dy: p.worldY - y0 - logSize.h * s };
    });

    this.logResizeB = this.add.rectangle(0, 0, 10, 3, C.amber, 0).setOrigin(0, 1).setInteractive({ cursor: 'ns-resize' });
    this.logResizeB.on('pointerover', () => {
      this.logResizeB.setFillStyle(C.amber, 0.25);
      this.hud.setHover('Przeciągnij: wysokość dziennika · róg: szerokość i wysokość');
    });
    this.logResizeB.on('pointerout', () => {
      this.logResizeB.setFillStyle(C.amber, 0);
      this.hud.setHover(null);
    });
    this.logResizeB.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      const x0 = this.logPanel.x, y0 = this.logPanel.y, s = panelScale.log;
      panelPos.log = { x: x0, y: y0 };
      this.drag = { target: 'logH', dx: 0, dy: p.worldY - y0 - logSize.h * s };
    });

    this.logPanel.add([this.logBg, this.logGrip, head, this.logHeadLine, this.logColBtn, ...this.logScaleBtns, this.logBody, this.logScrollBar, this.logTrack, this.logUpBtn, this.logDownBtn, this.logNewBg, this.logNewBtn, this.logResizeMark, this.logResizeB, this.logResize]);
  }

  /** Ile linii mieści dziennik przy bieżącym rozmiarze i czcionce. */
  private logLines(): number {
    return Math.max(1, Math.floor((logSize.h - LOG_HEAD - 3) / (LH * fontScaleOf('log'))));
  }

  /** Przebudowa elementów zależnych od rozmiaru panelu (tylko gdy coś się zmieniło). */
  private layoutLog(): void {
    const { w, h } = logSize;
    const f = fontScaleOf('log');
    const key = `${w}x${h}x${f}`;
    if (key === this.logLayoutKey) return;
    this.logLayoutKey = key;
    const n = this.logLines();

    this.logHeadLine.clear().lineStyle(1, C.greenDim, 1).lineBetween(2, 11.5, w - 2, 11.5);
    this.logColBtn.setX(w - 3);
    this.layoutCtrls(this.logScaleBtns, w - 23);
    const gripW = Math.max(10, w - 23 - CTRL_W - 2);
    this.logGrip.setSize(gripW, 12);
    this.logGrip.input?.hitArea.setSize(gripW, 12);

    // linie tekstu (w pikselach treści przed skalą czcionki: szerokość (w - 14) / f)
    this.logBody.removeAll(true);
    this.logBody.setScale(f);
    this.logLineTexts = [];
    for (let i = 0; i < n; i++) this.logLineTexts.push([]);
    this.logMeasure.setWordWrapWidth(Math.floor((w - 14) / f));
    this.logWrapCache.clear();

    this.logUpBtn.setPosition(w - 4, LOG_HEAD - 1);
    this.logDownBtn.setPosition(w - 4, h - 19);
    this.logTrack.setPosition(w - 7, LOG_HEAD + 8).setSize(7, Math.max(2, h - 19 - LOG_HEAD - 8));
    this.logTrack.input?.hitArea.setSize(7, Math.max(2, h - 19 - LOG_HEAD - 8));

    this.logNewBg.setPosition(w / 2, h - 12);
    this.logNewBtn.setPosition(w / 2, h - 11);
    this.logResize.setPosition(w, h);
    this.logResizeB.setPosition(0, h).setSize(w - 9, 3);
    this.logResizeB.input?.hitArea.setSize(w - 9, 3);
    this.logResizeMark.clear().fillStyle(C.greenDim, 1);
    for (let i = 0; i < 3; i++) for (let j = 0; j <= i; j++) this.logResizeMark.fillRect(w - 3 - j * 2, h - 7 + i * 2, 1, 1);
  }

  /** Wszystkie wpisy złamane na linie (z pamięcią podręczną zawijania). */
  private logDisplayLines(): DisplayLine[] {
    const out: DisplayLine[] = [];
    const alive = new Set<number>();
    for (const e of this.hud.log) {
      alive.add(e.id);
      let lines = this.logWrapCache.get(e.id);
      if (!lines) {
        lines = this.wrap(e);
        this.logWrapCache.set(e.id, lines);
      }
      for (const text of lines) out.push({ text, tone: e.tone });
    }
    for (const id of this.logWrapCache.keys()) if (!alive.has(id)) this.logWrapCache.delete(id);
    return out;
  }

  private wrap(e: LogEntry): string[] {
    const src = e.tone === 'hd' ? `— ${e.text} —` : e.text;
    const lines = this.logMeasure.getWrappedText(src);
    return lines.map((l, i) => (i === 0 ? l : ' ' + l));
  }

  private drawLog(): void {
    this.layoutLog();
    const lines = this.logLines();
    const { w: W, h: H } = logSize;
    const all = this.logDisplayLines();

    // Nowe wpisy: jeśli gracz przewinął w górę, trzymamy widok w miejscu i liczymy nieprzeczytane.
    const newest = this.hud.log[this.hud.log.length - 1]?.id ?? 0;
    if (newest > this.logSeenId) {
      if (this.logScroll > 0) {
        const added = this.hud.log.filter((e) => e.id > this.logSeenId);
        this.logUnseen += added.length;
        this.logScroll += added.reduce((n, e) => n + (this.logWrapCache.get(e.id)?.length ?? 1), 0);
      }
      this.logSeenId = newest;
    }

    const maxScroll = Math.max(0, all.length - lines);
    this.logScroll = Math.max(0, Math.min(maxScroll, this.logScroll));
    if (this.logScroll === 0) this.logUnseen = 0;

    // zwinięty dziennik = sam nagłówek
    const h = this.logCollapsed ? 12 : H;
    this.logBg.setSize(W, h);
    this.logBg.input?.hitArea.setSize(W, h);
    const s = panelScale.log, pos = panelPos.log;
    this.logPanel.setScale(s);
    if (pos) this.logPanel.setPosition(Phaser.Math.Clamp(Math.round(pos.x), Math.round(30 - W * s), BASE_W - 30), Phaser.Math.Clamp(Math.round(pos.y), 0, Math.round(BASE_H - 12 * s)));
    else this.logPanel.setPosition(Math.round(BASE_W - M - W * s), Math.round(BASE_H - M - h * s));
    this.logColBtn.setText(this.logCollapsed ? '[+]' : '[-]');
    this.logResize.setVisible(!this.logCollapsed);
    this.logResizeB.setVisible(!this.logCollapsed);
    this.logResizeMark.setVisible(!this.logCollapsed);


    const start = all.length - lines - this.logScroll;
    const names = this.logNames();
    const f = fontScaleOf('log');
    this.logLineTexts.forEach((segs, i) => {
      const ln = all[start + i];
      const parts = ln && !this.logCollapsed ? splitNames(ln.text, names) : [];
      while (segs.length < parts.length) {
        const t = this.text(0, i * LH, '', LOG_GREY);
        segs.push(t);
        this.logBody.add(t);
      }
      let x = 4 / f;
      segs.forEach((t, k) => {
        const part = parts[k];
        t.setVisible(!!part);
        if (!part) return;
        t.setText(part.text).setX(x).setColor(part.color);
        x += advance(part.text);
      });
    });

    // pasek przewijania
    const g = this.logScrollBar.clear();
    const scrollable = !this.logCollapsed && all.length > lines;
    this.logUpBtn.setVisible(!this.logCollapsed).setColor(scrollable && this.logScroll < maxScroll ? C.amber : C.greyDim);
    this.logDownBtn.setVisible(!this.logCollapsed).setColor(scrollable && this.logScroll > 0 ? C.amber : C.greyDim);
    this.logTrack.setVisible(scrollable);
    if (scrollable) {
      const trackY = LOG_HEAD + 8, trackH = Math.max(2, H - 19 - trackY);
      const thumbH = Math.min(trackH, Math.max(5, Math.round((trackH * lines) / all.length)));
      const pos = maxScroll ? 1 - this.logScroll / maxScroll : 1;
      const thumbY = trackY + Math.round((trackH - thumbH) * pos);
      this.logThumb = { y: thumbY, h: thumbH, trackY, trackH };
      g.fillStyle(PAL.edge, 0.5).fillRect(W - 5, trackY, 2, trackH);
      g.fillStyle(this.drag?.target === 'logThumb' ? C.amber : PAL.edgeHi, 1).fillRect(W - 6, thumbY, 4, thumbH);
    }

    const showNew = !this.logCollapsed && this.logScroll > 0;
    this.logNewBtn.setVisible(showNew);
    this.logNewBg.setVisible(showNew);
    if (showNew) {
      this.logNewBtn.setText(`▼ NAJNOWSZE${this.logUnseen ? ` (+${this.logUnseen})` : ''}`);
      this.logNewBg.setSize(this.logNewBtn.width + 6, 10);
    }
  }

  /** Imiona drużyny z kolorami (najdłuższe najpierw, żeby "Igła" nie zjadła "Igła Mała"). */
  private logNames(): { name: string; color: number }[] {
    return this.hud.party
      .filter((ch) => !ch.isEnemy && ch.name)
      .map((ch) => ({ name: ch.name, color: parseColor(ch.nameColor, PAL.text) }))
      .sort((a, b) => b.name.length - a.name.length);
  }

  private scrollLog(delta: number): void {
    if (this.logCollapsed) return;
    const before = this.logScroll;
    this.logScroll += delta;
    this.drawLog();
    if (this.logScroll === before) this.stopLogRepeat();
  }

  private stopLogRepeat(): void {
    this.logRepeat?.remove();
    this.logRepeat = null;
  }

  // ================================================================== karta postaci / ekwipunek (port H.sheet)

  /** Okno Drużyna (podgląd najemników jak w Przystani); niedostępne w walce. */
  private openParty(): void {
    if (this.hud.inCombat || this.partyWin || modalOpen(this)) return;
    SoundManager.sfx('click');
    const start = Math.max(0, this.hud.party.indexOf(this.hud.active as Character));
    const win = openPartyWindow(this, this.hud.party, start, () => {
      if (this.partyWin === win) this.partyWin = null;
    });
    this.partyWin = win;
  }

  private toggleSheet(): void {
    this.hud.toggleInventory();
  }

  private usableRows(): InventoryRow[] {
    const ch = this.hud.active;
    return ch ? backpackRows(ch).filter((r) => r.usable) : [];
  }

  private useItem(uid: string): void {
    if (!this.hud.canAct) {
      SoundManager.sfx('error', { vol: 0.4 });
      return;
    }
    this.hud.command({ kind: 'useItem', uid });
  }

  private drawSheet(): void {
    const S = this.sheet;
    S.removeAll(true);
    this.sheetFooter = null;
    const ch = this.hud.active;
    if (!this.hud.inventoryOpen || !ch) {
      S.setVisible(false);
      return;
    }
    S.setVisible(true);

    // nagłówek (imię + sterowanie) w skali okna; reszta w kontenerze ze skalą czcionki, szerokość logiczna W
    const head: Phaser.GameObjects.GameObject[] = [];
    const close = this.text(SHEET_W - 3, 2, '[X]', C.grey).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => {
      SoundManager.sfx('click');
      this.hud.toggleInventory(false);
    });
    const ctrlR = SHEET_W - 26;
    head.push(this.text(3, 2, fitText(ch.name, ctrlR - CTRL_W - 6), UI_TITLE), close, ...this.scaleButtons('sheet', ctrlR, 2));
    const headH = 2 + LH;
    const f = fontScaleOf('sheet');
    const W = Math.floor(SHEET_W / f);
    this.sheetW = W;

    const items: Phaser.GameObjects.GameObject[] = [];
    let y = 0;
    const sec = (label: string): void => {
      items.push(this.text(3, y, label, C.amber));
      items.push(this.add.graphics().lineStyle(1, C.greenDim, 1).lineBetween(2, y + LH + 0.5, W - 2, y + LH + 0.5));
      y += LH + 2;
    };

    items.push(this.text(3, y, fitText(classLabel(ch), W - 6), C.grey));
    y += LH + 2;

    // statystyki: 3 kolumny (przy dużej czcionce mniej, żeby wartości się mieściły)
    const pairs = statPairs(ch);
    const keyW = Math.max(26, ...pairs.map(([k]) => PixelText.measure(k) + 2));
    const valW = Math.max(...pairs.map(([, v]) => PixelText.measure(v)));
    const cols = Phaser.Math.Clamp(Math.floor((W - 6) / (keyW + valW + 1)), 1, 3);
    const colW = Math.floor((W - 6) / cols);
    pairs.forEach(([k, v], i) => {
      const cx = 3 + (i % cols) * colW, cy = y + Math.floor(i / cols) * LH;
      items.push(this.text(cx, cy, k, C.grey), this.text(cx + keyW, cy, fitText(v, colW - keyW - 1), C.white));
    });
    y += LH * Math.ceil(pairs.length / cols) + 3;

    sec('WYPOSAŻENIE');
    for (const row of equipmentRows(ch)) {
      items.push(...this.itemRow(row, y, null));
      y += LH + 1;
    }
    y += 2;

    sec('PLECAK  (użycie: 1-2 AP)');
    const rows = backpackRows(ch);
    if (!rows.length) {
      items.push(this.text(6, y, 'pusty', C.grey));
      y += LH + 1;
    }
    let key = 0;
    for (const row of rows) {
      items.push(...this.itemRow(row, y, row.usable ? ++key : null));
      y += LH + 1;
    }

    y += 2;
    const acts = this.hud.inCombat && ch === this.hud.active ? this.hud.ap : 3;
    sec(this.hud.inCombat ? `AKCJE (zostało ${acts})` : 'AKCJE');
    for (const ab of abilityRows(ch, acts)) {
      const hit = this.add.rectangle(2, y - 1, W - 4, LH + 1, C.amber, 0).setOrigin(0).setInteractive();
      const label = ab.name + (ab.uses !== null ? ` (${ab.uses})` : '');
      const col = ab.off ? C.grey : C.white;
      const cost = ab.cost === null ? 'reakcja' : ab.cost === 0 ? 'darmowa' : '◆'.repeat(Math.min(3, ab.cost));
      const costT = this.text(W - 4, y, cost, ab.off ? C.greyDim : C.amber).setOrigin(1, 0);
      items.push(hit, abilityIconImage(this, 4, y - 1, ab.id, 9).setAlpha(ab.off ? 0.45 : 1), this.text(16, y, fitText(label, Math.max(12, W - 4 - PixelText.measure(cost) - 3 - 16)), col), costT);
      hit.on('pointerover', () => {
        hit.setFillStyle(C.amber, 0.15);
        this.sheetFooter?.setText(`${ab.name}${ab.cost !== null ? ` [${ab.cost} akc.]` : ''}: ${ab.desc}`);
      });
      hit.on('pointerout', () => hit.setFillStyle(C.amber, 0));
      y += LH + 1;
    }

    // stopka: opis przedmiotu pod kursorem
    y += 2;
    items.push(this.add.graphics().lineStyle(1, C.greenDim, 1).lineBetween(2, y + 0.5, W - 2, y + 0.5));
    this.sheetFooter = this.text(3, y + 2, 'Najedź na przedmiot. 1-9 = użyj.', C.grey).setWordWrapWidth(W - 6);
    items.push(this.sheetFooter);
    y += 2 + LH * 3;

    // nieprzezroczyste tło: karta zasłania karty drużyny pod spodem
    const total = headH + Math.ceil(y * f);
    const solid = uiBg(this.add.rectangle(0, 0, SHEET_W, total, C.bg, 1).setOrigin(0));
    const bg = this.panelRect(0, 0, SHEET_W, total, C.amber);
    const body = this.add.container(0, headH).setScale(f);
    body.add(items);
    S.add([solid, bg, this.dragHandle('sheet', ctrlR - CTRL_W - 2, headH), ...head, body]);
    this.sheetH = total;
    this.placePanel('sheet');
  }

  private itemRow(row: InventoryRow, y: number, key: number | null): Phaser.GameObjects.GameObject[] {
    const out: Phaser.GameObjects.GameObject[] = [];
    const W = this.sheetW;
    const hit = this.add.rectangle(2, y - 1, W - 4, LH + 1, C.amber, 0).setOrigin(0).setInteractive({ useHandCursor: row.usable });
    out.push(hit);
    const color = row.inst ? (row.usable ? C.green : C.white) : C.grey;
    const label = row.name + (row.qty > 1 ? ` x${row.qty}` : '');
    if (row.slot) out.push(this.text(5, y, cut(row.slot, 8), C.grey));
    else if (key) out.push(this.text(5, y, String(key), C.amber));
    // ikona przedmiotu (malowana natywnie w pikselach ekranu - Widgets.itemIconImage)
    const ix = row.slot ? 49 : 12;
    if (row.inst) out.push(itemIconImage(this, ix, y - 1, row.inst.id, 9));
    const stat = row.statShort ? cut(row.statShort, 11) : '';
    if (stat) out.push(this.text(W - 4, y, stat, C.grey).setOrigin(1, 0));
    out.push(this.text(ix + 11, y, fitText(label, Math.max(12, W - 4 - (stat ? PixelText.measure(stat) + 4 : 0) - ix - 11)), color));

    hit.on('pointerover', () => {
      hit.setFillStyle(C.amber, 0.15);
      this.sheetFooter?.setText([row.desc ? `${row.name}: ${row.desc}` : row.name, row.stat].filter(Boolean).join(' · '));
    });
    hit.on('pointerout', () => hit.setFillStyle(C.amber, 0));
    if (row.usable && row.inst) {
      const uid = row.inst.uid;
      hit.on('pointerdown', () => this.useItem(uid));
    }
    return out;
  }

  // ================================================================== baner (port H.banner)

  private showBanner(): void {
    const b = this.hud.banner;
    if (!b) return;
    this.banner?.destroy();
    const color = TONE[b.tone];
    const t = this.text(0, 0, b.sub ? `${b.text}\n${b.sub}` : b.text, color, 16).setOrigin(0.5).setAlign('center');
    const bg = this.add.rectangle(0, 0, t.width + 16, t.height + 6, C.bg, 0.85).setStrokeStyle(1, color);
    // baner bez skalowania (skala != 1 rozjechałaby piksele czcionki z siatką) - tylko wjazd z góry i zanik
    const box = this.add.container(Math.round(BASE_W / 2), Math.round(BASE_H * 0.36) - 6, [bg, t]).setAlpha(0);
    this.banner = box;
    this.tweens.add({ targets: box, y: Math.round(BASE_H * 0.36), alpha: 1, duration: 140, ease: 'Quad.easeOut', onUpdate: () => (box.y = Math.round(box.y)) });
    this.tweens.add({ targets: box, alpha: 0, delay: 1300, duration: 400, onComplete: () => box.destroy() });
  }
}
