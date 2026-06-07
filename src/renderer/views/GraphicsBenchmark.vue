<script setup lang="ts">
import { ref, computed, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBenchmarkStore } from '../stores/benchmark'
import { calculateGraphicsScore } from '../utils/scoring'
import ScoreCard from '../components/ScoreCard.vue'
import ProgressBar from '../components/ProgressBar.vue'
import { NButton } from 'naive-ui'

const { t } = useI18n()
const benchmark = useBenchmarkStore()

const isRunning = ref(false)
const progressPercent = ref(0)
const progressPhase = ref('')
const liveValue = ref('')
const result = computed(() => benchmark.resultMap['graphics'])

function createGL(width: number, height: number): WebGL2RenderingContext {
  const c = document.createElement('canvas')
  c.width = width; c.height = height
  const gl = c.getContext('webgl2', { powerPreference:'high-performance',antialias:false,desynchronized:true })
  if (!gl) throw new Error('WebGL2 unavailable')
  return gl
}

const PV = `#version 300 es
in vec2 aPos; in float aSize; in vec3 aCol; in float aAlpha;
out vec3 vCol; out float vA;
void main(){ gl_Position=vec4(aPos,0,1); gl_PointSize=aSize; vCol=aCol; vA=aAlpha; }`

const PF = `#version 300 es
precision highp float;
in vec3 vCol; in float vA; out vec4 o;
void main(){ float d=length(gl_PointCoord-0.5)*2.0; o=vec4(vCol,vA*(1.0-smoothstep(0.0,1.0,d))); }`

interface P { x:number;y:number;vx:number;vy:number;life:number;max:number;size:number;r:number;g:number;b:number }

function mkParts(n:number):P[] {
  const a:P[]=[]
  for(let i=0;i<n;i++) a.push({
    x:Math.random()*2-1,y:Math.random()*2-1,
    vx:(Math.random()-.5)*.02,vy:(Math.random()-.5)*.02,
    life:Math.random(),max:.5+Math.random()*2,
    size:1+Math.random()*8,
    r:Math.random(),g:Math.random(),b:Math.random(),
  })
  return a
}

function updParts(p:P[],dt:number,asp:number):void {
  for(let i=0;i<p.length;i++){
    const t=p[i]
    t.x+=t.vx*dt; t.y+=t.vy*dt*asp; t.life+=dt
    if(t.life>t.max){t.life=0;t.x=(Math.random()-.5)*2;t.y=(Math.random()-.5)*2;t.vx=(Math.random()-.5)*.03;t.vy=(Math.random()-.5)*.03}
    if(Math.abs(t.x)>1)t.vx*=-1;if(Math.abs(t.y)>1)t.vy*=-1
  }
}

// Non-blocking particle benchmark: rAF + heavy per-frame work
function runParticles(
  gl:WebGL2RenderingContext, count:number, drawsPerFrame:number, durationMs:number
):Promise<{fps:number;total:number}> {
  const p=gl.createProgram()!
  gl.attachShader(p,((s:WebGLShader)=>(gl.shaderSource(s,PV),gl.compileShader(s),s))(gl.createShader(gl.VERTEX_SHADER)!))
  gl.attachShader(p,((s:WebGLShader)=>(gl.shaderSource(s,PF),gl.compileShader(s),s))(gl.createShader(gl.FRAGMENT_SHADER)!))
  gl.linkProgram(p); gl.useProgram(p)

  const parts=mkParts(count)
  const pos=new Float32Array(count*2),sz=new Float32Array(count),col=new Float32Array(count*3),alp=new Float32Array(count)
  function upd(){for(let i=0;i<count;i++){const t=parts[i];pos[i*2]=t.x;pos[i*2+1]=t.y;sz[i]=t.size;col[i*3]=t.r;col[i*3+1]=t.g;col[i*3+2]=t.b;alp[i]=1-t.life/t.max}}

  const bufs=['aPos','aSize','aCol','aAlpha'].map((_,i)=>{const b=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,b);return b})
  gl.bindBuffer(gl.ARRAY_BUFFER,bufs[0]);gl.bufferData(gl.ARRAY_BUFFER,8*count,gl.DYNAMIC_DRAW);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(0)
  gl.bindBuffer(gl.ARRAY_BUFFER,bufs[1]);gl.bufferData(gl.ARRAY_BUFFER,4*count,gl.DYNAMIC_DRAW);gl.vertexAttribPointer(1,1,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(1)
  gl.bindBuffer(gl.ARRAY_BUFFER,bufs[2]);gl.bufferData(gl.ARRAY_BUFFER,12*count,gl.DYNAMIC_DRAW);gl.vertexAttribPointer(2,3,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(2)
  gl.bindBuffer(gl.ARRAY_BUFFER,bufs[3]);gl.bufferData(gl.ARRAY_BUFFER,4*count,gl.DYNAMIC_DRAW);gl.vertexAttribPointer(3,1,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(3)
  gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE)

  let frames=0,lastUpd=performance.now()
  const start=performance.now(),endTime=start+durationMs

  return new Promise(resolve=>{
    function frame(){
      const now=performance.now();if(now>=endTime){gl.disable(gl.BLEND);resolve({fps:Math.round(frames/((now-start)/1000)),total:frames*count*drawsPerFrame});return}
      updParts(parts,Math.min((now-lastUpd)/1000,0.1),gl.canvas.width/gl.canvas.height);upd()
      for(let b=0;b<4;b++){gl.bindBuffer(gl.ARRAY_BUFFER,bufs[b]);gl.bufferSubData(gl.ARRAY_BUFFER,0,[pos,sz,col,alp][b])}
      // Heavy per-frame: multiple draw calls
      for(let d=0;d<drawsPerFrame;d++)gl.drawArrays(gl.POINTS,0,count)
      gl.finish()
      frames++;lastUpd=now
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

// Non-blocking 2D Canvas stress
function runCanvas(width:number,height:number,durationMs:number):Promise<number> {
  const c=document.createElement('canvas');c.width=width;c.height=height
  const ctx=c.getContext('2d')!
  let ops=0;const start=performance.now()
  return new Promise(resolve=>{
    function frame(){
      if(performance.now()-start>=durationMs){resolve(Math.round(ops/((performance.now()-start)/1000)));return}
      for(let i=0;i<50;i++){
        const x=Math.random()*width,y=Math.random()*height,r=Math.random()*40+5
        const hue=(ops*7+i*37)%360
        const g=ctx.createRadialGradient(x,y,0,x,y,r)
        g.addColorStop(0,`hsla(${hue},80%,60%,0.9)`)
        g.addColorStop(0.5,`hsla(${(hue+60)%360},70%,50%,0.5)`)
        g.addColorStop(1,`hsla(${(hue+120)%360},60%,40%,0)`)
        ctx.beginPath()
        const s=i%4
        if(s===0)ctx.arc(x,y,r,0,Math.PI*2)
        else if(s===1)ctx.rect(x-r,y-r,r*2,r*2)
        else if(s===2){const n=6;ctx.moveTo(x+r,y);for(let k=1;k<=n;k++){const a=k/n*Math.PI*2;ctx.lineTo(x+r*Math.cos(a),y+r*Math.sin(a))}}
        else ctx.ellipse(x,y,r,r*.6,Math.random()*Math.PI,0,Math.PI*2)
        ctx.fillStyle=g;ctx.fill()
        ctx.shadowColor=`hsla(${hue},80%,40%,0.3)`;ctx.shadowBlur=r*.5
        ctx.strokeStyle=`hsla(${hue},90%,70%,0.7)`;ctx.lineWidth=1+Math.random();ctx.stroke()
        ctx.shadowBlur=0;ops++
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
}

async function start(){
  isRunning.value=true;benchmark.isRunning=true;benchmark.runningType='graphics'
  const startTime=performance.now()
  let fm:Record<string,number>={}
  try{
    progressPhase.value='1080p 100K particles (25 draws/frame)';progressPercent.value=10;liveValue.value='Spawning...';await nextTick()
    const r1=await runParticles(createGL(1920,1080),100000,25,5000)
    liveValue.value=`${r1.fps} FPS, ${(r1.total/1e9).toFixed(1)}B`
    progressPhase.value=`1080p: ${r1.fps} FPS · ${(r1.total/1e9).toFixed(1)}B drawn`;progressPercent.value=40

    progressPhase.value='4K 80K particles (10 draws/frame)';progressPercent.value=45;await nextTick()
    const r2=await runParticles(createGL(3840,2160),80000,10,4000)
    liveValue.value=`${r2.fps} FPS @ 4K`
    progressPercent.value=75

    progressPhase.value='2D Canvas (gradients+shadows)';progressPercent.value=80;await nextTick()
    const cOps=await runCanvas(1920,1080,4000)
    liveValue.value=`${cOps.toLocaleString()} ops/s`
    progressPercent.value=100;progressPhase.value='Complete';liveValue.value=''

    fm={fps1080p:r1.fps,fps4k:r2.fps,canvasOpsPerSec:cOps,totalParticlesDrawn:r1.total+r2.total,duration:Math.round(performance.now()-startTime)}
    benchmark.setResult({type:'graphics',score:calculateGraphicsScore({fps1080p:r1.fps,fps720p:r2.fps,fps480p:Math.round(cOps/1000)}),metrics:fm,duration:fm.duration})
  }catch(e:any){console.error(e)}finally{isRunning.value=false;benchmark.isRunning=false;benchmark.runningType=null}
}

onUnmounted(()=>{window.benchmarkAPI?.removeProgressListener()})
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="page-title">🖼️ {{ $t('nav.graphics') }}</h2>
        <p class="page-subtitle">WebGL 100K particles (25 draws/frame) + 4K 80K particles + 2D Canvas | rAF non-blocking</p>
      </div>
      <NButton type="primary" size="large" :loading="isRunning" :disabled="benchmark.isRunning && !isRunning" @click="start">
        {{ isRunning ? $t('benchmark.running') : $t('benchmark.start') }}
      </NButton>
    </div>

    <div v-if="isRunning" class="bench-card mb-6">
      <ProgressBar :progress="progressPercent" :phase="progressPhase" status="running" />
      <div v-if="liveValue" class="text-center mt-4"><div class="text-3xl font-bold text-[#2563eb]">{{ liveValue }}</div></div>
    </div>

    <div v-if="result">
      <ScoreCard :score="result.score" :label="$t('benchmark.score')" :show-tier="true" size="large" />
      <div class="grid grid-cols-3 gap-4 mt-4 text-center">
        <div class="bench-card"><div class="text-2xl font-bold text-blue-600">{{ result.metrics.fps1080p }}</div><div class="text-xs text-gray-400">1080p FPS (100K)</div></div>
        <div class="bench-card"><div class="text-2xl font-bold text-blue-600">{{ result.metrics.fps4k }}</div><div class="text-xs text-gray-400">4K FPS (80K)</div></div>
        <div class="bench-card"><div class="text-2xl font-bold text-blue-600">{{ (result.metrics.totalParticlesDrawn/1e9).toFixed(2) }}B</div><div class="text-xs text-gray-400">Total Drawn</div></div>
      </div>
      <div class="text-center text-sm text-gray-400 mt-2">{{ $t('benchmark.duration') }}: {{ (result.duration/1000).toFixed(1) }}{{ $t('common.seconds') }}</div>
    </div>

    <div v-if="!result && !isRunning" class="bench-card text-center text-gray-400 py-12">
      <div class="text-5xl mb-4">🖼️</div><p>{{ $t('benchmark.notRun') }}</p>
    </div>
  </div>
</template>
