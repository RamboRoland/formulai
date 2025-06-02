import { Track } from '../../Track';
import { Vector } from '../../../components/Vector';
import type { RefObject } from 'react';

export class GoKartTrackTwo extends Track {
    public readonly trackWidth = 1008;
    public readonly trackHeight = 516;
    public readonly finishLineDirection = 'right';
    public readonly startPosition = new Vector(540, 90);
    public readonly startAngle = 0.0;

    public readonly checkpoints = [
        { start: new Vector(650, 36), end: new Vector(650, 132) },
        { start: new Vector(876, 316), end: new Vector(972, 316) },
        { start: new Vector(600, 180), end: new Vector(600, 276) },
        
        //{ start: new Vector(750, 384), end: new Vector(750, 480) },
        
        { start: new Vector(36, 250), end: new Vector(133, 250) },
        
    ];

    protected readonly trackImageSrc = '/assets/gokart_125cc_track_two.png';
    protected readonly collisionMaskSrc = '/assets/gokart_125cc_track_two_bounding_box.png';

    constructor(
        canvasRef: RefObject<HTMLCanvasElement>,
        collisionCanvasRef: RefObject<HTMLCanvasElement>,
    ) {
        super(canvasRef, collisionCanvasRef);
    }
} 