import * as path from 'path';
const src = process.argv[2], k = process.argv[3] ?? 'HyrkartCentralen', verbose = process.argv[4] === 'v';
const C = require(path.join(src,'game/cars/gokarts',k))[k];
const c = new C({ startPosition:{x:0,y:0}, startAngle:0 });
c.speed = 35; let t = 0, maxSlip = 0, catchFrom = -1, caught = -1, maxYaw = 0;
const clamp = (x: number) => Math.max(-1, Math.min(1, x));
while (t < 2.5) {
  const vx = c.speed/3.6, vy = c.lateralSpeed; const slip = Math.atan2(vy, Math.max(vx,1e-9))*57.2958; const yaw = c.yawRate*57.2958;
  const v = Math.hypot(vx,vy)*3.6;
  let ctl;
  if (t < 0.5) ctl = { steering: clamp(40*32/90/c.wheelLock), brake: t >= 0.3 ? 1 : 0, forward: 0 };
  else { if (catchFrom < 0) catchFrom = t; if (caught < 0 && t > catchFrom + 0.05 && Math.abs(slip) < 5 && Math.abs(yaw) < 30) caught = t; ctl = { steering: clamp(slip / c.wheelLock), brake: 0, forward: process.env.CGAS ? +process.env.CGAS : 0.2 }; }
  c.controls = { ...ctl, backward: 0, restart: false };
  c.applyControls(1/60); t += 1/60;
  if (v > 8) maxSlip = Math.max(maxSlip, Math.abs(slip)); maxYaw = Math.max(maxYaw, Math.abs(yaw));
  if (verbose && Math.round(t*60) % 3 === 0) console.log(t.toFixed(2), 'v', v.toFixed(1), 'slip', slip.toFixed(1), 'yaw', yaw.toFixed(0), 'k', (c.slipRatio ?? 0).toFixed(2), 'lock', c.rearLocked, 'gripR', c.gripRear.toFixed(2), 'slipR', (c.slipRear*57.3).toFixed(1), 'lift', c.rearLift.toFixed(2), 'loadR', c.loadShareRear.toFixed(2), 'latG', c.lateralG.toFixed(2));
}
console.log(`C1 ${k}: slip ${maxSlip.toFixed(0)}° yaw ${maxYaw.toFixed(0)}°/s caught ${caught < 0 ? 'no' : (caught - catchFrom).toFixed(2)}`);
