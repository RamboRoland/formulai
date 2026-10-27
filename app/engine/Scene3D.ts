import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CarRenderState } from './RenderSnapshot';
import type { Prop } from './trackProps';
import { CollisionEffects } from './collisionEffects';
import type { Track } from '~/tracks/Track';
import { fromMetersToPixels } from '~/helper';

export type CameraMode = 'isometric' | 'chase' | 'cockpit';
export const CAMERA_MODES: CameraMode[] = ['isometric', 'chase', 'cockpit'];
// Ground outside the track (2D canvas, track texture and 3D ground plane).
export const GRASS_COLOR = '#6f9e4c';

export type SceneView = {
    mode: CameraMode;
    track: Track;
    followId?: string;  // car the chase / cockpit camera rides with
    focusX: number;     // isometric camera centre + zoom
    focusY: number;
    zoom: number;
    transition: number; // followId just changed: eased 0 → 1 glide from the old car's camera
};

const MODEL_DIR = '/assets/models/';
// Race car nodes turned by the steering (wheelAngle).
const FRONT_WHEEL_NODES = ['wheelFrontLeft', 'wheelFrontRight'];
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
// Chase camera: behind and above the car, looking a little ahead of it.
const CHASE_BEHIND_PX = fromMetersToPixels(5);
const CHASE_HEIGHT_PX = fromMetersToPixels(2.2);
const CHASE_LOOK_AHEAD_PX = fromMetersToPixels(4);
const CHASE_FOV = 60;
// Cockpit camera: the driver's eye, just behind the car's centre.
const COCKPIT_EYE_HEIGHT_PX = fromMetersToPixels(1);
const COCKPIT_EYE_BACK = 0.2; // × car length
const COCKPIT_LOOK_AHEAD_PX = fromMetersToPixels(10);
const COCKPIT_FOV = 75;
// Perspective views: shadows within this distance, sky and haze beyond.
// (One shadow map: a smaller area keeps the shadows near the car crisp.)
const PERSPECTIVE_SHADOW_REACH_PX = fromMetersToPixels(50);
const SKY_COLOR = new THREE.Color(0x9fd4ff);
const FOG_NEAR_PX = fromMetersToPixels(80);
const FOG_FAR_PX = fromMetersToPixels(350);
const GROUND_SIZE_PX = fromMetersToPixels(5000);
// The 2D track baked into a ground texture for the perspective views.
const TRACK_TEXTURE_MAX_SIZE = 4096;
const TRACK_TEXTURE_MAX_TEXELS_PER_PX = 2;
const TRACK_TEXTURE_MARGIN_PX = fromMetersToPixels(10);

type ModelTemplate = { object: THREE.Object3D; size: THREE.Vector3 };
type CarInstance = { pivot: THREE.Group; bodyMaterial: THREE.MeshToonMaterial | null; frontWheels: THREE.Object3D[]; colliding: boolean };

// The 3D world (Kenney racing kit models): props, cars, a sun and the
// shadows they cast. Visual only — plays no part in physics. Ground is y=0;
// world (x, y) maps to three (X, Z).
//
// Isometric mode: a transparent layer over the Renderer's 2D track. Its
// orthographic camera matches the 2D isometric canvas transform (rotate
// isoRotationDeg, then squash Y by isoTilt), so it lines up pixel-for-pixel;
// the ground is an invisible shadow catcher.
// Chase / cockpit: a perspective camera on the followed car; the ground is a
// grass plane plus the 2D track (Track.draw) baked into a texture.
export class Scene3D {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.OrthographicCamera();
    private readonly perspectiveCamera = new THREE.PerspectiveCamera(CHASE_FOV, 1, 1, FOG_FAR_PX * 2);
    private readonly fog = new THREE.Fog(SKY_COLOR, FOG_NEAR_PX, FOG_FAR_PX);
    private readonly viewDirection: THREE.Vector3;
    private readonly sun = new THREE.DirectionalLight();
    private readonly sunDirection = new THREE.Vector3();
    private readonly ambient = new THREE.HemisphereLight(0xdde8ff, 0x557744, 1.2);
    // Invisible ground that only shows the shadows falling on it.
    private readonly shadowCatcher = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.ShadowMaterial({ opacity: SHADOW_OPACITY }),
    );
    private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshToonMaterial>;
    private readonly trackSurface: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshToonMaterial>;
    private trackSurfaceFor: Track | null = null;
    private readonly loader = new GLTFLoader();
    private readonly templates = new Map<string, Promise<ModelTemplate>>();
    private readonly toonMaterials = new Map<THREE.Material, THREE.MeshToonMaterial>();
    private readonly gradientMap: THREE.DataTexture;
    private readonly propsGroup = new THREE.Group();
    private props: Prop[] | null = null;
    private carTemplate: ModelTemplate | null = null;
    private readonly cars = new Map<string, CarInstance>();
    private readonly collisionEffects = new CollisionEffects(this.scene);
    private lastRenderSeconds: number | null = null;
    // Chase / cockpit: car the camera was on last frame, and the camera pose
    // a change of car glides from (null = settled).
    private followId: string | undefined;
    private switchFrom: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null;

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

        // Ground just below the track texture so the two never z-fight.
        this.ground = new THREE.Mesh(
            new THREE.PlaneGeometry(GROUND_SIZE_PX, GROUND_SIZE_PX).rotateX(-Math.PI / 2),
            new THREE.MeshToonMaterial({ color: GRASS_COLOR, gradientMap: this.gradientMap }),
        );
        this.ground.position.y = -1;
        this.trackSurface = new THREE.Mesh(
            new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
            new THREE.MeshToonMaterial({ gradientMap: this.gradientMap }),
        );
        this.ground.receiveShadow = true;
        this.trackSurface.receiveShadow = true;

        this.scene.add(this.ambient, this.sun, this.sun.target, this.shadowCatcher, this.ground, this.trackSurface, this.propsGroup);
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

    // Renders one frame at canvas size and returns the canvas. Isometric:
    // transparent where there's nothing 3D or shadowed. Chase / cockpit: the
    // whole picture (falls back to isometric without a car to follow).
    public render(cars: CarRenderState[], view: SceneView, width: number, height: number): HTMLCanvasElement {
        const now = performance.now() / 1000;
        this.syncCars(cars, now);
        this.collisionEffects.update(now, this.lastRenderSeconds === null ? 0 : Math.min(now - this.lastRenderSeconds, 0.1));
        this.lastRenderSeconds = now;

        const canvas = this.renderer.domElement;
        if (canvas.width !== width || canvas.height !== height) this.renderer.setSize(width, height, false);

        const follow = view.mode === 'isometric' ? undefined : cars.find(car => car.id === view.followId);
        this.shadowCatcher.visible = !follow;
        this.ground.visible = !!follow;
        this.trackSurface.visible = !!follow;
        this.scene.background = follow ? SKY_COLOR : null;
        this.scene.fog = follow ? this.fog : null;

        let camera: THREE.Camera;
        const shadowCenter = new THREE.Vector3();
        let reach: number;
        if (!follow) {
            this.followId = undefined;
            this.switchFrom = null;
        } else if (follow.id !== this.followId) {
            if (this.followId !== undefined) {
                this.switchFrom = {
                    position: this.perspectiveCamera.position.clone(),
                    quaternion: this.perspectiveCamera.quaternion.clone(),
                };
            }
            this.followId = follow.id;
        }
        if (follow) {
            this.bakeTrackSurface(view.track);
            const centerX = follow.x + follow.widthPx / 2;
            const centerY = follow.y + follow.lengthPx / 2;
            const forwardX = Math.cos((follow.angle * Math.PI) / 180);
            const forwardY = Math.sin((follow.angle * Math.PI) / 180);
            const cam = this.perspectiveCamera;
            if (view.mode === 'chase') {
                cam.fov = CHASE_FOV;
                cam.position.set(centerX - forwardX * CHASE_BEHIND_PX, CHASE_HEIGHT_PX, centerY - forwardY * CHASE_BEHIND_PX);
                cam.lookAt(centerX + forwardX * CHASE_LOOK_AHEAD_PX, 0, centerY + forwardY * CHASE_LOOK_AHEAD_PX);
            } else {
                const back = follow.lengthPx * COCKPIT_EYE_BACK;
                cam.fov = COCKPIT_FOV;
                cam.position.set(centerX - forwardX * back, COCKPIT_EYE_HEIGHT_PX, centerY - forwardY * back);
                cam.lookAt(centerX + forwardX * COCKPIT_LOOK_AHEAD_PX, 0, centerY + forwardY * COCKPIT_LOOK_AHEAD_PX);
            }
            if (this.switchFrom && view.transition < 1) {
                cam.position.lerpVectors(this.switchFrom.position, cam.position, view.transition);
                cam.quaternion.slerpQuaternions(this.switchFrom.quaternion, cam.quaternion, view.transition);
            } else {
                this.switchFrom = null;
            }
            cam.aspect = width / height;
            cam.updateProjectionMatrix();
            camera = cam;
            // Shadows where the camera looks: mostly ahead of the car.
            reach = PERSPECTIVE_SHADOW_REACH_PX;
            shadowCenter.set(centerX + forwardX * reach * 0.6, 0, centerY + forwardY * reach * 0.6);
        } else {
            shadowCenter.set(view.focusX, 0, view.focusY);
            this.camera.left = -width / 2 / view.zoom;
            this.camera.right = width / 2 / view.zoom;
            this.camera.top = height / 2 / view.zoom;
            this.camera.bottom = -height / 2 / view.zoom;
            this.camera.position.copy(shadowCenter).addScaledVector(this.viewDirection, CAMERA_DISTANCE);
            this.camera.lookAt(shadowCenter);
            this.camera.updateProjectionMatrix();
            camera = this.camera;
            // Everything visible (the squashed screen height covers
            // 1/isoTilt as much ground) plus a margin.
            reach = Math.hypot(width, height / this.isoTilt) / 2 / view.zoom + SHADOW_MARGIN_PX;
        }

        // Sun and shadow area follow the view.
        this.sun.target.position.copy(shadowCenter);
        this.sun.position.copy(shadowCenter).addScaledVector(this.sunDirection, CAMERA_DISTANCE);
        const shadowCamera = this.sun.shadow.camera;
        shadowCamera.left = -reach;
        shadowCamera.right = reach;
        shadowCamera.top = reach;
        shadowCamera.bottom = -reach;
        shadowCamera.near = Math.max(1, CAMERA_DISTANCE - reach * 2);
        shadowCamera.far = CAMERA_DISTANCE + reach * 2;
        shadowCamera.updateProjectionMatrix();
        this.shadowCatcher.position.copy(shadowCenter);
        this.shadowCatcher.scale.set(reach * 2, 1, reach * 2);
        this.ground.position.x = shadowCenter.x;
        this.ground.position.z = shadowCenter.z;

        this.renderer.render(this.scene, camera);
        return canvas;
    }

    // The 2D track exactly as Track.draw paints it (on grass), baked once
    // per track into the ground texture for the perspective views.
    private bakeTrackSurface(track: Track): void {
        if (this.trackSurfaceFor === track) return;
        this.trackSurfaceFor = track;
        const minX = track.bounds.minX - TRACK_TEXTURE_MARGIN_PX;
        const minY = track.bounds.minY - TRACK_TEXTURE_MARGIN_PX;
        const widthPx = track.bounds.maxX - track.bounds.minX + TRACK_TEXTURE_MARGIN_PX * 2;
        const heightPx = track.bounds.maxY - track.bounds.minY + TRACK_TEXTURE_MARGIN_PX * 2;
        const texelsPerPx = Math.min(TRACK_TEXTURE_MAX_TEXELS_PER_PX, TRACK_TEXTURE_MAX_SIZE / Math.max(widthPx, heightPx));

        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(widthPx * texelsPerPx);
        canvas.height = Math.ceil(heightPx * texelsPerPx);
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = GRASS_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.scale(texelsPerPx, texelsPerPx);
        ctx.translate(-minX, -minY);
        track.draw(ctx, texelsPerPx);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        const material = this.trackSurface.material;
        material.map?.dispose();
        material.map = texture;
        material.needsUpdate = true;
        this.trackSurface.position.set(minX + widthPx / 2, 0, minY + heightPx / 2);
        this.trackSurface.scale.set(widthPx, 1, heightPx);
    }

    public dispose(): void {
        this.collisionEffects.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
    }

    // `now` (seconds): hasCollision turning true → explosion + smoke there.
    private syncCars(cars: CarRenderState[], now: number): void {
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
                const frontWheels = FRONT_WHEEL_NODES.flatMap(name => pivot.getObjectByName(name) ?? []);
                instance = { pivot, bodyMaterial, frontWheels, colliding: car.hasCollision };
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
            if (car.hasCollision && !instance.colliding) {
                this.collisionEffects.spawn(car.x + car.widthPx / 2, car.y + car.lengthPx / 2, car.lengthPx, now);
            }
            instance.colliding = car.hasCollision;
            // + wheelAngle = right = clockwise from above = −Y rotation.
            for (const wheel of instance.frontWheels) wheel.rotation.y = (-car.wheelAngle * Math.PI) / 180;
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
