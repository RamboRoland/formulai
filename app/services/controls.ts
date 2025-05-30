import type { ControlsState } from '../components/controls/types';
import { WebSocketService } from './websocket';

export class ControlsService {
    private controls: ControlsState = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        brake: false,
        restart: false,
    };

    constructor(private wsService: WebSocketService) {
        // Subscribe to control messages
        this.wsService.subscribe('controls', this.handleControls.bind(this));
    }

    private handleControls(controls: ControlsState) {
        this.controls = {
            ...this.controls,
            ...controls,
        };
    }

    public getControls(): ControlsState {
        return { ...this.controls };
    }

    public resetRestart() {
        this.controls.restart = false;
    }

    public cleanup() {
        this.wsService.unsubscribe('controls', this.handleControls.bind(this));
    }
} 