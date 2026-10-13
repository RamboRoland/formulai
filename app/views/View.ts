// Contract for a pure-TS view: mount into a root element, tear itself down
// on unmount. No React, no framework lifecycle. Views own their DOM, event
// listeners, subscriptions, and internal state; unmount() must release all of them.
export interface View {
    mount(root: HTMLElement): void;
    unmount(): void;
}
