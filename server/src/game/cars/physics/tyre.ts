// The tyres' grip budget (Car.slide): slip + load → force. Pure functions.
// Front: side force only (Magic Formula). Rear: TMeasy combined slip —
// braking, driving and turning share ONE grip budget, no priority
// (.claude/tasks/braking-strength.md 1c–2c). Short math names (kappa,
// alpha, Fz, B / C / E, the TMeasy values): SYMBOLS.md.

// The lowest speed the slips are worked out with (m/s; no ÷ 0 near
// standstill): slip angles and the rear's slip ratio κ.
const SLIP_MIN_SPEED = 1;
export const slipSpeed = (v: number): number => Math.max(Math.abs(v), SLIP_MIN_SPEED);

// Tyre load sensitivity (Pacejka pDy2, SlipValues.loadSensitivity ≤ 0): a
// tyre's peak grip (N) is gripG × load × (1 + loadSensitivity × (load −
// static) / static) — loaded more, it grips less per kg. Per axle (front)
// or per wheel at half the axle load (rear; per-wheel loads with the lift
// were rejected in braking-spin.md).
export const peakGrip = (gripG: number, load: number, staticLoad: number, loadSensitivity: number): number =>
    gripG * load * Math.max(0, 1 + loadSensitivity * (load - staticLoad) / staticLoad);

// The Magic Formula's shape C from slideGrip: sin(C × 90°) = slideGrip.
const magicFormulaShapeC = (slideGrip: number): number => 2 - (2 / Math.PI) * Math.asin(slideGrip);

// Side force from the slip angle — Pacejka's Magic Formula F = max ×
// sin(C × atan(B × α)): most grip (peakForce, gripG × the load) at
// peakSlipDeg, less beyond it, slideGrip of it when fully sliding (so full
// lock at speed ploughs). B puts the peak at peakSlipDeg. Returns
// F(α, peakForce).
export const magicFormula = (peakSlipDeg: number, slideGrip: number): (alpha: number, peakForce: number) => number => {
    // C: shape factor (how much grip is left past the peak); B: stiffness
    // factor (1/rad, where the peak sits).
    const C = magicFormulaShapeC(slideGrip);
    const B = Math.tan(Math.PI / (2 * C)) / (peakSlipDeg * Math.PI / 180);
    return (alpha, peakForce) => peakForce * Math.sin(C * Math.atan(B * alpha));
};

// A steered wheel's slip angle (rad, + = it moves to the right of where
// it points): its velocity (vx along the nose, vy across, m/s) in its own
// direction wheelAngle (rad).
export const wheelSlip = (vx: number, vy: number, wheelAngle: number): number =>
    Math.atan((-vx * Math.sin(wheelAngle) + vy * Math.cos(wheelAngle))
        / slipSpeed(vx * Math.cos(wheelAngle) + vy * Math.sin(wheelAngle)));

// An unsteered axle's slip angle (rad): across / along (m/s).
export const axleSlip = (across: number, along: number): number =>
    Math.atan(across / slipSpeed(along));

// ---- The rear tyre's curve shapes, from fastest-lap's kart (the only kart
// Fx data found): github.com/juanmanzanero/fastest-lap commit 0660208,
// database/vehicles/kart/roberto-lot-kart-2016.xml, rear tyre, MF 5.2
// notation (src/core/tire/tire_pacejka.hpp :123–179); Fz0 = 560 N ×
// lambdaFz0 1.6. Source of its values: only "eprints.soton.ac.uk/385883"
// (Lot & Dal Bianco 2016) — fitted / copied / guessed unknown. Used for
// the SHAPES only (stiffness, κ / α of the peak, locked Fx); the peaks are
// ours (gripG both ways, μx = μy: braking-strength.md 1, "scaled").
// MF 5.2's own names: Fz0 reference load (N); pCx1 / pCy1 shape C, pDx1 /
// pDy1 peak friction μ, pEx1 / pEy1 curvature E (along / sideways);
// pKx1–3 longitudinal slip stiffness ÷ load and its load dependency;
// pKy1 / pKy2 / pKy4 cornering stiffness and its load dependency.
const FASTEST_LAP_REAR = {
    Fz0: 896,
    pCx1: 2.3, pDx1: 0.9, pEx1: 0.95, pKx1: 20, pKx2: 1, pKx3: -0.5,
    pCy1: 2.3, pDy1: 1.5, pEy1: 0.9, pKy1: 37.6, pKy2: 1.6, pKy4: 2.0,
};
// Pacejka's curve with curvature E, peak 1: B stiffness factor, C shape
// factor, E curvature, x the input (κ or sin α).
const pacejkaCurve = (B: number, C: number, E: number, x: number) => {
    const bx = B * x;
    return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
};
// Shape factor B at a wheel load (Fz, N): Fx0 (input κ), Fy0 (input sin α).
const fastestLapShapeBx = (Fz: number) => {
    const dfz = (Fz - FASTEST_LAP_REAR.Fz0) / FASTEST_LAP_REAR.Fz0; // MF's dfz: relative load change
    return (FASTEST_LAP_REAR.pKx1 + FASTEST_LAP_REAR.pKx2 * dfz) * Math.exp(FASTEST_LAP_REAR.pKx3 * dfz)
        / (FASTEST_LAP_REAR.pCx1 * FASTEST_LAP_REAR.pDx1);
};
const fastestLapShapeBy = (Fz: number) => {
    const clampedFz = Math.max(Fz, 1);
    return FASTEST_LAP_REAR.pKy1 * FASTEST_LAP_REAR.Fz0
        * Math.sin(FASTEST_LAP_REAR.pKy4 * Math.atan(clampedFz / (FASTEST_LAP_REAR.pKy2 * FASTEST_LAP_REAR.Fz0)))
        / clampedFz / (FASTEST_LAP_REAR.pCy1 * FASTEST_LAP_REAR.pDy1);
};
// The pure-slip curves (peak 1): Fx0 over κ, Fy0 over sin α.
const fastestLapFx0 = (Fz: number, kappa: number) =>
    pacejkaCurve(fastestLapShapeBx(Fz), FASTEST_LAP_REAR.pCx1, FASTEST_LAP_REAR.pEx1, kappa);
// Lateral input sin α instead of fastest-lap's tan α (tire.h :157): with
// pCy1 2.3 their curve turns negative past ~74° slip (a spinning kart);
// identical < 10°.
const fastestLapFy0 = (Fz: number, sinAlpha: number) =>
    pacejkaCurve(fastestLapShapeBy(Fz), FASTEST_LAP_REAR.pCy1, FASTEST_LAP_REAR.pEy1, sinAlpha);
// Load tables (every 20 N to 3000 N, built once): κ at the Fx0 peak, tan α
// at the Fy0 peak, Fx0 locked (κ = −1: TMeasy's sliding Fx).
const TABLE_STEP_N = 20, TABLE_SIZE = 151;
// The input (0..high) where a one-peak curve is highest (ternary search).
const peakInput = (curve: (x: number) => number, high: number) => {
    let low = 0;
    for (let i = 0; i < 60; i++) {
        const lowerThird = low + (high - low) / 3, upperThird = high - (high - low) / 3;
        if (curve(lowerThird) < curve(upperThird)) low = lowerThird; else high = upperThird;
    }
    return (low + high) / 2;
};
const PEAK_KAPPA_BY_LOAD: number[] = [], PEAK_TAN_ALPHA_BY_LOAD: number[] = [], LOCKED_FX_BY_LOAD: number[] = [];
for (let i = 0; i < TABLE_SIZE; i++) {
    const Fz = Math.max(i * TABLE_STEP_N, 20);
    PEAK_KAPPA_BY_LOAD.push(peakInput(kappa => fastestLapFx0(Fz, kappa), 0.6));
    const peakSinAlpha = peakInput(sinAlpha => fastestLapFy0(Fz, sinAlpha), 0.6);
    PEAK_TAN_ALPHA_BY_LOAD.push(peakSinAlpha / Math.sqrt(1 - peakSinAlpha * peakSinAlpha));
    LOCKED_FX_BY_LOAD.push(Math.abs(fastestLapFx0(Fz, -1)));
}
const lookup = (table: number[], Fz: number) => {
    const position = Math.min(Math.max(Fz / TABLE_STEP_N, 0), TABLE_SIZE - 1.001);
    const i = Math.floor(position), fraction = position - i;
    return table[i] + (table[i + 1] - table[i]) * fraction;
};

// One rear wheel, TMeasy (Rill) combined slip. No primary Rill text was
// readable; the equations from two agreeing codes: carpy TMEasy.py
// (4ca50f1, :54–55, :72–160, "based on Rill & Castro's Matlab code") and
// uwsbel low-fidelity-dynamic-models 18dof/dof18.cpp (992faca, :440–535);
// Chrono ChTMeasyTire. Each slip normalised (ŝx, ŝy), ONE curve on the
// combined slip s — initial slope dF0, peak FM at sM, two parabolas down
// to the sliding FS at sS, FS beyond — each value blended by the slip
// direction φ; Fx = F cos φ, Fy = F sin φ (no priority).
// Values at this load (Fz, N): slopes and κ / α of the peaks from
// fastest-lap's curves (above); both peaks Dy (gripG × load with load
// sensitivity, peakGrip); sliding Fx fastest-lap's locked value × Dy,
// sliding Fy slideGrip × Dy (the kart's slideGrip; Robin 2c — fastest-lap's
// curve read at 45°, 0.57, is extrapolated past any fit); sxS = syS = 1 (estimate: fully
// sliding at κ = −1 / tan α = 1).
// kappa: slip ratio (ωr − vx) / |vx|; tanAlpha: tan α (+ = the force
// pushes +); Fz: the wheel's load (N); Dy: its peak force (N, Pacejka's D).
// TMeasy's names: dFx0 / dFy0 initial slope (N per unit slip), FxM / FyM
// peak force, sxM / syM slip at the peak, FxS / FyS sliding force, sxS /
// syS slip where full sliding starts.
// Returns [Fx, Fy, dFx/dκ at κ = 0 (rearAxle.spinStep)] in one reused
// tuple (no allocation per substep) — read it at once.
const forces: [number, number, number] = [0, 0, 0];
export const tmeasy = (kappa: number, tanAlpha: number, Fz: number, Dy: number, slideGrip: number): [number, number, number] => {
    if (Fz <= 0 || Dy <= 0) { forces[0] = 0; forces[1] = 0; forces[2] = 0; return forces; }
    const dFx0 = Dy * fastestLapShapeBx(Fz) * FASTEST_LAP_REAR.pCx1, FxM = Dy, sxM = lookup(PEAK_KAPPA_BY_LOAD, Fz),
        FxS = Dy * lookup(LOCKED_FX_BY_LOAD, Fz), sxS = 1;
    const dFy0 = Dy * fastestLapShapeBy(Fz) * FASTEST_LAP_REAR.pCy1, FyM = Dy, syM = lookup(PEAK_TAN_ALPHA_BY_LOAD, Fz),
        FyS = Dy * slideGrip, syS = 1;
    // Peak ÷ initial slope, along / sideways (part of the normalising).
    const peakSlopeRatioX = FxM / dFx0, peakSlopeRatioY = FyM / dFy0;
    // Normalising factors that make κ and tan α comparable (carpy: hsxn /
    // hsyn).
    const normaliseX = sxM / (sxM + syM) + peakSlopeRatioX / (peakSlopeRatioX + peakSlopeRatioY);
    const normaliseY = syM / (sxM + syM) + peakSlopeRatioY / (peakSlopeRatioX + peakSlopeRatioY);
    // sxn / syn: the normalised slips ŝx, ŝy (carpy: Sxn / Syn); s: the
    // combined slip (≥ 0).
    const sxn = kappa / normaliseX, syn = tanAlpha / normaliseY;
    const s = Math.sqrt(sxn * sxn + syn * syn);
    forces[2] = dFx0;
    if (s < 1e-9) { forces[0] = 0; forces[1] = 0; return forces; }
    // φ: the direction of the combined slip.
    const cosPhi = sxn / s, sinPhi = syn / s;
    // In that direction: dF0 initial slope, FM / sM peak force and its slip,
    // FS / sS sliding force and the slip where sliding starts; F the force.
    const dF0 = Math.hypot(dFx0 * normaliseX * cosPhi, dFy0 * normaliseY * sinPhi);
    const FM = Math.hypot(FxM * cosPhi, FyM * sinPhi);
    const sM = Math.hypot(sxM / normaliseX * cosPhi, syM / normaliseY * sinPhi);
    const FS = Math.hypot(FxS * cosPhi, FyS * sinPhi);
    const sS = Math.hypot(sxS / normaliseX * cosPhi, syS / normaliseY * sinPhi);
    let F: number;
    // sigma: where s sits within the current curve piece (0..1).
    if (s <= sM) {
        const sigma = s / sM;
        F = dF0 * s / (1 + sigma * (sigma + dF0 * sM / FM - 2));
    } else if (s < sS) {
        const sigma = (s - sM) / (sS - sM);
        F = sigma <= 0.5 ? FM - 2 * (FM - FS) * sigma * sigma : FS + 2 * (FM - FS) * (1 - sigma) * (1 - sigma);
    } else {
        F = FS;
    }
    forces[0] = F * cosPhi; forces[1] = F * sinPhi;
    return forces;
};
