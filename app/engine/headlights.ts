import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';
import type { CarRenderState } from './RenderSnapshot';

// One car's headlights: per lamp a forward spot light that lights the 3D
// world, plus a glow sprite so the lamp reads from any camera. Lamps sit on
// the body where the front wheels attach (Scene3D.headlightPoints). Off =
// intensity 0 (the lights stay, so toggling doesn't recompile shaders).

// A lamp's world position: (x, y) on the ground plane, height above it.
export type HeadlightMount = { x: number; y: number; height: number };

const LAMPS = 2;
const COLOR = 0xfff2cc;
const INTENSITY = 2.5; // per lamp
const REACH_PX = fromMetersToPixels(12.5);
const AIM_AHEAD_PX = fromMetersToPixels(6);
const CONE = 0.25;     // half angle, radians
const PENUMBRA = 0.6;
const GLOW_SIZE = 0.35; // × car width

let glowTexture: THREE.Texture | null = null;
const getGlowTexture = (): THREE.Texture => {
    if (glowTexture) return glowTexture;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 240, 200, 0.8)');
    gradient.addColorStop(1, 'rgba(255, 220, 150, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    glowTexture = new THREE.CanvasTexture(canvas);
    return glowTexture;
};

export class Headlights {
    private readonly lights: THREE.SpotLight[];
    private readonly glows: THREE.Sprite[];
    private readonly glowMaterial = new THREE.SpriteMaterial({
        map: getGlowTexture(),
        color: COLOR,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });

    public constructor(private readonly scene: THREE.Scene) {
        this.lights = Array.from({ length: LAMPS }, () => new THREE.SpotLight(COLOR, 0, REACH_PX, CONE, PENUMBRA, 0));
        this.glows = Array.from({ length: LAMPS }, () => new THREE.Sprite(this.glowMaterial));
        scene.add(...this.lights, ...this.lights.map(light => light.target), ...this.glows);
    }

    // `mounts`: lamp positions (one per lamp); they shine along the car's heading.
    public update(mounts: HeadlightMount[], car: CarRenderState, on: boolean): void {
        const rad = (car.angle * Math.PI) / 180;
        const forwardX = Math.cos(rad);
        const forwardY = Math.sin(rad);
        this.lights.forEach((light, i) => {
            const mount = mounts[i];
            const lit = on && !!mount;
            light.intensity = lit ? INTENSITY : 0;
            this.glows[i].visible = lit;
            if (!lit) return;
            light.position.set(mount.x, mount.height, mount.y);
            light.target.position.set(mount.x + forwardX * AIM_AHEAD_PX, 0, mount.y + forwardY * AIM_AHEAD_PX);
            this.glows[i].position.copy(light.position);
            this.glows[i].scale.setScalar(car.widthPx * GLOW_SIZE);
        });
    }

    public dispose(): void {
        this.scene.remove(...this.lights, ...this.lights.map(light => light.target), ...this.glows);
        this.glowMaterial.dispose();
    }
}
