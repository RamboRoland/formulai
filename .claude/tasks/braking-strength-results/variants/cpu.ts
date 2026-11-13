import * as path from 'path';
const src = process.argv[2];
const karts = ['HyrkartCentralen','Hyrkart270cc','Racingkart125cc'];
const cls = karts.map(k => require(path.join(src,'game/cars/gokarts',k))[k]);
const N = 200_000;
let total = 0, sink = 0;
for (let rep = 0; rep < 4; rep++) {
  for (const C of cls) {
    const c = new C({ startPosition:{x:0,y:0}, startAngle:0 }); c.speed = 40;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) {
      const t = i / 60;
      const ph = t % 8;
      c.controls = { forward: ph < 3 ? 1 : 0, backward: 0, brake: ph >= 4 && ph < 5.5 ? 0.6 * (ph - 4) : 0, steering: 0.4 * Math.sin(t * 1.3), restart: false };
      c.applyControls(1/60);
      if (c.speed < 5) c.speed = 40;
      sink += c.speed;
    }
    const dtns = Number(process.hrtime.bigint() - t0);
    if (rep > 0) total += dtns;
  }
}
console.log('µs per kart step', (total / (3 * 3 * N) / 1000).toFixed(3), sink > 0 ? '' : '');
