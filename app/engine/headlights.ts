import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';
import type { CarRenderState } from './RenderSnapshot';

// Car headlights in the 3D world: a fixed pool of forward spot lights, given
// to the cars nearest to where the view looks. three.js bakes the number of
// lights into every shader, so a per-car light made each crash, respawn or
// car joining / leaving recompile all materials (frames of 60–600 ms with
// 20 cars). The pool keeps the count constant while the lights are on; when
// they are off the whole pool is hidden (no light at all).
// ponytail: cars past the nearest POOL_SIZE get no 3D light (the isometric
// 2D beams still show for every car); add cheap ground decals if needed.

// The headlight's world position: (x, y) on the ground plane, height above it.
export type HeadlightMount = { x: number; y: number; height: number };
export type LitCar = { car: CarRenderState; mount: HeadlightMount };

const POOL_SIZE = 4;
const COLOR = 0xfff2cc;
const INTENSITY = 4;
const REACH_PX = fromMetersToPixels(12.5);
const AIM_AHEAD_PX = fromMetersToPixels(6);
const CONE = 0.25;     // half angle, radians
const PENUMBRA = 0.6;

export class HeadlightPool {
    private readonly lights = Array.from({ length: POOL_SIZE }, () =>
        new THREE.SpotLight(COLOR, INTENSITY, REACH_PX, CONE, PENUMBRA, 0));

    public constructor(scene: THREE.Scene) {
        for (const light of this.lights) {
            light.visible = false;
            scene.add(light, light.target);
        }
    }

    // `on`: headlights switched on. `cars`: cars that can shine (not wrecked);
    // the pool goes to the ones nearest (focusX, focusY). Spare lights while
    // on stay in the pool at intensity 0, so the light count doesn't change.
    public update(cars: LitCar[], focusX: number, focusY: number, on: boolean): void {
        const nearest = on
            ? [...cars]
                .sort((a, b) => Math.hypot(a.mount.x - focusX, a.mount.y - focusY) - Math.hypot(b.mount.x - focusX, b.mount.y - focusY))
                .slice(0, POOL_SIZE)
            : [];
        this.lights.forEach((light, i) => {
            light.visible = on;
            const lit = nearest[i];
            light.intensity = lit ? INTENSITY : 0;
            if (!lit) return;
            const rad = (lit.car.angle * Math.PI) / 180;
            light.position.set(lit.mount.x, lit.mount.height, lit.mount.y);
            light.target.position.set(lit.mount.x + Math.cos(rad) * AIM_AHEAD_PX, 0, lit.mount.y + Math.sin(rad) * AIM_AHEAD_PX);
        });
    }
}
