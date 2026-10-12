/*
 * model.js - the "AI" part of StudyDesk.
 *
 * Three small online-learning components. None of them need training data up
 * front or a server: they learn from the person's clicks while the page is
 * open, which is what makes the interface adaptive at runtime.
 *
 *   1. UsageModel     - recency-weighted frequency scores (which actions to promote)
 *   2. SequenceModel  - first-order Markov chain (which action comes next)
 *   3. PointerModel   - exponential moving average of missed clicks (target size)
 *
 * Works in the browser (window.AdaptiveModel) and in Node (module.exports),
 * so the same code can be unit tested with `node tests/model.test.js`.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.AdaptiveModel = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 1. Recency-weighted usage scores ---------- */
  class UsageModel {
    /**
     * @param {string[]} actionIds - every action the UI offers
     * @param {number} decay - 0..1. Every interaction multiplies all scores by
     *   this value, so old habits fade and new habits can take over.
     */
    constructor(actionIds, decay = 0.92) {
      this.ids = actionIds.slice();
      this.decay = decay;
      this.scores = Object.fromEntries(this.ids.map((id) => [id, 0]));
      this.counts = Object.fromEntries(this.ids.map((id) => [id, 0]));
    }

    record(id) {
      if (!(id in this.scores)) return;
      for (const key of this.ids) this.scores[key] *= this.decay;
      this.scores[id] += 1;
      this.counts[id] += 1;
    }

    /**
     * Pick the top-k actions to promote.
     * Hysteresis: an action that is not already promoted must beat the weakest
     * promoted one by `margin` (e.g. 1.25 = 25% higher) before it replaces it.
     * Without this, two similar scores make the menu flip back and forth, and
     * menus that keep shifting are a known usability problem (Jameson, 2003).
     */
    promoted(k = 3, previous = [], minScore = 1.5, margin = 1.25) {
      const ranked = this.ids
        .filter((id) => this.scores[id] >= minScore)
        .sort((a, b) => this.scores[b] - this.scores[a]);
      if (ranked.length === 0) return [];

      const keep = previous.filter((id) => ranked.includes(id)).slice(0, k);
      const result = keep.slice();

      for (const id of ranked) {
        if (result.length >= k) break;
        if (!result.includes(id)) result.push(id);
      }

      // Challenge the weakest kept item with the strongest outsider.
      const outsiders = ranked.filter((id) => !result.includes(id));
      if (outsiders.length && result.length >= k) {
        const weakest = result.reduce((a, b) => (this.scores[a] <= this.scores[b] ? a : b));
        const challenger = outsiders[0];
        if (this.scores[challenger] > this.scores[weakest] * margin) {
          result[result.indexOf(weakest)] = challenger;
        }
      }
      return result; // slot order is kept stable on purpose
    }
  }

  /* ---------- 2. Next-action prediction (Markov chain) ---------- */
  class SequenceModel {
    constructor(actionIds, alpha = 0.5) {
      this.ids = actionIds.slice();
      this.alpha = alpha; // Laplace smoothing so unseen transitions are not 0%
      this.transitions = {};
      this.last = null;
    }

    record(id) {
      if (!this.ids.includes(id)) return;
      if (this.last !== null) {
        const row = (this.transitions[this.last] ||= {});
        row[id] = (row[id] || 0) + 1;
      }
      this.last = id;
    }

    observationsFrom(id) {
      const row = this.transitions[id] || {};
      return Object.values(row).reduce((sum, n) => sum + n, 0);
    }

    /** Probability distribution over what comes after `from`. */
    distribution(from = this.last) {
      if (from === null) return {};
      const row = this.transitions[from] || {};
      const total = this.observationsFrom(from);
      const denom = total + this.alpha * this.ids.length;
      return Object.fromEntries(
        this.ids.map((id) => [id, ((row[id] || 0) + this.alpha) / denom])
      );
    }

    /**
     * Return the most likely next action, or null when the model is not
     * confident enough. Staying quiet when unsure matters: wrong suggestions
     * cost trust faster than right ones earn it.
     */
    predict(minObservations = 3, minConfidence = 0.45) {
      if (this.last === null) return null;
      if (this.observationsFrom(this.last) < minObservations) return null;
      const dist = this.distribution();
      let best = null;
      for (const id of this.ids) {
        if (id === this.last) continue;
        if (best === null || dist[id] > dist[best]) best = id;
      }
      return dist[best] >= minConfidence ? { id: best, confidence: dist[best] } : null;
    }
  }

  /* ---------- 3. Pointer accuracy -> target size ---------- */
  class PointerModel {
    /**
     * A "miss" is a click that lands in the gap beside a button instead of on
     * it. The EMA weights recent clicks more than old ones.
     * Levels are scale factors for button size. Thresholds differ going up and
     * going down (hysteresis) so the layout does not flicker around a boundary.
     */
    constructor({ alpha = 0.2, minSamples = 8 } = {}) {
      this.alpha = alpha;
      this.minSamples = minSamples;
      this.samples = 0;
      this.missRate = 0;
      this.level = 0; // 0 = normal, 1 = larger, 2 = largest
      this.scales = [1, 1.2, 1.4];
      this.up = [0.25, 0.4]; // miss rate needed to move up to level 1 / 2
      this.down = [0.12, 0.25]; // miss rate needed to drop back to level 0 / 1
    }

    record(hit) {
      this.samples += 1;
      const value = hit ? 0 : 1;
      this.missRate =
        this.samples === 1 ? value : this.alpha * value + (1 - this.alpha) * this.missRate;

      if (this.samples < this.minSamples) return false;
      const before = this.level;
      if (this.level < 2 && this.missRate > this.up[this.level]) this.level += 1;
      else if (this.level > 0 && this.missRate < this.down[this.level - 1]) this.level -= 1;
      return this.level !== before;
    }

    get scale() {
      return this.scales[this.level];
    }
  }

  /* ---------- Small seeded RNG so demos and tests are repeatable ---------- */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return { UsageModel, SequenceModel, PointerModel, mulberry32 };
});
