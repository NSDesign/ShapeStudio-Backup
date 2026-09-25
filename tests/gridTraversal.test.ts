import { describe, expect, it } from 'vitest';
import { getGridTraversalPositions, type GridTraversalOptions } from '../shared/gridTraversal';
import { BatchConfigSettingsSchema, DEFAULT_CELL_CONSTRAINTS, DEFAULT_SHAPE_MASKING } from '../shared/schema';
import { applyGridDistribution as applyClientGridDistribution, type DistributionConfig } from '../client/src/lib/shapeTypes';
import { applyGridDistribution as applyServerGridDistribution } from '../server/lib/distributionLayouts';

const pair = (positions: Array<{ rowIndex: number; colIndex: number }>) =>
  positions.map(({ rowIndex, colIndex }) => [rowIndex, colIndex]);

describe('grid creation direction', () => {
  it.each([
    ['rows', 'left-to-right', 'top-to-bottom', [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]],
    ['rows', 'right-to-left', 'top-to-bottom', [[0, 2], [0, 1], [0, 0], [1, 2], [1, 1], [1, 0]]],
    ['rows', 'left-to-right', 'bottom-to-top', [[1, 0], [1, 1], [1, 2], [0, 0], [0, 1], [0, 2]]],
    ['rows', 'right-to-left', 'bottom-to-top', [[1, 2], [1, 1], [1, 0], [0, 2], [0, 1], [0, 0]]],
    ['columns', 'left-to-right', 'top-to-bottom', [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]],
    ['columns', 'right-to-left', 'top-to-bottom', [[0, 2], [1, 2], [0, 1], [1, 1], [0, 0], [1, 0]]],
    ['columns', 'left-to-right', 'bottom-to-top', [[1, 0], [0, 0], [1, 1], [0, 1], [1, 2], [0, 2]]],
    ['columns', 'right-to-left', 'bottom-to-top', [[1, 2], [0, 2], [1, 1], [0, 1], [1, 0], [0, 0]]],
  ] as const)('%s / %s / %s visits the expected cells', (gridCreationOrder, gridHorizontalDirection, gridVerticalDirection, expected) => {
    const positions = getGridTraversalPositions(2, 3, { gridCreationOrder, gridHorizontalDirection, gridVerticalDirection });
    expect(pair(positions)).toEqual(expected);
    expect(positions.map(position => position.linearIndex)).toEqual(expected.map(([row, col]) => row * 3 + col));
  });

  it('keeps the old row-major order for legacy settings', () => {
    const parsed = BatchConfigSettingsSchema.pick({
      gridCreationOrder: true,
      gridHorizontalDirection: true,
      gridVerticalDirection: true,
    }).parse({});
    expect(parsed).toEqual({
      gridCreationOrder: 'rows',
      gridHorizontalDirection: 'left-to-right',
      gridVerticalDirection: 'top-to-bottom',
    });
    expect(pair(getGridTraversalPositions(2, 3))).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
  });

  it('uses the same physical cells in preview and server output, skipping masks and cycling', () => {
    const directions: GridTraversalOptions = {
      gridCreationOrder: 'columns',
      gridHorizontalDirection: 'right-to-left',
      gridVerticalDirection: 'bottom-to-top',
    };
    const config: DistributionConfig = {
      enabled: true,
      pattern: 'grid',
      gridRows: 2,
      gridColumns: 3,
      gridRowOffset: 100,
      gridColumnOffset: 100,
      gridSortBy: 'none',
      gridSortScope: 'per-generation',
      gridSortOrder: 'ascending',
      gridXRandomization: 0,
      gridYRandomization: 0,
      cellConstraints: { ...DEFAULT_CELL_CONSTRAINTS, enabled: false, renderMode: 'cell-center' },
      shapeMasking: {
        ...DEFAULT_SHAPE_MASKING,
        enabled: true,
        grid: {
          ...DEFAULT_SHAPE_MASKING.grid,
          enabled: true,
          mode: 'pattern',
          pattern: [{ row: 1, columns: [2] }],
        },
      },
      ...directions,
    };
    const shapes = () => Array.from({ length: 7 }, () => ({
      width: 10,
      height: 10,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    }));
    const artboard = { x: 0, y: 0, width: 300, height: 200 };
    const client = applyClientGridDistribution(shapes(), config, { x: 150, y: 100 }, undefined, artboard);
    const server = applyServerGridDistribution(shapes(), config, { x: 150, y: 100 }, undefined, artboard);
    const expectedCells = [[0, 2], [1, 1], [0, 1], [1, 0], [0, 0], [0, 2], [1, 1]];
    expect(pair(client)).toEqual(expectedCells);
    expect(pair(server)).toEqual(expectedCells);
    expect(client.map(({ shape }) => [shape.transform.x, shape.transform.y])).toEqual(
      server.map(({ shape }) => [shape.transform.x, shape.transform.y]),
    );
  });

  it('visits cell-corner intersections with the selected order', () => {
    const config: DistributionConfig = {
      enabled: true,
      pattern: 'grid',
      gridRows: 1,
      gridColumns: 2,
      gridRowOffset: 100,
      gridColumnOffset: 100,
      gridSortBy: 'none',
      gridSortScope: 'per-generation',
      gridSortOrder: 'ascending',
      gridXRandomization: 0,
      gridYRandomization: 0,
      cellConstraints: { ...DEFAULT_CELL_CONSTRAINTS, enabled: true, renderMode: 'cell-corners', fitMode: 'none' },
      gridCreationOrder: 'columns',
      gridHorizontalDirection: 'right-to-left',
      gridVerticalDirection: 'bottom-to-top',
    };
    const shapes = () => Array.from({ length: 6 }, () => ({
      width: 10,
      height: 10,
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    }));
    const bounds = { x: 0, y: 0, width: 200, height: 100 };
    const expected = [[1, 2], [0, 2], [1, 1], [0, 1], [1, 0], [0, 0]];
    expect(pair(applyClientGridDistribution(shapes(), config, { x: 100, y: 50 }, undefined, bounds))).toEqual(expected);
    expect(pair(applyServerGridDistribution(shapes(), config, { x: 100, y: 50 }, undefined, bounds))).toEqual(expected);
  });
});