# Simtra — chosen hackathon direction

The user selected local marketplace expansion on September 19, 2026. This decision supersedes earlier recommendations about restaurants, beverages, developer tools, and consumer subscriptions. Those files remain brainstorming history.

## Agreed positioning

The user explicitly locked in the following pitch:

> Simtra helps local marketplaces choose where to launch and which offer to launch with. Teams test expansion plans in a simulated city, compare how local audiences respond over time, and shortlist a location and acquisition strategy before funding a real-world pilot.

The user also authorized a separate agent to add required location-data pulling. The `location_data` agent has been assigned implementation in `simtra/`, starting with SF launch-area geography and restaurant POIs, with source attribution, caching, and explicit coverage limitations. Implementation status must be checked with the agent; this note is a dispatch record, not a completion claim.

Customer: local marketplace expansion teams.
Decision: which neighborhood should we enter, and with what acquisition offer?
Product: rehearse a local launch with geographically grounded synthetic residents and compare candidate locations and launch strategies before a real pilot.

## Proposed concrete demo (not yet approved or implemented)

Use a fictional food-delivery marketplace entering San Francisco. Buyer: head of city expansion. Compare three launch areas, then compare free first delivery with a first-order discount under explicit subsidy and delivery assumptions.

Show existing demographic evidence, introduce each launch offer, advance through trial and a subsequent order occasion, end the promotion or introduce a competitor offer, then compare modeled repeat orders and contribution after promotional spending. Inspect a persistent persona's exposure/choice history and show the next real-world pilot to run.

Keep the goal to one decision: selecting an area-and-offer combination for a pilot under a stated budget. The feed records relevant launch events, exposures, choices, and outcomes. General news is secondary.

## Important scope boundaries

- The current population uses PUMA geography. PUMAs are not automatically exact neighborhoods; use honest area boundaries/labels unless a validated neighborhood allocation is added.
- Census describes residents, not marketplace demand. Merchant availability, delivery time, service coverage, baseline ordering, competitor conditions, and contribution per order need external data or visible assumptions.
- Compare alternatives on shared starting conditions with branch-isolated memory. Apply common competitor/environment events consistently.
- Report simulated orders and contribution as scenario estimates. Cost per acquired customer requires acquisition spending and a defined count of distinct acquired customers, not just order counts.
- Show repeat behavior as modeled until validated against actual outcomes. Do not claim short-run scenario results establish lifetime value.
- This turn records the direction; no implementation, deployment, or model migration has been performed.

## Measurement

Today: measure experiment runtime and compute cost, show source/assumption provenance, and reconcile metrics with recorded actions. Validation goal: compare held-out historical area/offer pilot results with predictions. Report demand accuracy only when real outcomes exist.

## Authorized implementation follow-up

The user requested connecting location data to actual predictions and broadening SF coverage beyond restaurants. The implementation now targets explicit launch-area selection in Predict mode, server-resolved category counts added to model input, and source evidence in results. The broader source pull returned 42,859 mapped objects across food, shops, offices, transit, leisure, tourism, and other amenities. Counts refer to OSM objects, not unique businesses or all addresses. Scope remains the existing SF map bounding box and source coverage.

The selected launch area supplies geographic scenario context; it does not imply a neighborhood-specific Census population or calibrated demand. Local real-model execution still requires credentials. Integration verification uses a local mock model and must not be presented as live-model accuracy validation.

## Proposed pitch

Simtra helps local marketplaces choose where to launch and which offer to launch with. Teams test expansion plans in a simulated city, compare how local audiences respond over time, and shortlist a location and acquisition strategy for a real-world pilot.
