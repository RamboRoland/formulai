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
    // Never completed: every stage completed → a new round from stage 1.
    public readonly repeat: boolean;
    // training: each client moves through the stages on its own; race: one
    // shared stage for the whole lobby. Omitted in the JSON = training.
    public readonly mode: 'training' | 'race';

    // Stages whose track is missing or can't be raced (no outline) are
    // skipped with a console warning. A session can end up with no stages;
    // RacingView shows an error screen for that.
    public constructor(json: SessionJSON) {
        this.name = json.name;
        this.displayName = json.displayName;
        this.cars = [...json.cars];
        this.repeat = json.repeat ?? false;
        this.mode = json.mode ?? 'training';
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


    // A car of class `car` (one of `cars`) on `track` (the stage it starts).
    public chooseCar(car: string, track: Track): Car {
        const instance = car === 'Hyrkart240cc' ? new Hyrkart240cc(track)
            : car === 'Racingkart125cc' ? new Racingkart125cc(track)
            : new HyrkartCentralen(track);
        // Place it on the grid now that its size is known (subclass fields
        // like lengthM aren't set yet inside the base Car constructor).
        instance.reset();
        return instance;
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
