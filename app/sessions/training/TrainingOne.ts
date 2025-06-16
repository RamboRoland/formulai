import { Session } from "../Session";
import { GoKartTrackOne } from "~/tracks/gokarts/GoKartTrackOne";
import { GoKartTrackTwo } from "~/tracks/gokarts/GoKartTrackTwo";
import { GoKartTrackThree } from "~/tracks/gokarts/GoKartTrackThree";

export class TrainingOne extends Session {
    public constructor(car: string) {
        const stages = [
            {
                track: new GoKartTrackOne(),
                stageLaps: 3,
                stageLapsCompleted: 0,
                currentCheckpoint: 0,
                passedCheckpoints: [],
                lapTimes: [],
            },
            {
                track: new GoKartTrackTwo(),
                stageLaps: 3,
                stageLapsCompleted: 0,
                currentCheckpoint: 0,
                passedCheckpoints: [],
                lapTimes: [],
            },
            {
                track: new GoKartTrackThree(),
                stageLaps: 3,
                stageLapsCompleted: 0,
                currentCheckpoint: 0,
                passedCheckpoints: [],
                lapTimes: [],
            },
        ];

        super(car, stages);
    }
}