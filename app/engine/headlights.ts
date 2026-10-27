import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';
import type { CarRenderState } from './RenderSnapshot';

// One car's headlight: a single forward spot light that lights the 3D world
// from the front of the body (Scene3D.headlightPoint). Off = not visible, so
// three.js leaves it out of lighting entirely (toggling recompiles shaders).

// The headlight's world position: (x, y) on the ground plane, height above it.
export type HeadlightMount = { x: number; y: number; height: number };

const COLOR = 0xfff2cc;
const INTENSITY = 4;
const REACH_PX = fromMetersToPixels(12.5);
const AIM_AHEAD_PX = fromMetersToPixels(6);
const CONE = 0.25;     // half angle, radians
const PENUMBRA = 0.6;

export class Headlights {
    private readonly light = new THREE.SpotLight(COLOR, INTENSITY, REACH_PX, CONE, PENUMBRA, 0);

    public constructor(private readonly scene: THREE.Scene) {
        this.light.visible = false;
        scene.add(this.light, this.light.target);
    }

    // Shines from `mount` along the car's heading.
    public update(mount: HeadlightMount | null, car: CarRenderState, on: boolean): void {
        this.light.visible = on && mount !== null;
        if (!on || !mount) return;
        const rad = (car.angle * Math.PI) / 180;
        this.light.position.set(mount.x, mount.height, mount.y);
        this.light.target.position.set(mount.x + Math.cos(rad) * AIM_AHEAD_PX, 0, mount.y + Math.sin(rad) * AIM_AHEAD_PX);
    }

    public dispose(): void {
        this.scene.remove(this.light, this.light.target);
    }
}
