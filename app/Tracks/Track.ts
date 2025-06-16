import type { RefObject } from 'react';
import { Vector } from '../components/Vector';

export abstract class Track {
    protected trackImage: HTMLImageElement | null = null;
    protected collisionMask: HTMLImageElement | null = null;
    protected canvasRef: RefObject<HTMLCanvasElement> | null = null;
    protected collisionCanvasRef: RefObject<HTMLCanvasElement> | null = null;

    // Abstract properties that must be implemented by child classes
    public abstract readonly trackWidth: number;
    public abstract readonly trackHeight: number;
    public abstract readonly finishLineDirection: 'left' | 'right';
    public abstract readonly startPosition: Vector;
    public abstract readonly startAngle: number;
    public abstract readonly checkpoints: { start: Vector, end: Vector }[];
    protected abstract readonly trackImageSrc: string;
    protected abstract readonly collisionMaskSrc: string;

    public setCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.canvasRef = canvas;
    }

    public setCollisionCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.collisionCanvasRef = canvas;
    }

    protected drawCheckpoints(ctx: CanvasRenderingContext2D): void {
        ctx.strokeStyle = '#00FF00'; // Bright green
        ctx.lineWidth = 2;

        this.checkpoints.forEach((checkpoint, index) => {
            if (index == 0) {
                return;
            }

            // Draw the checkpoint line
            ctx.beginPath();
            ctx.moveTo(checkpoint.start.x, checkpoint.start.y);
            ctx.lineTo(checkpoint.end.x, checkpoint.end.y);
            ctx.stroke();
        });
    }

    protected drawFinishLine(ctx: CanvasRenderingContext2D): void {
        const finishLine = this.checkpoints[0]; // Use first checkpoint as finish line
        const CHECKER_SIZE = 4; // Smaller checker size
        const LINE_SPACING = 4; // Space between the two lines
        
        // Calculate the direction vector of the finish line
        const dx = finishLine.end.x - finishLine.start.x;
        const dy = finishLine.end.y - finishLine.start.y;

        const length = Math.sqrt(dx * dx + dy * dy);
        
        // Calculate perpendicular offset for the second line
        // For clockwise tracks, the perpendicular should point inward
        // For counter-clockwise tracks, the perpendicular should point outward
        const directionMultiplier = this.finishLineDirection == 'left' ? -1 : 1;
        const perpX = (dy / length) * CHECKER_SIZE * directionMultiplier;
        const perpY = (-dx / length) * LINE_SPACING * directionMultiplier;

        // Calculate the offset to move the finish line to the side
        const sideOffsetX = (dy / length) * CHECKER_SIZE * directionMultiplier;
        const sideOffsetY = (-dx / length) * CHECKER_SIZE * directionMultiplier;
        
        // Draw two parallel lines of checkers
        for (let line = 0; line < 2; line++) {
            const offsetX = line === 0 ? sideOffsetX : sideOffsetX + perpX;
            const offsetY = line === 0 ? sideOffsetY : sideOffsetY + perpY;
            
            // Calculate number of checkers needed
            const numCheckers = Math.ceil(length / CHECKER_SIZE);
            
            // Draw checkered pattern for this line
            for (let i = 0; i < numCheckers; i++) {
                const t = i / numCheckers;
                const nextT = (i + 1) / numCheckers;
                
                // Calculate start and end points for this checker
                const startX = finishLine.start.x + dx * t + offsetX;
                const startY = finishLine.start.y + dy * t + offsetY;
                const endX = finishLine.start.x + dx * nextT + offsetX;
                const endY = finishLine.start.y + dy * nextT + offsetY;
                
                // Alternate between black and white, with second line starting opposite to first
                ctx.fillStyle = (i + line) % 2 === 0 ? '#FFFFFF' : '#000000';
                
                // Draw the checker
                ctx.beginPath();
                ctx.moveTo(startX, startY);
                ctx.lineTo(endX, endY);
                // Invert the direction for the checker pattern to match the track direction
                ctx.lineTo(endX - dy * CHECKER_SIZE / length * directionMultiplier, endY + dx * CHECKER_SIZE / length * directionMultiplier);
                ctx.lineTo(startX - dy * CHECKER_SIZE / length * directionMultiplier, startY + dx * CHECKER_SIZE / length * directionMultiplier);
                ctx.closePath();
                ctx.fill();
            }
        }
    }

    public loadMedia(): Promise<void> {
        return new Promise((resolve, reject) => {
            let trackLoaded = false;
            let maskLoaded = false;

            const checkInitialization = () => {
                if (trackLoaded && maskLoaded) {
                    resolve();
                }
            };

            const trackImg = new Image();
            trackImg.onload = () => {
                this.trackImage = trackImg;
                trackLoaded = true;
                checkInitialization();
            };
            trackImg.onerror = () => reject(new Error('Failed to load track image'));
            trackImg.src = this.trackImageSrc;

            const maskImg = new Image();
            maskImg.onload = () => {
                this.collisionMask = maskImg;
                maskLoaded = true;
                checkInitialization();
            };
            maskImg.onerror = () => reject(new Error('Failed to load collision mask image'));
            maskImg.src = this.collisionMaskSrc;
        });
    }

    public draw(showBoundingBox: boolean): void {
        const canvas = this.canvasRef?.current;
        const collisionCanvas = this.collisionCanvasRef?.current;
        if (!canvas || !collisionCanvas) return;

        const ctx = canvas.getContext('2d');
        const collisionCtx = collisionCanvas.getContext('2d');
        if (!ctx || !collisionCtx) return;

        // Draw collision mask
        if (collisionCtx && this.collisionMask) {
            collisionCtx.clearRect(0, 0, this.trackWidth, this.trackHeight);
            collisionCtx.drawImage(this.collisionMask, 0, 0, this.trackWidth, this.trackHeight);
        }

        // Draw track
        if (this.trackImage) {
            ctx.drawImage(this.trackImage, 0, 0, this.trackWidth, this.trackHeight);
        }

        // Draw checkpoints
        this.drawCheckpoints(ctx);

        // Draw finish line
        this.drawFinishLine(ctx);

        // Draw bounding box if enabled
        if (showBoundingBox && this.collisionMask) {
            ctx.globalAlpha = 0.3;
            ctx.drawImage(this.collisionMask, 0, 0, this.trackWidth, this.trackHeight);
            ctx.globalAlpha = 1.0;
        }
    }

    public isPointColliding(x: number, y: number): boolean {
        const collisionCanvas = this.collisionCanvasRef?.current;
        if (!collisionCanvas) {
            console.log('No collision canvas found');
            return true;
        }

        const collisionCtx = collisionCanvas.getContext('2d');
        if (!collisionCtx) {
            console.log('No collision context found');
            return true;
        }

        // Ensure coordinates are within bounds
        if (x < 0 || x >= this.trackWidth || y < 0 || y >= this.trackHeight) {
            console.log('Point out of track bounds:', x, y);
            return true;
        }

        try {
            const imageData = collisionCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
            const r = imageData.data[0];
            const g = imageData.data[1];
            const b = imageData.data[2];
            
            // Check if the pixel is black (0,0,0) in the mask - if it is, we're out of bounds
            return r === 0 && g === 0 && b === 0;
        } catch (error) {
            console.error('Error checking pixel:', error);
            return true;
        }
    }
} 