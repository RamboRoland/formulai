import type { Envelope, Point } from './envelope';

// A bezier outline node (world px): the asphalt edge, drawn sharp at any zoom.
export type OutlineNode = { pos: Point; in?: Point; out?: Point; asymmetric?: boolean };

// Everything the App needs to draw one layout, ready-made by the server.
// Sent only when the viewer's layout changes; `key` = track + layout +
// content hash (the App keeps it in memory for one page load).
export type RenderTrack = {
    key: string;
    name: string;    // track file name (props are seeded by it)
    layout: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    outline: OutlineNode[][] | null; // bezier rings (2D fill + edge line)
    rings: Point[][];                // the same rings flattened (3D asphalt mesh)
    walls: Point[][];                // tyre wall centre lines
    gridLines: Point[][];            // painted start-grid box lines
    checkpoints: { start: Point; end: Point }[];
    startIndex: number;
    finishIndex: number;
    paintStrips: { line: Point[]; closed: boolean; a: number; b: number }[]; // 3D paint
    paintQuads: { corners: Point[]; color: string }[];                       // 3D start / finish squares
    tyres: Point[];                  // every tyre centre (3D)
    props: { model: string; x: number; y: number; rotationY: number; diameterPx: number }[];
};

// One car as drawn.
export type RenderCar = {
    id: string;          // carId
    x: number;           // car x / y (world px, NOT the centre: centre = x + widthPx / 2, y + lengthPx / 2)
    y: number;
    angle: number;
    wheelAngle: number;  // front wheels, degrees, + = right
    spawnId: number;     // changes when the car is reset / respawned
    lengthPx: number;
    widthPx: number;
    hasCollision: boolean;
    rays: number[];
    color: string;
};

// The HUD for the followed car.
export type HudStats = {
    speed: number;
    angle: number;
    x: number;
    y: number;
    hasCollision: boolean;
    lapTime: number;
    stageTime: number;
    currentCheckpoint: number;
    totalCheckpoints: number;
    completedLaps: number;
    steeringAngle: number; // steering wheel, degrees (the App's wheel)
};

export type Follow = { client: string } | { stage: number };

// Watch a lobby: follow a client (default: the first) or a stage.
export type ReqViewWatch = Envelope<'req:view', 'watch', { lobbyId: string; follow?: Follow }>;
export type ResViewWatchError = Envelope<'res:view', 'watchError', { reason: string }>;
export type ReqViewStop = Envelope<'req:view', 'stop'>;
export type EvtViewTrack = Envelope<'evt:view', 'track', RenderTrack>;
export type EvtViewFrame = Envelope<'evt:view', 'frame', {
    tick: number;
    key: string;          // the RenderTrack this frame is on
    cars: RenderCar[];    // the cars on the followed stage
    followed: { carId: string | null; ownerId: string | null; stage: number };
    hud: HudStats | null; // the followed car (null = none on the track)
}>;

export type ViewMessage = ReqViewWatch | ResViewWatchError | ReqViewStop | EvtViewTrack | EvtViewFrame;
