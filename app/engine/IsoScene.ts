import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarRenderState } from './RenderSnapshot';
import type { Prop } from './trackProps';

const MODEL_DIR = '/assets/models/';
const CAR_MODEL = 'raceCar';
const CAR_BODY_MATERIAL = 'red';
const CAMERA_DISTANCE = 5000;
const SHADOW_MAP_SIZE = 4096;
// Casters just outside the view still throw shadows into it.
const SHADOW_MARGIN_PX = 600;
const SHADOW_OPACITY = 0.35;
// Sun path: rises in the east (+x) at 6, south (+y) at 12, sets west at 18.
const SUNRISE_HOUR = 6;
const SUNSET_HOUR = 18;
const MAX_SUN_ELEVATION = (60 * Math.PI) / 180;
const MIN_SUN_ELEVATION = (8 * Math.PI) / 180;
const NOON_SUN_COLOR = new THREE.Color(0xffffff);
const LOW_SUN_COLOR = new THREE.Color(0xffa060);
// Cel shading: three flat light bands.
const TOON_BANDS = [110, 190, 255];

type ModelTemplate = { object: THREE.Object3D; size: THREE.Vector3 };
type CarInstance = { pivot: THREE.Group; bodyMaterial: THREE.MeshToonMaterial | null };

// The 3D layer of the isometric view (Kenney racing kit models): props, cars,
// a sun and the shadows they cast. Visual only — plays no part in physics.
//
// The orthographic camera matches the Renderer's 2D isometric canvas
// transform (rotate isoRotationDeg, then squash Y by isoTilt), so the output
// lines up pixel-for-pixel with the 2D track underneath. Ground is y=0;
// world (x, y) maps to three (X, Z).
export class IsoScene {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.OrthographicCamera();
    private readonly viewDirection: THREE.Vector3;
    private readonly sun = new THREE.DirectionalLight();
    private readonly sunDirection = new THREE.Vector3();
    private readonly ambient = new THREE.HemisphereLight(0xdde8ff, 0x557744, 1.2);
    // Invisible ground that only shows the shadows falling on it.
    private readonly shadowCatcher = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY }),
    );
    private readonly loader = new GLTFLoader();
    private readonly templates = new Map<string, Promise<ModelTemplate>>();
    private readonly toonMaterials = new Map<THREE.Material, THREE.MeshToonMaterial>();
    private readonly gradientMap: THREE.DataTexture;
    private readonly propsGroup = new THREE.Group();
    private props: Prop[] | null = null;
    private carTemplate: ModelTemplate | null = null;
    private readonly cars = new Map<string, CarInstance>();

    public constructor(isoRotationDeg: number, private readonly isoTilt: number) {
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;

        // Camera elevation θ foreshortens the ground plane by sin θ, so
        // sin θ = isoTilt. Azimuth: the world direction that the 2D rotation
        // maps to "screen down" (towards the viewer).
        const elevation = Math.asin(isoTilt);
        const azimuth = (isoRotationDeg * Math.PI) / 180;
        this.viewDirection = new THREE.Vector3(
            Math.sin(azimuth) * Math.cos(elevation),
            Math.sin(elevation),
            Math.cos(azimuth) * Math.cos(elevation),
        );
        this.camera.near = 1;
        this.camera.far = CAMERA_DISTANCE * 2;

        this.gradientMap = new THREE.DataTexture(new Uint8Array(TOON_BANDS), TOON_BANDS.length, 1, THREE.RedFormat);
        this.gradientMap.minFilter = THREE.NearestFilter;
        this.gradientMap.magFilter = THREE.NearestFilter;
        this.gradientMap.needsUpdate = true;

        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
        // Shadow-map texels are ~1 world px; a small bias keeps cars from
        // shadowing themselves. Props don't receive shadows at all (their
        // big flat walls would stripe — "shadow acne"); the toon bands
        // shade them instead.
        this.sun.shadow.bias = -0.001;
        this.sun.shadow.normalBias = 1.5;
        this.shadowCatcher.receiveShadow = true;

        this.scene.add(this.ambient, this.sun, this.sun.target, this.shadowCatcher, this.propsGroup);
        this.setTimeOfDay(15);

        this.template(CAR_MODEL).then(template => { this.carTemplate = template; });
    }

    // Moves the sun along its arc. `hours` in [SUNRISE_HOUR, SUNSET_HOUR].
    public setTimeOfDay(hours: number): void {
        const dayFraction = Math.min(Math.max((hours - SUNRISE_HOUR) / (SUNSET_HOUR - SUNRISE_HOUR), 0), 1);
        const elevation = Math.max(MIN_SUN_ELEVATION, MAX_SUN_ELEVATION * Math.sin(Math.PI * dayFraction));
        // Compass bearing from north (-y), clockwise: east → south → west.
        const bearing = Math.PI / 2 + dayFraction * Math.PI;
        this.sunDirection.set(
            Math.sin(bearing) * Math.cos(elevation),
            Math.sin(elevation),
            -Math.cos(bearing) * Math.cos(elevation),
        );
        const height = elevation / MAX_SUN_ELEVATION;
        this.sun.color.copy(LOW_SUN_COLOR).lerp(NOON_SUN_COLOR, Math.sqrt(height));
        this.sun.intensity = 1.6 + 1.4 * height;
    }

    // Swaps the decorative props (one array per track; same array = no-op).
    public setProps(props: Prop[]): void {
        if (props === this.props) return;
        this.props = props;
        this.propsGroup.clear();
        for (const prop of props) {
            this.template(prop.model).then(template => {
                if (this.props !== props) return;
                const scale = prop.diameterPx / Math.max(template.size.x, template.size.z);
                this.propsGroup.add(this.instance(template, prop.x, prop.y, prop.rotationY, scale));
            });
        }
    }

    // Renders one frame of the 3D layer at canvas size and returns the
    // canvas (transparent where there's nothing 3D or shadowed).
    public render(cars: CarRenderState[], focusX: number, focusY: number, zoom: number, width: number, height: number): HTMLCanvasElement {
        this.syncCars(cars);

        const canvas = this.renderer.domElement;
        if (canvas.width !== width || canvas.height !== height) this.renderer.setSize(width, height, false);

        const focus = new THREE.Vector3(focusX, 0, focusY);
        this.camera.left = -width / 2 / zoom;
        this.camera.right = width / 2 / zoom;
        this.camera.top = height / 2 / zoom;
        this.camera.bottom = -height / 2 / zoom;
        this.camera.position.copy(focus).addScaledVector(this.viewDirection, CAMERA_DISTANCE);
        this.camera.lookAt(focus);
        this.camera.updateProjectionMatrix();

        // Sun and shadow area follow the view: everything visible (the
        // squashed screen height covers 1/isoTilt as much ground) plus a margin.
        const reach = Math.hypot(width, height / this.isoTilt) / 2 / zoom + SHADOW_MARGIN_PX;
        this.sun.target.position.copy(focus);
        this.sun.position.copy(focus).addScaledVector(this.sunDirection, CAMERA_DISTANCE);
        const shadowCamera = this.sun.shadow.camera;
        shadowCamera.left = -reach;
        shadowCamera.right = reach;
        shadowCamera.top = reach;
        shadowCamera.bottom = -reach;
        shadowCamera.near = Math.max(1, CAMERA_DISTANCE - reach * 2);
        shadowCamera.far = CAMERA_DISTANCE + reach * 2;
        shadowCamera.updateProjectionMatrix();
        this.shadowCatcher.position.copy(focus);
        this.shadowCatcher.scale.set(reach * 2, 1, reach * 2);

        this.renderer.render(this.scene, this.camera);
        return canvas;
    }

    public dispose(): void {
        this.renderer.dispose();
        this.renderer.forceContextLoss();
    }

    private syncCars(cars: CarRenderState[]): void {
        const template = this.carTemplate;
        if (!template) return;
        const seen = new Set<string>();
        for (const car of cars) {
            seen.add(car.id);
            let instance = this.cars.get(car.id);
            if (!instance) {
                const pivot = this.instance(template, 0, 0, 0, 1);
                // Own body material per car so each can carry its colour.
                let bodyMaterial: THREE.MeshToonMaterial | null = null;
                pivot.traverse(obj => {
                    const mesh = obj as THREE.Mesh;
                    // Cars drive through prop shadows.
                    mesh.receiveShadow = true;
                    if ((mesh.material as THREE.Material | undefined)?.name !== CAR_BODY_MATERIAL) return;
                    bodyMaterial ??= (mesh.material as THREE.MeshToonMaterial).clone();
                    mesh.material = bodyMaterial;
                });
                instance = { pivot, bodyMaterial };
                this.cars.set(car.id, instance);
                this.scene.add(pivot);
            }
            // Fit inside the car's box (length along model Z, width along X),
            // keeping the model's aspect ratio. Model faces +Z; car angle 0
            // faces world +X.
            instance.pivot.position.set(car.x + car.widthPx / 2, 0, car.y + car.lengthPx / 2);
            instance.pivot.rotation.y = Math.PI / 2 - (car.angle * Math.PI) / 180;
            instance.pivot.scale.setScalar(Math.min(car.lengthPx / template.size.z, car.widthPx / template.size.x));
            instance.bodyMaterial?.color.set(car.color);
        }
        for (const [id, instance] of this.cars) {
            if (seen.has(id)) continue;
            this.scene.remove(instance.pivot);
            this.cars.delete(id);
        }
    }

    // A placed copy of a model (geometry and materials shared).
    private instance(template: ModelTemplate, x: number, y: number, rotationY: number, scale: number): THREE.Group {
        const pivot = new THREE.Group();
        pivot.add(template.object.clone());
        pivot.position.set(x, 0, y);
        pivot.rotation.y = rotationY;
        pivot.scale.setScalar(scale);
        return pivot;
    }

    private template(name: string): Promise<ModelTemplate> {
        let template = this.templates.get(name);
        if (!template) {
            template = this.loader.loadAsync(`${MODEL_DIR}${name}.glb`).then(gltf => {
                const object = gltf.scene;
                // Centre on the ground plane: XZ-centred, base at y=0.
                const box = new THREE.Box3().setFromObject(object);
                const center = box.getCenter(new THREE.Vector3());
                object.position.set(-center.x, -box.min.y, -center.z);
                object.traverse(obj => {
                    const mesh = obj as THREE.Mesh;
                    if (!mesh.isMesh) return;
                    mesh.castShadow = true;
                    mesh.material = this.toon(mesh.material as THREE.MeshStandardMaterial);
                });
                return { object, size: box.getSize(new THREE.Vector3()) };
            });
            this.templates.set(name, template);
        }
        return template;
    }

    private toon(source: THREE.MeshStandardMaterial): THREE.MeshToonMaterial {
        let material = this.toonMaterials.get(source);
        if (!material) {
            material = new THREE.MeshToonMaterial({
                name: source.name,
                color: source.color,
                map: source.map,
                gradientMap: this.gradientMap,
            });
            this.toonMaterials.set(source, material);
        }
        return material;
    }
}
