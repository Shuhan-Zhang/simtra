# Audience research → persona data

This feature prepares **draft, evidence-backed audience profiles** for a business question. It does not evaluate an offer, run a poll, modify Census residents, assign survey weights, or predict customer behavior. The existing Jev scenario engine is unchanged.

## Run locally

Use the existing server and static frontend setup in `JEV_BACKEND.md`. Put `TYPESAFE_API_KEY` (or `JEV_API_KEY`) in the ignored server `.env`. Ask a question in the main city composer. Audience discovery, classification, and saving run for questions with explicit customer, buying, product, or pricing language and for dedicated A/B or marketing tests. General opinion questions proceed directly to the city simulation. No audience form is required. Open **Audience research** to inspect profiles, interpreted question context, citations, unknowns and saved versions. The research UI contains no business, location, evidence or profile-size form.

The one-question UI requires server-only `BRAVE_SEARCH_API_KEY`. Automatic research makes one bounded [Brave Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started) request per build, plus at most one alternate-source search when every initial page is unreadable. Search snippets are never treated as fetched evidence. No search key means discovery is visibly unavailable; it does not fall back to made-up sources.

Unavailable, paywalled, login-only, and bot-blocked pages are reported. Public Reddit/X URLs are accepted, but access is not guaranteed or bypassed. API clients can still submit attributed excerpts through the existing panels endpoint; the UI does not ask users to fill out an evidence form. Pasted text remains explicitly identified as user-supplied and not independently fetched. Remove personal identifiers before submitting customer feedback.

## Automatic question flow

The main composer uses `prepareHelpfulAudience` to decide whether optional research is useful, using a conservative local keyword check rather than an extra model call. When relevant, it runs `prepareAutomaticAudience` before the existing evaluation flow. It uses the full question and selected city as research context, requests at most four supported profiles, and enables bounded Brave discovery (one initial search, at most one alternate-source retry). One cached Jev typed evaluation identifies business, audience and explicit market using token spans from the question, plus a bounded topic classification. It considers at most 160 tokens. Names cannot be invented by the extraction mechanism. Ambiguous spans remain unknown; a missing market uses the current city as a labeled inference, and an explicit question location takes priority. A missing business is labeled unspecified, never silently assigned a brand. Interpreted context is persisted in `question_context`, included in the content hash, and shown with provenance and basis excerpts. Research does not include creative variants as source evidence.

An exact question + current-city-context match from this version of the pipeline reopens its saved draft by ID and version without a new search or classification request. The UI shows that the saved panel is reused, including its original collection dates. Changed question or market triggers separate research. There is no automatic freshness claim. Missing configuration, empty evidence after the bounded retry, and service failures remain visible through the audience button but do not block simulation; no research profiles are attached in those cases. Cancellation prevents stale responses from continuing into evaluation; an already accepted server job may still finish saving its panel. Verified Census queries bypass research. Explicit `?demo=1` remains offline and does not run discovery.

Successful in-memory results retain a `research_panel` reference (ID, version, hash, `research_context_only`). This is a data-stage attachment, **not an assertion that the evaluator used these profiles**. The existing engine still evaluates Census residents. Consuming research profiles inside that engine remains the evaluator teammate's work. Backend prediction-history records are unchanged.

## Pipeline

1. Validate business, research question, location, source and panel-size limits.
2. Collect up to eight sources, with public-address validation, pinned DNS resolution, redirect checks, download/time limits, HTML cleanup and content deduplication.
3. Store bounded source text, URL, collection timestamp and SHA-256. Collection time is not publication time; source age, factual accuracy and local applicability require review.
4. Rank exact paragraphs across the collected text, then select at most 24 excerpts across sources. Jev classifies relevance and explicitly supported behavioral attributes with typed choices. Conservative lexical checks reject labels without matching terms in the cited excerpt; these checks are a minimum safeguard, not factual verification. It does not write biographies or perform scenario evaluation.
5. Build up to the requested number of distinct behavioral archetypes. Each supported classification is **inferred**, literal statements are **sourced** or **founder-provided**, and missing attributes are **unknown**. Shared attributes require compatible supporting evidence; unrelated customers are not stitched into an invented person.
6. Preserve mixed evidence, coverage gaps and limitations. Save a draft (or `needs_evidence`) as an immutable panel version. Identical content returns the existing version.

The initial vocabulary covers needs, buying situation, purchase frequency, price sensitivity, alternatives, objections, decision criteria and explicitly stated switching conditions. The question guides relevance and primary attribute selection. This is a bounded classifier, not open-ended generation of arbitrary new attributes. Exact customer statements preserve details such as named alternatives and quoted prices without pretending the normalized category itself contains every detail.

Online reviews are self-selected. Profiles can overlap and do not establish population proportions, customer identities, predictive accuracy or market representativeness. Jev classification is an inference even when accompanied by a citation. All panels require human review before downstream use.

## API and handoff

These routes are independent of `/poll`, `/ab-test` and `/counterfactual`:

- `GET /audience-research/config`: credential availability (never keys), source limits, data-only scope.
- `POST /audience-research/automatic`: accepts only `{ "question": "…", "market": "optional current city" }`; identifies context, discovers evidence, classifies and saves profiles automatically. It also reuses matching saved drafts before paid calls.
- `POST /audience-research/panels`: preserved programmatic collect/classify/persist endpoint.
- `GET /audience-research/panels`: latest versions of up to 100 saved panels.
- `GET /audience-research/panels/:id?version=1`: retrieve an exact immutable version; omit `version` for latest.

Example request:

```json
{
  "business": "Your business",
  "question": "Which customer needs matter when choosing our lunch offer?",
  "location": "Your market",
  "panel_size": 6,
  "sources": [
    {"url": "https://example.com/customer-review", "kind": "review"},
    {"text": "Paste an actual, attributed customer excerpt here.", "title": "Customer interview", "kind": "interview"}
  ],
  "founder_context": "",
  "discover": false
}
```

Source kinds: `web`, `review`, `reddit`, `x`, `interview`, `official`. Text plus a URL is an attributed pasted excerpt, not proof the URL was fetched.

To revise, send the same question/business/location with `panel_id` and the desired evidence. A new audience context requires a separate panel. Programmatic revisions can retain previous snapshots and owner context. The research UI is a read-only inspector and export, without a revision form. Changed input evidence remains inspectable in history.

The response/export includes `schema_version`, panel `id`, `version`, `content_hash`, question context, source snapshots, `personas[].attributes[]`, citations, conflicts, gaps, warnings and methodology. Each attribute supplies `key`, nullable `value`, `provenance` and `{source_id, excerpt}` citations. Profile IDs are scoped to the panel context. **Downstream evaluation should explicitly consume an exact panel ID/version/hash; this feature does not automatically connect it to the evaluator.**

Panels use a separate `audience_panels` table in the existing `STATE_DB`. No prediction/simulation tables are changed. Keep this database private and out of Git.

## Limits and failure behavior

- Target panel size: 2–12; fewer or zero profiles when evidence is insufficient.
- Eight input sources, 12,000 characters per source; 8,000 characters of owner context.
- At most one Jev context evaluation plus three Jev evidence-classification evaluations per automatic build, using existing response caching and transport retries. This is not a dollar-spend guarantee.
- One build at a time per server process; concurrent submissions receive HTTP 429.
- End-to-end server timeout: 150 seconds. A failure never generates fallback personas.
- Missing/unavailable Jev keeps collected evidence and returns `needs_evidence` with a warning if no profiles can be supported.
- Existing lineage mismatch receives HTTP 409 before collection or paid model work.

## Checks

```sh
cargo test -p simfrancisco
cargo build -p simfrancisco --bin server
node --test frontend/tests/*.test.mjs frontend/src/*.test.mjs
```

Routine tests use local fixtures. Live-provider testing must be deliberate; this feature has no automatic paid smoke test on startup.

Source excerpts can contain first-person reviews or third-party reporting. The UI labels them as source excerpts; the legacy `customer_statement` attribute key does not certify that a passage is a direct customer quotation.

## Audience insights in the results summary

Prediction, multi-option, A/B and marketing results include the exact saved research panel used for that request as a separate audience research summary. It shows profile attributes, provenance, expandable source excerpts and links, unknowns, conflicts, gaps and limitations. Saved research also includes this summary. Attributes appear only when their citation resolves to an exact excerpt in the saved source snapshot. No additional model calls are needed.

The summary is context only: these profiles do not calculate the Census-based simulation result. No research characters, gold outlines, numbered controls, camera focus or research-driven crowd dimming are added to the map. Ordinary city residents keep moving, including with reduced motion enabled; camera/reveal effects still respect that preference.

## Compact persona display and activity

Research summaries show illustrative persona heads and up to two supported traits. Hover, keyboard focus, or tap opens the full supported-trait list. Source excerpts and limits remain in collapsed disclosures; avatars do not imply demographic evidence. Full research and saved versions remain available separately.

The optional `/audience-research/automatic/stream` endpoint emits NDJSON progress at actual context, source-collection, profile-building and saving boundaries, followed by a confirmed result or error. The frontend uses this when advertised by configuration; older backends keep their combined research status. This activity is an operation log, not model reasoning.

### Workspace isolation

Research requests carry the same `X-Simtra-Workspace` header as predictions and timeline events. Saved panels and version lookup are scoped to that workspace; old unscoped rows remain available only in `public`. Workspaces are shareable browser scopes, not authenticated accounts. Research controls stay hidden until a panel is available, and activity starts collapsed.
