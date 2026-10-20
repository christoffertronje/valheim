/**
 * DOM-free, deterministic Eitr model. Times are seconds; Eitr is a float.
 *
 * Reference-supported defaults, not verification against the current game:
 * - Recovery rate 4 - 2 * current/max Eitr and one-second spend delay:
 *   https://valheim.gamecore.wiki/en/game_mechanics/eitr/
 * - Rested +100%; Eitr-weave hood +20%, robe +40%, trousers +40%, additive:
 *   https://valheim.gamecore.wiki/en/game_mechanics/eitr/
 * - Staff of Embers base cost 35, skill reduction up to 33%:
 *   https://valheim.gamecore.wiki/en/skills/elemental-magic-skill/
 *   https://old.thunderstore.io/c/valheim/p/Crystal/Magical/source/
 *
 * Cast interval, attack duration, and spend timing are model parameters.
 * Spending at attack start is a simulation assumption.
 */

export const MECHANICS = Object.freeze({
  baseRegenAtEmpty: Object.freeze({ value: 4, confidence: 'medium', source: 'https://valheim.gamecore.wiki/en/game_mechanics/eitr/' }),
  baseRegenAtFull: Object.freeze({ value: 2, confidence: 'medium', source: 'https://valheim.gamecore.wiki/en/game_mechanics/eitr/' }),
  regenDelay: Object.freeze({ value: 1, confidence: 'medium', source: 'https://valheim.gamecore.wiki/en/game_mechanics/eitr/' }),
  embersBaseCost: Object.freeze({ value: 35, confidence: 'high', source: 'https://valheim.gamecore.wiki/en/skills/elemental-magic-skill/' }),
  skillReductionAt100: Object.freeze({ value: 0.33, confidence: 'medium', source: 'https://old.thunderstore.io/c/valheim/p/Crystal/Magical/source/' }),
  restedBonus: Object.freeze({ value: 1, confidence: 'medium', source: 'https://valheim.gamecore.wiki/en/game_mechanics/eitr/' }),
  eitrWeaveBonuses: Object.freeze({ hood: 0.2, robe: 0.4, trousers: 0.4, confidence: 'medium', source: 'https://valheim.gamecore.wiki/en/game_mechanics/eitr/' }),
  suppressRegenDuringAttack: Object.freeze({ value: true, confidence: 'medium for 1.0.12; unverified for 1.0.20', source: 'https://corpus.gg/games/valheim/mechanics/resource-regeneration' }),
});

const MAX_CASTS = 1_000_000;
export const MAX_OPTIMIZER_CANDIDATES = 256;
const MAX_OPTIMIZER_CAST_SLOTS = 100_000;

function finite(name, value, minimum, inclusive = true) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (inclusive ? value < minimum : value <= minimum)) {
    throw new RangeError(`${name} must be a finite number ${inclusive ? 'at least' : 'greater than'} ${minimum}`);
  }
  return value;
}

function boolean(name, value) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return value;
}

function derived(name, value) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} is not finite for these inputs`);
  return value;
}

export function eitrCost(baseCost, skillLevel, skillReductionAt100 = MECHANICS.skillReductionAt100.value) {
  finite('baseCost', baseCost, 0, false);
  finite('skillLevel', skillLevel, 0);
  if (skillLevel > 100) throw new RangeError('skillLevel must not exceed 100');
  finite('skillReductionAt100', skillReductionAt100, 0);
  if (skillReductionAt100 >= 1) throw new RangeError('skillReductionAt100 must be less than 1');
  const cost = derived('Eitr cost', baseCost * (1 - skillReductionAt100 * skillLevel / 100));
  if (cost === 0) throw new RangeError('Eitr cost underflows for these inputs');
  return cost;
}

export function regenerationMultiplier({ baseRegenMultiplier = 1, rested = false, eitrWeave = {} } = {}) {
  finite('baseRegenMultiplier', baseRegenMultiplier, 0);
  boolean('rested', rested);
  if (!eitrWeave || typeof eitrWeave !== 'object' || Array.isArray(eitrWeave)) throw new TypeError('eitrWeave must be an object');
  const hood = boolean('eitrWeave.hood', eitrWeave.hood ?? false);
  const robe = boolean('eitrWeave.robe', eitrWeave.robe ?? false);
  const trousers = boolean('eitrWeave.trousers', eitrWeave.trousers ?? false);
  return derived('regeneration multiplier', baseRegenMultiplier + (rested ? 1 : 0) +
    (hood ? 0.2 : 0) + (robe ? 0.4 : 0) + (trousers ? 0.4 : 0));
}

export function regenerationRate(currentEitr, maxEitr, multiplier = 1) {
  finite('maxEitr', maxEitr, 0);
  finite('currentEitr', currentEitr, 0);
  finite('multiplier', multiplier, 0);
  if (currentEitr > maxEitr) throw new RangeError('currentEitr must not exceed maxEitr');
  if (maxEitr === 0) return 0;
  derived('twice maximum Eitr', 2 * maxEitr);
  return derived('regeneration rate', multiplier * (4 - 2 * (currentEitr / maxEitr)));
}

/** Analytical recovery between events, capped at maximum Eitr. */
export function recoverEitr(currentEitr, maxEitr, multiplier, seconds) {
  regenerationRate(currentEitr, maxEitr, multiplier);
  finite('seconds', seconds, 0);
  if (maxEitr === 0 || multiplier === 0 || seconds === 0 || currentEitr === maxEitr) return currentEitr;
  const exponent = derived('recovery exponent', (2 * multiplier / maxEitr) * seconds);
  const gain = derived('recovery gain', (2 * maxEitr - currentEitr) * -Math.expm1(-exponent));
  return Math.min(maxEitr, derived('recovered Eitr', currentEitr + gain));
}

/** Time to a reachable target while recovery is active. Infinity means no recovery. */
export function recoveryTime(currentEitr, targetEitr, maxEitr, multiplier) {
  regenerationRate(currentEitr, maxEitr, multiplier);
  finite('targetEitr', targetEitr, 0);
  if (targetEitr > maxEitr) throw new RangeError('targetEitr must not exceed maxEitr');
  if (targetEitr <= currentEitr) return 0;
  if (multiplier === 0 || maxEitr === 0) return Infinity;
  const rate = derived('recovery coefficient', 2 * multiplier / maxEitr);
  if (rate === 0) throw new RangeError('recovery coefficient underflows for these inputs');
  return derived('recovery time', Math.log1p((targetEitr - currentEitr) / (2 * maxEitr - targetEitr)) / rate);
}

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('simulation input must be an object');
  const maxEitr = finite('maxEitr', input.maxEitr, 0);
  derived('twice maximum Eitr', 2 * maxEitr);
  const startingEitr = finite('startingEitr', input.startingEitr ?? maxEitr, 0);
  if (startingEitr > maxEitr) throw new RangeError('startingEitr must not exceed maxEitr');
  const duration = finite('duration', input.duration, 0);
  const castInterval = finite('castInterval', input.castInterval, 0, false);
  const attackDuration = finite('attackDuration', input.attackDuration, 0);
  if (attackDuration > castInterval) throw new RangeError('attackDuration must not exceed castInterval');
  if (duration / castInterval > MAX_CASTS) throw new RangeError('duration/castInterval exceeds the cast safety limit');
  const regenDelay = finite('regenDelay', input.regenDelay ?? MECHANICS.regenDelay.value, 0);
  const threshold = finite('threshold', input.threshold, 0);
  if (threshold > maxEitr) throw new RangeError('threshold must not exceed maxEitr');
  const suppressRegenDuringAttack = boolean('suppressRegenDuringAttack', input.suppressRegenDuringAttack ?? true);
  const cost = eitrCost(input.baseCost ?? MECHANICS.embersBaseCost.value,
    input.skillLevel ?? 0, input.skillReductionAt100 ?? MECHANICS.skillReductionAt100.value);
  const multiplier = regenerationMultiplier(input);
  if (maxEitr && multiplier) {
    const rate = derived('recovery coefficient', 2 * multiplier / maxEitr);
    if (rate === 0) throw new RangeError('recovery coefficient underflows for these inputs');
    derived('duration recovery exponent', rate * duration);
  }
  derived('casts per minute upper bound', duration ? Math.min(MAX_CASTS, duration / castInterval + 1) * 60 / duration : 0);
  return { maxEitr, startingEitr, duration, castInterval, attackDuration, regenDelay,
    threshold, suppressRegenDuringAttack, cost, multiplier };
}

/** Evaluate a graph segment without copying the recovery formula into a UI. */
export function eitrAtSegment(segment, time) {
  if (!segment || typeof segment !== 'object') throw new TypeError('segment must be an object');
  finite('time', time, 0);
  if (time < segment.start || time > segment.end) throw new RangeError('time is outside segment');
  return segment.kind === 'recovery'
    ? recoverEitr(segment.eitrStart, segment.maxEitr, segment.multiplier, time - segment.start)
    : segment.eitrStart;
}

// Find the first representable instant at which the forward recovery reaches
// target. This handles rounding of the analytical inverse without adding Eitr.
function crossingTime(eitr, target, max, k, start, end) {
  if (recoverEitr(eitr, max, k, end - start) < target) return Infinity;
  const wait = recoveryTime(eitr, target, max, k);
  let low = start;
  let high = end;
  const estimate = start + wait;
  if (estimate > start && estimate < end) {
    if (recoverEitr(eitr, max, k, estimate - start) >= target) high = estimate;
    else low = estimate;
  }
  // Midpoint eventually rounds to one endpoint in IEEE-754, so this terminates.
  while (true) {
    const mid = low + (high - low) / 2;
    if (mid <= low || mid >= high) return high;
    if (recoverEitr(eitr, max, k, mid - start) >= target) high = mid;
    else low = mid;
  }
}

/**
 * A threshold is minimum Eitr at attack start; affordability is checked
 * separately. Cost is deducted at attack start. Completion is start +
 * attackDuration and counts only at or before duration. Starts at duration
 * are excluded. Recovery starts after both spend delay and, if configured,
 * attack completion. Completion is processed before a simultaneous next start.
 *
 * segments cover time continuously with flat/recovery intervals. Cast events
 * describe instantaneous drops between segments; eitrAtSegment supplies exact
 * intermediate values for graph rendering. timeline is a chronological event
 * log, not a sampled graph.
 */
export function simulateEmbers(input) {
  return simulate(normalize(input), true);
}

function simulate(p, collect) {
  const { maxEitr: max, duration, cost, multiplier: k } = p;
  const target = Math.max(p.threshold, cost);
  let time = 0;
  let eitr = p.startingEitr;
  let recoveryAt = 0;
  let nextAttackAt = 0;
  let completionAt = null;
  let starts = 0;
  let totalCasts = 0;
  const casts = collect ? [] : null;
  const timeline = collect ? [{ time: 0, eitr, kind: 'initial' }] : null;
  const segments = collect ? [] : null;
  const record = kind => { if (collect) timeline.push({ time, eitr, kind }); };

  function advance(to) {
    if (to < time || to > duration) throw new RangeError('invalid event time');
    while (time < to) {
      const end = Math.min(to,
        recoveryAt > time ? recoveryAt : to,
        completionAt !== null && completionAt > time ? completionAt : to);
      if (end <= time) throw new RangeError('event clock cannot advance');
      const before = eitr;
      const active = time >= recoveryAt && k > 0 && eitr < max;
      if (active) eitr = recoverEitr(eitr, max, k, end - time);
      if (collect) segments.push({ kind: active ? 'recovery' : 'flat',
        start: time, end, eitrStart: before, eitrEnd: eitr,
        ...(active ? { maxEitr: max, multiplier: k } : {}) });
      time = end;
      if (completionAt === time) {
        record('cast-complete');
        completionAt = null;
      }
      if (recoveryAt === time) record('recovery-ready');
    }
  }

  if (target <= max) {
    while (time < duration) {
      if (nextAttackAt > time) advance(Math.min(duration, nextAttackAt));
      if (time >= duration) break;
      if (eitr < target) {
        if (recoveryAt > time) advance(Math.min(duration, recoveryAt));
        if (time >= duration) break;
        if (eitr < target) {
          if (k === 0) break;
          const crossing = crossingTime(eitr, target, max, k, time, duration);
          if (crossing >= duration) break;
          if (crossing <= time) throw new RangeError('threshold crossing clock cannot advance');
          advance(crossing);
        }
      }
      if (eitr < target || eitr < cost) throw new Error('threshold crossing did not make cast affordable');
      if (++starts > MAX_CASTS) throw new RangeError('cast safety limit exceeded');
      const before = eitr;
      eitr -= cost;
      const start = time;
      const completion = derived('attack completion time', start + p.attackDuration);
      const completed = completion <= duration;
      totalCasts += Number(completed);
      if (collect) casts.push({ start, completion, cost, eitrBefore: before, eitrAfter: eitr, completed });
      record('cast-start');
      if (p.attackDuration === 0) record('cast-complete');
      else completionAt = completion;
      const delayEnd = derived('recovery delay boundary', start + p.regenDelay);
      recoveryAt = Math.max(delayEnd, p.suppressRegenDuringAttack ? completion : start);
      nextAttackAt = derived('next attack time', start + p.castInterval);
      if (nextAttackAt <= start) throw new RangeError('cast interval is too small to advance the clock');
    }
  }
  advance(duration);
  return collect
    ? { casts, timeline, segments, totalCasts, castsPerMinute: duration ? totalCasts * 60 / duration : 0,
      endingEitr: eitr, cost, regenerationMultiplier: k, threshold: p.threshold, duration }
    : totalCasts;
}

/**
 * Best tested threshold, not a globally optimal arbitrary casting schedule.
 * The exact user threshold is always included. A search exceeding the mobile
 * candidate or cast-slot budget throws before testing any candidate.
 */
export function optimizeThreshold(input, { userThreshold, step = 1, thresholds } = {}) {
  const p = normalize(input);
  userThreshold = finite('userThreshold', userThreshold ?? p.threshold, 0);
  if (userThreshold > p.maxEitr) throw new RangeError('userThreshold must not exceed maxEitr');
  let candidates;
  if (thresholds !== undefined) {
    if (!Array.isArray(thresholds) || thresholds.length === 0) throw new RangeError('thresholds must be a nonempty array');
    if (thresholds.length + 1 > MAX_OPTIMIZER_CANDIDATES) throw new RangeError('threshold candidate budget exceeded');
    candidates = [...thresholds, userThreshold];
  } else {
    finite('step', step, 0, false);
    const gridCount = Math.floor(p.maxEitr / step) + 1;
    if (!Number.isFinite(gridCount) || gridCount + 2 > MAX_OPTIMIZER_CANDIDATES) {
      throw new RangeError('threshold candidate budget exceeded; increase step or provide fewer thresholds');
    }
    candidates = Array.from({ length: gridCount }, (_, i) => i * step);
    candidates.push(p.maxEitr, userThreshold);
  }
  candidates.forEach(threshold => {
    finite('candidate threshold', threshold, 0);
    if (threshold > p.maxEitr) throw new RangeError('candidate threshold must not exceed maxEitr');
  });
  candidates = [...new Set(candidates)].sort((a, b) => a - b);
  if (candidates.length > MAX_OPTIMIZER_CANDIDATES) throw new RangeError('threshold candidate budget exceeded');
  const slots = Math.ceil(p.duration / p.castInterval);
  if (candidates.length * slots > MAX_OPTIMIZER_CAST_SLOTS) {
    throw new RangeError('threshold cast-slot budget exceeded; increase step or shorten duration');
  }
  let bestThreshold = null;
  let bestCastCount = -1;
  let userCastCount = null;
  for (const threshold of candidates) {
    const count = simulate({ ...p, threshold }, false);
    if (threshold === userThreshold) userCastCount = count;
    if (count > bestCastCount ||
      (count === bestCastCount && (Math.abs(threshold - userThreshold) < Math.abs(bestThreshold - userThreshold) ||
        (Math.abs(threshold - userThreshold) === Math.abs(bestThreshold - userThreshold) && threshold < bestThreshold)))) {
      bestThreshold = threshold;
      bestCastCount = count;
    }
  }
  const user = simulate({ ...p, threshold: userThreshold }, true);
  const best = bestThreshold === userThreshold ? user : simulate({ ...p, threshold: bestThreshold }, true);
  return { bestThreshold, bestCastCount, improvement: bestCastCount - userCastCount,
    userCastCount, userThreshold, testedThresholds: candidates.length, best, user };
}
