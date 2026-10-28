import type { CarRenderState, RenderSnapshot } from './RenderSnapshot';
import { RAY_ANGLE_OFFSETS, RAY_ORIGINS } from './rays';
import { carPoint } from './carBody';
import { Scene3D, GRASS_COLOR, type CameraMode } from './Scene3D';
import { placeTrackProps, type Prop } from './trackProps';
import type { Track } from '~/tracks/Track';
import { fromMetersToPixels } from '~/helper';

const RAY_COLOR = 'rgba(255, 255, 0, 0.5)';
const DEBUG_CORNER_STROKE = 'rgba(0, 0, 255, 0.3)';
const DEBUG_CORNER_FILL = 'rgba(0, 0, 255, 0.7)';
const DEBUG_CENTER_FILL = 'rgba(0, 255, 0, 0.7)';
const COLLISION_CHECK_RADIUS = 1;
// Isometric view: rotate the world, then squash its Y axis. View-only —
// all game coordinates stay top-down.
const ISO_ROTATION_DEG = 45;
const ISO_TILT = 0.5;
// Night on the 2D track (isometric): a tint as dark as the 3D lighting, and
// headlight beams painted on top.
const NIGHT_TINT = 'rgba(8, 12, 35, ALPHA)';
const NIGHT_TINT_MAX = 0.75;
const BEAM_LENGTH_PX = fromMetersToPixels(9);
const BEAM_HALF_ANGLE = 0.25;
const BEAM_ALPHA = 0.45;

// Paints one frame from a RenderSnapshot. Zero knowledge of engines, physics,
// or WebSockets — takes a snapshot and writes pixels.
//
// Isometric layers: grass + the 2D track (Track.draw, isometric canvas
// transform), then the 3D layer (models, sun shadows), then debug overlays.
// Chase / cockpit / orbit / free views are all 3D (no debug overlays).
export class Renderer {
    private readonly scene = new Scene3D(ISO_ROTATION_DEG, ISO_TILT);
    private cameraMode: CameraMode = 'isometric';
    private headlightsOn = false;
    private readonly trackProps = new WeakMap<Track, Prop[]>();

    public constructor(
        private readonly canvasCtx: CanvasRenderingContext2D,
        private readonly fpsCtx: CanvasRenderingContext2D,
    ) {
        this.scene.attachFreeControls(this.canvasCtx.canvas);

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

    // Distance fog, 0 (none) – 1 (thick). Rain, 0 (dry) – 1 (skyfall).
    public setFog(amount: number): void {
        this.scene.setFog(amount);
    }

    public setRain(amount: number): void {
        this.scene.setRain(amount);
    }

    // Reflections on the track surface, 0 (none) – 1 (mirror-like).
    public setReflections(amount: number): void {
        this.scene.setReflections(amount);
    }

    public setCameraMode(mode: CameraMode): void {
        this.cameraMode = mode;
    }

    public setHeadlights(on: boolean): void {
        this.headlightsOn = on;
        this.scene.setHeadlights(on);
    }

    // See-through mode: cars visible through props in front of them.
    public setSeeThrough(enabled: boolean): void {
        this.scene.setSeeThrough(enabled);
    }

    public dispose(): void {
        this.scene.dispose();
    }

    public draw(snap: RenderSnapshot): void {
        const canvas = this.canvasCtx.canvas;
        const zoom = snap.camera.zoom;
        this.scene.setProps(this.propsFor(snap.track));
        const view = {
            mode: this.cameraMode, track: snap.track, followId: snap.selfId,
            focusX: snap.camera.focusX, focusY: snap.camera.focusY, zoom, transition: snap.camera.transition,
        };
        // Chase / cockpit need a car to ride with; orbit / free don't.
        if (this.cameraMode === 'free' || this.cameraMode === 'orbit'
            || (this.cameraMode !== 'isometric' && snap.cars.some(car => car.id === snap.selfId))) {
            this.canvasCtx.drawImage(this.scene.render(snap.cars, view, canvas.width, canvas.height), 0, 0);
            this.drawFps(snap.fps);
            return;
        }

        this.canvasCtx.fillStyle = GRASS_COLOR;
        this.canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

        this.canvasCtx.save();
        this.canvasCtx.translate(canvas.width / 2, canvas.height / 2);
        this.canvasCtx.scale(zoom, zoom);
        this.canvasCtx.scale(1, ISO_TILT);
        this.canvasCtx.rotate((ISO_ROTATION_DEG * Math.PI) / 180);
        this.canvasCtx.translate(-snap.camera.focusX, -snap.camera.focusY);

        snap.track.draw(this.canvasCtx, zoom, snap.showBoundingBox);
        this.drawNight(snap.cars);

        const layer3d = this.scene.render(snap.cars, { ...view, mode: 'isometric' }, canvas.width, canvas.height);
        this.canvasCtx.save();
        this.canvasCtx.resetTransform();
        this.canvasCtx.drawImage(layer3d, 0, 0);
        this.canvasCtx.restore();

        for (const car of snap.cars) {
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

    // Darken the 2D layer to match the 3D night, then light it where the
    // headlights point (world space, isometric transform active).
    private drawNight(cars: CarRenderState[]): void {
        const darkness = this.scene.darkness;
        if (darkness <= 0) return;
        const canvas = this.canvasCtx.canvas;
        this.canvasCtx.save();
        this.canvasCtx.resetTransform();
        this.canvasCtx.fillStyle = NIGHT_TINT.replace('ALPHA', String(NIGHT_TINT_MAX * darkness));
        this.canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        this.canvasCtx.restore();
        if (!this.headlightsOn) return;

        this.canvasCtx.save();
        this.canvasCtx.globalCompositeOperation = 'lighter';
        // One cone per car, from where its headlight sits (as in 3D).
        for (const car of cars) {
            const lamp = this.scene.headlightPoint(car);
            if (!lamp) continue;
            const rad = (car.angle * Math.PI) / 180;
            const gradient = this.canvasCtx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, BEAM_LENGTH_PX);
            gradient.addColorStop(0, `rgba(255, 235, 180, ${BEAM_ALPHA * darkness})`);
            gradient.addColorStop(1, 'rgba(255, 235, 180, 0)');
            this.canvasCtx.fillStyle = gradient;
            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(lamp.x, lamp.y);
            this.canvasCtx.arc(lamp.x, lamp.y, BEAM_LENGTH_PX, rad - BEAM_HALF_ANGLE, rad + BEAM_HALF_ANGLE);
            this.canvasCtx.closePath();
            this.canvasCtx.fill();
        }
        this.canvasCtx.restore();
    }

    private propsFor(track: Track): Prop[] {
        let props = this.trackProps.get(track);
        if (!props) {
            props = placeTrackProps(track);
            this.trackProps.set(track, props);
        }
        return props;
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
