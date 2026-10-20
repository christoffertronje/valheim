import test from 'node:test';
import assert from 'node:assert/strict';
import {
  eitrCost, regenerationMultiplier, regenerationRate, recoverEitr, recoveryTime,
  simulateEmbers, optimizeThreshold, eitrAtSegment, MAX_OPTIMIZER_CANDIDATES,
} from './simulator.mjs';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const setup = { maxEitr: 100, startingEitr: 100, duration: 20, castInterval: 1, attackDuration: 0.4, threshold: 35 };

test('regeneration rate uses the current/max ratio, including zero and cap', () => {
  near(regenerationRate(0, 100), 4);
  near(regenerationRate(50, 100), 3);
  near(regenerationRate(100, 100), 2);
  near(regenerationRate(0, 0), 0);
  near(regenerationRate(50, 100, 3), 9);
});

test('analytical recovery and inverse crossing agree without fixed steps', () => {
  const expected = 200 - 180 * Math.exp(-2 / 100);
  near(recoverEitr(20, 100, 1, 1), expected);
  const crossing = recoveryTime(20, 75, 100, 1.5);
  near(recoverEitr(20, 100, 1.5, crossing), 75);
  near(recoverEitr(99, 100, 3, 100), 100);
  assert.equal(recoveryTime(0, 10, 100, 0), Infinity);
});

test('simulation schedules a threshold crossing at its analytical time', () => {
  const result = simulateEmbers({ maxEitr: 100, startingEitr: 35, baseCost: 35,
    threshold: 35, duration: 12, castInterval: 1, attackDuration: 0,
    regenDelay: 1 });
  near(result.casts[0].start, 0);
  near(result.casts[1].start, 1 + 50 * Math.log(200 / 165));
  assert.ok(result.timeline.every((point, i, points) => i === 0 || point.time >= points[i - 1].time));
});

test('Rested and Eitr-weave bonuses add to the configured base multiplier', () => {
  near(regenerationMultiplier({}), 1);
  near(regenerationMultiplier({ rested: true }), 2);
  near(regenerationMultiplier({ eitrWeave: { hood: true } }), 1.2);
  near(regenerationMultiplier({ eitrWeave: { robe: true, trousers: true } }), 1.8);
  near(regenerationMultiplier({ rested: true, eitrWeave: { hood: true, robe: true, trousers: true } }), 3);
  near(regenerationMultiplier({ baseRegenMultiplier: 1.25, rested: true }), 2.25);
});

test('skill scaling keeps a fractional cost and is configurable', () => {
  near(eitrCost(35, 0), 35);
  near(eitrCost(35, 50), 29.225);
  near(eitrCost(35, 100), 23.45);
  near(eitrCost(40, 100, 0.5), 20);
});

test('spending starts a fresh recovery delay after each cast', () => {
  const result = simulateEmbers({ ...setup, startingEitr: 70, duration: 1.5, castInterval: 0.2,
    attackDuration: 0.1, regenDelay: 1 });
  assert.deepEqual(result.casts.map(c => c.start), [0, 0.2]);
  assert.deepEqual(result.casts.map(c => c.eitrAfter), [35, 0]);
  const ready = result.timeline.find(p => p.kind === 'recovery-ready' && Math.abs(p.time - 1.2) < 1e-9);
  assert.ok(ready);
  near(ready.eitr, 0);
  assert.ok(result.endingEitr > 0);
});

test('affordability, threshold and maximum cap are separate constraints', () => {
  const belowCost = simulateEmbers({ ...setup, startingEitr: 34.9, duration: 0.01, threshold: 0 });
  assert.equal(belowCost.totalCasts, 0);
  assert.equal(simulateEmbers({ ...setup, startingEitr: 35 - 5e-10, duration: 1e-11, threshold: 0 }).casts.length, 0);
  assert.equal(simulateEmbers({ ...setup, maxEitr: 0, startingEitr: 0, threshold: 0 }).totalCasts, 0);
  assert.equal(simulateEmbers({ ...setup, maxEitr: 30, startingEitr: 30, threshold: 0 }).totalCasts, 0);
  const threshold = simulateEmbers({ ...setup, startingEitr: 50, duration: 5, threshold: 60,
    baseCost: 10, regenDelay: 0, attackDuration: 0 });
  assert.ok(threshold.casts[0].start > 0);
  near(threshold.casts[0].eitrBefore, 60);
  assert.ok(threshold.timeline.every(p => p.eitr <= 100));
});

test('the attack interval limits starts; suppression extends the recovery block', () => {
  const common = { ...setup, startingEitr: 10, baseCost: 10, threshold: 10, castInterval: 2,
    attackDuration: 1.5, regenDelay: 0, duration: 10 };
  const suppressed = simulateEmbers({ ...common, suppressRegenDuringAttack: true });
  const unsuppressed = simulateEmbers({ ...common, suppressRegenDuringAttack: false });
  assert.ok(suppressed.casts[1].start > unsuppressed.casts[1].start);
  for (const result of [suppressed, unsuppressed]) {
    for (let i = 1; i < result.casts.length; i++) assert.ok(result.casts[i].start - result.casts[i - 1].start >= 2 - 1e-9);
  }
});

test('attacks spend at start and count on completion at or before the duration', () => {
  const atBoundary = simulateEmbers({ ...setup, duration: 1, castInterval: 10, attackDuration: 1 });
  assert.equal(atBoundary.casts.length, 1);
  assert.equal(atBoundary.casts[0].start, 0);
  assert.equal(atBoundary.casts[0].completion, 1);
  assert.equal(atBoundary.totalCasts, 1);
  near(atBoundary.casts[0].eitrAfter, 65);
  const incomplete = simulateEmbers({ ...setup, duration: 0.5, castInterval: 10, attackDuration: 1 });
  assert.equal(incomplete.casts.length, 1);
  assert.equal(incomplete.totalCasts, 0);
  assert.equal(simulateEmbers({ ...setup, duration: 0 }).casts.length, 0);
  assert.equal(simulateEmbers({ ...setup, duration: 0 }).castsPerMinute, 0);
  assert.deepEqual(simulateEmbers({ ...setup, duration: 1, castInterval: 1, attackDuration: 0,
    baseRegenMultiplier: 0 }).casts.map(c => c.start), [0]);
});

test('threshold optimizer agrees with a small brute-force search and distance tie-break', () => {
  const input = { maxEitr: 70, startingEitr: 70, duration: 12, castInterval: 0.8,
    attackDuration: 0.4, baseCost: 20, regenDelay: 1, threshold: 45 };
  const values = [0, 10, 20, 30, 40, 50, 60, 70];
  const brute = [...values, 45].map(threshold => simulateEmbers({ ...input, threshold }));
  const count = Math.max(...brute.map(r => r.totalCasts));
  const closest = brute.filter(r => r.totalCasts === count).map(r => r.threshold)
    .sort((a, b) => Math.abs(a - 45) - Math.abs(b - 45) || a - b)[0];
  const result = optimizeThreshold(input, { userThreshold: 45, thresholds: values });
  assert.equal(result.bestCastCount, count);
  assert.equal(result.bestThreshold, closest);
  assert.equal(result.improvement, count - result.userCastCount);
  assert.equal(result.testedThresholds, values.length + 1);
  assert.ok(result.improvement >= 0);
});

test('same input produces identical casts and timeline', () => {
  const a = simulateEmbers(setup);
  const b = simulateEmbers(setup);
  assert.deepEqual(a, b);
  assert.equal(a.castsPerMinute, a.totalCasts * 3);
});

test('invalid inputs and unsafe searches fail explicitly', () => {
  for (const bad of [
    { maxEitr: -1 }, { startingEitr: 101 }, { duration: Infinity }, { castInterval: 0 },
    { attackDuration: 2 }, { regenDelay: -1 }, { threshold: 101 }, { skillLevel: 101 },
    { baseCost: 0 }, { baseRegenMultiplier: -1 }, { rested: 1 },
  ]) assert.throws(() => simulateEmbers({ ...setup, ...bad }));
  assert.throws(() => simulateEmbers({ ...setup, duration: 100, castInterval: 0.00001, attackDuration: 0 }), /safety limit/);
  assert.throws(() => optimizeThreshold(setup, { userThreshold: 35, step: 0.0001 }), /candidate budget/);
  assert.throws(() => optimizeThreshold(setup, { userThreshold: 35, thresholds: [] }));
});

test('a positive 5e-10-second spend delay remains a flat graph interval', () => {
  const result = simulateEmbers({ maxEitr: 35, startingEitr: 35, duration: 1e-9,
    castInterval: 1, attackDuration: 0, threshold: 35, regenDelay: 5e-10 });
  assert.deepEqual(result.casts.map(c => c.start), [0]);
  assert.equal(result.segments[0].kind, 'flat');
  assert.equal(result.segments[0].start, 0);
  assert.equal(result.segments[0].end, 5e-10);
  assert.equal(result.segments[0].eitrEnd, 0);
  assert.equal(result.segments[1].kind, 'recovery');
  assert.ok(result.endingEitr > 0);
  assert.equal(result.timeline.find(e => e.kind === 'recovery-ready').time, 5e-10);
});

test('simultaneous and nearly simultaneous boundaries keep chronological order', () => {
  const common = { maxEitr: 70, startingEitr: 70, duration: 2,
    castInterval: 0.5, attackDuration: 0.5, threshold: 35, baseCost: 35,
    baseRegenMultiplier: 0 };
  const same = simulateEmbers({ ...common, regenDelay: 0.5 });
  const atHalf = same.timeline.filter(e => e.time === 0.5).map(e => e.kind);
  assert.deepEqual(atHalf, ['cast-complete', 'recovery-ready', 'cast-start']);
  const nearDelay = 0.5 + Number.EPSILON;
  const nearResult = simulateEmbers({ ...common, startingEitr: 35, regenDelay: nearDelay });
  assert.deepEqual(nearResult.timeline.filter(e => e.time === 0.5).map(e => e.kind),
    ['cast-complete']);
  assert.deepEqual(nearResult.timeline.filter(e => e.time === nearDelay).map(e => e.kind),
    ['recovery-ready']);
  assert.equal(nearResult.segments.find(s => s.start === 0.5).end, nearDelay);
  assert.ok(nearResult.segments.every(s => s.end > s.start));
  assert.ok(nearResult.timeline.every((e, i, a) => i === 0 || e.time >= a[i - 1].time));
});

test('exact affordability never raises resource state', () => {
  const cost = eitrCost(35, 50);
  const below = cost - Number.EPSILON * cost;
  const config = { maxEitr: 100, duration: 1e-10, castInterval: 1,
    attackDuration: 0, regenDelay: 1, threshold: 0, baseCost: 35, skillLevel: 50,
    baseRegenMultiplier: 0 };
  const unavailable = simulateEmbers({ ...config, startingEitr: below });
  assert.equal(unavailable.casts.length, 0);
  assert.equal(unavailable.endingEitr, below);
  const exact = simulateEmbers({ ...config, startingEitr: cost });
  assert.equal(exact.casts.length, 1);
  assert.equal(exact.casts[0].eitrBefore, cost);
  assert.equal(exact.casts[0].eitrAfter, 0);
  const equalMaximum = simulateEmbers({ ...config, maxEitr: cost, startingEitr: cost, threshold: cost });
  assert.equal(equalMaximum.casts.length, 1);
  assert.equal(equalMaximum.casts[0].eitrAfter, 0);
});

test('maximum threshold, zero regeneration, and very short durations behave explicitly', () => {
  const result = simulateEmbers({ maxEitr: 35, startingEitr: 35, duration: 10,
    castInterval: 0.5, attackDuration: 0, threshold: 35, baseRegenMultiplier: 0 });
  assert.equal(result.totalCasts, 1);
  assert.equal(result.endingEitr, 0);
  assert.ok(result.segments.every(s => s.kind === 'flat'));
  const short = simulateEmbers({ ...setup, duration: 1e-12, castInterval: 1, attackDuration: 0 });
  assert.equal(short.totalCasts, 1);
  assert.equal(short.castsPerMinute, 60 / 1e-12);
  assert.throws(() => simulateEmbers({ ...setup, duration: Number.MIN_VALUE }), /casts per minute/);
});

test('optimizer defaults user threshold and includes its exact value', () => {
  const input = { ...setup, threshold: 35.25 };
  const result = optimizeThreshold(input, { thresholds: [0, 35, 70] });
  assert.equal(result.userThreshold, 35.25);
  assert.equal(result.testedThresholds, 4);
  assert.equal(result.userCastCount, simulateEmbers(input).totalCasts);
  assert.deepEqual(optimizeThreshold(input, { thresholds: [0, 35, 70] }), result);
});

test('optimizer chooses closest threshold among equally productive candidates', () => {
  const input = { maxEitr: 100, startingEitr: 70, duration: 0.5,
    castInterval: 1, attackDuration: 0, baseRegenMultiplier: 0, threshold: 90 };
  const result = optimizeThreshold(input, { thresholds: [0, 35, 50, 60, 80] });
  assert.equal(result.userCastCount, 0);
  assert.equal(result.bestCastCount, 1);
  assert.equal(result.bestThreshold, 60);
  assert.equal(result.improvement, 1);
});

test('candidate and cast-slot budgets reject searches before partial results', () => {
  assert.equal(MAX_OPTIMIZER_CANDIDATES, 256);
  assert.throws(() => optimizeThreshold(setup, { thresholds: Array.from({ length: 256 }, (_, i) => i / 3) }),
    /candidate budget/);
  assert.throws(() => optimizeThreshold({ ...setup, maxEitr: 100, duration: 1000,
    castInterval: 0.1, attackDuration: 0.1 },
    { step: 1 }), /cast-slot budget/);
});

test('event segments cover duration and connect through cast expenditure jumps', () => {
  const result = simulateEmbers({ ...setup, startingEitr: 70, duration: 8,
    castInterval: 0.6, attackDuration: 0.3, threshold: 35, regenDelay: 0.7 });
  assert.equal(result.segments[0].start, 0);
  assert.equal(result.segments.at(-1).end, 8);
  for (const segment of result.segments) {
    assert.ok(segment.end > segment.start);
    near(eitrAtSegment(segment, segment.start), segment.eitrStart);
    near(eitrAtSegment(segment, segment.end), segment.eitrEnd);
    assert.ok(segment.eitrStart >= 0 && segment.eitrEnd >= 0);
    assert.ok(segment.eitrStart <= 100 && segment.eitrEnd <= 100);
  }
  for (let i = 1; i < result.segments.length; i++) {
    const previous = result.segments[i - 1], current = result.segments[i];
    assert.equal(previous.end, current.start);
    const cast = result.casts.find(c => c.start === current.start);
    near(current.eitrStart, cast ? cast.eitrAfter : previous.eitrEnd);
    if (cast) near(previous.eitrEnd, cast.eitrBefore);
  }
  near(result.segments.at(-1).eitrEnd, result.endingEitr);
  assert.throws(() => eitrAtSegment(result.segments[0], -1));
});

test('large or non-finite derived calculations fail clearly', () => {
  for (const bad of [
    { maxEitr: 1e308, startingEitr: 1e308 },
    { baseRegenMultiplier: 1e308 },
    { duration: 1e308 },
  ]) assert.throws(() => simulateEmbers({ ...setup, ...bad }), RangeError);
  assert.throws(() => recoverEitr(0, 100, 1e308, 1e308), RangeError);
  assert.throws(() => eitrCost(Number.MIN_VALUE, 100, 0.99), /underflows/);
});

test('a long fight with no regeneration stays finite and bounded', () => {
  const result = simulateEmbers({ maxEitr: 35, startingEitr: 35, duration: 3600,
    castInterval: 30, attackDuration: 1, threshold: 35, baseRegenMultiplier: 0 });
  assert.equal(result.totalCasts, 1);
  assert.equal(result.castsPerMinute, 1 / 60);
  assert.equal(result.endingEitr, 0);
  assert.equal(result.segments.at(-1).end, 3600);
});
