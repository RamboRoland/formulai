import * as path from 'path';
const src = process.argv[2];
for (const k of ['HyrkartCentralen','Hyrkart270cc','Racingkart125cc']) {
  const C = require(path.join(src,'game/cars/gokarts',k))[k];
  const c = new C({ startPosition:{x:0,y:0}, startAngle:0 });
  let t60 = -1, maxK = 0, flips = 0, lastDk = 0, prevK = 0;
  for (let i = 0; i < 1200; i++) {
    c.controls = { forward: 1, backward: 0, steering: 0, brake: 0, restart: false };
    c.applyControls(1/60);
    const k2 = c.slipRatio ?? 0; maxK = Math.max(maxK, k2);
    const dk = k2 - prevK; if (i > 5 && dk * lastDk < 0 && Math.abs(dk) > 0.01) flips++; lastDk = dk; prevK = k2;
    if (t60 < 0 && c.speed >= 60 * 0.999 * Math.min(1, c.maxSpeed / 60)) t60 = i / 60;
  }
  console.log(k, '0→60 (or top)', t60.toFixed(2), 's; max κ', maxK.toFixed(2), 'κ sign flips', flips, 'end', c.speed.toFixed(1));
}
