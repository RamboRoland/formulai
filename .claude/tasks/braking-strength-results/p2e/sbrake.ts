import * as path from 'path';
const DT = 1 / 60;
const src = process.argv[2];
const track = { startPosition: { x: 0, y: 0 }, startAngle: 0, spawn: (l: number) => ({ x: 100 + l, y: 50, angle: 0 }) };
for (const k of ['HyrkartCentralen', 'Hyrkart270cc', 'Racingkart125cc']) {
  for (const mode of ['space0.8L', 'S', 'S+space0.8L']) {
    const Cls = require(path.resolve(src, 'game/cars/gokarts', k))[k];
    const car = new Cls(track); car.reset(); const L = car.brakeLock();
    car.speed = 45; let peak = 0, locked = -1, dist = 0, i = 0;
    for (; i < 6 / DT && car.speed > 1; i++) {
      const brake = mode.includes('space') ? 0.8 * L : 0, backward = mode.startsWith('S') ? 1 : 0;
      car.controls = { forward: 0, backward, steering: 0, brake, restart: false };
      const v0 = car.speed; car.applyControls(DT); dist += car.speed / 3.6 * DT;
      peak = Math.max(peak, (v0 - car.speed) / 3.6 / DT / 9.81);
      if (locked < 0 && car.rearLocked) locked = i * DT;
    }
    console.log(`${k.padEnd(16)} ${mode.padEnd(12)} 45→1 km/h ${dist.toFixed(1)} m, peak ${peak.toFixed(2)} g, locked ${locked < 0 ? 'no' : 'at ' + locked.toFixed(2) + ' s'}`);
  }
}
