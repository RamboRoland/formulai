import * as path from 'path';
const DT = 1 / 60;
const track = { startPosition: { x: 0, y: 0 }, startAngle: 0, spawn: (l: number) => ({ x: 100 + l, y: 50, angle: 0 }) };
const Cls = require(path.resolve(process.argv[2], 'game/cars/gokarts', 'HyrkartCentralen')).HyrkartCentralen;
const car = new Cls(track); car.reset(); car.speed = 20;
// S held from 20 km/h with the brake: stops (brake only), then backs up
for (let i = 0; i < 5 / DT; i++) {
  const t = i * DT;
  car.controls = { forward: 0, backward: 1, steering: 0, brake: t < 1.5 ? 0.3 : 0, restart: false };
  car.applyControls(DT);
  if (i % 30 === 0) console.log(`t ${t.toFixed(1)} speed ${car.speed.toFixed(2)} km/h`);
}
