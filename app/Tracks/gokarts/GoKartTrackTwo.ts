import { Track } from '../Track';
import { Vector } from '../../components/Vector';
import type { RefObject } from 'react';

export class GoKartTrackTwo extends Track {
    public readonly trackWidth = 1008;
    public readonly trackHeight = 516;
    public readonly finishLineDirection = 'right';
    public readonly startPosition = new Vector(540, 90);
    public readonly startAngle = 0.0;

    public readonly checkpoints = [
        { start: new Vector(650, 36), end: new Vector(650, 132) },
        { start: new Vector(848, 180), end: new Vector(930, 125) },
        { start: new Vector(848, 337), end: new Vector(930, 390) },
        { start: new Vector(600, 384), end: new Vector(600, 480) },
        { start: new Vector(300, 353), end: new Vector(250, 436) },
        { start: new Vector(64, 230), end: new Vector(155, 200) },
        { start: new Vector(210, 36), end: new Vector(210, 132) },
        { start: new Vector(440, 36), end: new Vector(440, 132) },
    ];

    protected readonly trackImageSrc = '/assets/gokart_125cc_track_two.png';
    protected readonly collisionMaskSrc = '/assets/gokart_125cc_track_two_bounding_box.png';
} 