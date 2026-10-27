import type { Track } from "~/tracks/Track";
import type { Car } from "~/cars/Car";
import { GokartTraining } from "~/cars/gokarts/GokartTraining";
import { GokartGokartCentralen } from "~/cars/gokarts/GokartGokartCentralen";
import type { Player } from "~/Player";
import { createTrack, resolveTrackRef } from "~/tracks/registry";
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

    // Stages whose track is missing or can't be raced (no outline) are
    // skipped with a console warning. A session can end up with no stages;
    // RacingView shows an error screen for that.
    public constructor(json: SessionJSON) {
        this.name = json.name;
        this.displayName = json.displayName;
        this.cars = [...json.cars];
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
        const instance = car === 'GokartGokartCentralen'
            ? new GokartGokartCentralen(this.stage().track)
            : new GokartTraining(this.stage().track);
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

    public isCompleted(): boolean {
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
