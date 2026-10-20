import { eitrCost, eitrAtSegment, MECHANICS, simulateEmbers } from './simulator.mjs';
import { resolveCharacterEitr } from '../character/eitr-resolver.mjs';
import { DEFAULT_SETTINGS, LIMITS, STORAGE_KEY, loadSettings, serializeSettings,
  updateSetting, applyCharacterSnapshot, simulationInput, optimizationIsCurrent } from './settings.mjs';
import { graphData } from './graph.mjs';

const $ = id => document.getElementById(id);
const restored = loadSettings(safeRead(STORAGE_KEY));
let settings = restored.settings;
let result = null, optimized = null, optimizedSettings = null, worker = null;
let imported = null, cursorTime = null;
const format = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits).replace(/\.0$/, '') : '—';

function safeRead(key) { try { return localStorage.getItem(key); } catch { return null; } }
function save() { try { localStorage.setItem(STORAGE_KEY, serializeSettings(settings)); } catch { /* private mode */ } }
function showError(message) { $('error').hidden = !message; $('error').textContent = message || ''; }

const basic = [
  ['maxEitr', 'Maximum Eitr', 'From food when imported', 1],
  ['startingEitr', 'Starting Eitr', '', 1],
  ['skillLevel', 'Elemental Magic skill', '0–100', 1],
  ['threshold', 'Cast-at-Eitr threshold', 'Minimum Eitr before starting an attack', 1],
  ['duration', 'Fight duration (seconds)', '', 1],
];
const advanced = [
  ['regenDelay', 'Recovery delay (seconds)', 'After each expenditure', 0.01],
  ['attackDuration', 'Attack duration (seconds)', 'Editable timing assumption', 0.01],
  ['castInterval', 'Minimum cast interval (seconds)', 'Editable timing assumption', 0.01],
];
function field([key, label, note, step]) {
  const [min, max] = LIMITS[key];
  return `<div class="field"><div class="field-head"><label for="${key}-number">${label}</label></div>
    <div class="field-pair"><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" aria-label="${label}">
    <input id="${key}-number" type="number" data-key="${key}" min="${min}" max="${max}" step="any" inputmode="decimal"></div>
    ${note ? `<small>${note}</small>` : ''}</div>`;
}
function toggle(key, label, note = '') {
  return `<label class="check"><input type="checkbox" data-key="${key}"><span>${label}${note ? `<small class="note"> · ${note}</small>` : ''}</span></label>`;
}
$('controls').innerHTML = basic.map(field).join('') +
  '<div class="field"><strong>Staff of Embers</strong><small id="derived-cost"></small></div>' +
  toggle('manualCost', 'Override Eitr cost') +
  field(['baseCost', 'Manual Eitr cost', 'Applies directly when override is enabled', 0.01]) +
  '<div class="field">' + toggle('rested', 'Rested', '+100% Eitr recovery') +
  toggle('hood', 'Eitr-weave hood', '+20%') + toggle('robe', 'Eitr-weave robe', '+40%') +
  toggle('trousers', 'Eitr-weave trousers', '+40%') + '</div>';
$('advanced-controls').innerHTML = advanced.map(field).join('') +
  toggle('suppressRegenDuringAttack', 'Pause recovery during attack');

function syncControls() {
  for (const element of document.querySelectorAll('[data-key]')) {
    const key = element.dataset.key;
    if (element.type === 'checkbox') element.checked = settings[key];
    else {
      element.value = settings[key];
      if (key === 'startingEitr' || key === 'threshold') element.max = settings.maxEitr;
      if (key === 'attackDuration') element.max = settings.castInterval;
    }
  }
  for (const element of document.querySelectorAll('[data-key="baseCost"]')) element.disabled = !settings.manualCost;
  $('derived-cost').textContent = `Effective cost: ${format(settings.manualCost ? settings.baseCost :
    eitrCost(MECHANICS.embersBaseCost.value, settings.skillLevel), 2)} Eitr`;
}

function invalidateOptimization() {
  if (worker) { worker.terminate(); worker = null; }
  optimized = null; optimizedSettings = null;
  $('show-best').checked = false; $('show-best').disabled = true;
  $('comparison').textContent = 'Settings changed. Choose Optimize to compare strategies.';
  $('optimize').disabled = false; $('optimize').textContent = 'Optimize';
}

function render() {
  syncControls();
  try {
    result = simulateEmbers(simulationInput(settings));
    showError('');
    $('total-casts').textContent = result.totalCasts.toLocaleString();
    $('casts-per-minute').textContent = format(result.castsPerMinute, 2);
    $('ending-eitr').textContent = format(result.endingEitr, 2);
    $('cost-regen').textContent = `${format(result.cost, 2)} · ×${format(result.regenerationMultiplier, 2)}`;
    drawGraph();
  } catch (error) {
    result = null;
    showError(error.message);
    for (const id of ['total-casts', 'casts-per-minute', 'ending-eitr', 'cost-regen']) $(id).textContent = '—';
    $('graph').replaceChildren();
  }
}

document.addEventListener('input', event => {
  const element = event.target.closest('[data-key]');
  if (!element) return;
  const key = element.dataset.key;
  const value = element.type === 'checkbox' ? element.checked :
    element.value.trim() === '' ? NaN : Number(element.value);
  try {
    const next = updateSetting(settings, key, value);
    if (serializeSettings(next) !== serializeSettings(settings)) {
      settings = next;
      if (imported) $('import-status').textContent =
        'Imported snapshot shown below. Eitr Lab values may now differ; Character Builder is unchanged.';
      invalidateOptimization();
      save();
    }
    render();
  } catch (error) {
    showError(error.message);
    result = null;
    for (const id of ['total-casts', 'casts-per-minute', 'ending-eitr', 'cost-regen']) $(id).textContent = '—';
    $('graph').replaceChildren();
    invalidateOptimization();
  }
});

$('reset').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  imported = null;
  $('import-details').replaceChildren();
  $('import-status').textContent = 'Example settings restored. Import a saved character whenever you like.';
  invalidateOptimization(); save(); render();
});

$('import-character').addEventListener('click', async () => {
  try {
    const raw = safeRead('valheim-character-builder-v1');
    if (!raw) throw new Error('No saved Character Builder selection found. Build a character first.');
    const selection = JSON.parse(raw);
    const response = await fetch('../data/character-builder.json');
    if (!response.ok) throw new Error('Could not load the Character Builder catalog.');
    const snapshot = resolveCharacterEitr(selection, await response.json());
    if (snapshot.foodNames.length === 0 && snapshot.equipmentNames.length === 0) {
      throw new Error('No usable foods or Eitr-weave pieces found in the saved build.');
    }
    settings = applyCharacterSnapshot(settings, snapshot);
    imported = snapshot;
    invalidateOptimization(); save(); render();
    $('import-status').textContent = snapshot.warnings.length
      ? 'Imported valid selections; some saved entries were ignored.'
      : 'Snapshot imported. Changes here do not alter Character Builder.';
    $('import-details').replaceChildren();
    for (const label of [`Imported food Eitr: ${snapshot.maxEitr}`,
      ...snapshot.foodNames, ...snapshot.equipmentNames,
      snapshot.spoilersHidden ? 'Late-biome spoilers hidden' : 'All biomes visible']) {
      const chip = document.createElement('span'); chip.textContent = label;
      $('import-details').append(chip);
    }
  } catch (error) {
    $('import-status').textContent = error.message + ' Current Eitr Lab settings remain available.';
  }
});

function svgNode(tag, attributes = {}, text = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}
const plot = { left: 48, right: 623, top: 19, bottom: 272 };
function drawGraph() {
  if (!result) return;
  const end = $('graph-window').value === 'full' ? result.duration : Math.min(60, result.duration);
  const data = graphData(result, end);
  const max = Math.max(settings.maxEitr, 1);
  const x = time => plot.left + (plot.right - plot.left) * (end ? time / end : 0);
  const y = eitr => plot.bottom - (plot.bottom - plot.top) * eitr / max;
  const svg = $('graph'); svg.replaceChildren();
  for (let i = 0; i <= 4; i++) {
    const yy = plot.bottom - (plot.bottom - plot.top) * i / 4;
    svg.append(svgNode('line', { x1: plot.left, x2: plot.right, y1: yy, y2: yy, class: 'grid' }));
    svg.append(svgNode('text', { x: 41, y: yy + 4, 'text-anchor': 'end' }, format(settings.maxEitr * i / 4, 0)));
  }
  for (let i = 0; i <= 4; i++) {
    const xx = plot.left + (plot.right - plot.left) * i / 4;
    svg.append(svgNode('text', { x: xx, y: 293, 'text-anchor': 'middle' }, format(end * i / 4, 0)));
  }
  svg.append(svgNode('text', { x: 337, y: 315, 'text-anchor': 'middle' }, 'Time (seconds)'));
  svg.append(svgNode('text', { x: 12, y: 145, transform: 'rotate(-90 12 145)', 'text-anchor': 'middle' }, 'Eitr'));
  function drawSegments(series, overlay = false) {
    for (const segment of series.segments) {
      const d = segment.points.map((point, index) =>
        `${index ? 'L' : 'M'}${x(point.time).toFixed(2)},${y(point.eitr).toFixed(2)}`).join(' ');
      svg.append(svgNode('path', { d, class: overlay ? 'best-line' :
        segment.kind === 'recovery' ? 'recovery-line' : 'flat-line' }));
    }
  }
  if ($('show-best').checked && optimized && optimizationIsCurrent(optimizedSettings, settings)) {
    drawSegments(graphData(optimized.best, end), true);
  }
  drawSegments(data);
  for (const cast of data.casts) {
    const xx = x(cast.start);
    svg.append(svgNode('line', { x1: xx, x2: xx,
      y1: y(cast.eitrBefore), y2: y(cast.eitrAfter), class: 'cast-line' }));
    svg.append(svgNode('circle', { cx: xx, cy: y(cast.eitrAfter), r: 3.5, class: 'cast-dot' }));
  }
  if (cursorTime !== null && cursorTime <= end) {
    svg.append(svgNode('line', { x1: x(cursorTime), x2: x(cursorTime),
      y1: plot.top, y2: plot.bottom, class: 'cursor' }));
  }
  $('graph-note').textContent = data.simplified
    ? 'Dense events are simplified in this view. Cast totals still use the full simulation.'
    : 'Recovery curves use the simulator’s analytical segments.';
}
$('graph-window').addEventListener('change', () => { cursorTime = null; drawGraph(); });
$('show-best').addEventListener('change', drawGraph);
$('graph').addEventListener('pointermove', inspectGraph);
$('graph').addEventListener('pointerdown', inspectGraph);
function inspectGraph(event) {
  if (!result) return;
  const rect = $('graph').getBoundingClientRect();
  const end = $('graph-window').value === 'full' ? result.duration : Math.min(60, result.duration);
  const svgX = (event.clientX - rect.left) * 640 / rect.width;
  cursorTime = Math.max(0, Math.min(end, (svgX - plot.left) / (plot.right - plot.left) * end));
  const segment = result.segments.find(s => s.start <= cursorTime && cursorTime <= s.end);
  const eitr = segment ? eitrAtSegment(segment, cursorTime) : result.endingEitr;
  $('inspect').textContent = `${format(cursorTime, 2)} s · ${format(eitr, 2)} Eitr${segment ? ` · ${segment.kind === 'recovery' ? 'recovering' : 'paused'}` : ''}`;
  drawGraph();
}

$('optimize').addEventListener('click', () => {
  if (!result) return;
  invalidateOptimization();
  $('optimize').disabled = true; $('optimize').textContent = 'Searching…';
  $('comparison').textContent = 'Testing thresholds within the mobile search budget…';
  const snapshot = { ...settings };
  const input = simulationInput(snapshot);
  // A grid of at most roughly 101 points; the engine enforces both budgets.
  const step = Math.max(1, Math.ceil(snapshot.maxEitr / 100));
  try {
    const searchWorker = new Worker(new URL('./optimizer-worker.mjs', import.meta.url), { type: 'module' });
    worker = searchWorker;
    searchWorker.onmessage = event => {
      if (worker !== searchWorker) return;
      searchWorker.terminate(); worker = null;
      if (serializeSettings(snapshot) !== serializeSettings(settings)) return;
      $('optimize').disabled = false; $('optimize').textContent = 'Optimize';
      if (!event.data.ok) { $('comparison').textContent = event.data.error; return; }
      optimized = event.data.result; optimizedSettings = snapshot;
      const percent = optimized.userCastCount
        ? optimized.improvement / optimized.userCastCount * 100 : null;
      $('comparison').innerHTML = `Your threshold <strong>${format(optimized.userThreshold, 2)}</strong>:
        <strong>${optimized.userCastCount}</strong> completed fireballs.<br>
        Best tested threshold <strong>${format(optimized.bestThreshold, 2)}</strong>:
        <strong>${optimized.bestCastCount}</strong> completed fireballs.<br>
        Improvement: <strong>+${optimized.improvement}</strong>
        ${percent === null ? '(percentage undefined from zero)' : `(+${format(percent, 1)}%)`}.
        <small>${optimized.testedThresholds} thresholds tested.</small>`;
      $('show-best').disabled = false;
      drawGraph();
    };
    searchWorker.onerror = () => {
      if (worker !== searchWorker) return;
      searchWorker.terminate(); worker = null;
      $('optimize').disabled = false; $('optimize').textContent = 'Optimize';
      $('comparison').textContent = 'Search could not run in this browser. Try reloading the page.';
    };
    searchWorker.postMessage({ input, options: { step, userThreshold: snapshot.threshold } });
  } catch (error) {
    $('optimize').disabled = false; $('optimize').textContent = 'Optimize';
    $('comparison').textContent = error.message;
  }
});

if ('serviceWorker' in navigator) window.addEventListener('load',
  () => navigator.serviceWorker.register('../sw.js').catch(() => {}));
render();
