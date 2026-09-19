# Hackathon use-case evaluation

September 19, 2026. Advisory ranking, not a user-approved pivot. This is the latest recommendation; earlier demo proposals remain discussion history.

## Decision basis

User objective: win today's hackathon with a coherent customer, measurable value, and an evolving audience. Actual rubric: Problem Solution Fit, Market Potential, Business Model, Go-to-Market Strategy, Team, Pitch Delivery, Financial Projections, Impact & Vision. No weights supplied. Do not invent a probability of winning or present subjective scores as market evidence.

Assumptions: existing Census population, weighted polling, A/B/counterfactual paths, city map and optional memory; no demonstrated proprietary customer dataset; feed reliability and Jev integration still unverified. Room contains approximately 200 programmers, not necessarily 200 participants or representative buyers. The remaining build time and team-specific customer access are unknown.

## Ranked candidates

1. **Consumer subscription companies rehearsing price changes and retention offers.** Buyer: head of growth/monetization at an app with a paid consumer subscription and an existing user base. Repeated, comprehensible decision with direct commercial outcomes. Strong sequential demo: price change, competitor offer, retention intervention. Existing choices/branches fit. Weakness: Census does not capture usage, switching costs, or loyalty; import a small customer profile or label assumptions. Demonstrate stated choices, not validated churn forecasts. Best overall conditional on no privileged data access elsewhere.
2. **Consumer-tech launch teams screening positioning and introductory offers.** Buyer: product marketing lead. Strongest fit to existing A/B polling; easy live audience comparison. Weakness: generic persona feedback is easy to imitate and memory contributes less to a one-shot concept test. Best fallback if stateful loops cannot be made reliable today.
3. **Local marketplace teams choosing a launch neighborhood and acquisition offer.** Buyer: city expansion lead at a delivery or mobility marketplace. Strongest natural fit to map and Census geography. Weakness: credible outcomes require supply, travel times, competitor coverage, and unit economics beyond current population polling. Visually attractive but larger unfinished model; do not choose today without these inputs.
4. **Regional restaurant groups screening menu-price and loyalty changes.** Buyer: marketing/pricing lead. Clear revenue connection and local audience. Weakness: transaction frequency and elasticity are absent from Census; weak immediate access to restaurant buyers. Becomes first choice if a partner provides historical interventions and outcomes.
5. **Developer-tool startups screening packaging and usage limits.** Buyer: founder/growth lead. Strongest relevance to programmers in the room; potential immediate contacts. Weakness: workflow, employer payment, stack, usage intensity, and migration costs dominate Census attributes. Viable with a consented developer survey, but would shift the population foundation and revive a direction the user reasonably questioned.

## Recommendation and boundaries

Use one fictional consumer subscription product, such as a music-streaming app, with explicit hypothetical prices. Decision: how to introduce a higher price without losing customers unnecessarily. Compare a blanket price increase, a lower-cost restricted tier, and a temporary loyalty offer. Introduce a competitor offer and revisit the same personas. Focus on modeled keep/downgrade/switch/cancel decisions and transparent revenue arithmetic. Generalize the buyer to consumer subscription growth teams, not all product strategy teams.

Commercial claim: help shortlist monetization strategies before a live experiment. Do not claim replacing A/B tests or forecasting real churn accurately without ground truth. Live experimentation already exists; Statsig offers experimentation and analytics, while PickFu offers real-person concept/copy tests. Sources checked: https://www.statsig.com/ and https://www.pickfu.com/how-it-works . The potential differentiator is reusable audience state and screening sequences before exposing real customers, subject to validation.

Jev: structured choices. LLM: parse offer inputs and explain persisted transitions. Engine: branch-isolated state, weighted aggregation, money arithmetic, event log. No simulated experience should be presented as observed behavior.

## Judging evidence

- Problem Solution Fit: one repeated monetization decision with clear consequences.
- Market Potential: existing subscription businesses as a proposed initial segment; support market size later with sources rather than invented TAM.
- Business Model: paid strategy-screening pilot, then recurring access if repeat value is demonstrated.
- Go-to-Market: approach consumer-app founders/growth teams through actual team contacts; obtain one prior experiment and held-out outcomes.
- Team: show actual contributions and functioning integrated system; vertical choice cannot substitute for execution evidence.
- Pitch Delivery: one product, three strategies, one changed circumstance, one traceable persona, one decision card.
- Financial Projections: Simtra revenue = customers × price; costs include inference, hosting, onboarding, and support. Distinguish hypothetical business assumptions from actual run measurements and simulated customer revenue.
- Impact & Vision: affordable pre-screening, then calibration from real experiments. Avoid implying synthetic customers are interchangeable with real people.

## Measurement and demo validation

Measure latency and full per-run cost. Compare static and evolving panels on the same unseen follow-up choices. Freeze predictions before showing human answers; only earlier rounds may update memory. Report sample size, audience mismatch, actual prediction error, and uncertainty. A convenience poll does not validate true churn or broader market demand. Never promise accuracy improvement before the experiment runs.

Stop/go rule: if durable state and branch isolation cannot be demonstrated reliably in the available time, use candidate 2 and show a real concept-choice benchmark instead of a staged evolving-agent story. An accessible customer dataset can override the ranking; reliability and evidence outweigh novelty.
