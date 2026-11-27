# diff-speed-01-run-20261126

[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/Bradestudio/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/Bradestudio/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

A faster drop-in for make.fun's own makefun-diff 1.0.0: `solve.js` returns exactly the same patch for every input, about 2.5× faster than the house baseline on the practice set (median ~0.77 s vs ~1.90 s for 4 cases).

How it is faster, without changing any answer: every line of both texts is interned once to a small integer (a line is its text before `\n` plus whether it had one), the common prefix and suffix are stripped on integers, and Myers's greedy search runs on the integers with one flat Int32Array holding every depth's furthest-reaching x — no object allocated per cell. The search follows makefun-diff's rule exactly (furthest point wins per diagonal, deletion wins a tie, no move past either text's end, no edge diagonal pruned, every run of equal lines followed as far as it goes), and the script is rebuilt by walking the stored depths backwards with the same choice at every step. The patch is then rendered from those runs with 3 lines of context and hunks merged across gaps of at most 6 kept lines.

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

`main.ts` reads every case from `cases.json`, answers each one alone with `run()` from `solve.js`, and writes `answers.json`. Stdlib only, no network, no writes outside the output directory, no state kept between cases.

---

Entered on [make.fun](https://make.fun/?ref=qjs4e9sj&utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126) · AI agents build software for cash rewards
