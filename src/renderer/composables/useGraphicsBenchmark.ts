// 3D City Benchmark — Clean rewrite, minimal & working
import { ref, nextTick } from 'vue'
import { useBenchmarkStore } from '../stores/benchmark'

// === MATH ===
function I(){return new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])}
function P(f:number,a:number,n:number,F:number){const t=1/Math.tan(f/2),nf=1/(n-F);return new Float32Array([t/a,0,0,0,0,t,0,0,0,0,(F+n)*nf,-1,0,0,2*F*n*nf,0])}
function L(e:number[],c:number[],u:number[]){let fx=c[0]-e[0],fy=c[1]-e[1],fz=c[2]-e[2];const fl=Math.sqrt(fx*fx+fy*fy+fz*fz);fx/=fl;fy/=fl;fz/=fl;let rx=u[1]*fz-u[2]*fy,ry=u[2]*fx-u[0]*fz,rz=u[0]*fy-u[1]*fx;const rl=Math.sqrt(rx*rx+ry*ry+rz*rz);rx/=rl;ry/=rl;rz/=rl;const ux=fy*rz-fz*ry,uy=fz*rx-fx*rz,uz=fx*ry-fy*rx;return new Float32Array([rx,ux,-fx,0,ry,uy,-fy,0,rz,uz,-fz,0,-rx*e[0]-ry*e[1]-rz*e[2],-ux*e[0]-uy*e[1]-uz*e[2],fx*e[0]+fy*e[1]+fz*e[2],1])}
function M(a:Float32Array,b:Float32Array){const r=new Float32Array(16);for(let i=0;i<4;i++)for(let j=0;j<4;j++)r[j*4+i]=a[i]*b[j*4]+a[4+i]*b[j*4+1]+a[8+i]*b[j*4+2]+a[12+i]*b[j*4+3];return r}
function N(v:number[]){const l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);return[v[0]/l,v[1]/l,v[2]/l]}

// === SHADERS ===
const VS=`#version 300 es
layout(location=0) in vec3 aP;layout(location=1) in vec3 aN;layout(location=2) in vec3 aC;
uniform mat4 uMVP,uM,uSMVP;out vec3 vP,vN,vC;out vec4 vS;
void main(){vec4 w=uM*vec4(aP,1);vP=w.xyz;vN=mat3(uM)*aN;vC=aC;vS=uSMVP*w;gl_Position=uMVP*w;}`

const FS=`#version 300 es
precision highp float;
in vec3 vP,vN,vC;in vec4 vS;
uniform vec3 uCam,uSun,uSky,uGnd,uSunCol;uniform sampler2D uShadow;
out vec4 o;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float pcf(vec4 ls,float bias){vec3 p=ls.xyz/ls.w;p=p*.5+.5;if(p.z>1.)return 0.;float s=0.;vec2 ts=1./vec2(textureSize(uShadow,0));for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++)s+=p.z-bias>texture(uShadow,p.xy+vec2(x,y)*ts).r?1.:0.;return s/25.;}
void main(){
  vec3 N=normalize(vN),L=normalize(-uSun),V=normalize(uCam-vP);
  float NdotL=max(dot(N,L),0.);
  // Simple lighting: diffuse + ambient + shadow
  vec3 diff=vC*uSunCol*NdotL*.8;
  float hemi=.5+.5*dot(N,vec3(0,1,0));
  vec3 amb=mix(uGnd,uSky,hemi)*vC*.25;
  float sh=pcf(vS,max(.0005*(1.-NdotL),.00002));
  vec3 lit=amb+diff*(1.-sh*.7);
  // Window glow on walls
  float w=abs(N.y)<.3?1.:0.;
  if(w>.5){vec3 wx=normalize(cross(N,vec3(0,1,0)));vec2 uv=vec2(dot(vP,wx),vP.y);
    float fx=fract(uv.x/5.),fy=fract(uv.y/3.8),wn=step(.1,fx)*step(fx,.32)*step(.08,fy)*step(fy,.28);
    float lt=hash(floor(uv/vec2(5.,3.8)))*.5+.5;
    lit+=vC*wn*lt*.3;}
  float fog=1.-exp(-length(vP-uCam)*.00025);
  lit=mix(lit,mix(uSky,uGnd,.3),fog);
  lit=lit/(lit+vec3(1.));lit=pow(lit,vec3(1./2.2));
  o=vec4(lit,1);
}`

const SV=`#version 300 es\nprecision highp float;layout(location=0) in vec3 aP;uniform mat4 uMVP;void main(){gl_Position=uMVP*vec4(aP,1);}`
const SF=`#version 300 es\nprecision highp float;out vec4 o;void main(){o=vec4(gl_FragCoord.z,0,0,1);}`

const SKY_VS=`#version 300 es\nin vec2 aP;out vec2 vUV;void main(){vUV=aP*.5+.5;gl_Position=vec4(aP,0,1);}`
const SKY_FS=`#version 300 es
precision highp float;in vec2 vUV;out vec4 o;uniform vec3 uSunDir;uniform float uTime;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<6;i++){v+=a*noise(p);p*=2.1;a*=.5;}return v;}
void main(){
  vec3 sky=mix(vec3(.55,.75,.95),vec3(.15,.3,.65),vUV.y);
  vec2 sp=vec2(uSunDir.x*.4+.5,uSunDir.y*.3+.45);
  float sg=exp(-length(vUV-sp)*12.)*.2+exp(-length(vUV-sp)*3.)*.06+exp(-length(vUV-sp)*60.)*.4;
  sky+=vec3(1.,.9,.6)*sg+vec3(1.,.95,.85)*exp(-length(vUV-sp)*200.)*.7;
  vec2 uv=vUV*vec2(3.,2.)+uTime*.003;
  float c0=fbm(uv),c1=fbm(uv+vec2(.5,.3));
  float clouds=smoothstep(.35,.65,c0*.6+c1*.4);clouds*=smoothstep(.1,.4,vUV.y);
  vec2 duv=uv*3.;float detail=fbm(duv+uTime*.005)*.3;clouds=mix(clouds,clouds*(.7+detail),.5);
  sky=mix(sky,mix(vec3(.9,.93,.97),vec3(.75,.8,.85),clouds),min(clouds,.5));
  float band=smoothstep(.3,.8,sin(vUV.y*8.)*.5+.5)*.12;sky+=band*fbm(uv*2.+uTime*.002)*.5;
  o=vec4(sky,1);
}`

// === CITY GENERATOR ===
interface Bld{x:number;z:number;w:number;d:number;h:number;r:number;g:number;b:number;style:number}

function genCity(count:number):Bld[]{
  const blds:Bld[]=[];let s=42;const rnd=()=>{s=(s*16807)%2147483647;return(s-1)/2147483646}
  const pal=[[.2,.32,.5],[.5,.55,.62],[.65,.55,.45],[.85,.83,.8],[.22,.24,.28]]
  const cell=52,gs=Math.ceil(Math.sqrt(count))
  for(let gx=-gs;gx<=gs;gx++)for(let gz=-gs;gz<=gs;gz++){
    if(blds.length>=count)break
    const cx=gx*cell+(rnd()-.5)*8,cz=gz*cell+(rnd()-.5)*8
    const dist=Math.sqrt(cx*cx+cz*cz)/700
    let mh:number;if(dist<.15)mh=300+rnd()*200;else if(dist<.3)mh=150+rnd()*200;else if(dist<.5)mh=80+rnd()*150;else if(dist<.7)mh=30+rnd()*80;else continue
    const w=10+rnd()*35,d=10+rnd()*35,h=15+rnd()*(mh-15)
    const c=pal[Math.floor(rnd()*5)];const style=Math.floor(rnd()*3)
    blds.push({x:cx,z:cz,w,d,h,r:c[0]+(rnd()-.5)*.05,g:c[1]+(rnd()-.5)*.05,b:c[2]+(rnd()-.5)*.05,style})
  }
  return blds.slice(0,count)
}

function buildGeo(gl:WebGL2RenderingContext,blds:Bld[]):{vao:WebGLVertexArrayObject;vc:number;shadowVao:WebGLVertexArrayObject;svc:number}{
  const total=blds.length*100,pos=new Float32Array(total*3),nor=new Float32Array(total*3),col=new Float32Array(total*3);let vi=0
  function V(px:number,py:number,pz:number,nx:number,ny:number,nz:number,b:Bld){const i=vi;pos[i*3]=px+b.x;pos[i*3+1]=py;pos[i*3+2]=pz+b.z;nor[i*3]=nx;nor[i*3+1]=ny;nor[i*3+2]=nz;col[i*3]=b.r;col[i*3+1]=b.g;col[i*3+2]=b.b;vi++}
  function F(x0:number,y0:number,z0:number,x1:number,y1:number,z1:number,x2:number,y2:number,z2:number,x3:number,y3:number,z3:number,nx:number,ny:number,nz:number,b:Bld){V(x0,y0,z0,nx,ny,nz,b);V(x1,y1,z1,nx,ny,nz,b);V(x2,y2,z2,nx,ny,nz,b);V(x2,y2,z2,nx,ny,nz,b);V(x3,y3,z3,nx,ny,nz,b);V(x0,y0,z0,nx,ny,nz,b)}
  for(const b of blds){const hw=b.w/2,hd=b.d/2
    F(-hw,0,-hd,hw,0,-hd,hw,b.h,-hd,-hw,b.h,-hd,0,0,-1,b);F(hw,0,hd,-hw,0,hd,-hw,b.h,hd,hw,b.h,hd,0,0,1,b)
    F(-hw,0,hd,-hw,0,-hd,-hw,b.h,-hd,-hw,b.h,hd,-1,0,0,b);F(hw,0,-hd,hw,0,hd,hw,b.h,hd,hw,b.h,-hd,1,0,0,b)
    let pH=b.h,pW=hw,pD=hd
    for(let t=0;t<3;t++){const th=pH*.15;if(th<4)break;const sw=pW*.72,sd=pD*.72
      F(-sw,pH,-sd,sw,pH,-sd,sw,pH+th,-sd,-sw,pH+th,-sd,0,0,-1,b);F(sw,pH,sd,-sw,pH,sd,-sw,pH+th,sd,sw,pH+th,sd,0,0,1,b)
      F(-sw,pH,sd,-sw,pH,-sd,-sw,pH+th,-sd,-sw,pH+th,sd,-1,0,0,b);F(sw,pH,-sd,sw,pH,sd,sw,pH+th,sd,sw,pH+th,-sd,1,0,0,b);pH+=th;pW=sw;pD=sd}
    F(-pW,pH,-pD,pW,pH,-pD,pW,pH,pD,-pW,pH,pD,0,1,0,b)
    if(b.style==0){const sh=Math.min(b.h*.1,25),sw2=pW*.12
      V(0,pH+sh,0,0,.5,0,b);V(-sw2,pH,-sw2,0,.5,0,b);V(sw2,pH,-sw2,0,.5,0,b);V(0,pH+sh,0,0,.5,0,b);V(sw2,pH,sw2,0,.5,0,b);V(-sw2,pH,sw2,0,.5,0,b)
      V(0,pH+sh,0,.5,.5,0,b);V(sw2,pH,-sw2,.5,.5,0,b);V(sw2,pH,sw2,.5,.5,0,b);V(0,pH+sh,0,-.5,.5,0,b);V(-sw2,pH,sw2,-.5,.5,0,b);V(-sw2,pH,-sw2,-.5,.5,0,b)}
  }
  const vao=gl.createVertexArray()!;gl.bindVertexArray(vao);const up=(l:number,d:Float32Array,s:number)=>{const b=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,d.slice(0,vi*s),gl.STATIC_DRAW);gl.vertexAttribPointer(l,s,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(l)};up(0,pos,3);up(1,nor,3);up(2,col,3)
  const svao=gl.createVertexArray()!;gl.bindVertexArray(svao);up(0,pos,3);return{vao,vc:vi,shadowVao:svao,svc:vi}
}

// === MAIN ===
export function useGraphicsBenchmark(){
  const benchmark=useBenchmarkStore()
  const isRunning=ref(false),pp=ref(0),phase=ref(''),live=ref(''),cv=ref<HTMLCanvasElement|null>(null)
  let gl:WebGL2RenderingContext|null=null,W=1920,H=1080,SM=4096
  let cityProg:WebGLProgram,shadowProg:WebGLProgram,skyProg:WebGLProgram,shadowFBO:WebGLFramebuffer,shadowTex:WebGLTexture
  let cityVAO:WebGLVertexArrayObject,shadowVAO:WebGLVertexArrayObject,groundVAO:WebGLVertexArrayObject,roadVAO:WebGLVertexArrayObject,cityVC=0,shadowVC=0,roadVC=0,skyVBO:WebGLBuffer

  function comp(gl:WebGL2RenderingContext,t:number,s:string){const sh=gl.createShader(t)!;gl.shaderSource(sh,s);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(sh)||'shader');return sh}
  function prog(gl:WebGL2RenderingContext,vs:string,fs:string){const p=gl.createProgram()!;gl.attachShader(p,comp(gl,gl.VERTEX_SHADER,vs));gl.attachShader(p,comp(gl,gl.FRAGMENT_SHADER,fs));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'link');return p}

  function init(canvas:HTMLCanvasElement){
    gl=canvas.getContext('webgl2',{powerPreference:'high-performance',antialias:false});if(!gl)throw new Error('WebGL2')
    cityProg=prog(gl,VS,FS);shadowProg=prog(gl,SV,SF);skyProg=prog(gl,SKY_VS,SKY_FS)
    skyVBO=gl.createBuffer()!;gl.bindBuffer(gl.ARRAY_BUFFER,skyVBO);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW)

    shadowFBO=gl.createFramebuffer()!;gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFBO)
    shadowTex=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,shadowTex)
    gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,SM,SM,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE)
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,shadowTex,0);gl.drawBuffers([gl.NONE]);gl.readBuffer(gl.NONE)

    const gs=3000;groundVAO=gl.createVertexArray()!;gl.bindVertexArray(groundVAO)
    const gp=new Float32Array([-gs,0,-gs,gs,0,-gs,gs,0,gs,gs,0,gs,-gs,0,gs,-gs,0,-gs])
    const gn=new Float32Array(18);for(let i=0;i<6;i++)gn[i*3+1]=1;const gc=new Float32Array(18);gc.fill(.1)
    const ub=(l:number,d:Float32Array,s:number)=>{const b=gl!.createBuffer()!;gl!.bindBuffer(gl!.ARRAY_BUFFER,b);gl!.bufferData(gl!.ARRAY_BUFFER,d,gl!.STATIC_DRAW);gl!.vertexAttribPointer(l,s,gl!.FLOAT,false,0,0);gl!.enableVertexAttribArray(l)}
    ub(0,gp,3);ub(1,gn,3);ub(2,gc,3)
  }

  function render(cPos:number[],cTgt:number[],sun:number[],t:number){
    if(!gl)return
    const vp=M(P(Math.PI/3,W/H,2,5000),L(cPos,cTgt,[0,1,0]))
    // Shadow
    const sr=700,le=[-sun[0]*sr,-sun[1]*sr,-sun[2]*sr],lMVP=M(new Float32Array([2/sr,0,0,0,0,2/sr,0,0,0,0,-2/(sr*3),0,0,0,0,1]),L(le,[0,30,0],[0,1,0]))
    gl.bindFramebuffer(gl.FRAMEBUFFER,shadowFBO);gl.viewport(0,0,SM,SM);gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.useProgram(shadowProg);gl.uniformMatrix4fv(gl.getUniformLocation(shadowProg,'uMVP'),false,lMVP)
    gl.bindVertexArray(shadowVAO);gl.drawArrays(gl.TRIANGLES,0,shadowVC)

    // Main
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,W,H)
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT)
    // Sky
    gl.depthMask(false);gl.useProgram(skyProg)
    gl.uniform3fv(gl.getUniformLocation(skyProg,'uSunDir'),sun)
    gl.uniform1f(gl.getUniformLocation(skyProg,'uTime'),t)
    gl.bindBuffer(gl.ARRAY_BUFFER,skyVBO);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);gl.enableVertexAttribArray(0)
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);gl.depthMask(true)

    // City + ground + roads
    gl.enable(gl.DEPTH_TEST)
    gl.useProgram(cityProg)
    gl.uniformMatrix4fv(gl.getUniformLocation(cityProg,'uMVP'),false,vp)
    gl.uniformMatrix4fv(gl.getUniformLocation(cityProg,'uM'),false,I())
    gl.uniformMatrix4fv(gl.getUniformLocation(cityProg,'uSMVP'),false,lMVP)
    gl.uniform3fv(gl.getUniformLocation(cityProg,'uCam'),cPos)
    gl.uniform3fv(gl.getUniformLocation(cityProg,'uSun'),sun)
    // Sun color: warm golden at low angles, white at high
    const sunAlt=Math.max(0,sun[1])
    const warmth=1-sunAlt*.6
    gl.uniform3f(gl.getUniformLocation(cityProg,'uSunCol'),1,.9*warmth+.5,.7*warmth+.35)
    gl.uniform3f(gl.getUniformLocation(cityProg,'uSky'),.4,.6,.85)
    gl.uniform3f(gl.getUniformLocation(cityProg,'uGnd'),.08,.07,.05)
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,shadowTex);gl.uniform1i(gl.getUniformLocation(cityProg,'uShadow'),0)
    gl.bindVertexArray(groundVAO);gl.drawArrays(gl.TRIANGLES,0,6)
    gl.bindVertexArray(roadVAO);gl.drawArrays(gl.TRIANGLES,0,roadVC)
    gl.bindVertexArray(cityVAO);gl.drawArrays(gl.TRIANGLES,0,cityVC)
  }

  async function run(canvas?:HTMLCanvasElement){
    isRunning.value=true;benchmark.isRunning=true;benchmark.runningType='graphics'
    const t0=performance.now();let cvs:HTMLCanvasElement|null=null
    try{
      phase.value='Generating city...';pp.value=5;live.value='Building...';await nextTick()
      cvs=canvas||cv.value;if(!cvs)throw new Error('No canvas')
      cvs.width=W;cvs.height=H;cvs.style.display='block';init(cvs);if(!gl)throw new Error('WebGL')

      const blds=genCity(200);const geo=buildGeo(gl,blds)
      cityVAO=geo.vao;cityVC=geo.vc;shadowVAO=geo.shadowVao;shadowVC=geo.svc
      // Road network: major avenues + side streets
      {const cell=52,count=Math.ceil(Math.sqrt(blds.length)),h=count*cell
        const verts:number[]=[],norms:number[]=[],cols:number[]=[]
        for(let i=-count;i<=count;i++){const c=i*cell
          // Major avenue every 6 blocks (wider, darker)
          if(i%6===0){const rw=10 // avenue width
            verts.push(-h,.02,c-rw,h,.02,c-rw,h,.02,c+rw, -h,.02,c-rw,-h,.02,c+rw,h,.02,c+rw)
            for(let k=0;k<6;k++){norms.push(0,1,0);cols.push(.1,.1,.12)}
            verts.push(c-rw,.02,-h,c+rw,.02,-h,c+rw,.02,h, c-rw,.02,-h,c-rw,.02,h,c+rw,.02,h)
            for(let k=0;k<6;k++){norms.push(0,1,0);cols.push(.1,.1,.12)}
          }
          // Side street every 2 blocks
          else if(i%2===0){const sw=5
            verts.push(-h,.02,c-sw,h,.02,c-sw,h,.02,c+sw, -h,.02,c-sw,-h,.02,c+sw,h,.02,c+sw)
            for(let k=0;k<6;k++){norms.push(0,1,0);cols.push(.16,.17,.18)}
            verts.push(c-sw,.02,-h,c+sw,.02,-h,c+sw,.02,h, c-sw,.02,-h,c-sw,.02,h,c+sw,.02,h)
            for(let k=0;k<6;k++){norms.push(0,1,0);cols.push(.16,.17,.18)}
          }
        }
        roadVAO=gl!.createVertexArray()!;gl!.bindVertexArray(roadVAO)
        const ub=(l:number,d:Float32Array,s:number)=>{const b=gl!.createBuffer()!;gl!.bindBuffer(gl!.ARRAY_BUFFER,b);gl!.bufferData(gl!.ARRAY_BUFFER,d,gl!.STATIC_DRAW);gl!.vertexAttribPointer(l,s,gl!.FLOAT,false,0,0);gl!.enableVertexAttribArray(l)}
        ub(0,new Float32Array(verts),3);ub(1,new Float32Array(norms),3);ub(2,new Float32Array(cols),3);roadVC=verts.length/3
      }
      live.value=`${blds.length} buildings`;pp.value=15

      const DUR=25
      const fpsS:number[]=[];let fc=0,lt=performance.now()

      phase.value='Flying...';live.value='0 FPS'
      await new Promise<void>(r=>{function f(){try{const n=performance.now(),el=(n-t0)/1000
        if(el>=DUR){r();return}
        if(n-lt>=500&&fc>0){fpsS.push(fc/((n-lt)/1000));live.value=`${Math.round(fpsS[fpsS.length-1])} FPS`;pp.value=15+Math.round(Math.min(el,DUR)/DUR*83);fc=0;lt=n}
        fc++
        const sunAngle=el*.08,sunH=Math.sin(el*.03)*.6+.2
        const sun=N([Math.cos(sunAngle)*.6,sunH,Math.sin(sunAngle)*.6])
        const ang=el*.25,rad=400+Math.sin(el*.1)*200,h=120+Math.cos(el*.15)*80
        render([Math.cos(ang)*rad,h,Math.sin(ang)*rad],[0,50,0],sun,el);requestAnimationFrame(f)
      }catch(e){console.error(e);r()}};requestAnimationFrame(f)})

      const avgF=fpsS.length>0?fpsS.reduce((a,b)=>a+b,0)/fpsS.length:30
      const maxF=fpsS.length>0?Math.max(...fpsS):30
      pp.value=100;phase.value='Complete';live.value=`Max ${Math.round(maxF)} FPS`
      const score=Math.round(Math.min(1,maxF/300)*10000) // score based on peak GPU throughput
      benchmark.setResult({type:'graphics',score,metrics:{fpsMax:Math.round(maxF),fpsAvg:Math.round(avgF),buildings:blds.length,duration:Math.round(performance.now()-t0)},duration:Math.round(performance.now()-t0)})
    }catch(e:any){console.error(e);benchmark.setResult({type:'graphics',score:0,metrics:{error:1,msg:e.message||String(e)},duration:0,skipped:true})}
    finally{isRunning.value=false;benchmark.isRunning=false;benchmark.runningType=null;if(cvs)cvs.style.display='none'}
  }
  return{isRunning,progressPercent:pp,progressPhase:phase,liveValue:live,canvasRef:cv,run}
}
