import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {RacingGameProps, RacingGameState } from '../types';
import { Car } from '~/cars/Car';
import { styles } from './RacingGame.styles';
import { useControls } from './hooks/useControls';
import { StatsBox } from './StatsBox';
import { WebSocketClient } from '../services/websocket';
import { Track } from '~/tracks/Track';
import { GoKartTrackOne } from '~/tracks/gokarts/125cc/GoKartTrackOne';
import { GoKartTrackTwo } from '~/tracks/gokarts/125cc/GoKartTrackTwo';
import { Vector } from './Vector';
import { fromKmhToPixels } from '~/helper';

const RAY_LENGTH = 250; // Length of the rays in pixels
const RAY_ANGLE = 45; // Angle of the side rays in degrees

const getInitialGameState = (track: Track): RacingGameState => {
    return {
        lapTime: 0,
        lastLapTime: 0,
        totalCheckpoints: track.checkpoints.length,
        completedLaps: 0,
        passedCheckpoints: new Array(track.checkpoints.length).fill(false),
        currentCheckpoint: 0
    };
};

const RacingGame = ({ gameMode, gameTrack, gameCar }: RacingGameProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
    const collisionCanvasRef = useRef<HTMLCanvasElement>(null);
    const fpsCanvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number | undefined>(undefined);
    const [showBoundingBox, setShowBoundingBox] = useState(false);
    const [isGameInitialized, setIsGameInitialized] = useState(false);
    const [zoom, setZoom] = useState(1); // Add zoom state
    const [selectedTrack, setSelectedTrack] = useState<Track>(new gameTrack(canvasRef as RefObject<HTMLCanvasElement>, collisionCanvasRef as RefObject<HTMLCanvasElement>));
    const [pressedButtons, setPressedButtons] = useState({
        forward: false,
        backward: false,
        left: false,
        right: false,
        brake: false,
        reset: false
    });

    const trackRef = useRef<Track>(null);
    const carRef = useRef<Car>(null);
    const gameStateRef = useRef<RacingGameState>(null);
    const [statsBoxState, setStatsBoxState] = useState({
        speed: 0,
        angle: 0,
        x: 0,
        y: 0,
        hasCollision: false,
        lapTime: 0,
        currentCheckpoint: 0,
        totalCheckpoints: 0,
        completedLaps: 0
    });
    const isResettingRef = useRef(false);
    const wsClientRef = useRef<WebSocketClient | null>(null);
    
    const lastFrameTimeRef = useRef<number>(0);
    const fpsRef = useRef<number>(0);
    const lastFpsUpdateRef = useRef<number>(0);

    // Initialize car once
    useEffect(() => {
        trackRef.current = selectedTrack;
        carRef.current = new gameCar(trackRef.current);
        gameStateRef.current = getInitialGameState(trackRef.current);
    }, []); // Empty dependency array means this runs once on mount

    const setTrackChange = (track: string) => {
        let newTrack: Track;

        switch (track) {
            case 'GoKartTrackOne':
                newTrack = new GoKartTrackOne(canvasRef as RefObject<HTMLCanvasElement>, collisionCanvasRef as RefObject<HTMLCanvasElement>);
                break;
            case 'GoKartTrackTwo':
                newTrack = new GoKartTrackTwo(canvasRef as RefObject<HTMLCanvasElement>, collisionCanvasRef as RefObject<HTMLCanvasElement>);
                break;
            default:
                newTrack = new GoKartTrackOne(canvasRef as RefObject<HTMLCanvasElement>, collisionCanvasRef as RefObject<HTMLCanvasElement>);
        }

        setSelectedTrack(newTrack);
        trackRef.current = newTrack;
        setIsGameInitialized(false);
        carRef.current = new gameCar(trackRef.current);
        gameStateRef.current = getInitialGameState(trackRef.current);
    }

    const restartGame = () => {
        if (!trackRef.current || !carRef.current || !gameStateRef.current) return;
        
        isResettingRef.current = true;
        carRef.current = new gameCar(trackRef.current);
        gameStateRef.current.currentCheckpoint = 0;
        gameStateRef.current.completedLaps = 0;
        gameStateRef.current.passedCheckpoints = new Array(trackRef.current.checkpoints.length).fill(false);
        gameStateRef.current.lapTime = 0;
        carRef.current.previousFront = undefined;
    };

    const { getControls } = useControls(gameMode, restartGame);

    // Initialize WebSocket client once
    if (gameMode === 'ai' && !wsClientRef.current) {
        wsClientRef.current = WebSocketClient.getInstance('ws://localhost:8080');
        wsClientRef.current.setGameStateCallback(() => {
            if (!carRef.current || !gameStateRef.current) {
                return {
                    car: {
                        speed: 0,
                        angle: 0,
                        hasCollision: false,
                        rays: [0, 0, 0]
                    },
                    lapTime: 0,
                    lastLapTime: 0,
                    totalCheckpoints: 0,
                    completedLaps: 0,
                    currentCheckpoint: 0
                }
            }

            return {
                car: {
                    speed: Math.round(carRef.current.speed * 100) / 100,
                    angle: Math.round(carRef.current.angle * 100) / 100,
                    hasCollision: carRef.current.hasCollision,
                    rays: carRef.current.rays
                },
                lapTime: Math.round(gameStateRef.current.lapTime * 100) / 100,
                lastLapTime: Math.round(gameStateRef.current.lastLapTime * 100) / 100,
                totalCheckpoints: gameStateRef.current.totalCheckpoints,
                completedLaps: gameStateRef.current.completedLaps,
                currentCheckpoint: gameStateRef.current.currentCheckpoint,
            }
        });
        wsClientRef.current.setTrackCallback((track: string) => {
            setTrackChange(track);
        });
    }

    useEffect(() => {
        if (gameMode === 'ai' && wsClientRef.current) {
            wsClientRef.current.connect();
        }

        return () => {
            if (wsClientRef.current) {
                wsClientRef.current.disconnect();
            }
        };
    }, [gameMode]);

    // Cleanup WebSocket client when component unmounts
    useEffect(() => {
        return () => {
            WebSocketClient.resetInstance();
            wsClientRef.current = null;
        };
    }, []);


    // Load track and collision mask images
    useEffect(() => {
        trackRef.current?.loadMedia()
            .then(() => {
                setIsGameInitialized(true);
            })
            .catch((error) => {
                console.error('Failed to initialize game:', error);
            });
    }, [gameMode, selectedTrack]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const bgCanvas = backgroundCanvasRef.current;
        const collisionCanvas = collisionCanvasRef.current;
        const fpsCanvas = fpsCanvasRef.current;
        if (!canvas || !bgCanvas || !collisionCanvas || !fpsCanvas) return;

        const ctx = canvas.getContext('2d');
        const collisionCtx = collisionCanvas.getContext('2d');
        const fpsCtx = fpsCanvas.getContext('2d');
        if (!ctx || !collisionCtx || !fpsCtx) return;      
        
        // Set up FPS canvas
        fpsCanvas.width = 100;
        fpsCanvas.height = 30;
        fpsCtx.font = '16px monospace';
        fpsCtx.fillStyle = 'white';
        fpsCtx.textAlign = 'left';
        fpsCtx.textBaseline = 'top';
        
        lastFrameTimeRef.current = performance.now();
        lastFpsUpdateRef.current = performance.now();

        const gameLoop = async (timestamp: number) => {
            if (!trackRef.current || !carRef.current || !gameStateRef.current) return;

            const deltaTime = timestamp - lastFrameTimeRef.current;
            const deltaTimeSeconds = deltaTime / 1000;

            // Update FPS every 500ms
            const timeSinceLastUpdate = timestamp - lastFpsUpdateRef.current;
            fpsRef.current = Math.round((1 * 1000) / timeSinceLastUpdate);
            lastFpsUpdateRef.current = timestamp;

            // Update lap time
            const timeDelta = (timestamp - lastFrameTimeRef.current) / 1000; // Convert to seconds
            gameStateRef.current.lapTime += timeDelta;

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Save the context state before applying camera transform
            ctx.save();
            
            // Calculate the camera position (center of the car)
            const cameraX = carRef.current.x + carRef.current.width / 2;
            const cameraY = carRef.current.y + carRef.current.height / 2;
            
            // Translate to center of canvas
            ctx.translate(canvas.width / 2, canvas.height / 2);
            
            // Apply zoom
            ctx.scale(zoom, zoom);
            
            // Translate to center on car
            ctx.translate(-cameraX, -cameraY);

            // Draw track
            trackRef.current?.draw(showBoundingBox);

            let newCar = carRef.current;
            const controls = getControls();
            
            // Update pressed buttons state based on controls
            setPressedButtons({
                forward: controls.forward,
                backward: controls.backward,
                left: controls.left,
                right: controls.right,
                brake: controls.brake,
                reset: controls.restart
            });

            if (isResettingRef.current) {
                isResettingRef.current = false;
                newCar = new gameCar(trackRef.current); // Get fresh copy of car state after reset
            } else {
                // Always process controls
                if (controls.forward) {
                    newCar.speed = Math.min(newCar.speed + newCar.acceleration * deltaTimeSeconds, newCar.maxSpeed);
                } else if (controls.backward) {
                    newCar.speed = Math.max(newCar.speed - newCar.acceleration * deltaTimeSeconds, -newCar.maxSpeed / 2);
                } else if (controls.brake) {
                    if (newCar.speed > 0) {
                        newCar.speed = Math.max(0, newCar.speed - newCar.brakeDeceleration * deltaTimeSeconds);
                    } else if (newCar.speed < 0) {
                        newCar.speed = Math.min(0, newCar.speed + newCar.brakeDeceleration * deltaTimeSeconds);
                    }
                } else {
                    if (newCar.speed > 0) {
                        newCar.speed = Math.max(0, newCar.speed - newCar.deceleration * deltaTimeSeconds);
                    } else if (newCar.speed < 0) {
                        newCar.speed = Math.min(0, newCar.speed + newCar.deceleration * deltaTimeSeconds);
                    }
                }

                if (controls.left) {
                    newCar.angle -= newCar.rotationSpeed * (newCar.speed / newCar.maxSpeed) * deltaTimeSeconds;
                }
                if (controls.right) {
                    newCar.angle += newCar.rotationSpeed * (newCar.speed / newCar.maxSpeed) * deltaTimeSeconds;
                }
            }

            // Normalize angle to 0-360
            newCar.angle = ((newCar.angle % 360) + 360) % 360;

            // Calculate new position using deltaTime
            const newX = newCar.x + Math.cos((newCar.angle * Math.PI) / 180) * fromKmhToPixels(newCar.speed) * deltaTimeSeconds;
            const newY = newCar.y + Math.sin((newCar.angle * Math.PI) / 180) * fromKmhToPixels(newCar.speed) * deltaTimeSeconds;
            
            // Check if new position would cause collision
            const wouldCollide = checkCarCollision(carRef.current, collisionCtx, newX, newY, newCar.angle);
            newCar.hasCollision = wouldCollide;

            // Only update position if it wouldn't cause a collision
            if (!wouldCollide) {
                newCar.x = newX;
                newCar.y = newY;
            } else {
                // If would collide, reduce speed to simulate friction
                newCar.speed *= 0.8 * deltaTimeSeconds;
            }

            // Keep car within canvas bounds
            newCar.x = Math.max(0, Math.min(trackRef.current.trackWidth - newCar.width, newCar.x));
            newCar.y = Math.max(0, Math.min(trackRef.current.trackHeight - newCar.height, newCar.y));

            carRef.current = newCar;

            // Calculate center position once
            const centerX = carRef.current.x + carRef.current.width / 2;
            const centerY = carRef.current.y + carRef.current.height / 2;

            // Calculate ray positions
            const centerRayLength = carRef.current.drawRay(ctx, collisionCtx, centerX, centerY, carRef.current.angle, RAY_LENGTH);
            const leftRayLength = carRef.current.drawRay(ctx, collisionCtx, centerX, centerY, carRef.current.angle - RAY_ANGLE, RAY_LENGTH);
            const rightRayLength = carRef.current.drawRay(ctx, collisionCtx, centerX, centerY, carRef.current.angle + RAY_ANGLE, RAY_LENGTH);
            
            // Update car's ray positions with lengths
            carRef.current.rays = [
                Math.round(centerRayLength * 100) / 100,
                Math.round(leftRayLength * 100) / 100,
                Math.round(rightRayLength * 100) / 100
            ];

            carRef.current.draw(ctx);

            // Restore the context state after drawing everything
            ctx.restore();

            // Draw FPS counter (outside the camera transform)
            fpsCtx.clearRect(0, 0, fpsCanvas.width, fpsCanvas.height);
            fpsCtx.fillText(`FPS: ${fpsRef.current}`, 10, 10);

            // Check if car has passed through current checkpoint
            checkCheckpointPass(carRef.current, trackRef.current, gameStateRef.current ,newCar.x, newCar.y, newCar.angle);

            setStatsBoxState({
                speed: carRef.current.speed,
                angle: carRef.current.angle,
                x: carRef.current.x,
                y: carRef.current.y,
                hasCollision: carRef.current.hasCollision,
                lapTime: gameStateRef.current.lapTime,
                currentCheckpoint: gameStateRef.current.currentCheckpoint,
                totalCheckpoints: gameStateRef.current.totalCheckpoints,
                completedLaps: gameStateRef.current.completedLaps
            });

            lastFrameTimeRef.current = timestamp;

            animationFrameRef.current = requestAnimationFrame(gameLoop);
        };

        animationFrameRef.current = requestAnimationFrame(gameLoop);

        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [showBoundingBox, isGameInitialized, getControls]);

    // Reset game state when returning to menu
    const handleBackToMenu = () => {
        window.location.href = '/';
    };

    // Function to check car's bounding box for collisions
    const checkCarCollision = (car: Car, ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): boolean => {
        const halfWidth = car.width / 2;
        const halfHeight = car.height / 2;
        const rad = (angle * Math.PI) / 180;
        const checkRadius = 1; // Increased radius for better collision detection

        // Calculate the four corners of the car's bounding box relative to the car's center
        const centerX = x + halfWidth;
        const centerY = y + halfHeight;
        
        // Calculate corners relative to center (0,0)
        const corners = [
            { x: -halfHeight, y: -halfWidth }, // top-left
            { x: halfHeight, y: -halfWidth },  // top-right
            { x: -halfHeight, y: halfWidth },  // bottom-left
            { x: halfHeight, y: halfWidth }    // bottom-right
        ];

        // Rotate each corner point around the origin (0,0)
        const rotatedCorners = corners.map(corner => {
            const rotatedX = corner.x * Math.cos(rad) - corner.y * Math.sin(rad);
            const rotatedY = corner.x * Math.sin(rad) + corner.y * Math.cos(rad);
            return {
                x: centerX + rotatedX,
                y: centerY + rotatedY
            };
        });

        // Draw debug points for collision checks only when showBoundingBox is true
        if (showBoundingBox) {
            const debugCtx = canvasRef.current?.getContext('2d');
            if (debugCtx) {
                // Draw corner points and their check radius
                rotatedCorners.forEach((corner) => {
                    // Draw the check radius circle
                    debugCtx.strokeStyle = 'rgba(0, 0, 255, 0.3)';
                    debugCtx.beginPath();
                    debugCtx.arc(corner.x, corner.y, checkRadius, 0, Math.PI * 2);
                    debugCtx.stroke();

                    // Draw the center point
                    debugCtx.fillStyle = 'rgba(0, 0, 255, 0.7)';
                    debugCtx.beginPath();
                    debugCtx.arc(corner.x, corner.y, 2, 0, Math.PI * 2);
                    debugCtx.fill();
                });

                // Draw center point
                debugCtx.fillStyle = 'rgba(0, 255, 0, 0.7)';
                debugCtx.beginPath();
                debugCtx.arc(centerX, centerY, 4, 0, Math.PI * 2);
                debugCtx.fill();
            }
        }

        // Check if any corner's check radius is out of bounds
        const collisionResults = rotatedCorners.map((corner, index) => {
            // Check multiple points in a circle around the corner
            const points = [];
            const numPoints = 8; // Number of points to check around each corner
            for (let i = 0; i < numPoints; i++) {
                const angle = (i / numPoints) * Math.PI * 2;
                points.push({
                    x: corner.x + Math.cos(angle) * checkRadius,
                    y: corner.y + Math.sin(angle) * checkRadius
                });
            }

            return points.some(point => trackRef.current?.isPointColliding(point.x, point.y) ?? true);
        });

        const hasCollision = collisionResults.some(hasCollided => hasCollided);

        return hasCollision;
    };

    // Function to check if car has passed through a checkpoint
    const checkCheckpointPass = (car: Car, track: Track, gameState: RacingGameState, carX: number, carY: number, carAngle: number) => {
        // Determine which checkpoint to check based on current state
        let checkpointIndex = gameState.currentCheckpoint;
        const allCheckpointsPassed = gameState.passedCheckpoints.every(passed => passed);
        
        // If all checkpoints are passed, we're looking for the first checkpoint to complete the lap
        if (allCheckpointsPassed) {
            checkpointIndex = 0;
        }

        const checkpoint = track.checkpoints[checkpointIndex];
        
        // Calculate the front of the car based on its angle
        const carFrontX = carX + car.width / 2 + Math.cos((carAngle * Math.PI) / 180) * (car.height / 2);
        const carFrontY = carY + car.height / 2 + Math.sin((carAngle * Math.PI) / 180) * (car.height / 2);

        // Calculate the vector from checkpoint start to end
        const checkpointVector = {
            x: checkpoint.end.x - checkpoint.start.x,
            y: checkpoint.end.y - checkpoint.start.y
        };

        // Calculate the vector from checkpoint start to car front
        const carVector = {
            x: carFrontX - checkpoint.start.x,
            y: carFrontY - checkpoint.start.y
        };

        // Calculate the cross product to determine which side of the line the car front is on
        const crossProduct = checkpointVector.x * carVector.y - checkpointVector.y * carVector.x;

        // If we have a previous position, check if we've crossed the line
        if (car.previousFront) {
            const previousCarVector = {
                x: car.previousFront.x - checkpoint.start.x,
                y: car.previousFront.y - checkpoint.start.y
            };
            const previousCrossProduct = checkpointVector.x * previousCarVector.y - checkpointVector.y * previousCarVector.x;

            // If the cross products have different signs, we've crossed the line
            if (crossProduct * previousCrossProduct < 0) {
                const newPassedCheckpoints = [...gameState.passedCheckpoints];
                newPassedCheckpoints[checkpointIndex] = true;

                // If we've passed all checkpoints and crossed the first checkpoint again, complete the lap
                if (allCheckpointsPassed && checkpointIndex === 0) {
                    const newState = getInitialGameState(track);
                    newState.completedLaps = gameState.completedLaps + 1;
                    newState.currentCheckpoint = 1;
                    newState.passedCheckpoints[0] = true;
                    newState.lastLapTime = gameState.lapTime;
                    gameStateRef.current = newState;
                } else {
                    // Otherwise, move to the next checkpoint
                    gameStateRef.current = {
                        ...gameState,
                        passedCheckpoints: newPassedCheckpoints,
                        currentCheckpoint: checkpointIndex + 1
                    };
                }
            }
        }

        // Store current position for next frame
        car.previousFront = new Vector(carFrontX, carFrontY);
    };

    const handleButtonPress = (button: keyof typeof pressedButtons) => {
        setPressedButtons(prev => ({ ...prev, [button]: true }));
    };

    const handleButtonRelease = (button: keyof typeof pressedButtons) => {
        setPressedButtons(prev => ({ ...prev, [button]: false }));
    };

    // Handle track change
    const handleTrackChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        setTrackChange(event.target.value);
    };

    if (!isGameInitialized) {
        return (
            <div style={styles.loadingContainer}>
                <h2>Loading game...</h2>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            <canvas
                ref={backgroundCanvasRef}
                width={trackRef.current?.trackWidth ?? 0}
                height={trackRef.current?.trackHeight ?? 0}
                style={styles.hiddenCanvas}
            />
            <canvas
                ref={collisionCanvasRef}
                width={trackRef.current?.trackWidth ?? 0}
                height={trackRef.current?.trackHeight ?? 0}
                style={styles.hiddenCanvas}
            />
            <canvas
                ref={canvasRef}
                width={1000}
                height={700}
                style={styles.canvas}
            />
            <canvas
                ref={fpsCanvasRef}
                style={{
                    position: 'absolute',
                    top: '10px',
                    left: '250px',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    borderRadius: '4px',
                }}
            />
            <div style={{
                position: 'absolute',
                top: '10px',
                left: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
            }}>
                <StatsBox 
                    speed={statsBoxState.speed}
                    angle={statsBoxState.angle}
                    x={statsBoxState.x}
                    y={statsBoxState.y}
                    hasCollision={statsBoxState.hasCollision}
                    lapTime={statsBoxState.lapTime}
                    currentCheckpoint={statsBoxState.currentCheckpoint}
                    totalCheckpoints={statsBoxState.totalCheckpoints}
                    completedLaps={statsBoxState.completedLaps}
                />
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    padding: '15px',
                    borderRadius: '10px',
                }}>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '5px',
                    }}>
                        <button 
                            onMouseDown={() => handleButtonPress('forward')}
                            onMouseUp={() => handleButtonRelease('forward')}
                            onMouseLeave={() => handleButtonRelease('forward')}
                            style={{
                                width: '60px',
                                height: '60px',
                                backgroundColor: pressedButtons.forward ? '#4a4a4a' : '#5a5a5a',
                                border: 'none',
                                borderRadius: '5px',
                                color: 'white',
                                fontSize: '24px',
                                cursor: 'pointer',
                                transform: pressedButtons.forward ? 'scale(0.95)' : 'scale(1)',
                                transition: 'all 0.1s ease',
                            }}>↑</button>
                        <div style={{
                            display: 'flex',
                            gap: '5px',
                        }}>
                            <button 
                                onMouseDown={() => handleButtonPress('left')}
                                onMouseUp={() => handleButtonRelease('left')}
                                onMouseLeave={() => handleButtonRelease('left')}
                                style={{
                                    width: '60px',
                                    height: '60px',
                                    backgroundColor: pressedButtons.left ? '#4a4a4a' : '#5a5a5a',
                                    border: 'none',
                                    borderRadius: '5px',
                                    color: 'white',
                                    fontSize: '24px',
                                    cursor: 'pointer',
                                    transform: pressedButtons.left ? 'scale(0.95)' : 'scale(1)',
                                    transition: 'all 0.1s ease',
                                }}>←</button>
                            <button 
                                onMouseDown={() => handleButtonPress('backward')}
                                onMouseUp={() => handleButtonRelease('backward')}
                                onMouseLeave={() => handleButtonRelease('backward')}
                                style={{
                                    width: '60px',
                                    height: '60px',
                                    backgroundColor: pressedButtons.backward ? '#4a4a4a' : '#5a5a5a',
                                    border: 'none',
                                    borderRadius: '5px',
                                    color: 'white',
                                    fontSize: '24px',
                                    cursor: 'pointer',
                                    transform: pressedButtons.backward ? 'scale(0.95)' : 'scale(1)',
                                    transition: 'all 0.1s ease',
                                }}>↓</button>
                            <button 
                                onMouseDown={() => handleButtonPress('right')}
                                onMouseUp={() => handleButtonRelease('right')}
                                onMouseLeave={() => handleButtonRelease('right')}
                                style={{
                                    width: '60px',
                                    height: '60px',
                                    backgroundColor: pressedButtons.right ? '#4a4a4a' : '#5a5a5a',
                                    border: 'none',
                                    borderRadius: '5px',
                                    color: 'white',
                                    fontSize: '24px',
                                    cursor: 'pointer',
                                    transform: pressedButtons.right ? 'scale(0.95)' : 'scale(1)',
                                    transition: 'all 0.1s ease',
                                }}>→</button>
                        </div>
                    </div>
                    <div style={{
                        display: 'flex',
                        gap: '10px',
                    }}>
                        <button 
                            onMouseDown={() => handleButtonPress('brake')}
                            onMouseUp={() => handleButtonRelease('brake')}
                            onMouseLeave={() => handleButtonRelease('brake')}
                            style={{
                                width: '100px',
                                height: '40px',
                                backgroundColor: pressedButtons.brake ? '#4a4a4a' : '#5a5a5a',
                                border: 'none',
                                borderRadius: '5px',
                                color: 'white',
                                fontSize: '16px',
                                cursor: 'pointer',
                                transform: pressedButtons.brake ? 'scale(0.95)' : 'scale(1)',
                                transition: 'all 0.1s ease',
                            }}>Brake</button>
                        <button 
                            onMouseDown={() => handleButtonPress('reset')}
                            onMouseUp={() => handleButtonRelease('reset')}
                            onMouseLeave={() => handleButtonRelease('reset')}
                            onClick={restartGame}
                            style={{
                                width: '100px',
                                height: '40px',
                                backgroundColor: pressedButtons.reset ? '#4a4a4a' : '#5a5a5a',
                                border: 'none',
                                borderRadius: '5px',
                                color: 'white',
                                fontSize: '16px',
                                cursor: 'pointer',
                                transform: pressedButtons.reset ? 'scale(0.95)' : 'scale(1)',
                                transition: 'all 0.1s ease',
                            }}>Reset</button>
                    </div>
                </div>
            </div>
            <div style={styles.buttonContainer}>
                <button
                    onClick={handleBackToMenu}
                    style={styles.backButton}
                >
                    Back to Menu
                </button>
                <button
                    onClick={() => setShowBoundingBox(!showBoundingBox)}
                    style={{
                        ...styles.boundingBoxButton,
                        ...(showBoundingBox ? styles.showBoundingBox : styles.hideBoundingBox),
                    }}
                >
                    {showBoundingBox ? 'Hide Bounding Box' : 'Show Bounding Box'}
                </button>
                {gameMode === 'player' && (
                    <select
                        value={selectedTrack instanceof GoKartTrackOne ? 'GoKartTrackOne' : 'GoKartTrackTwo'}
                        onChange={handleTrackChange}
                        style={styles.trackSelect}
                    >
                        <option value="GoKartTrackOne">GoKart Track 1</option>
                        <option value="GoKartTrackTwo">GoKart Track 2</option>
                    </select>
                )}
            </div>
            <div style={{
                position: 'absolute',
                top: 'calc(wh - 700px / 2)',
                right: 'calc(ww - 1000px / 2)',
                display: 'flex',
                flexDirection: 'row',
                gap: '10px',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                padding: '10px',
                borderRadius: '5px',
                transform: 'translate(calc(444px), calc(320px))', // Center relative to canvas
            }}>
                <button
                    onClick={() => setZoom(prev => Math.min(prev + 0.1, 2))}
                    style={{
                        width: '40px',
                        height: '40px',
                        backgroundColor: '#5a5a5a',
                        border: 'none',
                        borderRadius: '5px',
                        color: 'white',
                        fontSize: '24px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    +
                </button>
                <button
                    onClick={() => setZoom(prev => Math.max(prev - 0.1, 0.5))}
                    style={{
                        width: '40px',
                        height: '40px',
                        backgroundColor: '#5a5a5a',
                        border: 'none',
                        borderRadius: '5px',
                        color: 'white',
                        fontSize: '24px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    -
                </button>
            </div>
        </div>
    );
};

export default RacingGame; 