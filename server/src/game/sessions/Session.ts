import type { Track } from "../tracks/Track";
import type { Car } from "../cars/Car";
import { HyrkartCentralen } from "../cars/gokarts/HyrkartCentralen";
import { Hyrkart240cc } from "../cars/gokarts/Hyrkart240cc";
import { Racingkart125cc } from "../cars/gokarts/Racingkart125cc";
import type { Player } from "../Player";
import { createTrack, resolveTrackRef } from "../tracks/registry";
import type { SessionJSON } from "./types";

export type Stage = {
    track: Track;
    stageLaps: number;
};

// A race session: an ordered list of stages (track + laps) and the car
// classes you choose from. Built from a session JSON file (see
// ./registry.ts) — one class, no subclasses.
export class Session {
    public readonly name: string;
    public readonly displayName: string;
    public readonly cars: string[];
    public readonly stages: Stage[];
    public currentStage = 0;
    // Per stage: true = completed, false = skipped (set when the stage is
    // left: the client's WS nextStage, or a single-player finish).
    // undefined = not left yet. The session is completed when all are true.
    public stageCompleted: (boolean | undefined)[] = [];
    // Never completed: every stage completed → a new round from stage 1.
    public readonly repeat: boolean;

    // Stages whose track is missing or can't be raced (no outline) are
    // skipped with a console warning. A session can end up with no stages;
    // RacingView shows an error screen for that.
    public constructor(json: SessionJSON) {
        this.name = json.name;
        this.displayName = json.displayName;
        this.cars = [...json.cars];
        this.repeat = json.repeat ?? false;
        this.stages = json.stages.flatMap((st, i) => {
            const where = `Session "${json.name}" stage ${i + 1}`;
            const resolved = resolveTrackRef(st.track, st.layout);
            if ('error' in resolved) {
                console.warn(`${where}: ${resolved.error} — stage skipped.`);
                return [];
            }
            const track = createTrack(resolved.ref);
            if (!track) {
                console.warn(`${where}: track "${st.track}" could not be loaded — stage skipped.`);
                return [];
            }
            if (!track.geometry) {
                console.warn(`${where}: track "${st.track}" has no outline — stage skipped.`);
                return [];
            }
            return [{ track, stageLaps: st.laps }];
        });
    }

    public stage(): Stage {
        return this.stages[this.currentStage];
    }

    public chooseCar(car: string): Car {
        const track = this.stage().track;
        const instance = car === 'Hyrkart240cc' ? new Hyrkart240cc(track)
            : car === 'Racingkart125cc' ? new Racingkart125cc(track)
            : new HyrkartCentralen(track);
        // Place it on the grid now that its size is known (subclass fields
        // like lengthM aren't set yet inside the base Car constructor).
        instance.reset();
        return instance;
    }

    // Back to the first stage with no stage flags (multiplayer: the lobby
    // emptied and players rejoined → the session starts over).
    public reset(): void {
        this.currentStage = 0;
        this.stageCompleted = [];
    }

    // A repeating session is never completed.
    public isCompleted(): boolean {
        return !this.repeat && this.allStagesCompleted();
    }

    // The current stage was left (its flag already stored) → move
    // currentStage on and return it: the next stage after this one that
    // isn't completed, wrapping around (skipped stages are replayed,
    // completed ones never; only the last skipped → it again). Every stage
    // completed: no repeat → stays put (the session is over); repeat →
    // flags cleared, stage 0 (a new round).
    public advance(): number {
        const n = this.stages.length;
        if (this.allStagesCompleted()) {
            if (this.repeat) {
                this.stageCompleted = [];
                this.currentStage = 0;
            }
        } else {
            for (let k = 1; k <= n; k++) {
                const i = (this.currentStage + k) % n;
                if (this.stageCompleted[i] !== true) {
                    this.currentStage = i;
                    break;
                }
            }
        }
        return this.currentStage;
    }

    private allStagesCompleted(): boolean {
        return this.stages.every((_, i) => this.stageCompleted[i] === true);
    }

    public isStageCompleted(players: Map<string, Player>): boolean {
        return [...players.values()].every(player => player.isStageCompleted(player.stage()));
    }

    public startStage(players: Map<string, Player>): void {
        players.forEach(player => {
            player.resetStage();
        });
    }
}
