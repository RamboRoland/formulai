export class Vector {
    constructor(public x: number, public y: number) {}

    // Create a vector from two points
    static fromPoints(start: { x: number, y: number }, end: { x: number, y: number }): Vector {
        return new Vector(end.x - start.x, end.y - start.y);
    }

    // Basic vector operations
    add(v: Vector): Vector {
        return new Vector(this.x + v.x, this.y + v.y);
    }

    subtract(v: Vector): Vector {
        return new Vector(this.x - v.x, this.y - v.y);
    }

    multiply(scalar: number): Vector {
        return new Vector(this.x * scalar, this.y * scalar);
    }

    divide(scalar: number): Vector {
        return new Vector(this.x / scalar, this.y / scalar);
    }

    // Vector properties
    get magnitude(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    get normalized(): Vector {
        const mag = this.magnitude;
        return mag === 0 ? new Vector(0, 0) : this.divide(mag);
    }

    // Angle in radians
    get angle(): number {
        return Math.atan2(this.y, this.x);
    }

    // Angle in degrees
    get angleDegrees(): number {
        return this.angle * (180 / Math.PI);
    }

    // Create a vector from angle and magnitude
    static fromAngle(angle: number, magnitude: number): Vector {
        return new Vector(
            Math.cos(angle) * magnitude,
            Math.sin(angle) * magnitude
        );
    }

    // Distance between two points
    static distance(p1: { x: number, y: number }, p2: { x: number, y: number }): number {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // Dot product
    dot(v: Vector): number {
        return this.x * v.x + this.y * v.y;
    }

    // Clone the vector
    clone(): Vector {
        return new Vector(this.x, this.y);
    }

    // Check if two vectors are equal
    equals(v: Vector): boolean {
        return this.x === v.x && this.y === v.y;
    }
} 