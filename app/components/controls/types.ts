export interface Controls {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  brake: boolean;
}

export interface ControlsState extends Controls {
  restart: boolean;
} 