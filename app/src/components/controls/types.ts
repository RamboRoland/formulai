export interface Controls {
  // Pedals 0 (off) .. 1 (fully pressed). Keyboard: ramped while held.
  forward: number;
  backward: number;
  // -1 (full left) .. 1 (full right) × the car's steeringLock. Keyboard:
  // ± the steering aid's limit for the speed.
  steering: number;
  brake: number;
  restart: boolean;
}
