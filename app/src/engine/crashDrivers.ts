import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fromMetersToPixels } from '~/helper';
import { DEBRIS_LIFE_SECONDS, DEBRIS_SHRINK_SECONDS } from './collisionEffects';
import { SPECTATOR_MODELS } from './crowd';

// Half the crashed karts throw their driver out of the seat (display only): it flies
// (the model's "fall" clip), lands, runs around in a panic ("sprint") for
// DRIVER_RUN_SECONDS, falls over ("die") and lies there until it shrinks
// away on the wreck's clock. Uses the crowd's character models for now.
// Half of them burn while running: looping flame sprites (the crash's Kenney
// explosion sprites) rise off its body and trail behind it.

type Template = { object: THREE.Object3D; size: THREE.Vector3; animations: THREE.AnimationClip[] };
type Phase = 'flying' | 'running' | 'down';
type Driver = {
    born: number;               // seconds (the crash)
    pivot: THREE.Group;         // feet at its origin
    fullScale: number;
    mixer: THREE.AnimationMixer;
    actions: Record<'fall' | 'sprint' | 'die', THREE.AnimationAction>;
    phase: Phase;
    position: THREE.Vector3;    // world px, the feet
    velocity: THREE.Vector3;    // px/s
    heading: number;            // rad, running direction (three: atan2(x, z))
    turnAt: number;             // seconds, next new direction
    targetHeading: number;
    fallAt: number;             // seconds, it falls over (set on landing)
    lastUpdate: number;
    flames: THREE.Sprite[];
    fire: number;               // 0–1, flames' strength: up while running, dies out after
};

const DRIVER_HEIGHT_M = 1.2;                          // ponytail: the stubby mini characters, eyeballed next to the kart
const SEAT_HEIGHT_M = 0.4;
const DRIVER_CARRY = 0.6;                             // share of the kart's velocity it flies on with
// The flight plays ARC_SPEED × faster than real: up speed × ARC_SPEED,
// gravity × ARC_SPEED² → same height, flight time ÷ ARC_SPEED (the driver
// only; nothing else uses this gravity).
const ARC_SPEED = 2;
const DRIVER_UP: [number, number] = [4 * ARC_SPEED, 6 * ARC_SPEED]; // m/s
const DRIVER_RUN_SECONDS: [number, number] = [3, 7];  // after landing, before falling over
const RUN_SPEED = fromMetersToPixels(6);              // px/s
const SPRINT_PLAYBACK = 1.5;                          // the sprint clip's speed, with RUN_SPEED (was 4 m/s at 1×)
const TURN_EVERY: [number, number] = [0.4, 1.2];      // s between panicked changes of direction
const MAX_TURN = 2.2;                                 // rad, largest change of direction
const TURN_RATE = 8;                                  // rad/s towards the new direction
const LANDING_BRAKE = 6;                              // per second: the flight's speed bleeds into the run
const DRIVER_GRAVITY = fromMetersToPixels(9.81) * ARC_SPEED * ARC_SPEED;
const FADE_SECONDS = 0.15;                            // clip cross-fade
const LAUNCH_CHANCE = 0.5;                            // share of crashes that throw the driver out
const FIRE_CHANCE = 0.5;                              // share of thrown drivers that burn
const FLAMES = 6;                                     // sprites per driver, each looping
const FLAME_SECONDS = 0.45;                           // one flame's life: born at the body, rises, shrinks
const FLAME_SIZE = 0.9;                               // × the driver's height
const FLAME_TRAIL = 0.25;                             // s of the driver's motion a flame lags behind by the end
const FIRE_FADE = 2;                                  // per second, the fire going out once it falls over
const DRIVER_HEIGHT_PX = fromMetersToPixels(DRIVER_HEIGHT_M);
const FLAME_TEXTURES = 9;                             // explosion00.png … explosion08.png

const between = ([min, max]: [number, number]): number => min + Math.random() * (max - min);

export class CrashDrivers {
    private drivers: Driver[] = [];
    private generation = 0; // clear() bumps it: drivers still loading are dropped
    private readonly flameTextures: THREE.Texture[];

    public constructor(
        private readonly scene: THREE.Scene,
        private readonly template: (name: string) => Promise<Template>,
    ) {
        const loader = new THREE.TextureLoader();
        this.flameTextures = Array.from({ length: FLAME_TEXTURES }, (_, i) => {
            const texture = loader.load(`/assets/sprites/explosion${String(i).padStart(2, '0')}.png`);
            texture.colorSpace = THREE.SRGBColorSpace;
            return texture;
        });
    }

    // A driver out of the kart at world (x, y) (three X, Z) at `now`
    // (seconds), flying on with the kart's velocity (three X / Z px/s).
    public eject(now: number, x: number, y: number, carVelocity: THREE.Vector3): void {
        if (Math.random() >= LAUNCH_CHANCE) return;
        const generation = this.generation;
        const model = SPECTATOR_MODELS[Math.floor(Math.random() * SPECTATOR_MODELS.length)];
        this.template(model).then(template => {
            if (generation !== this.generation) return;
            const pivot = new THREE.Group();
            const body = cloneSkinned(template.object);
            pivot.add(body);
            const fullScale = fromMetersToPixels(DRIVER_HEIGHT_M) / template.size.y;
            pivot.scale.setScalar(fullScale);
            this.scene.add(pivot);
            const mixer = new THREE.AnimationMixer(body);
            const action = (name: string) => mixer.clipAction(THREE.AnimationClip.findByName(template.animations, name)!); // every character model has these clips
            const actions = { fall: action('fall'), sprint: action('sprint'), die: action('die') };
            actions.sprint.timeScale = SPRINT_PLAYBACK;
            actions.die.setLoop(THREE.LoopOnce, 1);
            actions.die.clampWhenFinished = true;
            actions.fall.play();
            const out = Math.random() * Math.PI * 2;
            this.drivers.push({
                born: now,
                pivot,
                fullScale,
                mixer,
                actions,
                phase: 'flying',
                position: new THREE.Vector3(x, fromMetersToPixels(SEAT_HEIGHT_M), y),
                velocity: carVelocity.clone().multiplyScalar(DRIVER_CARRY)
                    .add(new THREE.Vector3(Math.sin(out), 0, Math.cos(out)).multiplyScalar(fromMetersToPixels(1)))
                    .setY(fromMetersToPixels(between(DRIVER_UP))),
                heading: out,
                turnAt: 0,
                targetHeading: out,
                fallAt: Infinity,
                lastUpdate: now,
                flames: Array.from({ length: Math.random() < FIRE_CHANCE ? FLAMES : 0 }, () => {
                    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flameTextures[0], transparent: true, depthWrite: false, opacity: 0 }));
                    sprite.visible = false;
                    this.scene.add(sprite);
                    return sprite;
                }),
                fire: 0,
            });
        });
    }

    public update(now: number): void {
        this.drivers = this.drivers.filter(d => {
            const shrink = (now - d.born - DEBRIS_LIFE_SECONDS) / DEBRIS_SHRINK_SECONDS;
            if (shrink >= 1) {
                this.scene.remove(d.pivot);
                d.mixer.stopAllAction();
                this.removeFlames(d);
                return false;
            }
            const dt = Math.min(now - d.lastUpdate, 0.1);
            d.lastUpdate = now;
            if (shrink > 0) d.pivot.scale.setScalar(d.fullScale * (1 - shrink * shrink));
            this.step(d, now, dt);
            d.mixer.update(dt);
            d.pivot.position.copy(d.position);
            d.pivot.rotation.y = d.heading;
            this.burn(d, now, dt);
            return true;
        });
    }

    private step(d: Driver, now: number, dt: number): void {
        if (d.phase === 'flying') {
            d.velocity.y -= DRIVER_GRAVITY * dt;
            d.position.addScaledVector(d.velocity, dt);
            // Faces where it flies.
            if (Math.hypot(d.velocity.x, d.velocity.z) > 1) d.heading = Math.atan2(d.velocity.x, d.velocity.z);
            if (d.position.y > 0) return;
            d.position.y = 0;
            d.velocity.y = 0;
            d.phase = 'running';
            d.targetHeading = d.heading;
            d.turnAt = now + between(TURN_EVERY);
            d.fallAt = now + between(DRIVER_RUN_SECONDS);
            d.actions.sprint.reset().play();
            d.actions.fall.crossFadeTo(d.actions.sprint, FADE_SECONDS, false);
            return;
        }
        if (d.phase === 'running') {
            if (now >= d.fallAt) {
                d.phase = 'down';
                d.velocity.set(0, 0, 0);
                d.actions.die.reset().play();
                d.actions.sprint.crossFadeTo(d.actions.die, FADE_SECONDS, false);
                return;
            }
            if (now >= d.turnAt) {
                d.targetHeading = d.heading + (Math.random() * 2 - 1) * MAX_TURN;
                d.turnAt = now + between(TURN_EVERY);
            }
            const turn = d.targetHeading - d.heading;
            d.heading += Math.sign(turn) * Math.min(Math.abs(turn), TURN_RATE * dt);
            // The landing's speed fades into running at RUN_SPEED.
            const brake = 1 - Math.exp(-LANDING_BRAKE * dt);
            d.velocity.x += (Math.sin(d.heading) * RUN_SPEED - d.velocity.x) * brake;
            d.velocity.z += (Math.cos(d.heading) * RUN_SPEED - d.velocity.z) * brake;
            d.position.addScaledVector(d.velocity, dt);
        }
    }

    // Flames: each loops through FLAME_SECONDS (staggered), born at a random
    // spot on the body, rising to above the head, growing then shrinking,
    // left behind as the driver runs on; a new sprite picture every loop.
    private burn(d: Driver, now: number, dt: number): void {
        d.fire = d.phase === 'running' ? 1 : Math.max(0, d.fire - FIRE_FADE * dt);
        d.flames.forEach((flame, i) => {
            flame.visible = d.fire > 0;
            if (!flame.visible) return;
            const age = now / FLAME_SECONDS + i / FLAMES;
            const t = age % 1;
            const loop = Math.floor(age);
            // Same random values all through one loop (from the loop number).
            const random = (k: number) => (Math.sin((loop * 7 + i) * 12.9898 + k * 78.233) * 43758.5453) % 1;
            const material = flame.material;
            material.map = this.flameTextures[Math.floor(Math.abs(random(1)) * FLAME_TEXTURES)];
            material.rotation = random(2) * Math.PI;
            material.opacity = d.fire * Math.sin(Math.PI * t);
            flame.scale.setScalar(DRIVER_HEIGHT_PX * FLAME_SIZE * d.fire * (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.5))));
            flame.position.set(
                d.position.x + random(3) * DRIVER_HEIGHT_PX * 0.2 - d.velocity.x * FLAME_TRAIL * t,
                DRIVER_HEIGHT_PX * (0.3 + t * 0.9),
                d.position.z + random(4) * DRIVER_HEIGHT_PX * 0.2 - d.velocity.z * FLAME_TRAIL * t,
            );
        });
    }

    private removeFlames(d: Driver): void {
        for (const flame of d.flames) {
            this.scene.remove(flame);
            flame.material.dispose();
        }
    }

    // Removes every driver at once (a new track).
    public clear(): void {
        this.generation++;
        for (const d of this.drivers) {
            this.scene.remove(d.pivot);
            this.removeFlames(d);
        }
        this.drivers = [];
    }
}
