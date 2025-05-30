import { Track } from './Track';
import { Vector } from '../components/Vector';
import type { RefObject } from 'react';

export class TrackOne extends Track {
    public readonly trackWidth = 1024;
    public readonly trackHeight = 512;
    public readonly finishLineDirection = 'right';
    public readonly startPosition = new Vector(512, 348);
    public readonly startAngle = 0.0;

    public readonly checkpoints = [
        { start: new Vector(600, 337), end: new Vector(600, 388) },
        { start: new Vector(700, 337), end: new Vector(700, 388) },
        { start: new Vector(779, 300), end: new Vector(830, 300) },
        { start: new Vector(500, 175), end: new Vector(500, 125) },
        { start: new Vector(194, 250), end: new Vector(245, 250) },
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