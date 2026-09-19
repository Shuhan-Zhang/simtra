# Simtra frontend · Jev

Static JavaScript frontend for the synthetic-city map, resident filters, predictions, A/B tests, marketing counterfactuals, and verified Census-data views. No frontend build or package install is required.

## Run locally

From the repository root:

1. Put `TYPESAFE_API_KEY` in the ignored server `.env` file.
2. Run `cargo run --bin server` (port 8080).
3. In another terminal, run `python3 -m http.server 5173 --directory frontend`.
4. Open `http://localhost:5173`.

Local pages use the local backend by default. `?port=18473` selects another local backend port. An explicit `?backend=local` remains supported. Hosted pages never contact a visitor's localhost.

For a hosted frontend, configure your deployed Jev backend's HTTPS origin in `backend-config.js` as `window.SIMTRA_BACKEND`. A `?backend=https://your-api.example` URL can override it. The older public API is no longer a fallback. This change does not deploy either service.

Keep API keys on the Rust server. The browser sends no provider credentials.

## Jev behavior

- Predictions, question routing, A/B tests and counterfactuals use `jev-1.13.0`. `?model=jev-latest` or `?model=jev-preview` selects a moving alias. Legacy model names in old links resolve to pinned Jev.
- Poll dates default to today. `?as_of=YYYY-MM-DD` overrides the evaluation date; this does not guarantee a historical model knowledge cutoff.
- For categorical questions, enumerate choices: `Which commute do residents prefer: bus, train, or bicycle?` The router can request clarification instead of inventing categories.
- Jev factors are labeled as selected factors, not resident quotes. Chatter and reactions use labeled illustrative templates because Jev returns typed decisions rather than free-form prose.
- A router outage or missing live A/B endpoint produces an error, never a guessed framing or a saved result masquerading as a prediction.
- `?demo=1` remains an explicitly labeled, offline fixture demo.
- Resident memory and event reactions still require the optional Neo4j backend configuration. Verified-data queries remain deterministic and do not call Jev.

The map's colored residents visualize aggregate probabilities. Census weights and source-record counts remain distinct from simulated-resident counts.

## Checks

```sh
node --test frontend/tests/*.test.mjs frontend/src/*.test.mjs
```

The tests cover provider selection, safe backend configuration, request bodies, failure behavior, evidence charts, resident selection and verified-data contracts. See `../JEV_BACKEND.md` for backend interfaces and tests.
