const fs = require('fs');
const crypto = require('crypto');
const observationsPath = './.cache/observations.json';
const actionsPath = './.cache/actions.json';

class Cache {
  observations: Record<string, any>;
  actions: Record<string, any>;
  disabled: boolean;

  constructor({ disabled = false } = {}) {
    this.disabled = disabled;
    if (!this.disabled) {
      this.initCache();
      this.observations = this.readObservations();
      this.actions = this.readActions();
    }
  }

  readObservations() {
    if (this.disabled) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(observationsPath, 'utf8'));
    } catch (error) {
      console.error('Error reading from observations.json', error);
      return {};
    }
  }

  readActions() {
    if (this.disabled) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(actionsPath, 'utf8'));
    } catch (error) {
      console.error('Error reading from actions.json', error);
      return {};
    }
  }

  // handle adding to the memory cache vs. writing to disk
  writeObservations(cache: string) {
    if (this.disabled) {
      return;
    }
    fs.writeFileSync(
      observationsPath,
      JSON.stringify(this.observations, null, 2)
    );
  }

  writeActions() {
    if (this.disabled) {
      return;
    }
    fs.writeFileSync(actionsPath, JSON.stringify(this.actions, null, 2));
  }

  getCacheKey(operation) {
    return crypto.createHash('sha256').update(operation).digest('hex');
  }

  evictCache(key) {
    // Filter out the entries with the matching testKey
    this.observations = Object.fromEntries(
      Object.entries(this.observations).filter(
        ([cacheKey, value]) => value.testKey !== key
      )
    );

    this.actions = Object.fromEntries(
      Object.entries(this.actions).filter(
        ([cacheKey, value]) => value.testKey !== key
      )
    );

    this.writeObservations();
    this.writeActions();
  }

  private initCache() {
    if (this.disabled) {
      return;
    }
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
}

export default Cache;
