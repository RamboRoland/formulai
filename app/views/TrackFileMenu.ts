import { deserializeTrack, serializeTrack, trackFileStem, type TrackData } from '~/tracks/serialize';
import {
    deleteTrack, listTracks, readTrack, saveTrack, trackStatus,
    type StoreEntry, type StoreFolder, type TrackStatus,
} from '~/tracks/store';

// What the menu needs from the editor shell. `getState` returns the LIVE
// authoring state (read-only use); `replace` swaps it (null = blank track).
export type TrackFileHost = {
    getState(): Omit<TrackData, 'name' | 'displayName'>;
    replace(data: TrackData | null): void;
};

type TrackIdentity = { name: string; displayName: string };

// "GoKartTrackSix" style: starts with a capital letter, letters/digits only.
const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

const STATUS_STYLE: Record<TrackStatus, { text: string; color: string }> = {
    draft:     { text: 'Draft',               color: '#9a9a9a' },
    published: { text: 'Published',           color: '#5cc85c' },
    changed:   { text: 'Unpublished changes', color: '#f0a030' },
};

// New / Open / Save / Publish cluster, pinned top-right of the editor
// viewport. Talks to the dev-only track store:
//   Save    → app/assets/tracks/drafts/<stem>.json (always; the game never sees it)
//   Publish → app/assets/tracks/<stem>.json, then removes the draft
// A track with both files is "published, with unpublished changes".
export class TrackFileMenu {
    private host: TrackFileHost;
    private parent: HTMLElement | null = null;
    private el: HTMLDivElement | null = null;
    private labelEl: HTMLSpanElement | null = null;
    private modalEl: HTMLDivElement | null = null;
    private modalOnClose: (() => void) | null = null;
    private toastEl: HTMLDivElement | null = null;
    private toastTimer: number | null = null;
    private busy = false;

    // Track being edited (null = never saved). Fixed after the first save.
    private current: TrackIdentity | null = null;
    // Which files exist for `current` (null while never saved).
    private status: TrackStatus | null = null;
    // Snapshot of the state at the last save/open/new → unsaved-change check.
    private savedSignature = '';

    public constructor(host: TrackFileHost) {
        this.host = host;
    }

    public mount(parent: HTMLElement): void {
        this.parent = parent;
        const el = document.createElement('div');
        this.el = el;
        Object.assign(el.style, {
            position: 'absolute', top: '10px', right: '10px', zIndex: '5',
            display: 'flex', gap: '6px', alignItems: 'center',
        });

        const label = document.createElement('span');
        this.labelEl = label;
        Object.assign(label.style, { fontSize: '12px', opacity: '0.75', marginRight: '4px' });
        el.appendChild(label);

        el.append(
            button('New', () => this.run(() => this.newTrack())),
            button('Open', () => this.run(() => this.openDialog())),
            button('Save', () => this.run(() => this.save())),
            button('Publish', () => this.run(() => this.publish()), '#2a5a8a'),
        );
        parent.appendChild(el);

        this.markSaved();
        this.updateLabel();
    }

    public unmount(): void {
        if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
        this.closeModal();
        this.el?.remove();
        this.toastEl?.remove();
        this.el = this.labelEl = this.toastEl = null;
        this.parent = null;
    }

    // --- Actions ---

    private async newTrack(): Promise<void> {
        if (!this.confirmDiscard()) return;
        this.host.replace(null);
        this.current = null;
        this.status = null;
        this.markSaved();
        this.updateLabel();
    }

    private async save(): Promise<void> {
        const id = this.current ?? await this.askIdentity('Save draft');
        if (!id) return;
        await saveTrack('drafts', fileFor(id.name), this.serialize(id));
        this.current = id;
        // Saving a published track leaves the game on the published version.
        this.status = this.status === 'published' || this.status === 'changed' ? 'changed' : 'draft';
        this.markSaved();
        this.updateLabel();
        this.toast(this.status === 'changed'
            ? `Saved draft → app/assets/tracks/drafts/${fileFor(id.name)} (not published yet)`
            : `Saved draft → app/assets/tracks/drafts/${fileFor(id.name)}`);
    }

    private async publish(): Promise<void> {
        const problem = this.publishProblem();
        if (problem) {
            this.toast(problem, true);
            return;
        }
        const id = this.current ?? await this.askIdentity('Publish');
        if (!id) return;

        const file = fileFor(id.name);
        const existing = (await listTracks()).published.find(e => e.file === file);
        if (existing && existing.name !== id.name) {
            this.toast(`app/assets/tracks/${file} belongs to "${existing.name}". Pick another name.`, true);
            return;
        }
        // Re-publishing the track we opened is the normal flow; only ask when
        // a published file exists that this session didn't know about.
        const knownPublished = this.status === 'published' || this.status === 'changed';
        if (existing && !knownPublished
            && !window.confirm(`Overwrite published track "${id.displayName}"?`)) return;

        // Publish first; the draft is only removed once that write succeeded.
        await saveTrack('published', file, this.serialize(id));
        this.current = id;
        this.status = 'published';
        this.markSaved();
        this.updateLabel();
        await deleteTrack('drafts', file);
        this.toast(`Published → app/assets/tracks/${file}. Reload the game to see it.`);
    }

    private async openDialog(): Promise<void> {
        const listing = await listTracks();
        const panel = this.openModal('Open track');

        // One row per track file. A draft is the newest version, so a track
        // with both files opens its draft.
        const byFile = new Map<string, StoreEntry>();
        for (const e of [...listing.published, ...listing.drafts]) byFile.set(e.file, e);
        const entries = [...byFile.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No tracks yet. Save one first.';
            empty.style.opacity = '0.6';
            panel.appendChild(empty);
        }
        for (const entry of entries) {
            const status = trackStatus(listing, entry.file) ?? 'draft';
            const folder: StoreFolder = status === 'published' ? 'published' : 'drafts';
            const row = button('', () => this.run(() => this.openFile(folder, entry, status)));
            Object.assign(row.style, {
                display: 'flex', justifyContent: 'space-between', gap: '8px',
                textAlign: 'left', width: '100%',
            });
            const name = document.createElement('span');
            name.textContent = `${entry.displayName}  ·  ${entry.file}`;
            row.append(name, statusTag(status));
            panel.appendChild(row);
        }

        const cancel = button('Cancel', () => this.closeModal());
        cancel.style.marginTop = '10px';
        panel.appendChild(cancel);
    }

    private async openFile(folder: StoreFolder, entry: StoreEntry, status: TrackStatus): Promise<void> {
        if (!this.confirmDiscard()) return;
        const data = deserializeTrack(await readTrack(folder, entry.file));
        this.closeModal();
        this.host.replace(data);
        this.current = { name: data.name, displayName: data.displayName };
        this.status = status;
        this.markSaved();
        this.updateLabel();
        this.toast(`Opened "${data.displayName}" (${STATUS_STYLE[status].text.toLowerCase()}).`);
    }

    // --- Name dialog (first save / publish) ---

    // Resolves with the chosen identity, or null if cancelled. The name must
    // not already be used by any draft or published track (name or file).
    private askIdentity(action: string): Promise<TrackIdentity | null> {
        return new Promise(resolve => {
            const panel = this.openModal(`${action} — name this track`, () => resolve(null));

            const nameInput = input('e.g. GoKartTrackSix');
            const displayInput = input('e.g. Go Kart Track Six');
            const fileHint = document.createElement('div');
            const error = document.createElement('div');
            Object.assign(fileHint.style, { opacity: '0.6', fontSize: '11px' });
            Object.assign(error.style, { color: '#ff7070', minHeight: '14px' });

            // Display name follows the name until the user edits it.
            let displayTouched = false;
            nameInput.addEventListener('input', () => {
                fileHint.textContent = nameInput.value ? `File: ${fileFor(nameInput.value)}` : '';
                if (!displayTouched) displayInput.value = prettify(nameInput.value);
            });
            displayInput.addEventListener('input', () => { displayTouched = true; });

            const submit = async () => {
                const name = nameInput.value.trim();
                const displayName = displayInput.value.trim() || prettify(name);
                if (!NAME_RE.test(name)) {
                    error.textContent = 'Name: start with a capital letter, letters and digits only.';
                    return;
                }
                try {
                    const listing = await listTracks();
                    const file = fileFor(name);
                    const clash = [...listing.drafts, ...listing.published]
                        .find(e => e.name === name || e.file === file);
                    if (clash) {
                        error.textContent = `"${clash.name}" (${clash.file}) already exists. Open it instead or pick another name.`;
                        return;
                    }
                } catch (err) {
                    error.textContent = message(err);
                    return;
                }
                // Resolve before closing: closing fires onClose → resolve(null),
                // which is then a no-op.
                resolve({ name, displayName });
                this.closeModal();
            };

            for (const el of [nameInput, displayInput]) {
                el.addEventListener('keydown', e => { if (e.key === 'Enter') void submit(); });
            }

            const row = document.createElement('div');
            Object.assign(row.style, { display: 'flex', gap: '6px', marginTop: '6px' });
            const ok = button(action, () => void submit(), '#2a5a8a');
            const cancel = button('Cancel', () => this.closeModal());
            row.append(ok, cancel);

            panel.append(
                fieldLabel('Name (id)'), nameInput, fileHint,
                fieldLabel('Display name'), displayInput,
                error, row,
            );
            nameInput.focus();
        });
    }

    // --- Modal + toast ---

    // `onClose` runs when the modal is closed any way (Cancel, Esc, backdrop).
    private openModal(title: string, onClose?: () => void): HTMLDivElement {
        this.closeModal();
        const backdrop = document.createElement('div');
        this.modalEl = backdrop;
        Object.assign(backdrop.style, {
            position: 'absolute', inset: '0', zIndex: '10',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
        });
        // Keep keystrokes (Delete, Backspace, Esc…) away from the tab's
        // window-level shortcuts while typing in the modal.
        backdrop.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Escape') this.closeModal();
        });
        backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) this.closeModal(); });

        const panel = document.createElement('div');
        Object.assign(panel.style, {
            display: 'flex', flexDirection: 'column', gap: '6px',
            padding: '16px', width: '360px', maxWidth: 'calc(100% - 32px)',
            maxHeight: '80%', overflowY: 'auto',
            backgroundColor: 'rgba(30, 30, 30, 0.97)', border: '1px solid #444', borderRadius: '6px',
            color: '#fff', fontSize: '12px',
        });
        const h = document.createElement('div');
        h.textContent = title;
        Object.assign(h.style, { fontWeight: 'bold', fontSize: '14px', marginBottom: '4px' });
        panel.appendChild(h);

        backdrop.appendChild(panel);
        this.modalOnClose = onClose ?? null;
        this.parent?.appendChild(backdrop);
        // Focus the backdrop so Esc works even without a focused input.
        backdrop.tabIndex = -1;
        backdrop.focus();
        return panel;
    }

    private closeModal(): void {
        if (!this.modalEl) return;
        const onClose = this.modalOnClose;
        this.modalEl.remove();
        this.modalEl = null;
        this.modalOnClose = null;
        onClose?.();
    }

    private toast(text: string, isError = false): void {
        if (!this.parent) return;
        if (!this.toastEl) {
            this.toastEl = document.createElement('div');
            Object.assign(this.toastEl.style, {
                position: 'absolute', top: '52px', right: '10px', zIndex: '11',
                padding: '8px 12px', borderRadius: '4px', fontSize: '12px',
                color: '#fff', maxWidth: '420px', pointerEvents: 'none',
            });
            this.parent.appendChild(this.toastEl);
        }
        this.toastEl.textContent = text;
        this.toastEl.style.backgroundColor = isError ? 'rgba(140, 40, 40, 0.95)' : 'rgba(40, 90, 50, 0.95)';
        this.toastEl.style.display = 'block';
        if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => {
            if (this.toastEl) this.toastEl.style.display = 'none';
        }, isError ? 6000 : 4000);
    }

    // --- Helpers ---

    // One action at a time; any thrown error becomes an error toast.
    private run(action: () => Promise<void>): void {
        if (this.busy) return;
        this.busy = true;
        action()
            .catch(err => this.toast(message(err), true))
            .finally(() => { this.busy = false; });
    }

    private serialize(id: TrackIdentity) {
        return serializeTrack({ ...id, ...this.host.getState() });
    }

    // A track the game can load: geometry, an outline, and a start on every
    // layout. A possibly out-of-date outline still publishes (it may have
    // been hand-tuned on purpose).
    private publishProblem(): string | null {
        const s = this.host.getState();
        if (!s.paths.some(p => p.anchors.length >= 2)) return 'Publish needs at least 2 anchors.';
        if (!s.outline || s.outline.length === 0) return 'Generate the outline first (Outline tab).';
        const empty = s.layouts.find(l => l.checkpoints.length === 0);
        if (empty) return `Layout "${empty.name}" has no checkpoints.`;
        return null;
    }

    private signature(): string {
        return JSON.stringify(this.host.getState());
    }

    private markSaved(): void {
        this.savedSignature = this.signature();
    }

    private confirmDiscard(): boolean {
        return this.signature() === this.savedSignature
            || window.confirm('Discard unsaved changes?');
    }

    // "<Display name> [status]", or "Untitled" before the first save.
    private updateLabel(): void {
        if (!this.labelEl) return;
        this.labelEl.replaceChildren(this.current ? this.current.displayName : 'Untitled');
        if (this.status) {
            const tag = statusTag(this.status);
            tag.style.marginLeft = '6px';
            this.labelEl.appendChild(tag);
        }
    }
}

function statusTag(status: TrackStatus): HTMLSpanElement {
    const { text, color } = STATUS_STYLE[status];
    const tag = document.createElement('span');
    tag.textContent = text;
    Object.assign(tag.style, {
        padding: '1px 6px', borderRadius: '3px', fontSize: '11px',
        color, border: `1px solid ${color}`, whiteSpace: 'nowrap',
    });
    return tag;
}

function fileFor(name: string): string {
    return `${trackFileStem(name)}.json`;
}

// "GoKartTrackSix" → "Go Kart Track Six"
function prettify(name: string): string {
    return name.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([0-9])([A-Za-z])/g, '$1 $2').trim();
}

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function button(label: string, onClick: () => void, bg = '#3a3a3a'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    Object.assign(btn.style, {
        padding: '6px 12px', backgroundColor: bg, color: '#fff',
        border: '1px solid #555', borderRadius: '4px', cursor: 'pointer',
        fontSize: '12px', fontFamily: 'inherit',
    });
    btn.addEventListener('click', onClick);
    return btn;
}

function input(placeholder: string): HTMLInputElement {
    const el = document.createElement('input');
    el.placeholder = placeholder;
    Object.assign(el.style, {
        padding: '5px 7px', backgroundColor: '#1e1e1e', color: '#fff',
        border: '1px solid #555', borderRadius: '3px', fontFamily: 'inherit', fontSize: '12px',
    });
    return el;
}

function fieldLabel(text: string): HTMLDivElement {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, { opacity: '0.7', marginTop: '4px' });
    return el;
}
