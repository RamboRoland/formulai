// True lock pedal: the smallest constant pedal that locks the rear (rearLocked) within 1.0 s
// of braking, straight and in a steady corner (one.ts set-up), and what happens just past it.
import * as path from 'path';
const DT = 1 / 60, G = 9.81;
const track = { startPosition: { x: 0, y: 0 }, startAngle: 0, spawn: (l: number) => ({ x: 100 + l, y: 50, angle: 0 }) };
const srcs = process.argv.slice(2).map(a => a.split('='));
const go = (src: string, k: string, kmh: number, latG: number, pedal: number | 'L', T = 1.5) => {
  const Cls = require(path.resolve(src, 'game/cars/gokarts', k))[k];
  const car = new Cls(track); car.reset();
  const L = car.brakeLock(), v = kmh / 3.6;
  const steer = latG > 0 ? Math.atan(car.wheelbaseMeters / (v * v / (latG * G))) * 180 / Math.PI / car.wheelLock : 0;
  const p = pedal === 'L' ? L : pedal;
  car.speed = kmh; let gas = 0.3, lock = -1, slip5 = -1, base = 0;
  for (let i = 0; i < (2 + T) / DT; i++) {
    const t = i * DT; let brake = 0;
    if (t < 2) gas = Math.max(0, Math.min(1, gas + (kmh - car.speed) * 0.02)); else { gas = 0; brake = p; }
    car.controls = { forward: gas, backward: 0, steering: steer, brake, restart: false };
    car.applyControls(DT);
    const slip = Math.atan2(car.lateralSpeed, Math.max(Math.abs(car.speed / 3.6), 1)) * 180 / Math.PI;
    if (Math.abs(t - (2 - DT)) < 1e-9) base = slip;
    if (t >= 2) { const tb = t - 2 + DT; if (lock < 0 && car.rearLocked) lock = tb; if (slip5 < 0 && Math.abs(slip - base) >= 5) slip5 = tb; }
  }
  return { L, lock, slip5 };
};
const f = (x: number) => x < 0 ? '  – ' : x.toFixed(2);
for (const [k, kmh] of [['HyrkartCentralen', 45], ['Hyrkart270cc', 50], ['Racingkart125cc', 60]] as [string, number][]) {
  for (const latG of [0, 0.4, 0.7]) {
    const row: string[] = [];
    for (const [label, src] of srcs) {
      let lo = 0, hi = 1;
      if (go(src, k, kmh, latG, 1).lock < 0 || go(src, k, kmh, latG, 1).lock > 1) { row.push(`${label}: never locks`); continue; }
      for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; const r = go(src, k, kmh, latG, m); if (r.lock >= 0 && r.lock <= 1.0) hi = m; else lo = m; }
      const L = go(src, k, kmh, latG, 'L').L;
      const a = go(src, k, kmh, latG, Math.min(1, hi * 1.1)), b = go(src, k, kmh, latG, Math.min(1, hi * 1.25));
      row.push(`${label}: L ${L.toFixed(3)} true ${hi.toFixed(3)} (${(hi / L).toFixed(2)}×L); ×1.1 lock ${f(a.lock)} slip5 ${f(a.slip5)}; ×1.25 lock ${f(b.lock)} slip5 ${f(b.slip5)}`);
    }
    console.log(`${k.padEnd(16)} ${kmh} lat ${latG} | ${row.join(' | ')}`);
  }
}
