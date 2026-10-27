import type { Controls } from './types';

export class KeyboardControls {
  private controls: Omit<Controls, 'steering'> = {
    forward: false,
    backward: false,
    brake: false,
    restart: false,
  };
  // A / D held. Sent as steering -1 / 0 / 1 (both held → 0).
  private left = false;
  private right = false;

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
        this.left = true;
        break;
      case 'd':
        this.right = true;
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
        this.left = false;
        break;
      case 'd':
        this.right = false;
        break;
      case ' ':
        this.controls.brake = false;
        break;
      case 'r':
        this.controls.restart = false;
        break;
    }
  }

  public getControls(): Controls {
    return { ...this.controls, steering: (this.right ? 1 : 0) - (this.left ? 1 : 0) };
  }

  public resetRestart() {
    this.controls.restart = false;
  }

  public cleanup() {
    this.stop();
  }
}