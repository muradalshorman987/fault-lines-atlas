# Ledger: team run atlas-alive (plan: docs/superpowers/plans/2026-11-02-team-alive.md)

lead: shared contracts e76fe56. Welcome event 6e94fd5. lastOf (sticky event payloads) 1890882, requested by map-builder and pulse-builder.

## pulse-builder: complete
- 15 tests, including a mutation check.
- Browser: AR dark and EN light at 1280 px, AR and EN at 390 px; no overflow, no console errors.
- `?region=africa&sev=war` restores the filter chips and the region strip.
- "Follow the map" works with the real viewport event.

Rulings:
- Severity is never shown as touching colour segments, only as labelled rows. Why: `--sev-*` fails the categorical palette validator (post-conflict vs political ΔE 6.8 dark / 8.0 light). Cost: none for pulse.
- The dimension filter is local to Pulse (the store has no key for it). Cost: it isn't in the URL and the map ignores it.
- Charts don't crossfilter themselves; selected bars are marked instead. Cost: small.
- Under "follow the map", a conflict counts if any party is in view.
- "Unverified developments" counts conflict files only (23), matching the spec.
- A verdict above +100% reads "N× the average".

## brief-builder: complete
- 13 brief and 24 dossier tests.
- Browser: SAU in AR dark and EN light at 1280 and 390, with no errors. The print view shows only the brief, on light paper.
- With the figures stubbed: Latest figures shows its chips, the Yemen deaths chart draws 34 bars, and Compare shows its chips.

Rulings:
- A zero conflict count is not ranked.
- The "external power" line excludes conflicts where the country is already a party.
- `figures.gdp` is plain US$; it is divided by 1e6 unless the unit says million.
- Print forces light tokens.
- "Displaced" = refugeesFrom + idps.

Follow-up (lead, fix stage): `compare.tsx` imports `../dossier/brief/facts`, a feature-to-feature import. Move `facts.ts` to shared code (`src/data/facts.ts`).
