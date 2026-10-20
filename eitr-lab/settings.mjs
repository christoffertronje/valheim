import { MECHANICS } from './simulator.mjs';

export const STORAGE_KEY = 'valheim-eitr-lab-v1';
export const DEFAULT_SETTINGS = Object.freeze({
  maxEitr: 100, startingEitr: 100, skillLevel: 0, threshold: 35,
  manualCost: false, baseCost: MECHANICS.embersBaseCost.value, rested: false,
  hood: false, robe: false, trousers: false,
  regenDelay: 1, attackDuration: 0.5, castInterval: 1.25,
  duration: 60, suppressRegenDuringAttack: true,
});
export const LIMITS = Object.freeze({
  maxEitr: [0, 1000], startingEitr: [0, 1000], skillLevel: [0, 100],
  threshold: [0, 1000], baseCost: [0.01, 1000], regenDelay: [0, 10],
  attackDuration: [0, 10], castInterval: [0.01, 10], duration: [0, 3600],
});
const FLAGS = ['manualCost', 'rested', 'hood', 'robe', 'trousers', 'suppressRegenDuringAttack'];

export function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Eitr Lab settings');
  const next = { ...DEFAULT_SETTINGS };
  for (const [key, [minimum, maximum]] of Object.entries(LIMITS)) {
    const n = value[key] ?? next[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < minimum || n > maximum) {
      throw new RangeError(`${key} must be between ${minimum} and ${maximum}`);
    }
    next[key] = n;
  }
  for (const key of FLAGS) {
    const v = value[key] ?? next[key];
    if (typeof v !== 'boolean') throw new TypeError(`${key} must be a boolean`);
    next[key] = v;
  }
  next.startingEitr = Math.min(next.startingEitr, next.maxEitr);
  next.threshold = Math.min(next.threshold, next.maxEitr);
  next.attackDuration = Math.min(next.attackDuration, next.castInterval);
  return next;
}

export function updateSetting(settings, key, value) {
  if (!(key in LIMITS) && !FLAGS.includes(key)) throw new TypeError('Unknown setting');
  return normalizeSettings({ ...settings, [key]: value });
}

export function loadSettings(raw) {
  if (!raw) return { settings: { ...DEFAULT_SETTINGS }, restored: false };
  try {
    const saved = JSON.parse(raw);
    if (saved?.version !== 1) throw new Error('Unsupported version');
    return { settings: normalizeSettings(saved.settings), restored: true };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, restored: false };
  }
}

export function serializeSettings(settings) {
  return JSON.stringify({ version: 1, settings: normalizeSettings(settings) });
}

export function applyCharacterSnapshot(settings, snapshot) {
  if (!snapshot || !Number.isFinite(snapshot.maxEitr) || snapshot.maxEitr < 0 ||
      snapshot.maxEitr > LIMITS.maxEitr[1]) throw new RangeError('Invalid character Eitr');
  return normalizeSettings({ ...settings, maxEitr: snapshot.maxEitr,
    startingEitr: snapshot.maxEitr, threshold: Math.min(settings.threshold, snapshot.maxEitr),
    hood: snapshot.eitrWeave.hood, robe: snapshot.eitrWeave.robe,
    trousers: snapshot.eitrWeave.trousers });
}

export function simulationInput(settings) {
  return {
    maxEitr: settings.maxEitr, startingEitr: settings.startingEitr,
    skillLevel: settings.skillLevel, threshold: settings.threshold,
    baseCost: settings.manualCost ? settings.baseCost : MECHANICS.embersBaseCost.value,
    skillReductionAt100: settings.manualCost ? 0 : MECHANICS.skillReductionAt100.value,
    rested: settings.rested,
    eitrWeave: { hood: settings.hood, robe: settings.robe, trousers: settings.trousers },
    regenDelay: settings.regenDelay, attackDuration: settings.attackDuration,
    castInterval: settings.castInterval, duration: settings.duration,
    suppressRegenDuringAttack: settings.suppressRegenDuringAttack,
  };
}

export function optimizationIsCurrent(optimizedSettings, currentSettings) {
  return optimizedSettings !== null && serializeSettings(optimizedSettings) === serializeSettings(currentSettings);
}
