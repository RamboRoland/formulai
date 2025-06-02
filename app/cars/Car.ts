import type { Vector } from "~/components/Vector";
import type { Track } from "~/tracks/Track"

export abstract class Car {
    public abstract width: number;
    public abstract height: number;
    public abstract speed: number;
    public abstract acceleration: number;
    public abstract deceleration: number;
    public abstract brakeDeceleration: number;
    public abstract maxSpeed: number;
    public abstract rotationSpeed: number;
    public abstract horsePower: number;

    public x: number;
    public y: number;
    public angle: number;
    public hasCollision: boolean = false;
    public rays: number[] = [0, 0, 0];
    public previousFront: Vector | undefined = undefined;

    public track: Track;

    constructor(track: Track) {
        this.track = track;

        this.x = this.track.startPosition.x;
        this.y = this.track.startPosition.y;
        this.angle = this.track.startAngle;
    }

    public resetCarState(): Car {
        this.x = this.track.startPosition.x;
        this.y = this.track.startPosition.y;
        this.speed = 0;
        this.angle = this.track.startAngle;
        this.hasCollision = false;
        this.rays = [0, 0, 0];
        this.previousFront = undefined;

        return this;
    }

    public draw(ctx: CanvasRenderingContext2D) {
        const centerX = this.x + this.width / 2;
        const centerY = this.y + this.height / 2;

        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate((this.angle * Math.PI) / 180);
        ctx.fillStyle = 'red';
        ctx.fillRect(-this.height / 2, -this.width / 2, this.height, this.width);
        ctx.restore();
    }

    public drawRay(
        ctx: CanvasRenderingContext2D,
        collisionCtx: CanvasRenderingContext2D,
        startX: number,
        startY: number,
        angle: number,
        length: number,
        color: string = 'rgba(255, 255, 0, 0.5)'
    ): number {
        // Check points along the ray until we hit a collision or reach max length
        let currentLength = 0;
        const step = 1; // Check every pixel
        let endX = startX;
        let endY = startY;
    
        while (currentLength < length) {
            const checkX = startX + Math.cos((angle * Math.PI) / 180) * currentLength;
            const checkY = startY + Math.sin((angle * Math.PI) / 180) * currentLength;
    
            // Check if the point is out of bounds
            if (checkX < 0 || checkX >= this.track.trackWidth || checkY < 0 || checkY >= this.track.trackHeight) {
                break;
            }
    
            // Check for collision with black pixel
            try {
                const imageData = collisionCtx.getImageData(Math.floor(checkX), Math.floor(checkY), 1, 1);
                const r = imageData.data[0];
                const g = imageData.data[1];
                const b = imageData.data[2];
                
                if (r === 0 && g === 0 && b === 0) {
                    break;
                }
            } catch (error) {
                console.error('Error checking ray collision:', error);
                break;
            }
    
            endX = checkX;
            endY = checkY;
            currentLength += step;
        }
    
        // Draw the ray up to the collision point
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
    
        // Draw a small circle at the end of the ray
        ctx.beginPath();
        ctx.arc(endX, endY, 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
    
        // Calculate and return the hypotenuse length
        const dx = endX - startX;
        const dy = endY - startY;
        return Math.sqrt(dx * dx + dy * dy);
    };
}