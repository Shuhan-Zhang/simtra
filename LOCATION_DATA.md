# Local marketplace geography (San Francisco)

This supplies candidate launch areas and mapped places for expansion experiments. Selecting a launch area adds its sourced facts to prediction prompts; it does not assign PUMA demographics to neighborhoods.

## Pull and serve

From the repository root, with Python 3.10+:

```sh
python3 tools/ingest_locations.py
# Rebuild with zero network traffic using the source cache:
python3 tools/ingest_locations.py --offline
# Explicit refresh even if cached sources are less than 24 hours old:
python3 tools/ingest_locations.py --force
```

No packages, keys, models, or paid APIs are used. Two requests are made on an uncached run, sequentially, with bounded timeout/body sizes and no automatic retries. Default cache TTL is 24 hours. Run once before a demo rather than on each browser request. Concurrent refresh commands are unnecessary; use one ingestion process.

The output is `data/locations/sf.json`; raw validated caches live in `data/locations/cache/`. These generated files are gitignored. Both paths can be changed using `--output` and `--cache-dir`. A refresh failure retains that source's last valid cached response and marks it stale. No cache means `unavailable`, not invented data. Partial runs still write a usable snapshot and exit **2**; complete runs exit **0**. Missing merchant data produces **null counts**, not zero supply.

Start the existing Rust server from the repository root. `GET /cities/sf/locations` serves the snapshot without network/model calls. `LOCATION_DATA_DIR` can override its directory. Other city slugs return 404; missing/malformed snapshots return 503. The endpoint recalculates source staleness after 24 hours. `getLocations(city, signal)` in `frontend/src/api.js` loads the lightweight `/locations/areas` endpoint for the frontend selector. Explicit frontend offline-demo mode does not invent location fixtures; the helper reports its unsupported route.

Generated snapshots are not bundled in the current Docker image. Refresh/copy them into `LOCATION_DATA_DIR` as an explicit deployment preparation step; this change does not deploy anything.

## Contract

- `schema_version: 1`, `city`, `generated_at`, `status` (`ready`/`partial`), SF `bbox` in west/south/east/north order.
- `sources.datasf` and `sources.osm`: source URL, retrieval time, status, attribution and optional failure. Retrieval timestamps mean download time, not record update time. The OSM source includes its reproducible query and ODbL license link.
- `areas`: GeoJSON FeatureCollection with stable IDs derived from source neighborhood names, full polygons, bounding boxes, name, geography type and mapped place counts by category. A renamed source neighborhood changes its ID.
- `pois`: GeoJSON points with `osm:<type>:<id>` IDs, name if known, amenity, cuisine if tagged, source URL, coordinate method, and containing `area_ids`. Deduplication is by OSM object, not business identity. `contracted_merchant` is null because partnership status is unknown.
- GeoJSON positions are **longitude, latitude**, EPSG:4326. Way/relation coordinates are source bounding-box centers, not entrances or guaranteed interior points. POIs outside all neighborhoods remain available with empty area IDs. Shared boundary matches are retained; per-area counts should not be summed as a city total.

## Sources and geography limits

- [DataSF Analysis Neighborhoods](https://data.sfgov.org/d/j2bu-swwd): official neighborhood polygons (`nhood`), [GeoJSON API](https://data.sfgov.org/resource/j2bu-swwd.geojson?$limit=1000). [Socrata GeoJSON format](https://dev.socrata.com/docs/formats/geojson.html).
- [OpenStreetMap Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API): amenity/shop/office/leisure/tourism/public_transport and railway station/halt/tram_stop objects within the existing SF map bounds. [Query documentation](https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL). [Copyright and ODbL](https://www.openstreetmap.org/copyright). Show **© OpenStreetMap contributors** and a copyright link anywhere the POI data is presented. Preserve the source/license metadata on exports.

The SF bbox matches `config/pipeline.toml`. The expanded run returned 41 analysis neighborhoods and 42,859 POI objects (including 3,241 food objects); these are source coverage counts, not market-size claims. Analysis neighborhoods are **not PUMAs**, and synthetic persona home coordinates do not justify neighborhood demographics. Existing PUMS population estimates stay at their supported geography. No demographic crosswalk is implemented here.

OSM can be incomplete, stale or duplicate businesses. It does not establish contracted merchant supply, delivery times, customer demand, conversion, or contribution margins. Those remain inputs requiring evidence or explicit scenario assumptions.

## Verification

```sh
python3 -m unittest discover -s tools -p test_ingest_locations.py -v
cargo test -p simfrancisco --lib locations::tests --offline
```

Python tests cover polygon holes/multipolygons/bounds, stable OSM IDs and centers, invalid partial upstream responses, cache reuse/failure preservation, and unavailable-source semantics. Rust tests cover missing/invalid snapshots, unsupported/path-like cities and serving old data with explicit staleness.


## Location-scoped predictions

`POST /branches/:bid/poll` accepts an optional `location_area_id` from the current snapshot. It resolves facts server-side, adds a bounded JSON context block to the actual model prompt through `Poll.description`, and returns additive `location_context` metadata: area ID/name, total mapped places, category counts, food count, source URLs/retrieval dates/status, population scope/selector, and limitations. The original question is preserved. Existing memory/InsForge paths persist the augmented description; no database schema changes are required. The structured response field itself is not a separate database column.

Required source dates must be on or before `as_of_date` (UTC date comparison; same-day retrieval is accepted). Unknown IDs, unsupported cities, invalid dates, missing required sources/counts and future data fail before model calls. Stale but available sources are explicitly labeled. The existing population remains independently selected; location does not secretly filter or relocate residents. Unscoped polls remain unchanged. A/B/counterfactual endpoints do not yet accept location context.

`GET /cities/sf/locations/areas` returns the same provenance/status and area IDs/properties without geometry or POIs for dropdowns. The full `/locations` endpoint remains for maps/export.

POI `category_group` is exactly one of food, amenity, shop, office, leisure, tourism, transit. Area `mapped_poi_count` equals the sum of `category_counts`; food count remains for backwards compatibility, as does the filtered `food_pois` collection. Priority for multi-tag objects: food, transit, shop, office, leisure, tourism, amenity. All requested OSM classes are counted, including infrastructure such as benches/parking in amenity; these are mapped objects, not all businesses. This scope does not include every address, building or land parcel. A new `osm_places_v2` cache prevents food-only cache reuse.

The HTTP integration test captures requests at a loopback-only mock model and proves two areas reach distinct model prompts, returned context matches, invalid/future contexts fail before inference, and an unscoped poll still succeeds:

```sh
cargo test -p simfrancisco --test location_poll --offline
```
