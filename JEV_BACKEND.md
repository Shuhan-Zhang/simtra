# Jev backend (jevdev)

Jev integration for backend and frontend feature work. The frontend now selects Jev and uses the local backend by default; hosted frontends require an explicit Jev backend origin. See `frontend/README.md`. No deployment or PR is included.

## Run

Set `TYPESAFE_API_KEY` in ignored `.env` (`JEV_API_KEY` is an alias), then run `cargo run --bin server` from the repository root. All backend defaults now select `jev-1.13.0`; `JEV_MODEL=jev-latest` or `jev-preview` opts into moving aliases. `TYPESAFE_BASE_URL` defaults to `https://api.typesafe.ai`. Credentials never belong in browser code.

Native endpoint: `POST /v1/systemone`, Bearer authentication, `{model, state, questions}`. Source: [TypeSafe HTTP API](https://docs.typesafe.ai/api).

## Interfaces for parallel work

- `model::ModelClient::evaluate(model, state, BTreeMap<String, jev::Question>) -> jev::Evaluation`: typed transport, strict response validation, SQLite cache, bounded concurrency, usage accounting, retry/backoff on 429/5xx, and offline cache-only mode.
- `jev::{Question, Answer, Evaluation}`: Noul, Choice, and Score contracts; answer IDs are always resolved explicitly. Provider bodies and credentials are not logged on errors.
- `jev::poll_batch`: shared evaluation for archetype polls and personal answers. Vote uses Noul, options/A/B use Choice probabilities in the original option order, and belief uses a six-level perceived-likelihood Score divided by five.
- `jev::voices`: batch selection from curated chatter/reaction templates. Reactions preserve the existing sentiment vocabulary.
- `parse::parse_question`: Jev selects vote, belief, explicit options, buying behavior, clarification, or unsupported. Original question text is preserved. List categorical options after a colon separated by commas or `or`; unenumerated categorical requests ask for choices instead of fabricating labels. Buying-behavior scenarios use documented fixed categories.
- Existing `Engine` and HTTP endpoints retain their shapes for polls, A/B, counterfactuals, market forecasts, chatter, and personal answers. Requests may omit `model` or specify `jev-1.13.0`. Jev parsing bypasses the optional legacy RocketRide text router.

PUMS weighting, filtered populations, archetype clustering, confidence intervals, memory recall/persistence, and optional evidence integrations remain in place. Legacy Azure/Anthropic models remain explicitly selectable for frozen historical rubrics; Gemini transport and credentials have been removed from the backend.

## Output semantics

Jev cannot generate free-form prose. Rationales report an independently selected factor, not a generated chain of reasoning. Chatter and reactions explicitly say `Jev-selected template`; they are illustrative synthetic text, not authentic quotations. The frontend identifies these as Jev-selected factors and preserves template labels.

These are model-based synthetic estimates, not validated survey forecasts. Existing historical validation scores do not transfer to Jev. Requesting an old `as_of_date` does not establish a historical knowledge cutoff for Jev.

## Verify

```sh
cargo test -p simfrancisco
cargo test -p simfrancisco --test jev_backend live_jev_smoke -- --ignored --nocapture
```

The first command uses local fixtures only. The second explicitly loads `.env` and makes a small set of paid Jev calls over three synthetic residents to check all backend feature paths. It does not contact optional memory/evidence services or deploy anything.

## Verified on this branch

- Backend suite passed: 87 unit tests, existing HTTP contracts, verified-data tests, native Jev fixture, and memory tests. Release build of `validate` passed.
- Explicit live smoke passed for binary/options/belief polls, A/B, counterfactuals, chatter, reactions, personal answers, parsing, and cache replay (3 synthetic residents, 9 TypeSafe requests).
- Local HTTP checks passed for default Jev routing/polling, rejecting removed model names, and native health reachability.
- Full workspace tests require the map crate's native PROJ/CMake toolchain; this machine lacks `cmake`. The map crate is unchanged.
- Frontend integration passed all 82 Node tests. Live browser checks against the local Jev server passed binary and explicit-choice predictions, A/B comparisons, and post-impact comparisons over 10,000 synthetic residents. Desktop and 390px mobile layouts were inspected with no horizontal overflow or browser runtime errors.
- The optional Neo4j memory service was not configured for the browser checks; the UI correctly reports memory off. Backend chatter/reaction/personal-answer paths were covered by the separate live smoke.
- The browser fixture server compiles against the native Jev mock. Existing full browser regression scripts were updated but were not all executed.
- Live deployment requires configuring the server credentials and the hosted frontend backend origin; local verification does not deploy the application.
