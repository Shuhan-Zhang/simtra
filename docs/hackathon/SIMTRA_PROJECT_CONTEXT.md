# Simtra — project and brainstorming context

**Active repository:** https://github.com/Shuhan-Zhang/simtra . Work was transferred to this repository on September 19, 2026, preserving its native Jev integration. The older source review below describes the original Mahin checkout and is historical context; current code takes precedence.

**Chosen direction:** The user selected local marketplace expansion: “Which neighborhood should we enter, and with what acquisition offer?” See `SIMTRA_CHOSEN_DIRECTION.md`. This supersedes earlier candidate recommendations; the technical review below remains reference context.

Updated September 19, 2026. Based on the user's brief and a source review of `Mahin2076/simtra` at commit `7a4ed2637fc65a9bb917d3764e2636cf85072338`. Repository downloaded into `simtra/`. This is an understanding pass, not a runtime audit or implementation change.

## Product intent

Simtra is a market-research simulation town populated with synthetic people grounded in US Census demographics. Teams test business decisions against a chosen audience before spending time and money in the real world. The intended benefit is shorter decision time, with an explorable view of how different people might respond.

The user's example: should Chipotle raise prices by 20% for an audience of 25-year-old software engineers in San Francisco? The town makes the audience tangible; simulation trials provide the research signal. The user reports that the live history feed currently does not work well.

This hackathon builds on the team's previous Simtra idea. My role in this task is Q&A and brainstorming, grounded in what exists and in the judging criteria once supplied.

## What the repository contains

- Static HTML/CSS/JavaScript frontend with a canvas pixel-art city, resident inspection, audience controls, results charts, and a city feed.
- Rust/Axum backend with separate prediction and life-simulation engines. Map movement is largely deterministic; it is not evidence that every resident makes an independent model call.
- Five city profiles: San Francisco, New York, Los Angeles, Chicago, and Miami.
- Census ACS PUMS records, survey weights, seeded synthetic personas, demographic filtering, and population-weighted aggregation. Existing filters include exact age, PUMA area, coarse occupation, and education. An exact software-engineer audience requires checking the occupation mapping; it should not be assumed from the pitch alone.
- Model polling by grouped archetypes, with special handling for small populations of distinct Census records. Residents generally inherit archetype responses. The frontend requests 10,000 residents by default; that is not 10,000 independent research respondents.
- Polls, multi-option questions, A/B tests, baseline-versus-event counterfactuals, demographic breakdowns, and model-generated sample explanations.
- Verified demographic data queries separate from modeled behavioral predictions.
- SQLite snapshots/cache, optional Neo4j persona memory and event/test lineage, and an InsForge prediction-history integration.
- City feed code combines events, past tests, reactions, and data queries, with a 20-second refresh interval. This is distinct from movement streaming.

Key references: `simtra/crates/sim-core/src/{api,model,predict,memory,persona}.rs`, `simtra/frontend/src/{app,config,feedpanel,api}.js`, and `simtra/data/provenance/acs_pums.json`.

## Current configuration versus planned direction

Current model code supports Azure, Anthropic, and Gemini providers; Jev is not present in the inspected provider/model definitions. Frontend defaults depend on backend selection: a configured or local backend selects Gemini Flash Lite, while the original public fallback selects Sonnet. The committed backend override points to an ngrok host. Reachability was not tested.

The user intends to switch the agent model to TypeSafe AI's **Jev** (written as “Jef” in the original message). TypeSafe describes Jev as a model for typed probabilistic decisions and explicitly says it gives up free-form string generation. Consequently, migration needs a decision-output design, not just a model-name replacement. Candidate decisions include continuing to buy, reducing purchase frequency, or switching alternatives. Those are brainstorming examples, not implemented outputs.

Free-text question interpretation, chatter, and narrative rationales need separate consideration: constrained labels/templates or a separate text-generating component. TypeSafe's speed and calibration claims are vendor claims; Simtra must measure its own latency and behavioral accuracy. A model's confidence is not automatically a customer's purchase probability.

Source: https://typesafe.ai/blog/introducing-system-one-models-and-jev

## Relationship to Simile

The shared idea is testing how a population responds to hypothetical changes before acting. Simile describes populations grounded in human studies and behavioral data, with ongoing validation. Simtra's visible foundation is Census demographics plus synthetic personas and modeled responses. Similar product intent does not establish equivalent behavioral validity.

Source: https://www.simile.com/

## What matters for our Q&A

1. Keep the central loop clear: choose audience → define a change → compare scenarios → inspect responses → make a better-informed decision.
2. Distinguish demographic grounding from demonstrated behavioral accuracy. Census records describe population characteristics; they do not directly measure Chipotle price sensitivity. The repository provenance identifies 2023 ACS 1-year data and PUMA-based coverage, which need not match exact municipal boundaries.
3. Distinguish support/intention from purchase behavior and business outcomes. A pricing recommendation needs assumptions about baseline purchase frequency, demand change, and the chosen outcome such as revenue or profit.
4. Treat the town, memory, and history feed as ways to understand an experiment. Clarify whether a trial starts clean or carries prior hypothetical exposure forward.
5. Preserve Census weighting, bounded model calls, and scenario isolation when considering improvements.
6. Treat historical accuracy claims in the README as reported past results, not independently verified current performance or proof of retail-demand accuracy.

## Hackathon judging criteria

Transcribed from the screenshot subsequently provided by the user:

- Problem Solution Fit
- Market Potential
- Business Model
- Go-to-Market Strategy
- Team
- Pitch Delivery
- Financial Projections
- Impact & Vision

No weights or scoring definitions are visible. These favor a clear customer, business outcome, and credible commercial story. An evolving-agent demonstration should support those points.

The repository's `rubric*.yaml` files are internal prediction-validation targets, including elections and market outcomes. They are not established as today's hackathon judging criteria.

See `SIMTRA_DEMO_PROPOSAL.md` for the proposed evolving-audience demo and its relationship to these criteria.

## Review boundaries

The repository and key source paths were inspected. No application code was changed, no paid predictions were run, and the application was not launched. The reported feed problem remains undiagnosed. No claim is made that Jev migration, live integrations, or the demo currently work end to end.
