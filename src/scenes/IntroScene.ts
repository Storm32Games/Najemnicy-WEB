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
import { dirOfVector, spriteStripKey, spriteTexKey } from './iso/SpriteUnits';
import {
  BASE_H, BASE_W, type Ctx2D, Motes, PAL, Typewriter, type UiButton, button, campfire, canvasTexture, enter, goto, label, panel, seeded, tiledImage,
} from './ui/Kit';
import { MOODS, backdrop } from './fx/Backdrops';
import { paintDepot } from './fx/HavenArt';
import {
  Circlers, FAUNA_PAL, FOLIAGE, SPRITES, Tumbleweed, Walker, burntTree, bush, cactus, dryShrub, glowShrooms, grass, leafyTree, pixelFrames, skeleton,
} from './fx/Nature';
import {
  Birds, DriftLayer, deadTree, LightRays, streaks, Windows, ParallaxLayer, clouds, css, ditherGradient, glow, ground, haze, line, poly, rimLight, ruins, stars, sun, vignette,
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

    // pierwszy plan: park z drzewami nad brzegiem (przed wybuchem liście pod zmierzch, po fali - spalone kikuty)
    const parkSpots = [18, 44, 70, 118, 150, 300, 334, 372, 404, 446, 470];
    const park = this.add.image(0, 0, this.tex('intro_bomb_park', BASE_W, BASE_H, (g) => {
      const r = seeded(91);
      for (const x of parkSpots) leafyTree(g, x, 206, 16 + r() * 12, r, { ...FOLIAGE.night, lit: '#4a3a4a', hi: '#8a5a5a', trunkLit: '#5a3a3a' }, 1);
      for (let x = 0; x < BASE_W; x += 4 + Math.floor(r() * 6)) bush(g, x, 207, 2 + r() * 2, r, FOLIAGE.night);
    })).setOrigin(0).setDepth(1.5);
    const burnt = this.add.image(0, 0, this.tex('intro_bomb_burnt', BASE_W, BASE_H, (g) => {
      const r = seeded(92);
      for (const x of parkSpots) burntTree(g, x, 206, 14 + r() * 10, r);
      grass(g, 240, 206, 30, 2, r, '#0c0808', '#1a1010', '#3a2018');
    })).setOrigin(0).setDepth(1.5).setVisible(false);
    // auta na estakadzie (światła), przed wybuchem
    const cars = this.add.graphics().setDepth(1.4);
    const CARS = Array.from({ length: 9 }, (_, i) => ({ x: (i * 61) % BASE_W, v: (i % 2 ? -1 : 1) * (14 + (i % 3) * 5) }));
    // stado ptaków nad parkiem: spokojny lot przed uderzeniem, spłoszone zrywa się przy błysku
    const flock = new Birds(this, 7, { x: 0, y: 150, w: BASE_W, h: 30 }, 0x120c16, 1.6, 31, -1);

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
      // drzewa w parku płoną w chwili przejścia fali (po bieli)
      const scorched = k > secToQ8(0.42);
      park.setVisible(!scorched);
      burnt.setVisible(scorched);
      cars.clear();
      if (pre) for (const c of CARS) {
        c.x = (c.x + c.v * dt + BASE_W + 20) % (BASE_W + 20);
        const y = c.v > 0 ? 201 : 203;
        cars.fillStyle(c.v > 0 ? 0xfff0c0 : 0xff3020, 1).fillRect(Math.round(c.x) - 10, y, 2, 1);
        cars.fillStyle(c.v > 0 ? 0xfff0c0 : 0xff3020, 0.35).fillRect(Math.round(c.x) - 10 + (c.v > 0 ? 2 : -4), y, 4, 1);
      }
      if (k > 0) flock.speedK = 6;
      flock.update(t, dt);
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
    // roślinność Rdzawiska: chwasty z pęknięć, krzaki przy chodnikach, zmutowane świecące grzyby, uschnięte drzewo;
    // obraz w kontenerze tła, więc przybliża się razem z ulicą
    const flora = this.tex('intro_ruins_flora', BASE_W, BASE_H, (g) => {
      const r = seeded(25), T = FOLIAGE.toxic;
      deadTree(g, 62, 184, 46, r, '#141a14', '#5a6a4a', 1);
      leafyTree(g, 420, 190, 34, r, T, 1);
      for (const [x, y, rr] of [[18, 196, 5], [110, 182, 4], [150, 176, 3], [346, 178, 3], [384, 186, 5], [462, 198, 5], [470, 176, 4]] as const) bush(g, x, y, rr, r, T, 1);
      for (let k = 0; k < 46; k++) {
        const left = r() < 0.5;
        const x = left ? 4 + r() * 170 : 310 + r() * 166, y = 160 + r() * 44;
        grass(g, x, y, 2 + Math.floor(r() * 4), 2 + r() * 4, r, T.shade, T.mid, T.hi);
      }
      for (let k = 0; k < 14; k++) grass(g, 205 + r() * 70, 150 + r() * 54, 2, 2 + r() * 2, r, T.shade, T.mid, T.lit); // chwasty w szczelinach jezdni
      glowShrooms(g, 132, 192, 4, r);
      glowShrooms(g, 360, 196, 3, r, '#80ffd0', '#2a4a40');
      glowShrooms(g, 30, 176, 3, r);
    });
    img.add(this.add.image(-VX, -VY, flora).setOrigin(0));
    // szczury przebiegające przez jezdnię (w kontenerze - współrzędne względem punktu zaczepienia)
    const rats = [new Walker(this, 'rat', 150 - VX, 330 - VX, 199 - VY, 3, FAUNA_PAL.rat, 1), new Walker(this, 'rat', 60 - VX, 170 - VX, 186 - VY, 3, FAUNA_PAL.rat, 2)];
    for (const rt of rats) img.add(rt.image);
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
      for (const rt of rats) rt.update(tq / SEC, dt);
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
      const r = seeded(42);
      clouds(g, w, h, r, [[60, 44, 110, 22], [300, 34, 130, 20], [430, 76, 90, 16], [190, 88, 80, 14]], { tones: ['#c06a3a', '#6a3026', '#36181c', '#1a0c12'], light: 0, wrap: true });
      streaks(g, w, r, 60, 112, 10, ['#8a3a26', '#4a2020', '#26121a'], true);
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
      // uschnięte drzewa, kolczaste krzaki i kępy suchej trawy wokół obozu
      deadTree(g, ox + 22, 170, 54, r, '#120a0a', undefined, 1);
      deadTree(g, ox + 452, 168, 44, r, '#120a0a', undefined, -1);
      for (let k = 0; k < 9; k++) {
        const x = ox + 10 + r() * 460;
        if (Math.abs(x - ox - FX) < 50) continue;
        dryShrub(g, x, 170 + r() * 26, 4 + r() * 5, r, '#1a100c', '#3a2418');
      }
      for (let k = 0; k < 40; k++) {
        const x = ox + r() * 480;
        if (Math.abs(x - ox - FX) < 30) continue;
        grass(g, x, 166 + r() * 36, 3, 2 + r() * 3, r, '#140c0a', '#2a1a12', '#4a2e1a');
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
    // fauna obozu: szczury przy beczkach, biegacz pustyni toczony wiatrem, kruki krążące nad łuną
    const critters = [
      new Walker(this, 'rat', 320, 372, 197, 4.5, FAUNA_PAL.rat, 1),
      new Walker(this, 'rat', 60, 110, 190, 2.6, FAUNA_PAL.rat, 3),
      new Tumbleweed(this, 199, BASE_W, 4.8, '#3a2418', '#6a4024', 22, -40),
      new Circlers(this, 'crow', 3, 300, 70, 46, 1, FAUNA_PAL.crowDusk),
    ];
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
      for (const c of critters) c.update(t, dt);
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

  /** 4 - karawana nomadów z końmi na wydmach o zachodzie słońca: postacie pod światło, długie cienie, warstwy wydm. */
  private buildNomads(): void {
    const M = 30, SX = 150, SY = 128;
    this.tex('intro_nomads_sky', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      ditherGradient(g, 0, 0, w, h, [[0, '#24183e'], [0.22, '#5a2c52'], [0.4, '#b8503a'], [0.52, '#ea8a44'], [0.6, '#f8c070'], [0.7, '#ffe2a0']], 22);
      stars(g, w, h * 0.22, seeded(51), 30);
      sun(g, SX + M, SY, 26, { core: '#fff6d0', rim: '#ffd88a', halo: '#ffb060', bands: '#f2a058', haloA: 0.55, haloR: 120 });
    });
    const sky = new ParallaxLayer(this, 'intro_nomads_sky', 0.05, M, 0);
    this.tex('intro_nomads_clouds', BASE_W, 120, (g, w, h) => {
      const r = seeded(52);
      clouds(g, w, h, r, [[40, 34, 120, 20], [280, 46, 140, 22], [430, 22, 80, 14]], { tones: ['#ffe0a0', '#f09a62', '#b45a58', '#6a3450'], light: -1, wrap: true });
      streaks(g, w, r, 70, 116, 14, ['#ffd090', '#e08a5a', '#a04a4a'], true);
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
      // kaktusy i suche krzaki na grzbietach wydm (pod światło: ciemne, jasna krawędź od słońca)
      for (const [x, y, hh] of [[M + 300, 176, 22], [M + 330, 162, 12], [M + 70, 164, 14], [M + 430, 180, 28]] as const) cactus(g, x, y, hh, r, '#3a2014', '#5a3018', '#d08048');
      for (let k = 0; k < 12; k++) {
        const x = r() * w;
        dryShrub(g, x, (k % 2 ? 160 : 176) + r() * 3, 3 + r() * 4, r, '#5a2e18', '#e09a5a');
      }
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
      skeleton(g, M + 40, 202, '#f0dcb8', '#6a3a20');
      for (let k = 0; k < 24; k++) grass(g, r() * w, 200 + r() * 6, 3, 2 + r() * 4, r, '#4a2414', '#8a4a24', '#f0b070');
      dryShrub(g, M + 18, 202, 8, r, '#3a1c10', '#e09058');
      cactus(g, M + 470, 204, 26, r, '#2a140a', '#4a2414', '#e09058');
      vignette(g, w, h, '#1a0a10', 0.45, 0.6);
    });
    const near = new ParallaxLayer(this, 'intro_nomads_near', 1, M, 6);

    // karawana: nomadzi i konie PixelLab (src/assets/units/nomad_*, horse*) w animacji chodu w bok (anims/walk_east),
    // przyciemnione pod światło zachodzącego słońca, z długim cieniem w prawo
    const BASE_Y = 199;
    const slots: [string, number][] = [
      ['nomad_scout', 0], ['horse', 34], ['nomad_trader', 66], ['horse_pack', 100], ['nomad_elder', 132], ['horse_pack', 166], ['nomad_hunter', 198],
    ];
    const caravan = slots
      .map(([id, off], i) => {
        const strip = spriteStripKey(id, 'walk', 'east');
        const still = spriteTexKey(id, 'east');
        const anim = this.textures.exists(strip);
        if (!anim && !this.textures.exists(still)) return null;
        const key = anim ? strip : still;
        const tex = this.textures.get(key);
        const src = tex.getSourceImage() as HTMLImageElement;
        const fs = src.height;
        const frames = anim ? Math.max(1, Math.floor(src.width / fs)) : 1;
        if (anim && !tex.has('w0')) for (let k = 0; k < frames; k++) tex.add(`w${k}`, 0, k * fs, 0, fs, fs);
        const frame = (k: number): string | number => (anim ? `w${k % frames}` : 0);
        // obraz 64 px = 32 px projektowe (gęstość 2 jak postacie na mapie misji); stopy ~ dolna krawędź klatki
        const k0 = 0.5 * (64 / fs);
        const shadow = this.add.image(0, 0, key, frame(0)).setOrigin(0.5, 1).setDepth(3.9).setTint(0x3a1a0e).setTintMode(Phaser.TintModes.FILL).setAlpha(0.35).setScale(k0 * 1.5, -k0 * 0.16);
        const body = this.add.image(0, 0, key, frame(0)).setOrigin(0.5, 0.94).setDepth(4).setScale(k0).setTint(0xc89078);
        return { off, i, body, shadow, frame, frames, horse: id.startsWith('horse') };
      })
      .filter((c): c is NonNullable<typeof c> => !!c);
    const dust = new Motes(this, 110, { x: 0, y: 120, w: BASE_W, h: 110 }, 0xf8d090, 16, 1, 5, 0.5);
    const heat = new Motes(this, 40, { x: 0, y: 150, w: BASE_W, h: 40 }, 0xfff0c0, 4, -2, 9, 0.25, 1);
    const critters = [
      new Circlers(this, 'vulture', 3, 360, 62, 44, 1, FAUNA_PAL.vultureDusk),
      new Tumbleweed(this, 201, BASE_W, 5, '#6a3a1c', '#c08048', 30, 120),
    ];
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
      for (const c of critters) c.update(t, dt);
      const lead = 150 + t * 8 - p * 0.6;
      for (const c of caravan) {
        const x = Math.round(lead - c.off);
        // 8 klatek chodu na ~1 s (koń wolniej), przesunięcie fazy, żeby karawana nie szła w jednym rytmie
        const f = c.frame(Math.floor(t * (c.horse ? 7 : 8) + c.i * 3));
        c.body.setFrame(f).setPosition(x, BASE_Y);
        c.shadow.setFrame(f).setPosition(x + 14, BASE_Y + 1);
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
      const r = seeded(32);
      clouds(g, w, h, r, [[80, 34, 110, 20], [330, 50, 130, 22], [200, 88, 90, 14]], { tones: ['#c8d0f0', '#6a74a0', '#343c68', '#1a2040'], light: 1, wrap: true });
      streaks(g, w, r, 60, 104, 8, ['#5a6490', '#2c3460', '#161c3a'], true);
    });
    const cl = new DriftLayer(this, 'intro_haven_clouds', BASE_W, 2, 0, 0, 0.75);
    this.tex('intro_haven_far', BASE_W + 2 * M, BASE_H, (g, w) => {
      ruins(g, seeded(33), { base: 150, n: 34, hMin: 14, hMax: 64, wMin: 10, wMax: 24, body: '#10121e', side: '#0a0c16', rim: '#2a3050', win: '#080a12', lit: '#ffc860', litChance: 0.01, detail: 0.6, x0: 0, x1: w, light: 1 });
      haze(g, 0, 110, w, 40, '#3a3450', 0.05, 0.5);
    });
    const far = new ParallaxLayer(this, 'intro_haven_far', 0.25, M, 0);
    // zajezdnia tramwajowa po zagładzie: ceglana hala z bramami na tory, mur z wraków, wieże z rur (fx/HavenArt.ts)
    let depot: ReturnType<typeof paintDepot> = { bulbs: [], sparks: [0, 0], cat: [110, 176] };
    this.tex('intro_haven_fort', BASE_W + 2 * M, BASE_H, (g, w, h) => {
      const r = seeded(34);
      ground(g, w, h, 197, { crest: '#3a3430', body: '#1e1a18', deep: '#0a0a0a', amp: 1, freq: 0.02, seed: 12, debris: 0.45, rnd: r });
      depot = paintDepot(g, M, r);
      rimLight(g, M + 240, 192, '#ffb060', 210, 0.55, 1);
      vignette(g, w, h, '#000004', 0.55, 0.5);
    });
    const fort = new ParallaxLayer(this, 'intro_haven_fort', 0.5, M, 1);
    // migające żarówki girland i iskry spawania na dachu (ktoś łata wyrwę)
    const bulbs = new Windows(this, depot.bulbs, 0xfff0a0, 1.1, 77);
    const weld = this.add.graphics().setDepth(1.3).setBlendMode(Phaser.BlendModes.ADD);
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
    const smoke = new Motes(this, 46, { x: 300, y: 40, w: 16, h: 56 }, 0x8a8a98, 4, -10, 5, 0.45, 1.2);
    const embers = new Motes(this, 30, { x: 0, y: 150, w: BASE_W, h: 70 }, 0xffb060, 3, -8, 8, 0.6, 6);
    // życie w osadzie: pies obchodzi mur, kury dziobią przy bramie, kot na blankach
    const critters = [
      new Walker(this, 'dog', 30, 150, 203, 4.5, FAUNA_PAL.dogNight, 1),
      new Walker(this, 'hen', 330, 352, 203, 4.5, FAUNA_PAL.hen, 2),
      new Walker(this, 'hen', 356, 380, 203, 4.5, FAUNA_PAL.hen, 3),
    ];
    const cat = this.add.image(0, depot.cat[1], pixelFrames(this, 'fauna_cat', SPRITES.CAT, FAUNA_PAL.cat)[0]).setOrigin(0.5, 1).setDepth(1.2);
    const catKeys = pixelFrames(this, 'fauna_cat', SPRITES.CAT, FAUNA_PAL.cat);
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
      const off = -p * 0.5;
      for (const c of critters) {
        c.offset = off;
        c.update(t, dt);
      }
      cat.setX(Math.round(depot.cat[0] + off)).setTexture(catKeys[Math.floor(t * 1.5) % 4 === 0 ? 1 : 0]);
      const fx = Math.round(-p * 0.5);
      bulbs.update(t, fort.dx);
      // spawanie: krótkie serie iskier co kilka sekund
      weld.clear();
      const cyc = t % 4.5;
      if (cyc < 1.4) {
        const [wx, wy] = depot.sparks;
        weld.fillStyle(0xd0e8ff, 0.5 + 0.5 * Math.sin(t * 50)).fillRect(Math.round(wx + fort.dx) - 1, wy - 1, 3, 3);
        for (let k = 0; k < 8; k++) {
          const a = k * 2.4 + Math.floor(t * 20), d = ((t * 40 + k * 7) % 12);
          weld.fillStyle(k % 2 ? 0xffe080 : 0xffffff, 1).fillRect(Math.round(wx + fort.dx + Math.cos(a) * d), Math.round(wy + Math.abs(Math.sin(a)) * d * 0.6 + d * d * 0.03), 1, 1);
        }
      }
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
    const upd = backdrop(this, 'intro_crew', {
      mood: MOODS.dusk, seed: 40, orb: [240, 148, 40], farBase: 186, midBase: 192, midH: [12, 64], groundY: 190, pan: 10,
      flora: { tones: FOLIAGE.dusk, density: 1.2, avoid: [[118, 362]] },
      fauna: { crows: 2, circlers: 'vulture', avoid: [[118, 362]] },
    });
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
