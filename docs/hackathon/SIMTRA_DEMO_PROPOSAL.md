# Proposed demo: the price hike that customers remember

Proposal for discussion, September 19, 2026. Not implemented or empirically validated.

## Latest recommendation after reviewing Simile customers

This is a proposed change for discussion, not a user-approved pivot. It supersedes the restaurant recommendation as my preferred hackathon positioning if the team has no restaurant data/design partner.

Buyer: consumer-insights or brand managers at emerging beverage brands preparing a retail launch. Initial job: shortlist a product concept, price, and launch offer before paying for a human validation study. Proposed simulated audience: 22–35-year-old SF adults who buy a weekday afternoon drink. Age/location can be Census-grounded; category buying habits require a screener, customer data, or explicit assumptions.

Why reconsider: Simile showcases CVS customer-experience research, Wealthfront qualitative research, Suntory product development, Itaú customer understanding, Gallup research partnership, and Garnett Station consumer understanding. These demonstrate enterprise research applications; the site does not reveal revenue rankings or prove that emerging beverage brands will pay for Simtra. Sources: https://www.simile.com/#customers and https://www.simile.com/blog/simile-cvs-health

Recommended connected demo: choose between two beverage propositions and prices; expose the same population to launch messaging; test a competitor promotion and a repeat-purchase occasion; inspect one persona's memory; compare launch strategies and show the next real test to run. Model sampling, repeat purchase, and promotion sensitivity as explicit assumptions unless supported by behavioral data. The feed contains experiment exposures and decisions, not general news.

Jev handles structured choices; the LLM structures input and explains recorded transitions; the engine stores branch-specific state and calculates weighted metrics. Neither generated memory nor model confidence establishes demand accuracy.

Reason for preference: beverage concepts are tangible to judges, can be shown to a small consenting human audience in the room, and fit concept-screening endpoints without claiming validated store revenue. A blinded live audience choice can be compared with predictions frozen in advance, but it is only a small demo validation of stated preferences in that audience. It cannot establish city-wide demand, repeat purchase, or broad accuracy superiority.

Business-model hypothesis: paid concept-screening pilots, then a subscription for repeated studies; reach early design partners via beverage incubators or specialist brand/research agencies. Validate demand rather than treating Simile's customer logos as proof of this exact segment.

Decision rule: an available restaurant partner with historical tests/transactions is stronger evidence than this abstract vertical preference. Choose the segment with accessible ground truth when such access exists. Research agencies serving beverage brands are an alternative buyer/channel if that is where the team has access.

## Refined positioning after user feedback

The user requires one connected pitch, a narrow paying audience, and measurable cost, time, and accuracy impact. This refinement takes priority over broader demo suggestions below.

Proposed initial buyer: the head of marketing/pricing at a regional fast-casual restaurant group with 10–50 locations that tests menu prices and promotions. This is a proposed segment, not a validated customer profile. The simulated population is its local lunch customers, distinct from the paying buyer.

Pitch: “Simtra helps regional restaurant teams shortlist menu prices and offers before a store pilot, using a persistent simulated customer panel that updates as customers encounter new prices and promotions.”

One connected demo: choose an offer → observe modeled customer choices → introduce a competitor promotion → inspect the same customer's changed state → compare a revised offer → show measured run cost/time and validation error where ground truth exists. Every feed entry must contribute to that decision. General news and unrelated city events do not belong in this demo.

Evidence plan:

- Cost: compare the same scenario-screening task, with scope stated. A transparent illustrative human-panel budget is 100 respondents × 5 minutes / 60 × $12 per hour × 1.428 corporate fee multiplier = $142.80, excluding tax, targeting, and analyst work. This follows published Prolific pricing, not a restaurant customer's measured historical cost. A $1 Simtra run would be 99.3% lower direct collection/compute cost, but $1 is only an illustration until metered, and simulation is not equivalent human evidence.
- Time: time both workflows from the same starting inputs to a decision-ready shortlist. Include population setup, data ingestion, and analysis for the first run; separately report repeat-run latency. Do not assume weeks for modern online panels.
- Accuracy: use held-out human choices or, preferably, observed store outcomes. Compare static Census personas and evolving personas on the identical held-out tasks and metric. Example only: mean absolute error falling from 12 to 9 percentage points is a 25% relative error reduction, not a 25-percentage-point accuracy gain. Never include the test outcomes in agent memory or tune on the held-out set.
- If validation data is unavailable, report cost and latency as measured and behavioral accuracy as unvalidated. A small audience poll tests stated preference in that audience, not restaurant sales prediction or population representativeness.

The defensible commercial value is screening more options before purchasing human validation, with calibration as a development goal. Paid design-partner pilots provide both willingness-to-pay evidence and data to test whether persistent memory improves forecasting.

Pricing sources checked September 19, 2026:
- https://www.prolific.com/pricing
- https://researcher-help.prolific.com/en/articles/445266-how-much-should-i-pay-participants
- https://www.pickfu.com/pricing (shows why expensive, slow research should not be assumed: basic polling starts at $1 per response)

## Decision and buyer

Help a restaurant operator choose a pricing/offer strategy before a real pilot. Use a hypothetical Chipotle example for recognition, while positioning regional restaurant groups as an initial customer hypothesis. Do not imply Chipotle is a customer.

Question: What happens over 30 simulated days if a $12 lunch becomes $14.40, and what response recovers demand without abandoning the price increase? Prices, baseline visits, and scenario events are explicit demo assumptions.

## Three-minute demonstration

1. Show an SF lunch audience with Census-grounded demographics. Inspect one persistent persona. Synthetic starting lunch habits, budgets, and brand affinity are labeled assumptions.
2. Fork the same baseline into unchanged pricing and a 20% increase. Show simulated transactions, visit frequency, and indexed revenue across simulated days.
3. Ask a judge to choose a hypothetical shock: a competitor discount or an employer ending its lunch subsidy. Apply it to relevant exposed agents. The feed shows source/scenario → exposure → state change → decision → business outcome.
4. Open the same persona's timeline. Show remembered price changes, prior choices, remaining budget, and how those affect the next choice. Keep an unexposed comparison where appropriate.
5. Branch the current world into maintaining the increase and adding a loyalty offer. Compare all branches with identical external events and matched initial conditions. Do not hard-code a winning strategy.
6. End with a decision card: modeled tradeoff, assumptions, uncertainty, and the real experiment to run next.

The strongest memory test: restore the original price and rerun. If prior experience still changes behavior for some agents, show the recorded state responsible. This is a testable hypothesis, not a guaranteed dramatic effect; habit persistence needs a specified behavioral rule/model and validation.

## Evolving-agent mechanics

Store immutable demographic attributes separately from mutable budget, recent purchases, remembered exposures, and modeled brand preference. Events have IDs, timestamps, source URLs or explicit hypothetical labels, affected audiences, and exposure rules. Avoid treating one local headline as evidence every resident lost a job or saw the story.

Use a short event-driven loop: new relevant event or decision occasion → retrieve bounded prior memory → choose an action → deterministic state update → persist transition → update map/feed/chart. Advance simulated time explicitly. Do not make model calls per animation frame.

Retain bounded archetype batches, but include relevant behavioral state in grouping so agents with different memories are not collapsed into one answer. Use seeded sampling and branch-local memory. Compare counterfactuals from the same snapshot and shared external events; reject hypothetical contamination between branches.

State evolution is not model training. Claim agents remember and adapt within the simulation; claim learning from actual customers only if a real feedback/calibration loop exists.

## Technology roles

- Jev: constrained action choices and narrow scoring questions from persona, current state, options, and exposure history. TypeSafe documents Choice, Score, and Noul primitives; questions within one call are independent against the same state. A question that depends on a prior answer requires code sequencing or another call. Do not equate model confidence with measured consumer probability.
- Existing text LLM: parse the business question, normalize sourced events into a validated schema, and explain stored transitions. Explanations describe what the simulation recorded; they are not human testimony or evidence of hidden model reasoning.
- Rust engine: enforce budgets and time, sample actions, update state, compute weighted metrics, and manage isolated branches.
- Existing persistence: use SQLite/Neo4j foundations for snapshots and branch-scoped memory; verify actual branch isolation before relying on shared city memory.
- Existing frontend: extend the feed with event-to-outcome lineage, a persona timeline, and a scenario comparison chart.

Source: https://docs.typesafe.ai/introduction

## Data for today

1. Reuse committed ACS PUMS population data. Census provides microdata APIs for future refreshes. Demographic data does not establish restaurant preferences. Source: https://www.census.gov/data/developers/data-sets/census-microdata-api.html
2. Accept an operator-supplied menu and, if available, consented/aggregated sales data. For the hackathon, a clearly labeled sample CSV is sufficient; do not present synthetic transactions as measured calibration.
3. Reuse the existing NewsAPI path for one relevant, timestamped, sourced article. NewsAPI supports article discovery; freshness/access depend on the service plan. Keep a sourced cached event for demo reliability. Source: https://newsapi.org/docs/endpoints/everything
4. Optional BLS CPI or consumer-spending context for economic background. These are aggregate/historical series, not a live personal-budget stream. API source: https://www.bls.gov/developers/api_signature_v2.htm
5. Judge-selected hypothetical events provide a live interaction even when external data is cached. Label the two separately.

## Business metrics and judging alignment

Revenue comes from explicit simulated quantities and prices, not a direct LLM estimate. At a uniform 20% price increase, revenue breaks even at 1 / 1.2 = 83.33% of baseline unit volume, assuming unchanged mix and no discounts. Profit additionally requires cost assumptions. Show normalized revenue until a customer dataset supports absolute estimates.

| Criterion | Pitch evidence |
| --- | --- |
| Problem Solution Fit | A concrete pricing decision with an actionable next test |
| Market Potential | Initial restaurant pricing/marketing use case, followed by expansion hypotheses; no invented TAM |
| Business Model | Proposed paid pilot, then subscription per brand/location with simulation usage limits |
| Go-to-Market Strategy | Recruit a regional restaurant design partner and compare predictions with a limited store pilot |
| Team | Explain each member's actual contribution to the existing product and today's changes |
| Pitch Delivery | One customer, one persona, one audience-selected event, one decision |
| Financial Projections | Separate Simtra's customer/revenue/cost assumptions from the simulated restaurant's revenue chart |
| Impact & Vision | An audience that can be reused and eventually calibrated with observed customer outcomes |

For Simtra financial projections, use a transparent model: paying customers × monthly subscription; subtract inference, hosting, onboarding, and support. Show actual measured run costs if available. Any proposed pricing is a hypothesis, not validated willingness to pay.

## Build priority

First: one working pricing loop with durable state, isolated counterfactuals, and a truthful comparison chart. Second: the persona timeline and traceable feed. Third: one judge-controlled event and one recovery offer. Integrate only the data needed for this story.

Before presenting, check that an exposed agent's state persists, an unexposed agent remains unaffected by that event, sibling branches cannot read each other's hypothetical memories, and totals reconcile with recorded actions and weights. Measure actual latency. The source review did not establish that these proposed behaviors already work.
