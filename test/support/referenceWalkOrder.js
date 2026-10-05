// An independent "second opinion" on the best possible walk order for a given, already-built
// plan (thisplugin.sortedFanpoints: anchor first, links/fields already fixed by the real
// algorithm) -- written from scratch, without reusing any of the plugin's own ordering code, so
// a regression in that code can't also silently "pass" its own reference.
//
// The link/field STRUCTURE is never touched here (that's the real algorithm's job, not the walk
// order's) -- this only ever decides which order to VISIT the same fixed set of portals in,
// exactly what "Less walking" itself does. Two things must hold for an order to be considered
// at all, mirroring the fan field principle the real plan already encodes and that walking it in
// the wrong order could otherwise break:
//  - every portal that throws a link needs the target's key first, i.e. the target must be
//    visited before the source (same precedence idea thisplugin.computeRouteOrder/
//    orderPrefixForOutbound already use for their own, narrower cases);
//  - no field the plan built may be lost: simulateWalk(order).invalid must not exceed what the
//    real plan's own order already has.
// Subject to both, it minimizes total walking distance via a nearest-neighbour-with-precedence
// construction followed by a bounded 2-opt / relocate local search.

'use strict';

function buildPrecedences(sortedFanpoints) {
  const indexByGuid = {};
  sortedFanpoints.forEach(function (fp, i) { indexByGuid[fp.guid] = i; });
  const precedences = [];
  sortedFanpoints.forEach(function (fp, i) {
    (fp.outgoing || []).forEach(function (target) {
      const j = indexByGuid[target.guid];
      if (j !== undefined) precedences.push([j, i]); // target (j) before source (i)
    });
  });
  return precedences;
}

function computeReferenceWalkOrder(thisplugin, sortedFanpoints, options) {
  options = options || {};
  const timeBudgetMs = options.timeBudgetMs || 4000;
  const n = sortedFanpoints.length;
  const precedences = buildPrecedences(sortedFanpoints);

  function dist(i, j) {
    return thisplugin.distanceTo(sortedFanpoints[i].point, sortedFanpoints[j].point);
  }

  function lengthOf(seq) {
    let total = 0;
    for (let k = 1; k < seq.length; k++) total += dist(seq[k - 1], seq[k]);
    return total;
  }

  function violationsOf(seq) {
    const pos = new Array(n);
    seq.forEach(function (idx, p) { pos[idx] = p; });
    return precedences.filter(function (pair) { return pos[pair[0]] > pos[pair[1]]; }).length;
  }

  function evaluate(seq) {
    const sim = thisplugin.simulateWalk(seq.map(function (idx) { return sortedFanpoints[idx]; }));
    return {
      seq: seq,
      violations: violationsOf(seq),
      invalid: Object.keys(sim.invalid).length,
      fields: sim.triangles.length,
      length: lengthOf(seq)
    };
  }

  // Lower is better on every axis except fields (higher is better) -- playability
  // (precedence/invalid) always wins over distance, same priority order the real codebase's
  // own local searches already use for comparable trade-offs.
  function isBetter(a, b) {
    if (a.violations !== b.violations) return a.violations < b.violations;
    if (a.invalid !== b.invalid) return a.invalid < b.invalid;
    if (a.fields !== b.fields) return a.fields > b.fields;
    return a.length < b.length - 1e-9;
  }

  // Nearest-neighbour construction: repeatedly pick, among portals whose precedence
  // predecessors are already placed, whichever is closest to the last one placed (or, for the
  // very first pick, whichever currently has none unmet).
  const seq = [];
  const placed = new Array(n).fill(false);
  let current = null;
  while (seq.length < n) {
    let choice = -1;
    for (let i = 0; i < n; i++) {
      if (placed[i]) continue;
      const blocked = precedences.some(function (pair) { return pair[1] === i && !placed[pair[0]]; });
      if (blocked) continue;
      if (choice === -1) { choice = i; continue; }
      if (current === null) continue; // first pick: no distance to compare by yet, keep the first found
      if (dist(current, i) < dist(current, choice)) choice = i;
    }
    if (choice === -1) {
      // A cycle among precedences (should not happen for a real, acyclic fan plan) -- fall back
      // to any unplaced portal so this never spins forever.
      choice = placed.indexOf(false);
    }
    seq.push(choice);
    placed[choice] = true;
    current = choice;
  }

  let best = evaluate(seq);
  const deadline = Date.now() + timeBudgetMs;

  function tryReplace(candidateSeq) {
    const candidate = evaluate(candidateSeq);
    if (isBetter(candidate, best)) { best = candidate; return true; }
    return false;
  }

  let improved = true;
  while (improved && Date.now() < deadline) {
    improved = false;

    // 2-opt: reverse every possible contiguous stretch.
    for (let i = 0; i < n - 1 && !improved && Date.now() < deadline; i++) {
      for (let j = i + 1; j < n && !improved; j++) {
        const candidate = best.seq.slice(0, i).concat(best.seq.slice(i, j + 1).reverse(), best.seq.slice(j + 1));
        improved = tryReplace(candidate);
      }
    }
    if (improved) continue;

    // Relocate: move a short run (1-3 portals) elsewhere in the order.
    for (let len = 1; len <= 3 && !improved && Date.now() < deadline; len++) {
      for (let i = 0; i + len <= n && !improved && Date.now() < deadline; i++) {
        const run = best.seq.slice(i, i + len);
        const rest = best.seq.slice(0, i).concat(best.seq.slice(i + len));
        for (let j = 0; j <= rest.length && !improved; j++) {
          if (j === i) continue;
          improved = tryReplace(rest.slice(0, j).concat(run, rest.slice(j)));
        }
      }
    }
  }

  return {
    order: best.seq.map(function (idx) { return sortedFanpoints[idx]; }),
    totalDistance: best.length,
    fields: best.fields,
    invalid: best.invalid,
    violations: best.violations
  };
}

module.exports = { computeReferenceWalkOrder, buildPrecedences };
