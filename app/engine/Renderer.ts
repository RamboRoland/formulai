import type { CarRenderState, RenderSnapshot } from './RenderSnapshot';
import { RAY_ANGLE_OFFSETS, RAY_ORIGINS } from './rays';
import { carPoint } from './carBody';

const RAY_COLOR = 'rgba(255, 255, 0, 0.5)';
const DEBUG_CORNER_STROKE = 'rgba(0, 0, 255, 0.3)';
const DEBUG_CORNER_FILL = 'rgba(0, 0, 255, 0.7)';
const DEBUG_CENTER_FILL = 'rgba(0, 255, 0, 0.7)';
const COLLISION_CHECK_RADIUS = 1;

// Paints one frame from a RenderSnapshot. Zero knowledge of engines, physics,
// or WebSockets — takes a snapshot and writes pixels.
export class Renderer {
    public constructor(
        private readonly canvasCtx: CanvasRenderingContext2D,
        private readonly fpsCtx: CanvasRenderingContext2D,
    ) {
        // One-time FPS overlay setup.
        const fpsCanvas = this.fpsCtx.canvas;
        fpsCanvas.width = 100;
        fpsCanvas.height = 30;
        this.fpsCtx.font = '16px monospace';
        this.fpsCtx.fillStyle = 'white';
        this.fpsCtx.textAlign = 'left';
        this.fpsCtx.textBaseline = 'top';
    }

    public draw(snap: RenderSnapshot): void {
        const canvas = this.canvasCtx.canvas;
        this.canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

        this.canvasCtx.save();
        this.canvasCtx.translate(canvas.width / 2, canvas.height / 2);
        this.canvasCtx.scale(snap.camera.zoom, snap.camera.zoom);
        this.canvasCtx.translate(-snap.camera.focusX, -snap.camera.focusY);

        snap.track.draw(this.canvasCtx, snap.camera.zoom, snap.showBoundingBox);

        for (const car of snap.cars) {
            this.drawCar(car);
            // Rays and collision debug are both gated by the bounding-box
            // toggle — one switch for all debug visualizations.
            if (snap.showBoundingBox) {
                this.drawRays(car);
                this.drawCollisionDebug(car);
            }
        }

        this.canvasCtx.restore();

        this.drawFps(snap.fps);
    }

    private drawCar(car: CarRenderState): void {
        const centerX = car.x + car.widthPx / 2;
        const centerY = car.y + car.lengthPx / 2;
        this.canvasCtx.save();
        this.canvasCtx.translate(centerX, centerY);
        this.canvasCtx.rotate((car.angle * Math.PI) / 180);
        this.canvasCtx.fillStyle = car.color;
        this.canvasCtx.fillRect(-car.lengthPx / 2, -car.widthPx / 2, car.lengthPx, car.widthPx);
        this.canvasCtx.restore();
    }

    private drawRays(car: CarRenderState): void {
        for (let i = 0; i < RAY_ANGLE_OFFSETS.length; i++) {
            // Same origin as GameEngine casts from (a corner or an edge middle).
            const [fx, fy] = RAY_ORIGINS[i];
            const origin = carPoint(car, fx, fy);
            const distance = car.rays[i] ?? 0;
            const angleRad = ((car.angle + RAY_ANGLE_OFFSETS[i]) * Math.PI) / 180;
            const endX = origin.x + Math.cos(angleRad) * distance;
            const endY = origin.y + Math.sin(angleRad) * distance;

            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(origin.x, origin.y);
            this.canvasCtx.lineTo(endX, endY);
            this.canvasCtx.strokeStyle = RAY_COLOR;
            this.canvasCtx.lineWidth = 2;
            this.canvasCtx.stroke();

            this.canvasCtx.beginPath();
            this.canvasCtx.arc(endX, endY, 2, 0, Math.PI * 2);
            this.canvasCtx.fillStyle = RAY_COLOR;
            this.canvasCtx.fill();
        }
    }

    private drawCollisionDebug(car: CarRenderState): void {
        const halfWidth = car.widthPx / 2;
        const halfLength = car.lengthPx / 2;
        const rad = (car.angle * Math.PI) / 180;
        const centerX = car.x + halfWidth;
        const centerY = car.y + halfLength;

        const corners = [
            { x: -halfLength, y: -halfWidth },
            { x:  halfLength, y: -halfWidth },
            { x: -halfLength, y:  halfWidth },
            { x:  halfLength, y:  halfWidth },
        ];
        const rotated = corners.map(c => ({
            x: centerX + c.x * Math.cos(rad) - c.y * Math.sin(rad),
            y: centerY + c.x * Math.sin(rad) + c.y * Math.cos(rad),
        }));

        for (const corner of rotated) {
            this.canvasCtx.strokeStyle = DEBUG_CORNER_STROKE;
            this.canvasCtx.beginPath();
            this.canvasCtx.arc(corner.x, corner.y, COLLISION_CHECK_RADIUS, 0, Math.PI * 2);
            this.canvasCtx.stroke();
            this.canvasCtx.fillStyle = DEBUG_CORNER_FILL;
            this.canvasCtx.beginPath();
            this.canvasCtx.arc(corner.x, corner.y, 2, 0, Math.PI * 2);
            this.canvasCtx.fill();
        }
        this.canvasCtx.fillStyle = DEBUG_CENTER_FILL;
        this.canvasCtx.beginPath();
        this.canvasCtx.arc(centerX, centerY, 4, 0, Math.PI * 2);
        this.canvasCtx.fill();
    }

    private drawFps(fps: number): void {
        const canvas = this.fpsCtx.canvas;
        this.fpsCtx.clearRect(0, 0, canvas.width, canvas.height);
        this.fpsCtx.fillText(`FPS: ${fps}`, 10, 10);
    }
}
