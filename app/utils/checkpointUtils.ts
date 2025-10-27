import { Vector } from '../components/Vector';

export interface CheckpointData {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface Checkpoint {
  id: string;
  start: Vector;
  end: Vector;
  edgePoints: {
    left: Vector;
    right: Vector;
  };
}

/**
 * Find the closest track edges from a given point
 * This function uses improved angle detection to avoid 45-degree snapping
 */
export const findTrackEdges = (
  x: number,
  y: number,
  collisionCanvas: HTMLCanvasElement,
  trackWidth: number,
  trackHeight: number
): { start: Vector; end: Vector; edgePoints: { left: Vector; right: Vector } } | null => {
  const ctx = collisionCanvas.getContext('2d');
  if (!ctx) return null;

  const maxDistance = 200;
  const stepSize = 2;

  // First try cardinal directions for straight sections
  const cardinalDirections = [
    { x: 1, y: 0 },   // Right
    { x: -1, y: 0 },  // Left
    { x: 0, y: 1 },   // Down
    { x: 0, y: -1 }   // Up
  ];
  
  // Try cardinal directions first for straight sections
  let bestCardinalPair = null;
  let bestCardinalScore = 0;
  
  for (const direction of cardinalDirections) {
    // Find edge in this direction
    let edgePoint = { x: 0, y: 0 };
    let edgeFound = false;
    let distance = 0;
    
    while (distance < maxDistance) {
      const testX = x + direction.x * distance;
      const testY = y + direction.y * distance;
      
      if (testX < 0 || testX >= trackWidth || testY < 0 || testY >= trackHeight) {
        break;
      }
      
      try {
        const imageData = ctx.getImageData(Math.floor(testX), Math.floor(testY), 1, 1);
        const r = imageData.data[0];
        const g = imageData.data[1];
        const b = imageData.data[2];
        
        const isOnTrack = !(r === 0 && g === 0 && b === 0);
        
        if (!isOnTrack && distance > 0) {
          edgePoint.x = testX;
          edgePoint.y = testY;
          edgeFound = true;
          break;
        }
      } catch (error) {
        break;
      }
      
      distance += stepSize;
    }
    
    if (edgeFound) {
      // Find opposite edge
      const oppositeDirection = { x: -direction.x, y: -direction.y };
      let oppositeEdgePoint = { x: 0, y: 0 };
      let oppositeEdgeFound = false;
      let oppositeDistance = 0;
      
      while (oppositeDistance < maxDistance) {
        const testX = x + oppositeDirection.x * oppositeDistance;
        const testY = y + oppositeDirection.y * oppositeDistance;
        
        if (testX < 0 || testX >= trackWidth || testY < 0 || testY >= trackHeight) {
          break;
        }
        
        try {
          const imageData = ctx.getImageData(Math.floor(testX), Math.floor(testY), 1, 1);
          const r = imageData.data[0];
          const g = imageData.data[1];
          const b = imageData.data[2];
          
          const isOnTrack = !(r === 0 && g === 0 && b === 0);
          
          if (!isOnTrack && oppositeDistance > 0) {
            oppositeEdgePoint.x = testX;
            oppositeEdgePoint.y = testY;
            oppositeEdgeFound = true;
            break;
          }
        } catch (error) {
          break;
        }
        
        oppositeDistance += stepSize;
      }
      
      if (oppositeEdgeFound) {
        // Calculate score based on how close the edges are to the click point
        const distanceToEdge1 = Math.sqrt((edgePoint.x - x) ** 2 + (edgePoint.y - y) ** 2);
        const distanceToEdge2 = Math.sqrt((oppositeEdgePoint.x - x) ** 2 + (oppositeEdgePoint.y - y) ** 2);
        const totalDistance = distanceToEdge1 + distanceToEdge2;
        
        // Prefer edges that are closer to the click point
        const score = 1 / (totalDistance + 1);
        
        if (score > bestCardinalScore) {
          bestCardinalScore = score;
          bestCardinalPair = {
            edge1: edgePoint,
            edge2: oppositeEdgePoint
          };
        }
      }
    }
  }
  
  // If cardinal directions found good edges, use them for straight sections
  if (bestCardinalPair) {
    const edgePoint = bestCardinalPair.edge1;
    const oppositeEdgePoint = bestCardinalPair.edge2;
    
    // Use the click position as the center
    const centerX = x;
    const centerY = y;
    
    // Calculate the track width (distance between edges)
    const trackWidthDistance = Math.sqrt(
      Math.pow(oppositeEdgePoint.x - edgePoint.x, 2) + 
      Math.pow(oppositeEdgePoint.y - edgePoint.y, 2)
    );
    
    // Create a perpendicular vector to the track direction
    const trackDx = oppositeEdgePoint.x - edgePoint.x;
    const trackDy = oppositeEdgePoint.y - edgePoint.y;
    
    // Perpendicular vector (rotated 90 degrees)
    const perpX = -trackDy / trackWidthDistance;
    const perpY = trackDx / trackWidthDistance;
    
    // Create checkpoint line that spans the track width, centered on click position
    const halfWidth = trackWidthDistance / 2;
    const startX = centerX + perpX * halfWidth;
    const startY = centerY + perpY * halfWidth;
    const endX = centerX - perpX * halfWidth;
    const endY = centerY - perpY * halfWidth;
    
    return {
      start: new Vector(startX, startY),
      end: new Vector(endX, endY),
      edgePoints: {
        left: new Vector(edgePoint.x, edgePoint.y),
        right: new Vector(oppositeEdgePoint.x, oppositeEdgePoint.y)
      }
    };
  }
  
  // If cardinal directions didn't work well, use advanced corner detection
  const directions = [];
  
  // Add directions every 5 degrees for very smooth corner detection
  for (let angle = 0; angle < 360; angle += 10) {
    const radians = (angle * Math.PI) / 180;
    directions.push({
      x: Math.cos(radians),
      y: Math.sin(radians)
    });
  }
  
  // Find all edges in all directions
  const allEdges = [];
  
  for (const direction of directions) {
    let distance = 0;
    let edgeFound = false;
    let edgePoint = { x: 0, y: 0 };
    
    while (distance < maxDistance) {
      const testX = x + direction.x * distance;
      const testY = y + direction.y * distance;
      
      if (testX < 0 || testX >= trackWidth || testY < 0 || testY >= trackHeight) {
        break;
      }
      
      try {
        const imageData = ctx.getImageData(Math.floor(testX), Math.floor(testY), 1, 1);
        const r = imageData.data[0];
        const g = imageData.data[1];
        const b = imageData.data[2];
        
        const isOnTrack = !(r === 0 && g === 0 && b === 0);
        
        if (!isOnTrack && distance > 0) {
          edgePoint.x = testX;
          edgePoint.y = testY;
          edgeFound = true;
          break;
        }
      } catch (error) {
        break;
      }
      
      distance += stepSize;
    }
    
    if (edgeFound) {
      const distanceToEdge = Math.sqrt((edgePoint.x - x) ** 2 + (edgePoint.y - y) ** 2);
      allEdges.push({
        point: edgePoint,
        distance: distanceToEdge,
        direction: direction
      });
    }
  }
  
  if (allEdges.length < 2) {
    return null;
  }
  
  // Sort edges by distance to find the closest ones
  allEdges.sort((a, b) => a.distance - b.distance);
  
  // Find the best pair of edges that are roughly opposite to each other
  let bestEdgePair = null;
  let bestScore = 0;
  
  for (let i = 0; i < allEdges.length; i++) {
    for (let j = i + 1; j < allEdges.length; j++) {
      const edge1 = allEdges[i];
      const edge2 = allEdges[j];
      
      // Calculate the angle between the two edges
      const dx1 = edge1.point.x - x;
      const dy1 = edge1.point.y - y;
      const dx2 = edge2.point.x - x;
      const dy2 = edge2.point.y - y;
      
      // Calculate dot product to check if edges are roughly opposite
      const dotProduct = dx1 * dx2 + dy1 * dy2;
      const magnitude1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const magnitude2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
      const cosine = dotProduct / (magnitude1 * magnitude2);
      
      // Prefer edges that are roughly opposite (cosine close to -1)
      // But be more lenient - allow edges that are at least 90 degrees apart
      const oppositeScore = Math.max(0, cosine + 0.5); // More lenient threshold
      
      // Combine distance and opposite score with higher weight on distance
      const totalDistance = edge1.distance + edge2.distance;
      const distanceScore = 1 / (totalDistance + 1);
      const oppositeBonus = (1 - oppositeScore) * 0.3; // Smaller weight for opposite requirement
      const score = distanceScore + oppositeBonus;
      
      if (score > bestScore) {
        bestScore = score;
        bestEdgePair = {
          edge1: edge1.point,
          edge2: edge2.point
        };
      }
    }
  }
  
  // If no good opposite pair found, use the two closest edges
  if (!bestEdgePair && allEdges.length >= 2) {
    bestEdgePair = {
      edge1: allEdges[0].point,
      edge2: allEdges[1].point
    };
  }
  
  if (!bestEdgePair) {
    return null;
  }
  
  // Use the best edge pair to create the checkpoint
  const edgePoint = bestEdgePair.edge1;
  const oppositeEdgePoint = bestEdgePair.edge2;
  
  // Use the click position as the center
  const centerX = x;
  const centerY = y;
  
  // Calculate the track width (distance between edges)
  const trackWidthDistance = Math.sqrt(
    Math.pow(oppositeEdgePoint.x - edgePoint.x, 2) + 
    Math.pow(oppositeEdgePoint.y - edgePoint.y, 2)
  );
  
  // Create a perpendicular vector to the track direction
  const trackDx = oppositeEdgePoint.x - edgePoint.x;
  const trackDy = oppositeEdgePoint.y - edgePoint.y;
  
  // Perpendicular vector (rotated 90 degrees)
  const perpX = -trackDy / trackWidthDistance;
  const perpY = trackDx / trackWidthDistance;
  
  // Create checkpoint line that spans the track width, centered on click position
  const halfWidth = trackWidthDistance / 2;
  const startX = centerX + perpX * halfWidth;
  const startY = centerY + perpY * halfWidth;
  const endX = centerX - perpX * halfWidth;
  const endY = centerY - perpY * halfWidth;
  
  return {
    start: new Vector(startX, startY),
    end: new Vector(endX, endY),
    edgePoints: {
      left: new Vector(edgePoint.x, edgePoint.y),
      right: new Vector(oppositeEdgePoint.x, oppositeEdgePoint.y)
    }
  };
};

/**
 * Validate that a checkpoint is properly placed on the track
 */
export const validateCheckpoint = (
  checkpoint: Checkpoint,
  collisionCanvas: HTMLCanvasElement
): boolean => {
  // Check if start and end points are on the track
  const startOnTrack = !isPointColliding(checkpoint.start.x, checkpoint.start.y, collisionCanvas);
  const endOnTrack = !isPointColliding(checkpoint.end.x, checkpoint.end.y, collisionCanvas);
  
  return startOnTrack && endOnTrack;
};

/**
 * Check if a point is colliding with track boundaries
 */
const isPointColliding = (x: number, y: number, collisionCanvas: HTMLCanvasElement): boolean => {
  const ctx = collisionCanvas.getContext('2d');
  if (!ctx) return true;
  
  try {
    const imageData = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
    const r = imageData.data[0];
    const g = imageData.data[1];
    const b = imageData.data[2];
    
    return r === 0 && g === 0 && b === 0;
  } catch (error) {
    return true;
  }
};

/**
 * Check if a point is near a checkpoint line
 */
export const isPointNearCheckpoint = (
  point: { x: number; y: number },
  checkpoint: Checkpoint,
  threshold: number = 10
): boolean => {
  // Use edge points if available, otherwise fall back to start/end
  const startX = checkpoint.edgePoints ? checkpoint.edgePoints.left.x : checkpoint.start.x;
  const startY = checkpoint.edgePoints ? checkpoint.edgePoints.left.y : checkpoint.start.y;
  const endX = checkpoint.edgePoints ? checkpoint.edgePoints.right.x : checkpoint.end.x;
  const endY = checkpoint.edgePoints ? checkpoint.edgePoints.right.y : checkpoint.end.y;
  
  const distance = distanceToLineSegment(
    point,
    { x: startX, y: startY },
    { x: endX, y: endY }
  );
  return distance <= threshold;
};

/**
 * Calculate the distance from a point to a line segment
 */
const distanceToLineSegment = (
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number => {
  const A = point.x - lineStart.x;
  const B = point.y - lineStart.y;
  const C = lineEnd.x - lineStart.x;
  const D = lineEnd.y - lineStart.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = lineStart.x;
    yy = lineStart.y;
  } else if (param > 1) {
    xx = lineEnd.x;
    yy = lineEnd.y;
  } else {
    xx = lineStart.x + param * C;
    yy = lineStart.y + param * D;
  }

  const dx = point.x - xx;
  const dy = point.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Export checkpoints to JSON format matching track structure
 */
export const exportCheckpointsToJSON = (checkpoints: Checkpoint[]): string => {
  const data = checkpoints.map(cp => 
    `{ start: new Vector(${cp.edgePoints.left.x}, ${cp.edgePoints.left.y}), end: new Vector(${cp.edgePoints.right.x}, ${cp.edgePoints.right.y}) }`
  );
  return `[\n    ${data.join(',\n    ')}\n]`;
};

/**
 * Import checkpoints from JSON format
 */
export const importCheckpointsFromJSON = (jsonString: string): Checkpoint[] => {
  try {
    const checkpointData: CheckpointData[] = JSON.parse(jsonString);
    return checkpointData.map((cp, index) => ({
      id: `checkpoint-${index}`,
      start: new Vector(cp.start.x, cp.start.y),
      end: new Vector(cp.end.x, cp.end.y),
      edgePoints: {
        left: new Vector(cp.start.x, cp.start.y), // Default to start/end for imported data
        right: new Vector(cp.end.x, cp.end.y)
      }
    }));
  } catch (error) {
    console.error('Failed to parse checkpoint data:', error);
    return [];
  }
};