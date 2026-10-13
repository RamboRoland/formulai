import type { Car } from "~/cars/Car";
import type {Track} from "~/tracks/Track";
import type {Stage} from "~/sessions/Session";

type PlayerStage = {
    laps: number
    currentCheckpoint: number
    passedCheckpoints: boolean[]
    totalCheckpoints: number
    lapsCompleted: number
    lapTimes: number[]
    // Monotonic clock (seconds) that climbs for the whole stage. Survives
    // resetLap (so a mid-lap restart doesn't reset it). Only resetStage zeros it.
    stageTime: number
}

export class Player {
    public id: string;
    public name: string;
    public car: Car;

    public color: string;

    public currentStageId: number;
    public stages: Map<number, PlayerStage>;

    public constructor(id: string, name: string, car: Car, color: string, stages: Stage[]) {
        this.id = id;
        this.name = name;
        this.car = car;
        this.color = color;

        this.currentStageId = 0;
        this.stages = new Map<number, PlayerStage>(stages.map((stage, index) => [
            index,
            {
                laps: stage.stageLaps,
                currentCheckpoint: 0,
                passedCheckpoints: new Array(stage.track.checkpoints.length).fill(false),
                totalCheckpoints: stage.track.checkpoints.length,
                lapsCompleted: 0,
                lapTimes: [],
                stageTime: 0,
            }
        ]))
    }



    public stage(): PlayerStage {
        const stage = this.stages.get(this.currentStageId);
        if (!stage) throw new Error(`Stage ${this.currentStageId} not found`);
        return stage;
    }

    public resetLap(): void {
        this.stage().currentCheckpoint = 0;
        this.stage().passedCheckpoints = new Array(this.stage().totalCheckpoints).fill(false);
        // Also zero the current running lap-time entry so the clock restarts
        // from 0 on restart (not just the position). Previously-completed laps
        // in lapTimes are preserved — only the in-progress entry resets.
        const last = this.stage().lapTimes.length - 1;
        if (last >= 0) this.stage().lapTimes[last] = 0;

        this.car.reset();
    }

    public resetStage(): void {
        this.stage().lapsCompleted = 0;
        this.stage().currentCheckpoint = 0;
        this.stage().passedCheckpoints = new Array(this.stage().totalCheckpoints).fill(false);
        this.stage().lapTimes = [];
        this.stage().stageTime = 0;
        this.car.reset();
    }

    // Advance the lap + stage clocks. They only run while a lap is in
    // progress: from crossing the start line (checkpoint 0 passed) until the
    // stage is complete. Before the start line (cars spawn just behind it)
    // and after the last lap, nothing is counted.
    public addLapTime(lapTime: number): void {
        const stage = this.stage();
        if (!stage.passedCheckpoints[0] || this.isStageCompleted(stage)) return;

        if (this.stage().lapTimes.length === 0) {
            this.stage().lapTimes.push(0);
        }

        const currentLapTimeIndex = this.stage().lapTimes.length - 1;

        if (this.stage().lapTimes[currentLapTimeIndex] === undefined) {
            this.stage().lapTimes[currentLapTimeIndex] = lapTime / 1000;
        } else {
            this.stage().lapTimes[currentLapTimeIndex] += lapTime / 1000;
        }

        // Monotonic stage clock — survives resetLap, resets only in resetStage.
        this.stage().stageTime += lapTime / 1000;
    }

    public lapTime(): number {
        const stage = this.stage();
        const currentLapTimeIndex = stage.lapTimes.length - 1;
        return stage.lapTimes[currentLapTimeIndex] || 0
    }

    // A lap was completed (crossed the finish). The next lap starts right
    // away on the same line, so checkpoint 0 counts as passed. A new lap-time
    // entry is opened only if the stage continues — after the last lap there
    // is no next lap. `endsStage` (one-way finish): this run completes the
    // stage regardless of the configured lap count.
    public completedLap(endsStage = false): void {
        const stage = this.stage();
        stage.lapsCompleted = endsStage ? stage.laps : stage.lapsCompleted + 1;
        stage.currentCheckpoint = 1;
        stage.passedCheckpoints = new Array(stage.totalCheckpoints).fill(false);
        stage.passedCheckpoints[0] = true;
        if (!this.isStageCompleted(stage)) stage.lapTimes.push(0);
    }

    public isStageCompleted(stage: PlayerStage): boolean {
        return stage.lapsCompleted >= stage.laps
    }

    public isCompleted(): boolean {
        return [...this.stages.values()].every(stage => this.isStageCompleted(stage));
    }

    public passedCheckpoint(checkpointIndex: number): void {
        this.stage().passedCheckpoints[checkpointIndex] = true;
        this.stage().currentCheckpoint = checkpointIndex + 1;
    }

    public nextStage(): void {
        if (this.currentStageId < this.stages.size - 1) {
            this.currentStageId++;
        }
    }
}