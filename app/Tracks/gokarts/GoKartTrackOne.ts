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
        { start: new Vector(551.9999994791667, 480.00999999978353), end: new Vector(551.9999994791667, 383.99999999978394) },
        { start: new Vector(767.9999968750001, 480.0099999982641), end: new Vector(767.9999968750001, 383.9999999982645) },
        { start: new Vector(972.0013506498834, 326.8622024781047), end: new Vector(875.9913506498838, 326.8622024781047) },
        { start: new Vector(972.0087087247715, 206.86220354294016), end: new Vector(875.9987087247719, 206.86220354294016) },
        { start: new Vector(737.4372595620445, 132.00083100960705), end: new Vector(737.4372595620445, 35.99083100960744) },
        { start: new Vector(521.4372621247676, 132.0084949228715), end: new Vector(521.4372621247676, 35.998494922871906) },
        { start: new Vector(209.43726526801473, 132.0001205755534), end: new Vector(209.43726526801473, 35.990120575553824) },
        { start: new Vector(132.00631157881577, 196.2948634588734), end: new Vector(35.99631157881616, 196.2948634588734) },
        { start: new Vector(132.00525347473538, 340.29486197929157), end: new Vector(35.99525347473579, 340.29486197929157) },
        { start: new Vector(253.02650148650443, 480.0028378655581), end: new Vector(253.02650148650443, 383.9928378655585) }
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