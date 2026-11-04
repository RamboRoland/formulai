import type { Session, Stage } from "./Session";

// Where someone is in a session: the current stage and which stages were
// left completed / skipped. Race: every car in the lobby shares one;
// training: each client (its cars) has its own. (Moved out of Session.)
export class SessionProgress {
    public currentStage = 0;
    // Per stage: true = completed, false = skipped (set when the stage is
    // left: the client's nextStage, or an auto-advance finish).
    // undefined = not left yet. Completed when all are true.
    public stageCompleted: (boolean | undefined)[] = [];
    // The engine announced this progress' session end (once).
    public announced = false;

    // repeat: endless (every stage completed → stage 1 again, never
    // completed) — a training client's choice in req:agent/join; else
    // once through.
    public constructor(public readonly session: Session, public readonly repeat = false) {}

    public stage(): Stage {
        return this.session.stages[this.currentStage];
    }

    // Back to the first stage with no stage flags (the lobby emptied → the
    // session starts over).
    public reset(): void {
        this.currentStage = 0;
        this.stageCompleted = [];
        this.announced = false;
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
        const n = this.session.stages.length;
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
        return this.session.stages.every((_, i) => this.stageCompleted[i] === true);
    }
}
