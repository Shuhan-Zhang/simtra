#!/usr/bin/env python3
"""Refresh public SF launch-area/place context; no API key or model calls."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import tempfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
AREAS_URL = 'https://data.sfgov.org/resource/j2bu-swwd.geojson?$limit=1000'
POIS_URL = 'https://overpass-api.de/api/interpreter'
# W,S,E,N: same SF bounding box as config/pipeline.toml.
BBOX = [-122.5247, 37.6983, -122.3366, 37.8312]
CATEGORY_GROUPS = ('food', 'amenity', 'shop', 'office', 'leisure', 'tourism', 'transit')
QUERY = '[out:json][timeout:45];(' + ''.join('nwr[' + selector + '](37.6983,-122.5247,37.8312,-122.3366);' for selector in (
    '"amenity"', '"shop"', '"office"', '"leisure"', '"tourism"', '"public_transport"', '"railway"~"^(station|halt|tram_stop)$"'
)) + ');out center tags;'

TTL = 86400


def now():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as f:
        json.dump(value, f, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        tmp = Path(f.name)
    tmp.replace(path)


def age(timestamp):
    return max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(timestamp)).total_seconds())


def fetch(url, query=None):
    body = urllib.parse.urlencode({'data': query}).encode() if query else None
    req = urllib.request.Request(url, data=body, headers={'User-Agent': 'Simtra-location-ingest/1.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as response:
        raw = response.read(25_000_001)
        if len(raw) > 25_000_000:
            raise ValueError('Source exceeds 25 MB safety limit')
        return json.loads(raw)


def cached_source(cache, key, url, normalize, query=None, force=False, offline=False):
    """Only replace validated cache; keep last good data on HTTP/schema failure."""
    path = cache / (key + '.json')
    previous = None
    try:
        previous = json.loads(path.read_text())
        normalize(previous['data'])
        age(previous['retrieved_at'])
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError):
        previous = None
    if previous and (offline or (not force and age(previous['retrieved_at']) < TTL)):
        return previous['data'], {'url': url, 'retrieved_at': previous['retrieved_at'], 'status': 'stale' if age(previous['retrieved_at']) >= TTL else 'cached'}
    try:
        if offline:
            raise ValueError('No usable offline cache')
        data = fetch(url, query)
        normalize(data)
        entry = {'retrieved_at': now(), 'data': data}
        atomic_json(path, entry)
        return data, {'url': url, 'retrieved_at': entry['retrieved_at'], 'status': 'fresh'}
    except (OSError, ValueError, KeyError, TypeError, AttributeError, IndexError) as error:
        meta = {'url': url, 'retrieved_at': previous['retrieved_at'] if previous else None,
                'status': 'stale' if previous else 'unavailable', 'error': str(error)}
        return previous['data'] if previous else None, meta


def valid_point(p):
    return (isinstance(p, (list, tuple)) and len(p) >= 2 and
            all(isinstance(v, (float, int)) and math.isfinite(v) for v in p[:2]) and
            -180 <= p[0] <= 180 and -90 <= p[1] <= 90)


def polygons(geometry):
    if geometry.get('type') == 'Polygon':
        return [geometry['coordinates']]
    if geometry.get('type') == 'MultiPolygon':
        return geometry['coordinates']
    raise ValueError('Expected Polygon or MultiPolygon')


def normalize_areas(data):
    if not isinstance(data, dict) or data.get('type') != 'FeatureCollection' or not data.get('features'):
        raise ValueError('Missing neighborhood features')
    result = []
    for feature in data['features']:
        name = feature['properties']['nhood']
        if not isinstance(name, str) or not name.strip():
            raise ValueError('Missing neighborhood name')
        geometry = feature['geometry']
        poly = polygons(geometry)
        if not poly or any(not rings for rings in poly):
            raise ValueError('Empty polygon')
        for rings in poly:
            for ring in rings:
                if len(ring) < 4 or ring[0] != ring[-1] or not all(valid_point(p) for p in ring):
                    raise ValueError('Invalid polygon ring')
        points = [p for rings in poly for ring in rings for p in ring]
        bbox = [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]
        result.append({'type': 'Feature', 'id': 'sf:analysis:' + hashlib.sha256(name.encode()).hexdigest()[:16],
                       'geometry': geometry, 'bbox': bbox, 'properties': {'name': name, 'geography_type': 'analysis_neighborhood', 'source': 'datasf'}})
    if len({f['id'] for f in result}) != len(result):
        raise ValueError('Duplicate neighborhood IDs')
    return sorted(result, key=lambda f: f['id'])


def in_ring(point, ring):
    x, y = point
    inside = False
    for a, b in zip(ring, ring[1:]):
        ax, ay = a[:2]; bx, by = b[:2]
        # Boundary points count as contained; multiple matches are retained.
        cross = (x-ax)*(by-ay) - (y-ay)*(bx-ax)
        if abs(cross) < 1e-12 and min(ax,bx) <= x <= max(ax,bx) and min(ay,by) <= y <= max(ay,by):
            return True
        if (ay > y) != (by > y) and x < (bx-ax)*(y-ay)/(by-ay)+ax:
            inside = not inside
    return inside


def contains(point, area):
    w,s,e,n = area['bbox']
    if not (w <= point[0] <= e and s <= point[1] <= n):
        return False
    return any(in_ring(point, rings[0]) and not any(in_ring(point, hole) for hole in rings[1:]) for rings in polygons(area['geometry']))


def normalize_pois(data):
    if not isinstance(data, dict) or data.get('remark') or not isinstance(data.get('elements'), list):
        raise ValueError('Incomplete or invalid Overpass response')
    result = {}
    for element in data['elements']:
        kind = element.get('type')
        tags = element.get('tags', {})
        if kind not in ('node', 'way', 'relation'):
            continue
        if tags.get('amenity') in ('restaurant','cafe','fast_food','food_court'):
            group, category = 'food', tags['amenity']
        elif tags.get('public_transport') or tags.get('railway') in ('station','halt','tram_stop'):
            group, category = 'transit', tags.get('public_transport') or tags['railway']
        else:
            group = next((key for key in ('shop','office','leisure','tourism','amenity') if tags.get(key)), None)
            if group is None:
                continue
            category = tags[group]
        center = element if kind == 'node' else element.get('center', {})
        point = [center.get('lon'), center.get('lat')]
        if not valid_point(point) or not (BBOX[0] <= point[0] <= BBOX[2] and BBOX[1] <= point[1] <= BBOX[3]):
            continue
        identifier = f"osm:{kind}:{int(element['id'])}"
        result[identifier] = {'type': 'Feature', 'id': identifier, 'geometry': {'type': 'Point', 'coordinates': point},
                             'properties': {'name': tags.get('name'), 'category': category, 'category_group': group, 'cuisine': tags.get('cuisine'),
                                            'source': 'osm', 'source_url': f"https://www.openstreetmap.org/{kind}/{element['id']}",
                                            'coordinate_method': 'node' if kind == 'node' else 'bounding_box_center',
                                            'contracted_merchant': None}}
    return [result[k] for k in sorted(result)]


def build(cache, force=False, offline=False):
    raw_areas, area_meta = cached_source(cache, 'datasf', AREAS_URL, normalize_areas, force=force, offline=offline)
    raw_pois, poi_meta = cached_source(cache, 'osm_places_v2', POIS_URL, normalize_pois, QUERY, force, offline)
    areas = normalize_areas(raw_areas) if raw_areas else []
    pois = normalize_pois(raw_pois) if raw_pois else []
    counts = {a['id']: {group: 0 for group in CATEGORY_GROUPS} for a in areas}
    for poi in pois:
        matches = [a['id'] for a in areas if contains(poi['geometry']['coordinates'], a)]
        poi['properties']['area_ids'] = matches
        for key in matches:
            counts[key][poi['properties']['category_group']] += 1
    for area in areas:
        area['properties']['mapped_food_poi_count'] = counts[area['id']]['food'] if raw_pois is not None else None
        area['properties']['mapped_poi_count'] = sum(counts[area['id']].values()) if raw_pois is not None else None
        area['properties']['category_counts'] = counts[area['id']] if raw_pois is not None else None
    return {'schema_version': 1, 'city': 'sf', 'generated_at': now(), 'bbox': BBOX,
            'status': 'ready' if all(m['status'] in ('fresh','cached') for m in (area_meta,poi_meta)) else 'partial',
            'sources': {'datasf': {**area_meta, 'attribution': 'DataSF / SF Planning: Analysis Neighborhoods', 'dataset_url': 'https://data.sfgov.org/d/j2bu-swwd'},
                        'osm': {**poi_meta, 'attribution': '© OpenStreetMap contributors', 'license': 'ODbL', 'license_url': 'https://www.openstreetmap.org/copyright', 'query': QUERY}},
            'areas': {'type': 'FeatureCollection', 'features': areas}, 'pois': {'type': 'FeatureCollection', 'features': pois},
            'food_pois': {'type': 'FeatureCollection', 'features': [p for p in pois if p['properties']['category_group'] == 'food']},
            'coverage': {'category_groups': CATEGORY_GROUPS, 'scope': 'OSM amenity, shop, office, leisure, tourism, public_transport and railway stations/halts/tram_stops; not every address or building'},
            'limitations': ['Analysis neighborhoods are not Census PUMAs. No neighborhood demographics are inferred from synthetic home positions.',
                            'OSM coverage is incomplete; mapped POIs are not verified active or contracted merchants and may contain separate objects for the same business.',
                            'Way/relation points are bounding-box centers, not entrances. Boundary matches can belong to multiple areas.',
                            'Counts describe mapped supply context, not demand, delivery times, conversion, or marketplace coverage.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path, default=ROOT / 'data/locations/cache')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/locations/sf.json')
    parser.add_argument('--force', action='store_true', help='Refresh before the 24-hour TTL expires')
    parser.add_argument('--offline', action='store_true', help='Use cached sources without network')
    args = parser.parse_args()
    snapshot = build(args.cache_dir, args.force, args.offline)
    atomic_json(args.output, snapshot)
    print(json.dumps({'output': str(args.output), 'status': snapshot['status'], 'areas': len(snapshot['areas']['features']),
                      'food_pois': len(snapshot['food_pois']['features']), 'pois': len(snapshot['pois']['features']), 'sources': snapshot['sources']}))
    return 0 if snapshot['status'] == 'ready' else 2


if __name__ == '__main__':
    raise SystemExit(main())
