import { Track } from '../Track';
import { Vector } from '../../components/Vector';
import type { RefObject } from 'react';

export class GokartTrackGokartCentralenKungalv extends Track {
    public readonly trackWidth = 745;
    public readonly trackHeight = 727;
    public readonly finishLineDirection = 'left';
    public readonly startPosition = new Vector(300, 660);
    public readonly startAngle = 180.0;

    public readonly checkpoints = [
        { start: new Vector(218.13664607936653, 720.0049862201719), end: new Vector(218.13664607936653, 621.9949862201723) },
        { start: new Vector(110.00963609108366, 538.9579906901569), end: new Vector(11.999636091083865, 538.9579906901569) },
        { start: new Vector(301.00366504744477, 324.4158081565486), end: new Vector(235.99473452959535, 275.42806527197206) },
        { start: new Vector(257.00145116132364, 187.7102269223148), end: new Vector(139.99595017124645, 175.41245321887538) },
        { start: new Vector(135.00468129754677, 147.23803640413206), end: new Vector(11.995058260007909, 138.63636562674395) },
        { start: new Vector(283.1116844686835, 81.00957556882156), end: new Vector(283.1116844686835, 13.999575568821761) },
        { start: new Vector(443.00958444747664, 261.9719373618213), end: new Vector(360.9904867053668, 241.52227952678143) },
        { start: new Vector(250.0044159093298, 493.3560772314625), end: new Vector(204.90742503401557, 411.9989520733561) },
        { start: new Vector(330.18347557172615, 583.008592764965), end: new Vector(279.9969655099145, 488.62149508834585) },
        { start: new Vector(532.0053965547232, 163.54693337466801), end: new Vector(458.993683716207, 158.44145706133548) },
        { start: new Vector(648.9917034206582, 97.28336743321675), end: new Vector(735.0092719021917, 94.27956775203252) },
        { start: new Vector(601.0062585715699, 298.04668540089824), end: new Vector(529.9914668827798, 286.7990473645057) },
        { start: new Vector(651.0058415520565, 421.3538208359539), end: new Vector(585.9986817757209, 409.8913046281599) },
        { start: new Vector(735.0032346109007, 372.2868419164618), end: new Vector(668.9934704862897, 369.98173015926164) },
        { start: new Vector(659.5713421168773, 678.0011011104252), end: new Vector(593.8359513481832, 604.9945534555262) }
    ];

    protected readonly trackImageSrc = '/assets/gokart_centralen_kungalv.png';
    protected readonly collisionMaskSrc = '/assets/gokart_centralen_kungalv_bounding_box.png';

    public setCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.canvasRef = canvas;
    }

    public setCollisionCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.collisionCanvasRef = canvas;
    }
}