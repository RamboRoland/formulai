// The tyres' grip budget (Car.slide): slip + load → force. Pure functions.
// Front: side force only (Magic Formula). Rear: TMeasy combined slip —
// braking, driving and turning share ONE grip budget, no priority
// (.claude/tasks/braking-strength.md 1c–2c).

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
const mfShape = (slideGrip: number): number => 2 - (2 / Math.PI) * Math.asin(slideGrip);

// Side force from the slip angle — Pacejka's Magic Formula F = max ×
// sin(C × atan(B × α)): most grip (max, gripG × the load) at peakSlipDeg,
// less beyond it, slideGrip of it when fully sliding (so full lock at
// speed ploughs). B puts the peak at peakSlipDeg. Returns F(α, max).
export const magicFormula = (peakSlipDeg: number, slideGrip: number): (alpha: number, max: number) => number => {
    const shape = mfShape(slideGrip);
    const stiff = Math.tan(Math.PI / (2 * shape)) / (peakSlipDeg * Math.PI / 180);
    return (alpha, max) => max * Math.sin(shape * Math.atan(stiff * alpha));
};

// A steered wheel's slip angle (rad, + = it moves to the right of where
// it points): its velocity (vx along the nose, vy across, m/s) in its own
// direction d (rad).
export const wheelSlip = (vx: number, vy: number, d: number): number =>
    Math.atan((-vx * Math.sin(d) + vy * Math.cos(d)) / slipSpeed(vx * Math.cos(d) + vy * Math.sin(d)));

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
const FL = {
    Fz0: 896,
    pCx1: 2.3, pDx1: 0.9, pEx1: 0.95, pKx1: 20, pKx2: 1, pKx3: -0.5,
    pCy1: 2.3, pDy1: 1.5, pEy1: 0.9, pKy1: 37.6, pKy2: 1.6, pKy4: 2.0,
};
// Pacejka's curve with curvature E, peak 1.
const mfCurve = (B: number, C: number, E: number, x: number) => {
    const bx = B * x;
    return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
};
// Shape factor B at a wheel load (N): Fx0 (input κ), Fy0 (input sin α).
const flBx = (Fz: number) => {
    const dfz = (Fz - FL.Fz0) / FL.Fz0;
    return (FL.pKx1 + FL.pKx2 * dfz) * Math.exp(FL.pKx3 * dfz) / (FL.pCx1 * FL.pDx1);
};
const flBy = (Fz: number) => {
    const f = Math.max(Fz, 1);
    return FL.pKy1 * FL.Fz0 * Math.sin(FL.pKy4 * Math.atan(f / (FL.pKy2 * FL.Fz0))) / f / (FL.pCy1 * FL.pDy1);
};
const flFx = (Fz: number, k: number) => mfCurve(flBx(Fz), FL.pCx1, FL.pEx1, k);
// Lateral input sin α instead of fastest-lap's tan α (tire.h :157): with
// pCy1 2.3 their curve turns negative past ~74° slip (a spinning kart);
// identical < 10°.
const flFy = (Fz: number, sinA: number) => mfCurve(flBy(Fz), FL.pCy1, FL.pEy1, sinA);
// Load tables (every 20 N to 3000 N, built once): κ at the Fx0 peak, tan α
// at the Fy0 peak, Fx0 locked (κ = −1: TMeasy's sliding Fx).
const TABLE_STEP = 20, TABLE_N = 151;
const peakOf = (f: (x: number) => number, hi: number) => {
    let lo = 0;
    for (let i = 0; i < 60; i++) {
        const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (f(m1) < f(m2)) lo = m1; else hi = m2;
    }
    return (lo + hi) / 2;
};
const T_KPK: number[] = [], T_TANPK: number[] = [], T_FXS: number[] = [];
for (let i = 0; i < TABLE_N; i++) {
    const Fz = Math.max(i * TABLE_STEP, 20);
    T_KPK.push(peakOf(k => flFx(Fz, k), 0.6));
    const s = peakOf(x => flFy(Fz, x), 0.6);
    T_TANPK.push(s / Math.sqrt(1 - s * s));
    T_FXS.push(Math.abs(flFx(Fz, -1)));
}
const lookup = (t: number[], Fz: number) => {
    const x = Math.min(Math.max(Fz / TABLE_STEP, 0), TABLE_N - 1.001);
    const i = Math.floor(x), f = x - i;
    return t[i] + (t[i + 1] - t[i]) * f;
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
// sliding Fy sideSlide × Dy (the kart's slideGrip; Robin 2c — fastest-lap's
// curve read at 45°, 0.57, is extrapolated past any fit); sxS = syS = 1 (estimate: fully
// sliding at κ = −1 / tan α = 1).
// kappa: slip ratio (ωr − vx) / |vx|; tanA: tan α (+ = the force pushes +).
// Returns [Fx, Fy, dFx/dκ at κ = 0 (rearAxle.spinStep)] in one reused
// tuple (no allocation per substep) — read it at once.
const out: [number, number, number] = [0, 0, 0];
export const tmeasy = (kappa: number, tanA: number, Fz: number, Dy: number, sideSlide: number): [number, number, number] => {
    if (Fz <= 0 || Dy <= 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
    const dFx0 = Dy * flBx(Fz) * FL.pCx1, FxM = Dy, sxM = lookup(T_KPK, Fz), FxS = Dy * lookup(T_FXS, Fz), sxS = 1;
    const dFy0 = Dy * flBy(Fz) * FL.pCy1, FyM = Dy, syM = lookup(T_TANPK, Fz), FyS = Dy * sideSlide, syS = 1;
    const rx = FxM / dFx0, ry = FyM / dFy0;
    const shx = sxM / (sxM + syM) + rx / (rx + ry);
    const shy = syM / (sxM + syM) + ry / (rx + ry);
    const sxn = kappa / shx, syn = tanA / shy;
    const s = Math.sqrt(sxn * sxn + syn * syn);
    out[2] = dFx0;
    if (s < 1e-9) { out[0] = 0; out[1] = 0; return out; }
    const c = sxn / s, sn = syn / s;
    const dF0 = Math.hypot(dFx0 * shx * c, dFy0 * shy * sn);
    const FM = Math.hypot(FxM * c, FyM * sn);
    const sM = Math.hypot(sxM / shx * c, syM / shy * sn);
    const FS = Math.hypot(FxS * c, FyS * sn);
    const sS = Math.hypot(sxS / shx * c, syS / shy * sn);
    let F: number;
    if (s <= sM) {
        const sg = s / sM;
        F = dF0 * s / (1 + sg * (sg + dF0 * sM / FM - 2));
    } else if (s < sS) {
        const sg = (s - sM) / (sS - sM);
        F = sg <= 0.5 ? FM - 2 * (FM - FS) * sg * sg : FS + 2 * (FM - FS) * (1 - sg) * (1 - sg);
    } else {
        F = FS;
    }
    out[0] = F * c; out[1] = F * sn;
    return out;
};
