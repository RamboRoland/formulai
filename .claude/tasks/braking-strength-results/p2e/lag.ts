// Lag from brake input to the rear letting go, in a steady corner.
// Usage (from server/): node -r ts-node/register lag.ts <label>=<src dir> ...
import * as path from 'path';
const DT = 1 / 60, G = 9.81;
const KARTS: [string, number][] = [['HyrkartCentralen', 45], ['Hyrkart270cc', 50], ['Racingkart125cc', 60]];
const track = { startPosition: { x: 0, y: 0 }, startAngle: 0, spawn: (l: number) => ({ x: 100 + l, y: 50, angle: 0 }) };
const srcs = process.argv.slice(2).map(a => a.split('='));
const deg = (r: number) => r * 180 / Math.PI;
for (const [k, kmh] of KARTS) {
  for (const latG of [0.4, 0.7]) {
    for (const mode of ['full', 'L', 'kbd']) {
      const row: string[] = [];
      for (const [label, src] of srcs) {
        const Cls = require(path.resolve(src, 'game/cars/gokarts', k))[k];
        const car = new Cls(track); car.reset();
        const L = car.brakeLock(), v = kmh / 3.6;
        const R = v * v / (latG * G);
        const steer = Math.atan(car.wheelbaseMeters / R) * 180 / Math.PI / car.wheelLock;
        car.speed = kmh;
        let gas = 0.3, t0 = 2.0, lock = -1, slip5 = -1, yaw = -1, base = 0, baseYaw = 0, latAt = 0;
        for (let i = 0; i < 4 / DT; i++) {
          const t = i * DT;
          let brake = 0;
          if (t < t0) { gas = Math.max(0, Math.min(1, gas + (kmh - car.speed) * 0.02)); }
          else {
            gas = 0;
            const tb = t - t0;
            brake = mode === 'full' ? 1 : mode === 'L' ? L : Math.min(1, tb / 0.6) * 0.8 * L;
          }
          car.controls = { forward: gas, backward: 0, steering: steer, brake, restart: false };
          car.applyControls(DT);
          const slip = deg(Math.atan2(car.lateralSpeed, Math.max(Math.abs(car.speed / 3.6), 1)));
          if (Math.abs(t - (t0 - DT)) < 1e-9) { base = slip; baseYaw = car.yawRate; latAt = car.lateralG; }
          if (t >= t0) {
            const tb = t - t0 + DT;
            if (lock < 0 && car.rearLocked) lock = tb;
            if (slip5 < 0 && Math.abs(slip - base) >= 5) slip5 = tb;
            if (yaw < 0 && Math.abs(car.yawRate) >= Math.abs(baseYaw) * 1.5 + 0.05) yaw = tb;
          }
        }
        const f = (x: number) => x < 0 ? '  –  ' : x.toFixed(2).padStart(5);
        row.push(`${label}: lock ${f(lock)} slip+5° ${f(slip5)} yaw×1.5 ${f(yaw)}`);
      }
      console.log(`${k.padEnd(16)} ${kmh} km/h lat ${latG} g ${mode.padEnd(4)} | ${row.join(' | ')}`);
    }
  }
}
