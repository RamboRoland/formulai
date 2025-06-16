import type { Track } from "~/tracks/Track";
import type { Car } from "~/cars/Car";
import type { RefObject } from "react";
import { GokartTraining } from "~/cars/gokarts/GokartTraining";

type Stage = {
    track: Track;
    stageLaps: number;
    stageLapsCompleted: number;
	currentCheckpoint: number;
	passedCheckpoints: boolean[];
    lapTimes: number[];
}

export abstract class Session {
    public stages: Stage[];
    public currentStage = 0;
    public car: Car;

    public constructor(car: string, stages: Stage[]) {
		this.stages = stages.map(stage => ({
			...stage,
			passedCheckpoints: new Array(stage.track.checkpoints.length).fill(false)
		}));

        this.car = this.chooseCar(car);
    }

    public stage(): Stage {
        return this.stages[this.currentStage];
    }

    public resetLap(): void {
        this.stage().currentCheckpoint = 0;
        this.stage().passedCheckpoints = new Array(this.stage().track.checkpoints.length).fill(false);

        this.car.reset();
    }

	public resetStage(): void {
		this.stage().stageLapsCompleted = 0;
		this.stage().currentCheckpoint = 0;
		this.stage().passedCheckpoints = new Array(this.stage().track.checkpoints.length).fill(false);
		this.stage().lapTimes = [];
		this.car.reset();
	}

    public setCanvas(canvas: RefObject<HTMLCanvasElement>) {
        this.stages.forEach(stage => {
            stage.track.setCanvas(canvas);
        });
    }

    public setCollisionCanvas(collisionCanvas: RefObject<HTMLCanvasElement>) {
        this.stages.forEach(stage => {
            stage.track.setCollisionCanvas(collisionCanvas);
        });
    }

    public async loadTrackMedia(): Promise<void> {
        const loadPromises = this.stages.map(stage => stage.track.loadMedia());
        await Promise.all(loadPromises);
    }

    public addLapTime(lapTime: number): void {
		if (this.stage().lapTimes.length === 0) {
			this.stage().lapTimes.push(0);
		}

        const currentLapTimeIndex = this.stage().lapTimes.length - 1;

        if (this.stage().lapTimes[currentLapTimeIndex] === undefined) {
            this.stage().lapTimes[currentLapTimeIndex] = lapTime / 1000;
        } else {
            this.stage().lapTimes[currentLapTimeIndex] += lapTime / 1000;
        }
    }

    public chooseCar(car: string): Car {
        switch (car) {
            case 'GokartTraining':
                this.car = new GokartTraining(this.stage().track);
                break;
            default:
                this.car = new GokartTraining(this.stage().track);
                break;
        }

        return this.car;
    }

    public isCompleted(): boolean {
        return this.stages.every(stage => stage.stageLapsCompleted >= stage.stageLaps);
    }

    public isStageCompleted(): boolean {
        return this.stages[this.currentStage].stageLapsCompleted >= this.stages[this.currentStage].stageLaps;
    }

    public completedLap(): void {
        this.stages[this.currentStage].stageLapsCompleted++;
        
        if (!this.isStageCompleted()) {
			this.stage().currentCheckpoint = 1;
			this.stage().passedCheckpoints = new Array(this.stage().track.checkpoints.length).fill(false);
			this.stage().passedCheckpoints[0] = true;
            this.stage().lapTimes.push(0);
        }
    }

	public passedCheckpoint(checkpointIndex: number): void {
		this.stage().passedCheckpoints[checkpointIndex] = true;
		this.stage().currentCheckpoint = checkpointIndex + 1;
	}

	public startStage(): void {
		this.resetStage();
		this.chooseCar(this.car.constructor.name);
	}

    public nextStage(): void {
        if (this.currentStage < this.stages.length - 1) {
            this.currentStage++;
            this.chooseCar(this.car.constructor.name);
            this.resetLap();
        }
    }

    public previousStage(): void {
        if (this.currentStage > 0) {
            this.currentStage--;
            this.car.reset();
        }
    }

    public getSessionTimes(): { stageTimes: { stageTime: number, lapTimes: number[] }[], totalTime: number } {
        const stageTimes = this.stages.map(stage => ({
            stageTime: stage.lapTimes.reduce((sum, lapTime) => sum + lapTime, 0),
            lapTimes: stage.lapTimes,
        }));
        
        const totalTime = stageTimes.reduce((sum, stage) => sum + stage.stageTime, 0);
        return { stageTimes, totalTime };
    }
}