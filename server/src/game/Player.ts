import type { Car } from "./cars/Car";
import type {Track} from "./tracks/Track";
import type {Stage} from "./sessions/Session";
import type { SessionProgress } from "./sessions/SessionProgress";
import { fromPixelsToMeters } from "./helper";

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
    // Distance (metres) driven along the centreline route this stage. Only goes
    // up; restart (resetLap) and resetStage zero it.
    completedMeters: number
    // Steps on this stage (GameState car.tick): +1 per step, laps too;
    // restart (resetLap) and resetStage zero it.
    tick: number
    // Best point reached on the current route leg: the leg (-1 = none yet)
    // and the index of its sample point. Starts over when the leg changes.
    routeLeg: number
    routeSample: number
    // Nearest route point to the car NOW (car.heading / car.facing): the leg
    // (-1 = none yet) and its sample index. Unlike routeSample it also moves
    // back (reversing). Starts over when the leg changes.
    nearLeg: number
    nearSample: number
    // This run started at a random place (restart startPosition 'random'):
    // the lead-in is the route from the spawn on to the start line
    // (randomLeadIn, px; Player.leadIn), counted along the route from the
    // spawn (routeLeg / routeSample, GameEngine.updateCompletedMeters); before
    // the start line nearLeg follows the car from its spawn
    // (GameEngine.updateDirection). Restart / resetStage clear it.
    randomStart: boolean
    randomLeadIn: number
}

// How a restarted car starts (req:agent/restart): `position` 'grid' = its
// grid box, 'random' = a random point on the route; `speed` 0..1 of
// maxSpeed.
export type RestartStart = { position: 'grid' | 'random'; speed: number };
export const GRID_START: RestartStart = { position: 'grid', speed: 0 };

export class Player {
    public id: string;
    public name: string;
    public car: Car;

    public color: string;
    // Its agent paused it (req:agent/pause): tickPlayer skips it, every value
    // kept. On the Player, not the Car: a restart / new stage keeps it.
    public paused = false;

    public currentStageId: number;
    public stages: Map<number, PlayerStage>;

    // `progress`: where this car is in the session (shared by a race lobby,
    // one per client in training).
    public constructor(id: string, name: string, car: Car, color: string, stages: Stage[], public readonly progress: SessionProgress) {
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
                completedMeters: 0,
                tick: 0,
                routeLeg: -1,
                routeSample: 0,
                nearLeg: -1,
                nearSample: 0,
                randomStart: false,
                randomLeadIn: 0,
            }
        ]))
    }



    public stage(): PlayerStage {
        const stage = this.stages.get(this.currentStageId);
        if (!stage) throw new Error(`Stage ${this.currentStageId} not found`);
        return stage;
    }

    // Restart (controls.restart): the whole stage starts over — completed
    // laps, lap times, checkpoints (so stage.completed is false again), car
    // at the start, completedMeters 0. Unlike resetStage, the stage clock
    // (stageTime) is kept. `start`: where and how fast the car starts.
    public resetLap(start: RestartStart = GRID_START): void {
        this.stage().tick = 0;
        this.stage().lapsCompleted = 0;
        this.stage().currentCheckpoint = 0;
        this.stage().passedCheckpoints = new Array(this.stage().totalCheckpoints).fill(false);
        this.stage().lapTimes = [];
        this.resetMeters();
        // 'random': a place on the route (loop layouts; none → the grid box).
        const spawn = start.position === 'random' ? this.car.track.randomSpawn(this.car) : null;
        this.car.reset(spawn ?? undefined);
        if (spawn) {
            const track = this.car.track;
            this.stage().randomStart = true;
            this.stage().randomLeadIn = track.route!.length - (track.routeLegStarts[spawn.leg] + spawn.arc);
            this.stage().routeLeg = this.stage().nearLeg = spawn.leg;
            this.stage().routeSample = this.stage().nearSample = spawn.sample;
        }
        // At a random place: rolling straight along the nose; the rear axle
        // starts at road speed on the first slide (reset → stopSliding), no
        // lock / spin. In the grid box (chosen or the fallback): standing.
        this.car.speed = spawn ? start.speed * this.car.maxSpeed : 0;
    }

    public resetStage(): void {
        this.stage().tick = 0;
        this.stage().lapsCompleted = 0;
        this.stage().currentCheckpoint = 0;
        this.stage().passedCheckpoints = new Array(this.stage().totalCheckpoints).fill(false);
        this.stage().lapTimes = [];
        this.stage().stageTime = 0;
        this.resetMeters();
        this.car.reset();
    }

    private resetMeters(): void {
        this.stage().completedMeters = 0;
        this.stage().routeLeg = -1;
        this.stage().routeSample = 0;
        this.stage().nearLeg = -1;
        this.stage().nearSample = 0;
        this.stage().randomStart = false;
        this.stage().randomLeadIn = 0;
    }

    // Distance (px) along the road from the spawn to the start line, which
    // completedMeters counts first (lap 1): Track.leadIn from the car's grid
    // box; after a random start the route from the spawn (randomLeadIn).
    public leadIn(track: Track): number {
        return this.stage().randomStart ? this.stage().randomLeadIn : track.leadIn(this.car.lengthPx, this.car.gridSlot);
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

    // A lap was completed (crossed the finish). `endsStage` (one-way finish):
    // this run completes the stage regardless of the configured lap count.
    // Stage completed (one-way finish or a loop's last lap): no new lap — the
    // checkpoints stay passed (currentCheckpoint = totalCheckpoints).
    // Otherwise the next lap starts right away on the same line, so
    // checkpoint 0 counts as passed and a new lap-time entry is opened.
    public completedLap(endsStage = false): void {
        const stage = this.stage();
        stage.lapsCompleted = endsStage ? stage.laps : stage.lapsCompleted + 1;
        if (this.isStageCompleted(stage)) return;

        stage.currentCheckpoint = 1;
        stage.passedCheckpoints = new Array(stage.totalCheckpoints).fill(false);
        stage.passedCheckpoints[0] = true;
        stage.lapTimes.push(0);
    }

    // GameState track.lapDistance: share of the current lap still to drive,
    // 1 = all of it (also before the start line), 0 = stage completed. Built on
    // completedMeters minus the lead-in (spawn → start line doesn't count),
    // so it only goes down; a new lap starts at 1 again.
    public lapDistance(track: Track): number {
        const stage = this.stage();
        if (this.isStageCompleted(stage)) return 0;
        if (!track.route || track.route.length <= 0) return 1;
        const lapMeters = fromPixelsToMeters(track.route.length);
        const leadInMeters = fromPixelsToMeters(this.leadIn(track));
        const done = (stage.completedMeters - leadInMeters - stage.lapsCompleted * lapMeters) / lapMeters;
        return 1 - Math.max(0, Math.min(1, done));
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

    // Go to stage `index` (picked by Session.advance) and start it fresh: a
    // repeating session comes back to stages raced before. Set car.track
    // first (resetStage puts the car on the grid).
    public enterStage(index: number): void {
        this.currentStageId = index;
        this.resetStage();
    }
}