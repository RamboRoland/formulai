import {Vector} from '../components/Vector';

export interface PrecomputedCheckpoint {
    id: string;
    centerPoint: Vector;
    edgePoints: {
        left: Vector;
        right: Vector;
    };
    trackWidth: number;
}

export interface TrackCenterlineData {
    precomputedCheckpoints: PrecomputedCheckpoint[];
}

/**
 * Find the center line of the track by first detecting the track, then following its center
 */
export const findTrackCenterline = (
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number,
    startPoint: Vector,
    spacing: number = 24
): Vector[] => {
    const ctx = collisionCanvas.getContext('2d');
    if (!ctx) return [];

    // Step 1: Find the track surface starting from the start point
    const trackPoints = findTrackSurface(collisionCanvas, trackWidth, trackHeight, startPoint);
    if (trackPoints.length === 0) {
        console.log('No track surface found');
        return [];
    }

    console.log(`Found ${trackPoints.length} track surface points`);

    // Step 1.5: Find the true center of the track at the start point
    const trueCenter = findTrueTrackCenter(startPoint, collisionCanvas, trackWidth, trackHeight);
    if (!trueCenter) {
        console.log('Could not find true track center');
        return [];
    }

    console.log(`True track center: (${trueCenter.x}, ${trueCenter.y})`);

    // Step 2: Find the centerline by following the track from the true center
    const centerlinePoints = followTrackCenterlineFromCenter(trueCenter, collisionCanvas, trackWidth, trackHeight, spacing);

    console.log(`Generated ${centerlinePoints.length} centerline points`);
    return centerlinePoints;
};

/**
 * Find the true center of the track at a given point
 */
const findTrueTrackCenter = (
    point: Vector,
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number
): Vector | null => {
    const ctx = collisionCanvas.getContext('2d');
    if (!ctx) return null;

    const maxDistance = 200;
    const stepSize = 1;

    // Cast rays in 4 cardinal directions to find track edges
    const directions = [
        {x: 1, y: 0},   // Right
        {x: -1, y: 0},  // Left
        {x: 0, y: 1},   // Down
        {x: 0, y: -1}   // Up
    ];

    const edgePoints: Vector[] = [];

    for (const direction of directions) {
        let distance = 0;
        let lastTrackPoint: Vector | null = null;

        while (distance < maxDistance) {
            const testX = point.x + direction.x * distance;
            const testY = point.y + direction.y * distance;

            if (testX < 0 || testX >= trackWidth || testY < 0 || testY >= trackHeight) {
                break;
            }

            try {
                const imageData = ctx.getImageData(Math.floor(testX), Math.floor(testY), 1, 1);
                const r = imageData.data[0];
                const g = imageData.data[1];
                const b = imageData.data[2];

                const isOnTrack = !(r === 0 && g === 0 && b === 0);

                if (isOnTrack) {
                    lastTrackPoint = new Vector(testX, testY);
                } else if (lastTrackPoint && distance > 0) {
                    // Found the edge
                    edgePoints.push(new Vector(testX, testY));
                    break;
                }
            } catch (error) {
                break;
            }

            distance += stepSize;
        }
    }

    if (edgePoints.length < 2) {
        console.log('Could not find enough edges for center calculation');
        return null;
    }

    // Calculate the center from all edge points
    const centerX = edgePoints.reduce((sum, p) => sum + p.x, 0) / edgePoints.length;
    const centerY = edgePoints.reduce((sum, p) => sum + p.y, 0) / edgePoints.length;

    console.log(`Found ${edgePoints.length} edges, calculated center: (${centerX}, ${centerY})`);
    return new Vector(centerX, centerY);
};

/**
 * Step 1: Find the track surface by exploring from the start point
 */
const findTrackSurface = (
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number,
    startPoint: Vector
): Vector[] => {
    const ctx = collisionCanvas.getContext('2d');
    if (!ctx) return [];

    const trackPoints: Vector[] = [];
    const visited = new Set<string>();
    const queue: Vector[] = [startPoint];

    // BFS to find all track surface points
    while (queue.length > 0) {
        const currentPoint = queue.shift()!;
        const key = `${Math.floor(currentPoint.x)},${Math.floor(currentPoint.y)}`;

        if (visited.has(key)) continue;
        if (currentPoint.x < 0 || currentPoint.x >= trackWidth ||
            currentPoint.y < 0 || currentPoint.y >= trackHeight) continue;

        try {
            const imageData = ctx.getImageData(Math.floor(currentPoint.x), Math.floor(currentPoint.y), 1, 1);
            const r = imageData.data[0];
            const g = imageData.data[1];
            const b = imageData.data[2];

            const isOnTrack = !(r === 0 && g === 0 && b === 0);

            if (isOnTrack) {
                trackPoints.push(currentPoint);
                visited.add(key);

                // Add neighboring points to queue
                const neighbors = [
                    new Vector(currentPoint.x + 1, currentPoint.y),
                    new Vector(currentPoint.x - 1, currentPoint.y),
                    new Vector(currentPoint.x, currentPoint.y + 1),
                    new Vector(currentPoint.x, currentPoint.y - 1)
                ];

                queue.push(...neighbors);
            }
        } catch (error) {
            continue;
        }
    }

    return trackPoints;
};

/**
 * Step 2: Follow the track centerline from the true center
 */
const followTrackCenterlineFromCenter = (
    startCenter: Vector,
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number,
    spacing: number
): Vector[] => {
    const centerlinePoints: Vector[] = [];
    const visited = new Set<string>();

    // Start from the true center
    let currentPoint = startCenter;
    centerlinePoints.push(new Vector(currentPoint.x, currentPoint.y));
    visited.add(`${Math.floor(currentPoint.x)},${Math.floor(currentPoint.y)}`);

    let attempts = 0;
    const maxAttempts = 5000; // Increased to go around the whole track

    while (attempts < maxAttempts) {
        // Find the center of the track at the current position
        const centerPoint = findTrackCenterAtPoint(currentPoint, collisionCanvas, trackWidth, trackHeight);

        if (!centerPoint) {
            break; // No more track center found
        }

        // Check if we've already visited this point
        const key = `${Math.floor(centerPoint.x)},${Math.floor(centerPoint.y)}`;
        if (visited.has(key)) {
            break; // We're back to a visited point
        }

        // Add the center point
        centerlinePoints.push(centerPoint);
        visited.add(key);
        currentPoint = centerPoint;
        attempts++;
    }

    return centerlinePoints;
};

/**
 * Find the center of the track at a given point by finding the left and right edges
 */
const findTrackCenterAtPoint = (
    point: Vector,
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number
): Vector | null => {
    const ctx = collisionCanvas.getContext('2d');
    if (!ctx) return null;

    const maxDistance = 500; // Much larger distance to find edges
    const stepSize = 0.5; // Even smaller step size for better accuracy

    // Simple approach: try all 8 directions and find the best perpendicular
    const directions = [
        {x: 1, y: 0},   // Right
        {x: 1, y: 1},   // Down-Right
        {x: 0, y: 1},   // Down
        {x: -1, y: 1},  // Down-Left
        {x: -1, y: 0},  // Left
        {x: -1, y: -1}, // Up-Left
        {x: 0, y: -1},  // Up
        {x: 1, y: -1}   // Up-Right
    ];

    let bestLeftEdge: Vector | null = null;
    let bestRightEdge: Vector | null = null;
    let bestDistance = 0;

    // Try each direction to find the best perpendicular
    for (const direction of directions) {
        const leftEdge = findEdgeInDirection(point, new Vector(direction.x, direction.y), collisionCanvas, trackWidth, trackHeight);
        const rightEdge = findEdgeInDirection(point, new Vector(-direction.x, -direction.y), collisionCanvas, trackWidth, trackHeight);

        if (leftEdge && rightEdge) {
            const distance = Math.sqrt(Math.pow(rightEdge.x - leftEdge.x, 2) + Math.pow(rightEdge.y - leftEdge.y, 2));
            if (distance > bestDistance) {
                bestDistance = distance;
                bestLeftEdge = leftEdge;
                bestRightEdge = rightEdge;
            }
        }
    }

    if (!bestLeftEdge || !bestRightEdge) {
        console.log('Could not find edges in any direction');
        return null;
    }

    console.log(`Found best edges with distance ${bestDistance}`);

    // Calculate the true center point between left and right edges
    const centerX = (bestLeftEdge.x + bestRightEdge.x) / 2;
    const centerY = (bestLeftEdge.y + bestRightEdge.y) / 2;

    console.log(`Center point: (${centerX}, ${centerY})`);

    // Calculate the direction from the best edges for forward movement
    const edgeDirection = new Vector(bestRightEdge.x - bestLeftEdge.x, bestRightEdge.y - bestLeftEdge.y);
    const edgeLength = Math.sqrt(edgeDirection.x * edgeDirection.x + edgeDirection.y * edgeDirection.y);

    if (edgeLength > 0) {
        // Perpendicular direction for forward movement (along the track)
        const forwardDirection = new Vector(-edgeDirection.y / edgeLength, edgeDirection.x / edgeLength);

        // Move forward along the track direction
        const forwardDistance = 12; // 12 pixel spacing
        const forwardX = centerX + forwardDirection.x * forwardDistance;
        const forwardY = centerY + forwardDirection.y * forwardDistance;

        // Check if the forward point is on track first
        if (forwardX >= 0 && forwardX < trackWidth && forwardY >= 0 && forwardY < trackHeight) {
            try {
                const imageData = ctx.getImageData(Math.floor(forwardX), Math.floor(forwardY), 1, 1);
                const r = imageData.data[0];
                const g = imageData.data[1];
                const b = imageData.data[2];

                const isOnTrack = !(r === 0 && g === 0 && b === 0);

                if (isOnTrack) {
                    console.log(`Forward point is on track: (${forwardX}, ${forwardY})`);

                    // Now find the edges at the forward point to maintain the same distance to edges
                    const forwardPoint = new Vector(forwardX, forwardY);
                    const forwardEdges = findEdgesAtForwardPoint(forwardPoint, collisionCanvas, trackWidth, trackHeight);

                    if (forwardEdges) {
                        console.log(`Found edges at forward point: left (${forwardEdges.left.x}, ${forwardEdges.left.y}), right (${forwardEdges.right.x}, ${forwardEdges.right.y})`);

                        // Calculate the center between the forward edges
                        const forwardCenterX = (forwardEdges.left.x + forwardEdges.right.x) / 2;
                        const forwardCenterY = (forwardEdges.left.y + forwardEdges.right.y) / 2;

                        console.log(`Forward center: (${forwardCenterX}, ${forwardCenterY})`);
                        return new Vector(forwardCenterX, forwardCenterY);
                    } else {
                        console.log(`Could not find edges at forward point, using forward point directly: (${forwardX}, ${forwardY})`);
                        return new Vector(forwardX, forwardY);
                    }
                } else {
                    console.log(`Forward point is not on track: (${forwardX}, ${forwardY})`);
                }
            } catch (error) {
                console.log(`Error checking forward point: ${error}`);
            }
        }
    }

    console.log(`Returning center point: (${centerX}, ${centerY})`);
    return new Vector(centerX, centerY);
};

/**
 * Find edges at a forward point using the same approach
 */
const findEdgesAtForwardPoint = (
    point: Vector,
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number
): { left: Vector; right: Vector } | null => {
    const directions = [
        {x: 1, y: 0},   // Right
        {x: 1, y: 1},   // Down-Right
        {x: 0, y: 1},   // Down
        {x: -1, y: 1},  // Down-Left
        {x: -1, y: 0},  // Left
        {x: -1, y: -1}, // Up-Left
        {x: 0, y: -1},  // Up
        {x: 1, y: -1}   // Up-Right
    ];

    let bestLeftEdge: Vector | null = null;
    let bestRightEdge: Vector | null = null;
    let bestDistance = 0;

    // Try each direction to find the best perpendicular
    for (const direction of directions) {
        const leftEdge = findEdgeInDirection(point, new Vector(direction.x, direction.y), collisionCanvas, trackWidth, trackHeight);
        const rightEdge = findEdgeInDirection(point, new Vector(-direction.x, -direction.y), collisionCanvas, trackWidth, trackHeight);

        if (leftEdge && rightEdge) {
            const distance = Math.sqrt(Math.pow(rightEdge.x - leftEdge.x, 2) + Math.pow(rightEdge.y - leftEdge.y, 2));
            if (distance > bestDistance) {
                bestDistance = distance;
                bestLeftEdge = leftEdge;
                bestRightEdge = rightEdge;
            }
        }
    }

    if (bestLeftEdge && bestRightEdge) {
        return {left: bestLeftEdge, right: bestRightEdge};
    }

    return null;
};

/**
 * Find edge in a specific direction
 */
const findEdgeInDirection = (
    point: Vector,
    direction: Vector,
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number
): Vector | null => {
    const ctx = collisionCanvas.getContext('2d');
    if (!ctx) return null;

    // Step 1: Very large steps (10) to find general area
    const step1Size = 10;
    let distance = 0;
    let lastTrackPoint: Vector | null = null;
    let edgeFound = false;
    let roughEdgeDistance = 0;

    while (distance < 200) {
        const testX = point.x + direction.x * distance;
        const testY = point.y + direction.y * distance;

        if (testX < 0 || testX >= trackWidth || testY < 0 || testY >= trackHeight) {
            break;
        }

        try {
            const imageData = ctx.getImageData(Math.floor(testX), Math.floor(testY), 1, 1);
            const r = imageData.data[0];
            const g = imageData.data[1];
            const b = imageData.data[2];

            const isOnTrack = !(r === 0 && g === 0 && b === 0);

            if (isOnTrack) {
                lastTrackPoint = new Vector(testX, testY);
            } else if (lastTrackPoint && !edgeFound) {
                edgeFound = true;
                roughEdgeDistance = distance;
                break;
            }
        } catch (error) {
            break;
        }

        distance += step1Size;
    }

    if (!edgeFound || !lastTrackPoint) {
        return null;
    }

    // Step 2: Medium steps (2) to narrow down the area
    const step2Size = 1;
    const searchRange2 = 10; // Search within 10 units of rough edge
    const startDistance2 = Math.max(0, roughEdgeDistance - searchRange2);
    const endDistance2 = roughEdgeDistance + searchRange2;
    
    let mediumEdgeDistance = roughEdgeDistance;
    let mediumLastTrackPoint = lastTrackPoint;

    for (let mediumDistance = startDistance2; mediumDistance <= endDistance2; mediumDistance += step2Size) {
        const testX = point.x + direction.x * mediumDistance;
        const testY = point.y + direction.y * mediumDistance;

        if (testX < 0 || testX >= trackWidth || testY < 0 || testY >= trackHeight) {
            continue;
        }

        try {
            const imageData = ctx.getImageData(Math.floor(testX), Math.floor(testY), 1, 1);
            const r = imageData.data[0];
            const g = imageData.data[1];
            const b = imageData.data[2];

            const isOnTrack = !(r === 0 && g === 0 && b === 0);

            if (isOnTrack) {
                mediumLastTrackPoint = new Vector(testX, testY);
            } else if (mediumLastTrackPoint) {
                mediumEdgeDistance = mediumDistance;
                break;
            }
        } catch (error) {
            continue;
        }
    }

    // Step 3: Very fine steps (0.01) for precise edge detection
    const step3Size = 0.01;
    const searchRange3 = 1; // Search within 2 units of medium edge
    const startDistance3 = Math.max(0, mediumEdgeDistance - searchRange3);
    const endDistance3 = mediumEdgeDistance + searchRange3;
    
    let bestEdgePoint = mediumLastTrackPoint;
    let bestDistance = mediumEdgeDistance;

    for (let fineDistance = startDistance3; fineDistance <= endDistance3; fineDistance += step3Size) {
        const testX = point.x + direction.x * fineDistance;
        const testY = point.y + direction.y * fineDistance;

        if (testX < 0 || testX >= trackWidth || testY < 0 || testY >= trackHeight) {
            continue;
        }

        try {
            const imageData = ctx.getImageData(Math.floor(testX), Math.floor(testY), 1, 1);
            const r = imageData.data[0];
            const g = imageData.data[1];
            const b = imageData.data[2];

            const isOnTrack = !(r === 0 && g === 0 && b === 0);

            if (!isOnTrack) {
                bestEdgePoint = new Vector(testX, testY);
                bestDistance = fineDistance;
                break;
            }
        } catch (error) {
            continue;
        }
    }

    return bestEdgePoint;
};

/**
 * Find track edges at a specific point by scanning 360 degrees and pairing them up
 */
const findEdgesAtPoint = (
    centerPoint: Vector,
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number,
    trackDirection?: Vector
): { left: Vector; right: Vector; trackWidth: number } | null => {
    const ctx = collisionCanvas.getContext('2d');
    if (!ctx) return null;
    const angleStep = 1;

    // Scan 180 degrees and collect all edge pairs
    const edgePairs: { left: Vector; right: Vector; trackWidth: number; angle: number; score: number }[] = [];

    for (let angle = 0; angle < 180; angle += angleStep) {
        const radians = (angle * Math.PI) / 180;
        const direction = new Vector(Math.cos(radians), Math.sin(radians));
        
        // Skip angles that are not perpendicular to the track direction
        if (trackDirection) {
            const dotProduct = direction.x * trackDirection.x + direction.y * trackDirection.y;
            const absDotProduct = Math.abs(dotProduct);
            
            // We want directions that are perpendicular to the track direction
            // Dot product close to 0 means perpendicular, close to 1 means parallel
            if (absDotProduct > 0.8) { // Skip directions that are too parallel to track direction
                continue;
            }
        }
        
        // Find edge in this direction
        const edge1 = findEdgeInDirection(centerPoint, direction, collisionCanvas, trackWidth, trackHeight);
        
        if (edge1) {
            // Find opposite edge (180 degrees opposite)
            const oppositeRadians = radians + Math.PI;
            const oppositeDirection = new Vector(Math.cos(oppositeRadians), Math.sin(oppositeRadians));
            const edge2 = findEdgeInDirection(centerPoint, oppositeDirection, collisionCanvas, trackWidth, trackHeight);
            
            if (edge2) {
                // Calculate track width (distance between edges)
                const trackWidth = Math.sqrt(
                    Math.pow(edge2.x - edge1.x, 2) + 
                    Math.pow(edge2.y - edge1.y, 2)
                );
                
                // Score based on total distance (closer to center is better)
                const score = trackWidth;
                
                // Store this edge pair
                edgePairs.push({
                    left: edge1,
                    right: edge2,
                    trackWidth: trackWidth,
                    angle: angle,
                    score: score
                });
            }
        }
    }

    if (edgePairs.length === 0) {
        return null;
    }

    // Find the best pair based on distance to edges and total distance
    let bestPair = edgePairs[0];
    let bestScore = Infinity; // Lower score is better

    for (const pair of edgePairs) {
        if (pair.score < bestScore) {
            bestScore = pair.score;
            bestPair = pair;
        }
    }

    return { left: bestPair.left, right: bestPair.right, trackWidth: bestPair.trackWidth };
};

/**
 * Pre-compute all possible checkpoints along the track centerline
 */
export const precomputeTrackCheckpoints = (
    collisionCanvas: HTMLCanvasElement,
    trackWidth: number,
    trackHeight: number,
    startPoint: Vector,
    spacing: number = 12
): TrackCenterlineData => {
    const ctx = collisionCanvas.getContext('2d');
    if (!ctx) return { precomputedCheckpoints: [] };

    const centerlinePoints: Vector[] = [];
    const precomputedCheckpoints: PrecomputedCheckpoint[] = [];
    const visited = new Set<string>();
    
    // Start from the start point
    let currentPoint = startPoint;
    let attempts = 0;
    let trackDirection: Vector | undefined = undefined;

    console.log(`Starting precomputation from (${startPoint.x}, ${startPoint.y})`);

    while (true) {
        // Find edges at current point
        const edges = findEdgesAtPoint(currentPoint, collisionCanvas, trackWidth, trackHeight, trackDirection);
        
        if (!edges) {
            console.log(`No edges found at attempt ${attempts}, stopping`);
            break;
        }

        // Calculate center point between edges
        const centerX = (edges.left.x + edges.right.x) / 2;
        const centerY = (edges.left.y + edges.right.y) / 2;
        const centerPoint = new Vector(centerX, centerY);

        // Check if we've already visited this point
        const key = `${Math.floor(centerPoint.x)},${Math.floor(centerPoint.y)}`;
        if (visited.has(key)) {
            console.log(`Back to visited point at attempt ${attempts}, stopping`);
            break;
        }

        // Add to centerline and checkpoints
        centerlinePoints.push(centerPoint);
        visited.add(key);

        // Calculate track direction
        trackDirection = new Vector(1, 0); // Default
        if (centerlinePoints.length > 1) {
            const prevPoint = centerlinePoints[centerlinePoints.length - 2];
            const dx = centerPoint.x - prevPoint.x;
            const dy = centerPoint.y - prevPoint.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            if (length > 0) {
                trackDirection = new Vector(dx / length, dy / length);
            }
        }

        // Create checkpoint
        const checkpoint: PrecomputedCheckpoint = {
            id: `checkpoint_${centerlinePoints.length - 1}`,
            centerPoint: centerPoint,
            edgePoints: {
                left: edges.left,
                right: edges.right
            },
            trackWidth: edges.trackWidth
        };
        precomputedCheckpoints.push(checkpoint);

        // Check if we've completed the track loop (passed over the first centerline point)
        if (centerlinePoints.length > 10) { // Need at least 10 points to avoid false positives
            const firstPoint = centerlinePoints[0];
            const distanceToFirst = Math.sqrt(
                Math.pow(centerPoint.x - firstPoint.x, 2) + 
                Math.pow(centerPoint.y - firstPoint.y, 2)
            );
            
            // If we're close to the first point, we've completed the loop
            if (distanceToFirst < spacing) {
                break;
            }
        }

        // Move forward along track direction
        const forwardX = centerPoint.x + trackDirection.x * spacing;
        const forwardY = centerPoint.y + trackDirection.y * spacing;
        currentPoint = new Vector(forwardX, forwardY);

        attempts++;
    }

    console.log(`Precomputation complete: ${centerlinePoints.length} centerline points, ${precomputedCheckpoints.length} checkpoints`);
    
    return {
        precomputedCheckpoints
    };
};

/**
 * Find the closest precomputed checkpoint to a given point
 */
export const findClosestPrecomputedCheckpoint = (
    x: number,
    y: number,
    precomputedCheckpoints: PrecomputedCheckpoint[],
    threshold: number = 30
): PrecomputedCheckpoint | null => {
    let closest: PrecomputedCheckpoint | null = null;
    let closestDistance = Infinity;

    for (const checkpoint of precomputedCheckpoints) {
        const distance = Math.sqrt(
            Math.pow(x - checkpoint.centerPoint.x, 2) +
            Math.pow(y - checkpoint.centerPoint.y, 2)
        );

        if (distance < closestDistance && distance <= threshold) {
            closestDistance = distance;
            closest = checkpoint;
        }
    }

    return closest;
};
