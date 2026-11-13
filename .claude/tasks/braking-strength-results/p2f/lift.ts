// Inner-rear lift check (read-only): rearLift and the load moved across,
// split into roll and caster jacking (loads.innerRearLift's two terms).
// Steady corners (gas holds the speed, steering trimmed to a target lateral
// g, 4 s, averages over the last 1 s) and the 2e decisive case (Centralen
// 45 km/h, steering for 0.7 g asked, then the brake at L).
import * as path from 'path';
const DT = 1 / 60, G = 9.81;
const track = { startPosition: { x: 0, y: 0 }, startAngle: 0, spawn: (l: number) => ({ x: 100 + l, y: 50, angle: 0 }) };
const src = process.argv[2];
const make = (k: string) => { const Cls = require(path.resolve(src, 'game/cars/gokarts', k))[k]; const c = new Cls(track); c.reset(); return c; };
const terms = (car: any) => {
  const s = car.slip, m = s.massKg, L = car.wheelbaseMeters, b = L * s.rearShare, a = L - b;
  const staticFront = m * G * b / L, staticRear = m * G * a / L;
  const loadRear = staticRear * car.loadShareRear, inner = loadRear / 2;
  const roll = Math.abs(car.lateralG) * m * G * s.cgHeightMeters / ((s.rearTrackMeters + s.frontTrackMeters) / 2) * staticRear / (staticFront + staticRear);
  const jack = staticRear / 2 * s.jacking * Math.sin(Math.abs(car.wheelAngle) * Math.PI / 180) / Math.sin(car.wheelLock * Math.PI / 180);
  return { rollShare: roll / inner, jackShare: jack / inner };
};
const row = (label: string, car: any) => {
  const t = terms(car);
  return `${label}: lat ${car.lateralG.toFixed(2)} g, wheel ${car.wheelAngle.toFixed(1)}°, rear load ${(car.loadShareRear * 100).toFixed(0)} %, rearLift ${car.rearLift.toFixed(2)} → moved ${(1 - car.rearLift).toFixed(2)} (roll ${t.rollShare.toFixed(2)} + jacking ${t.jackShare.toFixed(2)})`;
};
for (const [k, kmh] of [['HyrkartCentralen', 45], ['Hyrkart270cc', 50], ['Racingkart125cc', 60]] as [string, number][]) {
  for (const target of [0.4, 0.8, 1.0]) {
    const car = make(k); car.speed = kmh; let steer = 0.05, gas = 0.3;
    for (let i = 0; i < 4 / DT; i++) {
      gas = Math.max(0, Math.min(1, gas + (kmh - car.speed) * 0.02));
      steer = Math.max(-1, Math.min(1, steer + (target - Math.abs(car.lateralG)) * 0.01));
      car.controls = { forward: gas, backward: 0, steering: steer, brake: 0, restart: false };
      car.applyControls(DT);
    }
    console.log(`${k.padEnd(16)} ${kmh} km/h steady ${target} g → ${row('', car)}`);
  }
}
// Decisive case: one.ts set-up.
const car = make('HyrkartCentralen'); const v = 45 / 3.6, R = v * v / (0.7 * G);
const steer = Math.atan(car.wheelbaseMeters / R) * 180 / Math.PI / car.wheelLock, L = car.brakeLock();
car.speed = 45; let gas = 0.3;
for (let i = 0; i < 2.6 / DT; i++) {
  const t = i * DT; const br = t >= 2 ? L : 0;
  if (t < 2) gas = Math.max(0, Math.min(1, gas + (45 - car.speed) * 0.02)); else gas = 0;
  car.controls = { forward: gas, backward: 0, steering: steer, brake: br, restart: false };
  car.applyControls(DT);
  if (Math.abs(t - 1.98) < 1e-6 || Math.abs(t - 2.4) < 1e-6) console.log(`decisive Centralen 45 km/h, ${t < 2 ? 'before the brake' : '0.4 s at L'} → ${row('', car)}`);
}
