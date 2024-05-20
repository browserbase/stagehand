const fs = require('fs');
const observationsPath = './.cache/observations.json';
const actionsPath = './.cache/actions.json';

export function readObservations() {
  return JSON.parse(fs.readFileSync(observationsPath, 'utf8'));
}

export function writeObservations(cache: object) {
  return fs.writeFileSync(observationsPath, JSON.stringify(cache, null, 2));
}

export function readActions() {
  try {
    return JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
  } catch (error) {
    console.error('Error reading from actions.json', error);
    return {};
  }
}

export function writeActions(cache: object) {
  return fs.writeFileSync(actionsPath, JSON.stringify(cache, null, 2));
}

export function getCacheKey(operation: string) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(operation).digest('hex');
}

export function evictCache(key: string) {
  const observationsCache = readObservations();
  const actionsCache = readActions();

  // Filter out the entries with the matching testKey
  const filteredObservationsCache = {};
  Object.keys(observationsCache).forEach((cacheKey) => {
    if (observationsCache[cacheKey].testKey !== key) {
      filteredObservationsCache[cacheKey] = observationsCache[cacheKey];
    }
  });

  const filteredActionsCache = {};
  Object.keys(actionsCache).forEach((cacheKey) => {
    if (actionsCache[cacheKey].testKey !== key) {
      filteredActionsCache[cacheKey] = actionsCache[cacheKey];
    }
  });

  writeObservations(filteredObservationsCache);
  writeActions(filteredActionsCache);
}

export function initCache() {
  const cacheDir = '.cache';

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir);
  }
  if (!fs.existsSync(actionsPath)) {
    fs.writeFileSync(actionsPath, JSON.stringify({}));
  }

  if (!fs.existsSync(observationsPath)) {
    fs.writeFileSync(observationsPath, JSON.stringify({}));
  }
}
