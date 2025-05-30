import { Track } from './Track';
import { Vector } from '../components/Vector';
import type { RefObject } from 'react';

export class TrackTwo extends Track {
    public readonly trackWidth = 1024;
    public readonly trackHeight = 512;
    public readonly finishLineDirection = 'left';
    public readonly startPosition = new Vector(430, 348);
    public readonly startAngle = 180.0;

    public readonly checkpoints = [
        { start: new Vector(400, 337), end: new Vector(400, 388) },
        { start: new Vector(300, 337), end: new Vector(300, 388) },
        { start: new Vector(194, 300), end: new Vector(245, 300) },
        { start: new Vector(194, 220), end: new Vector(245, 220) },
        { start: new Vector(300, 175), end: new Vector(300, 125) },
        { start: new Vector(400, 175), end: new Vector(400, 125) },
        { start: new Vector(500, 175), end: new Vector(500, 125) },
        { start: new Vector(600, 175), end: new Vector(600, 125) },
        { start: new Vector(700, 175), end: new Vector(700, 125) },
        { start: new Vector(779, 220), end: new Vector(830, 220) },
        { start: new Vector(779, 300), end: new Vector(830, 300) },
        { start: new Vector(700, 337), end: new Vector(700, 388) },
        { start: new Vector(600, 337), end: new Vector(600, 388) },
        { start: new Vector(500, 337), end: new Vector(500, 388) },
    ];

    protected readonly trackImageSrc = '/assets/track_1.png';
    protected readonly collisionMaskSrc = '/assets/track_1_bounding_box.png';

    constructor(
        canvasRef: RefObject<HTMLCanvasElement>,
        collisionCanvasRef: RefObject<HTMLCanvasElement>,
    ) {
        super(canvasRef, collisionCanvasRef);
    }
} 