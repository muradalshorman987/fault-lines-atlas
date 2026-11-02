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

## ask-builder: complete
- 37 tests.
- CSP browser check on a scratch build with the vercel.json headers: no violations. The inline-script hash matches.
- A fake key against the real API: CORS preflight OK and the 401 message renders, in AR 1280 and EN light 390. The key is not stored and not in the URL.
- MapLibre runs under the CSP: blob worker, OpenFreeMap style and tiles OK.
- Models (claude-api skill table): claude-sonnet-5-5 (default), claude-haiku-5-5, claude-opus-5-5. API version 2026-10-21 (from the skill).
- NOT verified: a real-key question end to end. The owner should run one before relying on it.

Rulings:
- Raw fetch + SSE, no SDK.
- Server-side fallback beta header on Sonnet/Opus. If the API rejects it, flip the `fallback` flag in models.ts.
- Append-only history, 10 questions per conversation.
- Effort medium, max_tokens 16000, 5 tool rounds.
- An unknown ref shows as plain text.
- `sh.ask` string registered in ask/strings.ts.

Coupling: `vercel.json` CSP holds the sha256 of index.html's inline pre-paint script. Changing that script requires updating the hash; tests/ask-csp.test.tsx guards it.
