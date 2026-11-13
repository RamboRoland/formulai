#!/bin/bash
# trial.sh <port> <lockPedal> <seconds> [bot args...] → crashes per style
P=$(dirname "$0"); port=$1 lock=$2 secs=$3; shift 3
cd ~/Projects/formulai-braking/server; export NODE_PATH=$PWD/node_modules TS_NODE_TRANSPILE_ONLY=true
log=$P/trial-$port.log; : > $log; pids=()
node -r ts-node/register $P/brakingBot.ts --port $port --create TrainingLong --kart HyrkartCentralen --style threshold --lockPedal $lock "$@" >> $log 2>&1 & pids+=($!)
for i in $(seq 1 30); do grep -q LOBBY $log && break; sleep 0.3; done
id=$(grep -o 'LOBBY [A-F0-9]*' $log | cut -d' ' -f2)
for s in trail lock; do node -r ts-node/register $P/brakingBot.ts --port $port --lobby $id --kart HyrkartCentralen --style $s --lockPedal $lock "$@" >> $log 2>&1 & pids+=($!); done
sleep 2
node -e '
const W=require(process.env.HOME+"/Projects/formulai-braking/server/node_modules/ws");const ws=new W("ws://localhost:'$port'","formulai");const st={};let n=0,names={};
ws.on("open",()=>ws.send(JSON.stringify({ns:"req:view",action:"watch",data:{lobbyId:"'$id'"}})));
ws.on("message",r=>{const m=JSON.parse(r);if(m.action==="members"){for(const x of m.data.members)names[x.carId]=x.client;}
 if(m.action!=="frame")return;n++;for(const c of m.data.cars){const s=st[c.id]??={hits:0,prev:false,d:0,px:null,py:null};if(c.hasCollision&&!s.prev)s.hits++;s.prev=c.hasCollision;if(s.px!==null){const dd=Math.hypot(c.x-s.px,c.y-s.py);if(dd<100)s.d+=dd;}s.px=c.x;s.py=c.y;}
 if(n>='$secs'*20){console.log(Object.entries(st).map(([k,s])=>(names[k]??k).slice(-4)+" crashes "+s.hits+" dist "+Math.round(s.d/24)+" m").join(", "));ws.close();}});'
kill ${pids[@]} 2>/dev/null; wait 2>/dev/null
