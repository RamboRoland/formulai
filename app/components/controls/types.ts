export interface Controls {
  forward: boolean;
  backward: boolean;
  // -1 (full left) .. 1 (full right) × the car's rotationSpeed. Keyboard:
  // -1 / 0 / 1.
  steering: number;
  brake: boolean;
  restart: boolean;
}