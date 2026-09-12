# simit

**Simulate a city, ask what people would do, and test an idea before launching it.**

- **Live app:** [simfrancisco.org](https://simfrancisco.org)
- **Live API:** [sf-digital-twin-tp.fly.dev](https://sf-digital-twin-tp.fly.dev)
- **API health:** [`GET /health`](https://sf-digital-twin-tp.fly.dev/health)

Simit is a multi-city synthetic-population simulator. It samples residents from real US Census ACS PUMS microdata, gives each resident a deterministic persona and value profile, and uses population weights to estimate how a city may respond to a question, message, event, or pair of alternatives.

It is an early-signal tool for exploring ideas. It is not a replacement for real surveys, experiments, or public research.

## What you can do

- Ask a city a binary, multi-option, election, issue, or prediction-market question.
- Compare two messages with an A/B test and inspect demographic and cross-tab breakdowns.
- Test planned marketing copy by comparing baseline support with simulated universal exposure.
- Switch between five Census-sampled city populations and see city-specific news context.
- Inspect individual synthetic residents on a live pixel-art map.
- Branch and reset simulations without mutating the main state.

Marketing tests model what happens **if every sampled resident sees the supplied copy**. They do not estimate organic reach, delivery, frequency, or real-world causal lift.

## Cities

| City | API slug | UI name |
| --- | --- | --- |
| San Francisco | `sf` | sim francisco |
| New York City | `neu_york` | neu york |
| Los Angeles | `synth_la` | synth la |
| Chicago | `cybercago` | cybercago |
| Miami | `simami` | simami |

San Francisco is always loaded. The other cities load when their profile, PUMS data, and tile database are present.

## How it works

Simit has two engines over one shared persona layer:

1. **Prediction engine** — turns `persona + as-of date + event/question` into weighted vote share, opinion, option distribution, or probability. It returns confidence intervals, demographic breakdowns, effective sample size, and sample rationales.
2. **Life simulation** — runs schedules, movement, deterministic A* pathfinding, chatter, reactions, births, deaths, snapshots, branches, and server-sent events for the map.

The prediction engine does not depend on the life-simulation loop.

Residents preserve the joint demographic structure in ACS PUMS data rather than being reconstructed from independent averages. Population estimates use each record's `PWGTP` survey weight:

```text
p_hat(k) = sum_i(weight_i * answer_i(k)) / sum_i(weight_i)
```

Persona generation, sampling, and pathfinding are seeded. For model-backed polling, residents are clustered into demographic archetypes and evaluated in batches, keeping the number of model calls bounded by `MAX_CLUSTERS` instead of the raw resident count. Exact prompts are cached in SQLite for deterministic, no-cost replays of cached runs.

## Current product flow

The static frontend starts a 10,000-resident simulation and loads the city map, synthetic residents, and current news context. A question is classified first, then the app creates a temporary branch, polls the population, visualizes the result across resident sprites, and cleans up the branch afterward.

The production frontend currently uses `claude-sonnet-4-6`. A local-backend session defaults to `gemini-3.5-flash`; any configured model can be selected with the `model` query parameter.

## Run the frontend locally

The frontend is static HTML, CSS, JavaScript, and Canvas. It has no package manager or build step.

```bash
git clone https://github.com/Mahin2076/simtra.git
cd simtra
python3 -m http.server 5173 --directory frontend
```

Open [http://localhost:5173](http://localhost:5173). By default, even the local frontend uses the public production API.

## Run the full stack locally

Requirements:

- Rust 1.80 or newer
- Python 3 for the static frontend server
- A key for at least one supported model provider

Create the ignored local environment file and add the credentials you intend to use:

```bash
cp .env.example .env
cargo run --bin server
```

In another terminal:

```bash
python3 -m http.server 5173 --directory frontend
```

Open one of these URLs:

- Gemini default: [http://localhost:5173/?backend=local](http://localhost:5173/?backend=local)
- Anthropic: [http://localhost:5173/?backend=local&model=claude-sonnet-4-6](http://localhost:5173/?backend=local&model=claude-sonnet-4-6)
- Azure GPT-4o: [http://localhost:5173/?backend=local&model=gpt-4o](http://localhost:5173/?backend=local&model=gpt-4o)
- Alternate backend port: `http://localhost:5173/?backend=local&port=8081`

The backend listens on `0.0.0.0:$PORT`, defaulting to `8080`.

### Model configuration

| Models | Provider | Required environment |
| --- | --- | --- |
| `gpt-4o`, `gpt-5.5` | Azure AI Foundry Responses API | `MODEL_API_KEY`, `OPENAI_API_URL` |
| `grok-4.3` | Azure AI Foundry Chat Completions API | `MODEL_API_KEY`, `OPENAI_API_URL` |
| `claude-sonnet-4-6` | Anthropic Messages API | `ANTHROPIC_API_KEY` |
| `gemini-3.5-flash` | Google Gemini Interactions API | `GEMINI_API_KEY` |

Do not commit `.env`, `.env.local`, provider keys, or server-only integration credentials.

## API overview

The Axum API is unauthenticated for browser clients and serves JSON except for the SSE stream.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service, model, map, and integration status |
| `GET` | `/cities` | Loaded city catalog |
| `GET` | `/cities/:city/news` | City news context |
| `POST` | `/cities/:city/parse` | Classify a free-form question |
| `POST` | `/simulations` | Create a seeded city population |
| `GET` | `/simulations/:id/demographics` | Compare sampled and target demographics |
| `POST` | `/simulations/:id/branches` | Create a what-if branch |
| `POST` | `/branches/:id/poll` | Run a weighted population poll |
| `POST` | `/branches/:id/ab-test` | Compare two variants |
| `POST` | `/branches/:id/counterfactual` | Compare baseline and simulated exposure |
| `POST` | `/branches/:id/predict-market` | Estimate an event probability |
| `GET` | `/branches/:id/agents` | Page through residents and positions |
| `GET` | `/branches/:id/stream` | Stream simulation events over SSE |
| `GET` | `/prediction-results` | Read saved prediction history when configured |

See [INTEGRATION.md](INTEGRATION.md) for payloads, responses, the coordinate contract, and the full endpoint reference.

## Optional integrations

- **InsForge** stores completed prediction results server-side. The application still works when persistence is unavailable.
- **RocketRide** can classify questions through a deployed pipeline; malformed or unavailable responses fall back to the built-in router.
- **HydraDB** can add bounded evidence context and provenance to prediction runs. It does not replace the local PUMS population.
- **NewsAPI** can refresh per-city headlines when the news scheduler is enabled.

These integrations are configured only through server-side environment variables. Their credentials must never be exposed to the frontend.

## Test and validate

```bash
cargo test --workspace
cargo build --release --bin validate
cargo test -p simfrancisco --test contract
```

Run the validator only after checking the selected model, credentials, cache, and rubric because cache misses can spend model credits:

```bash
cargo run --bin validate
cargo run --release --bin validate -- --smoke
```

The local contract test uses offline model mode. Setting `CONTRACT_BASE_URL` runs the contract against a live server and may exercise real prediction endpoints.

## Historical backtest

The in-app project brief reports two San Francisco evaluations run with GPT-4o using an October 2023 knowledge cutoff:

- 2024 presidential vote in San Francisco: **83.8% actual Democratic share, 81.3% predicted**.
- March 2024 Proposition A: **70.38% actual yes, 70% predicted**.

As-of dates are first-class inputs. Evaluation prompts must not include facts or outcomes that occurred after the chosen cutoff.

## Repository layout

```text
crates/sim-core/     prediction engine, life simulation, Axum API, tests
crates/sim-maps/     OSM/DEM to procedural pixel-tile map pipeline
frontend/            static map interface and A/B/marketing workflows
data/                city profiles, ACS PUMS subsets, news, survey inputs
server_tiles/        slim per-city map databases
migrations/          prediction-history database migrations
pipelines/           optional RocketRide question-router template
tools/               verification, baselines, and map/data utilities
```

## Built by

Nandan Pericherla, Abhay Sudhir, and Mahin Bharathwaj.
