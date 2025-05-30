import type { ControlsState } from './types';

export class KeyboardControls {
  private controls: ControlsState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
    restart: false,
  };

  constructor() {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
  }

  public start() {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
  }

  public stop() {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown(e: KeyboardEvent) {
    switch (e.key.toLowerCase()) {
      case 'w':
        this.controls.forward = true;
        break;
      case 's':
        this.controls.backward = true;
        break;
      case 'a':
        this.controls.left = true;
        break;
      case 'd':
        this.controls.right = true;
        break;
      case ' ':
        this.controls.brake = true;
        break;
      case 'r':
        this.controls.restart = true;
        break;
    }
  }

  private handleKeyUp(e: KeyboardEvent) {
    switch (e.key.toLowerCase()) {
      case 'w':
        this.controls.forward = false;
        break;
      case 's':
        this.controls.backward = false;
        break;
      case 'a':
        this.controls.left = false;
        break;
      case 'd':
        this.controls.right = false;
        break;
      case ' ':
        this.controls.brake = false;
        break;
      case 'r':
        this.controls.restart = false;
        break;
    }
  }

  public getControls(): ControlsState {
    return { ...this.controls };
  }

  public resetRestart() {
    this.controls.restart = false;
  }

  public cleanup() {
    this.stop();
  }
} 