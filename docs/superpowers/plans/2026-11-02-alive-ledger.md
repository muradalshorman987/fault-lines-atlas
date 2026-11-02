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
