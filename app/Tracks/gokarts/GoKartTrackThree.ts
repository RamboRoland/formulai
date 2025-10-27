import { Track } from '../Track';
import { Vector } from '../../components/Vector';
import type { RefObject } from 'react';

export class GoKartTrackThree extends Track {
    public readonly trackWidth = 1008;
    public readonly trackHeight = 516;
    public readonly finishLineDirection = 'right';
    public readonly startPosition = new Vector(540, 90);
    public readonly startAngle = 0.0;

    public readonly checkpoints = [
        { start: new Vector(660, 132.0099999999998), end: new Vector(660, 35.9900000000002) },
        { start: new Vector(867.9916391911164, 217.21748504326752), end: new Vector(961.0033208901076, 190.54681449441478) },
        { start: new Vector(741.9958781696606, 329.26046808861975), end: new Vector(826.0003423367507, 280.7604680886201) },
        { start: new Vector(553.0925693523521, 276.0037393649507), end: new Vector(553.0925693523521, 179.9937393649511) },
        { start: new Vector(185.5810066685541, 467.0070400096179), end: new Vector(215.47840087433008, 374.9923220580623) },
        { start: new Vector(142.00710443834322, 209.19637829755166), end: new Vector(52.41332857155505, 172.99814317577227) },
        { start: new Vector(337.08370833614094, 132.00933842228926), end: new Vector(337.08370833614094, 35.999338422289654) }
    ];

    protected readonly trackImageSrc = '/assets/gokart_125cc_track_three.png';
    protected readonly collisionMaskSrc = '/assets/gokart_125cc_track_three_bounding_box.png';
} 