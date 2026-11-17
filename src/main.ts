import Phaser from 'phaser';
import { SoundManager } from './audio/SoundManager';
import { campaign, quickParty } from './core/campaign/session';
import { DebriefScene } from './scenes/DebriefScene';
import { FxScene } from './scenes/FxScene';
import { GameOverScene, VictoryScene } from './scenes/EndScenes';
import { HubScene } from './scenes/HubScene';
import { IntroScene } from './scenes/IntroScene';
import { LogoScene } from './scenes/LogoScene';
import { RecruitScene } from './scenes/RecruitScene';
import { TitleScene } from './scenes/TitleScene';
import { TravelScene } from './scenes/TravelScene';
import { UIScene } from './scenes/UIScene';
import { CANVAS_H, CANVAS_W } from './scenes/ui/Kit';
import { Settings } from './scenes/ui/Settings';
import { preloadSprites } from './scenes/iso/SpriteUnits';
import { WorldScene } from './scenes/WorldScene';

// Kolejność jak w Oldgame/src/main.js: logo -> intro -> tytuł -> werbunek -> Przystań -> podróż -> misja -> podsumowanie.
// Skrót (jak Oldgame/src/main.js:45-48, działa też w wersji produkcyjnej): ?scene=<dowolna scena>; pozostałe parametry
// URL trafiają do sceny jako dane startowe. Sceny kampanii bez drużyny dostają gotową (quickParty).
// Przykłady: HubScene&open=board|shop|clinic|party|tavern; IntroScene&slide=N; TravelScene&contract=<id>&event=<id>;
// RecruitScene&pick=0,1,2,3; WorldScene bez zlecenia = misja demonstracyjna, &contract=<id> = misja ze zlecenia.
const SCENES = { LogoScene, IntroScene, TitleScene, RecruitScene, HubScene, TravelScene, WorldScene, DebriefScene, GameOverScene, VictoryScene } as const;
/** Sceny, które nie potrzebują kampanii. */
const NO_CAMPAIGN = ['LogoScene', 'IntroScene', 'TitleScene', 'RecruitScene', 'WorldScene'];
const query = new URLSearchParams(window.location.search);
const wanted = query.get('scene');
const first = wanted && wanted in SCENES ? (wanted as keyof typeof SCENES) : 'LogoScene';
if (first !== 'LogoScene' && !NO_CAMPAIGN.includes(first) && !campaign.state.party.length) quickParty();
/** Dane startowe pierwszej sceny z parametrów URL (bez scene/res/profile); contract=<id> zamieniany na zlecenie. */
const startData: Record<string, unknown> = {};
if (first !== 'LogoScene') {
  for (const [k, v] of query) if (!['scene', 'res', 'profile'].includes(k)) startData[k] = v;
  if (typeof startData.contract === 'string') {
    if (first === 'WorldScene' && !campaign.state.party.length) quickParty();
    const c = campaign.state.contracts.find((k) => k.id === startData.contract);
    if (c) startData.contract = c;
    else delete startData.contract;
  }
  if (startData.slide !== undefined) startData.slide = Number(startData.slide);
}

/** Scena rozruchowa: startuje wybraną scenę z danymi z URL (pierwsza scena z listy Phasera nie dostaje danych). */
class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }
  /** Sprite'y i portrety najemników (iso/SpriteUnits) - jedyne grafiki z plików, reszta jest malowana kodem. */
  preload(): void {
    preloadSprites(this);
  }
  create(): void {
    this.scene.start(first, startData);
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  // Płótno w rozdzielczości presetu (domyślnie 1920x1080); siatka projektowa 480x270 rysowana z zoomem ZOOM
  // (kamery mają zoom = ZOOM, przy 640x480 viewport z pasami): gruby piksel, ostry tekst.
  width: CANVAS_W,
  height: CANVAS_H,
  backgroundColor: '#000000',
  pixelArt: true,
  roundPixels: true,
  // Profil Amiga: 50 klatek (PAL VBlank) - tyle, ile dostanie port na A1200 + PiStorm z miniGL.
  fps: Settings.startAmiga ? { target: 50, limit: 50 } : undefined,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // FxScene (efekty retro z Opcji) startuje sama i zawsze leży na wierzchu
  scene: [BootScene, ...Object.values(SCENES), UIScene, FxScene],
};

const game = new Phaser.Game(config);
// tryb deweloperski: dostęp do gry z konsoli / testów Playwright
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
// Skalowanie CSS płótna (okno przeglądarki ma inny rozmiar niż preset). Powiększenie: najbliższy sąsiad - piksel
// projektowy to >= 2 piksele płótna, więc zostaje ostry (wygładzanie rozmywało kontury postaci). Pomniejszenie:
// wygładzanie, bo najbliższy sąsiad gubiłby całe wiersze płótna. Najostrzej: pełny ekran z presetem = rozdzielczość monitora.
const fitCanvasRendering = (): void => {
  const shown = game.canvas.getBoundingClientRect().width * (window.devicePixelRatio || 1);
  game.canvas.style.imageRendering = shown >= game.canvas.width - 0.5 ? 'pixelated' : 'auto';
};
game.scale.on(Phaser.Scale.Events.RESIZE, fitCanvasRendering);
window.addEventListener('resize', () => requestAnimationFrame(fitCanvasRendering));
game.events.once(Phaser.Core.Events.READY, fitCanvasRendering);
// Odblokowuje WebAudio przy pierwszym kliknięciu/klawiszu; sceny wołają SoundManager.sfx()/music()/ambience().
SoundManager.attach(game);
// Tylko w trybie deweloperskim: uchwyt do testów automatycznych / konsoli.
if (import.meta.env.DEV) Object.assign(window, { __game: game, __campaign: campaign });
