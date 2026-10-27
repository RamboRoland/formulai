import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarRenderState } from './RenderSnapshot';

const MODEL_URL = '/assets/models/raceCar.glb';
const BODY_MATERIAL_NAME = 'red';

// Visual-only 3D car. Renders the GLB with an orthographic camera that matches
// the Renderer's 2D isometric canvas transform (rotate ISO_ROTATION_DEG, then
// squash Y by ISO_TILT), so the image lines up pixel-for-pixel with the car's
// box. Plays no part in physics or collision.
export class CarModelRenderer {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.OrthographicCamera();
    private readonly pivot = new THREE.Group();
    private modelSize: THREE.Vector3 | null = null;
    private bodyMaterial: THREE.MeshStandardMaterial | null = null;
    private canvasSizePx = 0;

    public constructor(isoRotationDeg: number, isoTilt: number) {
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        this.renderer.setClearColor(0x000000, 0);

        // Camera elevation θ foreshortens the ground plane by sin θ, so
        // sin θ = isoTilt. Azimuth: the world direction that the 2D rotation
        // maps to "screen down" (towards the viewer).
        const elevation = Math.asin(isoTilt);
        const azimuth = (isoRotationDeg * Math.PI) / 180;
        this.camera.position.set(
            Math.sin(azimuth) * Math.cos(elevation),
            Math.sin(elevation),
            Math.cos(azimuth) * Math.cos(elevation),
        ).multiplyScalar(1000);
        this.camera.lookAt(0, 0, 0);
        this.camera.near = 1;
        this.camera.far = 2000;

        this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 2);
        sun.position.set(-1, 3, 2);
        this.scene.add(sun);
        this.scene.add(this.pivot);

        new GLTFLoader().load(MODEL_URL, gltf => {
            const model = gltf.scene;
            // Centre the model on the ground plane: XZ-centred, wheels at y=0.
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.set(-center.x, -box.min.y, -center.z);
            this.modelSize = box.getSize(new THREE.Vector3());
            model.traverse(obj => {
                const mesh = obj as THREE.Mesh;
                const material = mesh.material as THREE.MeshStandardMaterial | undefined;
                if (material?.name === BODY_MATERIAL_NAME) this.bodyMaterial = material;
            });
            this.pivot.add(model);
        });
    }

    // Draws the model centred on (screenX, screenY) in canvas pixels. World
    // units are canvas pixels at zoom 1 (same as the 2D track).
    public draw(ctx: CanvasRenderingContext2D, car: CarRenderState, screenX: number, screenY: number, zoom: number): void {
        if (!this.modelSize) return;

        // Fit inside the box (length along model Z, width along X), keeping
        // the model's aspect ratio.
        const scale = Math.min(car.lengthPx / this.modelSize.z, car.widthPx / this.modelSize.x);
        this.pivot.scale.setScalar(scale);
        // Model faces +Z; car angle 0 faces world +X (three X), 90 faces +Y (three Z).
        this.pivot.rotation.y = Math.PI / 2 - (car.angle * Math.PI) / 180;
        this.bodyMaterial?.color.set(car.color);

        const sizePx = Math.ceil(Math.hypot(car.lengthPx, car.widthPx) * zoom) + 8;
        if (sizePx !== this.canvasSizePx) {
            this.canvasSizePx = sizePx;
            this.renderer.setSize(sizePx, sizePx, false);
        }
        const halfWorld = sizePx / 2 / zoom;
        this.camera.left = -halfWorld;
        this.camera.right = halfWorld;
        this.camera.top = halfWorld;
        this.camera.bottom = -halfWorld;
        this.camera.updateProjectionMatrix();

        this.renderer.render(this.scene, this.camera);
        ctx.drawImage(this.renderer.domElement, screenX - sizePx / 2, screenY - sizePx / 2);
    }
}
