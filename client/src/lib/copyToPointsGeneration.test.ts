import { describe, expect, it } from 'vitest';
import { defaultBatchConfigSettings, type GenerationSet } from '@shared/schema';
import type { ScatterSettings } from './shapeTypes';
import { Shape } from './shapes';
import {
  batchSetScatterOverride,
  hideCopyToPointsSource,
  placeCopyToPointsShapes,
  positionGenerationSetShapes,
  sortCopyToPointsSets,
} from './copyToPointsGeneration';

const bounds = { x: 0, y: 0, width: 200, height: 200 };

function set(id: string, generationOrder: number): GenerationSet {
  return {
    id,
    name: id,
    generationOrder,
    batchConfig: { ...defaultBatchConfigSettings },
  } as GenerationSet;
}

describe('batch Copy-to-Points collection', () => {
  it('places dependent shapes on transformed target points and hides the point source', () => {
    const source = set('source', 0);
    const destination = set('destination', 1);
    source.batchConfig.copyToPointsEnabled = true;
    source.batchConfig.copyToPointsConfig = {
      ...source.batchConfig.copyToPointsConfig!,
      destinationSetId: destination.id,
      copyMode: 'shape-copy',
      overflowMode: 'wrap',
    };
    destination.batchConfig.copyToPointsTargetConfig = {
      ...destination.batchConfig.copyToPointsTargetConfig!,
      includeCentroid: true,
      includeVertices: false,
    };
    destination.batchConfig.hideWhenUsedAsPointSource = true;
    destination.setTransform = { x: 12, y: -4, rotation: 0, scaleX: 1, scaleY: 1 };

    const sets = [source, destination];
    const { sorted, cycleSetIds } = sortCopyToPointsSets(sets);
    expect(cycleSetIds.size).toBe(0);
    expect(sorted.map(entry => entry.id)).toEqual(['destination', 'source']);

    const shapesBySetId = new Map<string, Shape[]>();
    const exported: Shape[] = [];
    for (const entry of sorted) {
      const originals = entry.id === 'destination'
        ? [new Shape('rectangle', 10, 20), new Shape('rectangle', 40, 50)]
        : [new Shape('circle', 100, 100)];
      positionGenerationSetShapes(originals, entry, bounds);
      const placed = placeCopyToPointsShapes(entry, originals, shapesBySetId, sorted);
      if (!hideCopyToPointsSource(entry, sorted)) exported.push(...placed);
    }

    // Live generation harvests the transformed centroids and then distributes
    // the source shape once per target point, even if the target is not rendered.
    expect(shapesBySetId.get('destination')?.map(shape => [shape.transform.x, shape.transform.y]))
      .toEqual([[22, 16], [52, 46]]);
    expect(exported).toHaveLength(2);
    expect(exported.map(shape => [shape.transform.x, shape.transform.y]))
      .toEqual([[22, 16], [52, 46]]);
  });

  it('keeps all repetitions available as points and resets between artworks', () => {
    const source = set('source', 0);
    const destination = set('destination', 1);
    source.batchConfig.copyToPointsEnabled = true;
    source.batchConfig.copyToPointsConfig = {
      ...source.batchConfig.copyToPointsConfig!,
      destinationSetId: destination.id,
      copyMode: 'shape-copy',
      overflowMode: 'wrap',
    };
    destination.batchConfig.copyToPointsTargetConfig = {
      ...destination.batchConfig.copyToPointsTargetConfig!,
      includeCentroid: true,
      includeVertices: false,
    };
    const sets = sortCopyToPointsSets([source, destination]).sorted;
    for (let artwork = 0; artwork < 2; artwork++) {
      const shapesBySetId = new Map<string, Shape[]>();
      placeCopyToPointsShapes(destination, [new Shape('rectangle', 1, 2)], shapesBySetId, sets);
      placeCopyToPointsShapes(destination, [new Shape('rectangle', 3, 4)], shapesBySetId, sets);
      const placed = placeCopyToPointsShapes(source, [new Shape('circle', 99, 99)], shapesBySetId, sets);
      expect(placed.map(shape => [shape.transform.x, shape.transform.y])).toEqual([[1, 2], [3, 4]]);
    }
  });

  it('generates current destination geometry with live vertex settings before batch placement', () => {
    const source = set('source', 0);
    const destination = set('destination', 1);
    source.batchConfig.copyToPointsEnabled = true;
    source.batchConfig.copyToPointsConfig = {
      ...source.batchConfig.copyToPointsConfig!,
      destinationSetId: destination.id,
      copyMode: 'shape-copy',
      overflowMode: 'wrap',
    };
    destination.batchConfig.copyToPointsTargetConfig = {
      ...destination.batchConfig.copyToPointsTargetConfig!,
      includeCentroid: false,
      includeVertices: true,
      vertexSampleStride: 1,
    };
    // The saved geometry is stale. Live generation reads the current set's
    // scatterSettings; the export generator must not override its shapeSpecific.
    destination.shapeSpecificProperties = {
      polygon: { edgeCountMode: 'fixed', edgeCountValue: 4 },
    } as GenerationSet['shapeSpecificProperties'];
    const liveScatter = {
      shapeSpecific: { polygon: { edgeCountMode: 'fixed', edgeCountValue: 7 } },
    } as ScatterSettings;
    const exportScatter = {
      ...liveScatter,
      ...batchSetScatterOverride(destination, true, 1),
    };
    const geometryConfig = {
      ...defaultBatchConfigSettings,
      propertiesEnabled: true,
      shapePropertiesEnabled: true,
      shapePropertiesDimensionsEnabled: true,
      widthMode: 'value',
      widthValue: 100,
      heightMode: 'value',
      heightValue: 100,
    };
    const liveDestination = new Shape('polygon', 10, 20, {
      ...geometryConfig,
      scatterSettings: liveScatter,
    });
    // This is the Shape construction input used by the batch generator after
    // it merges its scatter override over the live settings.
    const batchDestination = new Shape('polygon', 10, 20, {
      ...geometryConfig,
      scatterSettings: exportScatter,
    });
    expect(liveDestination.points).toHaveLength(7);
    expect(batchDestination.points).toEqual(liveDestination.points);

    const sorted = sortCopyToPointsSets([source, destination]).sorted;
    const shapesBySetId = new Map<string, Shape[]>();
    placeCopyToPointsShapes(destination, [batchDestination], shapesBySetId, sorted);
    const copies = placeCopyToPointsShapes(source, [new Shape('circle', 0, 0)], shapesBySetId, sorted);
    expect(copies).toHaveLength(7);
    copies.forEach((copy, index) => {
      expect(copy.transform.x).toBeCloseTo(10 + liveDestination.points[index].x);
      expect(copy.transform.y).toBeCloseTo(20 + liveDestination.points[index].y);
    });
  });
});