import * as path from 'path';
const src = process.argv[2];
for (const k of ['HyrkartCentralen','Hyrkart270cc','Racingkart125cc']) {
  const C = require(path.join(src,'game/cars/gokarts',k))[k];
  const c = new C({ startPosition:{x:0,y:0}, startAngle:0 });
  console.log(k, 'brakeLock', c.brakeLock().toFixed(3));
}
