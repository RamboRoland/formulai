import { Track } from '../Track';
import { Vector } from '../../components/Vector';
import type { RefObject } from 'react';

export class GoKartTrackOne extends Track {
    public readonly trackWidth = 1008;
    public readonly trackHeight = 516;
    public readonly finishLineDirection = 'right';
    public readonly startPosition = new Vector(480, 410);
    public readonly startAngle = 0.0;

    public readonly checkpoints = [
        { start: new Vector(600, 384), end: new Vector(600, 480) },
        { start: new Vector(750, 384), end: new Vector(750, 480) },
        { start: new Vector(876, 326), end: new Vector(972, 326) },
        { start: new Vector(876, 186), end: new Vector(972, 186) },
        { start: new Vector(750, 36), end: new Vector(750, 132) },
        { start: new Vector(500, 36), end: new Vector(500, 132) },
        { start: new Vector(250, 36), end: new Vector(250, 132) },
        { start: new Vector(36, 186), end: new Vector(132, 186) },
        { start: new Vector(36, 326), end: new Vector(132, 326) },
        { start: new Vector(250, 384), end: new Vector(250, 480) },
    ];

    protected readonly trackImageSrc = '/assets/gokart_125cc_track_one.png';
    protected readonly collisionMaskSrc = '/assets/gokart_125cc_track_one_bounding_box.png';

    public setCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.canvasRef = canvas;
    }

    public setCollisionCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.collisionCanvasRef = canvas;
    }
} 