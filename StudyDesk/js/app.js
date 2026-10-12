/*
 * app.js - connects the learning models in model.js to the page.
 *
 * What adapts, and why it is designed this way:
 *   - "Your most used" row  : promotes the 3 most used actions. The main grid
 *                             never reorders (a split-menu design after
 *                             Sears & Shneiderman, 1994, which keeps the
 *                             stable layout people rely on).
 *   - "Next up?" suggestion : appears only when the Markov model is confident.
 *   - Button size           : grows when many clicks land beside buttons.
 *   - Every change is explained in the log, and one switch turns it all off.
 */
(function () {
  "use strict";

  const { UsageModel, SequenceModel, PointerModel, mulberry32 } = window.AdaptiveModel;

  const ACTIONS = [
    { id: "new-task", label: "New task", icon: "\u2795", blurb: "Add a task and a due date." },
    { id: "calendar", label: "Calendar", icon: "\uD83D\uDCC5", blurb: "See deadlines for this week." },
    { id: "notes", label: "Notes", icon: "\uD83D\uDCDD", blurb: "Write up what you learned today." },
    { id: "papers", label: "Find papers", icon: "\uD83D\uDD0E", blurb: "Search journals and your saved sources." },
    { id: "flashcards", label: "Flashcards", icon: "\uD83C\uDCCF", blurb: "Review terms before the quiz." },
    { id: "timer", label: "Focus timer", icon: "\u23F1\uFE0F", blurb: "Start a 25 minute focus block." },
    { id: "homework", label: "Homework", icon: "\uD83D\uDCCB", blurb: "See what is due and submit your work." },
    { id: "reading", label: "Reading list", icon: "\uD83D\uDCDA", blurb: "Pick up the next paper on your list." },
    { id: "export", label: "Export", icon: "\uD83D\uDCE4", blurb: "Save your notes as a document." },
    { id: "settings", label: "Settings", icon: "\u2699\uFE0F", blurb: "Change how StudyDesk looks and behaves." },
  ];
  const IDS = ACTIONS.map((a) => a.id);
  const byId = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
  const STORAGE_KEY = "studydesk-learned-state-v1";
  const PROMOTE_COUNT = 3;

  /* ---------- state ---------- */
  let usage, sequence, pointer;
  let promotedIds = [];
  let suggestionId = null;
  let adaptOn = true;
  let busy = false;
  const log = [];

  function freshModels() {
    usage = new UsageModel(IDS);
    sequence = new SequenceModel(IDS);
    pointer = new PointerModel();
    promotedIds = [];
    suggestionId = null;
  }

  /* ---------- persistence (browser storage may be blocked, so always try/catch) ---------- */
  function save() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          usage: { scores: usage.scores, counts: usage.counts },
          sequence: { transitions: sequence.transitions, last: sequence.last, dismissals: sequence.dismissals },
          pointer: { samples: pointer.samples, missRate: pointer.missRate, level: pointer.level },
          promotedIds,
        })
      );
    } catch (err) {
      /* storage unavailable: the app still works, it just forgets on reload */
    }
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!saved) return;
      Object.assign(usage.scores, saved.usage.scores);
      Object.assign(usage.counts, saved.usage.counts);
      sequence.transitions = saved.sequence.transitions || {};
      sequence.last = saved.sequence.last || null;
      sequence.dismissals = saved.sequence.dismissals || {};
      Object.assign(pointer, saved.pointer);
      promotedIds = (saved.promotedIds || []).filter((id) => IDS.includes(id));
    } catch (err) {
      /* corrupted or blocked storage: start fresh */
    }
  }

  /* ---------- DOM helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const grid = $("actionGrid");
  const promotedRow = $("promotedRow");

  function makeButton(action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "action";
    btn.dataset.id = action.id;
    const icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = action.icon;
    const text = document.createElement("span");
    text.textContent = action.label;
    btn.append(icon, text);
    return btn;
  }

  function addLog(message) {
    log.unshift(message);
    if (log.length > 20) log.pop();
    const list = $("eventLog");
    list.replaceChildren();
    for (const entry of log) {
      const li = document.createElement("li");
      li.textContent = entry;
      list.appendChild(li);
    }
  }

  /* ---------- rendering ---------- */
  function renderGrid() {
    grid.replaceChildren(...ACTIONS.map(makeButton));
    const predicted = adaptOn ? suggestionId : null;
    if (predicted) grid.querySelector(`[data-id="${predicted}"]`)?.classList.add("predicted");
  }

  function renderPromoted() {
    const show = adaptOn && promotedIds.length > 0;
    $("promotedBlock").hidden = !show;
    promotedRow.replaceChildren(...(show ? promotedIds.map((id) => makeButton(byId[id])) : []));
  }

  function renderSuggestion() {
    const box = $("suggestion");
    if (!adaptOn || !suggestionId) {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const dist = sequence.distribution();
    const pct = Math.round((dist[suggestionId] || 0) * 100);
    const text = document.createElement("span");
    text.textContent = `Next up? You often open ${byId[suggestionId].label} after this (${pct}% sure).`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.dataset.id = suggestionId;
    btn.dataset.suggested = "true";
    btn.textContent = `Open ${byId[suggestionId].label}`;
    const notNow = document.createElement("button");
    notNow.type = "button";
    notNow.className = "btn btn-quiet";
    notNow.dataset.dismiss = "true";
    notNow.textContent = "Not now";
    box.replaceChildren(text, btn, notNow);
    box.hidden = false;
  }

  function renderBars() {
    const max = Math.max(1, ...IDS.map((id) => usage.scores[id]));
    const rows = ACTIONS.map((a) => {
      const row = document.createElement("div");
      row.className = "bar-row";
      const label = document.createElement("span");
      label.textContent = a.label;
      const track = document.createElement("div");
      track.className = "bar-track";
      const fill = document.createElement("div");
      fill.className = "bar-fill";
      fill.style.width = `${(usage.scores[a.id] / max) * 100}%`;
      track.appendChild(fill);
      const num = document.createElement("span");
      num.className = "bar-num";
      num.textContent = usage.scores[a.id].toFixed(1);
      row.append(label, track, num);
      return row;
    });
    $("scoreBars").replaceChildren(...rows);
  }

  function renderPointer() {
    const size = Math.round(pointer.scale * 100);
    const text =
      pointer.samples < pointer.minSamples
        ? `Collecting data: ${pointer.samples} of ${pointer.minSamples} clicks. Buttons are at ${size}% size.`
        : `About ${Math.round(pointer.missRate * 100)}% of recent clicks missed a button. Buttons are at ${size}% size.`;
    $("pointerStatus").textContent = text;
    document.documentElement.style.setProperty("--target-scale", adaptOn ? pointer.scale : 1);
  }

  function renderAll() {
    // Re-rendering replaces the buttons, which would drop keyboard focus.
    // Remember which button had focus and give it back afterwards.
    const active = document.activeElement;
    const holder = active && active.classList && active.matches("button") ? active.parentElement : null;
    const zoneId = holder ? holder.id : null;
    const focusedAction = holder ? active.dataset.id : null;

    renderGrid();
    renderPromoted();
    renderSuggestion();
    renderBars();
    renderPointer();

    if (focusedAction && ["actionGrid", "promotedRow", "suggestion"].includes(zoneId)) {
      const target =
        document.querySelector(`#${zoneId} [data-id="${focusedAction}"]`) ||
        document.querySelector(`#actionGrid [data-id="${focusedAction}"]`);
      if (target) target.focus();
    }
  }

  function showWorkspace(action) {
    const box = $("workspace");
    const title = document.createElement("strong");
    title.textContent = action.label;
    const blurb = document.createElement("p");
    blurb.textContent = action.blurb;
    box.replaceChildren(title, blurb);
  }

  /* ---------- the learning step ---------- */
  function onAction(id, { fromSuggestion = false } = {}) {
    const action = byId[id];
    if (!action) return;
    showWorkspace(action);

    if (adaptOn) {
      if (fromSuggestion) addLog(`You accepted the suggestion: ${action.label}.`);

      usage.record(id);
      sequence.record(id);

      const before = promotedIds.slice();
      promotedIds = usage.promoted(PROMOTE_COUNT, promotedIds);
      for (const added of promotedIds.filter((x) => !before.includes(x))) {
        addLog(`Added ${byId[added].label} to "Your most used" (recent use score ${usage.scores[added].toFixed(1)}).`);
      }
      for (const removed of before.filter((x) => !promotedIds.includes(x))) {
        addLog(`Removed ${byId[removed].label} from "Your most used" because other actions overtook it.`);
      }

      const guess = sequence.predict();
      const newId = guess ? guess.id : null;
      if (newId && newId !== suggestionId) {
        addLog(`Learned a pattern: after ${action.label}, you usually open ${byId[newId].label} (${Math.round(guess.confidence * 100)}%).`);
      }
      suggestionId = newId;
    }

    renderAll();
    save();
  }

  function onPointer(hit) {
    if (!adaptOn) return;
    const changed = pointer.record(hit);
    if (changed) {
      const size = Math.round(pointer.scale * 100);
      addLog(
        pointer.scale > 1
          ? `Made buttons ${size}% size because about ${Math.round(pointer.missRate * 100)}% of recent clicks missed.`
          : `Returned buttons to normal size because clicks are landing accurately.`
      );
    }
    renderPointer();
    save();
  }

  /* ---------- events ---------- */
  // Clicks on the grid background (the gaps between buttons) count as near-misses.
  for (const zone of [grid, promotedRow]) {
    zone.addEventListener("click", (event) => {
      if (busy) return;
      const btn = event.target.closest(".action");
      if (btn) {
        onPointer(true);
        onAction(btn.dataset.id);
      } else if (event.target === zone) {
        onPointer(false);
      }
    });
  }

  $("suggestion").addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn || busy) return;
    if (btn.dataset.dismiss) {
      // Easy dismissal: the person can reject a suggestion, and the model learns from it.
      const rejected = suggestionId;
      sequence.dismiss(rejected);
      const guess = sequence.predict();
      suggestionId = guess ? guess.id : null;
      addLog(`You dismissed the suggestion ${byId[rejected].label}. It will be suggested less often.`);
      renderAll();
      save();
      return;
    }
    onPointer(true);
    onAction(btn.dataset.id, { fromSuggestion: true });
  });

  $("adaptToggle").addEventListener("change", (event) => {
    adaptOn = event.target.checked;
    addLog(adaptOn ? "Adaptation turned on." : "Adaptation turned off. The interface is back to its plain layout and has stopped learning.");
    renderAll();
  });

  $("resetBtn").addEventListener("click", () => {
    freshModels();
    log.length = 0;
    $("eventLog").replaceChildren();
    addLog("Cleared everything the interface had learned.");
    $("workspace").replaceChildren(Object.assign(document.createElement("p"), { textContent: "Pick an action above. Each click teaches the interface a little about you." }));
    try { localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
    renderAll();
  });

  /* ---------- demo simulations (fixed seed so every run looks the same) ---------- */
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function withBusy(task) {
    if (busy) return;
    busy = true;
    document.querySelectorAll(".controls .btn").forEach((b) => (b.disabled = true));
    await task();
    busy = false;
    document.querySelectorAll(".controls .btn").forEach((b) => (b.disabled = false));
  }

  $("simRoutine").addEventListener("click", () =>
    withBusy(async () => {
      if (!adaptOn) { $("adaptToggle").checked = true; adaptOn = true; }
      addLog("Simulating a study routine: New task, Calendar, Notes, repeated.");
      const rand = mulberry32(2026);
      const routine = ["new-task", "calendar", "notes"];
      for (let i = 0; i < 24; i++) {
        const noisy = rand() < 0.15;
        const id = noisy ? IDS[Math.floor(rand() * IDS.length)] : routine[i % routine.length];
        onAction(id);
        await sleep(140);
      }
    })
  );

  $("simShaky").addEventListener("click", () =>
    withBusy(async () => {
      if (!adaptOn) { $("adaptToggle").checked = true; adaptOn = true; }
      addLog("Simulating a shaky pointer: about half of the clicks miss.");
      const rand = mulberry32(99);
      for (let i = 0; i < 24; i++) {
        onPointer(rand() > 0.55);
        await sleep(110);
      }
    })
  );

  /* ---------- start ---------- */
  freshModels();
  load();
  renderAll();
})();
