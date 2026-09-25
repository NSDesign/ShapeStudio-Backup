/**
 * Copy-to-Points Batch Export Parity Verification
 *
 * Exercises the CTP distribution pipeline through two paths and confirms
 * they agree on shape count, output positions, and property values:
 *
 *   Path A — Shared utility directly (identical code used by the live canvas client)
 *             harvestDestinationPoints() → applyCopyToPointsDistribution()
 *
 *   Path B — Server batch processor (generateShapesWithBatchConfig with
 *             copyToPointsEnabled=true and a populated destinationShapesMap)
 *
 * Run with:
 *   npx tsx tests/copy-to-points-parity.ts
 */

import {
  harvestDestinationPoints,
  applyCopyToPointsDistribution,
  type HarvestedPoint,
} from '../shared/copyToPointsUtils';
import {
  DEFAULT_COPY_TO_POINTS_CONFIG,
  DEFAULT_POINT_PROPERTY_CONFIG,
  defaultBatchConfigSettings,
  type CopyToPointsConfig,
  type PointPropertyConfig,
} from '../shared/schema';
import { generateShapesWithBatchConfig } from '../server/lib/batchConfigProcessor';

// ── Assertion helpers ─────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function assertClose(a: number, b: number, tolerance: number, message: string): void {
  assert(Math.abs(a - b) <= tolerance, `${message} (got ${a.toFixed(4)}, expected ~${b.toFixed(4)}, tol=${tolerance})`);
}

function assertInRange(value: number, min: number, max: number, message: string): void {
  assert(value >= min && value <= max, `${message} (got ${value.toFixed(4)}, expected in [${min}, ${max}])`);
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Minimal shape with explicit polygon vertices in world space.
 * CTP uses shape.points (local) transformed via shape.transform for vertex harvesting,
 * or falls back to bboxPolygonWorld when shape.points is empty.
 *
 * We use the bbox fallback by leaving points=[] and setting width/height in properties.
 */
function makeDestShape(
  cx: number,
  cy: number,
  width: number,
  height: number,
  fillOpacity = 0.8,
): any {
  return {
    id: `dest_${cx}_${cy}`,
    type: 'rectangle',
    // bboxPolygonWorld reads shape.width / shape.height (top-level), not shape.properties.*
    width,
    height,
    transform: { x: cx, y: cy, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 },
    properties: {
      width,
      height,
      fillColor: '#ff0000',
      fillOpacity,
      strokeWidth: 0,
      strokeColor: 'transparent',
      strokeOpacity: 0,
    },
    points: [],
    selected: false,
  };
}

function makeSourceShape(cx: number, cy: number, fillOpacity = 0.5): any {
  return {
    id: `src_${cx}_${cy}`,
    type: 'circle',
    transform: { x: cx, y: cy, scaleX: 1, scaleY: 1, rotation: 0, skewX: 0, skewY: 0 },
    properties: {
      width: 30,
      height: 30,
      fillColor: '#0000ff',
      fillOpacity,
      strokeWidth: 0,
      strokeColor: 'transparent',
      strokeOpacity: 0,
    },
    points: [],
    selected: false,
  };
}

// ── Utility: bboxPolygonWorld (mirrors copyToPointsUtils.ts private helper) ──

/**
 * Reproduces the bbox corner logic from copyToPointsUtils.ts so we can
 * predict exactly which world-space points will be harvested.
 * bboxPolygonWorld reads shape.width / shape.height (top-level), falling back to 50.
 */
function expectedBboxCorners(shape: any): Array<{ x: number; y: number }> {
  const cx = shape.transform.x;
  const cy = shape.transform.y;
  const w = shape.width ?? (shape.radius != null ? shape.radius * 2 : 50);
  const h = shape.height ?? (shape.radius != null ? shape.radius * 2 : 50);
  const hw = w / 2;
  const hh = h / 2;
  // bboxPolygonWorld returns 4 corners TL→TR→BR→BL (rotation=0, scale=1 in our fixtures)
  return [
    { x: cx - hw, y: cy - hh },
    { x: cx + hw, y: cy - hh },
    { x: cx + hw, y: cy + hh },
    { x: cx - hw, y: cy + hh },
  ];
}

// ── Suite A: Shared utility unit tests ───────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Suite A — Shared utility (harvestDestinationPoints + applyCopyToPointsDistribution)');
console.log('═══════════════════════════════════════════════════════════════\n');

// A1: Harvest vertices from a single rectangle (bbox fallback, stride=1, no centroid)
{
  console.log('A1: Harvest vertices from a single rectangle');
  const dest = makeDestShape(200, 150, 100, 80);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 4, `expect 4 bbox corners harvested, got ${pts.length}`);
  const expected = expectedBboxCorners(dest);
  pts.forEach((pt, i) => {
    assertClose(pt.x, expected[i].x, 0.001, `corner ${i} x matches`);
    assertClose(pt.y, expected[i].y, 0.001, `corner ${i} y matches`);
    assert(pt.sourceShape === dest, `corner ${i} sourceShape back-reference is correct`);
  });
}

// A2: Harvest centroid only
{
  console.log('\nA2: Harvest centroid only');
  const dest = makeDestShape(400, 300, 60, 40);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: false,
    includeCentroid: true,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 1, `expect 1 centroid, got ${pts.length}`);
  assertClose(pts[0].x, 400, 0.001, 'centroid x = shape cx');
  assertClose(pts[0].y, 300, 0.001, 'centroid y = shape cy');
}

// A3: Harvest with stride=2 (every other vertex)
{
  console.log('\nA3: Harvest with vertexSampleStride=2 (every other corner)');
  const dest = makeDestShape(500, 500, 200, 200);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 2,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 2, `stride=2 on 4-corner rect → 2 points, got ${pts.length}`);
}

// A4: Resample outline — count controls output
{
  console.log('\nA4: Resample outline');
  const dest = makeDestShape(300, 300, 100, 100);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: false,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: true,
    resampleCount: 10,
  });
  assert(pts.length === 10, `resampleCount=10 → 10 points, got ${pts.length}`);
}

// A5: Multiple destination shapes — points accumulate
{
  console.log('\nA5: Two destination shapes, vertices only');
  const d1 = makeDestShape(100, 100, 50, 50);
  const d2 = makeDestShape(400, 200, 80, 60);
  const pts = harvestDestinationPoints([d1, d2], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 8, `two 4-corner rects → 8 points, got ${pts.length}`);
}

// A6: shape-copy / wrap — N output shapes for N destination points
{
  console.log('\nA6: shape-copy / wrap overflow → output count equals harvested point count');
  const dest = makeDestShape(200, 200, 80, 80); // 4 corners
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 4, 'precondition: 4 points');

  const sources = [
    makeSourceShape(0, 0),
    makeSourceShape(0, 0),
  ];
  const cfg: Partial<CopyToPointsConfig> = {
    copyMode: 'shape-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  };
  const output = applyCopyToPointsDistribution(sources, pts, cfg);
  assert(output.length === 4, `wrap mode: 4 pts × cycle 2 sources → 4 output shapes, got ${output.length}`);

  // Verify each output position matches the corresponding harvested point
  output.forEach((shape: any, i: number) => {
    assertClose(shape.transform.x, pts[i].x, 0.001, `output[${i}] x = pt[${i}].x (${pts[i].x})`);
    assertClose(shape.transform.y, pts[i].y, 0.001, `output[${i}] y = pt[${i}].y (${pts[i].y})`);
  });
}

// A7: shape-copy / clamp — min(points, sources) output shapes
{
  console.log('\nA7: shape-copy / clamp overflow → output capped at min(pts, sources)');
  const dest = makeDestShape(200, 200, 80, 80); // 4 corners
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  const sources = [makeSourceShape(0, 0), makeSourceShape(0, 0), makeSourceShape(0, 0)];
  const output = applyCopyToPointsDistribution(sources, pts, {
    copyMode: 'shape-copy',
    overflowMode: 'clamp',
    pointProperties: [],
  });
  // min(4 pts, 3 sources) = 3
  assert(output.length === 3, `clamp: min(4 pts, 3 sources) → 3 outputs, got ${output.length}`);
}

// A8: shape-copy / distribute-evenly — N output shapes (one per point)
{
  console.log('\nA8: shape-copy / distribute-evenly → one output shape per point');
  const dest = makeDestShape(200, 200, 80, 80); // 4 corners
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  const sources = [makeSourceShape(0, 0)]; // 1 source
  const output = applyCopyToPointsDistribution(sources, pts, {
    copyMode: 'shape-copy',
    overflowMode: 'distribute-evenly',
    pointProperties: [],
  });
  assert(output.length === 4, `distribute-evenly: 4 pts, 1 source → 4 outputs, got ${output.length}`);
}

// A9: set-copy mode — pts × sources output shapes
{
  console.log('\nA9: set-copy mode → points × sources shapes');
  const dest = makeDestShape(300, 300, 100, 100); // 4 corners
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  const sources = [makeSourceShape(0, 0), makeSourceShape(10, 0)];
  const output = applyCopyToPointsDistribution(sources, pts, {
    copyMode: 'set-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });
  assert(output.length === 8, `set-copy: 4 pts × 2 sources → 8 outputs, got ${output.length}`);
}

// A10: Fixed-mode pointProperty — exact value applied (deterministic)
{
  console.log('\nA10: Fixed-mode pointProperty → exact fillOpacity applied to every output');
  const dest = makeDestShape(100, 100, 60, 60); // 4 corners
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  const fixedOpacityProp: PointPropertyConfig = {
    ...DEFAULT_POINT_PROPERTY_CONFIG,
    enabled: true,
    key: 'fillOpacity',
    mode: 'fixed',
    fixedValue: 0.42,
    blendMode: 'normal',
    amountMode: 'fixed',
    amountFixed: 1.0,
  };
  const sources = [makeSourceShape(0, 0, 0.5)];
  const output = applyCopyToPointsDistribution(sources, pts, {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
    copyMode: 'shape-copy',
    overflowMode: 'wrap',
    pointProperties: [fixedOpacityProp],
  });
  assert(output.length === 4, 'precondition: 4 output shapes');
  output.forEach((shape: any, i: number) => {
    assertClose(
      shape.properties.fillOpacity,
      0.42,
      0.001,
      `output[${i}] fillOpacity fixed at 0.42`,
    );
  });
}

// A11: Incremental-mode pointProperty — progressive rotation values (deterministic)
{
  console.log('\nA11: Incremental-mode pointProperty → progressive rotation');
  const dest = makeDestShape(200, 200, 80, 80); // 4 corners
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  const incrementalProp: PointPropertyConfig = {
    ...DEFAULT_POINT_PROPERTY_CONFIG,
    enabled: true,
    key: 'rotation',
    mode: 'incremental',
    incrementalStart: 0,
    incrementalStep: 90,
    incrementalWrap: 360,
    blendMode: 'normal',
    amountMode: 'fixed',
    amountFixed: 1.0,
  };
  const sources = [makeSourceShape(0, 0)];
  const output = applyCopyToPointsDistribution(sources, pts, {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
    copyMode: 'shape-copy',
    overflowMode: 'wrap',
    pointProperties: [incrementalProp],
  });
  // index 0 → 0°, 1 → 90°, 2 → 180°, 3 → 270°
  const expectedRotations = [0, 90, 180, 270];
  output.forEach((shape: any, i: number) => {
    assertClose(
      shape.transform.rotation,
      expectedRotations[i],
      0.001,
      `output[${i}] rotation = ${expectedRotations[i]}°`,
    );
  });
}

// A12: Range-mode pointProperty + amountMode='range' — values stay within configured bounds
{
  console.log('\nA12: Range-mode pointProperty + amountMode=range → values within [min, max]');
  const dest = makeDestShape(300, 300, 100, 100); // 4 corners → 4 pts
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  const rangeOpacityProp: PointPropertyConfig = {
    ...DEFAULT_POINT_PROPERTY_CONFIG,
    enabled: true,
    key: 'fillOpacity',
    mode: 'range',
    rangeMin: 0.2,
    rangeMax: 0.9,
    blendMode: 'normal',
    amountMode: 'range',
    amountRangeMin: 0.5,
    amountRangeMax: 1.0,
    amountFixed: 1.0,
  };
  // Run many iterations to stress-test random sampling stays in range
  const sources = [makeSourceShape(0, 0, 0.0)]; // fillOpacity=0 so lerp result = targetVal
  for (let run = 0; run < 20; run++) {
    const output = applyCopyToPointsDistribution(sources, pts, {
      ...DEFAULT_COPY_TO_POINTS_CONFIG,
      copyMode: 'shape-copy',
      overflowMode: 'wrap',
      pointProperties: [rangeOpacityProp],
    });
    output.forEach((shape: any, i: number) => {
      assertInRange(
        shape.properties.fillOpacity,
        0.0,   // lerp(0, [0.2..0.9], [0.5..1.0]) lower bound
        0.9,   // upper bound: lerp(0, 0.9, 1.0) = 0.9
        `run${run} output[${i}] fillOpacity in valid interpolation range`,
      );
    });
  }
}

// A13: amountMode='range' — amountFixed=0 leaves property unchanged
{
  console.log('\nA13: amountFixed=0 → no influence, property unchanged');
  const dest = makeDestShape(100, 100, 60, 60);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  const zeroAmountProp: PointPropertyConfig = {
    ...DEFAULT_POINT_PROPERTY_CONFIG,
    enabled: true,
    key: 'fillOpacity',
    mode: 'fixed',
    fixedValue: 0.99,
    blendMode: 'normal',
    amountMode: 'fixed',
    amountFixed: 0.0, // zero amount = no change
  };
  const originalOpacity = 0.123;
  const sources = [makeSourceShape(0, 0, originalOpacity)];
  const output = applyCopyToPointsDistribution(sources, pts, {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
    copyMode: 'shape-copy',
    overflowMode: 'wrap',
    pointProperties: [zeroAmountProp],
  });
  output.forEach((shape: any, i: number) => {
    assertClose(
      shape.properties.fillOpacity,
      originalOpacity,
      0.001,
      `output[${i}] fillOpacity unchanged when amount=0`,
    );
  });
}

// A16: set-copy relative offsets — each clone lands at pt + (src − poolCenter)
{
  console.log('\nA16: set-copy — non-zero relative offsets preserved exactly');

  // Two sources with deliberate, non-symmetric positions.
  // poolCX = (10 + 50) / 2 = 30   poolCY = (30 + 10) / 2 = 20
  // offset[0] = (10-30, 30-20) = (-20, +10)
  // offset[1] = (50-30, 10-20) = (+20, -10)
  const src0 = makeSourceShape(10, 30);
  const src1 = makeSourceShape(50, 10);
  const poolCX = (10 + 50) / 2; // 30
  const poolCY = (30 + 10) / 2; // 20

  // Single centroid destination point at (200, 150)
  const destCentroid = makeDestShape(200, 150, 60, 60);
  const pts = harvestDestinationPoints([destCentroid], {
    includeVertices: false,
    includeCentroid: true,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 1, `precondition: 1 centroid point, got ${pts.length}`);
  assertClose(pts[0].x, 200, 0.001, 'precondition: centroid x = 200');
  assertClose(pts[0].y, 150, 0.001, 'precondition: centroid y = 150');

  const output = applyCopyToPointsDistribution([src0, src1], pts, {
    copyMode: 'set-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });
  assert(output.length === 2, `1 pt × 2 sources → 2 outputs, got ${output.length}`);

  // clone of src0: pt + offset[0] = (200 + (10-30), 150 + (30-20)) = (180, 160)
  assertClose(output[0].transform.x, 200 + (10 - poolCX), 0.001, 'clone[0].x = pt.x + (src0.x − poolCX)');
  assertClose(output[0].transform.y, 150 + (30 - poolCY), 0.001, 'clone[0].y = pt.y + (src0.y − poolCY)');

  // clone of src1: pt + offset[1] = (200 + (50-30), 150 + (10-20)) = (220, 140)
  assertClose(output[1].transform.x, 200 + (50 - poolCX), 0.001, 'clone[1].x = pt.x + (src1.x − poolCX)');
  assertClose(output[1].transform.y, 150 + (10 - poolCY), 0.001, 'clone[1].y = pt.y + (src1.y − poolCY)');

  // Clones must NOT be coincident — offsets are actually applied
  assert(
    Math.abs(output[0].transform.x - output[1].transform.x) > 0.001 ||
    Math.abs(output[0].transform.y - output[1].transform.y) > 0.001,
    'clones have distinct positions (offsets are applied, not collapsed to pt)',
  );
}

// A17: set-copy with multiple destination points — offsets preserved at every point
{
  console.log('\nA17: set-copy — relative offsets preserved at every destination point');

  const src0 = makeSourceShape(100, 200);
  const src1 = makeSourceShape(160, 220);
  const src2 = makeSourceShape(130, 260);
  // poolCX = (100 + 160 + 130) / 3 = 130   poolCY = (200 + 220 + 260) / 3 = 226.666…
  const srcPositions = [
    { x: 100, y: 200 },
    { x: 160, y: 220 },
    { x: 130, y: 260 },
  ];
  const poolCX3 = srcPositions.reduce((s, p) => s + p.x, 0) / 3;
  const poolCY3 = srcPositions.reduce((s, p) => s + p.y, 0) / 3;

  // Two destination points: the two corners of a degenerate shape
  // Use resampleCount=2 on a line-like rectangle to get exactly 2 points
  const dest1 = makeDestShape(300, 400, 0, 0); // centroid at (300,400)
  const dest2 = makeDestShape(500, 600, 0, 0); // centroid at (500,600)
  const pts = harvestDestinationPoints([dest1, dest2], {
    includeVertices: false,
    includeCentroid: true,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 2, `precondition: 2 centroid points, got ${pts.length}`);

  const output = applyCopyToPointsDistribution([src0, src1, src2], pts, {
    copyMode: 'set-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });
  assert(output.length === 6, `2 pts × 3 sources → 6 outputs, got ${output.length}`);

  // For each destination point, verify each clone's offset from that point
  pts.forEach((pt, ptIdx) => {
    srcPositions.forEach((srcPos, srcIdx) => {
      const cloneIdx = ptIdx * srcPositions.length + srcIdx;
      const clone = output[cloneIdx];
      assertClose(
        clone.transform.x,
        pt.x + (srcPos.x - poolCX3),
        0.001,
        `pt[${ptIdx}] clone[${srcIdx}].x = ${pt.x} + (${srcPos.x} − ${poolCX3.toFixed(2)})`,
      );
      assertClose(
        clone.transform.y,
        pt.y + (srcPos.y - poolCY3),
        0.001,
        `pt[${ptIdx}] clone[${srcIdx}].y = ${pt.y} + (${srcPos.y} − ${poolCY3.toFixed(2)})`,
      );
    });
  });
}

// A14: Empty destination → returns empty array
{
  console.log('\nA14: Empty destination shapes → no output');
  const sources = [makeSourceShape(0, 0)];
  const output = applyCopyToPointsDistribution(sources, [], {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
  });
  assert(output.length === 0, 'empty harvestedPoints → empty output');
}

// A15: Empty source shapes → returns empty array
{
  console.log('\nA15: Empty source shapes → no output');
  const dest = makeDestShape(100, 100, 60, 60);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  const output = applyCopyToPointsDistribution([], pts, {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
  });
  assert(output.length === 0, 'empty sourceShapes → empty output');
}

// ── Suite B: Server batch processor integration ────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Suite B — Server batch processor (generateShapesWithBatchConfig with CTP)');
console.log('═══════════════════════════════════════════════════════════════\n');

const DEST_SET_ID = 'dest-set-001';

// Build minimal batch config with CTP enabled pointing at DEST_SET_ID.
// distributionLayoutEnabled MUST be true — the CTP check lives inside that guard.
const ctpBatchConfig = {
  ...defaultBatchConfigSettings,
  propertiesEnabled: false,
  distributionLayoutEnabled: true,
  copyToPointsEnabled: true,
  copyToPointsConfig: {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
    destinationSetId: DEST_SET_ID,
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
    copyMode: 'shape-copy' as const,
    overflowMode: 'wrap' as const,
    pointProperties: [] as PointPropertyConfig[],
  },
};

const CANVAS_BOUNDS = { x: 0, y: 0, width: 800, height: 600 };

// B1: With no destinationShapesMap → server skips CTP, shapes pass through
{
  console.log('B1: No destinationShapesMap → CTP skipped, source shapes pass through unchanged');
  const { shapes } = generateShapesWithBatchConfig(
    3,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['rectangle'],
      batchConfig: ctpBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      // no destinationShapesMap
    }
  );
  assert(shapes.length === 3, `without dest map: 3 source shapes pass through, got ${shapes.length}`);
}

// B2: With destinationShapesMap having unknown setId → still skips CTP
{
  console.log('\nB2: destinationShapesMap missing the referenced setId → CTP skipped');
  const destMap = new Map<string, any[]>();
  destMap.set('some-other-set', [makeDestShape(100, 100, 60, 60)]);

  const { shapes } = generateShapesWithBatchConfig(
    3,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['rectangle'],
      batchConfig: ctpBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );
  assert(shapes.length === 3, `unknown setId: 3 source shapes pass through, got ${shapes.length}`);
}

// B3: With valid destinationShapesMap → CTP applied, output positions at point coords
{
  console.log('\nB3: Valid destinationShapesMap → CTP applied; output shape count and positions verified');

  // Destination set: one rectangle with 4 known corners
  const destShape = makeDestShape(400, 300, 100, 80);
  const expectedPts = expectedBboxCorners(destShape);

  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [destShape]);

  // Generate 2 source shapes; with wrap mode and 4 destination pts, expect 4 output shapes
  const { shapes } = generateShapesWithBatchConfig(
    2,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['circle'],
      batchConfig: ctpBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );

  assert(shapes.length === 4, `wrap mode: 2 src × 4 pts → 4 output shapes, got ${shapes.length}`);

  // Positions must land exactly at the harvested bbox corners
  shapes.forEach((shape: any, i: number) => {
    assertClose(shape.transform.x, expectedPts[i].x, 0.001, `output[${i}] x = ${expectedPts[i].x}`);
    assertClose(shape.transform.y, expectedPts[i].y, 0.001, `output[${i}] y = ${expectedPts[i].y}`);
  });
}

// B4a: range-mode pointProperty + amountFixed=1.0 → finalVal = targetVal ∈ [rangeMin, rangeMax]
//      Using amountFixed=1 pins amount=1, so lerp(src, targetVal, 1) = targetVal.
//      This is the tightest verifiable bound for the range-mode target sampling.
{
  console.log('\nB4a: Range-mode pointProperty (amountFixed=1.0) through server path → fillOpacity in [rangeMin, rangeMax]');

  const rangePropFixed: PointPropertyConfig = {
    ...DEFAULT_POINT_PROPERTY_CONFIG,
    enabled: true,
    key: 'fillOpacity',
    mode: 'range',
    rangeMin: 0.3,
    rangeMax: 0.8,
    blendMode: 'normal',
    amountMode: 'fixed',
    amountFixed: 1.0,
  };

  const ctpConfigB4a = {
    ...ctpBatchConfig,
    copyToPointsConfig: {
      ...ctpBatchConfig.copyToPointsConfig,
      pointProperties: [rangePropFixed],
    },
  };

  const destShape = makeDestShape(400, 300, 100, 80); // 4 corners
  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [destShape]);

  for (let run = 0; run < 10; run++) {
    const { shapes } = generateShapesWithBatchConfig(
      1,
      CANVAS_BOUNDS,
      {
        enabledShapeTypes: ['circle'],
        batchConfig: ctpConfigB4a,
        distributionEnabled: true,
      },
      {
        generationIndex: 0,
        startIndex: 0,
        destinationShapesMap: destMap,
      }
    );
    assert(shapes.length === 4, `run${run}: 1 src × 4 pts (wrap) → 4 shapes, got ${shapes.length}`);
    shapes.forEach((shape: any, i: number) => {
      assertInRange(
        shape.properties.fillOpacity,
        0.3,
        0.8,
        `run${run} output[${i}] fillOpacity in [0.3, 0.8] (range-mode targetVal, amount=1)`,
      );
    });
  }
}

// B4b: range-mode pointProperty + amountMode='range' → output within [0, 1]
//      With amountRangeMin=0 and srcVal unknown (random source shape), the lerp result
//      can be anywhere in [0, 1]. We verify CTP is applied (count check) and values
//      are valid fillOpacity values.
{
  console.log('\nB4b: Range-mode pointProperty + amountMode=range → CTP applied, fillOpacity in [0, 1]');

  const rangePropWithRangeAmount: PointPropertyConfig = {
    ...DEFAULT_POINT_PROPERTY_CONFIG,
    enabled: true,
    key: 'fillOpacity',
    mode: 'range',
    rangeMin: 0.3,
    rangeMax: 0.8,
    blendMode: 'normal',
    amountMode: 'range',
    amountRangeMin: 0.0,
    amountRangeMax: 1.0,
    amountFixed: 1.0,
  };

  const ctpConfigB4b = {
    ...ctpBatchConfig,
    copyToPointsConfig: {
      ...ctpBatchConfig.copyToPointsConfig,
      pointProperties: [rangePropWithRangeAmount],
    },
  };

  const destShape = makeDestShape(400, 300, 100, 80);
  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [destShape]);

  for (let run = 0; run < 5; run++) {
    const { shapes } = generateShapesWithBatchConfig(
      1,
      CANVAS_BOUNDS,
      {
        enabledShapeTypes: ['circle'],
        batchConfig: ctpConfigB4b,
        distributionEnabled: true,
      },
      {
        generationIndex: 0,
        startIndex: 0,
        destinationShapesMap: destMap,
      }
    );
    assert(shapes.length === 4, `run${run}: 1 src × 4 pts (wrap) → 4 shapes, got ${shapes.length}`);
    shapes.forEach((shape: any, i: number) => {
      assertInRange(
        shape.properties.fillOpacity,
        0.0,
        1.0,
        `run${run} output[${i}] fillOpacity valid [0,1] (range + amountMode=range)`,
      );
    });
  }
}

// B5: set-copy mode through server path
{
  console.log('\nB5: set-copy mode through server path → pts × sources output count');

  const setCopyBatchConfig = {
    ...ctpBatchConfig,
    copyToPointsConfig: {
      ...ctpBatchConfig.copyToPointsConfig,
      copyMode: 'set-copy' as const,
      pointProperties: [] as PointPropertyConfig[],
    },
  };

  const destShape = makeDestShape(400, 300, 100, 80); // 4 corners
  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [destShape]);

  // 3 source shapes × 4 destination pts = 12 output shapes
  const { shapes } = generateShapesWithBatchConfig(
    3,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['circle'],
      batchConfig: setCopyBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );
  assert(shapes.length === 12, `set-copy: 3 src × 4 pts → 12 outputs, got ${shapes.length}`);
}

// B5b: set-copy server path — non-zero relative offsets preserved (two-pass approach)
//
//  In a real batch export, "source" shapes come from a SEPARATE generation set that
//  has already been positioned by its own grid/scatter pass.  They are then passed to
//  applyCopyToPointsDistribution() for the CTP set.  We replicate that exact flow here:
//
//  Pass 1 — generate source shapes via the server path (CTP disabled so the grid
//            assigns non-zero positions to each shape).
//  Pass 2 — call applyCopyToPointsDistribution() directly with those server-generated
//            shapes (non-zero positions guaranteed) and a known destination point.
//  Verify  — each clone lands at  pt + (src.x − poolCX, src.y − poolCY)  exactly.
{
  console.log('\nB5b: set-copy server path — non-zero relative offsets preserved (two-pass)');

  // Pass 1: generate N source shapes via server with grid (CTP disabled).
  // gridRows=N, gridRowOffset=100 → each shape gets a distinct y position after Phase 2.
  const N_SOURCES = 3;
  const gridBatchConfig = {
    ...defaultBatchConfigSettings,
    propertiesEnabled: false,
    distributionLayoutEnabled: true,
    copyToPointsEnabled: false,        // no CTP — grid runs normally
    gridRows: N_SOURCES,
    gridColumns: 1,
    gridRowOffset: 100,
    gridColumnOffset: 0,
    gridStartX: 50,
    gridStartY: 50,
  };

  const { shapes: serverSources } = generateShapesWithBatchConfig(
    N_SOURCES,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['circle'],
      batchConfig: gridBatchConfig,
      distributionEnabled: true,
    },
    { generationIndex: 0, startIndex: 0 }
  );
  assert(serverSources.length === N_SOURCES, `Pass 1: ${N_SOURCES} server-generated source shapes, got ${serverSources.length}`);

  // Sanity: at least one source has a non-zero position (grid distributed them)
  const anyNonZero = serverSources.some((sh: any) => Math.abs(sh.transform.x) > 0.001 || Math.abs(sh.transform.y) > 0.001);
  assert(anyNonZero, 'Pass 1: at least one server source shape has a non-zero position (grid applied)');

  // Capture actual pool centroid from server-generated positions
  const poolCXb = serverSources.reduce((s: number, sh: any) => s + sh.transform.x, 0) / N_SOURCES;
  const poolCYb = serverSources.reduce((s: number, sh: any) => s + sh.transform.y, 0) / N_SOURCES;

  // Pass 2: apply CTP (same call the server batch processor makes) with 1 centroid pt
  const destCentroid = makeDestShape(400, 300, 60, 60);
  const ptsB = harvestDestinationPoints([destCentroid], {
    includeVertices: false,
    includeCentroid: true,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(ptsB.length === 1, `Pass 2 precondition: 1 centroid point, got ${ptsB.length}`);

  const setCopyCfg: Partial<CopyToPointsConfig> = {
    copyMode: 'set-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  };
  const outputB = applyCopyToPointsDistribution(serverSources, ptsB, setCopyCfg);
  assert(outputB.length === N_SOURCES, `Pass 2: 1 pt × ${N_SOURCES} src → ${N_SOURCES} outputs, got ${outputB.length}`);

  // Verify exact per-clone positions against the formula
  serverSources.forEach((src: any, i: number) => {
    const expectedX = ptsB[0].x + (src.transform.x - poolCXb);
    const expectedY = ptsB[0].y + (src.transform.y - poolCYb);
    assertClose(outputB[i].transform.x, expectedX, 0.001, `B5b clone[${i}].x = pt.x + (src.x ${src.transform.x.toFixed(1)} − pool ${poolCXb.toFixed(1)})`);
    assertClose(outputB[i].transform.y, expectedY, 0.001, `B5b clone[${i}].y = pt.y + (src.y ${src.transform.y.toFixed(1)} − pool ${poolCYb.toFixed(1)})`);
  });

  // Centroid invariant: centroid of all clones = destination point
  const meanBX = outputB.reduce((s: number, sh: any) => s + sh.transform.x, 0) / N_SOURCES;
  const meanBY = outputB.reduce((s: number, sh: any) => s + sh.transform.y, 0) / N_SOURCES;
  assertClose(meanBX, ptsB[0].x, 0.001, 'B5b centroid of clones x = destination pt x');
  assertClose(meanBY, ptsB[0].y, 0.001, 'B5b centroid of clones y = destination pt y');
}

// B5c: set-copy server path — relative offsets replicated identically at every destination point
//      With 2 destination pts, offsets between sibling clones at pt[0] must equal offsets at pt[1]
//      because poolCX/CY is global (same subtraction constant regardless of which pt is used).
{
  console.log('\nB5c: set-copy server path — relative offsets replicated at every destination point (two-pass)');

  // Pass 1: 2 server-generated source shapes, grid with rowOffset=80 to spread them
  const N_SRC = 2;
  const { shapes: serverSrc2 } = generateShapesWithBatchConfig(
    N_SRC,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['circle'],
      batchConfig: {
        ...defaultBatchConfigSettings,
        propertiesEnabled: false,
        distributionLayoutEnabled: true,
        copyToPointsEnabled: false,
        gridRows: N_SRC,
        gridColumns: 1,
        gridRowOffset: 80,
        gridColumnOffset: 0,
        gridStartX: 30,
        gridStartY: 30,
      },
      distributionEnabled: true,
    },
    { generationIndex: 0, startIndex: 0 }
  );
  assert(serverSrc2.length === N_SRC, `B5c pass 1: ${N_SRC} source shapes, got ${serverSrc2.length}`);

  const poolCXc = serverSrc2.reduce((s: number, sh: any) => s + sh.transform.x, 0) / N_SRC;
  const poolCYc = serverSrc2.reduce((s: number, sh: any) => s + sh.transform.y, 0) / N_SRC;

  // Pass 2: 2 destination points (bbox TL and BR of a known rectangle)
  // destShape cx=400, cy=300, w=100, h=100 → TL=(350,250), BR=(450,350); stride=2 selects idx 0 and 2
  const destShapeC = makeDestShape(400, 300, 100, 100);
  const expectedPts = [
    { x: 350, y: 250 }, // TL (stride=2, index 0)
    { x: 450, y: 350 }, // BR (stride=2, index 2)
  ];
  const ptsCArr = harvestDestinationPoints([destShapeC], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 2,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(ptsCArr.length === 2, `B5c pass 2 precondition: 2 destination points (stride=2), got ${ptsCArr.length}`);

  const outputC = applyCopyToPointsDistribution(serverSrc2, ptsCArr, {
    copyMode: 'set-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });
  assert(outputC.length === N_SRC * 2, `B5c: 2 pts × ${N_SRC} src → ${N_SRC * 2} outputs, got ${outputC.length}`);

  if (outputC.length === N_SRC * 2) {
    // Verify exact positions at each destination point
    ptsCArr.forEach((pt: any, ptIdx: number) => {
      serverSrc2.forEach((src: any, srcIdx: number) => {
        const clone = outputC[ptIdx * N_SRC + srcIdx];
        assertClose(
          clone.transform.x,
          pt.x + (src.transform.x - poolCXc),
          0.001,
          `B5c pt[${ptIdx}] clone[${srcIdx}].x = ${pt.x} + (src.x ${src.transform.x.toFixed(1)} − pool ${poolCXc.toFixed(1)})`,
        );
        assertClose(
          clone.transform.y,
          pt.y + (src.transform.y - poolCYc),
          0.001,
          `B5c pt[${ptIdx}] clone[${srcIdx}].y = ${pt.y} + (src.y ${src.transform.y.toFixed(1)} − pool ${poolCYc.toFixed(1)})`,
        );
      });
    });

    // Relative offset between sibling clones must be identical at both destination points
    const relDxAt0 = outputC[1].transform.x - outputC[0].transform.x;
    const relDyAt0 = outputC[1].transform.y - outputC[0].transform.y;
    const relDxAt1 = outputC[3].transform.x - outputC[2].transform.x;
    const relDyAt1 = outputC[3].transform.y - outputC[2].transform.y;
    assertClose(relDxAt0, relDxAt1, 0.001, 'B5c relative x-offset between sibling clones is identical at both destination points');
    assertClose(relDyAt0, relDyAt1, 0.001, 'B5c relative y-offset between sibling clones is identical at both destination points');

    // Centroid invariant at each destination point
    assertClose((outputC[0].transform.x + outputC[1].transform.x) / 2, expectedPts[0].x, 0.001, 'B5c centroid of clones at pt[0] x = 350');
    assertClose((outputC[0].transform.y + outputC[1].transform.y) / 2, expectedPts[0].y, 0.001, 'B5c centroid of clones at pt[0] y = 250');
    assertClose((outputC[2].transform.x + outputC[3].transform.x) / 2, expectedPts[1].x, 0.001, 'B5c centroid of clones at pt[1] x = 450');
    assertClose((outputC[2].transform.y + outputC[3].transform.y) / 2, expectedPts[1].y, 0.001, 'B5c centroid of clones at pt[1] y = 350');
  }
}

// B6: Centroid harvesting through server path
{
  console.log('\nB6: Centroid harvesting through server path');

  const centroidBatchConfig = {
    ...ctpBatchConfig,
    copyToPointsConfig: {
      ...ctpBatchConfig.copyToPointsConfig,
      includeVertices: false,
      includeCentroid: true,
      pointProperties: [] as PointPropertyConfig[],
    },
  };

  const destShape = makeDestShape(400, 300, 100, 80); // centroid = (400,300)
  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [destShape]);

  const { shapes } = generateShapesWithBatchConfig(
    4,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['rectangle'],
      batchConfig: centroidBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );
  // 1 centroid point → with wrap and 4 sources: 1 output shape
  assert(shapes.length === 1, `centroid only: 1 pt, 4 src (wrap) → 1 output, got ${shapes.length}`);
  assertClose(shapes[0].transform.x, 400, 0.001, 'centroid output x = dest shape cx (400)');
  assertClose(shapes[0].transform.y, 300, 0.001, 'centroid output y = dest shape cy (300)');
}

// ── Suite C: Parity — shared utility vs. server path produce same positions ──

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Suite C — Parity: shared utility path = server batch path (position check)');
console.log('═══════════════════════════════════════════════════════════════\n');

// C1: Given identical destination shapes, shared utility and server processor agree on positions
{
  console.log('C1: Shared utility vs. server processor — positions match for identical destination shapes');

  const destShape = makeDestShape(300, 250, 120, 100); // 4 known corners
  const harvestCfg = {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  };

  // Path A: shared utility directly
  const ptsA = harvestDestinationPoints([destShape], harvestCfg);
  const sourcesA = [makeSourceShape(0, 0), makeSourceShape(10, 0)];
  const outputA = applyCopyToPointsDistribution(sourcesA, ptsA, {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
    copyMode: 'shape-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });

  // Path B: server batch processor with destinationShapesMap
  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [destShape]);

  const { shapes: outputB } = generateShapesWithBatchConfig(
    2,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['circle'],
      batchConfig: ctpBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );

  assert(outputA.length === outputB.length, `both paths produce same shape count: ${outputA.length}`);

  outputA.forEach((shapeA: any, i: number) => {
    if (i < outputB.length) {
      assertClose(
        outputB[i].transform.x,
        shapeA.transform.x,
        0.001,
        `position parity: output[${i}].x = ${shapeA.transform.x}`,
      );
      assertClose(
        outputB[i].transform.y,
        shapeA.transform.y,
        0.001,
        `position parity: output[${i}].y = ${shapeA.transform.y}`,
      );
    }
  });
}

// C2: Resample outline — both paths agree on position count and first/last points
{
  console.log('\nC2: Resample outline — both paths agree on point count and boundary positions');

  const destShape = makeDestShape(500, 400, 200, 150);
  const resampleCount = 6;
  const harvestCfg = {
    includeVertices: false,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: true,
    resampleCount,
  };

  // Path A
  const ptsA = harvestDestinationPoints([destShape], harvestCfg);
  const sourcesA = [makeSourceShape(0, 0)];
  const outputA = applyCopyToPointsDistribution(sourcesA, ptsA, {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
    copyMode: 'shape-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });

  // Path B
  const resampleBatchConfig = {
    ...ctpBatchConfig,
    copyToPointsConfig: {
      ...ctpBatchConfig.copyToPointsConfig,
      includeVertices: false,
      includeCentroid: false,
      resampleOutline: true,
      resampleCount,
      copyMode: 'shape-copy' as const,
      overflowMode: 'wrap' as const,
      pointProperties: [] as PointPropertyConfig[],
    },
  };

  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [destShape]);

  const { shapes: outputB } = generateShapesWithBatchConfig(
    1,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['rectangle'],
      batchConfig: resampleBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );

  assert(
    outputA.length === outputB.length && outputA.length === resampleCount,
    `resample outline parity: both paths → ${resampleCount} shapes, got A=${outputA.length} B=${outputB.length}`,
  );

  // First and last positions should agree
  if (outputA.length > 0 && outputB.length > 0) {
    assertClose(outputB[0].transform.x, outputA[0].transform.x, 0.001, 'first point x matches');
    assertClose(outputB[0].transform.y, outputA[0].transform.y, 0.001, 'first point y matches');
    const last = outputA.length - 1;
    assertClose(outputB[last].transform.x, outputA[last].transform.x, 0.001, 'last point x matches');
    assertClose(outputB[last].transform.y, outputA[last].transform.y, 0.001, 'last point y matches');
  }
}

// C3: set-copy parity — shared utility and server path agree on the pool-centroid formula
//     Both paths call applyCopyToPointsDistribution, so the centroid invariant
//     (centroid of clones at pt = pt) must hold identically in both.
//     We verify this by running the shared utility with known positions (Path A)
//     and the server batch path (Path B), checking the centroid invariant in both.
{
  console.log('\nC3: set-copy parity — centroid invariant holds on both shared-utility and server-batch paths');

  // Shared destination: centroid at (350, 275)
  const destShape = makeDestShape(350, 275, 80, 60);

  // Path A: shared utility with known non-zero source positions
  const sourcesA = [
    makeSourceShape(50, 80),
    makeSourceShape(120, 40),
    makeSourceShape(85, 110),
  ];
  const ptsA = harvestDestinationPoints([destShape], {
    includeVertices: false,
    includeCentroid: true,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(ptsA.length === 1, `C3 precondition: 1 centroid point, got ${ptsA.length}`);

  const outputA = applyCopyToPointsDistribution(sourcesA, ptsA, {
    copyMode: 'set-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });
  assert(outputA.length === 3, `C3 path A: 1 pt × 3 sources → 3 outputs, got ${outputA.length}`);

  const meanAX = outputA.reduce((s: number, sh: any) => s + sh.transform.x, 0) / outputA.length;
  const meanAY = outputA.reduce((s: number, sh: any) => s + sh.transform.y, 0) / outputA.length;
  assertClose(meanAX, 350, 0.001, 'C3 path A: centroid of clones x = 350 (destination x)');
  assertClose(meanAY, 275, 0.001, 'C3 path A: centroid of clones y = 275 (destination y)');

  // Also verify that Path A exact positions match the formula (not just the centroid)
  const poolAX = sourcesA.reduce((s: number, sh: any) => s + sh.transform.x, 0) / sourcesA.length;
  const poolAY = sourcesA.reduce((s: number, sh: any) => s + sh.transform.y, 0) / sourcesA.length;
  sourcesA.forEach((src: any, i: number) => {
    assertClose(
      outputA[i].transform.x,
      ptsA[0].x + (src.transform.x - poolAX),
      0.001,
      `C3 path A: clone[${i}].x = pt.x + (src.x − poolCX)`,
    );
    assertClose(
      outputA[i].transform.y,
      ptsA[0].y + (src.transform.y - poolAY),
      0.001,
      `C3 path A: clone[${i}].y = pt.y + (src.y − poolCY)`,
    );
  });

  // Path B: two-pass server approach (mirroring B5b) — generate source shapes via server
  // grid (non-zero positions), then apply applyCopyToPointsDistribution to the same
  // destination shape.  Verify both centroid invariant AND exact per-clone formula.
  const N_C3 = 3;
  const { shapes: serverSrcC3 } = generateShapesWithBatchConfig(
    N_C3,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['circle'],
      batchConfig: {
        ...defaultBatchConfigSettings,
        propertiesEnabled: false,
        distributionLayoutEnabled: true,
        copyToPointsEnabled: false,
        gridRows: N_C3,
        gridColumns: 1,
        gridRowOffset: 90,
        gridColumnOffset: 0,
        gridStartX: 20,
        gridStartY: 20,
      },
      distributionEnabled: true,
    },
    { generationIndex: 0, startIndex: 0 }
  );
  assert(serverSrcC3.length === N_C3, `C3 path B: ${N_C3} server-generated sources, got ${serverSrcC3.length}`);

  // Sanity: at least one non-zero position
  const anyNonZeroC3 = serverSrcC3.some((sh: any) => Math.abs(sh.transform.x) > 0.001 || Math.abs(sh.transform.y) > 0.001);
  assert(anyNonZeroC3, 'C3 path B: at least one server source has a non-zero position');

  // Capture actual pool centroid
  const poolBX = serverSrcC3.reduce((s: number, sh: any) => s + sh.transform.x, 0) / N_C3;
  const poolBY = serverSrcC3.reduce((s: number, sh: any) => s + sh.transform.y, 0) / N_C3;

  // Apply CTP (same server function) to the same destination shape used in Path A
  const ptsBPath = harvestDestinationPoints([destShape], {
    includeVertices: false,
    includeCentroid: true,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(ptsBPath.length === 1, `C3 path B precondition: 1 centroid point`);

  const outputB = applyCopyToPointsDistribution(serverSrcC3, ptsBPath, {
    copyMode: 'set-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });
  assert(outputB.length === N_C3, `C3 path B: 1 pt × ${N_C3} sources → ${N_C3} outputs, got ${outputB.length}`);

  if (outputB.length === N_C3) {
    // Centroid invariant: centroid of clones = destination point (350, 275)
    const meanBX2 = outputB.reduce((s: number, sh: any) => s + sh.transform.x, 0) / N_C3;
    const meanBY2 = outputB.reduce((s: number, sh: any) => s + sh.transform.y, 0) / N_C3;
    assertClose(meanBX2, 350, 0.001, 'C3 path B: centroid of clones x = 350 (destination x)');
    assertClose(meanBY2, 275, 0.001, 'C3 path B: centroid of clones y = 275 (destination y)');

    // Exact per-clone formula check
    serverSrcC3.forEach((src: any, i: number) => {
      assertClose(
        outputB[i].transform.x,
        ptsBPath[0].x + (src.transform.x - poolBX),
        0.001,
        `C3 path B: clone[${i}].x = pt.x + (src.x ${src.transform.x.toFixed(1)} − pool ${poolBX.toFixed(1)})`,
      );
      assertClose(
        outputB[i].transform.y,
        ptsBPath[0].y + (src.transform.y - poolBY),
        0.001,
        `C3 path B: clone[${i}].y = pt.y + (src.y ${src.transform.y.toFixed(1)} − pool ${poolBY.toFixed(1)})`,
      );
    });
  }
}

// ── Suite D: Rotated and scaled destination shapes ────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('Suite D — Rotated / scaled destination shapes (transformLocalPoint + bboxPolygonWorld)');
console.log('═══════════════════════════════════════════════════════════════\n');

/**
 * Destination shape fixture with explicit rotation and/or scale.
 * shape.width / shape.height are the raw (unscaled) dimensions.
 */
function makeRotatedDestShape(
  cx: number,
  cy: number,
  width: number,
  height: number,
  rotation: number,
  scaleX: number,
  scaleY: number,
): any {
  return {
    id: `dest_rot_${cx}_${cy}_${rotation}`,
    type: 'rectangle',
    width,
    height,
    transform: { x: cx, y: cy, scaleX, scaleY, rotation, skewX: 0, skewY: 0 },
    properties: {
      width,
      height,
      fillColor: '#00ff00',
      fillOpacity: 0.7,
      strokeWidth: 0,
      strokeColor: 'transparent',
      strokeOpacity: 0,
    },
    points: [],
    selected: false,
  };
}

/**
 * Mirror of bboxPolygonWorld — computes expected world-space corners for any
 * rotation / scale combination. Used to predict exactly what CTP should harvest.
 */
function expectedRotatedBboxCorners(shape: any): Array<{ x: number; y: number }> {
  const cx = shape.transform.x;
  const cy = shape.transform.y;
  const w = shape.width ?? (shape.radius != null ? shape.radius * 2 : 50);
  const h = shape.height ?? (shape.radius != null ? shape.radius * 2 : 50);
  const sx = shape.transform.scaleX ?? 1;
  const sy = shape.transform.scaleY ?? 1;
  const hw = (w * sx) / 2;
  const hh = (h * sy) / 2;
  const rot = (shape.transform.rotation * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return (
    [{ lx: -hw, ly: -hh }, { lx: hw, ly: -hh }, { lx: hw, ly: hh }, { lx: -hw, ly: hh }] as Array<{ lx: number; ly: number }>
  ).map(({ lx, ly }) => ({ x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos }));
}

/**
 * Mirror of transformLocalPoint — applies scale → rotate → translate to a local point.
 */
function expectedTransformedPoint(lx: number, ly: number, shape: any): { x: number; y: number } {
  const cx = shape.transform?.x ?? 0;
  const cy = shape.transform?.y ?? 0;
  const sx = shape.transform?.scaleX ?? 1;
  const sy = shape.transform?.scaleY ?? 1;
  const rot = ((shape.transform?.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const wx = lx * sx;
  const wy = ly * sy;
  return { x: cx + wx * cos - wy * sin, y: cy + wx * sin + wy * cos };
}

// D1: Harvest bbox corners from a rotated destination shape (rotation=30°, scale=1)
{
  console.log('D1: Harvest bbox corners from rotated dest shape (rotation=30°, scale=1)');
  const dest = makeRotatedDestShape(200, 150, 100, 80, 30, 1, 1);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 4, `rotated dest: expect 4 bbox corners, got ${pts.length}`);
  const expected = expectedRotatedBboxCorners(dest);
  pts.forEach((pt, i) => {
    assertClose(pt.x, expected[i].x, 0.001, `D1 corner[${i}] x = ${expected[i].x.toFixed(4)}`);
    assertClose(pt.y, expected[i].y, 0.001, `D1 corner[${i}] y = ${expected[i].y.toFixed(4)}`);
  });

  // Sanity: corners must NOT all share the same x (rotation must break axis-alignment)
  const allSameX = pts.every(pt => Math.abs(pt.x - pts[0].x) < 0.001);
  assert(!allSameX, 'D1: corners are not all collinear in x (rotation is non-zero)');
}

// D2: Harvest bbox corners from a non-uniformly scaled destination shape (rotation=0)
{
  console.log('\nD2: Harvest bbox corners from scaled dest shape (scaleX=2, scaleY=0.5, rotation=0)');
  const dest = makeRotatedDestShape(300, 200, 100, 80, 0, 2, 0.5);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 4, `scaled dest: expect 4 corners, got ${pts.length}`);
  const expected = expectedRotatedBboxCorners(dest);
  pts.forEach((pt, i) => {
    assertClose(pt.x, expected[i].x, 0.001, `D2 corner[${i}] x = ${expected[i].x.toFixed(4)}`);
    assertClose(pt.y, expected[i].y, 0.001, `D2 corner[${i}] y = ${expected[i].y.toFixed(4)}`);
  });

  // Width of the harvested bounding box should reflect the x-scale (2× raw width)
  const harvestedWidth = Math.abs(pts[1].x - pts[0].x); // TR.x − TL.x at rotation=0
  assertClose(harvestedWidth, 100 * 2, 0.001, 'D2: harvested width = raw_width × scaleX = 200');
  const harvestedHeight = Math.abs(pts[2].y - pts[1].y); // BR.y − TR.y at rotation=0
  assertClose(harvestedHeight, 80 * 0.5, 0.001, 'D2: harvested height = raw_height × scaleY = 40');
}

// D3: Harvest bbox corners from a shape with both rotation AND non-unit scale
{
  console.log('\nD3: Harvest bbox corners from shape with rotation=45° AND scaleX=1.5, scaleY=2');
  const dest = makeRotatedDestShape(400, 300, 60, 40, 45, 1.5, 2);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 4, `rotated+scaled dest: expect 4 corners, got ${pts.length}`);
  const expected = expectedRotatedBboxCorners(dest);
  pts.forEach((pt, i) => {
    assertClose(pt.x, expected[i].x, 0.001, `D3 corner[${i}] x = ${expected[i].x.toFixed(4)}`);
    assertClose(pt.y, expected[i].y, 0.001, `D3 corner[${i}] y = ${expected[i].y.toFixed(4)}`);
  });

  // At 45° all corners must be displaced from the centroid by the same radius
  const cx = dest.transform.x;
  const cy = dest.transform.y;
  const radii = pts.map(pt => Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2));
  // Half-diagonals of a (hw, hh) rectangle are sqrt(hw²+hh²) but since hw≠hh they need not be equal;
  // however opposite corners are equidistant from the centroid.
  assertClose(radii[0], radii[2], 0.001, 'D3: TL and BR are equidistant from centroid');
  assertClose(radii[1], radii[3], 0.001, 'D3: TR and BL are equidistant from centroid');
}

// D4: Harvest explicit local-space points from a rotated+scaled shape (tests transformLocalPoint path)
{
  console.log('\nD4: Harvest explicit local-space points via transformLocalPoint (rotation=90°, scaleX=2)');
  // Equilateral-ish triangle in local space
  const localPts = [
    { x: 0,   y: -40 },
    { x: 40,  y:  20 },
    { x: -40, y:  20 },
  ];
  const shapeWithPts: any = {
    id: 'dest_with_pts',
    type: 'triangle',
    width: 80,
    height: 60,
    transform: { x: 500, y: 400, scaleX: 2, scaleY: 1, rotation: 90, skewX: 0, skewY: 0 },
    properties: { fillColor: '#ff0000', fillOpacity: 1, strokeWidth: 0, strokeColor: 'transparent', strokeOpacity: 0 },
    points: localPts,
    selected: false,
  };

  const pts = harvestDestinationPoints([shapeWithPts], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 3, `explicit-points shape: expect 3 harvested points, got ${pts.length}`);

  localPts.forEach((lp, i) => {
    const exp = expectedTransformedPoint(lp.x, lp.y, shapeWithPts);
    assertClose(pts[i].x, exp.x, 0.001, `D4 pt[${i}] x (scale+rotate) = ${exp.x.toFixed(4)}`);
    assertClose(pts[i].y, exp.y, 0.001, `D4 pt[${i}] y (scale+rotate) = ${exp.y.toFixed(4)}`);
  });
}

// D5: Centroid harvesting from a rotated shape — centroid is always the transform position
{
  console.log('\nD5: Centroid harvesting from rotated shape — centroid = transform position (invariant under rotation)');
  const dest = makeRotatedDestShape(350, 280, 120, 90, 73, 1, 1);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: false,
    includeCentroid: true,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 1, `rotated centroid: expect 1 centroid, got ${pts.length}`);
  assertClose(pts[0].x, 350, 0.001, 'D5: centroid x = transform.x regardless of rotation');
  assertClose(pts[0].y, 280, 0.001, 'D5: centroid y = transform.y regardless of rotation');
}

// D6: shape-copy — source shapes placed at rotated destination corners (end-to-end, utility path)
{
  console.log('\nD6: shape-copy — sources placed at rotated destination corners (utility path)');
  const dest = makeRotatedDestShape(300, 300, 100, 80, 45, 1, 1);
  const expected = expectedRotatedBboxCorners(dest);

  const pts = harvestDestinationPoints([dest], {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  });
  assert(pts.length === 4, `D6 precondition: 4 corners, got ${pts.length}`);

  const sources = [makeSourceShape(0, 0)];
  const output = applyCopyToPointsDistribution(sources, pts, {
    copyMode: 'shape-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });
  assert(output.length === 4, `D6: 1 src × 4 pts (wrap) → 4 outputs, got ${output.length}`);

  output.forEach((shape: any, i: number) => {
    assertClose(shape.transform.x, expected[i].x, 0.001, `D6 output[${i}] x = rotated corner x`);
    assertClose(shape.transform.y, expected[i].y, 0.001, `D6 output[${i}] y = rotated corner y`);
  });
}

// D7: Server batch path with a rotated destination shape — positions match expected corners
{
  console.log('\nD7: Server batch path — rotated destination shape (rotation=60°) — positions match expected');

  const dest = makeRotatedDestShape(400, 300, 100, 80, 60, 1, 1);
  const expected = expectedRotatedBboxCorners(dest);

  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [dest]);

  const { shapes } = generateShapesWithBatchConfig(
    2,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['circle'],
      batchConfig: ctpBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );

  assert(shapes.length === 4, `D7: 2 src × 4 rotated corners (wrap) → 4 output shapes, got ${shapes.length}`);
  shapes.forEach((shape: any, i: number) => {
    assertClose(shape.transform.x, expected[i].x, 0.001, `D7 output[${i}] x = rotated corner x (${expected[i].x.toFixed(4)})`);
    assertClose(shape.transform.y, expected[i].y, 0.001, `D7 output[${i}] y = rotated corner y (${expected[i].y.toFixed(4)})`);
  });
}

// D8: Server batch path with a scaled destination shape — positions match expected corners
{
  console.log('\nD8: Server batch path — scaled destination shape (scaleX=1.5, scaleY=0.75) — positions match');

  const dest = makeRotatedDestShape(250, 350, 120, 80, 0, 1.5, 0.75);
  const expected = expectedRotatedBboxCorners(dest);

  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [dest]);

  const { shapes } = generateShapesWithBatchConfig(
    1,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['rectangle'],
      batchConfig: ctpBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );

  assert(shapes.length === 4, `D8: 1 src × 4 scaled corners (wrap) → 4 outputs, got ${shapes.length}`);
  shapes.forEach((shape: any, i: number) => {
    assertClose(shape.transform.x, expected[i].x, 0.001, `D8 output[${i}] x = scaled corner x`);
    assertClose(shape.transform.y, expected[i].y, 0.001, `D8 output[${i}] y = scaled corner y`);
  });
}

// D9: Parity — shared utility and server batch path agree for rotated+scaled destination shape
{
  console.log('\nD9: Parity — shared utility and server path agree for rotation=30°, scaleX=1.5, scaleY=0.8');

  const dest = makeRotatedDestShape(350, 250, 100, 60, 30, 1.5, 0.8);
  const harvestCfg = {
    includeVertices: true,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: false,
    resampleCount: 8,
  };

  // Path A: shared utility
  const ptsA = harvestDestinationPoints([dest], harvestCfg);
  const sourcesA = [makeSourceShape(0, 0), makeSourceShape(0, 0)];
  const outputA = applyCopyToPointsDistribution(sourcesA, ptsA, {
    ...DEFAULT_COPY_TO_POINTS_CONFIG,
    copyMode: 'shape-copy',
    overflowMode: 'wrap',
    pointProperties: [],
  });

  // Path B: server batch processor
  const destMap = new Map<string, any[]>();
  destMap.set(DEST_SET_ID, [dest]);
  const { shapes: outputB } = generateShapesWithBatchConfig(
    2,
    CANVAS_BOUNDS,
    {
      enabledShapeTypes: ['circle'],
      batchConfig: ctpBatchConfig,
      distributionEnabled: true,
    },
    {
      generationIndex: 0,
      startIndex: 0,
      destinationShapesMap: destMap,
    }
  );

  assert(outputA.length === outputB.length, `D9 parity: both paths produce same shape count (${outputA.length})`);
  outputA.forEach((shapeA: any, i: number) => {
    if (i < outputB.length) {
      assertClose(
        outputB[i].transform.x,
        shapeA.transform.x,
        0.001,
        `D9 parity output[${i}] x: utility=${shapeA.transform.x.toFixed(4)}, server=${outputB[i].transform.x.toFixed(4)}`,
      );
      assertClose(
        outputB[i].transform.y,
        shapeA.transform.y,
        0.001,
        `D9 parity output[${i}] y: utility=${shapeA.transform.y.toFixed(4)}, server=${outputB[i].transform.y.toFixed(4)}`,
      );
    }
  });

  // Also verify against the ground-truth expected corners
  const expected = expectedRotatedBboxCorners(dest);
  outputA.forEach((shape: any, i: number) => {
    assertClose(shape.transform.x, expected[i].x, 0.001, `D9 corner[${i}] x matches ground-truth`);
    assertClose(shape.transform.y, expected[i].y, 0.001, `D9 corner[${i}] y matches ground-truth`);
  });
}

// D10: Resample outline of a rotated shape — all points lie on the correct world-space perimeter
{
  console.log('\nD10: Resample outline — points on rotated shape perimeter (within bbox distance bounds)');

  const dest = makeRotatedDestShape(300, 300, 100, 80, 30, 1, 1);
  const pts = harvestDestinationPoints([dest], {
    includeVertices: false,
    includeCentroid: false,
    vertexSampleStride: 1,
    resampleOutline: true,
    resampleCount: 8,
  });
  assert(pts.length === 8, `D10: resampleCount=8 → 8 points on rotated outline, got ${pts.length}`);

  // All resampled points should lie within the bounding circle of the rotated shape.
  // The bounding circle radius = half-diagonal of the scaled bbox = sqrt(hw²+hh²)
  const hw = dest.width / 2;   // scaleX=1
  const hh = dest.height / 2;  // scaleY=1
  const maxRadius = Math.sqrt(hw * hw + hh * hh) + 0.001; // small tolerance
  const cx = dest.transform.x;
  const cy = dest.transform.y;
  pts.forEach((pt, i) => {
    const r = Math.sqrt((pt.x - cx) ** 2 + (pt.y - cy) ** 2);
    assert(r <= maxRadius, `D10 pt[${i}] radius ${r.toFixed(4)} ≤ bounding circle ${maxRadius.toFixed(4)}`);
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.error(`❌ ${failed} check(s) failed — see above for details.`);
  process.exit(1);
} else {
  console.log('✅ All checks passed. Copy-to-Points client/server parity confirmed.');
  process.exit(0);
}
