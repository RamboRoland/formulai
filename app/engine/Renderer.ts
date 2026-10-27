import type { CarRenderState, RenderSnapshot } from './RenderSnapshot';
import { RAY_ANGLE_OFFSETS } from './rays';
import { IsoScene } from './IsoScene';
import { placeTrackProps, type Prop } from './trackProps';
import type { Track } from '~/tracks/Track';

const RAY_COLOR = 'rgba(255, 255, 0, 0.5)';
const DEBUG_CORNER_STROKE = 'rgba(0, 0, 255, 0.3)';
const DEBUG_CORNER_FILL = 'rgba(0, 0, 255, 0.7)';
const DEBUG_CENTER_FILL = 'rgba(0, 255, 0, 0.7)';
const COLLISION_CHECK_RADIUS = 1;
// Ground outside the track.
const GRASS_FILL = '#6f9e4c';
// Isometric view: rotate the world, then squash its Y axis. View-only —
// all game coordinates stay top-down.
const ISO_ROTATION_DEG = 45;
const ISO_TILT = 0.5;

// Paints one frame from a RenderSnapshot. Zero knowledge of engines, physics,
// or WebSockets — takes a snapshot and writes pixels.
//
// Layers: grass + the 2D track (Track.draw, isometric canvas transform), then
// the 3D layer (models, sun shadows), then debug overlays and labels.
export class Renderer {
    private readonly scene = new IsoScene(ISO_ROTATION_DEG, ISO_TILT);
    private readonly trackProps = new WeakMap<Track, Prop[]>();

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

    // Sun position, in hours (6 = sunrise in the east, 18 = sunset in the west).
    public setTimeOfDay(hours: number): void {
        this.scene.setTimeOfDay(hours);
    }

    public dispose(): void {
        this.scene.dispose();
    }

    public draw(snap: RenderSnapshot): void {
        const canvas = this.canvasCtx.canvas;
        const zoom = snap.camera.zoom;
        this.canvasCtx.fillStyle = GRASS_FILL;
        this.canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        this.canvasCtx.save();
        this.canvasCtx.translate(canvas.width / 2, canvas.height / 2);
        this.canvasCtx.scale(zoom, zoom);
        this.canvasCtx.scale(1, ISO_TILT);
        this.canvasCtx.rotate((ISO_ROTATION_DEG * Math.PI) / 180);
        this.canvasCtx.translate(-snap.camera.focusX, -snap.camera.focusY);

        snap.track.draw(this.canvasCtx, zoom, snap.showBoundingBox);

        this.scene.setProps(this.propsFor(snap.track));
        const layer3d = this.scene.render(snap.cars, snap.camera.focusX, snap.camera.focusY, zoom, canvas.width, canvas.height);
        const worldToScreen = this.canvasCtx.getTransform();
        this.canvasCtx.save();
        this.canvasCtx.resetTransform();
        this.canvasCtx.drawImage(layer3d, 0, 0);
        // Labels in screen space so the isometric transform doesn't skew them.
        for (const car of snap.cars) {
            const screen = worldToScreen.transformPoint(new DOMPoint(car.x + car.widthPx / 2, car.y + car.lengthPx / 2));
            this.drawParkedLabel(car, screen.x, screen.y, zoom);
        }
        this.canvasCtx.restore();

        for (const car of snap.cars) {
            // Rays and collision debug are both gated by the bounding-box
            // toggle — one switch for all debug visualizations. Parked cars
            // (frozen in the paddock) skip them regardless, since those rays
            // are stale and the collision debug has no meaning off-track.
            if (snap.showBoundingBox && car.parkedSlot === undefined) {
                this.drawRays(car);
                this.drawCollisionDebug(car);
            }
        }

        this.canvasCtx.restore();

        this.drawFps(snap.fps);
    }

    private propsFor(track: Track): Prop[] {
        let props = this.trackProps.get(track);
        if (!props) {
            props = placeTrackProps(track);
            this.trackProps.set(track, props);
        }
        return props;
    }

    // Parked finisher: label with finish position (1-based) above the car.
    private drawParkedLabel(car: CarRenderState, screenX: number, screenY: number, zoom: number): void {
        if (car.parkedSlot === undefined) return;
        const label = String(car.parkedSlot + 1);
        const footprint = Math.max(car.lengthPx, car.widthPx) * zoom;
        this.canvasCtx.font = 'bold 12px Arial';
        this.canvasCtx.textAlign = 'center';
        this.canvasCtx.textBaseline = 'middle';
        this.canvasCtx.fillStyle = '#000000';
        this.canvasCtx.fillText(label, screenX, screenY - footprint / 2 - 8);
        this.canvasCtx.fillStyle = '#FFFFFF';
        this.canvasCtx.fillText(label, screenX, screenY - footprint / 2 - 9);
    }

    private drawRays(car: CarRenderState): void {
        const centerX = car.x + car.widthPx / 2;
        const centerY = car.y + car.lengthPx / 2;
        for (let i = 0; i < RAY_ANGLE_OFFSETS.length; i++) {
            const distance = car.rays[i] ?? 0;
            const angleRad = ((car.angle + RAY_ANGLE_OFFSETS[i]) * Math.PI) / 180;
            const endX = centerX + Math.cos(angleRad) * distance;
            const endY = centerY + Math.sin(angleRad) * distance;

            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(centerX, centerY);
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
