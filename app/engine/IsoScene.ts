import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const MODEL_DIR = '/assets/models/';

type LoadedModel = {
    pivot: THREE.Group;
    size: THREE.Vector3;
    materials: Map<string, THREE.MeshStandardMaterial>;
};

// Visual-only 3D models (Kenney racing kit). Renders a GLB with an
// orthographic camera that matches the Renderer's 2D isometric canvas
// transform (rotate isoRotationDeg, then squash Y by isoTilt), so the image
// lines up pixel-for-pixel with the world. Plays no part in physics.
//
// Model space: ground at y=0, XZ-centred. World (x, y) maps to three (X, Z).
export class IsoModelRenderer {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.OrthographicCamera();
    private readonly models = new Map<string, LoadedModel | null>();
    private readonly loader = new GLTFLoader();
    private canvasSizePx = 0;
    private readonly cosElevation: number;

    public constructor(isoRotationDeg: number, isoTilt: number) {
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
        this.renderer.setClearColor(0x000000, 0);

        // Camera elevation θ foreshortens the ground plane by sin θ, so
        // sin θ = isoTilt. Azimuth: the world direction that the 2D rotation
        // maps to "screen down" (towards the viewer).
        const elevation = Math.asin(isoTilt);
        this.cosElevation = Math.cos(elevation);
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
    }

    // Unscaled model size (x = width, y = height, z = length), or null while
    // loading. First call starts the load.
    public size(name: string): THREE.Vector3 | null {
        return this.get(name)?.size ?? null;
    }

    // Renders `name` and returns the (shared, reused) canvas — draw or copy
    // it before the next render call — plus where the model's ground point
    // lands in it: horizontally centred, `groundY` px from the top.
    // `rotationY` turns the model's +Z towards world angle 90° − rotationY;
    // `pxPerWorld` = output pixels per world pixel; `tint` recolours one
    // material by name.
    public render(
        name: string,
        rotationY: number,
        scale: number,
        pxPerWorld: number,
        tint?: { material: string; color: string },
    ): { image: HTMLCanvasElement; groundY: number } | null {
        const model = this.get(name);
        if (!model) return null;

        model.pivot.scale.setScalar(scale);
        // The camera looks at the origin, so put the bounding-box centre
        // there: a box inside a sphere of radius |size|/2 always fits the
        // square frame below, however tall the model is.
        const halfHeight = (model.size.y * scale) / 2;
        model.pivot.position.y = -halfHeight;
        model.pivot.rotation.y = rotationY;
        if (tint) model.materials.get(tint.material)?.color.set(tint.color);

        const sizePx = Math.ceil(model.size.length() * scale * pxPerWorld) + 8;
        if (sizePx !== this.canvasSizePx) {
            this.canvasSizePx = sizePx;
            this.renderer.setSize(sizePx, sizePx, false);
        }
        const halfWorld = sizePx / 2 / pxPerWorld;
        this.camera.left = -halfWorld;
        this.camera.right = halfWorld;
        this.camera.top = halfWorld;
        this.camera.bottom = -halfWorld;
        this.camera.updateProjectionMatrix();

        this.scene.add(model.pivot);
        this.renderer.render(this.scene, this.camera);
        this.scene.remove(model.pivot);
        // The ground point sits halfHeight below the centre, which the
        // tilted camera shows foreshortened by cos(elevation).
        return { image: this.renderer.domElement, groundY: sizePx / 2 + halfHeight * this.cosElevation * pxPerWorld };
    }

    private get(name: string): LoadedModel | null {
        if (this.models.has(name)) return this.models.get(name)!;
        this.models.set(name, null);
        this.loader.load(`${MODEL_DIR}${name}.glb`, gltf => {
            const model = gltf.scene;
            // Centre the model on the ground plane: XZ-centred, base at y=0.
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.set(-center.x, -box.min.y, -center.z);
            const materials = new Map<string, THREE.MeshStandardMaterial>();
            model.traverse(obj => {
                const material = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
                if (material?.name) materials.set(material.name, material);
            });
            const pivot = new THREE.Group();
            pivot.add(model);
            this.models.set(name, { pivot, size: box.getSize(new THREE.Vector3()), materials });
        });
        return null;
    }
}
