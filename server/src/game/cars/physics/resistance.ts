import { G } from "./constants";

// What slows the kart along the nose without the brake (Car.slide,
// Car.longitudinal in reverse, rearAxle.brakeLock; Gillespie, Fundamentals
// of Vehicle Dynamics ch. 2). Forces in N. Short math names (m, v, ρ,
// CdA, Crr): SYMBOLS.md.

// Air density (kg/m³, sea level, 15 °C) for the drag.
const AIR_DENSITY = 1.225;

// Rolling resistance: Crr × m × g (tyres on asphalt; DriveValues.rollingResistance).
export const rollingForce = (rollingResistance: number, massKg: number): number =>
    rollingResistance * massKg * G;

// Air drag: ½ ρ CdA v² (DriveValues.dragArea, kart + driver; v m/s).
export const airDrag = (dragArea: number, v: number): number =>
    0.5 * AIR_DENSITY * dragArea * v * v;
