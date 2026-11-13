import * as path from 'path';
const src = process.argv[2];
const mk = (k: string) => { const C = require(path.join(src,'game/cars/gokarts',k))[k]; return new C({ startPosition:{x:0,y:0}, startAngle:0 }); };
const stop = (k: string, v0: number, v1: number, b: number) => {
  const c = mk(k); c.speed = v0; let dist = 0, t = 0, locked = false, peak = 0;
  while (c.speed > v1 && t < 30) { const before = c.speed; c.controls = { forward:0, backward:0, steering:0, brake:b, restart:false }; c.applyControls(1/60); dist += (before + c.speed)/2/3.6/60; t += 1/60; if (c.rearLocked) locked = true; peak = Math.max(peak, (before - c.speed)/3.6*60/9.81); }
  return { dist, t, locked, peak };
};
for (const [k, v0, v1] of [['Racingkart125cc',106,46],['Racingkart125cc',100,0],['HyrkartCentralen',60,0],['Hyrkart270cc',80,0]] as [string,number,number][]) {
  let lo = 0, hi = 1;
  if (!stop(k, v0, v1, 1).locked) lo = 1; else for (let i = 0; i < 30; i++) { const m = (lo+hi)/2; if (stop(k,v0,v1,m).locked) hi = m; else lo = m; }
  const r = stop(k, v0, v1, lo);
  const f = stop(k, v0, v1, 1);
  console.log(`${k} ${v0}->${v1}: best no-lock pedal ${lo.toFixed(3)} (L ${mk(k).brakeLock().toFixed(3)}): ${r.dist.toFixed(1)} m avg ${((v0-v1)/3.6/r.t/9.81).toFixed(2)} g peak ${r.peak.toFixed(2)} g | locked 1.0: ${f.dist.toFixed(1)} m peak ${f.peak.toFixed(2)} g`);
}
