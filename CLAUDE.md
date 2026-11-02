# tapet

## Feature map

[FEATURES.md](FEATURES.md) lists what tapet does today, one line per feature. It is imported below, so it's in context in every session:

@FEATURES.md

- Before creating or changing anything, find the features it touches in FEATURES.md and keep the change consistent with them.
- When a change adds, alters or removes behavior that users or agents can see, update FEATURES.md in the same commit, following its "Updating this file" rules. Refactors, tests and other internal changes leave it alone.
- If FEATURES.md and the code disagree, check the code, then fix whichever one is wrong.
- The history of FEATURES.md is tapet's changelog (`git log -p -- FEATURES.md`), so the commit message should describe the change in behavior.
