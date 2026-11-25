import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Prop } from './DrawTrack';

// Spectators on the grand stands (Kenney mini characters), drawn instanced:
// one InstancedMesh per stand × character model × material. The characters
// are rigid-skinned (one bone per vertex), so each one is baked once into
// plain geometry in its rest pose; the cheering arms and the hop are turned
// in the vertex shader from per-spectator values, the clothes / hair colours
// picked from a per-model palette atlas. No skeletons, no per-frame JS.
// (Before: a skinned clone per spectator — ~2600 draw calls and ~11 ms of JS
// a frame; `.claude/tasks/render-performance.md`.)

// Seat rows in the stand model's unit space: [tread height, depth from the front edge].
export const STAND_MODELS = ['grandStand', 'grandStandCovered'];
const STAND_ROWS: [number, number][] = [[0.283, 0.363], [0.341, 0.3], [0.4, 0.234], [0.458, 0.17], [0.516, 0.105], [0.574, 0.041], [0.632, -0.05]];
const BLOCKED_SPECTATORS = ['character-female-a', 'character-male-f'];
export const SPECTATOR_MODELS = ['a', 'b', 'c', 'd', 'e', 'f']
    .flatMap(letter => [`character-male-${letter}`, `character-female-${letter}`])
    .filter(model => !BLOCKED_SPECTATORS.includes(model));
const SPECTATOR_HEIGHT = 0.085;  // stand units (a stand is ~9 m wide)
// The treads run between the side walls (±0.446 from the centre) minus the
// reach of a spectator's arm (~0.08).
const SEAT_HALF_WIDTH = 0.37;
const SPECTATOR_SPACING = 0.06; // along a row
const SPECTATOR_FILL = 1;       // share of seats taken
const SPECTATOR_CHEER = 0.6;    // share of them with arms up, waving
// Each cheerer draws its own values from these [min, max] ranges.
// The models rest in a T-pose: rotation 0 = arm straight out sideways, π/2 =
// straight up (through the head). Raise + wave stays within ~0.1–1.0 rad.
const CHEER_ARM_ANGLE: [number, number] = [0.3, 0.7];  // rad, arm raised from horizontal
const CHEER_WAVE_ANGLE: [number, number] = [0.1, 0.3]; // amplitude, rad
const CHEER_WAVE_SPEED: [number, number] = [4, 12];    // rad/s
const CHEER_BURST_SPEED: [number, number] = [0.3, 1.5]; // rad/s, how often the cheer swells and eases
const IDLE_ARM_ANGLE = -1.4;     // rad, arms down (−π/2 hangs straight down), a little out
const SPECTATOR_JUMP = 0.6;     // share of the cheering ones that jump
const JUMP_HEIGHT: [number, number] = [0.008, 0.02]; // stand units (~7–18 cm)
const JUMP_SPEED: [number, number] = [4, 8];         // rad/s of the hop
const CHEER_ARM_OFFSET = 0.8;   // max phase gap between the two arms, rad
// Clothing colours: the characters sample one 8 × 4 palette texture (cell =
// row × 8 + column; row 2 columns 1–7 are green … purple, row 3 columns 0–4 are
// dark grey … white; the rest is skin). A body's clothing cells are swapped for
// other cells of that palette: SPECTATOR_VARIANTS looks per model, stacked as
// bands under the original in one atlas (band 0 = the original, the head's).
const PALETTE_COLUMNS = 8;
const PALETTE_ROWS = 4;
const CLOTHES_COLORS = [17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
const CLOTHES_RECOLORED = CLOTHES_COLORS.filter(cell => cell !== 28); // white is shoes / eyes: kept
const SPECTATOR_VARIANTS = 8;
// Hair colours (palette cells): dark, grey, dark slate, light slate, blonde, ginger, brown.
// Palette cells before this (the top two rows) are empty / pink: character-male-b
// lays its texture out differently and is left as it is.
const PALETTE_START = 16;
const SKIN_CELLS = [16, 29, 30, 31]; // cream, salmon, brown, peach
const HAIR_COLORS = [24, 25, 26, 27, 18, 29, 30];
const VARIANT_CELL_PX: [number, number] = [16, 32]; // a palette cell in the atlas

type Template = { object: THREE.Object3D; size: THREE.Vector3 };
type Image = CanvasImageSource & { width: number; height: number };
type Clothes = { cells: number[]; map: THREE.Texture };
// The head's hair vertices: the palette cell they use and the head's face cell.
type Hair = { geometry: THREE.BufferGeometry; vertices: number[]; cell: number; faceCell: number };
// One character model, baked: a geometry + material per source material.
type Breed = { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]; scale: number; clothes: boolean; hair?: Hair };
type Seat = { x: number; height: number; depth: number; yaw: number; look: [number, number, number]; cheer: number[]; motion: number[] };

const seededRandom = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
const isPart = (object: THREE.Object3D, part: string): boolean => {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node.name.startsWith(part)) return true;
    return false;
};
const isBodyPart = (object: THREE.Object3D): boolean => isPart(object, 'body-mesh');
// Palette cell (row × 8 + column) of a UV; -1 outside the texture (tiled UVs).
const paletteCell = (u: number, v: number): number => (u < 0 || u > 1 || v < 0 || v > 1) ? -1 : Math.min(Math.floor(v * PALETTE_ROWS), PALETTE_ROWS - 1) * PALETTE_COLUMNS + Math.min(Math.floor(u * PALETTE_COLUMNS), PALETTE_COLUMNS - 1);

// Per vertex: aPart (0 still, 1 left arm, 2 right arm), aBody (1 = takes the
// clothes band), aHair (1 = hair). Per spectator: aCheer (arm angle, wave
// angle, wave speed, burst speed), aMotion (phase, arm offset, jump height
// in model units, jump speed), aLook (band, hair UV shift).
const VERTEX_HEADER = /* glsl */ `
attribute float aPart;
attribute float aBody;
attribute float aHair;
attribute vec4 aCheer;
attribute vec4 aMotion;
attribute vec3 aLook;
uniform float uTime;
uniform vec3 uLeftPivot;
uniform vec3 uLeftAxis;
uniform float uLeftRest;
uniform vec3 uRightPivot;
uniform vec3 uRightAxis;
uniform float uRightRest;
varying float vBand;
mat3 rotateAxis(vec3 k, float a) {
    float c = cos(a), s = sin(a), t = 1.0 - c;
    return mat3(
        t * k.x * k.x + c, t * k.x * k.y + s * k.z, t * k.x * k.z - s * k.y,
        t * k.x * k.y - s * k.z, t * k.y * k.y + c, t * k.y * k.z + s * k.x,
        t * k.x * k.z + s * k.y, t * k.y * k.z - s * k.x, t * k.z * k.z + c);
}
// The arm's turn from its rest pose: the wave swells and eases (0.4–1) on the burst rhythm.
mat3 crowdArm() {
    if (aPart < 0.5) return mat3(1.0);
    bool left = aPart < 1.5;
    float swell = 0.7 + 0.3 * sin(uTime * aCheer.w + aMotion.x);
    float wave = aCheer.x + sin(uTime * aCheer.z + aMotion.x + (left ? 0.0 : aMotion.y)) * aCheer.y * swell;
    return left ? rotateAxis(uLeftAxis, wave - uLeftRest) : rotateAxis(uRightAxis, -wave - uRightRest);
}
`;

export class Crowd {
    private readonly time = { value: 0 };
    private readonly breeds = new Map<string, Promise<Breed>>();

    public constructor(
        private readonly template: (name: string) => Promise<Template>,
        private readonly patch: (object: THREE.Object3D) => void,
    ) {}

    // Every crowd's clock (seconds).
    public update(now: number): void {
        this.time.value = now; // ponytail: float32 in the shader, fine for a day of uptime
    }

    // Fills the stand's seats with a random crowd (same crowd every run);
    // `current` = still the shown props once the models have loaded.
    public seat(stand: THREE.Object3D, prop: Prop, current: () => boolean): void {
        const random = seededRandom(Math.round(prop.x * 31 + prop.y * 17));
        const seats = new Map<string, { seat: Seat; variant: number; hairIndex: number }[]>();
        for (const [height, depth] of STAND_ROWS) {
            const seatsPerRow = Math.floor((2 * SEAT_HALF_WIDTH) / SPECTATOR_SPACING) + 1;
            for (let index = 0; index < seatsPerRow; index++) {
                const x = (index - (seatsPerRow - 1) / 2) * SPECTATOR_SPACING; // centred
                if (random() > SPECTATOR_FILL) continue;
                const model = SPECTATOR_MODELS[Math.floor(random() * SPECTATOR_MODELS.length)];
                const yaw = (random() - 0.5) * 0.6;
                const variant = Math.floor(random() * SPECTATOR_VARIANTS);
                const hairIndex = Math.floor(random() * HAIR_COLORS.length);
                const cheers = random() < SPECTATOR_CHEER;
                const between = ([min, max]: [number, number]) => min + random() * (max - min);
                const phase = random() * Math.PI * 2;
                const armAngle = between(CHEER_ARM_ANGLE);
                const waveAngle = between(CHEER_WAVE_ANGLE);
                const waveSpeed = between(CHEER_WAVE_SPEED);
                const burstSpeed = between(CHEER_BURST_SPEED);
                const armOffset = random() * CHEER_ARM_OFFSET;
                const jumpHeight = random() < SPECTATOR_JUMP ? between(JUMP_HEIGHT) : 0;
                const jumpSpeed = between(JUMP_SPEED);
                const seat: Seat = {
                    x, height, depth, yaw, look: [0, 0, 0],
                    // Not cheering: arms hang still, no hop.
                    cheer: cheers ? [armAngle, waveAngle, waveSpeed, burstSpeed] : [IDLE_ARM_ANGLE, 0, 0, 0],
                    motion: cheers ? [phase, armOffset, jumpHeight, jumpSpeed] : [0, 0, 0, 0],
                };
                if (!seats.has(model)) seats.set(model, []);
                seats.get(model)!.push({ seat, variant, hairIndex });
            }
        }
        for (const [model, list] of seats) {
            this.breed(model).then(breed => {
                if (!current()) return;
                const cheer = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
                const motion = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4);
                const look = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
                const matrices: THREE.Matrix4[] = [];
                list.forEach(({ seat, variant, hairIndex }, i) => {
                    let [shiftU, shiftV] = [0, 0];
                    if (breed.hair) {
                        // Not the face's own colour (the hair would vanish into it).
                        let color = HAIR_COLORS[hairIndex];
                        if (color === breed.hair.faceCell) color = HAIR_COLORS[(hairIndex + 1) % HAIR_COLORS.length];
                        shiftU = ((color % PALETTE_COLUMNS) - (breed.hair.cell % PALETTE_COLUMNS)) / PALETTE_COLUMNS;
                        shiftV = (Math.floor(color / PALETTE_COLUMNS) - Math.floor(breed.hair.cell / PALETTE_COLUMNS)) / PALETTE_ROWS;
                    }
                    look.setXYZ(i, breed.clothes ? variant + 1 : 0, shiftU, shiftV);
                    cheer.setXYZW(i, seat.cheer[0], seat.cheer[1], seat.cheer[2], seat.cheer[3]);
                    // The hop is in stand units, the shader works in the model's.
                    motion.setXYZW(i, seat.motion[0], seat.motion[1], seat.motion[2] / breed.scale, seat.motion[3]);
                    matrices.push(new THREE.Matrix4().compose(
                        new THREE.Vector3(seat.x, seat.height, seat.depth),
                        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), seat.yaw),
                        new THREE.Vector3().setScalar(breed.scale),
                    ));
                });
                for (const part of breed.parts) {
                    // Own geometry per stand (its instance attributes), sharing the baked buffers.
                    const geometry = new THREE.BufferGeometry();
                    geometry.setIndex(part.geometry.index);
                    for (const [name, attribute] of Object.entries(part.geometry.attributes)) geometry.setAttribute(name, attribute);
                    geometry.setAttribute('aCheer', cheer);
                    geometry.setAttribute('aMotion', motion);
                    geometry.setAttribute('aLook', look);
                    const mesh = new THREE.InstancedMesh(geometry, part.material, list.length);
                    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
                    // Their shadows fall on the seats, which take none anyway.
                    mesh.castShadow = false;
                    mesh.computeBoundingSphere();
                    this.patch(mesh); // see-through holes, after the crowd's own shader edits (once per material)
                    stand.add(mesh);
                }
            });
        }
    }

    private breed(name: string): Promise<Breed> {
        let breed = this.breeds.get(name);
        if (!breed) {
            breed = this.template(name).then(template => this.bake(name, template));
            this.breeds.set(name, breed);
        }
        return breed;
    }

    // The model in its rest pose (T-pose) as plain geometry, one per material.
    private bake(name: string, { object, size }: Template): Breed {
        object.updateMatrixWorld(true);
        const clothes = clothesOf(object);
        const hair = hairOf(object);
        const atlas = clothes && clothesAtlas(name, clothes);
        const geometries = new Map<THREE.Material, THREE.BufferGeometry[]>();
        const vertex = new THREE.Vector3();
        object.traverse(obj => {
            const mesh = obj as THREE.SkinnedMesh;
            if (!mesh.isSkinnedMesh) return;
            const source = mesh.geometry;
            const position = source.getAttribute('position');
            const normal = source.getAttribute('normal');
            const skinIndex = source.getAttribute('skinIndex');
            const skinWeight = source.getAttribute('skinWeight');
            const { bones, boneInverses } = mesh.skeleton;
            // Rigid skinning: each vertex follows one bone.
            const matrices = bones.map((bone, j) => new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, boneInverses[j]).multiply(mesh.bindMatrix));
            const normalMatrices = matrices.map(matrix => new THREE.Matrix3().getNormalMatrix(matrix));
            const partOf = bones.map(bone => (bone.name === 'arm-left' ? 1 : bone.name === 'arm-right' ? 2 : 0));
            const material = mesh.material as THREE.Material;
            const body = clothes && isBodyPart(mesh) && material.name === 'colormap' ? 1 : 0;
            const positions = new Float32Array(position.count * 3);
            const normals = new Float32Array(position.count * 3);
            const parts = new Float32Array(position.count);
            const hairs = new Float32Array(position.count);
            for (let i = 0; i < position.count; i++) {
                let joint = skinIndex.getX(i);
                let weight = skinWeight.getX(i);
                for (const k of [1, 2, 3]) {
                    if (skinWeight.getComponent(i, k) > weight) {
                        weight = skinWeight.getComponent(i, k);
                        joint = skinIndex.getComponent(i, k);
                    }
                }
                vertex.fromBufferAttribute(position, i).applyMatrix4(matrices[joint]).toArray(positions, i * 3);
                vertex.fromBufferAttribute(normal, i).applyMatrix3(normalMatrices[joint]).normalize().toArray(normals, i * 3);
                parts[i] = partOf[joint];
            }
            if (hair?.geometry === source) for (const i of hair.vertices) hairs[i] = 1;
            const geometry = new THREE.BufferGeometry();
            geometry.setIndex(source.index);
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
            geometry.setAttribute('uv', source.getAttribute('uv'));
            geometry.setAttribute('aPart', new THREE.BufferAttribute(parts, 1));
            geometry.setAttribute('aBody', new THREE.BufferAttribute(new Float32Array(position.count).fill(body), 1));
            geometry.setAttribute('aHair', new THREE.BufferAttribute(hairs, 1));
            geometries.set(material, [...(geometries.get(material) ?? []), geometry]);
        });
        const arm = (bone: string) => {
            const node = object.getObjectByName(bone)!;
            // rotation.z is the cheer's angle; the turn axis is that local z after the bone's x / y.
            const turn = node.parent!.getWorldQuaternion(new THREE.Quaternion())
                .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(node.rotation.x, node.rotation.y, 0, node.rotation.order)));
            return {
                pivot: new THREE.Vector3().setFromMatrixPosition(node.matrixWorld),
                axis: new THREE.Vector3(0, 0, 1).applyQuaternion(turn),
                rest: node.rotation.z,
            };
        };
        const left = arm('arm-left');
        const right = arm('arm-right');
        const parts = [...geometries].map(([source, list]) => {
            const toon = source as THREE.MeshToonMaterial;
            const map = source.name === 'colormap' && atlas ? atlas : toon.map;
            const material = new THREE.MeshToonMaterial({ name: toon.name, color: toon.color, map, gradientMap: toon.gradientMap });
            const bands = map === atlas ? SPECTATOR_VARIANTS + 1 : 1;
            material.onBeforeCompile = shader => {
                Object.assign(shader.uniforms, {
                    uTime: this.time,
                    uLeftPivot: { value: left.pivot }, uLeftAxis: { value: left.axis }, uLeftRest: { value: left.rest },
                    uRightPivot: { value: right.pivot }, uRightAxis: { value: right.axis }, uRightRest: { value: right.rest },
                    uBands: { value: bands },
                });
                shader.vertexShader = VERTEX_HEADER + shader.vertexShader
                    .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
    vMapUv += aHair * aLook.yz;
#endif
    vBand = aBody * aLook.x;`)
                    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
    mat3 crowdRotation = crowdArm();
    objectNormal = crowdRotation * objectNormal;`)
                    .replace('#include <begin_vertex>', `#include <begin_vertex>
    vec3 crowdPivot = aPart < 1.5 ? uLeftPivot : uRightPivot;
    if (aPart > 0.5) transformed = crowdRotation * (transformed - crowdPivot) + crowdPivot;
    transformed.y += abs(sin(uTime * aMotion.w + aMotion.x)) * aMotion.z;`);
                // The atlas: this spectator's band (palette repeats in v as the texture did).
                shader.fragmentShader = 'uniform float uBands;\nvarying float vBand;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
#ifdef USE_MAP
    diffuseColor *= texture2D(map, vec2(vMapUv.x, (fract(vMapUv.y) + floor(vBand + 0.5)) / uBands));
#endif`);
            };
            material.customProgramCacheKey = () => 'crowd';
            return { geometry: mergeGeometries(list)!, material };
        });
        return { parts, scale: SPECTATOR_HEIGHT / size.y, clothes: !!atlas, hair };
    }
}

// The palette cells a character's body (not the head) wears as clothes.
const clothesOf = (object: THREE.Object3D): Clothes | undefined => {
    const cells = new Set<number>();
    let map: THREE.Texture | undefined;
    let unsupported = false;
    object.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        const material = mesh.material as THREE.MeshToonMaterial;
        if (!mesh.isMesh || !isBodyPart(mesh) || material.name !== 'colormap' || !material.map) return;
        map = material.map;
        const uv = mesh.geometry.getAttribute('uv');
        for (let i = 0; i < uv.count; i++) {
            const cell = paletteCell(uv.getX(i), uv.getY(i));
            if (cell < PALETTE_START) unsupported = true; // another layout (character-male-b)
            else if (CLOTHES_RECOLORED.includes(cell)) cells.add(cell);
        }
    });
    return map && !unsupported ? { cells: [...cells], map } : undefined;
};

// The head's hair: the biggest non-face palette cell (not the eyes).
const hairOf = (object: THREE.Object3D): Hair | undefined => {
    const heads: THREE.Mesh[] = [];
    object.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && isPart(mesh, 'head-mesh')) heads.push(mesh);
    });
    // One plain palette mesh only: character-male-b's head has a beard mesh on top.
    if (heads.length !== 1 || (heads[0].material as THREE.Material).name !== 'colormap') return undefined;
    const geometry = heads[0].geometry;
    const uv = geometry.getAttribute('uv');
    const position = geometry.getAttribute('position');
    const cells = Array.from({ length: uv.count }, (_, i) => paletteCell(uv.getX(i), uv.getY(i)));
    if (cells.some(cell => cell < PALETTE_START)) return undefined; // another layout (character-male-b)
    // The face: the skin-tone cell reaching lowest (the chin), then the biggest.
    // Long hair can reach as low as the chin, so only skin tones count.
    const all = new Map<number, { count: number; lowest: number }>();
    cells.forEach((cell, i) => {
        const seen = all.get(cell) ?? { count: 0, lowest: Infinity };
        all.set(cell, { count: seen.count + 1, lowest: Math.min(seen.lowest, position.getY(i)) });
    });
    const [faceCell] = [...all]
        .filter(([cell]) => SKIN_CELLS.includes(cell))
        .sort(([, a], [, b]) => Math.round(a.lowest * 100) - Math.round(b.lowest * 100) || b.count - a.count)[0] ?? [];
    if (faceCell === undefined) return undefined;
    const counts = new Map<number, number>();
    for (const cell of cells) if (cell !== faceCell) counts.set(cell, (counts.get(cell) ?? 0) + 1);
    const [cell] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (cell === undefined) return undefined;
    // The eyes sit on the face front, in the same dark cell as dark hair.
    const isEye = (i: number) => position.getZ(i) > 0.158 && position.getY(i) > 0.395 && position.getY(i) < 0.515;
    const vertices = cells.flatMap((c, i) => (c === cell && !isEye(i) ? [i] : []));
    return { geometry, vertices, cell, faceCell };
};

// The model's palette, then SPECTATOR_VARIANTS recoloured copies of it below
// (band k + 1 = the look `${name}#${k}`: its clothing cells shuffled to other
// clothing colours, seeded by that key).
const clothesAtlas = (name: string, clothes: Clothes): THREE.Texture => {
    const image = clothes.map.image as Image;
    const [cellWidth, cellHeight] = VARIANT_CELL_PX;
    const bandHeight = cellHeight * PALETTE_ROWS;
    const canvas = document.createElement('canvas');
    canvas.width = cellWidth * PALETTE_COLUMNS;
    canvas.height = bandHeight * (SPECTATOR_VARIANTS + 1);
    const context = canvas.getContext('2d')!;
    context.imageSmoothingEnabled = false;
    const sourceWidth = image.width / PALETTE_COLUMNS;
    const sourceHeight = image.height / PALETTE_ROWS;
    for (let band = 0; band <= SPECTATOR_VARIANTS; band++) {
        const top = band * bandHeight;
        context.drawImage(image, 0, top, canvas.width, bandHeight);
        if (band === 0) continue;
        const key = `${name}#${band - 1}`;
        const random = seededRandom(Math.imul([...key].reduce((hash, char) => Math.imul(hash, 31) + char.charCodeAt(0) | 0, 7), 2654435761));
        const colors = [...CLOTHES_COLORS];
        for (let i = colors.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [colors[i], colors[j]] = [colors[j], colors[i]];
        }
        clothes.cells.forEach((cell, i) => {
            const color = colors[i % colors.length];
            context.drawImage(
                image,
                (color % PALETTE_COLUMNS) * sourceWidth, Math.floor(color / PALETTE_COLUMNS) * sourceHeight, sourceWidth, sourceHeight,
                (cell % PALETTE_COLUMNS) * cellWidth, top + Math.floor(cell / PALETTE_COLUMNS) * cellHeight, cellWidth, cellHeight,
            );
        });
    }
    const source = clothes.map;
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = source.flipY;
    texture.colorSpace = source.colorSpace;
    texture.channel = source.channel;
    texture.wrapS = source.wrapS;
    texture.wrapT = source.wrapT;
    texture.magFilter = texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    return texture;
};
