import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCharacterEitr } from '../character/eitr-resolver.mjs';
import { DEFAULT_SETTINGS, LIMITS, normalizeSettings, updateSetting, loadSettings,
  serializeSettings, applyCharacterSnapshot, simulationInput, optimizationIsCurrent } from './settings.mjs';
import { graphData } from './graph.mjs';
import { eitrAtSegment, simulateEmbers } from './simulator.mjs';

const catalog = JSON.parse(readFileSync(new URL('../data/character-builder.json', import.meta.url), 'utf8'));
const build = { gear: { head: { name: 'Eitr-weave hood', quality: 2 },
  chest: { name: 'Eitr-weave robe', quality: 1 },
  legs: { name: 'Eitr-weave trousers', quality: 4 } },
foods: ['Seeker Aspic', 'Yggdrasil Porridge', 'Stuffed Mushroom'], hide: true };

test('Character Builder snapshot resolves exact food Eitr and weave slots', () => {
  const snapshot = resolveCharacterEitr(build, catalog);
  assert.equal(snapshot.maxEitr, 240);
  assert.deepEqual(snapshot.eitrWeave, { hood: true, robe: true, trousers: true });
  assert.deepEqual(snapshot.foodNames, build.foods);
  assert.equal(snapshot.warnings.length, 0);
});

test('invalid, duplicate, and hidden saved entries are ignored safely', () => {
  const snapshot = resolveCharacterEitr({ gear: { head: { name: 'Eitr-weave hood', quality: 99 },
    chest: { name: 'Eitr-weave hood', quality: 1 } },
  foods: ['Seeker Aspic', 'Seeker Aspic', 'Sizzling Berry Broth'], hide: true }, catalog);
  assert.equal(snapshot.maxEitr, 85);
  assert.deepEqual(snapshot.eitrWeave, { hood: false, robe: false, trousers: false });
  assert.equal(snapshot.warnings.length, 3);
  assert.throws(() => resolveCharacterEitr(null, catalog));
  assert.throws(() => resolveCharacterEitr({ ...build, foods: 'bad' }, catalog));
  assert.throws(() => resolveCharacterEitr({ ...build, hide: 'false' }, catalog));
});

test('import is a separate snapshot and never mutates Character Builder selection', () => {
  const original = structuredClone(build);
  const snapshot = resolveCharacterEitr(build, catalog);
  const settings = applyCharacterSnapshot(DEFAULT_SETTINGS, snapshot);
  assert.equal(settings.maxEitr, 240);
  assert.equal(settings.startingEitr, 240);
  assert.equal(settings.hood, true);
  const edited = updateSetting(settings, 'maxEitr', 40);
  assert.equal(edited.startingEitr, 40);
  assert.equal(edited.threshold, 35);
  assert.deepEqual(build, original);
  assert.equal(settings.maxEitr, 240);
});

test('settings bounds clamp linked values and reject invalid numbers', () => {
  const smaller = normalizeSettings({ ...DEFAULT_SETTINGS, maxEitr: 20,
    startingEitr: 100, threshold: 35, castInterval: 0.2, attackDuration: 0.5 });
  assert.equal(smaller.startingEitr, 20);
  assert.equal(smaller.threshold, 20);
  assert.equal(smaller.attackDuration, 0.2);
  assert.deepEqual(LIMITS.skillLevel, [0, 100]);
  for (const value of [NaN, Infinity, -1, 1001, '35']) {
    assert.throws(() => updateSetting(DEFAULT_SETTINGS, 'maxEitr', value));
  }
  assert.throws(() => updateSetting(DEFAULT_SETTINGS, 'unknown', 1));
});

test('versioned persistence falls back safely and preserves valid settings', () => {
  const edited = updateSetting(DEFAULT_SETTINGS, 'skillLevel', 73);
  assert.deepEqual(loadSettings(serializeSettings(edited)), { settings: edited, restored: true });
  for (const raw of ['{bad', '{"version":2,"settings":{}}',
    '{"version":1,"settings":{"skillLevel":900}}']) {
    assert.deepEqual(loadSettings(raw), { settings: { ...DEFAULT_SETTINGS }, restored: false });
  }
});

test('optimization results become stale after any relevant settings change', () => {
  const captured = { ...DEFAULT_SETTINGS };
  assert.equal(optimizationIsCurrent(captured, { ...DEFAULT_SETTINGS }), true);
  assert.equal(optimizationIsCurrent(captured, updateSetting(DEFAULT_SETTINGS, 'rested', true)), false);
  assert.equal(optimizationIsCurrent(null, DEFAULT_SETTINGS), false);
});

test('manual cost override bypasses skill scaling only when enabled', () => {
  const defaultInput = simulationInput({ ...DEFAULT_SETTINGS, skillLevel: 100 });
  const override = simulationInput({ ...DEFAULT_SETTINGS, skillLevel: 100, manualCost: true, baseCost: 23.45 });
  assert.ok(Math.abs(simulateEmbers(defaultInput).cost - 23.45) < 1e-12);
  assert.equal(simulateEmbers(override).cost, 23.45);
  assert.equal(override.skillReductionAt100, 0);
});

test('graph samples use exact engine segment values and bound rendered events', () => {
  const result = simulateEmbers({ ...simulationInput(DEFAULT_SETTINGS), duration: 120 });
  const graph = graphData(result, 60);
  assert.equal(graph.end, 60);
  assert.ok(graph.casts.length <= 80);
  for (const segment of graph.segments) {
    assert.ok(segment.points.length <= 9);
    const original = result.segments.find(s =>
      s.start === segment.points[0].time && s.kind === segment.kind);
    assert.ok(original);
    for (const point of segment.points) {
      assert.ok(Math.abs(point.eitr - eitrAtSegment(original, point.time)) < 1e-8);
    }
  }
  assert.throws(() => graphData(result, -1));
});
