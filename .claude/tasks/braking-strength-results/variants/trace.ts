import * as path from 'path';
const [src, kart, v0s, brakeS, steerS, tmaxS] = process.argv.slice(2);
const C = require(path.join(src,'game/cars/gokarts',kart))[kart];
const c = new C({ startPosition:{x:0,y:0}, startAngle:0 });
const L = c.brakeLock();
c.speed = +v0s;
const br = brakeS.endsWith('L') ? parseFloat(brakeS) * L : +brakeS;
for (let i = 0; i < (+(tmaxS ?? 4)) * 60; i++) {
  c.controls = { forward: 0, backward: 0, steering: +(steerS ?? 0), brake: br, restart: false };
  c.applyControls(1/60);
  if (i % 6 === 0) console.log((i/60).toFixed(2), 'v', c.speed.toFixed(2), 'vy', c.lateralSpeed.toFixed(2), 'w*r', ((c.wheelSpin ?? 0)*c.drive.wheelRadiusMeters*3.6).toFixed(2), 'k', (c.slipRatio ?? 0).toFixed(3), 'lg', c.longitudinalG.toFixed(3), 'latg', c.lateralG.toFixed(2), 'yaw', (c.yawRate*57.3).toFixed(0), 'lock', c.rearLocked, 'rearLoad', c.loadShareRear.toFixed(3));
  if (c.speed <= 0) { console.log('stop', (i/60).toFixed(2)); break; }
}
