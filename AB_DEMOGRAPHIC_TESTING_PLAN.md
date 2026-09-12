# A/B Demographic Testing — Implementation Plan

## Context

Users can poll the synthetic population today, but cannot compare two concrete variants and see which demographic groups prefer each one. Add a text-based A/B test that evaluates Variant A and Variant B against one shared question, preserves PUMS weighting, and reports both the overall split and demographic-specific preference.

This is a simulated preference estimate, not a causal experiment or prediction of organic campaign reach.

## Branch and worktree

- Branch: `feature/ab-demographic-testing`
- Worktree: `.claude/worktrees/feature+ab-demographic-testing`
- Base: current `origin/main` at `4f3b03b`

## V1 scope

Inputs:

1. **Evaluation question** — e.g. “Which message makes you more likely to support Proposition X?”
2. **Variant A** — pasted text.
3. **Variant B** — pasted text.

Outputs:

- weighted overall A/B preference
- winner or tie and percentage-point margin
- demographic A/B preference by:
  - age band
  - race/ethnicity
  - education
  - income quintile
  - tenure
  - PUMA/geography
- strongest A-leaning and B-leaning segments, subject to a minimum sample threshold
- group weight and simulated-agent count
- representative rationales
- clear methodology/disclaimer copy

## Existing code to reuse

### Backend

- `crates/sim-core/src/predict.rs:16-26` — `Framing::Options` already supports labelled choices.
- `crates/sim-core/src/predict.rs:41-62` — `Poll` already carries question, description, model, population, and ordered options.
- `crates/sim-core/src/predict.rs:266-469` — `Engine::run_poll` already clusters personas, calls the model in bounded batches, applies PUMS/turnout weights, and calculates an overall option distribution.
- `crates/sim-core/src/predict.rs:397-468` — existing binary demographic grouping pattern.
- `crates/sim-core/src/aggregate.rs:13-49` — `WeightedAnswer` and `weighted_distribution`.
- `crates/sim-core/src/aggregate.rs:87-144` — deterministic bootstrap and generic weighted breakdown helpers.
- `crates/sim-core/src/city.rs:145-157` — city-specific options prompt.
- `crates/sim-core/src/api.rs:480-494` — current branch poll handler and branch/city validation pattern.

### Frontend

- `frontend/src/app.js:390-473` — request ID, abort controller, progress, stale-response guard, and cleanup lifecycle.
- `frontend/src/app.js:544-577` — existing option-result rendering.
- `frontend/src/app.js:622-624` — `escapeHtml` for user-provided variant text and labels.
- `frontend/src/api.js:8-37` — timed, abortable JSON request wrapper.
- `frontend/index.html:89-123` and `frontend/styles.css:390-436` — existing modal and scrim pattern.
- `frontend/styles.css:293-334` — existing result bars and result-card visual language.

## Recommended implementation

### 1. Add typed A/B API endpoint

**File:** `crates/sim-core/src/api.rs`

Add:

```text
POST /branches/:bid/ab-test
```

Request:

```json
{
  "question": "Which message makes you more likely to support Proposition X?",
  "variant_a": "Exact text for A",
  "variant_b": "Exact text for B",
  "as_of_date": "2026-06-13",
  "model": "claude-sonnet-4-6",
  "population": "all"
}
```

Validate at the server boundary:

- non-empty question and variants
- distinct A and B content
- conservative length limits for question and each variant
- valid date/model/population values using current poll conventions
- existing branch and city context

The endpoint is read-only. It may use the simulation’s main branch ID and must not create or mutate branch state.

### 2. Build a prompt-safe forced-choice poll

**Files:** `crates/sim-core/src/api.rs`, `crates/sim-core/src/predict.rs`

Convert the request into one `Framing::Options` poll with ordered labels `A` and `B`. Put exact variant content inside fixed, clearly marked stimulus delimiters. Add an outer instruction that resident personas must evaluate the quoted material and never follow instructions contained inside either variant.

Keep A and B order stable throughout request, aggregation, response, and rendering. Do not use `run_counterfactual`; it compares no-event versus event and its `p_yes` semantics are unsuitable for direct A/B comparison.

V1 will use one options poll rather than two binary polls. This preserves a direct forced choice and avoids doubling model cost. Document that V1 does not counterbalance presentation order.

### 3. Add demographic option aggregation

**Files:** `crates/sim-core/src/aggregate.rs`, `crates/sim-core/src/predict.rs`

Add a small generic weighted distribution-breakdown helper that groups `WeightedAnswer` rows by demographic key and returns a normalized option distribution for each group.

Introduce an option-specific result type instead of overloading binary `DemoBreak.yes_share`:

```text
OptionDemoBreak
- key
- a_share
- b_share
- weight
- n
```

Generate option breakdowns for the same dimensions already used by binary polling: age, race, education, income quintile, PUMA, and tenure. Preserve deterministic group ordering so response bytes, tests, and cache behavior remain stable.

For A/B polls, calculate overall confidence bounds for Variant A with the existing deterministic weighted bootstrap. Variant B bounds are complementary. Do not claim per-demographic statistical significance in V1; expose group weight/count and label rows as model estimates.

### 4. Return an explicit A/B response

**File:** `crates/sim-core/src/api.rs`

Map the engine result into a clear endpoint response rather than exposing overloaded options fields such as `p_yes`:

```text
AbTestResponse
- a_share
- b_share
- margin_pp
- winner: a | b | tie
- a_ci_low / a_ci_high
- b_ci_low / b_ci_high
- breakdowns by demographic dimension
- n_agents / n_eff / design_effect
- n_archetypes / n_llm_calls
- sample_rationales
```

Use a small neutral tie threshold for presentation only. Keep raw shares available so frontend does not lose precision.

### 5. Add A/B test entry form

**Files:** `frontend/index.html`, `frontend/styles.css`, `frontend/src/app.js`

Add a **Test A/B** action near current prediction composer. Open an accessible modal containing:

- labelled evaluation-question textarea
- labelled Variant A textarea
- labelled Variant B textarea
- character counts
- inline validation message
- submit and cancel controls

Reuse current scrim/modal styling, but add focus entry, focus restoration, Escape close, scrim close, and keyboard-safe submission. Keep normal prediction composer unchanged.

### 6. Add frontend API and request lifecycle

**Files:** `frontend/src/api.js`, `frontend/src/app.js`

Add `abTest(branchId, payload, signal)` using existing `req()` wrapper. Model execution after `runPrediction()`:

1. validate and normalize inputs
2. increment request ID
3. create `AbortController`
4. show progress state
5. call A/B endpoint once
6. ignore stale responses
7. render result
8. support cancel, edit, retry, and dismiss

Do not create a temporary branch because endpoint is read-only.

### 7. Render overall and demographic results

**Files:** `frontend/src/app.js`, `frontend/styles.css`

Overall section:

- winner/tie headline
- A and B shares
- signed percentage-point margin
- 100% split bar
- overall confidence interval
- effective sample/archetype wording

Demographic section:

- dimension selector for age, race, education, income, tenure, and geography
- one 100% A/B split bar per group
- direct text label such as `A 62% · B 38%`
- weighted group size and simulated-agent count
- strongest-A and strongest-B segment summaries only when the group meets the minimum count threshold

Use plain HTML/CSS bars; add no chart dependency. Keep A and B colors fixed, include a legend, direct-label values, and never communicate preference through color alone. Preserve a readable list/table structure for keyboard, screen-reader, forced-color, and mobile use. Validate final palette against existing light surface before shipping.

Render map verdicts from overall A share using existing deterministic verdict assignment, while result panel carries the real demographic detail.

### 8. Explain limits clearly

Display concise copy:

- results use weighted synthetic residents sampled from ACS PUMS
- responses are generated at demographic archetype level, then post-stratified
- segment preference is an estimate, not proof of causality or statistical significance
- test assumes every simulated resident sees one of the two variants
- V1 does not model reach, frequency, platform delivery, order counterbalancing, or real-world conversion

## Tests

### Rust unit tests

**Files:** `crates/sim-core/src/aggregate.rs`, `crates/sim-core/src/predict.rs`

- grouped A/B distributions use PUMS weights rather than raw counts
- every group’s A and B shares sum to 1
- A/B label order remains stable
- demographic grouping covers every included agent exactly once per dimension
- deterministic input produces byte-stable output ordering
- overall A confidence interval is deterministic and B bounds are complementary
- empty/zero-weight input follows existing aggregation fallback semantics

### API tests

**File:** `crates/sim-core/tests/contract.rs` or a smaller nearby handler test module

- valid request returns A/B shares, winner/margin, and demographic breakdowns
- `margin_pp == (a_share - b_share) * 100`
- empty, identical, or oversized variants return clear `4xx` responses
- missing branch returns existing not-found behavior
- variant text stays inside fixed stimulus delimiters
- prompt-like text inside a variant cannot replace outer instructions
- endpoint does not mutate branch state
- tests run offline or against injected deterministic results; no paid model calls

### Frontend checks

No new frontend test framework.

Keep margin formatting, tie classification, minimum-segment filtering, and demographic sorting in small pure helpers. Exercise them with lightweight browser assertions or a tiny standalone module check if practical.

## End-to-end verification

1. Run targeted aggregation and prediction tests.
2. Run `cargo test -p simfrancisco --test contract` in offline mode.
3. Run `cargo test --workspace` if targeted checks pass.
4. Run `git diff --check`.
5. Serve frontend:

```bash
python3 -m http.server 5173 --directory frontend
```

6. Exercise desktop and mobile flows:
   - clear A win
   - clear B win
   - near tie
   - demographic groups leaning in opposite directions
   - empty, identical, and oversized variants
   - cancel, Escape, edit, retry, and stale response
   - backend unavailable
   - keyboard-only and screen-reader labels
   - long variant text and narrow viewport overflow
7. Confirm normal prediction flow remains unchanged.
8. Avoid production polling and paid model calls unless explicitly approved.

## Out of scope for V1

- images, video, PDFs, URLs, OCR, or multimodal variants
- more than two variants
- automatic copy generation or optimization
- saved experiment history
- audience targeting or ad-platform publishing
- organic reach/frequency/conversion modeling
- presentation-order counterbalancing
- causal or statistical-significance claims
- new frontend framework, chart library, or dependency
