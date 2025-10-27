import { Track } from '../Track';
import { Vector } from '../../components/Vector';
import type { RefObject } from 'react';

export class GokartTrackGokartCentralenGBG extends Track {
    public readonly trackWidth = 984;
    public readonly trackHeight = 1548;
    public readonly finishLineDirection = 'left';
    public readonly startPosition = new Vector(700, 1200);
    public readonly startAngle = 140.0;

    public readonly checkpoints = [
        { start: new Vector(655.0008195883992, 1316.0282425560172), end: new Vector(592.9958177530438, 1233.7448259558448) },
        { start: new Vector(336.3825898242589, 1503.0008571809847), end: new Vector(290.5333515815895, 1408.9959878785553) },
        { start: new Vector(200.00555124493332, 1275.1538039662591), end: new Vector(93.99467364125536, 1195.268877793056) },
        { start: new Vector(138.00801690331602, 693.4292605655934), end: new Vector(21.998016903316426, 693.4292605655934) },
        { start: new Vector(155.0087225782848, 241.02751416753537), end: new Vector(41.99834171992851, 193.05745352290717) },
        { start: new Vector(473.0542041868223, 138.00654296717235), end: new Vector(473.0542041868223, 26.996542967172942) },
        { start: new Vector(979.0077118673772, 255.24858343978556), end: new Vector(843.9982775904082, 252.89198499855917) },
        { start: new Vector(652.9982150906254, 411.7944142828589), end: new Vector(760.611577615939, 287.9994018389168) },
        { start: new Vector(436.5583603452772, 289.00626655762227), end: new Vector(436.5583603452772, 174.99626655762265) },
        { start: new Vector(275.00551838681895, 470.7104382107527), end: new Vector(165.99551838681919, 470.7104382107527) },
        { start: new Vector(299.99376299445913, 668.9676740176718), end: new Vector(443.0074986666623, 661.4726417241197) },
        { start: new Vector(512.9910618541934, 497.7774958593629), end: new Vector(645.0036980981329, 479.2243297703764) },
        { start: new Vector(457.3311039350576, 1011.0014713829397), end: new Vector(410.63482676930477, 900.9919363468392) },
        { start: new Vector(590.5417719204285, 1193.0018838100389), end: new Vector(536.8342251377228, 1091.992679186978) },
        { start: new Vector(736.009632851394, 745.1745251451985), end: new Vector(653.9996328513944, 745.1745251451985) },
        { start: new Vector(970.001644555088, 757.5515425762585), end: new Vector(852.9916445550882, 757.5515425762585) }
    ];

    protected readonly trackImageSrc = '/assets/gokart_centralen_gbg.png';
    protected readonly collisionMaskSrc = '/assets/gokart_centralen_gbg_bounding_box.png';

    public setCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.canvasRef = canvas;
    }

    public setCollisionCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.collisionCanvasRef = canvas;
    }
}