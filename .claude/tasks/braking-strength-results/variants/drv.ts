import * as path from 'path';
const [src, k, v0s, ws] = process.argv.slice(2);
const C = require(path.join(src,'game/cars/gokarts',k))[k];
const c = new C({ startPosition:{x:0,y:0}, startAngle:0 }); c.speed = +v0s;
let t = 0, tLock = -1;
const clamp = (x: number) => Math.max(-1, Math.min(1, x));
while (t < 1.2 && c.speed > 0) {
  const slip = Math.atan2(c.lateralSpeed, Math.max(c.speed/3.6, 1e-9))*57.2958, yaw = c.yawRate*57.2958;
  if (tLock < 0 && (c.rearLocked || Math.abs(slip) >= 2)) tLock = t;
  const react = tLock >= 0 && t >= tLock + 0.2;
  const deg = react ? slip - 0.05*yaw : +ws;
  c.controls = { forward:0, backward:0, brake:1, steering: clamp(deg / c.wheelLock), restart:false };
  c.applyControls(1/60); t += 1/60;
  if (Math.round(t*60) % 3 === 0) console.log(t.toFixed(2), 'v', c.speed.toFixed(0), 'slip', slip.toFixed(1), 'yaw', yaw.toFixed(0), 'want', deg.toFixed(1), 'wheel', c.wheelAngle.toFixed(1), 'k', (c.slipRatio??0).toFixed(2), 'latG', c.lateralG.toFixed(2), 'slipF', (c.slipFront*57.3).toFixed(1), 'slipR', (c.slipRear*57.3).toFixed(1));
}
