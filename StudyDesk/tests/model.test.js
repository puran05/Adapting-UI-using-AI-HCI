// Run with: node tests/model.test.js   (Node 18+, no packages needed)
const test = require("node:test");
const assert = require("node:assert");
const { UsageModel, SequenceModel, PointerModel, mulberry32 } = require("../js/model.js");

const IDS = ["a", "b", "c", "d", "e"];

test("UsageModel: frequently used actions score highest", () => {
  const m = new UsageModel(IDS);
  ["a", "a", "a", "b", "a", "b", "c"].forEach((id) => m.record(id));
  assert.ok(m.scores.a > m.scores.b);
  assert.ok(m.scores.b > m.scores.d);
});

test("UsageModel: old habits fade (recency beats raw count)", () => {
  const m = new UsageModel(IDS, 0.8);
  for (let i = 0; i < 10; i++) m.record("a");
  for (let i = 0; i < 6; i++) m.record("b");
  assert.ok(m.counts.a > m.counts.b);
  assert.ok(m.scores.b > m.scores.a, "recent habit b should now outrank old habit a");
});

test("UsageModel: promoted() ignores actions below the minimum score", () => {
  const m = new UsageModel(IDS);
  m.record("a");
  assert.deepStrictEqual(m.promoted(3), []);
});

test("UsageModel: hysteresis stops a near-tie from swapping the menu", () => {
  const m = new UsageModel(IDS, 1); // no decay keeps the maths easy
  ["a", "a", "a", "b", "b", "b", "c", "c", "c"].forEach((id) => m.record(id));
  const first = m.promoted(2);
  assert.strictEqual(first.length, 2);
  const outsider = IDS.find((id) => ["a", "b", "c"].includes(id) && !first.includes(id));
  m.record(outsider); // now 4 vs 3: only 33% higher than 3, and the margin is 25%
  m.record(outsider); // 5 vs 3: clearly higher
  const second = m.promoted(2, first);
  assert.ok(second.includes(outsider), "a clearly stronger action should get in");
});

test("UsageModel: stable slot order for items that stay promoted", () => {
  const m = new UsageModel(IDS);
  for (let i = 0; i < 4; i++) m.record("a");
  for (let i = 0; i < 3; i++) m.record("b");
  const first = m.promoted(3);
  m.record("b");
  m.record("b");
  const second = m.promoted(3, first);
  assert.deepStrictEqual(second.slice(0, first.length), first);
});

test("SequenceModel: learns a repeating routine and predicts the next step", () => {
  const m = new SequenceModel(IDS);
  for (let i = 0; i < 5; i++) ["a", "b", "c"].forEach((id) => m.record(id));
  m.record("a");
  const guess = m.predict();
  assert.ok(guess, "should make a prediction");
  assert.strictEqual(guess.id, "b");
  assert.ok(guess.confidence > 0.7);
});

test("SequenceModel: stays quiet with too little evidence", () => {
  const m = new SequenceModel(IDS);
  ["a", "b", "a"].forEach((id) => m.record(id));
  assert.strictEqual(m.predict(), null);
});

test("SequenceModel: probabilities sum to 1", () => {
  const m = new SequenceModel(IDS);
  ["a", "b", "a", "c", "a", "b"].forEach((id) => m.record(id));
  const total = Object.values(m.distribution("a")).reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("SequenceModel: dismissing a suggestion lowers it until it stops appearing", () => {
  const m = new SequenceModel(IDS);
  for (let i = 0; i < 5; i++) ["a", "b", "c"].forEach((id) => m.record(id));
  m.record("a");
  const before = m.predict();
  assert.strictEqual(before.id, "b");
  m.dismiss("b");
  const afterOne = m.distribution().b;
  assert.ok(afterOne < before.confidence, "one dismissal should lower confidence");
  m.dismiss("b");
  m.dismiss("b");
  assert.strictEqual(m.predict(), null, "three dismissals should silence it");
});

test("SequenceModel: probabilities still sum to 1 after dismissals", () => {
  const m = new SequenceModel(IDS);
  ["a", "b", "a", "b", "a", "c", "a"].forEach((id) => m.record(id));
  m.dismiss("b");
  const total = Object.values(m.distribution()).reduce((s, p) => s + p, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
});

test("PointerModel: accurate clicking keeps buttons at normal size", () => {
  const m = new PointerModel();
  for (let i = 0; i < 30; i++) m.record(true);
  assert.strictEqual(m.level, 0);
  assert.strictEqual(m.scale, 1);
});

test("PointerModel: repeated misses enlarge targets, recovery shrinks them", () => {
  const m = new PointerModel();
  const rand = mulberry32(7);
  for (let i = 0; i < 40; i++) m.record(rand() > 0.5); // about 50% misses
  assert.ok(m.level >= 1, "should have grown at least one level");
  for (let i = 0; i < 60; i++) m.record(true);
  assert.strictEqual(m.level, 0, "should return to normal after accurate clicking");
});

test("PointerModel: waits for enough samples before changing anything", () => {
  const m = new PointerModel({ minSamples: 8 });
  for (let i = 0; i < 5; i++) m.record(false);
  assert.strictEqual(m.level, 0);
});
