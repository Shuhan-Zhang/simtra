# Simtra frontend · Jev

Static JavaScript frontend for the synthetic-city map, resident filters, predictions, A/B tests, marketing counterfactuals, and verified Census-data views. No frontend build or package install is required.

## Run locally

From the repository root:

1. Put `TYPESAFE_API_KEY` and `BRAVE_SEARCH_API_KEY` in the ignored server `.env` file.
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
- Jev supplies structured prediction probabilities and factors. Resident thoughts and reactions use Gemini with `GEMINI_API_KEY` and optional `GEMINI_MODEL` (default `gemini-3.5-flash-lite`), restoring the previous narrative behavior. Missing Gemini leaves voices unavailable; there is no template substitution.
- A router outage or missing live A/B endpoint produces an error, never a guessed framing or a saved result masquerading as a prediction.
- `?demo=1` remains an explicitly labeled, offline fixture demo.
- Resident memory and event reactions still require the optional Neo4j backend configuration. Verified-data queries remain deterministic and do not call Jev.

The map's colored residents visualize aggregate probabilities. Census weights and source-record counts remain distinct from simulated-resident counts.

## Automatic experiments

The original blue town and ask box are the default surface. Enter a decision;
Simtra researches public sources, builds evidence-backed qualitative customer profiles,
then plans and runs a bounded comparison automatically. The entry point is text-only.
General opinion questions use a quick prediction.
Automatic and Quick prediction modes are visible directly below the text prompt. Refine a completed
experiment when you want to change its assumptions.

`POST /cities/:city/experiment-plan` makes one typed Jev evaluation to select a
bounded experiment recipe, outcome and two candidate areas from the city profile.
Jev does not generate prose or invent a winner. The frontend expands that recipe
into explicit experimental assumptions, available while running and with the results:

- Commercial launches: two areas × six prices × two operating formats = 24
  combinations across three factors. Restaurants compare takeaway/dine-in;
  marketplaces compare pickup/local delivery. Default $10–$20 prices are visible,
  steerable hypotheses, not verified menu prices. No invented budget, discount or
  redemption caps. A stated budget remains a constraint, not an allocation.
- Price changes: six points from current to the requested percentage, crossed
  with area and format. When no amount is specified, 0–20% is an explicit editable
  hypothesis. A 20% increase tests 0%, +4%, +8%, +12%, +16%, +20%;
  no absolute menu price is invented unless the user selects assumed dollar prices.
- Other resident-preference decisions: explicitly listed alternatives after a
  colon, or current approach vs proposed change, crossed with availability and
  explanation format (three factors). These are proposed hypotheses. Unsupported
  questions return an error rather than fabricated plans or results.

The results card ranks the requested weighted metric, with tied ranks where
appropriate, top-three-first disclosure and all combinations available. Price
experiments show six selectable price points with area and format held fixed;
switch either to inspect another curve. Lines are visual guides, not
fitted elasticity or supply estimates. Quick prediction remains available next to Automatic. Historical A/B and post
results stay readable; their launch controls are absent from the entry point.

`POST /branches/:bid/research` evaluates every scenario against the branch's same
immutable sampled population, model, evaluation date and supplied assumptions. It
accepts an optional `research_panel` reference (ID, exact version and content hash),
resolved only from the caller’s workspace on the server. A bounded evidence snapshot
is identical in every scenario; profile counts never replace Census population weights.
Missing, changed or insufficient evidence fails before inference. The endpoint
uses the existing weighted polling engine but excludes mutable news, retrieval and
persona-memory reads/writes. Every archetype must answer every scenario; partial
comparisons are errors. The response includes normal weighted poll results plus
compressed groups of resident IDs and their inherited distributions/factors. This
allows resident inspection even when Neo4j is disabled. The endpoint accepts 2–24
scenarios and 2–5 explicit response options.

Selecting an option or curve point updates the existing persona chart. Selecting
a demographic segment highlights its actual members in the town. Selecting a
sprite or resident displays saved probabilities across all scenarios and clearly
labels them as inherited group responses, not interviews. The chart always uses
the requested metric, not the winning response category. Census composition is
under **Who this represents**, separate from the estimates. Launch-area scenarios
use the same city audience, not location-specific footfall or neighborhood samples.

Complete runs and their sampled residents are stored in IndexedDB in this browser,
including filters, assumptions, options, model and date. Reopening a run restores
its original map population. Refinements keep their parent run and restore its
audience before preparing a new test. Storage failures are shown in the panel;
sessions are not synced across devices. Offline demo history is stored separately.

For fixture-based browser checks, serve `frontend` and run:

```sh
SIMTRA_TEST_BASE=http://127.0.0.1:5198 node frontend/tests/automatic-demo-browser.cjs
```

Requires Chrome and Playwright (`SIMTRA_PLAYWRIGHT` may point to an installed package).
Checks automatic launch/pricing runs, resident inspection, refinement, reload,
390px layout, quick prediction and diagnostics with zero external requests.
The Rust `research_contract` suite exercises the actual HTTP comparison pipeline
against a loopback provider, including complete coverage and failure behavior.
These checks do not validate predictive accuracy or call a paid model.
`?demo=1` uses explicitly labeled illustrative fixed rankings/curves, independent
of the submitted question. Live failures never fall back to those fixtures.

The demo now contains **10,000 seeded synthetic residents per city**, matching
the live population size. Per-city compressed fixtures load on demand; all map
IDs, experiment memberships, counts and demographic weights use that population.
Regenerate them with `python3 frontend/tests/export-evidence-fixture.py` while the
loopback-only fixture server is running. This uses the actual backend sampler and
matching weighted poll aggregates, not copies of the previous 256-person sample.
The small `evidence-demo.json` remains a historical test fixture only. Earlier
saved experiments retain their original sample size, rather than relabeling them.

## Automated checks

```sh
node --test frontend/tests/*.test.mjs frontend/src/*.test.mjs
```

The tests cover provider selection, safe backend configuration, request bodies, failure behavior, evidence charts, resident selection and verified-data contracts. See `../JEV_BACKEND.md` for backend interfaces and tests.
# Experiment execution logs

`?demo=1` never calls a model: its answers are fixed illustrative fixtures. The
experiment panel labels this mode. Its control-panel log reports zero model
requests. Use the local preview without `demo=1` for the backend pipeline.
Start `cargo run -p simfrancisco --bin server` from the repository root with
`TYPESAFE_API_KEY` configured in ignored `.env` (never in browser code). A missing
server or key produces an error, not a substitute fixture result.

After planning the browser automatically uses `POST /branches/:bid/research/stream` (NDJSON).
The customer surface displays only completion progress, not diagnostic logs.
Open **Developer control panel** in About, or visit `control.html` on the same
origin/browser. This local diagnostics page is not an authenticated admin endpoint.
It contains exact questions, factor levels, criteria, assumptions, every scenario,
coverage, exportable JSON and request-scoped events for scenario start, archetype batches, provider
requests/responses, cache hits, retries, coverage, weighted aggregation and failure.
The non-streaming `/research` endpoint returns the same `trace` alongside results;
planning success/errors include a trace too. Logs are saved with each browser-local
experiment and emitted through the server's `simfrancisco::execution` logging target.
They contain timing, counters and execution metadata, not API keys, raw prompts,
provider bodies or hidden model reasoning. Old saved runs have no retroactive trace.

10,000 synthetic residents are grouped into up to 160 representative archetypes,
evaluated in batches of 12 for each scenario. Members inherit their group's answer;
these are not independent interviews or observed customers. This controlled pipeline
uses explicit assumptions, optional pinned web-research context and one frozen
snapshot of dated news, never per-scenario mutable news or previous-run memories.
`MODEL_FIXTURE=1` is reserved for local mock-provider tests and labels their results.
Disconnecting cancels further streamed work; an already dispatched provider request
may still be processed. EOF, partial coverage and provider errors never save a result.

## Chipotle walkthrough

Enter “I want to raise chipotle bowl prices in sf”. The live path requires search
and Jev; unavailable research produces a clear error instead of invented sources.
The progress card shows research, the area × price × format plan, and real completed
scenario counts. Results show the price curve, matched factor differences and Census
breakdowns. Operating costs, actual sales and profit are not inferred from stated intent.

Choose “Follow this scenario over 14 days” to start the selected offer on the same
audience with the same pinned research. This estimates daily routine adaptation; it
is not a continuation of the purchase-intent metric. The timeline’s single composer
accepts hypothetical news updates or yes/no questions. Updates take effect on the next
uncomputed day; questions use the viewed recorded day. Previous frames never change.
No Neo4j configuration is required for these timeline-local updates. Up to 20 updates
and 20 questions per run; playback is bounded to 14 days and can be paused or replayed.

Browser regression: `node frontend/tests/chipotle-flow-browser.cjs` (Playwright +
Chrome; set `SIMTRA_PLAYWRIGHT` to a local package path if needed). This test uses
explicit mocked responses; it does not verify provider credentials or live accuracy.

Resident map labels are matched through the selected scenario’s exact response-group
member IDs. Generic fallback quotes and cycling anonymous rationales across unrelated
residents are removed. Sparse, cached Gemini-generated thoughts remain in the idle map. Tapping a resident opens its actual Census-based synthetic
profile. Quick-prediction map colors illustrate the aggregate split and do not
claim individual answers.

SF news is refreshed with verified September 14–18, 2026 sources for the September19
demo. Publication dates and links remain attached. Only the preceding seven days
through the evaluation date enter prompts. Experiments freeze the news snapshot once;
the timeline checks that snapshot when continuing. A failed fetch never relabels an
old cache as current.
