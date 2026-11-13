import * as path from 'path';
const DT = 1 / 60, G = 9.81;
const [src, k, kmhS, latS, pedalS] = process.argv.slice(2);
const kmh = +kmhS, latG = +latS;
const track = { startPosition: { x: 0, y: 0 }, startAngle: 0, spawn: (l: number) => ({ x: 100 + l, y: 50, angle: 0 }) };
const Cls = require(path.resolve(src, 'game/cars/gokarts', k))[k];
const car = new Cls(track); car.reset();
const L = car.brakeLock(), v = kmh / 3.6, R = v * v / (latG * G);
const steer = Math.atan(car.wheelbaseMeters / R) * 180 / Math.PI / car.wheelLock;
const pedal = pedalS === 'L' ? L : +pedalS;
car.speed = kmh; let gas = 0.3;
console.log(`L=${L.toFixed(3)} pedal=${pedal.toFixed(3)} steer=${steer.toFixed(3)}`);
for (let i = 0; i < 3.2 / DT; i++) {
  const t = i * DT; const br = t >= 2 ? pedal : 0;
  if (t < 2) gas = Math.max(0, Math.min(1, gas + (kmh - car.speed) * 0.02)); else gas = 0;
  car.controls = { forward: gas, backward: 0, steering: steer, brake: br, restart: false };
  car.applyControls(DT);
  if (t >= 1.9 && i % 3 === 0) {
    const slip = Math.atan2(car.lateralSpeed, Math.max(car.speed / 3.6, 1)) * 180 / Math.PI;
    console.log(`t ${(t - 2).toFixed(2)} v ${car.speed.toFixed(1)} latG ${car.lateralG.toFixed(2)} longG ${car.longitudinalG.toFixed(2)} κ ${(car.slipRatio ?? NaN).toFixed?.(3)} gripR ${car.gripRear.toFixed(2)} slipR° ${(car.slipRear * 180 / Math.PI).toFixed(1)} body° ${slip.toFixed(1)} locked ${car.rearLocked}`);
  }
}
