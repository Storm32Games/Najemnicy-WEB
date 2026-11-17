import Phaser from 'phaser';
import type { PixelText } from './ui/BitmapFont';
import { SoundManager } from '../audio/SoundManager';
import { RECRUITS } from '../core/data/recruits';
import { INTRO_SLIDES, type IntroSlideId } from '../core/data/story';
import {
  IntRng, IntroAction, IntroFlow, Q12, TickClock, angQ8, idiv, lerpQ12, progressQ12, secToQ8, wave,
} from '../core/frontend';
import { NukeBlast, paintRuinStreet } from './fx/NukeArt';
import { addUnit, enemyUnitLook, unitLookOf } from './iso/UnitLooks';
import { dirOfVector } from './iso/SpriteUnits';
import {
  BASE_H, BASE_W, type Ctx2D, Motes, PAL, Typewriter, type UiButton, button, campfire, canvasTexture, enter, goto, label, panel, seeded, tiledImage,
} from './ui/Kit';
import { MOODS, backdrop } from './fx/Backdrops';
import {
  Birds, DriftLayer, LightRays, ParallaxLayer, clouds, css, ditherGradient, glow, ground, haze, line, mix, poly, rimLight, ruins, stars, sun, vignette,
} from './fx/Painter';

// Wprowadzenie do świata (port Oldgame/src/scenes/intro.js): 6 animowanych plansz + narracja pisana "na maszynie".
// Dioramy Three.js zastąpione pixel-artowymi scenkami 2D: tło malowane raz na płótnie, ruchome elementy jako obiekty.
//
// Animacje liczone jak w porcie na A1200 (core/frontend/fx.ts): czas planszy w Q8 ticków 50 Hz (`tq`), fale z SIN_LUT,
// postęp / narastanie w Q12. Na piksele zamieniamy dopiero przy rysowaniu (`/ Q8`, `/ Q12`). Tła są statyczną grafiką
// (w porcie: obrazki), więc ich malowanie może zostać na płótnie 2D; w profilu Amiga idą jako kafle <= 256 px.

/** `tq` - czas planszy w Q8 ticków, `dt` - czas klatki w sekundach (dla Motes). */
type Updater = (tq: number, dt: number) => void;

/** Ticki Q8 na sekundę (do przeliczania stałych "na sekundę"). */
const SEC = secToQ8(1);
/** round(a / b) dla b > 0, na liczbach całkowitych. */
const rdiv = (a: number, b: number): number => (a >= 0 ? idiv(a + (b >> 1), b) : -idiv(-a + (b >> 1), b));

/** Szabrownicy na planszy 3: szablon wroga z gotową postacią PixelLab i położenie względem ogniska (piksele projektowe). */
const RAIDERS: readonly (readonly [string, number, number])[] = [
  ['raider_chief', 6, -8], ['raider_sniper', -112, 2], ['raider_gunner', -70, -4], ['raider_thug', -48, 12],
  ['raider_psycho', 58, 12], ['raider_burner', 96, -2],
];
/** Mieszkańcy Przystani na planszy 5 (id rekrutów). */
const HAVEN = ['plesn', 'iskra', 'mur', 'zgrzyt', 'szept'] as const;

const D_FLASH = 20;
const D_UI = 30;

export class IntroScene extends Phaser.Scene {
  /** Przebieg plansz (core/frontend/flow.ts): pisanie -> czekanie -> wygaszenie, w tickach 50 Hz. */
  private flow = new IntroFlow(INTRO_SLIDES.length);
  private clock = new TickClock();
  /** Czas bieżącej planszy (animacje). */
  private anim = new TickClock();
  private slideObjects: Phaser.GameObjects.GameObject[] = [];
  private updaters: Updater[] = [];
  /** Tekstury tła bieżącej planszy (z kaflami) - zwalniane przy zmianie planszy, jak w porcie z ograniczoną pamięcią tekstur. */
  private bgKeys: string[] = [];
  private tw: Typewriter | null = null;
  private text!: PixelText;
  private dots!: PixelText;
  private flash!: Phaser.GameObjects.Rectangle;
  private next!: UiButton;
  private boomed = false;

  /** Plansza startowa (1..N) ze skrótu ?scene=IntroScene&slide=N (Oldgame/src/scenes/intro.js:208). */
  private startSlide = 0;

  constructor() {
    super('IntroScene');
  }

  init(data: { slide?: number }): void {
    const n = Math.floor(Number(data?.slide) || 0);
    this.startSlide = n >= 1 && n <= INTRO_SLIDES.length ? n - 1 : 0;
  }

  create(): void {
    enter(this, 700);
    this.cameras.main.setBackgroundColor(0x000000);
    this.slideObjects = [];
    this.updaters = [];
    this.flow = new IntroFlow(INTRO_SLIDES.length);
    this.clock.reset();

    this.flash = this.add.rectangle(0, 0, BASE_W, BASE_H, 0xffffff, 1).setOrigin(0).setAlpha(0).setDepth(D_FLASH);
    panel(this, 38, 204, 404, 54, PAL.edge, 0.87).setDepth(D_UI);
    this.text = label(this, 46, 209, '', { size: 8, wrap: 316, lineSpacing: 2 }).setDepth(D_UI + 1);
    this.next = button(this, 376, 222, 'Dalej ▶', () => this.advance(), { primary: true, w: 58 });
    this.next.box.setDepth(D_UI + 1);
    this.dots = label(this, BASE_W / 2, 264, '', { size: 5, color: PAL.dim }).setOrigin(0.5).setDepth(D_UI + 1);
    button(this, BASE_W - 84, 6, 'Pomiń intro ▶▶', () => this.finish(), { w: 78, size: 6 }).box.setDepth(D_UI + 1);

    this.input.on('pointerdown', () => this.advance());
    const kb = this.input.keyboard;
    kb?.on('keydown-ESC', () => this.finish());
    for (const k of ['ENTER', 'SPACE', 'RIGHT']) kb?.on(`keydown-${k}`, () => this.advance());

    const first = this.startSlide;
    this.startSlide = 0;
    this.flow.index = first;
    this.show(first);
    if (first) this.tw?.finish();
    SoundManager.music('intro');
  }

  private show(n: number): void {
    for (const o of this.slideObjects) o.destroy();
    this.slideObjects = [];
    for (const k of this.bgKeys) if (this.textures.exists(k)) this.textures.remove(k);
    this.bgKeys = [];
    this.updaters = [];
    this.anim.reset();
    this.boomed = false;
    this.flash.setAlpha(0);

    const before = new Set(this.children.list);
    this.build(INTRO_SLIDES[n].id);
    this.slideObjects = this.children.list.filter((o) => !before.has(o));
    for (const u of this.updaters) u(0, 0);

    this.tw = new Typewriter(this.text, INTRO_SLIDES[n].text, 34);
    this.dots.setText(INTRO_SLIDES.map((_, k) => (k === n ? '◆' : '◇')).join('  '));
  }

  /** Klik / Enter / spacja / strzałka: dopisz tekst albo przejdź dalej. */
  private advance(): void {
    if (this.data.get('leaving')) return;
    this.act(this.flow.press(this.tw?.done ?? true));
  }

  /** Esc / "Pomiń intro". */
  private finish(): void {
    if (this.data.get('leaving')) return;
    this.act(this.flow.skip());
  }

  private act(a: IntroAction): void {
    const cam = this.cameras.main;
    switch (a) {
      case IntroAction.SKIP_TEXT:
        this.tw?.finish();
        return;
      case IntroAction.FADE_OUT:
        cam.fadeOut(450, 0, 0, 0);
        return;
      case IntroAction.SHOW:
        this.show(this.flow.index);
        cam.fadeIn(650, 0, 0, 0);
        return;
      case IntroAction.FINISH:
        goto(this, 'TitleScene');
        return;
    }
  }

  update(_time: number, delta: number): void {
    const dt = Math.min(delta / 1000, 0.1);
    this.anim.advance(delta, 10);
    this.tw?.update(dt);
    for (const u of this.updaters) u(this.anim.timeQ8, dt);
    if (this.data.get('leaving')) return;
    for (let n = this.clock.advance(delta); n > 0 && !this.data.get('leaving'); n--) this.act(this.flow.tick(this.tw?.done ?? true));
  }

  // ================================================================== plansze

  /** Tło planszy (malowane raz); (ox, oy) - punkt zaczepienia skali. */
  private bg(key: string, draw: (g: Ctx2D, w: number, h: number) => void, ox = 0, oy = 0): Phaser.GameObjects.Container {
    const box = tiledImage(this, canvasTexture(this, key, BASE_W, BASE_H, draw), 0, 0, ox, oy).setDepth(0);
    this.bgKeys.push(key, ...box.list.map((o) => (o as Phaser.GameObjects.Image).texture.key).filter((k) => k !== key));
    return box;
  }

  private build(id: IntroSlideId): void {
    switch (id) {
      case 'bomb': return this.buildBomb();
      case 'ruins': return this.buildRuins();
      case 'raiders': return this.buildRaiders();
      case 'nomads': return this.buildNomads();
      case 'haven': return this.buildHaven();
      case 'crew': return this.buildCrew();
    }
  }

  /** 1 - rakiety, błysk i grzyb atomowy nad miastem, które fala uderzeniowa zamienia w ruiny (fx/NukeArt.ts). */
  private buildBomb(): void {
    const BOOM = secToQ8(2.6), FLIGHT = secToQ8(2.2);
    const blast = new NukeBlast(this, 'intro_bomb_fx', 262, 198);
    // obraz minimalnie powiększony wokół środka - wstrząs kamery nie odsłania czarnych krawędzi
    blast.image.setDepth(0).setOrigin(0.5).setPosition(BASE_W / 2, BASE_H / 2).setScale(1.03);
    this.bgKeys.push('intro_bomb_fx');

    // przed uderzeniem: reflektory obrony przeciwlotniczej przeczesują niebo, migają światła na masztach
    const beams = this.add.graphics().setDepth(1).setBlendMode(Phaser.BlendModes.ADD);
    const SPOTS = [[96, 196, -1.9, 0.9], [214, 198, -1.45, 1.3], [352, 197, -1.2, 0.7], [430, 196, -1.7, 1.1]] as const;
    const blinkers = [[121, 113], [236, 104], [288, 98], [417, 98], [440, 106]].map(([x, y]) => this.add.rectangle(x, y, 1, 1, 0xff3020).setDepth(1));

    // rakiety: jasna głowica z płomieniem silnika, za nią smuga dymu, która rośnie i blednie
    const trail = this.add.graphics().setDepth(2);
    const heads = this.add.graphics().setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
    const missiles = [0, 1, 2].map((i) => ({ sx: 430 - i * 74, sy: -24 - i * 22, ex: 196 + i * 58, ey: 192, d: secToQ8(0.12 + i * 0.09) }));
    const disc = (g: Phaser.GameObjects.Graphics, x: number, y: number, r: number): void => {
      const R = Math.max(0, Math.round(r));
      x = Math.round(x);
      y = Math.round(y);
      if (!R) return void g.fillRect(x, y, 1, 1);
      for (let dy = -R; dy <= R; dy++) {
        const w = Math.round(Math.sqrt(R * R - dy * dy + R * 0.6));
        g.fillRect(x - w, y + dy, w * 2 + 1, 1);
      }
    };

    // po wybuchu: nadciągająca kopuła dymu i popiół
    this.tex('intro_bomb_pall', BASE_W, 110, (g, w, h) => {
      const r = seeded(17);
      const list: [number, number, number, number][] = Array.from({ length: 9 }, (_, i) => [((i + r() * 0.5) / 9) * w, 18 + r() * 60, 90 + r() * 110, 10 + r() * 10]);
      clouds(g, w, h, r, list, { tones: ['#a05a40', '#5a3434', '#2e1c24', '#160c14'], light: 0, wrap: true });
    });
    const pall = new DriftLayer(this, 'intro_bomb_pall', BASE_W, -5, 1, -110, 0.9);
    const ash = new Motes(this, 110, { x: 0, y: 0, w: BASE_W, h: 200 }, 0x9a8070, 4, 10, 1, 0.5);
    this.updaters.push((tq, dt) => {
      const t = tq / SEC;
      // reflektory i światła masztów (gasną w chwili błysku)
      beams.clear();
      const pre = tq < BOOM;
      for (const [x, y, a0, sp] of SPOTS) {
        if (!pre) break;
        const a = a0 + Math.sin(t * sp + x) * 0.35, L = 240, wd = 0.045;
        beams.fillStyle(0xd8e0ff, 0.07).fillTriangle(x, y, x + Math.cos(a - wd) * L, y + Math.sin(a - wd) * L, x + Math.cos(a + wd) * L, y + Math.sin(a + wd) * L);
        beams.fillStyle(0xd8e0ff, 0.06).fillTriangle(x, y, x + Math.cos(a - wd * 0.35) * L, y + Math.sin(a - wd * 0.35) * L, x + Math.cos(a + wd * 0.35) * L, y + Math.sin(a + wd * 0.35) * L);
      }
      blinkers.forEach((b, i) => b.setVisible(pre && Math.floor(t * 1.4 + i * 0.37) % 2 === 0));

      trail.clear();
      heads.clear();
      for (const m of missiles) {
        const u = progressQ12(tq, m.d, FLIGHT);
        if (u <= 0) continue;
        const live = u < Q12 && pre;
        const dx = m.ex - m.sx, dy = m.ey - m.sy;
        const hx = lerpQ12(m.sx, m.ex, u), hy = lerpQ12(m.sy, m.ey, u);
        // dym: kłęby wzdłuż toru, starsze (dalej od głowicy) większe i bledsze; po wybuchu smugi znikają w błysku
        if (pre) {
          const n = Math.floor((u / Q12) * 40);
          for (let j = n; j >= 0; j--) {
            const uu = j / 40, age = u / Q12 - uu;
            const x = m.sx + dx * uu + Math.sin(j * 1.7 + t) * age * 6, y = m.sy + dy * uu;
            const al = Math.max(0, 0.75 - age * 0.9);
            if (al <= 0.02) continue;
            const hot = age < 0.04;
            trail.fillStyle(hot ? 0xffb060 : age < 0.1 ? 0xb09080 : 0x6a5a66, al);
            disc(trail, x, y, 0.6 + age * 7);
          }
        }
        if (!live) continue;
        // głowica + migotliwy płomień silnika (addytywnie)
        const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
        const fl = 3 + Math.sin(t * 60 + m.sx) * 1.2;
        heads.fillStyle(0xff8a30, 0.5);
        disc(heads, hx - ux * 3, hy - uy * 3, 3);
        heads.fillStyle(0xffd080, 0.9);
        for (let k = 1; k <= fl; k++) heads.fillRect(Math.round(hx - ux * k), Math.round(hy - uy * k), 1, 1);
        heads.fillStyle(0xffffff, 1).fillRect(Math.round(hx), Math.round(hy), 2, 2);
      }

      const k = tq - BOOM;
      blast.render(k / SEC);
      // czysta biel przez ~0.1 s (kilka klatek), dalej błysk rysuje już NukeBlast (sylwetki, gasnąca poświata)
      this.flash.setAlpha(k > 0 && k < secToQ8(0.1) ? 1 : 0);
      ash.update(k > secToQ8(3) ? dt : 0);
      if (k > secToQ8(3)) {
        pall.update(dt);
        // całun dymu powoli schodzi z góry nad miasto
        const v = Math.min(1, (k - secToQ8(3)) / secToQ8(6));
        pall.setY(-110 + v * 110);
      }
      if (k > 0 && !this.boomed) {
        this.boomed = true;
        SoundManager.sfx('explosion');
        this.cameras.main.shake(1600, 0.005);
      }
    });
  }

  /** 2 - zrujnowane miasto w zielonej mgle: ulica w perspektywie, ślepia w cieniu, opadający popiół. */
  private buildRuins(): void {
    const VX = 240, VY = 128, F = 46;
    const img = this.bg('intro_ruins', (g) => paintRuinStreet(g, VX, VY, F), VX, VY);
    const rnd = seeded(22); // rozstawienie (statyczne)
    const ph = new IntRng(22); // fazy migania (logika)
    const eyes = Array.from({ length: 7 }, (_, i) => {
      const side = rnd() > 0.5 ? 1 : -1, z = 2 + i * 1.1 + rnd();
      const x = VX + (side * (3 + rnd() * 2.5) * F) / z, y = VY + ((1.4 - rnd() * 1.2) * F) / z;
      const col = i % 2 ? 0xff3a20 : 0xb8ff40;
      const gap = Math.max(2, Math.round(8 / z));
      return { a: this.add.rectangle(x - gap / 2, y, 1, 1, col).setDepth(2), b: this.add.rectangle(x + gap / 2, y, 1, 1, col).setDepth(2), ph: ph.below(256) };
    });
    const ash = new Motes(this, 140, { x: 0, y: 0, w: BASE_W, h: BASE_H }, 0xb0c0a0, 3, 9, 2, 0.6);
    // ciężka, toksyczna mgła snująca się nisko nad ulicą (dwie warstwy w przeciwnych kierunkach) i krążące kruki
    const fogTex = (key: string, seed: number): string => this.tex(key, BASE_W, 90, (g, w, h) => {
      const r = seeded(seed);
      const list: [number, number, number, number][] = Array.from({ length: 7 }, () => [r() * w, 30 + r() * 50, 90 + r() * 120, 8 + r() * 8]);
      clouds(g, w, h, r, list, { tones: ['#b8d890', '#7a9a68', '#4a6448', '#2a3a2c'], light: 0, wrap: true });
    });
    const fog1 = new DriftLayer(this, fogTex('intro_ruins_fog1', 23), BASE_W, 4, 3, 150, 0.32);
    const fog2 = new DriftLayer(this, fogTex('intro_ruins_fog2', 24), BASE_W, -2.5, 3, 172, 0.22);
    const crows = new Birds(this, 4, { x: 0, y: 30, w: BASE_W, h: 40 }, 0x0a100c, 2, 7, -1);
    const W_SWAY = angQ8(0.25), W_EYE = angQ8(1.5), W_BLINK = angQ8(7), ZOOM_END = 14 * SEC;
    this.updaters.push((tq, dt) => {
      // powolny marsz w głąb ulicy: skala 1 + 0.012/s (do 14 s), kołysanie ±3 px
      img.setScale((Q12 + idiv(Math.min(tq, ZOOM_END) * 49, SEC)) / Q12);
      img.x = VX + (wave(tq, W_SWAY) * 3) / 16384;
      for (const e of eyes) {
        const vis = wave(tq, W_EYE, e.ph) > -11469 && wave(tq, W_BLINK, e.ph) > -15565; // sin > -0.7 i > -0.95
        e.a.setVisible(vis);
        e.b.setVisible(vis);
      }
      ash.update(dt);
      fog1.update(dt);
      fog2.update(dt);
      crows.update(tq / SEC, dt);
    });
  }

  /** Tekstura planszy (zwalniana przy zmianie planszy). */
  private tex(key: string, w: number, h: number, draw: (g: Ctx2D, w: number, h: number) => void): string {
    this.bgKeys.push(key);
    return canvasTexture(this, key, w, h, draw);
  }

  /** Powolny "najazd kamery" po warstwach paralaksy: przesunięcie w px dla czasu planszy (s). */
  private static pan(t: number, from: number, to: number, dur = 16): number {
    const u = Math.min(1, t / dur);
    return from + (to - from) * (u * u * (3 - 2 * u));
  }

  /** 3 - szabrownicy przy ognisku pod flagą z czaszką: obóz za barykadą ze złomu, wszystko oświetlone ogniem. */
  private buildRaiders(): void {
    const FX = 240, FY = 184, M = 20;
    this.tex('intro_raiders_sky', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      ditherGradient(g, 0, 0, w, h, [[0, '#04030a'], [0.3, '#0e0818'], [0.5, '#22101e'], [0.6, '#4a1a1c'], [0.66, '#6a2618']], 20);
      stars(g, w, h * 0.45, seeded(41), 140, '#d8d0ff');
      sun(g, 96 + M, 46, 9, { core: '#f0e8d0', rim: '#b8b0a0', halo: '#8a7aa0', bands: null, haloA: 0.2, haloR: 30 });
      // łuna nad obozem
      glow(g, FX + M, 160, 190, 70, '#ff6a2a', 0.35, { levels: 6, pow: 1.4 });
    });
    const sky = new ParallaxLayer(this, 'intro_raiders_sky', 0.1, M, 0);
    this.tex('intro_raiders_smoke', BASE_W, 120, (g, w, h) => {
      clouds(g, w, h, seeded(42), [[60, 40, 160, 12], [300, 26, 200, 10], [420, 70, 140, 9], [180, 84, 120, 8]], { tones: ['#a04a30', '#5a2a24', '#2e161a', '#160c12'], light: 0, wrap: true });
    });
    const smoke = new DriftLayer(this, 'intro_raiders_smoke', BASE_W, -3, 0, 0, 0.85);
    this.tex('intro_raiders_far', BASE_W + 2 * M, BASE_H, (g, w) => {
      ruins(g, seeded(43), { base: 158, n: 34, hMin: 10, hMax: 52, wMin: 8, wMax: 22, body: '#160c16', side: '#100810', rim: '#4a1a1c', win: '#0c060c', lit: '#ff8a3a', litChance: 0.015, detail: 0.6, x0: 0, x1: w, light: 1 });
      haze(g, 0, 120, w, 40, '#5a1c1a', 0.05, 0.55);
    });
    const far = new ParallaxLayer(this, 'intro_raiders_far', 0.3, M, 0);
    // barykada ze złomu, namioty, beczki, kolce z czaszkami - jedna warstwa, potem obwódka od ognia
    this.tex('intro_raiders_camp', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      const r = seeded(44), ox = M;
      ground(g, w, h, 160, { crest: '#3a2418', body: '#22140e', deep: '#0c0605', amp: 2, freq: 0.025, seed: 6, debris: 0.3, rnd: r });
      // barykada: blachy, opony, wraki, pale z kolcami
      for (let x = 0; x < w; x += 6 + Math.floor(r() * 10)) {
        if (Math.abs(x - ox - FX) < 70) continue; // przejście za ogniskiem
        const hh = 8 + Math.floor(r() * 14), ww = 5 + Math.floor(r() * 12);
        poly(g, [[x, 164], [x + 1, 164 - hh], [x + ww * 0.6, 164 - hh - r() * 4], [x + ww, 164 - hh * 0.6], [x + ww, 164]], '#120a0c');
        if (r() < 0.4) { g.fillStyle = '#0a0608'; g.fillRect(x + 2, 164 - hh - 6, 1, 6); g.fillRect(x + 1, 164 - hh - 6, 3, 1); }
        if (r() < 0.25) { g.fillStyle = '#0e0809'; g.beginPath(); g.ellipse(x + 4, 162, 5, 3, 0, 0, Math.PI * 2); g.fill(); }
      }
      // pale z czaszkami
      for (const x of [ox + 120, ox + 360, ox + 30, ox + 452]) {
        g.fillStyle = '#140a0a';
        g.fillRect(x, 140, 2, 26);
        g.fillStyle = '#d8ccb0';
        g.fillRect(x - 1, 136, 4, 4);
        g.fillStyle = '#140a0a';
        g.fillRect(x, 137, 1, 1);
        g.fillRect(x + 2, 137, 1, 1);
      }
      // namioty: strona od ognia oświetlona, druga w cieniu, szwy i wejście
      for (const [x, y, s] of [[ox + 96, 184, 30], [ox + 390, 182, 26], [ox + 304, 168, 18], [ox + 166, 170, 16]] as const) {
        const lit = x - ox < FX;
        poly(g, [[x - s, y], [x, y - s * 0.9], [x, y]], lit ? '#2a1a14' : '#7a4428');
        poly(g, [[x, y], [x, y - s * 0.9], [x + s, y]], lit ? '#8a5030' : '#2a1a14');
        g.fillStyle = '#0c0606';
        poly(g, [[x - s * 0.22, y], [x, y - s * 0.5], [x + s * 0.22, y]], '#0c0606');
        line(g, x, y - s * 0.9, x, y - s * 0.9 - 4, '#1a0e0a');
        for (let k = 1; k < 3; k++) line(g, x + (lit ? 1 : -1) * k * s * 0.3, y, x, y - s * 0.9, lit ? '#6a3c24' : '#5a3020');
      }
      // wrak pikapa po lewej, beczki po prawej
      g.fillStyle = '#100808';
      g.fillRect(ox + 16, 176, 48, 10);
      g.fillRect(ox + 40, 166, 20, 11);
      g.fillStyle = '#060304';
      g.fillRect(ox + 22, 184, 9, 5);
      g.fillRect(ox + 50, 184, 9, 5);
      for (const [x, y] of [[ox + 340, 192], [ox + 350, 194], [ox + 330, 196]] as const) {
        g.fillStyle = '#1a0e0a';
        g.fillRect(x, y - 11, 8, 11);
        g.fillStyle = '#0c0606';
        g.fillRect(x, y - 8, 8, 1);
        g.fillRect(x, y - 4, 8, 1);
      }
      // krąg kamieni wokół ogniska
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        g.fillStyle = k % 2 ? '#2a1a12' : '#3a2418';
        g.fillRect(Math.round(ox + FX + Math.cos(a) * 12) - 1, Math.round(FY + 1 + Math.sin(a) * 3), 3, 2);
      }
      rimLight(g, ox + FX, FY - 6, '#ff9a4a', 230, 0.95, 2);
      glow(g, ox + FX, FY + 2, 120, 26, '#ff7a30', 0.32, { levels: 5 });
      vignette(g, w, h, '#000000', 0.6, 0.45);
    });
    const camp = new ParallaxLayer(this, 'intro_raiders_camp', 0.55, M, 1);
    // pulsująca łuna ognia (addytywnie)
    const fireGlow = this.add.image(FX, FY - 10, this.tex('intro_raiders_glow', 200, 100, (g) => glow(g, 100, 50, 100, 50, '#ff7a30', 0.5, { levels: 6 }))).setDepth(2).setBlendMode(Phaser.BlendModes.ADD);
    const flag = this.add.graphics().setDepth(2);
    const SKULL = ['..#####..', '.#######.', '.#.###.#.', '.#######.', '..##.##..', '..#####..', '...#.#...'];
    const pole = this.add.rectangle(150, 98, 2, 86, 0x2a1810).setOrigin(0).setDepth(2);
    const poleRim = this.add.rectangle(151, 98, 1, 86, 0xc06a3a).setOrigin(0).setDepth(2);
    const fire = campfire(this, FX, FY, 2.2, 4);
    // szabrownicy z PixelLab (src/assets/units/raider_*/): Kostucha za ogniskiem, banda półkolem wokół
    const members = RAIDERS.map(([tid, dx, dy], i) => {
      const x = FX + dx, y = FY + dy;
      const name = `intro_${tid}`;
      const s = addUnit(this, x, y, name, enemyUnitLook(tid), 'idle', 2);
      // twarzą do ogniska, lekko ku widzowi (obrót z 8 kierunków; bez sprite'a: przód odbity w lewo)
      const dir = dirOfVector(-dx, 16);
      if (this.anims.exists(`${name}_${dir}_idle`)) s.play({ key: `${name}_${dir}_idle`, startFrame: i % 4 });
      else s.setFlipX(dx > 0);
      s.setDepth(dy < 4 ? 3 : 5);
      return s;
    });
    const shadows = members.map((m) => this.add.ellipse(m.x + (m.x - FX) * 0.25, m.y + 1, 22, 4, 0x000000, 0.45).setDepth(2.5));
    const sparks = new Motes(this, 46, { x: FX - 20, y: 100, w: 40, h: 80 }, 0xffb050, 2, -26, 3, 0.95, 6);
    const ash = new Motes(this, 40, { x: 0, y: 0, w: BASE_W, h: 200 }, 0x8a6a60, 6, 6, 11, 0.4, 6);
    const W_FLICK = angQ8(11), W_FLAG = angQ8(4);
    this.updaters.push((tq, dt) => {
      const t = tq / SEC;
      const p = IntroScene.pan(t, -14, 14, 18);
      sky.set(p);
      far.set(p);
      camp.set(p);
      smoke.update(dt);
      fire(t);
      sparks.update(dt);
      ash.update(dt);
      const flick = 210 + ((wave(tq, W_FLICK) * 46) >> 14); // 0.82 ± 0.18 w Q8
      fireGlow.setAlpha(0.55 + (flick - 210) / 120 + Math.sin(t * 23) * 0.06).setScale(1 + (flick - 210) / 900);
      for (const m of members) m.setTint(Phaser.Display.Color.GetColor((255 * flick) >> 8, (175 * flick) >> 8, (130 * flick) >> 8));
      shadows.forEach((sh, i) => sh.setScale(1 + (flick - 210) / 300, 1).setX(members[i].x + (members[i].x - FX) * 0.25));
      const px = Math.round(p * 0.55);
      pole.x = 150 - px;
      poleRim.x = 151 - px;
      flag.clear();
      for (let x = 0; x < 34; x++) {
        const dy = rdiv(wave(tq, W_FLAG, (x * 57) >> 2) * 22 * x, 16384 * 10 * 34); // sin(4t + 0.35x) * 2.2 * x/34
        const slope = wave(tq, W_FLAG, ((x + 1) * 57) >> 2) - wave(tq, W_FLAG, (x * 57) >> 2);
        const col = slope > 600 ? 0x8a2018 : slope < -600 ? 0x3a0808 : 0x5e1210; // fałdy: jaśniej / ciemniej
        flag.fillStyle(col, 1).fillRect(152 + x - px, 100 + dy, 1, 22);
        flag.fillStyle(0x1a0404, 1).fillRect(152 + x - px, 121 + dy, 1, 1);
        if (x > 26 && (x * 7) % 5 === 0) flag.fillStyle(0x000000, 1).fillRect(152 + x - px, 118 + dy - (x % 3), 1, 4); // postrzępiony brzeg
        const sx = x - 12;
        if (sx >= 0 && sx < 9) SKULL.forEach((row, sy) => row[sx] === '#' && flag.fillStyle(slope < -600 ? 0xa89c84 : 0xe8dcc0, 1).fillRect(152 + x - px, 106 + sy + dy, 1, 1));
      }
    });
  }

  /** 4 - karawana nomadów na wydmach o zachodzie słońca: sylwetki pod światło, długie cienie, warstwy wydm. */
  private buildNomads(): void {
    const M = 30, SX = 150, SY = 128;
    this.tex('intro_nomads_sky', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      ditherGradient(g, 0, 0, w, h, [[0, '#24183e'], [0.22, '#5a2c52'], [0.4, '#b8503a'], [0.52, '#ea8a44'], [0.6, '#f8c070'], [0.7, '#ffe2a0']], 22);
      stars(g, w, h * 0.22, seeded(51), 30);
      sun(g, SX + M, SY, 26, { core: '#fff6d0', rim: '#ffd88a', halo: '#ffb060', bands: '#f2a058', haloA: 0.55, haloR: 120 });
    });
    const sky = new ParallaxLayer(this, 'intro_nomads_sky', 0.05, M, 0);
    this.tex('intro_nomads_clouds', BASE_W, 120, (g, w, h) => {
      clouds(g, w, h, seeded(52), [[40, 30, 180, 8], [260, 48, 220, 9], [420, 20, 120, 6], [150, 84, 160, 6], [350, 96, 140, 5]], { tones: ['#ffe0a0', '#f09a62', '#b45a58', '#6a3450'], light: -1, wrap: true });
    });
    const cl = new DriftLayer(this, 'intro_nomads_clouds', BASE_W, 1.6, 0, 0, 0.92);
    const rays = new LightRays(this, SX, SY, 10, 0xffd090, -Math.PI * 0.98, -Math.PI * 0.02, 380, 0, 0.032, 4);
    // płaskowyże w oddali i wydmy w trzech planach (jaśniejsze grzbiety od słońca)
    this.tex('intro_nomads_far', BASE_W + 2 * M, BASE_H, (g, w) => {
      const mesa = (x: number, wd: number, ht: number, base: number): void => {
        const r = seeded(x);
        // zbocza z piargiem, płaski szczyt, warstwy skał; lewa strona od słońca jaśniejsza
        poly(g, [[x - 10, base], [x + 6, base - ht], [x + wd - 8, base - ht], [x + wd + 12, base]], '#9a4c46');
        poly(g, [[x - 10, base], [x + 6, base - ht], [x + 10, base - ht], [x - 2, base]], '#d07a5c');
        for (let k = 0; k < 4; k++) {
          const y = base - ht + 3 + k * Math.round(ht / 5);
          g.fillStyle = css(k % 2 ? '#8a4442' : '#b0605a');
          g.fillRect(x + 6 - Math.round(k * 2.5), y, wd - 12 + k * 5, 1);
        }
        g.fillStyle = css('#e89070');
        g.fillRect(x + 6, base - ht, wd - 14, 1);
        for (let k = 0; k < 8; k++) { g.fillStyle = css('#7a3a3a'); g.fillRect(x + Math.floor(r() * wd), base - Math.floor(r() * ht * 0.5), 1, 2 + Math.floor(r() * 3)); }
      };
      mesa(M + 260, 70, 22, 160);
      mesa(M + 340, 40, 30, 160);
      mesa(M - 20, 60, 16, 160);
      haze(g, 0, 128, w, 34, '#f0a060', 0.15, 0.55);
    });
    const far = new ParallaxLayer(this, 'intro_nomads_far', 0.15, M, 0);
    this.tex('intro_nomads_dunes', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      const r = seeded(53);
      ground(g, w, h, 158, { crest: '#f8c080', body: '#c4743c', deep: '#a0582e', amp: 6, freq: 0.013, seed: 1, debris: 0, rnd: r });
      ground(g, w, h, 174, { crest: '#f0a868', body: '#a45a30', deep: '#7a3e22', amp: 5, freq: 0.02, seed: 3, debris: 0.05, rnd: r });
      glow(g, SX + M, 160, 140, 14, '#ffd090', 0.35, { levels: 5 });
    });
    const dunes1 = new ParallaxLayer(this, 'intro_nomads_dunes', 0.35, M, 0);
    this.tex('intro_nomads_near', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      const r = seeded(54);
      ground(g, w, h, 200, { crest: '#e09058', body: '#7a4024', deep: '#3a1c10', amp: 4, freq: 0.026, seed: 8, debris: 0.2, rnd: r });
      // szkielet ciężarówki zasypany piaskiem i kości w piasku
      poly(g, [[M + 380, 214], [M + 392, 196], [M + 440, 196], [M + 452, 214]], '#3a1c10');
      g.fillStyle = css('#e09058');
      g.fillRect(M + 392, 196, 48, 1);
      for (let k = 0; k < 5; k++) { g.fillStyle = css('#2a140a'); g.fillRect(M + 398 + k * 8, 198, 3, 12); }
      g.fillStyle = css('#e8d8b8');
      g.fillRect(M + 60, 224, 7, 2);
      g.fillRect(M + 58, 222, 2, 2);
      g.fillRect(M + 66, 226, 2, 2);
      vignette(g, w, h, '#1a0a10', 0.45, 0.6);
    });
    const near = new ParallaxLayer(this, 'intro_nomads_near', 1, M, 6);

    // karawana: sylwetki pod słońce z jasną obwódką od strony słońca (lewo-góra), długie cienie w prawo
    const BASE_Y = 199;
    const cg = this.add.graphics().setDepth(4);
    const SIL = 0x2a140e, RIM = 0xffc070, SH = 0x5a2a16;
    const slots: [('p' | 'b'), number, number][] = [['p', 0, 0], ['b', 30, 1], ['p', 60, 2], ['b', 96, 3], ['p', 126, 4], ['p', 146, 5], ['b', 176, 6]];
    /** Kształt jako lista prostokątów [x, y, w, h] względem stóp. */
    const person = (ph: number, kid: number): number[][] => {
      const s = Math.sin(ph), l1 = Math.round(s * 2), l2 = -l1;
      const r: number[][] = [
        [-2, -17, 4, 4], // głowa w turbanie
        [-3, -18, 6, 2],
        [-3, -13, 6, 8], // tułów w szacie
        [-4, -6, 8, 3], // poła szaty
        [-1 + l1, -3, 2, 3], // nogi
        [-1 + l2, -3, 2, 3],
        [3, -16, 1, 16], // kij
      ];
      if (kid % 2 === 0) r.push([-6, -14, 3, 6]); // juki na plecach
      if (kid % 3 === 1) r.push([-4, -20, 2, 3]); // lufa strzelby zza pleców
      return r;
    };
    const camel = (ph: number, loaded: boolean): number[][] => {
      const s = Math.sin(ph), c = Math.cos(ph);
      const leg = (x: number, a: number): number[][] => [[x + Math.round(a * 2), -12, 2, 7], [x + Math.round(a * 3), -5, 2, 5]];
      return [
        [-12, -22, 24, 10], // tułów
        [-10, -24, 20, 3],
        [-6, -28, 10, 5], // garb
        [12, -26, 4, 10], // szyja
        [13, -32, 4, 7],
        [15, -34, 8, 4], // łeb
        [21, -32, 3, 2],
        [-14, -20, 2, 7], // ogon
        ...leg(-10, s), ...leg(-7, -s), ...leg(7, c), ...leg(10, -c),
        ...(loaded ? [[-9, -33, 14, 6], [-11, -27, 3, 8], [6, -27, 3, 8]] : [[-5, -31, 8, 3]]),
      ];
    };
    const draw = (shape: number[][], x: number, y: number, flipX = false): void => {
      const fx = (rx: number, rw: number): number => (flipX ? x - rx - rw : x + rx);
      // cień: spłaszczony i wydłużony w prawo (słońce nisko po lewej)
      for (const [rx, ry, rw, rh] of shape) cg.fillStyle(SH, 0.35).fillRect(fx(rx, rw) - ry * 1.6, y - 1 + Math.round(ry * -0.08), rw + rh * 1.6, 1);
      for (const [rx, ry, rw, rh] of shape) cg.fillStyle(RIM, 1).fillRect(fx(rx, rw) - 1, y + ry - 1, rw, rh);
      for (const [rx, ry, rw, rh] of shape) cg.fillStyle(SIL, 1).fillRect(fx(rx, rw), y + ry, rw, rh);
    };
    const dust = new Motes(this, 110, { x: 0, y: 120, w: BASE_W, h: 110 }, 0xf8d090, 16, 1, 5, 0.5);
    const heat = new Motes(this, 40, { x: 0, y: 150, w: BASE_W, h: 40 }, 0xfff0c0, 4, -2, 9, 0.25, 1);
    this.updaters.push((tq, dt) => {
      const t = tq / SEC;
      const p = IntroScene.pan(t, -20, 20, 20);
      sky.set(p);
      far.set(p);
      dunes1.set(p);
      near.set(p);
      cl.update(dt);
      rays.update(t);
      dust.update(dt);
      heat.update(dt);
      cg.clear();
      const lead = 150 + t * 8 - p * 0.6;
      for (const [kind, off, i] of slots) {
        const x = Math.round(lead - off), ph = t * 5.2 + i * 1.3;
        const bob = Math.round(Math.abs(Math.sin(ph)) * 1);
        if (kind === 'p') draw(person(ph, i), x, BASE_Y - bob);
        else draw(camel(ph * 0.8, i !== 6), x, BASE_Y - bob);
      }
    });
  }

  /** 5 - światła Przystani: hala zajezdni z łukowym dachem, mur, wieże z reflektorami, dym, ogniska. */
  private buildHaven(): void {
    const M = 20;
    this.tex('intro_haven_sky', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      ditherGradient(g, 0, 0, w, h, [[0, '#02030a'], [0.35, '#0a1028'], [0.55, '#1c2240'], [0.7, '#3a3050'], [0.78, '#5a3a40']], 22);
      stars(g, w, h * 0.55, seeded(31), 260);
      sun(g, 380 + M, 40, 12, { core: '#f8f4e0', rim: '#d0ccb8', halo: '#8aa0d8', bands: null, haloA: 0.25, haloR: 50 });
      glow(g, 240 + M, 180, 200, 60, '#ff9a40', 0.25, { levels: 5 }); // łuna miasta nad murem
    });
    const sky = new ParallaxLayer(this, 'intro_haven_sky', 0.08, M, 0);
    this.tex('intro_haven_clouds', BASE_W, 110, (g, w, h) => {
      clouds(g, w, h, seeded(32), [[80, 30, 150, 8], [330, 50, 200, 9], [200, 86, 160, 7]], { tones: ['#b0b8d8', '#5a6490', '#2c3460', '#161c3a'], light: 1, wrap: true });
    });
    const cl = new DriftLayer(this, 'intro_haven_clouds', BASE_W, 2, 0, 0, 0.75);
    this.tex('intro_haven_far', BASE_W + 2 * M, BASE_H, (g, w) => {
      ruins(g, seeded(33), { base: 150, n: 34, hMin: 14, hMax: 64, wMin: 10, wMax: 24, body: '#10121e', side: '#0a0c16', rim: '#2a3050', win: '#080a12', lit: '#ffc860', litChance: 0.01, detail: 0.6, x0: 0, x1: w, light: 1 });
      haze(g, 0, 110, w, 40, '#3a3450', 0.05, 0.5);
    });
    const far = new ParallaxLayer(this, 'intro_haven_far', 0.25, M, 0);
    // twierdza: hala z łukowym dachem z blachy, okna z poświatą, brama, mur z blach i cegieł, wieże
    this.tex('intro_haven_fort', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      const ox = M, r = seeded(34);
      ground(g, w, h, 196, { crest: '#4a3a30', body: '#241c18', deep: '#0c0a0a', amp: 2, freq: 0.02, seed: 12, debris: 0.3, rnd: r });
      // hala: dach łukowy z żebrami
      for (let x = -108; x <= 108; x++) {
        const top = Math.round(150 - 34 * Math.sqrt(1 - (x / 108) ** 2));
        const lit = x > 40 ? 0.15 : x < -60 ? -0.2 : 0;
        g.fillStyle = css(mix('#4a3a34', x > 0 ? '#8a7060' : '#1e1818', Math.abs(lit) * 2 + 0.1));
        g.fillRect(ox + 240 + x, top, 1, 151 - top);
        if ((x + 108) % 9 === 0) { g.fillStyle = '#2a2220'; g.fillRect(ox + 240 + x, top, 1, 151 - top); }
        g.fillStyle = '#8a7a6a';
        g.fillRect(ox + 240 + x, top, 1, 1);
      }
      g.fillStyle = '#3a3532';
      g.fillRect(ox + 132, 150, 216, 46);
      for (let x = 132; x < 348; x += 12) { g.fillStyle = '#2a2624'; g.fillRect(ox + x, 150, 1, 46); }
      g.fillStyle = '#5a5048';
      g.fillRect(ox + 132, 150, 216, 1);
      // okna (wnęki + ciepłe światło + szprosy)
      for (let i = 0; i < 9; i++) if (i !== 4) {
        const x = ox + 142 + i * 22;
        glow(g, x + 5, 167, 12, 10, '#ffb050', 0.3, { levels: 3 });
        g.fillStyle = '#1a1210'; g.fillRect(x - 1, 159, 12, 16);
        g.fillStyle = '#ffc860'; g.fillRect(x, 160, 10, 14);
        g.fillStyle = '#fff0b0'; g.fillRect(x + 1, 161, 3, 5);
        g.fillStyle = '#5a3a20'; g.fillRect(x + 4, 160, 1, 14); g.fillRect(x, 166, 10, 1);
      }
      // komin
      g.fillStyle = '#2a2420'; g.fillRect(ox + 150, 118, 8, 22);
      g.fillStyle = '#4a3e36'; g.fillRect(ox + 150, 118, 8, 1);
      // brama hali z blaskiem
      glow(g, ox + 240, 182, 40, 22, '#ffa040', 0.5, { levels: 5 });
      g.fillStyle = '#ffa040'; g.fillRect(ox + 226, 164, 28, 32);
      g.fillStyle = '#ffd890'; g.fillRect(ox + 232, 170, 16, 26);
      // mur: blachy, cegły, blanki, brama
      for (let x = 60; x < 420; x += 1) {
        const plate = Math.floor((x - 60) / 14) % 3;
        g.fillStyle = plate === 0 ? '#3a342e' : plate === 1 ? '#332e2a' : '#403830';
        g.fillRect(ox + x, 178, 1, 24);
      }
      for (let y = 182; y < 202; y += 4) for (let x = 60 + ((y / 4) % 2) * 4; x < 420; x += 8) { g.fillStyle = '#28231f'; g.fillRect(ox + x, y, 1, 1); }
      for (let x = 60; x < 420; x += 10) { g.fillStyle = '#2a2622'; g.fillRect(ox + x, 174, 6, 4); g.fillStyle = '#5a5048'; g.fillRect(ox + x, 174, 6, 1); }
      g.fillStyle = '#5a5048'; g.fillRect(ox + 60, 178, 360, 1);
      g.fillStyle = '#120e0c'; g.fillRect(ox + 222, 182, 36, 20);
      glow(g, ox + 240, 196, 30, 10, '#ffa850', 0.45, { levels: 4 });
      // chorągwie na murze
      for (const x of [110, 196, 284, 370]) {
        g.fillStyle = '#7a1e18'; g.fillRect(ox + x, 180, 6, 12);
        g.fillStyle = '#c9a23a'; g.fillRect(ox + x + 2, 183, 2, 4);
        g.fillStyle = '#4a120e'; g.fillRect(ox + x, 191, 2, 2); g.fillRect(ox + x + 4, 191, 2, 2);
      }
      // wieże strażnicze z kratownicą
      for (const x of [78, 402]) {
        g.fillStyle = '#26221e'; g.fillRect(ox + x - 12, 118, 24, 84);
        for (let y = 124; y < 200; y += 10) { line(g, ox + x - 11, y, ox + x + 11, y + 9, '#1a1714'); line(g, ox + x + 11, y, ox + x - 11, y + 9, '#1a1714'); }
        g.fillStyle = '#3a3530'; g.fillRect(ox + x - 15, 112, 30, 6);
        g.fillStyle = '#5a5048'; g.fillRect(ox + x - 15, 112, 30, 1);
        g.fillStyle = '#2a2420'; g.fillRect(ox + x - 13, 100, 2, 12); g.fillRect(ox + x + 11, 100, 2, 12); g.fillRect(ox + x - 15, 98, 30, 3);
        g.fillStyle = '#fff0a0'; g.fillRect(ox + x - 4, 104, 8, 6);
      }
      rimLight(g, ox + 240, 190, '#ffb060', 200, 0.6, 1);
      vignette(g, w, h, '#000004', 0.55, 0.5);
    });
    const fort = new ParallaxLayer(this, 'intro_haven_fort', 0.5, M, 1);
    // reflektory z wież - wolno przeczesujące pustkowie snopy światła
    const beams = this.add.graphics().setDepth(1.5).setBlendMode(Phaser.BlendModes.ADD);
    const lamps = [78, 402].map((x) => this.add.ellipse(x, 107, 40, 26, 0xffe0a0, 0.25).setDepth(1.6).setBlendMode(Phaser.BlendModes.ADD));
    const fires = [campfire(this, 150, 206, 1.2, 4), campfire(this, 338, 208, 1.2, 4)];
    // mieszkańcy Przystani: postacie PixelLab rekrutów spoza pierwszej czwórki (ta jest na ostatniej planszy)
    HAVEN.forEach((id, i) => {
      const r = RECRUITS.find((k) => k.id === id)!;
      const s = addUnit(this, 176 + i * 32, 197 + (i % 2) * 4, `rec_${r.id}`, unitLookOf(r), 'idle', 1.5);
      s.setDepth(5 + (i % 2)).setFlipX(i > 2).setTint(0xd8c8b8);
    });
    const smoke = new Motes(this, 46, { x: 150, y: 70, w: 18, h: 50 }, 0x8a8a98, 4, -10, 5, 0.45, 1.2);
    const embers = new Motes(this, 30, { x: 0, y: 150, w: BASE_W, h: 70 }, 0xffb060, 3, -8, 8, 0.6, 6);
    this.updaters.push((tq, dt) => {
      const t = tq / SEC;
      const p = IntroScene.pan(t, 10, -10, 18);
      sky.set(p);
      far.set(p);
      fort.set(p);
      cl.update(dt);
      for (const f of fires) f(t);
      smoke.update(dt);
      embers.update(dt);
      const fx = Math.round(-p * 0.5);
      beams.clear();
      [78, 402].forEach((x, i) => {
        const a = -Math.PI / 2 + (i ? 0.55 : -0.55) + Math.sin(t * 0.35 + i * 2.1) * 0.5;
        const cx = x + fx, cy = 107, L = 300, wd = 0.07;
        beams.fillStyle(0xfff0c0, 0.09).fillTriangle(cx, cy, cx + Math.cos(a - wd) * L, cy + Math.sin(a - wd) * L, cx + Math.cos(a + wd) * L, cy + Math.sin(a + wd) * L);
        beams.fillStyle(0xfff0c0, 0.08).fillTriangle(cx, cy, cx + Math.cos(a - wd * 0.4) * L, cy + Math.sin(a - wd * 0.4) * L, cx + Math.cos(a + wd * 0.4) * L, cy + Math.sin(a + wd * 0.4) * L);
        lamps[i].setX(cx).setAlpha(0.2 + Math.sin(t * 3 + i) * 0.05);
      });
    });
  }

  /** 6 - najemnicy na tle zachodzącego słońca: warstwowe ruiny, chmury, promienie, kruki. */
  private buildCrew(): void {
    const upd = backdrop(this, 'intro_crew', { mood: MOODS.dusk, seed: 40, orb: [240, 148, 40], farBase: 186, midBase: 192, midH: [12, 64], groundY: 190, pan: 10 });
    for (const k of ['sky', 'clouds', 'far', 'mid', 'ground']) this.bgKeys.push(`intro_crew_${k}`);
    RECRUITS.slice(0, 4).forEach((r, i) => {
      const s = addUnit(this, 150 + i * 60, 204, `rec_${r.id}`, unitLookOf(r), 'idle', 3).setDepth(4).setFlipX(i > 1);
      s.setTint(0xffe0c8);
      this.add.ellipse(150 + i * 60 + (150 + i * 60 - 240) * 0.08, 205, 44, 8, 0x000000, 0.4).setDepth(3);
    });
    const dust = new Motes(this, 110, { x: 0, y: 110, w: BASE_W, h: 110 }, 0xffc070, 12, 1, 17, 0.55, 6);
    this.updaters.push((tq, dt) => {
      upd(tq / SEC, dt);
      dust.update(dt);
    });
  }
}
