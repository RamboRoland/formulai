import type { Controls } from './types';
import type { KartHandling } from '~/protocol';

// Seconds from 0 to fully pressed while a key is held, and back to 0 after
// it's let go: a tap is a light press, holding it presses all the way.
const GAS_SECONDS = 0.3;
const BRAKE_SECONDS = 0.6;
const RELEASE_SECONDS = 0.1;
// Brake aid: held Space stops at this share of the kart's brakeLock (the
// hardest stop that still steers; past it the rear wheels lock).
const BRAKE_AID = 0.8;
const G = 9.81;

// Moves a pedal towards held (full) or let go (0) by this frame's share.
function ramp(value: number, held: boolean, seconds: number, dt: number, full = 1): number {
  return held ? Math.min(full, value + full * dt / seconds) : Math.max(0, value - dt / RELEASE_SECONDS);
}

// Keyboard → controls. W / S / Space ramp the gas / reverse / brake (Space
// up to BRAKE_AID × brakeLock); A / D steer as far as is useful at the
// speed (steeringLimit), the server turns the wheel there at its own rate.
// update() once per frame.
export class KeyboardControls {
  private held = { forward: false, backward: false, brake: false, left: false, right: false };
  private controls: Controls = { forward: 0, backward: 0, steering: 0, brake: 0, restart: false };
  // The joined kart's handling (res:player/join); not set → full lock.
  private handling: KartHandling | null = null;

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

  public setHandling(handling: KartHandling) {
    this.handling = handling;
  }

  private handleKeyDown(e: KeyboardEvent) {
    this.setKey(e.key.toLowerCase(), true);
  }

  private handleKeyUp(e: KeyboardEvent) {
    this.setKey(e.key.toLowerCase(), false);
  }

  private setKey(key: string, down: boolean) {
    switch (key) {
      case 'w': this.held.forward = down; break;
      case 's': this.held.backward = down; break;
      case 'a': this.held.left = down; break;
      case 'd': this.held.right = down; break;
      case ' ': this.held.brake = down; break;
      case 'r': this.controls.restart = down; break;
    }
  }

  // The pedals move along their ramps by dt seconds; steering = the held
  // side × the limit for speedKmh (the car's own, signed).
  public update(dt: number, speedKmh: number) {
    const c = this.controls;
    c.forward = ramp(c.forward, this.held.forward, GAS_SECONDS, dt);
    c.backward = ramp(c.backward, this.held.backward, GAS_SECONDS, dt);
    c.brake = ramp(c.brake, this.held.brake, BRAKE_SECONDS, dt, BRAKE_AID * (this.handling?.brakeLock ?? 1));
    c.steering = ((this.held.right ? 1 : 0) - (this.held.left ? 1 : 0)) * this.steeringLimit(speedKmh);
  }

  // Steering aid: past this the front tyres are beyond their grip peak and
  // only plough (bicycle model) — the wheel angle that holds the tightest
  // circle the grip allows (wheelbase / radius, radius = v² / (gripG · g))
  // plus the tyres' peak slip angle, as a share of the wheel lock.
  private steeringLimit(speedKmh: number): number {
    const h = this.handling;
    const v = Math.abs(speedKmh) / 3.6;
    if (!h || v < 1) return 1;
    const degrees = h.wheelbaseMeters * h.gripG * G / (v * v) * 180 / Math.PI + h.peakSlipDeg;
    return Math.min(1, degrees / h.wheelLock);
  }

  public getControls(): Controls {
    return { ...this.controls };
  }

  public resetRestart() {
    this.controls.restart = false;
  }

  public cleanup() {
    this.stop();
  }
}
