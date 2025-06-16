import type { Car } from "~/cars/Car";
import { Session } from "./Session";
import { Track } from "~/tracks/Track";

export class Practise extends Session {
    public constructor(car: string, track: Track) {
        const stages = [
            {
                track: track,
                stageLaps: 1,
                stageLapsCompleted: 0,
                currentCheckpoint: 0,
                passedCheckpoints: [],
                lapTimes: [],
            }
        ];

        super(car, stages);
    }

    public completed(): boolean {
        return false;
    }
}