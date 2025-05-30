import type { GameState } from '../../types';
import { WebSocketClient } from '../../services/websocket';

export class WebSocketControls {
  private ws: WebSocketClient;
  private controls = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
    restart: false,
  };

  constructor(wsClient: WebSocketClient) {
    this.ws = wsClient;
    
    // Subscribe to controls messages
    this.ws.subscribe('controls', this.handleControls);
  }

  public connect() {
    this.ws.connect();
  }

  public disconnect() {
    this.ws.disconnect();
  }

  public getControls() {
    return this.controls;
  }

  public resetRestart() {
    this.controls.restart = false;
  }

  public cleanup() {
    this.ws.unsubscribe('controls', this.handleControls);
  }

  private handleControls = (type: string, data: any) => {
    if (type === 'controls') {
      this.controls = {
        ...this.controls,
        ...data,
      };
    }
  };
} 