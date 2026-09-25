import { Shape } from './shapes';
import { GeometricIntersection } from './geometricIntersection';

export class BooleanOperations {
  /**
   * Non-destructive boolean operation using geometric approximation
   */
  static applyBooleanOperation(
    sourceShape: Shape,
    targetShape: Shape,
    operation: 'union' | 'subtract' | 'intersect' | 'exclude'
  ): Shape | null {
    try {
      // Check if shapes have overlapping compatibility for geometric operations
      const canUseGeometric = this.canPerformGeometricOperation(sourceShape, targetShape);
      
      // Check if shapes actually overlap before proceeding
      if (!this.shapesOverlap(sourceShape, targetShape)) {
        console.warn(`Cannot perform ${operation}: shapes do not intersect`);
        return null;
      }
      
      if (canUseGeometric) {
        // Use geometric operations for all polygon-based shapes
        return GeometricIntersection.performGeometricBooleanOperation(sourceShape, targetShape, operation);
      } else {
        // Fallback to canvas-based operations for unsupported shapes
        return this.performCanvasBooleanOperation(sourceShape, targetShape, operation);
      }
    } catch (error) {
      console.warn('Boolean operation failed:', error);
      return null;
    }
  }

  private static performCanvasBooleanOperation(
    sourceShape: Shape,
    targetShape: Shape,
    operation: 'union' | 'subtract' | 'intersect' | 'exclude'
  ): Shape | null {
    // Calculate bounds for both shapes with padding
    const sourceBounds = sourceShape.getBounds();
    const targetBounds = targetShape.getBounds();
    
    const minX = Math.min(sourceBounds.x, targetBounds.x) - 20;
    const minY = Math.min(sourceBounds.y, targetBounds.y) - 20;
    const maxX = Math.max(sourceBounds.x + sourceBounds.width, targetBounds.x + targetBounds.width) + 20;
    const maxY = Math.max(sourceBounds.y + sourceBounds.height, targetBounds.y + targetBounds.height) + 20;
    
    const canvasWidth = maxX - minX;
    const canvasHeight = maxY - minY;
    
    // Create temporary canvas for the boolean operation
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Translate context to handle coordinates
    ctx.translate(-minX, -minY);
    
    // Draw source shape first
    this.drawShapeOnCanvas(ctx, sourceShape);
    
    // Set composite operation and draw target shape
    ctx.globalCompositeOperation = this.getCompositeOperation(operation);
    this.drawShapeOnCanvas(ctx, targetShape);
    
    // Extract the result outline and create new shape
    const resultShape = this.createResultShape(sourceShape, targetShape, operation, ctx, minX, minY, canvasWidth, canvasHeight);
    
    return resultShape;
  }

  private static getCompositeOperation(operation: 'union' | 'subtract' | 'intersect' | 'exclude'): GlobalCompositeOperation {
    switch (operation) {
      case 'union':
        return 'source-over';
      case 'subtract':
        return 'destination-out';
      case 'intersect':
        return 'source-in';
      case 'exclude':
        return 'xor';
      default:
        return 'source-over';
    }
  }

  private static drawShapeOnCanvas(ctx: CanvasRenderingContext2D, shape: Shape): void {
    ctx.save();
    
    // Apply transformations
    ctx.translate(shape.transform.x, shape.transform.y);
    ctx.rotate((shape.transform.rotation * Math.PI) / 180);
    ctx.scale(shape.transform.scaleX, shape.transform.scaleY);
    
    // Set fill style
    ctx.fillStyle = shape.properties.fillColor;
    
    // Draw shape based on type
    ctx.beginPath();
    switch (shape.type) {
      case 'rectangle':
      case 'square':
        if (shape.width && shape.height) {
          ctx.rect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
        }
        break;
      case 'circle':
        if (shape.radius) {
          ctx.arc(0, 0, shape.radius, 0, Math.PI * 2);
        }
        break;
      case 'ellipse':
        if (shape.width && shape.height) {
          ctx.ellipse(0, 0, shape.width / 2, shape.height / 2, 0, 0, Math.PI * 2);
        }
        break;
      case 'polygon':
      case 'star':
        if (shape.points && shape.points.length > 0) {
          const points = shape.points;
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          ctx.closePath();
        }
        break;
    }
    
    ctx.fill();
    ctx.restore();
  }

  private static createResultShape(
    sourceShape: Shape,
    targetShape: Shape,
    operation: 'union' | 'subtract' | 'intersect' | 'exclude',
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    canvasWidth: number,
    canvasHeight: number
  ): Shape | null {
    // Create result shape maintaining original properties
    const result = new Shape('blob');
    result.id = `${sourceShape.id}_${operation}_${targetShape.id}`;
    
    // Position result shape at source shape's location to maintain position
    result.transform.x = sourceShape.transform.x;
    result.transform.y = sourceShape.transform.y;
    result.transform.rotation = sourceShape.transform.rotation;
    result.transform.scaleX = sourceShape.transform.scaleX;
    result.transform.scaleY = sourceShape.transform.scaleY;
    
    // Copy properties from source shape
    result.properties = { ...sourceShape.properties };
    
    // Generate outline points by tracing the canvas result
    result.points = this.traceCanvasOutline(ctx, offsetX, offsetY, canvasWidth, canvasHeight);
    
    // Handle edge cases
    if (operation === 'subtract' && result.points.length < 3) {
      return null; // Nothing left after subtraction
    }
    
    if (operation === 'intersect' && result.points.length < 3) {
      return null; // No intersection
    }
    
    return result;
  }

  private static traceCanvasOutline(
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    width: number,
    height: number
  ): Array<{ x: number; y: number }> {
    // Get image data from canvas
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // Find outline points by edge detection
    const points: Array<{ x: number; y: number }> = [];
    const step = Math.max(2, Math.floor(Math.min(width, height) / 32)); // Adaptive sampling
    
    // Trace outline by finding edge pixels
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const index = (y * width + x) * 4;
        const alpha = data[index + 3];
        
        // Check if this pixel is on the edge (has alpha but neighbor doesn't)
        if (alpha > 0) {
          const isEdge = this.isEdgePixel(data, x, y, width, height);
          if (isEdge) {
            points.push({
              x: x + offsetX,
              y: y + offsetY
            });
          }
        }
      }
    }
    
    // If no edge points found, create a simple fallback outline
    if (points.length < 3) {
      const centerX = offsetX + width / 2;
      const centerY = offsetY + height / 2;
      const radius = Math.min(width, height) / 4;
      
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2;
        points.push({
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius
        });
      }
    }
    
    // Sort points to create a proper outline
    return this.sortPointsForOutline(points);
  }

  private static isEdgePixel(
    data: Uint8ClampedArray,
    x: number,
    y: number,
    width: number,
    height: number
  ): boolean {
    const index = (y * width + x) * 4;
    const alpha = data[index + 3];
    
    if (alpha === 0) return false;
    
    // Check neighbors
    const neighbors = [
      [-1, 0], [1, 0], [0, -1], [0, 1]
    ];
    
    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const neighborIndex = (ny * width + nx) * 4;
        const neighborAlpha = data[neighborIndex + 3];
        
        if (neighborAlpha === 0) {
          return true; // Edge pixel
        }
      }
    }
    
    return false;
  }

  private static sortPointsForOutline(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (points.length < 3) return points;
    
    // Find centroid
    const centerX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const centerY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    
    // Sort by angle from center
    return points.sort((a, b) => {
      const angleA = Math.atan2(a.y - centerY, a.x - centerX);
      const angleB = Math.atan2(b.y - centerY, b.x - centerX);
      return angleA - angleB;
    });
  }

  /**
   * Check if shapes can use geometric operations (have points and are closed polygons)
   */
  static canPerformGeometricOperation(shape1: Shape, shape2: Shape): boolean {
    // Check if both shapes have points
    if (!shape1.points || !shape2.points || shape1.points.length === 0 || shape2.points.length === 0) {
      return false;
    }
    
    // Exclude line shapes (they're not closed polygons)
    if (shape1.type === 'line' || shape2.type === 'line') {
      return false;
    }
    
    // Support all other polygon-based shapes
    const supportedTypes = ['rectangle', 'rounded-rectangle', 'square', 'rounded-square', 'circle', 'ellipse', 'polygon', 'star', 'ring', 'blob', 'spline-circle', 'spline-ellipse', 'spline-ring', 'cubic', 'bezier'];
    
    return supportedTypes.includes(shape1.type) && supportedTypes.includes(shape2.type);
  }

  /**
   * Check if two shapes overlap (useful for boolean operation previews)
   */
  static shapesOverlap(shape1: Shape, shape2: Shape): boolean {
    const bounds1 = shape1.getBounds();
    const bounds2 = shape2.getBounds();

    return !(
      bounds1.x + bounds1.width < bounds2.x ||
      bounds2.x + bounds2.width < bounds1.x ||
      bounds1.y + bounds1.height < bounds2.y ||
      bounds2.y + bounds2.height < bounds1.y
    );
  }

  /**
   * Get all shapes that could be boolean operation targets for a given shape
   */
  static getPotentialTargets(sourceShape: Shape, allShapes: Shape[]): Shape[] {
    return allShapes.filter(shape => 
      shape.id !== sourceShape.id && 
      this.shapesOverlap(sourceShape, shape) &&
      this.canPerformBooleanOperation(sourceShape.type, shape.type)
    );
  }

  private static canPerformBooleanOperation(type1: string, type2: string): boolean {
    // Boolean operations work best with closed shapes
    const supportedTypes = ['rectangle', 'square', 'circle', 'ellipse', 'polygon', 'star'];
    return supportedTypes.includes(type1) && supportedTypes.includes(type2);
  }
}