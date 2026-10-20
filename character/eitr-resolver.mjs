// Shared Character Builder Eitr resolution. Catalog names and slots are exact.
export const WEAVE_SLOTS = Object.freeze({
  hood: Object.freeze({ slot: 'head', name: 'Eitr-weave hood' }),
  robe: Object.freeze({ slot: 'chest', name: 'Eitr-weave robe' }),
  trousers: Object.freeze({ slot: 'legs', name: 'Eitr-weave trousers' }),
});

export function foodEitr(foods, baseEitr = 0) {
  return baseEitr + foods.reduce((sum, food) => sum + (Number(food.eitr) || 0), 0);
}

export function resolveCharacterEitr(selection, catalog) {
  if (!selection || typeof selection !== 'object' || !selection.gear ||
      typeof selection.gear !== 'object' || Array.isArray(selection.gear) ||
      !Array.isArray(selection.foods) || selection.foods.length !== 3 ||
      typeof selection.hide !== 'boolean' ||
      !catalog || !Array.isArray(catalog.foods) || !Array.isArray(catalog.equipment)) {
    throw new TypeError('Character Builder selection or catalog is invalid');
  }
  const visible = item => selection.hide === false || !['Ashlands', 'Deep North'].includes(item.biome);
  const foods = [], warnings = [];
  for (const name of selection.foods) {
    if (name === '') continue;
    const food = typeof name === 'string' && catalog.foods.find(item => item.name === name && visible(item));
    if (!food || !Number.isFinite(food.eitr) || food.eitr < 0 || foods.some(item => item.name === name)) {
      warnings.push(`Ignored invalid or hidden food: ${String(name)}`);
      continue;
    }
    foods.push(food);
  }
  const eitrWeave = {}, equipmentNames = [];
  for (const [piece, { slot, name }] of Object.entries(WEAVE_SLOTS)) {
    const saved = selection.gear[slot];
    const matched = catalog.equipment.find(item => item.name === name && item.type === 'Armor' && visible(item));
    eitrWeave[piece] = Boolean(saved && typeof saved === 'object' && saved.name === name &&
      matched && matched.levels?.some(level => level.quality === Number(saved.quality)));
    if (eitrWeave[piece]) equipmentNames.push(name);
    else if (saved?.name === name) warnings.push(`Ignored invalid or hidden equipment: ${name}`);
  }
  return {
    maxEitr: foodEitr(foods, Number(catalog.base?.eitr) || 0),
    foodNames: foods.map(food => food.name), equipmentNames, eitrWeave,
    spoilersHidden: selection.hide, warnings,
  };
}
