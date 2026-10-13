// The on-disk session format: `app/assets/sessions/<stem>.json`, hand-edited.
// Discovered at build time by `./registry.ts`, raced by the one `Session`
// class.
export type SessionJSON = {
    name: string;          // id, e.g. "TrainingOne" (also the lobby/protocol value)
    displayName: string;   // shown in dropdowns, e.g. "Training 1"
    // Car classes you choose from (see CAR_CLASSES). Single player and AI
    // mode race the first one.
    cars: string[];
    stages: SessionStageJSON[];
};

export type SessionStageJSON = {
    // Track name (the track file's "name", e.g. "GoKartTrackOne").
    track: string;
    // Layout id OR name (id tried first). Omitted → the track's first layout.
    layout?: string;
    // Laps for a loop layout. Ignored on one-way layouts (always one run).
    laps: number;
};
