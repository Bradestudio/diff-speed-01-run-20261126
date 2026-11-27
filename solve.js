// Faster drop-in for makefun-diff 1.0.0.
//
// The same patch as makefun-diff 1.0.0, computed the fast way: every line of
// both texts is interned once to a small integer, the common prefix and suffix
// are stripped on integers, and Myers's greedy search runs on the integers
// with one flat Int32Array holding every depth's furthest-reaching x, so the
// search never allocates per cell. The search follows makefun-diff's rule
// exactly: on each diagonal the furthest point wins, a deletion wins a tie
// against an insertion, no move passes either text's end, no edge diagonal is
// pruned, and every run of equal lines is followed as far as it goes. The
// first path to reach both ends is recovered by walking the stored depths
// backwards with the same choice at every step, which rebuilds the very
// script the forward search found. The patch is then rendered from those
// runs with 3 lines of context and hunks merged across gaps of at most 6.
//
// Stdlib only, no network, no writes, no state kept between cases: each
// run() builds its own tables and forgets them.

/** The context lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** No path reaches this diagonal at this depth. x is never below -1. */
const NO_PATH = -2;

const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** makefun-diff 1.0.0's patch of input { old, new }, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('makefun-diff: the input is { old, new }, two strings');
  }

  // Intern every distinct line once, shared by both texts, so the search and
  // the prefix/suffix strip compare small integers instead of strings. A
  // line is its text before "\n" plus whether it had one; only a text's last
  // line can lack it, so bare lines get their own small table and no line
  // string is ever built just to be a key.
  const ids = new Map();
  const bareIds = new Map();
  const parts = [];
  const hasNL = [];
  const intern = (part, nl) => {
    const table = nl ? ids : bareIds;
    let id = table.get(part);
    if (id === undefined) {
      id = parts.length;
      table.set(part, id);
      parts.push(part);
      hasNL.push(nl ? 1 : 0);
    }
    return id;
  };
  const oldParts = input.old.split('\n');
  const newParts = input.new.split('\n');
  const n = oldParts.length - 1 + (oldParts[oldParts.length - 1] !== '' ? 1 : 0);
  const m = newParts.length - 1 + (newParts[newParts.length - 1] !== '' ? 1 : 0);
  const a = new Int32Array(n);
  const b = new Int32Array(m);
  for (let i = 0; i < oldParts.length - 1; i++) a[i] = intern(oldParts[i], true);
  if (oldParts[oldParts.length - 1] !== '') a[oldParts.length - 1] = intern(oldParts[oldParts.length - 1], false);
  for (let i = 0; i < newParts.length - 1; i++) b[i] = intern(newParts[i], true);
  if (newParts[newParts.length - 1] !== '') b[newParts.length - 1] = intern(newParts[newParts.length - 1], false);

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix++;
  const N = n - prefix - suffix;
  const M = m - prefix - suffix;
  // The middle sections, copied once with an unlike sentinel past each end,
  // so the snake loop needs no bounds checks: the sentinels never match.
  const aMid = new Int32Array(N + 1);
  const bMid = new Int32Array(M + 1);
  aMid.set(a.subarray(prefix, n - suffix));
  bMid.set(b.subarray(prefix, m - suffix));
  aMid[N] = -1;
  bMid[M] = -2;

  // --- Myers's greedy search, storing every depth's furthest x. ---
  // Depth d holds d + 1 diagonals, j = (k + d) / 2, packed flat with a
  // NO_PATH guard on each side: entry j lives at off(d) + 1 + j, off(d) is
  // the leading guard, off(d) + d + 2 the trailing one, and
  // off(d) = d * (d + 5) / 2. The store doubles when a deeper search needs it.
  let capD = 4096;
  let v = new Int32Array(((capD * (capD + 5)) >> 1) + capD + 3);
  const off = (d) => (d * (d + 5)) >> 1;
  const ensure = (d) => {
    if (d <= capD) return;
    while (capD < d) capD *= 2;
    const grown = new Int32Array(((capD * (capD + 5)) >> 1) + capD + 3);
    grown.set(v);
    v = grown;
  };

  v[0] = NO_PATH;
  v[2] = NO_PATH;
  let x = 0;
  while (aMid[x] === bMid[x]) x++;
  v[1] = x;
  let D = -1;
  let kEnd = 0;
  if (x === N && x === M) {
    D = 0;
  } else {
    outer: for (let d = 1; d <= N + M; d++) {
      ensure(d);
      const base = off(d);
      const pbase = off(d - 1);
      v[base] = NO_PATH;
      v[base + d + 2] = NO_PATH;
      for (let j = 0; j <= d; j++) {
        const k = (j << 1) - d;
        const xd = v[pbase + j];
        const xu = v[pbase + j + 1];
        const canDel = xd !== NO_PATH && xd < N;
        const canIns = xu !== NO_PATH && xu - k <= M;
        if (!canDel && !canIns) { v[base + j + 1] = NO_PATH; continue; }
        // Furthest into the old text wins; a deletion wins the tie.
        let xx = canDel && (!canIns || xd + 1 >= xu) ? xd + 1 : xu;
        while (aMid[xx] === bMid[xx - k]) xx++;
        const yy = xx - k;
        v[base + j + 1] = xx;
        if (xx === N && yy === M) { D = d; kEnd = k; break outer; }
      }
    }
  }
  if (D < 0) throw new Error('makefun-diff: the search ended without reaching both ends');

  // --- Walk the stored depths backwards to rebuild the script's runs. ---
  // Runs are collected last-to-first, then reversed; equal neighbours merge.
  const revKind = [];
  const revCount = [];
  const pushRev = (kind, count) => {
    if (count <= 0) return;
    const t = revKind.length - 1;
    if (t >= 0 && revKind[t] === kind) revCount[t] += count;
    else { revKind.push(kind); revCount.push(count); }
  };
  x = N;
  let k = kEnd;
  for (let d = D; d >= 1; d--) {
    const j = (k + d) >> 1;
    const pbase = off(d - 1);
    const xd = j > 0 ? v[pbase + j] : NO_PATH;
    const xu = j < d ? v[pbase + j + 1] : NO_PATH;
    const canDel = xd !== NO_PATH && xd < N;
    const canIns = xu !== NO_PATH && xu - k <= M;
    let del;
    if (canDel && (!canIns || xd + 1 >= xu)) del = true;
    else if (canIns) del = false;
    else throw new Error('makefun-diff: the search ended without reaching both ends');
    let xMove;
    let prevK;
    if (del) { prevK = k - 1; xMove = xd + 1; }
    else { prevK = k + 1; xMove = xu; }
    // Walking backwards: the snake after this depth's edit comes first.
    pushRev(KEEP, x - xMove);
    pushRev(del ? DELETE : INSERT, 1);
    x = del ? xd : xu;
    k = prevK;
  }
  pushRev(KEEP, v[1]);

  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const t = runs.length - 1;
    if (t >= 0 && runs[t].kind === kind) runs[t].count += count;
    else runs.push({ kind, count });
  };
  if (prefix > 0) pushRun(KEEP, prefix);
  for (let i = revKind.length - 1; i >= 0; i--) pushRun(revKind[i], revCount[i]);
  if (suffix > 0) pushRun(KEEP, suffix);

  // --- The patch, from the runs. ---
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) { o += r.count; p += r.count; continue; }
    let c = changes.at(-1);
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) { c.dels += r.count; o += r.count; deleted += r.count; }
    else { c.ins += r.count; p += r.count; inserted += r.count; }
  }
  const hunks = [];
  for (const c of changes) {
    const h = hunks.at(-1);
    const prev = h?.at(-1);
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }
  const written = (op, id) => (hasNL[id] ? `${op}${parts[id]}\n` : `${op}${parts[id]}\n%\n`);
  const out = [`makefun-diff/1 old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h.at(-1);
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written('=', a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written('-', a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written('+', b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written('=', a[at]));
  }
  return out.join('');
}
