import { Point, DistributionSettings, DistributionPattern } from '../../client/src/lib/shapeTypes';

export class SmartDistributionAlgorithm {
  
  static generatePositions(
    count: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    switch (settings.pattern) {
      case 'grid':
        return this.generateGridPattern(count, bounds, settings);
      case 'circle':
        return this.generateCirclePattern(count, centerX, centerY, bounds, settings);
      case 'spiral':
        return this.generateSpiralPattern(count, centerX, centerY, bounds, settings);
      case 'organic':
        return this.generateOrganicPattern(count, bounds, settings);
      case 'physics':
        return this.generatePhysicsPattern(count, bounds, settings);
      case 'wave':
        return this.generateWavePattern(count, bounds, settings);
      case 'cluster':
        return this.generateClusterPattern(count, bounds, settings);
      default:
        return this.generateRandomPattern(count, bounds, settings);
    }
  }

  private static generateGridPattern(
    count: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    const cols = Math.ceil(Math.sqrt(count * bounds.width / bounds.height));
    const rows = Math.ceil(count / cols);
    
    const cellWidth = bounds.width / cols;
    const cellHeight = bounds.height / rows;
    
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      
      let x = bounds.x + col * cellWidth + cellWidth / 2;
      let y = bounds.y + row * cellHeight + cellHeight / 2;
      
      // Apply randomness
      if (settings.randomness > 0) {
        const maxOffset = Math.min(cellWidth, cellHeight) * settings.randomness * 0.4;
        x += (Math.random() - 0.5) * maxOffset;
        y += (Math.random() - 0.5) * maxOffset;
      }
      
      // Apply rotation
      if (settings.rotation !== 0) {
        const rotated = this.rotatePoint(x - bounds.x - bounds.width/2, y - bounds.y - bounds.height/2, settings.rotation);
        x = rotated.x + bounds.x + bounds.width/2;
        y = rotated.y + bounds.y + bounds.height/2;
      }
      
      positions.push({ x, y });
    }
    
    return positions;
  }

  private static generateCirclePattern(
    count: number,
    centerX: number,
    centerY: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    const maxRadius = Math.min(bounds.width, bounds.height) / 2 * settings.scale;
    
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI + settings.rotation;
      const radius = maxRadius * (0.3 + 0.7 * settings.density);
      
      let x = centerX + Math.cos(angle) * radius;
      let y = centerY + Math.sin(angle) * radius;
      
      // Apply randomness
      if (settings.randomness > 0) {
        const randomRadius = settings.randomness * maxRadius * 0.3;
        const randomAngle = Math.random() * 2 * Math.PI;
        x += Math.cos(randomAngle) * randomRadius;
        y += Math.sin(randomAngle) * randomRadius;
      }
      
      positions.push({ x, y });
    }
    
    return positions;
  }

  private static generateSpiralPattern(
    count: number,
    centerX: number,
    centerY: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    const maxRadius = Math.min(bounds.width, bounds.height) / 2 * settings.scale;
    const spiralTightness = 2 + settings.density * 3;
    
    for (let i = 0; i < count; i++) {
      const t = i / count;
      const angle = t * spiralTightness * 2 * Math.PI + settings.rotation;
      const radius = t * maxRadius;
      
      let x = centerX + Math.cos(angle) * radius;
      let y = centerY + Math.sin(angle) * radius;
      
      // Apply randomness
      if (settings.randomness > 0) {
        const randomOffset = settings.randomness * settings.spacing;
        x += (Math.random() - 0.5) * randomOffset;
        y += (Math.random() - 0.5) * randomOffset;
      }
      
      positions.push({ x, y });
    }
    
    return positions;
  }

  private static generateOrganicPattern(
    count: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    
    // Use Poisson disk sampling for organic distribution
    const minDistance = settings.spacing;
    const maxAttempts = 30;
    const cellSize = minDistance / Math.sqrt(2);
    const gridWidth = Math.ceil(bounds.width / cellSize);
    const gridHeight = Math.ceil(bounds.height / cellSize);
    const grid: Point[][] = Array(gridWidth).fill(null).map(() => Array(gridHeight).fill(null));
    
    // Start with a random point
    const firstPoint = {
      x: bounds.x + Math.random() * bounds.width,
      y: bounds.y + Math.random() * bounds.height
    };
    positions.push(firstPoint);
    
    const activeList = [firstPoint];
    
    while (activeList.length > 0 && positions.length < count) {
      const randomIndex = Math.floor(Math.random() * activeList.length);
      const point = activeList[randomIndex];
      let found = false;
      
      for (let i = 0; i < maxAttempts; i++) {
        const angle = Math.random() * 2 * Math.PI;
        const distance = minDistance + Math.random() * minDistance;
        const newX = point.x + Math.cos(angle) * distance;
        const newY = point.y + Math.sin(angle) * distance;
        
        if (newX >= bounds.x && newX < bounds.x + bounds.width &&
            newY >= bounds.y && newY < bounds.y + bounds.height) {
          
          const newPoint = { x: newX, y: newY };
          if (this.isValidPoint(newPoint, positions, minDistance)) {
            positions.push(newPoint);
            activeList.push(newPoint);
            found = true;
            break;
          }
        }
      }
      
      if (!found) {
        activeList.splice(randomIndex, 1);
      }
    }
    
    return positions.slice(0, count);
  }

  private static generatePhysicsPattern(
    count: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    const forces: { x: number; y: number }[] = [];
    
    // Initialize random positions
    for (let i = 0; i < count; i++) {
      positions.push({
        x: bounds.x + Math.random() * bounds.width,
        y: bounds.y + Math.random() * bounds.height
      });
      forces.push({ x: 0, y: 0 });
    }
    
    // Simulate physics for better distribution
    const iterations = 50;
    const repulsionStrength = settings.spacing * 10;
    const damping = 0.9;
    
    for (let iter = 0; iter < iterations; iter++) {
      // Reset forces
      forces.forEach(force => {
        force.x = 0;
        force.y = 0;
      });
      
      // Calculate repulsion forces
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const dx = positions[i].x - positions[j].x;
          const dy = positions[i].y - positions[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          
          if (distance > 0 && distance < repulsionStrength) {
            const force = repulsionStrength / (distance * distance);
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;
            
            forces[i].x += fx;
            forces[i].y += fy;
            forces[j].x -= fx;
            forces[j].y -= fy;
          }
        }
      }
      
      // Apply forces with boundary constraints
      for (let i = 0; i < count; i++) {
        positions[i].x += forces[i].x * damping;
        positions[i].y += forces[i].y * damping;
        
        // Keep within bounds
        positions[i].x = Math.max(bounds.x, Math.min(bounds.x + bounds.width, positions[i].x));
        positions[i].y = Math.max(bounds.y, Math.min(bounds.y + bounds.height, positions[i].y));
      }
    }
    
    return positions;
  }

  private static generateWavePattern(
    count: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    const frequency = 2 + settings.density * 3;
    const amplitude = bounds.height * 0.2 * settings.scale;
    
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const x = bounds.x + t * bounds.width;
      const wave = Math.sin(t * frequency * 2 * Math.PI + settings.rotation) * amplitude;
      const y = bounds.y + bounds.height / 2 + wave;
      
      // Apply randomness
      let finalX = x;
      let finalY = y;
      
      if (settings.randomness > 0) {
        const randomOffset = settings.randomness * settings.spacing;
        finalX += (Math.random() - 0.5) * randomOffset;
        finalY += (Math.random() - 0.5) * randomOffset;
      }
      
      positions.push({ x: finalX, y: finalY });
    }
    
    return positions;
  }

  private static generateClusterPattern(
    count: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    const clusterCount = Math.max(1, Math.floor(count / (3 + settings.density * 5)));
    const clusterCenters: Point[] = [];
    
    // Generate cluster centers
    for (let i = 0; i < clusterCount; i++) {
      clusterCenters.push({
        x: bounds.x + Math.random() * bounds.width,
        y: bounds.y + Math.random() * bounds.height
      });
    }
    
    // Distribute points around clusters
    for (let i = 0; i < count; i++) {
      const clusterIndex = i % clusterCount;
      const center = clusterCenters[clusterIndex];
      const clusterRadius = settings.spacing * (1 + settings.scale);
      
      const angle = Math.random() * 2 * Math.PI;
      const distance = Math.random() * clusterRadius;
      
      let x = center.x + Math.cos(angle) * distance;
      let y = center.y + Math.sin(angle) * distance;
      
      // Apply randomness
      if (settings.randomness > 0) {
        const randomOffset = settings.randomness * settings.spacing * 0.5;
        x += (Math.random() - 0.5) * randomOffset;
        y += (Math.random() - 0.5) * randomOffset;
      }
      
      // Keep within bounds
      x = Math.max(bounds.x, Math.min(bounds.x + bounds.width, x));
      y = Math.max(bounds.y, Math.min(bounds.y + bounds.height, y));
      
      positions.push({ x, y });
    }
    
    return positions;
  }

  private static generateRandomPattern(
    count: number,
    bounds: { x: number; y: number; width: number; height: number },
    settings: DistributionSettings
  ): Point[] {
    const positions: Point[] = [];
    
    for (let i = 0; i < count; i++) {
      let x = bounds.x + Math.random() * bounds.width;
      let y = bounds.y + Math.random() * bounds.height;
      
      // Apply overlap avoidance if enabled
      if (settings.avoidOverlap && positions.length > 0) {
        let attempts = 0;
        const maxAttempts = 50;
        
        while (attempts < maxAttempts) {
          const tooClose = positions.some(pos => {
            const dx = x - pos.x;
            const dy = y - pos.y;
            return Math.sqrt(dx * dx + dy * dy) < settings.spacing;
          });
          
          if (!tooClose) break;
          
          x = bounds.x + Math.random() * bounds.width;
          y = bounds.y + Math.random() * bounds.height;
          attempts++;
        }
      }
      
      positions.push({ x, y });
    }
    
    return positions;
  }

  private static rotatePoint(x: number, y: number, angle: number): Point {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: x * cos - y * sin,
      y: x * sin + y * cos
    };
  }

  private static isValidPoint(point: Point, existingPoints: Point[], minDistance: number): boolean {
    return existingPoints.every(existing => {
      const dx = point.x - existing.x;
      const dy = point.y - existing.y;
      return Math.sqrt(dx * dx + dy * dy) >= minDistance;
    });
  }
}
