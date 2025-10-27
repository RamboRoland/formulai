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
        { start: new Vector(660, 132.0099999999998), end: new Vector(660, 35.9900000000002) },
        { start: new Vector(853.9931491344331, 187.34643061730304), end: new Vector(935.0003392922815, 134.73974622520166) },
        { start: new Vector(911.2189469875887, 411.00281030794), end: new Vector(840.4385357448857, 344.9990090210918) },
        { start: new Vector(605.214972036181, 480.0079876479936), end: new Vector(605.214972036181, 383.997987647994) },
        { start: new Vector(255.86260139774666, 439.0008900461732), end: new Vector(295.0435422252383, 350.99905611146187) },
        { start: new Vector(69.99743065566065, 246.31261030304793), end: new Vector(157.0006943374195, 203.87828329386548) },
        { start: new Vector(211.90130792960113, 132.0007314092202), end: new Vector(211.90130792960113, 35.99073140922061) },
        { start: new Vector(451.9013036988287, 132.00313364166428), end: new Vector(451.9013036988287, 35.99313364166468) }
    ];

    protected readonly trackImageSrc = '/assets/gokart_125cc_track_two.png';
    protected readonly collisionMaskSrc = '/assets/gokart_125cc_track_two_bounding_box.png';
} 