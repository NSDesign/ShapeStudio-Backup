import type { BatchConfigSettings } from '@shared/schema';
import type { Shape } from './shapes';

type Reference = BatchConfigSettings['transformOriginShapeReference'];
type Anchor = BatchConfigSettings['transformOriginShapeAnchor'];

/** Resolve a shape anchor in canvas coordinates, falling back to the current shape. */
export function resolveShapeReferenceOrigin(
  shapes: Shape[],
  index: number,
  reference: Reference,
  anchor: Anchor,
  specificIndex = 0,
): { x: number; y: number } {
  const current = shapes[index];
  let targetIndex: number;
  switch (reference) {
    case 'first': targetIndex = 0; break;
    case 'last': targetIndex = shapes.length - 1; break;
    case 'previous': targetIndex = index - 1; break;
    case 'next': targetIndex = index + 1; break;
    case 'specific': targetIndex = specificIndex; break;
    default: targetIndex = index;
  }
  const target = shapes[targetIndex] ?? current;
  const bounds = target.getWorldBounds();
  const xFactor = anchor.endsWith('left') ? 0 : anchor.endsWith('right') ? 1 : 0.5;
  const yFactor = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 1 : 0.5;
  return { x: bounds.x + bounds.width * xFactor, y: bounds.y + bounds.height * yFactor };
}

/** Process neighbours before the shapes that reference them. */
export function applyShapeTransformsInReferenceOrder(
  shapes: Shape[],
  reference: Reference,
  apply: (shape: Shape, index: number) => void,
): void {
  if (reference === 'next' || reference === 'last') {
    for (let i = shapes.length - 1; i >= 0; i--) apply(shapes[i], i);
  } else {
    shapes.forEach(apply);
  }
}