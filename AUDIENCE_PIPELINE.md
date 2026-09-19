# Audience research → persona data

This feature prepares **draft, evidence-backed audience profiles** for a business question. It does not evaluate an offer, run a poll, modify city residents, assign survey weights, or predict customer behavior. The existing Jev scenario engine is unchanged.

## Run locally

Use the existing server and static frontend setup in `JEV_BACKEND.md`. Put `TYPESAFE_API_KEY` (or `JEV_API_KEY`) in the ignored server `.env`. Open **Build audience** on the city screen.

Public source URLs and pasted excerpts work without a search service. To discover additional URLs automatically, optionally configure server-only `BRAVE_SEARCH_API_KEY`. This makes one bounded [Brave Web Search](https://api-dashboard.search.brave.com/app/documentation/web-search/get-started) request per build. Search snippets are never treated as fetched evidence. No search key means discovery is visibly unavailable; it does not fall back to made-up sources.

Unavailable, paywalled, login-only, and bot-blocked pages are reported. Public Reddit/X URLs are accepted, but access is not guaranteed or bypassed. You can paste attributed excerpts instead. Pasted text remains explicitly identified as user-supplied and not independently fetched. Remove personal identifiers before submitting customer feedback.

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
- `POST /audience-research/panels`: collect/classify/persist a panel.
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

To revise, send the same question/business/location with `panel_id` and the desired evidence. A new audience context requires a separate panel. The UI retains previous source snapshots and owner context for revisions; additional discovery is opt-in. Changed input evidence remains inspectable in history.

The response/export includes `schema_version`, panel `id`, `version`, `content_hash`, question context, source snapshots, `personas[].attributes[]`, citations, conflicts, gaps, warnings and methodology. Each attribute supplies `key`, nullable `value`, `provenance` and `{source_id, excerpt}` citations. Profile IDs are scoped to the panel context. **Downstream evaluation should explicitly consume an exact panel ID/version/hash; this feature does not automatically connect it to the evaluator.**

Panels use a separate `audience_panels` table in the existing `STATE_DB`. No prediction/simulation tables are changed. Keep this database private and out of Git.

## Limits and failure behavior

- Target panel size: 2–12; fewer or zero profiles when evidence is insufficient.
- Eight input sources, 12,000 characters per source; 8,000 characters of owner context.
- At most three Jev classification evaluations per build, using existing response caching and transport retries. This is not a dollar-spend guarantee.
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
