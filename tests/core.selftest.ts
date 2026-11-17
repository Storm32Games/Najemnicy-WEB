// Testy logiki src/core (port Oldgame/src/rules/selftest.mjs + mapy, walka taktyczna, AI, kampania).
// Uruchom: node tests/core.selftest.ts   (Node >= 22.18 usuwa typy sam; zero Phasera / DOM)
import {
  ABILITIES, ABILITY_EFFECTS, ANCESTRIES, CLASSES, DEGREE_NAMES, ENEMIES, ITEMS,
  addCondition, addXP, applyDamage, canAct, check, createCharacter, createEnemy, dcForLevel, encounterXP, endTurn, equip,
  getAttackBonus, getStat, heal, isAlive, isDown, longRest, makeRng, newItem, profBonus, removeCondition, roll, rollInitiative,
  skillCheck, startTurn, strike, summarize, useAbility, useConsumable, d, checkBy, halveDie, attackHalves,
  LOCKS, DEVICES, lockState, deviceState, pickLock, hackDevice, lockForLevel, hasLockpick, fmtDamage,
  generateMap, Mission, runAiTurn, CellKind, MAP_W, MAP_H,
  freshState, generateContracts, applyMissionResult, EVENTS, resolveEventChoice, shopStock, buy, sellPrice, restDay,
  makeContract, refreshBoard, consumeFood, addFood, FOOD_LOW, FOOD_MAX,
  RECIPES, WORKSHOP_LEVELS, recipeDef, techOf, partCount, recipeState, research, craft, craftCost, storePart, partUses, upgradeWorkshop, nextLevel, researchBlock,
} from '../src/core/index.ts';
import { HudState, backpackRows, conditionChips, equipmentRows, hpTone, plural, statPairs } from '../src/core/HudState.ts';
import { itemTargeting, previewStrike } from '../src/core/SkirmishRules.ts';
import {
  EASE_OUT3_LUT, IntRng, IntroAction, IntroFlow, LOGO_GH, LOGO_GW, LOGO_MAX_DUR, LogoCubes, LogoEvent, LogoShow, Q12, TickClock, TypeProgress,
  easeOut3, icos, isin, titleMenu,
  ApproachCurve, MoteField, Q8, angQ8, blinkAlphaQ8, flameKQ12, glowAlphaQ8, nextPow2, phaseAt, potTiles, progressQ12, secToQ8, tilesBytes16, wave,
} from '../src/core/frontend/index.ts';
import {
  CITY, GATE, HOME, PLAZAS, SECTORS, WQ, buildRoute, contractSpots, heightGrid, heightQ8, inCity, regionHeightF, routePointAt, routeTicks,
} from '../src/core/campaign/region.ts';
import { isqrt } from '../src/core/frontend/index.ts';
import type { AbilityDef, AbilityId, Character, ClassId, EnemyId, Contract, Biome } from '../src/core/index.ts';

let fails = 0;
let checks = 0;
const ok = (c: unknown, msg: string): void => {
  checks++;
  if (!c) {
    fails++;
    console.log('FAIL:', msg);
  }
};
const rng0 = makeRng(12345);
const noFn = (o: unknown): boolean => {
  let bad = false;
  JSON.stringify(o, (_k, v) => {
    if (typeof v === 'function') bad = true;
    return v;
  });
  return !bad;
};

// ---- kości
{
  const r = makeRng(1);
  const r2 = makeRng(1);
  ok(r() === r2(), 'seeded rng deterministic');
  let range = true;
  for (let i = 0; i < 1000; i++) {
    const v = d(20, rng0);
    if (v < 1 || v > 20) range = false;
  }
  ok(range, 'd20 range');
  const x = roll('2d6+3', rng0);
  ok(x.total >= 5 && x.total <= 15 && x.rolls.length === 2 && x.mod === 3, 'roll 2d6+3');
  ok(roll('1d4-1', rng0).total >= 0, 'roll 1d4-1');
  ok(roll('5').total === 5, 'roll flat');
  const fx = (n: number) => () => (n - 1) / 20 + 0.001;
  const t = (mod: number, dc: number, nat: number) => check(mod, dc, fx(nat));
  ok(t(5, 15, 10).degree === 2, 'meets DC = success');
  ok(t(4, 15, 10).degree === 1, 'below DC = failure');
  ok(t(15, 15, 10).degree === 3, '+10 = crit success');
  ok(t(-5, 15, 10).degree === 0, '-10 = crit fail');
  ok(t(-10, 15, 20).degree === 2, 'nat20 raises failure to success');
  ok(t(5, 15, 20).degree === 3, 'nat20 raises success to crit');
  ok(t(30, 15, 1).degree === 2, 'nat1 lowers crit to success');
  ok(t(0, 15, 1).degree === 0, 'nat1 lowers fail to crit fail');
  ok(profBonus(0, 5) === 0 && profBonus(1, 1) === 3 && profBonus(2, 3) === 7 && profBonus(4, 10) === 18, 'profBonus');
  ok(dcForLevel(0) === 14 && dcForLevel(1) === 15 && dcForLevel(3) === 18, 'dcForLevel');
  ok(DEGREE_NAMES.length === 4, 'degree names');
}

// ---- treść
ok(Object.keys(CLASSES).length === 12, '12 classes');
ok(Object.keys(ENEMIES).length >= 12, '>=12 enemies');
for (const id of Object.keys(ABILITIES) as AbilityId[]) ok(typeof ABILITY_EFFECTS[id] === 'function', 'effect for ' + id);

// ---- postacie
for (const cid of Object.keys(CLASSES) as ClassId[]) {
  for (const aid of Object.keys(ANCESTRIES)) {
    const c = createCharacter({ name: `T-${cid}-${aid}`, ancestry: aid, classId: cid });
    ok(c.hp === c.maxHp && c.maxHp >= 14 && c.maxHp <= 30, `hp ${cid}/${aid}: ${c.maxHp}`);
    ok(c.equipment.weapon, 'has weapon ' + cid);
    ok(getStat(c, 'ac') >= 11 && getStat(c, 'ac') <= 22, `ac ${cid}/${aid} ${getStat(c, 'ac')}`);
    ok(noFn(c) && JSON.stringify(JSON.parse(JSON.stringify(c))) === JSON.stringify(c), 'json round trip ' + cid);
    ok(c.abilities.includes('strike') && c.abilities.length >= 5, 'abilities list');
    ok(summarize(c).length >= 4, 'summarize');
  }
}
ok(createCharacter({ name: 'X', ancestry: 'nomad-born', classId: 'scout' }).ancestry === 'nomad', 'ancestry alias');
{
  const c = createCharacter({ name: 'Hak', ancestry: 'human', classId: 'soldier' });
  ok(getAttackBonus(c, ITEMS.rifle, 0) - getAttackBonus(c, ITEMS.rifle, 1) === 5, 'MAP -5');
  ok(getAttackBonus(c, ITEMS.rifle, 0) - getAttackBonus(c, ITEMS.rifle, 2) === 10, 'MAP -10');
  ok(getAttackBonus(c, ITEMS.knife, 0) - getAttackBonus(c, ITEMS.knife, 1) === 4, 'agile MAP -4');
  ok(getAttackBonus(c, ITEMS.knife, 0) - getAttackBonus(c, ITEMS.knife, 2) === 8, 'agile MAP -8');
  const ac0 = getStat(c, 'ac');
  addCondition(c, 'off_guard');
  ok(getStat(c, 'ac') === ac0 - 2, 'off_guard -2 AC');
  removeCondition(c, 'off_guard');
  addCondition(c, 'frightened', 2);
  ok(getStat(c, 'ac') === ac0, 'frightened: no flat penalty (dice halved instead)');
  {
    const seq = (v: number) => () => (v - 1) / 20 + 0.001; // k20 = v
    const n = check(5, 15, seq(14));
    ok(n.d20 === 14 && n.total === 19, 'check: normal die');
    const h = checkBy(c, 5, 15, seq(15));
    ok(h.raw === 15 && h.d20 === 8 && h.total === 13 && h.halves === 1, 'frightened: k20 15 -> 8 (ceil)');
    const h20 = checkBy(c, 0, 15, seq(20));
    ok(h20.d20 === 10 && !h20.nat20, 'frightened: 20 -> 10, no nat 20');
    ok(halveDie(1, 1) === 1 && halveDie(7, 1) === 4 && halveDie(20, 2) === 5, 'halveDie rounds up');
    ok(roll('2d6', () => 0.999, 1).total === 6, 'frightened: damage dice halved (6 -> 3 each)');
  }
  removeCondition(c, 'frightened');
  addCondition(c, 'in_cover');
  ok(getStat(c, 'ac') === ac0 + 2, 'cover +2');
  ok(attackHalves(c, c) === 0, 'take cover: AC only, hit die not halved');
  removeCondition(c, 'in_cover');
  addCondition(c, 'hidden');
  ok(attackHalves(c, c) === 1, 'hidden: hit die halved');
  addCondition(c, 'frightened', 1);
  ok(attackHalves(c, c) === 2, 'frightened attacker vs hidden target: halved twice');
  removeCondition(c, 'frightened');
  removeCondition(c, 'hidden');
  c.equipment.shield = newItem('scrap_shield');
  addCondition(c, 'raised_shield');
  ok(getStat(c, 'ac') === ac0 + 2, 'shield +2');
  removeCondition(c, 'raised_shield');
  c.equipment.shield = null;
  const pa = createCharacter({ name: 'PA', ancestry: 'human', classId: 'soldier' });
  pa.equipment.armor = newItem('power_armor');
  ok(getStat(pa, 'speed') === 4, 'speed penalty power armor');
}
// ekwipunek
{
  const c = createCharacter({ name: 'Eq', ancestry: 'human', classId: 'champion' });
  const stash = [newItem('scrap_shield')];
  c.equipment.shield = null;
  ok(equip(c, 'shield', stash[0], stash, stash).ok && c.equipment.shield, 'equip shield');
  const sh = newItem('sledgehammer');
  const bag = [sh];
  const r = equip(c, 'weapon', sh, bag, stash);
  ok(r.ok && !c.equipment.shield && stash.some((i) => i.id === 'scrap_shield'), 'two-hander drops shield to stash');
  ok(!equip(c, 'shield', stash.find((i) => i.id === 'scrap_shield')!, stash, stash).ok, 'no shield with two-hander');
  ok(!equip(c, 'armor', newItem('knife'), [], stash).ok, 'slot type check');
}
// atak / krytyk / umieranie
{
  const a = createCharacter({ name: 'Atak', ancestry: 'human', classId: 'soldier' });
  let hits = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const e = createEnemy('raider_thug');
    const r = strike(a, e, { rng: rng0 });
    if (r.events[0].type !== 'miss') hits++;
  }
  ok(hits / n > 0.45 && hits / n < 0.9, 'hit rate sane ' + hits / n);
  const e = createEnemy('raider_thug');
  ok(applyDamage(e, 999).dead && !isAlive(e), 'enemy dies');
  const p = createCharacter({ name: 'P', ancestry: 'human', classId: 'medic' });
  const r2 = applyDamage(p, 999);
  ok(r2.downed && !r2.dead && p.conditions.dying === 1 && p.hp === 0 && isDown(p) && isAlive(p) && !canAct(p), 'PC dying 1');
  heal(p, 5);
  ok(p.hp === 5 && !p.conditions.dying && p.conditions.wounded === 1, 'heal clears dying -> wounded 1');
  applyDamage(p, 999);
  ok(p.conditions.dying === 2, 'wounded raises dying');
  ok(startTurn(p, rng0).actions === 0, 'dying no actions');
  for (let i = 0; i < 30 && p.conditions.dying && !p.conditions.dead; i++) startTurn(p, rng0);
  ok(!p.conditions.dying || p.conditions.dead, 'dying resolves');
  const q = createCharacter({ name: 'Q', ancestry: 'human', classId: 'brute' });
  addCondition(q, 'bleeding', '1d6');
  const hp0 = q.hp;
  const s2 = startTurn(q, rng0);
  ok(q.hp < hp0 && s2.actions === 3, 'bleeding dmg at start');
  addCondition(q, 'stunned', 1);
  ok(startTurn(q, rng0).actions === 2, 'stunned 1 -> 2 actions');
  addCondition(q, 'slowed', 2);
  ok(startTurn(q, rng0).actions === 1, 'slowed 2 -> 1 action');
  addCondition(q, 'frightened', 2);
  endTurn(q);
  ok(q.conditions.frightened === 1, 'frightened decrements');
  const ini = rollInitiative(q, rng0);
  ok(ini.total === ini.d20 + ini.mod, 'initiative');
  ok(skillCheck(q, 'athletics', 15, rng0).dc === 15, 'skillCheck');
  longRest(q);
  ok(q.hp === q.maxHp && Object.keys(q.conditions).length === 0, 'long rest');
  // odporność wroga liczona raz (dane mają wartości efektywne, np. rój much: resist P)
  const sw = createEnemy('fly_swarm');
  const before = sw.hp;
  applyDamage(sw, 10, 'P');
  ok(before - sw.hp === 10 - (ENEMIES.fly_swarm as { resist: { P: number } }).resist.P, 'enemy resistance applied once');
  ok(createEnemy('raider_thug', { levelAdj: 1 }).level === 2 && createEnemy('raider_thug', { levelAdj: -1 }).level === 0, 'levelAdj');
}

// ---- wszystkie zdolności
function dummyTargets(user: Character, ab: AbilityDef): Character[] {
  const mk = () => createEnemy('raider_thug');
  const ally = createCharacter({ name: 'Sojusznik', ancestry: 'human', classId: 'soldier' });
  if (ab.target === 'ally') {
    ally.hp = Math.max(1, ally.maxHp - 12);
    return [ally];
  }
  if (ab.target === 'self') return [user];
  if (ab.target === 'area') return ['rally', 'field_clinic', 'chief_rally', 'kostucha_command'].includes(ab.id) ? [ally, user] : [mk(), createEnemy('drone'), mk()];
  return [mk()];
}
const used = new Set<string>();
for (const cid of Object.keys(CLASSES) as ClassId[]) {
  const u = createCharacter({ name: 'Test' + cid, ancestry: 'human', classId: cid, level: 5 });
  for (const id of u.abilities) {
    for (let k = 0; k < 40; k++) {
      longRest(u);
      const targets = dummyTargets(u, ABILITIES[id]);
      try {
        const res = useAbility(id, { user: u, targets, rng: rng0, mapIndex: k % 3 });
        ok(Array.isArray(res.log) && Array.isArray(res.events) && typeof res.attack === 'boolean', `ability ${id} result shape`);
        ok(noFn(u), 'no fn in chars after ' + id);
      } catch (e) {
        ok(false, `ability ${id} threw ${(e as Error).stack}`);
        break;
      }
    }
    used.add(id);
  }
}
for (const eid of Object.keys(ENEMIES) as EnemyId[]) {
  for (const id of createEnemy(eid).abilities) {
    used.add(id);
    for (let k = 0; k < 30; k++) {
      const uu = createEnemy(eid);
      const ab = ABILITIES[id];
      const pcs = [createCharacter({ name: 'A', ancestry: 'human', classId: 'soldier' }), createCharacter({ name: 'B', ancestry: 'mutant', classId: 'medic' })];
      const targets = ab.target === 'self' ? [uu] : id === 'chief_rally' || id === 'kostucha_command' ? [uu, createEnemy('raider_thug')] : ab.target === 'area' ? pcs : [pcs[0]];
      try {
        ok(useAbility(id, { user: uu, targets, rng: rng0, mapIndex: 0 }).log, 'enemy ability ' + id);
      } catch (e) {
        ok(false, `enemy ability ${id} threw ${(e as Error).stack}`);
        break;
      }
    }
  }
}
ok(used.size === Object.keys(ABILITIES).length, 'every ability resolved: missing ' + Object.keys(ABILITIES).filter((a) => !used.has(a)).join(','));
// limit użyć zmniejszany także dla zdolności, które same tego nie robią
{
  const m = createCharacter({ name: 'Szef', ancestry: 'human', classId: 'soldier', level: 5 });
  const left = m.uses.suppressive_fire ?? 0;
  useAbility('suppressive_fire', { user: m, targets: [createEnemy('raider_thug')], rng: rng0 });
  ok(m.uses.suppressive_fire === left - 1, 'uses decrement');
}
// konsumabelki
for (const it of Object.values(ITEMS).filter((i) => i.type === 'consumable')) {
  const u = createCharacter({ name: 'U', ancestry: 'human', classId: 'medic' });
  u.inventory.push(newItem(it.id, 2));
  u.hp = 5;
  const tg = it.type === 'consumable' && it.consumable.target === 'area' ? [createEnemy('drone'), createEnemy('raider_thug')] : [u];
  const count = () => u.inventory.filter((x) => x.id === it.id).reduce((a, x) => a + x.qty, 0);
  const before = count();
  const r = useConsumable(u, it.id, tg, rng0);
  ok(r.consumed && r.log.length, 'consumable ' + it.id);
  ok(count() === before - 1, 'qty decrement ' + it.id);
}

// ---- poziomy
{
  const c = createCharacter({ name: 'Lev', ancestry: 'human', classId: 'soldier' });
  const hp1 = c.maxHp;
  ok(addXP(c, 999) === 0 && c.level === 1, 'no level at 999');
  ok(addXP(c, 1) === 1 && c.level === 2, 'level 2 at 1000');
  ok(addXP(c, 3000) === 3 && c.level === 5, 'levels to 5');
  ok(c.maxHp > hp1 + 30, `hp grows ${hp1}->${c.maxHp}`);
  ok(c.prof.attacks.martial === 3, 'martial at 5');
  ok(c.abilities.includes('rally'), 'unlock rally at 5');
  addXP(c, 20000);
  ok(c.level === 10, 'cap at 10');
  ok(encounterXP(1, [createEnemy('raider_thug'), createEnemy('raider_thug'), createEnemy('rat_mutant')]) === 110, 'encounterXP');
  ok(encounterXP(3, [createEnemy('raider_thug')]) === 20, 'xp -2');
}

// ---- mapy
{
  const biomes: Biome[] = ['ruins', 'wastes', 'industrial', 'bunker'];
  for (const biome of biomes) {
    for (let s = 0; s < 15; s++) {
      const spec = { id: `${biome}-${s}`, biome, level: 3 };
      const ids: EnemyId[] = s % 3 === 0 ? ['kostucha', 'raider_thug', 'raider_gunner', 'raider_sniper', 'raider_psycho'] : ['raider_thug', 'rat_mutant', 'dog_mutant'];
      const m = generateMap(spec, ids);
      ok(m.width === MAP_W && m.height === MAP_H && m.floor.length === MAP_W * MAP_H, 'map size');
      ok(JSON.stringify(generateMap(spec, ids).props) === JSON.stringify(m.props), 'map deterministic ' + spec.id);
      ok(m.entry.cells.every((c) => m.grid.isFree(c.gx, c.gy)), 'entry free ' + spec.id);
      const placed = m.groups.reduce((n, g) => n + g.members.length, 0);
      ok(placed === ids.length, 'all enemies placed ' + spec.id);
      if (ids[0] === 'kostucha') ok(m.groups[m.groups.length - 1].members.includes('kostucha'), 'boss in last group');
      const start = m.entry.cells[5];
      const reachable = (p: { gx: number; gy: number }) => !!m.grid.findPath(start, p, undefined, 999) || (p.gx === start.gx && p.gy === start.gy);
      ok(m.groups.every((g) => g.cells.every((c) => m.grid.isFree(c.gx, c.gy) && reachable(c))), 'enemy cells reachable ' + spec.id);
      ok(m.crates.every((c) => m.grid.kind(c.gx, c.gy) === CellKind.LOW), 'crates block ' + spec.id);
      ok(!m.objCell || reachable(m.objCell), 'objective reachable ' + spec.id);
    }
  }
}

// ---- wędrowcy i dołączanie do walki tylko w polu widzenia
{
  const ids: EnemyId[] = ['raider_thug', 'raider_gunner', 'rat_mutant', 'dog_mutant', 'raider_psycho', 'rat_mutant'];
  let loners = 0;
  for (let s = 0; s < 20; s++) {
    const m = generateMap({ id: `roam-${s}`, biome: 'ruins', level: 2 }, ids);
    loners += m.groups.filter((g) => g.roam).length;
    ok(m.groups.filter((g) => g.roam).every((g) => g.members.length === 1), 'loner = one enemy');
    ok(m.groups.reduce((n, g) => n + g.members.length, 0) === ids.length, 'all placed with loners');
    const dm = generateMap({ id: `roam-${s}`, biome: 'ruins', level: 2, type: 'defend' }, ids);
    ok(!dm.groups.some((g) => g.roam), 'defend: no loners');
  }
  ok(loners > 10, 'raiders / fauna scatter as loners');

  const party = (['soldier', 'scout', 'medic', 'brute'] as ClassId[]).map((c, i) => createCharacter({ name: `S${i}`, classId: c, ancestry: 'human', level: 2 }));
  const mk = (k: number) =>
    new Mission({ id: `sight-${k}`, type: 'eliminate', level: 2, biome: 'wastes', enemies: ids, reward: 0 } as unknown as Contract, party, makeRng(7));
  let m = mk(0);
  for (let k = 1; k < 40 && !(m.enemies.some((e) => e.roam) && m.groups.some((x) => x.actors.length >= 2)); k++) m = mk(k);
  ok(m.enemies.some((e) => e.roam), 'mission has roamers');
  // wędrowcy chodzą po mapie
  const before = m.enemies.map((e) => `${e.gx},${e.gy}`).join(' ');
  for (let k = 0; k < 4; k++) m.advanceWorld();
  ok(m.enemies.map((e) => `${e.gx},${e.gy}`).join(' ') !== before, 'roamers move during exploration');
  ok(m.enemies.filter((e) => !e.roam && !e.group?.alerted).every((e) => m.map.groups[e.group!.idx].cells.some((c) => c.gx === e.gx && c.gy === e.gy)), 'camps stay put');
  // walka: tylko widoczni wrogowie; reszta dołącza po wejściu w pole widzenia
  const g = m.groups.find((x) => x.actors.length >= 2)!;
  const [seen, hidden] = g.actors;
  const lead = m.pcs[0];
  const spot = m.map.reach.find((r) => Math.hypot(r.gx - seen.gx, r.gy - seen.gy) <= 2 && Math.hypot(r.gx - seen.gx, r.gy - seen.gy) >= 1 && !m.actorAt(r.gx, r.gy) && m.grid.isFree(r.gx, r.gy))!;
  for (const p of m.pcs) {
    p.gx = spot.gx;
    p.gy = spot.gy;
  }
  for (const p of m.pcs.slice(1)) p.state = 'dead';
  // ukryj drugiego członka grupy daleko poza zasięgiem wzroku
  const far = m.map.reach.find((r) => Math.max(Math.abs(r.gx - spot.gx), Math.abs(r.gy - spot.gy)) >= 14 && !m.actorAt(r.gx, r.gy) && m.grid.isFree(r.gx, r.gy))!;
  hidden.gx = far.gx;
  hidden.gy = far.gy;
  m.updateVisibility();
  ok(m.isVisible(seen) && !m.isVisible(hidden), 'setup: one visible, one hidden');
  m.startCombat(g);
  ok(seen.engaged && !hidden.engaged, 'only visible enemy enters combat');
  ok(!m.combat.order.includes(hidden), 'hidden enemy not in initiative');
  ok(g.alerted, 'group alerted');
  // zaalarmowany niewidoczny idzie w stronę drużyny i dołącza po wejściu w pole widzenia
  let joined = false;
  for (let r = 0; r < 12 && !joined; r++) {
    m.advanceWorld();
    m.combat.engageVisible();
    joined = hidden.engaged;
  }
  ok(joined && m.combat.order.includes(hidden), 'hidden enemy joins once it walks into sight');
  ok(m.isVisible(hidden), 'joined enemy is visible');
}

// ---- pełne misje: drużyna i wrogowie sterowani przez AI
function simulateMission(contract: Contract, party: Character[], seed: number): { result: string; rounds: number; turns: number } {
  const rng = makeRng(seed);
  const m = new Mission(contract, party, rng);
  let turns = 0;
  for (let safety = 0; safety < 400 && m.mode !== 'over'; safety++) {
    if (m.mode === 'explore') {
      // idź do najbliższej żywej grupy wrogów / celu / strefy ewakuacji
      const leader = m.pcs.find((p) => p.state === 'up');
      if (!leader) break;
      const foe = m.enemies.find((e) => e.state !== 'dead');
      const goal = m.canExtract()
        ? null
        : m.objectiveDone()
          ? m.map.entry.cells[5]
          : (m.itemThing && !m.itemThing.done ? m.itemThing : m.captive && !m.captive.done ? m.captive
            : m.things.find((t) => t.objective && !t.done) ?? foe) ?? m.map.entry.cells[5];
      if (!goal) {
        m.finish('success');
        break;
      }
      const th = m.things.find((t) => !t.done && t.kind !== 'crate' && Math.max(Math.abs(t.gx - leader.gx), Math.abs(t.gy - leader.gy)) <= 1);
      if (th) {
        m.interact(leader, th, th.kind === 'device' ? 'crafting' : th.kind === 'door' ? 'athletics' : undefined);
        continue;
      }
      // obiekt celu blokuje pole - podejdź obok
      const tgt = 'kind' in goal && !m.grid.isFree(goal.gx, goal.gy) ? (m.interactCell(leader, goal) ?? goal) : goal;
      const r = m.exploreMove(leader, tgt);
      if (!r.ok && foe) m.startCombat(foe.group!);
      else if (!r.ok) m.finish('retreat');
      continue;
    }
    if (m.mode === 'combat') {
      const t = m.combat.nextTurn();
      if (!t) continue;
      turns++;
      runAiTurn(m.combat, t.actor);
      if (m.combat.active) m.combat.endTurn();
      if (turns > 600) m.finish('retreat');
    }
  }
  if (m.mode !== 'over') m.finish('retreat');
  return { result: m.result!.result, rounds: m.combat.round, turns };
}
{
  const party = (lvl: number) =>
    (['soldier', 'scout', 'medic', 'brute'] as ClassId[]).map((c, i) => createCharacter({ name: `N${i}`, classId: c, ancestry: 'human', level: lvl }));
  const state = freshState();
  state.party = party(1);
  let wins = 0;
  let n = 0;
  const outcomes: Record<string, number> = {};
  for (let k = 0; k < 6; k++) {
    for (const c of generateContracts(state, makeRng(100 + k))) {
      const r = simulateMission(c, party(c.level), 1000 + n);
      outcomes[`${c.type}:${r.result}`] = (outcomes[`${c.type}:${r.result}`] ?? 0) + 1;
      if (r.result === 'success') wins++;
      n++;
    }
  }
  console.log(`missions: ${n}, success ${((wins / n) * 100).toFixed(0)}%`, outcomes);
  ok(n > 20, 'simulated missions');
  ok(wins / n > 0.3, 'AI party completes a reasonable share of missions');
}

// ---- kampania
{
  const st = freshState();
  st.party = (['soldier', 'medic', 'scout', 'techie'] as ClassId[]).map((c, i) => createCharacter({ name: `K${i}`, classId: c }));
  st.contracts = generateContracts(st, makeRng(5));
  ok(st.contracts.length >= 10 && st.contracts.every((c) => c.enemies.length >= 2), 'contract board');
  ok(['eliminate', 'retrieve', 'rescue', 'hunt', 'hack', 'liberate', 'purge', 'defend'].every((t) => st.contracts.some((c) => c.type === t)), 'every contract type on board');
  {
    const spots = contractSpots(st.contracts);
    const keys = new Set([...spots.values()].map((p) => p.x + ',' + p.z));
    ok(keys.size === st.contracts.length, 'contract flags do not overlap');
  }
  const c = st.contracts[0];
  const scrap0 = st.scrap;
  const sum = applyMissionResult(st, { contractId: c.id, result: 'success', xp: 120, loot: [newItem('bandage', 2)], scrap: 25, casualties: [] });
  ok(sum.scrap === 25 + c.reward.scrap && st.scrap === scrap0 + sum.scrap, 'debrief scrap');
  ok(st.completed.includes(c.id) && !st.contracts.some((k) => k.id === c.id), 'debrief progress');
  ok(st.stash.some((i) => i.id === 'bandage'), 'debrief loot to stash');
  const ev = EVENTS[0];
  const res = resolveEventChoice(st, { level: 1 }, ev.choices[0], makeRng(9));
  ok(res.outcome.text.length > 0, 'travel event resolves');
  const stock = shopStock(st, 1);
  ok(stock.length > 5 && JSON.stringify(stock) === JSON.stringify(shopStock(st, 1)), 'shop stock deterministic');
  st.scrap = 1000;
  ok(buy(st, 'stimpak').ok && st.stash.some((i) => i.id === 'stimpak'), 'buy');
  ok(sellPrice('scrap_metal', st) >= 1, 'sell price');
  const day = st.day;
  restDay(st);
  ok(st.day === day + 1, 'rest day');
}

// ---------- HUD (HudState + SkirmishRules)
{
  const hud = new HudState();
  const pc = createCharacter({ name: 'Kruk', classId: 'soldier' });
  const foe = createEnemy('raider_thug');
  hud.party = [pc];
  const seen: string[] = [];
  const off = hud.on((c) => seen.push(c));
  hud.setAp(3);
  hud.pushLog('test', 'bad');
  ok(hud.ap === 3 && seen.includes('stats') && seen.includes('log') && hud.log[0].tone === 'bad', 'hud notifies');
  off();
  for (let i = 0; i < 400; i++) hud.pushLog('x' + i);
  ok(hud.log.length === 300 && hud.log[299].text === 'x399', 'hud log capped');
  const cmds: string[] = [];
  hud.onCommand((c) => cmds.push(c.kind));
  hud.command({ kind: 'endTurn' });
  ok(cmds[0] === 'endTurn' && hud.canAct, 'hud command + canAct');
  ok(plural(1, 'a', 'b', 'c') === 'a' && plural(3, 'a', 'b', 'c') === 'b' && plural(12, 'a', 'b', 'c') === 'c' && plural(22, 'a', 'b', 'c') === 'b', 'plural pl');
  ok(equipmentRows(pc).some((r) => r.name === 'Karabin') && backpackRows(pc).some((r) => r.usable), 'inventory rows');
  ok(statPairs(pc)[0][1] === `${pc.hp}/${pc.maxHp}` && hpTone(pc) === 'good', 'stat pairs');
  addCondition(pc, 'frightened', 2);
  ok(conditionChips(pc).some((c) => c.label === 'PRZ2' && c.bad), 'condition chips');
  const stim = pc.inventory.find((i) => i.id === 'stimpak');
  const frag = pc.inventory.find((i) => i.id === 'frag_grenade');
  ok(!!stim && itemTargeting(stim) === 'self' && !!frag && itemTargeting(frag) === 'foe', 'item targeting');
  const near = previewStrike(pc, foe, { gx: 0, gy: 0 }, { gx: 5, gy: 0 }, 0, true);
  const blind = previewStrike(pc, foe, { gx: 0, gy: 0 }, { gx: 5, gy: 0 }, 0, false);
  const map2 = previewStrike(pc, foe, { gx: 0, gy: 0 }, { gx: 5, gy: 0 }, 1, true);
  ok(near.ok && near.hit > 0 && near.hit <= 1 && !blind.ok && map2.mod === near.mod - 5, 'strike preview');
}

// ---------- ekrany startowe (core/frontend): stałoprzecinkowo, ticki 50 Hz
{
  ok(isin(0) === 0 && isin(64) === 16384 && isin(128) === 0 && isin(192) === -16384 && icos(0) === 16384 && isin(256 + 64) === 16384, 'sin LUT');
  ok(easeOut3(0) === 0 && easeOut3(Q12) === Q12 && EASE_OUT3_LUT[32] === Math.round((1 - 0.125) * Q12), 'ease LUT');
  let mono = true;
  for (let k = 1; k <= Q12; k++) if (easeOut3(k) < easeOut3(k - 1)) mono = false;
  ok(mono, 'ease monotonic');
  // IntRng = mulberry32 z rules/dice: below(n) == floor(makeRng() * n)
  const ir = new IntRng(1234), fr = makeRng(1234);
  let same = true;
  for (let i = 0; i < 1000; i++) if (ir.below(97) !== Math.floor(fr() * 97)) same = false;
  ok(same, 'IntRng matches makeRng');

  const clk = new TickClock();
  ok(clk.advance(10) === 0 && clk.advance(10) === 1 && clk.tick === 1 && clk.advance(1000) === 5 && clk.tick === 6, 'tick clock (50 Hz, clamp)');
  ok(clk.advance(30) === 1 && clk.alphaQ8 === 128, 'tick clock alpha');

  const tp = new TypeProgress(34, 34);
  tp.step(25);
  ok(tp.shown === 16 && !tp.done, 'type progress half second'); // 174/256 znaku na tick
  tp.step(100);
  ok(tp.done && tp.shown === 34, 'type progress done');

  // logo: syntetyczny obraz (jasny prostokąt na ciemnym tle)
  const rgb = new Uint8Array(LOGO_GW * LOGO_GH * 3);
  for (let y = 20; y < 70; y++) for (let x = 30; x < 130; x++) rgb.set([200, 120, 40], (y * LOGO_GW + x) * 3);
  const cubes = new LogoCubes(rgb);
  ok(cubes.count === 100 * 50, 'logo cube count');
  let sorted = true, bounded = true;
  for (let i = 0; i < cubes.count; i++) {
    if (i && cubes.land[i] < cubes.land[i - 1]) sorted = false;
    if (cubes.dur[i] > LOGO_MAX_DUR || cubes.land[i] !== cubes.delay[i] + cubes.dur[i]) bounded = false;
  }
  ok(sorted && bounded, 'logo cubes sorted by landing');
  const again = new LogoCubes(rgb);
  ok(again.delay.every((v, i) => v === cubes.delay[i]) && again.sx.every((v, i) => v === cubes.sx[i]), 'logo deterministic');
  const pose = { x: 0, y: 0, s: 0 };
  let seen = 0, landedAll = 0, flyOk = true;
  const flags = new Uint8Array(cubes.count);
  for (let t = 0; t <= 200 * 256; t += 64) {
    landedAll += cubes.drainLanded(t, (i) => (flags[i] = 1));
    cubes.forEachFlying(t, pose, (i, p) => {
      seen++;
      if (flags[i] || p.s < Q12 || p.s > Q12 + (Q12 * 8) / 5) flyOk = false;
    });
  }
  ok(landedAll === cubes.count && flags.every((f) => f === 1) && seen > 0 && flyOk, 'logo landed once, flying sane');
  // forEachFlying (z wczesnym przerwaniem) == pełne przejście przez pose()
  const c2 = new LogoCubes(rgb);
  let eq = true;
  for (let t = 0; t <= 160 * 256; t += 333) {
    c2.drainLanded(t, () => {});
    let a = 0, b = 0;
    c2.forEachFlying(t, pose, () => a++);
    for (let i = 0; i < c2.count; i++) if (c2.pose(i, t, pose)) b++;
    if (a !== b) eq = false;
  }
  ok(eq, 'logo flying early-exit exact');
  const show = new LogoShow(null);
  let evs = 0;
  for (let t = 0; t < 400; t++) evs |= show.update(t);
  ok(evs === (LogoEvent.REVEAL | LogoEvent.DONE) && show.update(500) === 0, 'logo show events once');

  // intro
  const fl = new IntroFlow(3, 10, 4);
  ok(fl.press(false) === IntroAction.SKIP_TEXT && fl.press(true) === IntroAction.FADE_OUT && fl.switching && fl.press(true) === IntroAction.NONE, 'intro press');
  let a = 0;
  for (let i = 0; i < 4; i++) a = fl.tick(true);
  ok(a === IntroAction.SHOW && fl.index === 1 && !fl.switching, 'intro switch');
  let auto = 0;
  for (let i = 0; i < 11; i++) auto = fl.tick(true);
  ok(auto === IntroAction.FADE_OUT, 'intro auto advance');
  for (let i = 0; i < 4; i++) fl.tick(true);
  ok(fl.index === 2 && fl.press(true) === IntroAction.FINISH && fl.skip() === IntroAction.FINISH, 'intro finish');

  // menu
  const m = titleMenu(false);
  ok(m.focused?.id === 'new' && m.items.length === 5, 'menu without save');
  m.move(-1);
  ok(m.focused?.id === 'quit', 'menu wraps up');
  m.move(-1);
  ok(m.focused?.id === 'credits', 'menu moves up');
  m.move(1);
  m.move(1);
  m.move(1);
  ok(m.activate() === 'options', 'menu move/activate');
  const ms = titleMenu(true);
  ok(ms.focused?.id === 'continue', 'menu focuses continue');
  ms.items[0].enabled = false;
  ms.move(-1);
  ok(ms.focused?.id === 'quit' && !ms.setFocus(0), 'menu skips disabled');
}

// ---------- animacje ekranów (core/frontend/fx.ts)
{
  // fala: sin(w t) z tablicy w pobliżu Math.sin (rozdzielczość kąta 1/256 obrotu)
  const W = angQ8(3);
  let maxErr = 0;
  for (let t = 0; t < 600 * 256; t += 997) maxErr = Math.max(maxErr, Math.abs(wave(t, W) / 16384 - Math.sin((3 * t) / secToQ8(1))));
  ok(maxErr < 0.03, `wave ~ Math.sin (err ${maxErr.toFixed(4)})`);
  ok(phaseAt(0x7fffff00, angQ8(23)) >= 0 && phaseAt(0x7fffff00, angQ8(23)) < 256, 'phase wraps without overflow');
  const ac = new ApproachCurve(0.45);
  let acErr = 0;
  for (let s = 0; s < 25; s += 0.37) acErr = Math.max(acErr, Math.abs(ac.at(secToQ8(s)) / Q12 - (1 - Math.exp(-0.45 * s))));
  ok(ac.at(-5) === 0 && acErr < 0.01, 'approach curve ~ 1-exp');
  ok(progressQ12(0, 100, 5120) === 0 && progressQ12(100 + 2560, 100, 5120) === 2048 && progressQ12(1e6, 100, 5120) === Q12, 'progress Q12');
  let fk = true;
  for (let t = 0; t < 20000; t += 37) for (let i = 0; i < 4; i++) { const k = flameKQ12(t, i); if (k < 1400 || k > 4700) fk = false; }
  const gl = [0, 1000, 5000].map(glowAlphaQ8);
  ok(fk && gl.every((a) => a >= 20 && a <= 46), 'campfire curves in range');
  // pył: deterministyczny, zawsze w prostokącie
  const box = { x: 10, y: 20, w: 100, h: 50 };
  const m1 = new MoteField(60, box, 18, -9, 7), m2 = new MoteField(60, box, 18, -9, 7);
  let inside = true;
  for (let k = 0; k < 2000; k++) {
    m1.step();
    m2.step();
    for (let i = 0; i < m1.n; i++) if (m1.x[i] < 10 * Q8 || m1.x[i] >= 110 * Q8 || m1.y[i] < 20 * Q8 || m1.y[i] >= 70 * Q8) inside = false;
  }
  ok(inside && m1.x.every((v, i) => v === m2.x[i]) && m1.y.every((v, i) => v === m2.y[i]), 'motes wrap + deterministic');
  ok(blinkAlphaQ8(0) === 256 && blinkAlphaQ8(6) === 115 && blinkAlphaQ8(100) === 256 && blinkAlphaQ8(242) === 256, 'blink alpha');
  // kafle tekstur pod miniGL: 480x270 -> 4 kafle, tekstury potęgi dwójki <= 256
  const tl = potTiles(480, 270);
  ok(nextPow2(224) === 256 && nextPow2(14) === 16 && nextPow2(256) === 256, 'nextPow2');
  ok(tl.length === 4 && tl.every((t) => t.texW <= 256 && t.texH <= 256 && t.w <= t.texW && t.h <= t.texH && (t.texW & (t.texW - 1)) === 0 && (t.texH & (t.texH - 1)) === 0), 'pot tiles');
  ok(tl.reduce((a, t) => a + t.w * t.h, 0) === 480 * 270 && tilesBytes16(tl) === (256 * 256 * 2 + 256 * 16 * 2) * 2, 'pot tiles cover + bytes');
}

// ---- region kampanii: teren z wysokościami, sektory, trasy (port worldterrain.js / worldmap.js)
{
  ok([0, 1, 15, 16, 17, 99, 100, 65535, 65536, 2147395600].every((n) => isqrt(n) === Math.floor(Math.sqrt(n))), 'isqrt');
  const H = (x: number, z: number): number => heightQ8(Math.round(x * WQ), Math.round(z * WQ)) / WQ;
  ok(heightGrid().length === 145 * 97, 'height grid size');
  ok(H(-13, -13) > 4 && Math.abs(H(2.5, 2)) < 0.2 && H(19.5, -6) < -1 && H(25, 2) > 1.5 && Math.abs(H(-17, 8)) < 0.3, 'terrain: mountains / flat city / crater / mesa / home');
  let maxErr = 0;
  for (let i = 0; i < 400; i++) { const x = -30 + (i % 20) * 3.1, z = -20 + Math.floor(i / 20) * 2.1; maxErr = Math.max(maxErr, Math.abs(H(x, z) - regionHeightF(x, z))); }
  ok(maxErr < 0.6, `baked height ~ float terrain (max err ${maxErr.toFixed(2)})`);
  ok(inCity(CITY) && !inCity(HOME) && !inCity(GATE), 'inCity');
  // trasy: do miasta przez bramę, poza miastem nigdy przez ruiny, czas jak w Oldgame
  let gateOk = true, avoid = true, ends = true, mono = true, ticksOk = true;
  for (const s of SECTORS)
    s.spots.forEach((sp, i) => {
      const r = buildRoute(sp, s.id, i);
      for (let k = 1; k < r.n; k++) if (r.cum[k] < r.cum[k - 1]) mono = false;
      const a = routePointAt(r, 0), b = routePointAt(r, r.len);
      if (a.x !== HOME.x || a.z !== HOME.z || Math.abs(b.z - sp.z) > 8 || Math.abs(b.x - sp.x) > WQ / 2) ends = false;
      if (s.id === 'ruins') {
        let near = false;
        for (let k = 0; k < r.n; k++) if (Math.abs(r.x[k] - GATE.x) < WQ / 4 && Math.abs(r.z[k] - GATE.z) < WQ / 4) near = true;
        if (!near || r.trackFrom <= 0) gateOk = false;
      } else for (let k = 0; k < r.n; k++) if (inCity({ x: r.x[k], z: r.z[k] })) avoid = false;
      const t = routeTicks(r);
      if (t < 400 || Math.abs(t - Math.max(400, Math.round((r.len / WQ / 2.1) * 50))) > 2) ticksOk = false;
    });
  ok(gateOk && avoid && ends && mono && ticksOk, 'routes: gate / avoid city / endpoints / monotonic / ticks');
  const sp = contractSpots([{ id: 'a', biome: 'ruins' }, { id: 'b', biome: 'ruins' }, { id: 'c', biome: 'bunker' }]);
  ok(sp.get('a') === PLAZAS[0] && sp.get('b') === PLAZAS[1] && sp.get('c') === SECTORS[3].spots[0], 'contract spots');
}

// ---- kości obrażeń / leczenia, zamki i hakowanie (PF2e)
{
  const r = roll('2d6+1d4+3', makeRng(7));
  ok(r.dice.length === 3 && r.dice[0].sides === 6 && r.dice[2].sides === 4 && r.total === r.dice.reduce((s, x) => s + x.value, 0) + 3, 'roll: dice with sides');
  ok(fmtDamage({ dice: [{ sides: 6, value: 4 }, { sides: 6, value: 2 }], flat: 3, mult: 2, post: [{ sides: 10, value: 5 }], total: 23 }) === '(4+2+3) ×2 +5 = 23', 'fmtDamage');
  // trafienie ma rzut obrażeń zgodny z sumą (przed odpornościami)
  let dmgOk = true;
  for (let i = 0; i < 60; i++) {
    const att = createCharacter({ name: 'A', classId: 'scout', ancestry: 'human' });
    const def = createEnemy('raider_thug');
    const res = strike(att, def, { rng: makeRng(100 + i) });
    if (res.hit && (!res.dmg || !res.dmg.dice.length || res.dmg.dice.some((x) => x.value < 1 || x.value > x.sides))) dmgOk = false;
    if (!res.hit && res.dmg) dmgOk = false;
  }
  ok(dmgOk, 'strike: dmg roll recorded on hit only');

  ok(LOCKS.poor.dc === 15 && LOCKS.simple.successes === 3 && LOCKS.superior.dc === 40, 'locks: PF2e table');
  const thief = createCharacter({ name: 'T', classId: 'scavenger', ancestry: 'human' });
  thief.inventory.push(newItem('lockpick', 2));
  ok(hasLockpick(thief), 'lockpick item');
  const lk = lockState('poor');
  let tries = 0, broke = 0;
  const lrng = makeRng(99);
  while (lk.progress < lk.needed && tries < 60) {
    const at = pickLock(thief, lk, 'thievery', lrng);
    if (at.gained !== (at.roll.degree === 3 ? 2 : at.roll.degree === 2 ? 1 : 0)) tries = 999;
    if (at.brokeTool) broke++;
    tries++;
  }
  ok(lk.progress === lk.needed && tries < 60, 'pickLock: opens after enough successes');
  ok(thief.inventory.filter((i) => i.id === 'lockpick').reduce((s, i) => s + i.qty, 0) === Math.max(0, 2 - broke), 'pickLock: crit fail breaks lockpick');
  const bare = createCharacter({ name: 'B', classId: 'scavenger', ancestry: 'human' });
  const a1 = pickLock(bare, lockState('simple'), 'thievery', makeRng(3));
  ok(a1.improvised && a1.roll.mod === getStat(bare, 'thievery') - 2, 'pickLock: improvised -2');
  const f = pickLock(bare, lockState('poor'), 'athletics', makeRng(4));
  ok(f.roll.dc === 20 && (f.roll.degree >= 2) === f.opened, 'forceOpen: DC+5, one check');
  const dv = deviceState('server', 2);
  ok(dv.dc === dcForLevel(4) && dv.needed === DEVICES.server.successes, 'device: DC by level');
  let alarm = false, opened = false;
  for (let i = 0; i < 40 && !opened && !alarm; i++) {
    const at = hackDevice(thief, dv, 'crafting', makeRng(500 + i));
    alarm = at.alarm;
    opened = at.opened;
    if (at.alarm && !dv.jammed) alarm = false;
  }
  ok(opened || (alarm && dv.jammed), 'hack: opens or locks out with alarm');
  ok(['poor', 'simple'].includes(lockForLevel(1, makeRng(1))), 'lockForLevel 1');

  // misja: drzwi i urządzenie (dodawane ręcznie - mapy dodadzą je później)
  const c0 = generateContracts(freshState(), makeRng(5))[0];
  const mp = [createCharacter({ name: 'X', classId: 'scavenger', ancestry: 'human' })];
  mp[0].inventory.push(newItem('lockpick', 3));
  const ms = new Mission(c0, mp, makeRng(8));
  const pc = ms.pcs[0];
  let fx = -1, fy = -1;
  for (let dy = -1; dy <= 1 && fx < 0; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && ms.grid.isFree(pc.gx + dx, pc.gy + dy) && !ms.thingAt(pc.gx + dx, pc.gy + dy)) { fx = pc.gx + dx; fy = pc.gy + dy; break; }
  if (fx >= 0) {
    const door = ms.addLockedDoor(fx, fy, 'poor');
    ok(!ms.grid.isFree(fx, fy), 'door blocks cell');
    let sig = 0;
    ms.on((s) => { if (s.kind === 'lock') sig++; });
    for (let i = 0; i < 40 && !door.done; i++) ms.interact(pc, door, 'thievery');
    ok(door.done && ms.grid.isFree(fx, fy) && sig > 0, 'mission: door opened, cell freed, signals');
    ok(!ms.interact(pc, door), 'mission: door needs skill');
  } else ok(false, 'no free cell for door test');
}

// ---------------- zapis misji (Mission.snapshot -> new Mission(..., snap))
{
  const st = freshState();
  st.party = ['soldier', 'scout', 'medic'].map((c, i) => createCharacter({ name: `Z${i}`, classId: c as ClassId, ancestry: 'human' }));
  const contract = { id: 'save-test', title: 'Uwolnij jeńca', type: 'rescue', level: 2, biome: 'ruins', enemies: ['raider_thug', 'raider_gunner'], objective: { type: 'rescue' } } as unknown as Contract;
  const m1 = new Mission(contract, st.party, makeRng(11));
  m1.steps = 7;
  m1.scrap = 33;
  m1.enemies[0].ch.hp = 1;
  if (m1.things[0]) m1.things[0].done = true;
  const snap = JSON.parse(JSON.stringify(m1.snapshot()));
  ok(snap && snap.version === 1 && snap.contractId === 'save-test', 'snapshot: created in exploration');
  const m2 = new Mission(contract, st.party, makeRng(99), snap);
  ok(m2.pcs.length === m1.pcs.length && m2.pcs.every((a, i) => a.ch === st.party[i] && a.gx === m1.pcs[i].gx && a.gy === m1.pcs[i].gy), 'restore: party = campaign characters, same positions');
  ok(m2.enemies.length === m1.enemies.length && m2.enemies.every((e, i) => e.gx === m1.enemies[i].gx && e.ch.hp === m1.enemies[i].ch.hp && e.group === m2.groups[m1.groups.indexOf(m1.enemies[i].group!)]), 'restore: enemies, hp, groups');
  ok(m2.things.length === m1.things.length && m2.things.every((t, i) => t.done === m1.things[i].done && t.gx === m1.things[i].gx), 'restore: things');
  ok(!!m2.captive && m2.captive.actor === m2.neutral[0] && m2.captive.gx === m1.captive!.gx, 'restore: captive linked to neutral actor');
  ok(m2.steps === 7 && m2.scrap === 33 && m2.explored.every((v, i) => v >= m1.explored[i]), 'restore: counters, explored');
  ok(Array.from(m2.grid.cells).every((v, i) => v === m1.grid.cells[i]), 'restore: grid cells');
  m1.mode = 'combat';
  ok(m1.snapshot() === null, 'snapshot: none during combat');
}

// ---------- zapasy żywności i zlecenie zaopatrzenia
{
  const st = freshState();
  st.party = [createCharacter({ name: 'A', classId: 'soldier', ancestry: 'human' }), createCharacter({ name: 'B', classId: 'medic', ancestry: 'human' })];
  ok(st.food > FOOD_LOW, 'food: start above low threshold');
  st.food = 10;
  const noLoss = (): number => 0.99;
  const r1 = consumeFood(st, 3, noLoss);
  ok(st.food === 7 && r1.used === 3 && r1.hungry === 0, 'food: 1 day of supplies per day');
  st.food = 1;
  const rep0 = st.rep.survivors;
  const r2 = consumeFood(st, 3, noLoss);
  ok(st.food === 0 && r2.hungry === 2 && st.rep.survivors === rep0 - 2, 'food: hunger lowers survivors reputation');
  ok(addFood(st, 99) === FOOD_MAX && st.food === FOOD_MAX, 'food: granary capped');
  // brak żywności = zaopatrzenie zawsze na tablicy, pełny spichrz = brak
  st.food = 2;
  st.contracts = generateContracts(st, makeRng(5));
  const fc = st.contracts.find((c) => c.type === 'forage');
  ok(!!fc && (fc.reward.food ?? 0) > 0 && fc.faction === 'survivors', 'forage: contract on board when food is low, with food reward');
  st.food = FOOD_MAX;
  refreshBoard(st, 3, makeRng(6));
  ok(!st.contracts.some((c) => c.type === 'forage'), 'forage: removed from board when granary is full');
  for (let i = 0; i < 20; i++) {
    st.food = 3;
    const b = generateContracts(st, makeRng(100 + i));
    if (b.filter((c) => c.type === 'forage').length !== 1) ok(false, 'forage: exactly one on low food board');
  }
  // misja zaopatrzenia: skrzynie z żywnością, zebranie wszystkich = cel, potem ewakuacja
  const c = makeContract('forage', 1, st, makeRng(8));
  const m = new Mission(c, st.party, makeRng(9));
  ok(m.supplies.length >= 3 && m.supplies.every((x) => x.kind === 'item' && x.objective && !m.inExtraction(x)), 'forage mission: supply caches placed outside entry zone');
  ok(m.needsExtraction(), 'forage mission: needs extraction');
  const pc = m.pcs[0];
  for (const [i, sup] of m.supplies.entries()) {
    const adj = m.interactCell(pc, sup) ?? { gx: sup.gx, gy: sup.gy + 1 };
    pc.gx = adj.gx;
    pc.gy = adj.gy;
    ok(m.interact(pc, sup), `forage mission: pick up supplies ${i + 1}`);
    ok(m.objectiveDone() === (i === m.supplies.length - 1), `forage mission: objective only after all supplies (${i + 1})`);
  }
  ok(!m.loot.some((x) => x.id === 'canned_food'), 'forage mission: supplies go to the granary, not the backpack');
  const snap = JSON.parse(JSON.stringify(m.snapshot()));
  const m2 = new Mission(c, st.party, makeRng(9), snap);
  ok(m2.supplies.length === m.supplies.length && m2.supplies.every((x) => x.done), 'forage mission: save/restore supplies');
  const res = m.finish('success');
  ok(res.supplies?.got === m.supplies.length, 'forage mission: result counts supplies');
  st.contracts.push(c);
  st.food = 2;
  const sum = applyMissionResult(st, res, c);
  ok(sum.food === c.reward.food && st.food === 2 + c.reward.food! - c.travelDays, 'forage debrief: food added, travel days eaten');
  // odwrót z częścią zapasów: żywność proporcjonalnie
  const st2 = freshState();
  st2.party = st.party;
  st2.food = 1;
  const part = applyMissionResult(st2, { contractId: c.id, result: 'retreat', xp: 0, loot: [], scrap: 0, casualties: [], supplies: { got: 1, total: 3 } }, { ...c, reward: { ...c.reward, food: 9 } });
  ok(part.food === 3, 'forage debrief: retreat gives food per collected cache');
  const st3 = freshState();
  st3.food = 5;
  restDay(st3);
  ok(st3.food <= 4 && st3.day === 2, 'rest day eats supplies');
}

// ---------------- wraki pojazdów: rozbieranie na złom, hałas, wybuch baku
{
  const st = freshState();
  st.party = [createCharacter({ name: 'Złomiarz', classId: 'scavenger', ancestry: 'human' }), createCharacter({ name: 'Kruk', classId: 'soldier', ancestry: 'human' })];
  const foes = Object.keys(ENEMIES).slice(0, 2) as EnemyId[];
  let tried = 0, wrecksSeen = 0, success = 0, partsBurnt = 0, noiseOk = true, scrapOk = true;
  for (let k = 0; k < 40; k++) {
    const c = { id: `wreck-${k}`, type: 'eliminate', level: 2, biome: 'ruins', enemies: foes, reward: 0 } as unknown as Contract;
    for (const ch of st.party) ch.hp = ch.maxHp; // rany z poprzednich prób
    const m = new Mission(c, st.party, makeRng(300 + k));
    const props = m.map.props.filter((p) => p.type === 'car' || p.type === 'bus');
    const wr = m.things.filter((t) => t.kind === 'wreck');
    if (wr.length !== props.length) ok(false, `wrecks: one per car/bus prop (${k})`);
    if (wr.some((w) => w.burnt !== (props.find((p) => p.gx === w.gx && p.gy === w.gy)!.seed % 10 < 3))) ok(false, 'wrecks: burnt flag shared with art');
    wrecksSeen += wr.length;
    const w = wr[0];
    if (!w) continue;
    const pc = m.pcs[0];
    const adj = m.interactCell(pc, w);
    if (!adj) continue;
    pc.gx = adj.gx;
    pc.gy = adj.gy;
    const before = m.scrap, hp = pc.ch.hp;
    let sig: { scrap: number; items: unknown[]; hurt: number; noise: number; roll: { degree: number } } | null = null;
    m.on((s) => { if (s.kind === 'salvage') sig = s; });
    const alertedBefore = m.groups.map((g) => g.alerted);
    ok(m.interact(pc, w), 'wreck: salvage works next to wreck');
    tried++;
    const s = sig as unknown as { scrap: number; items: unknown[]; hurt: number; noise: number; roll: { degree: number } };
    ok(!!s && w.done, 'wreck: salvage signal, wreck used up');
    if (!s) continue;
    ok(!m.interact(pc, w), 'wreck: can be salvaged only once');
    if (m.scrap - before !== s.scrap) scrapOk = false;
    if (s.roll.degree === 0 && (s.scrap !== 0 || pc.ch.hp !== hp - s.hurt)) scrapOk = false;
    if (s.roll.degree >= 2) success++;
    if (w.burnt && s.items.length) partsBurnt++;
    // hałas: każda nieświadoma grupa z kimś w promieniu zostaje zaalarmowana
    m.groups.forEach((g, i) => {
      const near = g.actors.some((e) => e.state !== 'dead' && Math.max(Math.abs(e.gx - pc.gx), Math.abs(e.gy - pc.gy)) <= s.noise);
      if (!alertedBefore[i] && near && !g.alerted) noiseOk = false;
    });
  }
  ok(wrecksSeen > 0 && tried > 10, `wrecks: ruins maps have salvageable wrecks (${wrecksSeen}, tried ${tried})`);
  ok(success > 0, 'wreck: some salvages succeed');
  ok(scrapOk, 'wreck: scrap added / crit failure hurts and gives nothing');
  ok(partsBurnt === 0, 'wreck: burnt wrecks give no parts');
  ok(noiseOk, 'wreck: salvage noise alerts groups in radius');

  // wybuch baku: ogień w promieniu 1, wrak spalony; spalone nie wybuchają; zapis / odczyt stanu
  const c = { id: 'wreck-blast', type: 'eliminate', level: 2, biome: 'ruins', enemies: foes, reward: 0 } as unknown as Contract;
  let m: InstanceType<typeof Mission> | null = null;
  for (let k = 0; k < 30 && !m; k++) {
    const t = new Mission({ ...c, id: `wreck-blast-${k}` }, st.party, makeRng(500 + k));
    if (t.things.some((x) => x.kind === 'wreck' && !x.burnt) && t.things.some((x) => x.kind === 'wreck' && x.burnt)) m = t;
  }
  ok(!!m, 'wreck blast: map with burnt and intact wrecks');
  if (m) {
    const live = m.things.find((x) => x.kind === 'wreck' && !x.burnt)!;
    const pc = m.pcs[0];
    const adj = m.interactCell(pc, live) ?? { gx: live.gx, gy: live.gy + 1 };
    pc.gx = adj.gx;
    pc.gy = adj.gy;
    const hp = pc.ch.hp;
    let blast = false;
    m.on((s) => { if (s.kind === 'wreckBlast' && s.thing === live) blast = s.hits.some((h) => h.actor === pc && h.dmg > 0); });
    m.explodeWreck(live);
    ok(live.exploded && live.burnt && live.done && blast && pc.ch.hp < hp, 'wreck blast: fire damage nearby, wreck burnt out');
    const dead = m.things.find((x) => x.kind === 'wreck' && x.burnt && !x.exploded)!;
    for (let i = 0; i < 50; i++) m.igniteWrecks(dead, 0);
    ok(!dead.exploded, 'wreck blast: burnt wrecks never explode');
    const snap = JSON.parse(JSON.stringify(m.snapshot()));
    const m2 = new Mission(m.contract, st.party, makeRng(1), snap);
    const r2 = m2.things.find((x) => x.kind === 'wreck' && x.gx === live.gx && x.gy === live.gy);
    ok(!!r2?.exploded && r2.done, 'wreck: state survives save/restore');
    snap.things = snap.things.filter((x: { kind: string }) => x.kind !== 'wreck');
    const m3 = new Mission(m.contract, st.party, makeRng(1), snap);
    ok(m3.things.filter((x) => x.kind === 'wreck').length === m.things.filter((x) => x.kind === 'wreck').length, 'wreck: old saves get wrecks re-added');
  }
}

// ------------------------------------------------------------ warsztat (campaign/tech.ts)
{
  const st = freshState();
  st.party = [createCharacter({ name: 'Lut', classId: 'techie', ancestry: 'human' })];
  st.scrap = 500;
  st.food = 20;
  ok(RECIPES.every((r) => (ITEMS as Record<string, unknown>)[r.out.id] && r.parts.every((p) => (ITEMS as Record<string, unknown>)[p.id])), 'tech: recipes reference real items');
  ok(RECIPES.every((r) => r.level < WORKSHOP_LEVELS.length), 'tech: recipe levels exist');
  // stary zapis bez pola tech
  const old = JSON.parse(JSON.stringify(st));
  delete old.tech;
  const t0 = techOf(old);
  ok(t0.known.length === 0 && t0.level === 0 && Array.isArray(t0.parts), 'tech: old saves get empty workshop');
  ok(!shopStock({ day: 3 }, 5).includes('time_bomb') && !shopStock({ day: 3 }, 5).includes('dynamite_charge'), 'tech: exclusive items not in random stock');
  ok(recipeState(st, 'time_bomb') === 'unknown', 'tech: unknown recipe without parts');
  st.stash.push(newItem('old_watch'), newItem('dynamite'));
  ok(recipeState(st, 'time_bomb') === 'hinted', 'tech: half of parts hints the recipe');
  ok(researchBlock(st, 'time_bomb') !== null, 'tech: level 1 recipe blocked at level 0');
  st.stash.push(newItem('copper_wire'), newItem('copper_wire'));
  ok(partUses('old_watch').some((r) => r.id === 'time_bomb'), 'tech: part uses lists the recipe');
  // magazyn warsztatu: część oddana ze skrytki liczy się dalej
  const wire = st.stash.find((i) => i.id === 'copper_wire')!;
  ok(storePart(st, wire, st.stash) && techOf(st).parts.length === 1 && partCount(st, 'copper_wire') === 2, 'tech: stored part still counts');
  ok(!storePart(st, newItem('trophy_teeth'), st.stash), 'tech: non-part cannot be stored');
  // opracowanie: przy pewnym sukcesie (rng 0.99 -> nat 20)
  const day0 = st.day, scrap0 = st.scrap;
  const r = research(st, 'dynamite_charge', () => 0.99);
  ok(r.ok && r.learned && techOf(st).known.includes('dynamite_charge'), 'tech: research learns schematic');
  ok(st.day === day0 + r.days! && st.scrap === scrap0 - recipeDef('dynamite_charge')!.scrap, 'tech: research costs days and scrap');
  ok(partCount(st, 'dynamite') === 0 && partCount(st, 'copper_wire') === 1, 'tech: research consumes parts (workshop first)');
  ok(techOf(st).parts.length === 0, 'tech: workshop store used before stash');
  ok(st.stash.some((i) => i.id === 'dynamite_charge'), 'tech: first copy free');
  ok(shopStock(st, 1).includes('dynamite_charge'), 'tech: trader stocks researched item');
  ok(!research(st, 'dynamite_charge').ok, 'tech: cannot research twice');
  // produkcja
  ok(!craft(st, 'dynamite_charge').ok, 'tech: craft needs parts');
  st.stash.push(newItem('dynamite'));
  const s1 = st.scrap;
  const c = craft(st, 'dynamite_charge');
  ok(c.ok && st.scrap === s1 - craftCost(recipeDef('dynamite_charge')!) && partCount(st, 'dynamite') === 0, 'tech: craft uses parts and scrap');
  ok(!craft(st, 'time_bomb').ok, 'tech: craft needs known schematic');
  // krytyczna porażka: część przepada, schemat nie powstaje
  st.stash.push(newItem('fuel_can'));
  const f = research(st, 'molotov', () => 0);
  ok(f.ok && !f.learned && partCount(st, 'fuel_can') === 0 && !techOf(st).known.includes('molotov'), 'tech: critical failure destroys a part');
  // rozbudowa: 3 schematy + akumulator
  ok(!upgradeWorkshop(st).ok, 'tech: upgrade needs schematics');
  st.stash.push(newItem('fuel_can'), newItem('scrap_metal'), newItem('scrap_metal'), newItem('copper_wire'));
  research(st, 'molotov', () => 0.99);
  research(st, 'lockpick', () => 0.99);
  ok(techOf(st).known.length === 3 && nextLevel(st)!.missing.length === 1, 'tech: upgrade still needs battery');
  st.stash.push(newItem('battery'));
  ok(upgradeWorkshop(st).ok && techOf(st).level === 1 && partCount(st, 'battery') === 0, 'tech: upgrade consumes key part');
  st.stash.push(newItem('old_watch'), newItem('dynamite'), newItem('copper_wire'));
  ok(research(st, 'time_bomb', () => 0.99).learned, 'tech: level 1 recipe after upgrade');
  ok(noFn(st), 'tech: state stays JSON-safe');
}

console.log(`\n${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
