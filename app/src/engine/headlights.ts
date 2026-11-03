import * as THREE from 'three';
import { fromMetersToPixels } from '~/helper';
import type { CarRenderState } from './RenderSnapshot';

// Car headlights in the 3D world: one forward spot light per car (by id),
// created the first time the car shows up and then kept. three.js bakes the
// number of lights into every shader, so removing a light (a car finishing,
// leaving, crashing) recompiled all materials; instead a car that can't
// shine keeps its light at intensity 0. Headlights switched off hide every
// light (no light at all). The count only changes when they are toggled or a
// car with a new id appears.

// The headlight's world position: (x, y) on the ground plane, height above it.
export type HeadlightMount = { x: number; y: number; height: number };
// mount null = the car can't shine now (wrecked, model not loaded).
export type LitCar = { car: CarRenderState; mount: HeadlightMount | null };

const COLOR = 0xfff2cc;
const INTENSITY = 4;
const REACH_PX = fromMetersToPixels(12.5);
const AIM_AHEAD_PX = fromMetersToPixels(6);
const CONE = 0.25;     // half angle, radians
const PENUMBRA = 0.6;

export class Headlights {
    private readonly lights = new Map<string, THREE.SpotLight>();

    public constructor(private readonly scene: THREE.Scene) {}

    // `cars`: every car in this frame. Lights of cars not in it stay at 0.
    public update(cars: LitCar[], on: boolean): void {
        const shining = new Map<string, LitCar>();
        for (const lit of cars) {
            if (!this.lights.has(lit.car.id)) {
                const light = new THREE.SpotLight(COLOR, 0, REACH_PX, CONE, PENUMBRA, 0);
                this.scene.add(light, light.target);
                this.lights.set(lit.car.id, light);
            }
            if (lit.mount) shining.set(lit.car.id, lit);
        }
        for (const [id, light] of this.lights) {
            light.visible = on;
            const lit = shining.get(id);
            light.intensity = lit ? INTENSITY : 0;
            if (!lit?.mount) continue;
            const rad = (lit.car.angle * Math.PI) / 180;
            light.position.set(lit.mount.x, lit.mount.height, lit.mount.y);
            light.target.position.set(lit.mount.x + Math.cos(rad) * AIM_AHEAD_PX, 0, lit.mount.y + Math.sin(rad) * AIM_AHEAD_PX);
        }
    }
}
