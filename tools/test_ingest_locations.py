import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import ingest_locations as loc


def area_data():
    return {'type':'FeatureCollection','features':[{'properties':{'nhood':'Test'},'geometry':{'type':'Polygon','coordinates':[
        [[-122.5,37.7],[-122.4,37.7],[-122.4,37.8],[-122.5,37.8],[-122.5,37.7]],
        [[-122.48,37.72],[-122.46,37.72],[-122.46,37.74],[-122.48,37.74],[-122.48,37.72]]
    ]}}]}


class LocationsTest(unittest.TestCase):
    def test_polygon_holes_and_bounds(self):
        area = loc.normalize_areas(area_data())[0]
        self.assertTrue(loc.contains([-122.49,37.71],area))
        self.assertFalse(loc.contains([-122.47,37.73],area))
        self.assertFalse(loc.contains([-122.39,37.71],area))
        self.assertTrue(loc.contains([-122.5,37.71],area))
        geometry = area['geometry']
        geometry['coordinates'] = [geometry['coordinates']]
        geometry['type'] = 'MultiPolygon'
        self.assertTrue(loc.contains([-122.49,37.71],area))

    def test_poi_identity_dedup_and_center(self):
        node = {'type':'node','id':1,'lon':-122.45,'lat':37.75,'tags':{'amenity':'restaurant'}}
        way = {'type':'way','id':1,'center':{'lon':-122.45,'lat':37.75},'tags':{'amenity':'cafe'}}
        invalid = {**node,'id':2,'lat':float('nan')}
        values = loc.normalize_pois({'elements':[way,node,node,invalid]})
        self.assertEqual([x['id'] for x in values], ['osm:node:1','osm:way:1'])
        self.assertEqual(values[1]['properties']['coordinate_method'],'bounding_box_center')
        self.assertIsNone(values[0]['properties']['contracted_merchant'])
        with self.assertRaises(ValueError):
            loc.normalize_pois({'elements':[node], 'remark':'runtime timeout'})

    def test_broad_categories_are_exclusive_and_complete(self):
        tags = [{'amenity':'restaurant'}, {'amenity':'school'}, {'shop':'supermarket'},
                {'office':'company'}, {'leisure':'park'}, {'tourism':'hotel'},
                {'public_transport':'platform','amenity':'shelter'}]
        raw = {'elements':[{'type':'node','id':i,'lon':-122.49,'lat':37.71,'tags':t} for i,t in enumerate(tags)]}
        pois = loc.normalize_pois(raw)
        self.assertEqual(sorted(p['properties']['category_group'] for p in pois), sorted(loc.CATEGORY_GROUPS))
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(loc, 'fetch', side_effect=[area_data(), raw]):
                snapshot = loc.build(Path(directory))
        props = snapshot['areas']['features'][0]['properties']
        self.assertEqual(props['mapped_poi_count'], 7)
        self.assertEqual(sum(props['category_counts'].values()), 7)
        self.assertEqual(props['mapped_food_poi_count'], 1)
        self.assertEqual(len(snapshot['food_pois']['features']), 1)

    def test_cache_reuses_and_preserves_last_good_on_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            with patch.object(loc,'fetch',return_value=area_data()) as fetch:
                first, meta = loc.cached_source(cache,'areas','url',loc.normalize_areas)
                self.assertEqual(meta['status'],'fresh')
                _, meta = loc.cached_source(cache,'areas','url',loc.normalize_areas)
                self.assertEqual(meta['status'],'cached')
                self.assertEqual(fetch.call_count,1)
            with patch.object(loc,'fetch',return_value={'invalid':True}):
                recovered, meta = loc.cached_source(cache,'areas','url',loc.normalize_areas,force=True)
                self.assertEqual(meta['status'],'stale')
                self.assertEqual(recovered, first)
                self.assertEqual(json.loads((cache/'areas.json').read_text())['data'],first)

    def test_missing_sources_are_unavailable_not_zero_supply(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            loc.atomic_json(cache/'datasf.json',{'retrieved_at':loc.now(),'data':area_data()})
            with patch.object(loc,'fetch',side_effect=AssertionError('offline called network')):
                result = loc.build(cache,offline=True)
            self.assertEqual(result['status'],'partial')
            self.assertIsNone(result['areas']['features'][0]['properties']['mapped_food_poi_count'])
            self.assertEqual(result['sources']['osm']['status'],'unavailable')


if __name__ == '__main__':
    unittest.main()
