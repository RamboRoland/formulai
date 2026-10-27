import type { CarRenderState, RenderSnapshot } from './RenderSnapshot';
import { RAY_ANGLE_OFFSETS } from './rays';
import { IsoModelRenderer } from './IsoModelRenderer';
import { placeTrackProps, type Prop } from './trackProps';
import type { Track } from '~/tracks/Track';

const RAY_COLOR = 'rgba(255, 255, 0, 0.5)';
const DEBUG_CORNER_STROKE = 'rgba(0, 0, 255, 0.3)';
const DEBUG_CORNER_FILL = 'rgba(0, 0, 255, 0.7)';
const DEBUG_CENTER_FILL = 'rgba(0, 255, 0, 0.7)';
const COLLISION_CHECK_RADIUS = 1;
const CAR_SHADOW_FILL = 'rgba(0, 0, 0, 0.3)';
// Isometric view: rotate the world, then squash its Y axis. View-only —
// all game coordinates stay top-down.
const ISO_ROTATION_DEG = 45;
const ISO_TILT = 0.5;
const CAR_MODEL = 'raceCar';
const CAR_BODY_MATERIAL = 'red';
// Prop sprites are rendered once at this resolution (max game zoom is 2).
const PROP_SPRITE_PX_PER_WORLD = 2;

// Something drawn as a 3D model, ordered back-to-front by `depth`.
type ModelDrawable = { depth: number; x: number; y: number; draw: (screenX: number, screenY: number) => void };

// Paints one frame from a RenderSnapshot. Zero knowledge of engines, physics,
// or WebSockets — takes a snapshot and writes pixels.
export class Renderer {
    private readonly models = new IsoModelRenderer(ISO_ROTATION_DEG, ISO_TILT);
    private readonly trackProps = new WeakMap<Track, Prop[]>();
    private readonly propSprites = new Map<string, { image: HTMLCanvasElement; groundY: number }>();

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
        this.canvasCtx.scale(1, ISO_TILT);
        this.canvasCtx.rotate((ISO_ROTATION_DEG * Math.PI) / 180);
        this.canvasCtx.translate(-snap.camera.focusX, -snap.camera.focusY);

        snap.track.draw(this.canvasCtx, snap.camera.zoom, snap.showBoundingBox);

        for (const car of snap.cars) this.drawCarShadow(car);

        // Props and cars back-to-front. In the isometric view screen depth
        // grows with world x + y.
        const zoom = snap.camera.zoom;
        const drawables: ModelDrawable[] = [
            ...this.propsFor(snap.track).map(prop => ({
                depth: prop.x + prop.y, x: prop.x, y: prop.y,
                draw: (screenX: number, screenY: number) => this.drawProp(prop, screenX, screenY, zoom),
            })),
            ...snap.cars.map(car => {
                const x = car.x + car.widthPx / 2;
                const y = car.y + car.lengthPx / 2;
                return { depth: x + y, x, y, draw: (screenX: number, screenY: number) => this.drawCarModel(car, screenX, screenY, zoom) };
            }),
        ];
        drawables.sort((a, b) => a.depth - b.depth);
        // Models are drawn in screen space so the isometric transform
        // doesn't skew them.
        const worldToScreen = this.canvasCtx.getTransform();
        this.canvasCtx.save();
        this.canvasCtx.resetTransform();
        for (const drawable of drawables) {
            const screen = worldToScreen.transformPoint(new DOMPoint(drawable.x, drawable.y));
            drawable.draw(screen.x, screen.y);
        }
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

    // The car's box, drawn in world space, doubles as the model's ground shadow.
    private drawCarShadow(car: CarRenderState): void {
        this.canvasCtx.save();
        this.canvasCtx.translate(car.x + car.widthPx / 2, car.y + car.lengthPx / 2);
        this.canvasCtx.rotate((car.angle * Math.PI) / 180);
        this.canvasCtx.fillStyle = CAR_SHADOW_FILL;
        this.canvasCtx.fillRect(-car.lengthPx / 2, -car.widthPx / 2, car.lengthPx, car.widthPx);
        this.canvasCtx.restore();
    }

    private drawCarModel(car: CarRenderState, screenX: number, screenY: number, zoom: number): void {
        const size = this.models.size(CAR_MODEL);
        if (!size) return;
        // Fit inside the box (length along model Z, width along X), keeping
        // the model's aspect ratio. Model faces +Z; car angle 0 faces world +X.
        const scale = Math.min(car.lengthPx / size.z, car.widthPx / size.x);
        const rotationY = Math.PI / 2 - (car.angle * Math.PI) / 180;
        const rendered = this.models.render(CAR_MODEL, rotationY, scale, zoom, { material: CAR_BODY_MATERIAL, color: car.color });
        if (rendered) this.canvasCtx.drawImage(rendered.image, screenX - rendered.image.width / 2, screenY - rendered.groundY);
    }

    // Props never change, so each (model, rotation, size) is rendered once
    // into a cached sprite.
    private drawProp(prop: Prop, screenX: number, screenY: number, zoom: number): void {
        const canvas = this.canvasCtx.canvas;
        const reachPx = prop.diameterPx * 2 * zoom;
        if (screenX < -reachPx || screenY < -reachPx || screenX > canvas.width + reachPx || screenY > canvas.height + reachPx) return;

        const key = `${prop.model}:${prop.rotationY}:${prop.diameterPx}`;
        let sprite = this.propSprites.get(key);
        if (!sprite) {
            const size = this.models.size(prop.model);
            if (!size) return;
            const scale = prop.diameterPx / Math.max(size.x, size.z);
            const rendered = this.models.render(prop.model, prop.rotationY, scale, PROP_SPRITE_PX_PER_WORLD);
            if (!rendered) return;
            const image = document.createElement('canvas');
            image.width = rendered.image.width;
            image.height = rendered.image.height;
            image.getContext('2d')!.drawImage(rendered.image, 0, 0);
            sprite = { image, groundY: rendered.groundY };
            this.propSprites.set(key, sprite);
        }
        const drawScale = zoom / PROP_SPRITE_PX_PER_WORLD;
        const width = sprite.image.width * drawScale;
        const height = sprite.image.height * drawScale;
        this.canvasCtx.drawImage(sprite.image, screenX - width / 2, screenY - sprite.groundY * drawScale, width, height);
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
