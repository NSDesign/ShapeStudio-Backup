import { Shape } from './shapes';
import { Point } from './shapeTypes';

export interface LineSegment {
  start: Point;
  end: Point;
}

export interface IntersectionPoint extends Point {
  t1: number; // Parameter on first curve/line (0-1)
  t2: number; // Parameter on second curve/line (0-1)
  onShape1: boolean;
  onShape2: boolean;
}

export class GeometricIntersection {
  // Store intersection points for visual debugging
  private static debugIntersections: Point[] = [];
  
  /**
   * Get intersection points for visual debugging
   */
  static getDebugIntersections(): Point[] {
    return this.debugIntersections;
  }
  
  /**
   * Clear debug intersection points
   */
  static clearDebugIntersections(): void {
    this.debugIntersections = [];
  }
  
  /**
   * Get intersection points between two shapes for debugging
   */
  static getIntersectionPoints(shape1: Shape, shape2: Shape): Point[] {
    this.debugIntersections = [];
    
    try {
      const intersections = this.findShapeIntersections(shape1, shape2);
      this.debugIntersections = intersections.map(i => ({ x: i.x, y: i.y }));
      

    } catch (error) {
      console.warn('Error finding intersections:', error);
    }
    
    return this.debugIntersections;
  }
  
  /**
   * Find all intersection points between two shapes
   */
  static findShapeIntersections(shape1: Shape, shape2: Shape): IntersectionPoint[] {
    const edges1 = this.getShapeEdges(shape1);
    const edges2 = this.getShapeEdges(shape2);
    const intersections: IntersectionPoint[] = [];

    // Edges are already in world coordinates from getShapeEdges
    for (let i = 0; i < edges1.length; i++) {
      for (let j = 0; j < edges2.length; j++) {
        const intersection = this.findLineIntersection(edges1[i], edges2[j]);
        if (intersection) {
          intersections.push({
            ...intersection,
            onShape1: true,
            onShape2: true
          });
        }
      }
    }

    return intersections;
  }

  /**
   * Get edge segments from a shape using actual transformed points
   */
  private static getShapeEdges(shape: Shape): LineSegment[] {
    const edges: LineSegment[] = [];
    
    // Use the actual points that represent the visual shape
    if (shape.points && shape.points.length > 0) {
      // Get world-transformed points directly
      const worldPoints: Point[] = [];
      for (let i = 0; i < shape.points.length; i++) {
        const worldPoint = shape.getWorldPoint(i);
        if (worldPoint) {
          worldPoints.push(worldPoint);
        }
      }
      
      // Create edges from consecutive world points
      const numSegments = shape.closed ? worldPoints.length : worldPoints.length - 1;
      for (let i = 0; i < numSegments; i++) {
        const start = worldPoints[i];
        const end = worldPoints[(i + 1) % worldPoints.length];
        edges.push({ start, end });
      }
    } else {
      // Fallback to original geometry-based approach for shapes without points
      switch (shape.type) {
        case 'rectangle':
        case 'square':
          edges.push(...this.getRectangleEdges(shape));
          break;
        case 'circle':
          edges.push(...this.getCircleEdges(shape));
          break;
        case 'ellipse':
          edges.push(...this.getEllipseEdges(shape));
          break;
      }
      
      // Transform edges to world coordinates
      return this.transformEdges(edges, shape);
    }

    return edges;
  }

  /**
   * Get rectangle edges
   */
  private static getRectangleEdges(shape: Shape): LineSegment[] {
    const w = (shape.width || 100) / 2;
    const h = (shape.height || 100) / 2;
    
    return [
      { start: { x: -w, y: -h }, end: { x: w, y: -h } }, // Top
      { start: { x: w, y: -h }, end: { x: w, y: h } },   // Right
      { start: { x: w, y: h }, end: { x: -w, y: h } },   // Bottom
      { start: { x: -w, y: h }, end: { x: -w, y: -h } }  // Left
    ];
  }

  /**
   * Get circle edges (approximated as polygon)
   */
  private static getCircleEdges(shape: Shape): LineSegment[] {
    const radius = shape.radius || 50;
    const segments = shape.segments || 32; // Use shape's actual segment count
    const edges: LineSegment[] = [];
    
    for (let i = 0; i < segments; i++) {
      const angle1 = (i / segments) * Math.PI * 2;
      const angle2 = ((i + 1) / segments) * Math.PI * 2;
      
      edges.push({
        start: {
          x: Math.cos(angle1) * radius,
          y: Math.sin(angle1) * radius
        },
        end: {
          x: Math.cos(angle2) * radius,
          y: Math.sin(angle2) * radius
        }
      });
    }
    
    return edges;
  }

  /**
   * Get ellipse edges (approximated as polygon)
   */
  private static getEllipseEdges(shape: Shape): LineSegment[] {
    const rx = (shape.width || 100) / 2;
    const ry = (shape.height || 100) / 2;
    const segments = shape.segments || 32; // Use shape's actual segment count
    const edges: LineSegment[] = [];
    
    for (let i = 0; i < segments; i++) {
      const angle1 = (i / segments) * Math.PI * 2;
      const angle2 = ((i + 1) / segments) * Math.PI * 2;
      
      edges.push({
        start: {
          x: Math.cos(angle1) * rx,
          y: Math.sin(angle1) * ry
        },
        end: {
          x: Math.cos(angle2) * rx,
          y: Math.sin(angle2) * ry
        }
      });
    }
    
    return edges;
  }

  /**
   * Get polygon edges
   */
  private static getPolygonEdges(points: Point[]): LineSegment[] {
    const edges: LineSegment[] = [];
    
    for (let i = 0; i < points.length; i++) {
      const next = (i + 1) % points.length;
      edges.push({
        start: points[i],
        end: points[next]
      });
    }
    
    return edges;
  }

  /**
   * Transform edges by shape transform
   */
  private static transformEdges(edges: LineSegment[], shape: Shape): LineSegment[] {
    const { transform } = shape;
    
    return edges.map(edge => ({
      start: this.transformPoint(edge.start, transform),
      end: this.transformPoint(edge.end, transform)
    }));
  }

  /**
   * Transform a point by shape transform
   */
  private static transformPoint(point: Point, transform: any): Point {
    // Apply scale
    let x = point.x * transform.scaleX;
    let y = point.y * transform.scaleY;
    
    // Apply rotation
    if (transform.rotation !== 0) {
      const cos = Math.cos(transform.rotation * Math.PI / 180);
      const sin = Math.sin(transform.rotation * Math.PI / 180);
      const newX = x * cos - y * sin;
      const newY = x * sin + y * cos;
      x = newX;
      y = newY;
    }
    
    // Apply translation
    x += transform.x;
    y += transform.y;
    
    return { x, y };
  }

  /**
   * Find intersection between two line segments
   */
  private static findLineIntersection(line1: LineSegment, line2: LineSegment): IntersectionPoint | null {
    const { start: p1, end: p2 } = line1;
    const { start: p3, end: p4 } = line2;
    
    const x1 = p1.x, y1 = p1.y;
    const x2 = p2.x, y2 = p2.y;
    const x3 = p3.x, y3 = p3.y;
    const x4 = p4.x, y4 = p4.y;
    
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    
    if (Math.abs(denom) < 1e-10) {
      return null; // Lines are parallel
    }
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    // Check if intersection is within both line segments
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      return {
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1),
        t1: t,
        t2: u,
        onShape1: true,
        onShape2: true
      };
    }
    
    return null;
  }

  /**
   * Perform geometric boolean operation for any polygon-based shapes
   */
  static performGeometricBooleanOperation(shape1: Shape, shape2: Shape, operation: 'union' | 'subtract' | 'intersect' | 'exclude'): Shape | null {
    // Check if both shapes have points (all shapes should have points after initialization)
    if (!shape1.points || !shape2.points || shape1.points.length === 0 || shape2.points.length === 0) {
      console.warn(`Cannot perform ${operation} on shapes without points`);
      return null;
    }
    
    // Use generalized polygon operations that work for any point-based shapes
    switch (operation) {
      case 'union':
        return this.performGeneralPolygonUnion(shape1, shape2);
      case 'subtract':
        return this.performGeneralPolygonSubtract(shape1, shape2);
      case 'intersect':
        return this.performGeneralPolygonIntersect(shape1, shape2);
      case 'exclude':
        return this.performGeneralPolygonExclude(shape1, shape2);
      default:
        return null;
    }
  }

  /**
   * Perform geometric union operation for any polygon-based shapes
   */
  static performGeometricUnion(shape1: Shape, shape2: Shape): Shape | null {
    return this.performGeometricBooleanOperation(shape1, shape2, 'union');
  }

  /**
   * Perform generalized union operation for any polygon-based shapes
   */
  static performGeneralPolygonUnion(shape1: Shape, shape2: Shape): Shape | null {
    // Get world-transformed vertices for both shapes
    const vertices1 = this.getWorldVerticesFromShape(shape1);
    const vertices2 = this.getWorldVerticesFromShape(shape2);
    
    // Find intersection points between the shapes
    const intersections = this.findShapeIntersections(shape1, shape2);
    
    if (intersections.length === 0) {
      // No intersections - shapes don't overlap, return convex hull
      const allVertices = [...vertices1, ...vertices2];
      const unionVertices = this.convexHull(allVertices);
      return this.createPolygonFromVertices(unionVertices, shape1, shape2, 'union');
    }
    
    // Build union outline using general polygon algorithm
    const unionVertices = this.buildGeneralPolygonUnionOutline(vertices1, vertices2, intersections);
    return this.createPolygonFromVertices(unionVertices, shape1, shape2, 'union');
  }

  /**
   * Get world-transformed vertices from any shape
   */
  private static getWorldVerticesFromShape(shape: Shape): Point[] {
    if (!shape.points) return [];
    
    const worldVertices: Point[] = [];
    for (let i = 0; i < shape.points.length; i++) {
      const worldPoint = shape.getWorldPoint(i);
      if (worldPoint) {
        worldVertices.push(worldPoint);
      }
    }
    return worldVertices;
  }

  /**
   * Build union outline for general polygons
   */
  private static buildGeneralPolygonUnionOutline(
    vertices1: Point[],
    vertices2: Point[],
    intersections: IntersectionPoint[]
  ): Point[] {
    if (intersections.length === 0) {
      return this.convexHull([...vertices1, ...vertices2]);
    }

    // Get all candidate points
    const allPoints = [...vertices1, ...vertices2, ...intersections];
    const uniquePoints = this.removeDuplicatePoints(allPoints);
    
    // Filter to keep only exterior points for union operation
    const exteriorPoints = uniquePoints.filter(point => {
      const strictlyInsideShape1 = this.isPointStrictlyInsidePolygon(point, vertices1);
      const strictlyInsideShape2 = this.isPointStrictlyInsidePolygon(point, vertices2);
      const isIntersectionPoint = intersections.some(ip => 
        Math.abs(ip.x - point.x) < 0.01 && Math.abs(ip.y - point.y) < 0.01
      );
      
      // For union: keep points that are:
      // 1. Intersection points (always on boundary)
      // 2. Shape vertices that are not strictly inside the other shape
      if (isIntersectionPoint) {
        return true;
      }
      
      const isShape1Vertex = vertices1.some(v => 
        Math.abs(v.x - point.x) < 0.01 && Math.abs(v.y - point.y) < 0.01
      );
      const isShape2Vertex = vertices2.some(v => 
        Math.abs(v.x - point.x) < 0.01 && Math.abs(v.y - point.y) < 0.01
      );
      
      if (isShape1Vertex) {
        return !strictlyInsideShape2;
      }
      if (isShape2Vertex) {
        return !strictlyInsideShape1;
      }
      
      return false;
    });
    
    // Sort points by angle from centroid to create proper outline
    const centroid = this.calculateCentroid(exteriorPoints);
    return exteriorPoints.sort((a, b) => {
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
      return angleA - angleB;
    });
  }

  /**
   * Check if point is strictly inside a general polygon using ray casting
   */
  private static isPointStrictlyInsidePolygon(point: Point, polygonVertices: Point[]): boolean {
    if (polygonVertices.length < 3) return false;
    
    let inside = false;
    const rayEnd = { x: point.x + 10000, y: point.y };
    
    for (let i = 0; i < polygonVertices.length; i++) {
      const edge = {
        start: polygonVertices[i],
        end: polygonVertices[(i + 1) % polygonVertices.length]
      };
      
      const intersection = this.findLineIntersection(
        { start: point, end: rayEnd },
        edge
      );
      
      if (intersection) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  /**
   * Perform generalized subtract operation for any polygon-based shapes
   */
  static performGeneralPolygonSubtract(shape1: Shape, shape2: Shape): Shape | null {
    // Get world-transformed vertices for both shapes
    const vertices1 = this.getWorldVerticesFromShape(shape1);
    const vertices2 = this.getWorldVerticesFromShape(shape2);
    
    // Find intersection points between the shapes
    const intersections = this.findShapeIntersections(shape1, shape2);
    
    if (intersections.length === 0) {
      // No intersections - return original shape1
      return this.createPolygonFromVertices(vertices1, shape1, shape2, 'subtract');
    }
    
    // Build subtract outline
    const subtractVertices = this.buildGeneralPolygonSubtractOutline(vertices1, vertices2, intersections);
    return this.createPolygonFromVertices(subtractVertices, shape1, shape2, 'subtract');
  }

  /**
   * Perform generalized intersect operation for any polygon-based shapes
   */
  static performGeneralPolygonIntersect(shape1: Shape, shape2: Shape): Shape | null {
    // Get world-transformed vertices for both shapes
    const vertices1 = this.getWorldVerticesFromShape(shape1);
    const vertices2 = this.getWorldVerticesFromShape(shape2);
    
    // Find intersection points between the shapes
    const intersections = this.findShapeIntersections(shape1, shape2);
    
    if (intersections.length === 0) {
      // No intersections - no intersection result
      return null;
    }
    
    // Build intersect outline
    const intersectVertices = this.buildGeneralPolygonIntersectOutline(vertices1, vertices2, intersections);
    if (intersectVertices.length < 3) return null;
    
    return this.createPolygonFromVertices(intersectVertices, shape1, shape2, 'intersect');
  }

  /**
   * Perform generalized exclude operation for any polygon-based shapes
   */
  static performGeneralPolygonExclude(shape1: Shape, shape2: Shape): Shape | null {
    // Get world-transformed vertices for both shapes
    const vertices1 = this.getWorldVerticesFromShape(shape1);
    const vertices2 = this.getWorldVerticesFromShape(shape2);
    
    // Find intersection points between the shapes
    const intersections = this.findShapeIntersections(shape1, shape2);
    
    if (intersections.length === 0) {
      // No intersections - return both shapes combined but not overlapping
      const allVertices = [...vertices1, ...vertices2];
      const excludeVertices = this.convexHull(allVertices);
      return this.createPolygonFromVertices(excludeVertices, shape1, shape2, 'exclude');
    }
    
    // Build exclude outline (union minus intersection)
    const excludeVertices = this.buildGeneralPolygonExcludeOutline(vertices1, vertices2, intersections);
    return this.createPolygonFromVertices(excludeVertices, shape1, shape2, 'exclude');
  }

  /**
   * Build subtract outline for general polygons
   */
  private static buildGeneralPolygonSubtractOutline(
    vertices1: Point[],
    vertices2: Point[],
    intersections: IntersectionPoint[]
  ): Point[] {
    if (intersections.length === 0) {
      return vertices1;
    }

    // Get all candidate points
    const allPoints = [...vertices1, ...intersections];
    const uniquePoints = this.removeDuplicatePoints(allPoints);
    
    // Filter to keep points that are:
    // 1. Shape1 vertices that are not strictly inside shape2
    // 2. Intersection points
    const subtractPoints = uniquePoints.filter(point => {
      const strictlyInsideShape2 = this.isPointStrictlyInsidePolygon(point, vertices2);
      const isIntersectionPoint = intersections.some(ip => 
        Math.abs(ip.x - point.x) < 0.01 && Math.abs(ip.y - point.y) < 0.01
      );
      
      if (isIntersectionPoint) {
        return true;
      }
      
      const isShape1Vertex = vertices1.some(v => 
        Math.abs(v.x - point.x) < 0.01 && Math.abs(v.y - point.y) < 0.01
      );
      
      if (isShape1Vertex) {
        return !strictlyInsideShape2;
      }
      
      return false;
    });
    
    // Sort points by angle from centroid
    const centroid = this.calculateCentroid(subtractPoints);
    return subtractPoints.sort((a, b) => {
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
      return angleA - angleB;
    });
  }

  /**
   * Build intersect outline for general polygons
   */
  private static buildGeneralPolygonIntersectOutline(
    vertices1: Point[],
    vertices2: Point[],
    intersections: IntersectionPoint[]
  ): Point[] {
    if (intersections.length === 0) {
      return [];
    }

    // Get all candidate points
    const allPoints = [...vertices1, ...vertices2, ...intersections];
    const uniquePoints = this.removeDuplicatePoints(allPoints);
    
    // Filter to keep points that are:
    // 1. Inside both shapes
    // 2. Intersection points
    const intersectPoints = uniquePoints.filter(point => {
      const insideShape1 = this.isPointStrictlyInsidePolygon(point, vertices1);
      const insideShape2 = this.isPointStrictlyInsidePolygon(point, vertices2);
      const isIntersectionPoint = intersections.some(ip => 
        Math.abs(ip.x - point.x) < 0.01 && Math.abs(ip.y - point.y) < 0.01
      );
      
      if (isIntersectionPoint) {
        return true;
      }
      
      return insideShape1 && insideShape2;
    });
    
    if (intersectPoints.length < 3) return [];
    
    // Sort points by angle from centroid
    const centroid = this.calculateCentroid(intersectPoints);
    return intersectPoints.sort((a, b) => {
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
      return angleA - angleB;
    });
  }

  /**
   * Build exclude outline for general polygons
   */
  private static buildGeneralPolygonExcludeOutline(
    vertices1: Point[],
    vertices2: Point[],
    intersections: IntersectionPoint[]
  ): Point[] {
    if (intersections.length === 0) {
      return this.convexHull([...vertices1, ...vertices2]);
    }

    // Get all candidate points
    const allPoints = [...vertices1, ...vertices2, ...intersections];
    const uniquePoints = this.removeDuplicatePoints(allPoints);
    
    // Filter to keep points that are:
    // 1. Not inside both shapes (exclude intersection)
    // 2. Intersection points for boundary
    const excludePoints = uniquePoints.filter(point => {
      const insideShape1 = this.isPointStrictlyInsidePolygon(point, vertices1);
      const insideShape2 = this.isPointStrictlyInsidePolygon(point, vertices2);
      const isIntersectionPoint = intersections.some(ip => 
        Math.abs(ip.x - point.x) < 0.01 && Math.abs(ip.y - point.y) < 0.01
      );
      
      if (isIntersectionPoint) {
        return true;
      }
      
      // Keep points that are in one shape but not both (exclude the intersection)
      return (insideShape1 && !insideShape2) || (!insideShape1 && insideShape2) || 
             (!insideShape1 && !insideShape2);
    });
    
    // Sort points by angle from centroid
    const centroid = this.calculateCentroid(excludePoints);
    return excludePoints.sort((a, b) => {
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
      return angleA - angleB;
    });
  }

  /**
   * Perform union operation specifically for rectangles
   */
  private static performRectangleUnion(rect1: Shape, rect2: Shape): Shape | null {
    // Get vertices of both rectangles
    const vertices1 = this.getRectangleVertices(rect1);
    const vertices2 = this.getRectangleVertices(rect2);
    
    // Find intersection points between rectangle edges
    const intersections = this.findRectangleIntersections(rect1, rect2);
    
    if (intersections.length === 0) {
      // No intersections - rectangles don't overlap
      // Return convex hull of both rectangles
      const allVertices = [...vertices1, ...vertices2];
      const unionVertices = this.convexHull(allVertices);
      
      return this.createPolygonFromVertices(unionVertices, rect1, rect2, 'union');
    }
    
    // Build union outline by combining exterior vertices and intersection points
    const unionVertices = this.buildRectangleUnionOutline(vertices1, vertices2, intersections);
    
    return this.createPolygonFromVertices(unionVertices, rect1, rect2, 'union');
  }

  /**
   * Find intersections specifically between two rectangles
   */
  private static findRectangleIntersections(rect1: Shape, rect2: Shape): IntersectionPoint[] {
    const edges1 = this.getRectangleEdges(rect1);
    const edges2 = this.getRectangleEdges(rect2);
    const intersections: IntersectionPoint[] = [];

    // Transform edges to world coordinates
    const worldEdges1 = this.transformEdges(edges1, rect1);
    const worldEdges2 = this.transformEdges(edges2, rect2);

    for (const edge1 of worldEdges1) {
      for (const edge2 of worldEdges2) {
        const intersection = this.findLineIntersection(edge1, edge2);
        if (intersection) {
          intersections.push({
            ...intersection,
            onShape1: true,
            onShape2: true
          });
        }
      }
    }

    return intersections;
  }

  /**
   * Build union outline for rectangles using proper boundary tracing
   */
  private static buildRectangleUnionOutline(
    vertices1: Point[],
    vertices2: Point[],
    intersections: IntersectionPoint[]
  ): Point[] {
    if (intersections.length === 0) {
      // No intersections - return convex hull
      return this.convexHull([...vertices1, ...vertices2]);
    }

    // Build the union outline by tracing the exterior boundary
    const unionVertices: Point[] = [];
    
    // Get all candidate points (vertices + intersections)
    const allPoints = [...vertices1, ...vertices2, ...intersections];
    
    // Remove duplicate points
    const uniquePoints = this.removeDuplicatePoints(allPoints);
    
    // Filter to keep only exterior points for union operation
    const exteriorPoints = uniquePoints.filter(point => {
      const strictlyInsideRect1 = this.isPointStrictlyInside(point, vertices1);
      const strictlyInsideRect2 = this.isPointStrictlyInside(point, vertices2);
      const isIntersectionPoint = intersections.some(ip => 
        Math.abs(ip.x - point.x) < 0.01 && Math.abs(ip.y - point.y) < 0.01
      );
      
      // For union: keep points that are:
      // 1. Intersection points (always on boundary)
      // 2. Rectangle vertices that are not strictly inside the other rectangle
      if (isIntersectionPoint) {
        return true;
      }
      
      const isRect1Vertex = vertices1.some(v => 
        Math.abs(v.x - point.x) < 0.01 && Math.abs(v.y - point.y) < 0.01
      );
      const isRect2Vertex = vertices2.some(v => 
        Math.abs(v.x - point.x) < 0.01 && Math.abs(v.y - point.y) < 0.01
      );
      
      if (isRect1Vertex) {
        return !strictlyInsideRect2;
      }
      if (isRect2Vertex) {
        return !strictlyInsideRect1;
      }
      
      return false;
    });
    
    // Sort points by angle from centroid to create proper outline
    const centroid = this.calculateCentroid(exteriorPoints);
    const sortedPoints = exteriorPoints.sort((a, b) => {
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
      return angleA - angleB;
    });
    
    return sortedPoints;
  }

  /**
   * Remove duplicate points within tolerance
   */
  private static removeDuplicatePoints(points: Point[], tolerance = 1e-6): Point[] {
    const unique: Point[] = [];
    
    for (const point of points) {
      const isDuplicate = unique.some(existing => 
        this.pointsEqual(point, existing, tolerance)
      );
      
      if (!isDuplicate) {
        unique.push(point);
      }
    }
    
    return unique;
  }

  /**
   * Check if point is strictly inside rectangle (not on boundary)
   */
  private static isPointStrictlyInside(point: Point, rectVertices: Point[]): boolean {
    if (rectVertices.length !== 4) return false;
    
    // Check if point is on any edge first
    for (let i = 0; i < 4; i++) {
      const edge = {
        start: rectVertices[i],
        end: rectVertices[(i + 1) % 4]
      };
      
      if (this.isPointOnLineSegment(point, edge)) {
        return false; // On boundary, not strictly inside
      }
    }
    
    // Use ray casting for interior test
    let crossings = 0;
    const rayEnd = { x: point.x + 10000, y: point.y };
    
    for (let i = 0; i < 4; i++) {
      const edge = {
        start: rectVertices[i],
        end: rectVertices[(i + 1) % 4]
      };
      
      if (this.lineSegmentsIntersect({ start: point, end: rayEnd }, edge)) {
        crossings++;
      }
    }
    
    return crossings % 2 === 1;
  }

  /**
   * Check if point lies on a line segment
   */
  private static isPointOnLineSegment(point: Point, segment: LineSegment): boolean {
    const { start, end } = segment;
    
    // Check if point is collinear with segment
    const crossProduct = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
    if (Math.abs(crossProduct) > 1e-6) return false;
    
    // Check if point is within segment bounds
    const dotProduct = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
    const squaredLength = (end.x - start.x) * (end.x - start.x) + (end.y - start.y) * (end.y - start.y);
    
    return dotProduct >= 0 && dotProduct <= squaredLength;
  }

  /**
   * Check if two line segments intersect
   */
  private static lineSegmentsIntersect(seg1: LineSegment, seg2: LineSegment): boolean {
    const intersection = this.findLineIntersection(seg1, seg2);
    return intersection !== null;
  }

  /**
   * Check if point is strictly inside a rectangle (not on boundary)
   */
  private static isPointInsideRectangle(point: Point, rectVertices: Point[]): boolean {
    if (rectVertices.length !== 4) return false;
    
    // Use ray casting algorithm
    let inside = false;
    const rayEnd = { x: point.x + 10000, y: point.y };
    
    for (let i = 0; i < 4; i++) {
      const edge = {
        start: rectVertices[i],
        end: rectVertices[(i + 1) % 4]
      };
      
      const intersection = this.findLineIntersection(
        { start: point, end: rayEnd },
        edge
      );
      
      if (intersection) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  /**
   * Create a polygon shape from vertices
   */
  private static createPolygonFromVertices(
    vertices: Point[],
    shape1: Shape,
    shape2: Shape,
    operation: string
  ): Shape {
    const result = new Shape('polygon');
    result.id = `${shape1.id}_${operation}_${shape2.id}`;
    
    // Use shape1's transform as base but adjust position to centroid
    const centroid = this.calculateCentroid(vertices);
    result.transform.x = centroid.x;
    result.transform.y = centroid.y;
    result.transform.rotation = 0; // Reset rotation for union result
    result.transform.scaleX = 1;
    result.transform.scaleY = 1;
    
    // Adjust points to be relative to centroid
    result.points = vertices.map(v => ({
      x: v.x - centroid.x,
      y: v.y - centroid.y
    }));
    
    result.properties = { ...shape1.properties };
    
    return result;
  }

  /**
   * Calculate centroid of vertices
   */
  private static calculateCentroid(vertices: Point[]): Point {
    const centroid = { x: 0, y: 0 };
    
    for (const vertex of vertices) {
      centroid.x += vertex.x;
      centroid.y += vertex.y;
    }
    
    centroid.x /= vertices.length;
    centroid.y /= vertices.length;
    
    return centroid;
  }

  /**
   * Perform union operation for two circles
   */
  private static performCircleUnion(circle1: Shape, circle2: Shape): Shape | null {
    // Get circle vertices (high-resolution polygons)
    const vertices1 = this.getCircleVertices(circle1);
    const vertices2 = this.getCircleVertices(circle2);
    
    // Find intersection points between circle edges
    const intersections = this.findCircleIntersections(circle1, circle2);
    
    if (intersections.length === 0) {
      // No intersections - circles don't overlap
      const allVertices = [...vertices1, ...vertices2];
      const unionVertices = this.convexHull(allVertices);
      return this.createPolygonFromVertices(unionVertices, circle1, circle2, 'union');
    }
    
    // Build union outline
    const unionVertices = this.buildCircleUnionOutline(vertices1, vertices2, intersections);
    return this.createPolygonFromVertices(unionVertices, circle1, circle2, 'union');
  }

  /**
   * Find intersections between two circles
   */
  private static findCircleIntersections(circle1: Shape, circle2: Shape): IntersectionPoint[] {
    const edges1 = this.getCircleEdges(circle1);
    const edges2 = this.getCircleEdges(circle2);
    const intersections: IntersectionPoint[] = [];

    // Transform edges to world coordinates
    const worldEdges1 = this.transformEdges(edges1, circle1);
    const worldEdges2 = this.transformEdges(edges2, circle2);

    for (const edge1 of worldEdges1) {
      for (const edge2 of worldEdges2) {
        const intersection = this.findLineIntersection(edge1, edge2);
        if (intersection) {
          intersections.push({
            ...intersection,
            onShape1: true,
            onShape2: true
          });
        }
      }
    }

    return intersections;
  }

  /**
   * Build union outline for circles
   */
  private static buildCircleUnionOutline(
    vertices1: Point[],
    vertices2: Point[],
    intersections: IntersectionPoint[]
  ): Point[] {
    if (intersections.length === 0) {
      return this.convexHull([...vertices1, ...vertices2]);
    }

    // Get all candidate points
    const allPoints = [...vertices1, ...vertices2, ...intersections];
    const uniquePoints = this.removeDuplicatePoints(allPoints);
    
    // Filter to keep only exterior points for union operation
    const exteriorPoints = uniquePoints.filter(point => {
      const strictlyInsideCircle1 = this.isPointStrictlyInsideCircle(point, vertices1);
      const strictlyInsideCircle2 = this.isPointStrictlyInsideCircle(point, vertices2);
      const isIntersectionPoint = intersections.some(ip => 
        Math.abs(ip.x - point.x) < 0.01 && Math.abs(ip.y - point.y) < 0.01
      );
      
      // For union: keep points that are:
      // 1. Intersection points (always on boundary)
      // 2. Circle vertices that are not strictly inside the other circle
      if (isIntersectionPoint) {
        return true;
      }
      
      const isCircle1Vertex = vertices1.some(v => 
        Math.abs(v.x - point.x) < 0.01 && Math.abs(v.y - point.y) < 0.01
      );
      const isCircle2Vertex = vertices2.some(v => 
        Math.abs(v.x - point.x) < 0.01 && Math.abs(v.y - point.y) < 0.01
      );
      
      if (isCircle1Vertex) {
        return !strictlyInsideCircle2;
      }
      if (isCircle2Vertex) {
        return !strictlyInsideCircle1;
      }
      
      return false;
    });
    
    // Sort points by angle from centroid
    const centroid = this.calculateCentroid(exteriorPoints);
    return exteriorPoints.sort((a, b) => {
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
      return angleA - angleB;
    });
  }

  /**
   * Check if point is strictly inside a circle
   */
  private static isPointStrictlyInsideCircle(point: Point, circleVertices: Point[]): boolean {
    // For circles represented as polygons, use ray casting
    let crossings = 0;
    const rayEnd = { x: point.x + 10000, y: point.y };
    
    for (let i = 0; i < circleVertices.length; i++) {
      const edge = {
        start: circleVertices[i],
        end: circleVertices[(i + 1) % circleVertices.length]
      };
      
      if (this.lineSegmentsIntersect({ start: point, end: rayEnd }, edge)) {
        crossings++;
      }
    }
    
    return crossings % 2 === 1;
  }

  /**
   * Perform union operation for rectangle and circle
   */
  private static performRectangleCircleUnion(shape1: Shape, shape2: Shape): Shape | null {
    // Determine which is rectangle and which is circle
    const isRect1 = shape1.type === 'rectangle' || shape1.type === 'rounded-rectangle' || shape1.type === 'square' || shape1.type === 'rounded-square';
    const rect = isRect1 ? shape1 : shape2;
    const circle = isRect1 ? shape2 : shape1;
    
    // Get vertices for both shapes
    const rectVertices = this.getRectangleVertices(rect);
    const circleVertices = this.getCircleVertices(circle);
    
    // Find intersections between rectangle edges and circle edges
    const intersections = this.findRectangleCircleIntersections(rect, circle);
    
    if (intersections.length === 0) {
      // No intersections - shapes don't overlap
      const allVertices = [...rectVertices, ...circleVertices];
      const unionVertices = this.convexHull(allVertices);
      return this.createPolygonFromVertices(unionVertices, shape1, shape2, 'union');
    }
    
    // Build union outline
    const unionVertices = this.buildRectangleCircleUnionOutline(rectVertices, circleVertices, intersections);
    return this.createPolygonFromVertices(unionVertices, shape1, shape2, 'union');
  }

  /**
   * Find intersections between rectangle and circle
   */
  private static findRectangleCircleIntersections(rect: Shape, circle: Shape): IntersectionPoint[] {
    const rectEdges = this.getRectangleEdges(rect);
    const circleEdges = this.getCircleEdges(circle);
    const intersections: IntersectionPoint[] = [];

    // Transform edges to world coordinates
    const worldRectEdges = this.transformEdges(rectEdges, rect);
    const worldCircleEdges = this.transformEdges(circleEdges, circle);

    for (const rectEdge of worldRectEdges) {
      for (const circleEdge of worldCircleEdges) {
        const intersection = this.findLineIntersection(rectEdge, circleEdge);
        if (intersection) {
          intersections.push({
            ...intersection,
            onShape1: true,
            onShape2: true
          });
        }
      }
    }

    return intersections;
  }

  /**
   * Build union outline for rectangle and circle
   */
  private static buildRectangleCircleUnionOutline(
    rectVertices: Point[],
    circleVertices: Point[],
    intersections: IntersectionPoint[]
  ): Point[] {
    if (intersections.length === 0) {
      return this.convexHull([...rectVertices, ...circleVertices]);
    }

    // Get all candidate points
    const allPoints = [...rectVertices, ...circleVertices, ...intersections];
    const uniquePoints = this.removeDuplicatePoints(allPoints);
    
    // Filter to keep only exterior points for union operation
    const exteriorPoints = uniquePoints.filter(point => {
      const strictlyInsideRect = this.isPointStrictlyInside(point, rectVertices);
      const strictlyInsideCircle = this.isPointStrictlyInsideCircle(point, circleVertices);
      const isIntersectionPoint = intersections.some(ip => 
        Math.abs(ip.x - point.x) < 0.01 && Math.abs(ip.y - point.y) < 0.01
      );
      
      // For union: keep points that are:
      // 1. Intersection points (always on boundary)
      // 2. Rectangle vertices that are not strictly inside circle
      // 3. Circle vertices that are not strictly inside rectangle
      if (isIntersectionPoint) {
        return true;
      }
      
      const isRectVertex = rectVertices.some(rv => 
        Math.abs(rv.x - point.x) < 0.01 && Math.abs(rv.y - point.y) < 0.01
      );
      const isCircleVertex = circleVertices.some(cv => 
        Math.abs(cv.x - point.x) < 0.01 && Math.abs(cv.y - point.y) < 0.01
      );
      
      if (isRectVertex) {
        return !strictlyInsideCircle;
      }
      if (isCircleVertex) {
        return !strictlyInsideRect;
      }
      
      return false;
    });
    
    // Sort points by angle from centroid
    const centroid = this.calculateCentroid(exteriorPoints);
    return exteriorPoints.sort((a, b) => {
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      const angleB = Math.atan2(b.y - centroid.y, b.x - centroid.x);
      return angleA - angleB;
    });
  }

  /**
   * Collect all vertices from both shapes and intersection points
   */
  private static collectAllVertices(shape1: Shape, shape2: Shape, intersections: IntersectionPoint[]): Point[] {
    const vertices: Point[] = [];
    
    // Add shape1 vertices
    const shape1Vertices = this.getShapeVertices(shape1);
    vertices.push(...shape1Vertices);
    
    // Add shape2 vertices
    const shape2Vertices = this.getShapeVertices(shape2);
    vertices.push(...shape2Vertices);
    
    // Add intersection points
    vertices.push(...intersections);
    
    return vertices;
  }

  /**
   * Get vertices from a shape
   */
  private static getShapeVertices(shape: Shape): Point[] {
    switch (shape.type) {
      case 'rectangle':
      case 'square':
        return this.getRectangleVertices(shape);
      case 'circle':
        return this.getCircleVertices(shape);
      case 'ellipse':
        return this.getEllipseVertices(shape);
      case 'polygon':
      case 'star':
        return shape.points || [];
      default:
        return [];
    }
  }

  /**
   * Get rectangle vertices
   */
  private static getRectangleVertices(shape: Shape): Point[] {
    const w = (shape.width || 100) / 2;
    const h = (shape.height || 100) / 2;
    
    const vertices = [
      { x: -w, y: -h },
      { x: w, y: -h },
      { x: w, y: h },
      { x: -w, y: h }
    ];
    
    return vertices.map(v => this.transformPoint(v, shape.transform));
  }

  /**
   * Get circle vertices (approximated)
   */
  private static getCircleVertices(shape: Shape): Point[] {
    const radius = shape.radius || 50;
    const segments = shape.segments || 32; // Use shape's actual segment count
    const vertices: Point[] = [];
    
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const vertex = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius
      };
      vertices.push(this.transformPoint(vertex, shape.transform));
    }
    
    return vertices;
  }

  /**
   * Get ellipse vertices (approximated)
   */
  private static getEllipseVertices(shape: Shape): Point[] {
    const rx = (shape.width || 100) / 2;
    const ry = (shape.height || 100) / 2;
    const segments = shape.segments || 32; // Use shape's actual segment count
    const vertices: Point[] = [];
    
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const vertex = {
        x: Math.cos(angle) * rx,
        y: Math.sin(angle) * ry
      };
      vertices.push(this.transformPoint(vertex, shape.transform));
    }
    
    return vertices;
  }

  /**
   * Trace the union boundary by walking the outer perimeter
   */
  private static traceUnionBoundary(vertices: Point[], shape1: Shape, shape2: Shape): Point[] {
    const intersections = this.findShapeIntersections(shape1, shape2);
    
    if (intersections.length === 0) {
      // No intersections - return convex hull of both shapes
      return this.convexHull(vertices);
    }
    
    // Build adjacency information for boundary tracing
    const shape1Edges = this.getShapeEdges(shape1);
    const shape2Edges = this.getShapeEdges(shape2);
    
    // Create a boundary trace starting from the leftmost point
    return this.traceBoundaryWithIntersections(shape1Edges, shape2Edges, intersections);
  }

  /**
   * Trace boundary considering intersections to build union outline
   */
  private static traceBoundaryWithIntersections(
    shape1Edges: LineSegment[], 
    shape2Edges: LineSegment[], 
    intersections: IntersectionPoint[]
  ): Point[] {
    const boundary: Point[] = [];
    
    // Start from leftmost point of shape1
    let currentEdges = shape1Edges;
    let currentShape = 1;
    let currentPoint = this.findLeftmostPoint(shape1Edges);
    
    boundary.push(currentPoint);
    
    // Trace boundary by following exterior edges
    let iterations = 0;
    const maxIterations = (shape1Edges.length + shape2Edges.length) * 2;
    
    while (iterations < maxIterations) {
      iterations++;
      
      // Find next point on current shape's boundary
      const nextEdge = this.findNextBoundaryEdge(currentPoint, currentEdges, currentShape === 1 ? shape2Edges : shape1Edges);
      
      if (!nextEdge) break;
      
      // Check if this edge crosses to the other shape
      const crossing = this.findEdgeCrossing(nextEdge, intersections);
      
      if (crossing) {
        // Switch to other shape at intersection
        boundary.push(crossing);
        currentPoint = crossing;
        currentEdges = currentShape === 1 ? shape2Edges : shape1Edges;
        currentShape = currentShape === 1 ? 2 : 1;
      } else {
        // Continue on current shape
        boundary.push(nextEdge.end);
        currentPoint = nextEdge.end;
      }
      
      // Check if we've returned to start
      if (this.pointsEqual(currentPoint, boundary[0]) && boundary.length > 3) {
        break;
      }
    }
    
    return boundary.length > 3 ? boundary : this.convexHull([...this.getEdgePoints(shape1Edges), ...this.getEdgePoints(shape2Edges)]);
  }

  /**
   * Find leftmost point from edges
   */
  private static findLeftmostPoint(edges: LineSegment[]): Point {
    let leftmost = edges[0].start;
    
    for (const edge of edges) {
      if (edge.start.x < leftmost.x || (edge.start.x === leftmost.x && edge.start.y < leftmost.y)) {
        leftmost = edge.start;
      }
      if (edge.end.x < leftmost.x || (edge.end.x === leftmost.x && edge.end.y < leftmost.y)) {
        leftmost = edge.end;
      }
    }
    
    return leftmost;
  }

  /**
   * Find next boundary edge from current point
   */
  private static findNextBoundaryEdge(currentPoint: Point, currentEdges: LineSegment[], otherEdges: LineSegment[]): LineSegment | null {
    // Find edge that starts from current point
    for (const edge of currentEdges) {
      if (this.pointsEqual(edge.start, currentPoint)) {
        // Check if this edge is on the exterior (not inside other shape)
        const midPoint = {
          x: (edge.start.x + edge.end.x) / 2,
          y: (edge.start.y + edge.end.y) / 2
        };
        
        if (!this.isPointInsideShape(midPoint, otherEdges)) {
          return edge;
        }
      }
    }
    
    return null;
  }

  /**
   * Check if point is inside a shape defined by edges
   */
  private static isPointInsideShape(point: Point, edges: LineSegment[]): boolean {
    // Ray casting algorithm
    let inside = false;
    const rayEnd = { x: point.x + 10000, y: point.y };
    
    for (const edge of edges) {
      const intersection = this.findLineIntersection(
        { start: point, end: rayEnd },
        edge
      );
      
      if (intersection) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  /**
   * Find where an edge crosses to another shape
   */
  private static findEdgeCrossing(edge: LineSegment, intersections: IntersectionPoint[]): Point | null {
    for (const intersection of intersections) {
      // Check if intersection lies on this edge
      const dist1 = this.pointDistance(edge.start, intersection);
      const dist2 = this.pointDistance(edge.end, intersection);
      const edgeLength = this.pointDistance(edge.start, edge.end);
      
      if (Math.abs(dist1 + dist2 - edgeLength) < 1e-6) {
        return intersection;
      }
    }
    
    return null;
  }

  /**
   * Get all points from edges
   */
  private static getEdgePoints(edges: LineSegment[]): Point[] {
    const points: Point[] = [];
    for (const edge of edges) {
      points.push(edge.start, edge.end);
    }
    return points;
  }

  /**
   * Check if two points are equal within tolerance
   */
  private static pointsEqual(p1: Point, p2: Point, tolerance = 1e-6): boolean {
    return Math.abs(p1.x - p2.x) < tolerance && Math.abs(p1.y - p2.y) < tolerance;
  }

  /**
   * Calculate distance between two points
   */
  private static pointDistance(p1: Point, p2: Point): number {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }

  /**
   * Compute convex hull using Graham scan
   */
  private static convexHull(points: Point[]): Point[] {
    if (points.length < 3) return points;
    
    // Find the bottom-most point (or left most in case of tie)
    let bottom = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < points[bottom].y || 
          (points[i].y === points[bottom].y && points[i].x < points[bottom].x)) {
        bottom = i;
      }
    }
    
    // Swap bottom point to first position
    [points[0], points[bottom]] = [points[bottom], points[0]];
    
    // Sort points by polar angle with respect to bottom point
    const bottomPoint = points[0];
    points.slice(1).sort((a, b) => {
      const angleA = Math.atan2(a.y - bottomPoint.y, a.x - bottomPoint.x);
      const angleB = Math.atan2(b.y - bottomPoint.y, b.x - bottomPoint.x);
      return angleA - angleB;
    });
    
    // Build convex hull
    const hull: Point[] = [];
    for (const point of points) {
      while (hull.length >= 2 && this.crossProduct(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
        hull.pop();
      }
      hull.push(point);
    }
    
    return hull;
  }

  /**
   * Calculate cross product for three points
   */
  private static crossProduct(o: Point, a: Point, b: Point): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  /**
   * Create a compound shape when shapes don't intersect
   */
  private static createCompoundShape(shape1: Shape, shape2: Shape, operation: string): Shape {
    const result = new Shape('chunk');
    result.id = `${shape1.id}_${operation}_${shape2.id}`;
    
    // Use shape1's position and properties
    result.transform = { ...shape1.transform };
    result.properties = { ...shape1.properties };
    
    // Create a bounding outline that encompasses both shapes
    const bounds1 = shape1.getBounds();
    const bounds2 = shape2.getBounds();
    
    const minX = Math.min(bounds1.x, bounds2.x);
    const minY = Math.min(bounds1.y, bounds2.y);
    const maxX = Math.max(bounds1.x + bounds1.width, bounds2.x + bounds2.width);
    const maxY = Math.max(bounds1.y + bounds1.height, bounds2.y + bounds2.height);
    
    result.points = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
    ];
    
    return result;
  }
}