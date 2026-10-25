// Deterministic optical assets. Optional generator dependency: sharp, via XAUCORE_TOOL_ROOT.
// The same capsule field is encoded as live core/cap carriers and 129 predecoded aspect maps.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(process.env.XAUCORE_TOOL_ROOT||root,'package.json'));
const sharp=require('sharp'), htmlPath=path.join(root,'public/index.html');
let html=(await fs.readFile(htmlPath,'utf8')).replaceAll('\r\n','\n');
const start=html.indexOf('const NAV_OPTICS ='),end=html.indexOf('let _navMapReady',start),config=html.slice(start,end);
const keys=['gain','corner','core','translationStart','shoulder','fall','reach','sideLift','liftStart','liftFull','liftReturn','normalFrom','normalTo','verticalCore','verticalMidAt','verticalMid','verticalPeakAt','verticalPeak','verticalSlope'];
const calibration=Object.fromEntries(keys.map(key=>{const value=Number(config.match(new RegExp('\\b'+key+': ([\\d.]+)'))?.[1]);if(!Number.isFinite(value))throw new Error('Missing calibration '+key);return[key,value];}));
const {gain,corner,core,translationStart,shoulder,fall,reach,sideLift,liftStart,liftFull,liftReturn,normalFrom,normalTo,verticalCore,verticalMidAt,verticalMid,verticalPeakAt,verticalPeak,verticalSlope}=calibration;
if(!(core<shoulder&&shoulder<1&&fall>0&&liftStart<liftFull&&liftReturn>0&&normalFrom<normalTo))throw new Error('Invalid radial profile');
const clamp=v=>Math.max(0,Math.min(1,v)),encode=v=>Math.round(clamp(v)*255);
const smooth=v=>{const t=clamp(v);return t*t*t*(t*(t*6-15)+10);};
const hermite=(t,a,b,va,vb,da=0,db=0)=>{const z=(t-a)/(b-a),z2=z*z,z3=z2*z;return(2*z3-3*z2+1)*va+(z3-2*z2+z)*(b-a)*da+(-2*z3+3*z2)*vb+(z3-z2)*(b-a)*db;};
// z=t*K has a broad descending outer branch: the entering fragment expands through a
// useful band, rather than being enlarged for one pixel then squeezed into a sliver.
const radial=t=>{const z=t<=core?0:t<shoulder?hermite(t,core,shoulder,0,reach+fall*(1-shoulder),0,-fall):reach+fall*(1-Math.min(t,1.08));return t?z/t:0;};
const translation=t=>smooth((t-translationStart)/(shoulder-translationStart));
// Preserve the accepted vertical optics in the centre of each tab and at the top/bottom lip.
const verticalCoreGain=t=>t<=verticalCore?0:t<verticalMidAt?hermite(t,verticalCore,verticalMidAt,0,-verticalMid):t<verticalPeakAt?hermite(t,verticalMidAt,verticalPeakAt,-verticalMid,verticalPeak):t<=1?hermite(t,verticalPeakAt,1,verticalPeak,reach,0,-verticalSlope):reach-verticalSlope*Math.min(.05,t-1);
const sideWeight=(t,dx,dy)=>{const normalY=t?Math.abs(dy)/Math.hypot(dx,dy):1;return 1-smooth((normalY-normalFrom)/(normalTo-normalFrom));};
const carrier=(t,dx,dy)=>{const side=sideWeight(t,dx,dy);return{S:smooth((t-verticalCore)/(1-verticalCore))*(1-side)+translation(t)*side,K:verticalCoreGain(t)*(1-side)+radial(t)*side};};
const verticalValue=(t,dx,dy,cy)=>{
  const base=(cy-.5)*smooth((t-verticalCore)/(1-verticalCore))+dy*verticalCoreGain(t);
  const side=sideWeight(t,dx,dy);
  const bump=smooth((t-liftStart)/(liftFull-liftStart))*smooth((1-t)/liftReturn);
  const shoulderValue=(cy-.5)*translation(t)+dy*(radial(t)-sideLift*bump);
  return base+(shoulderValue-base)*side;
};
const png=async(w,h,sample)=>{const pixels=Buffer.alloc(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const rgba=sample(x,y),p=(y*w+x)*4;for(let i=0;i<4;i++)pixels[p+i]=encode(rgba[i]);}return sharp(pixels,{raw:{width:w,height:h,channels:4}}).png({compressionLevel:9,adaptiveFiltering:true}).toBuffer();};
const normal=await png(288,232,(x,y)=>{const u=(x-16+.5)/256,v=(y-16+.5)/200,cy=Math.max(corner,Math.min(1-corner,v)),vy=v-cy,t=Math.abs(vy)/corner,S=smooth((t-verticalCore)/(1-verticalCore));return[.5+gain*(u-.5)*S,.5+gain*verticalValue(t,0,vy,cy),.5,1];});
const coordinates=await png(256,256,(x,y)=>{const dx=(x+.5)/256*1.2-.6,v=(y+.5)/256*1.2-.1,cy=Math.max(corner,Math.min(1-corner,v)),dy=v-cy,t=Math.hypot(dx,dy)/corner,{K:k,S}=carrier(t,dx,dy);return[.5+gain*dx*k,.5+gain*verticalValue(t,dx,dy,cy),S,1];});
const rims=await Promise.all([-1,1].map(side=>png(256,256,(x)=>[1,1,1,side<0?Number(x<128):Number(x>=128)])));
const background=await png(256,256,(x,y)=>{const u=(x+.5)/256*1.2-.1,v=(y+.5)/256*1.2-.1,t=Math.hypot(2*u-1,2*v-1),s=smooth((t-.3)/.7),g=.16*55.8/27;return[.5+g*(u-.5)*s,.5+g*(v-.5)*s,.5,1];});
const buffers=[],offsets=[0];
for(let i=0;i<=128;i++){
  const ratio=1+i/64;
  const field=await png(288,232,(xx,yy)=>{const x=(xx-16+.5)/256*ratio,y=(yy-16+.5)/200,cx=Math.max(corner,Math.min(ratio-corner,x)),cy=Math.max(corner,Math.min(1-corner,y)),vx=x-cx,vy=y-cy,t=Math.hypot(vx,vy)/corner,{K:k,S:s}=carrier(t,vx,vy);return[.5+gain*((cx-ratio/2)*s+vx*k),.5+gain*verticalValue(t,vx,vy,cy),.5,1];});
  buffers.push(field);offsets.push(offsets.at(-1)+field.length);
}
const assets={'nav-core-v9.png':normal,'nav-cap-v9.png':coordinates,'nav-half-left-v9.png':rims[0],'nav-half-right-v9.png':rims[1],'nav-circle-v9.png':buffers[0],'nav-background-v9.png':background};
for(const[name,bytes]of Object.entries(assets))await fs.writeFile(path.join(root,'public',name),bytes);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const header=Buffer.from(JSON.stringify({version:9,min:1,step:1/64,height:55.8,width:288,rows:232,...calibration,sources:Object.fromEntries(Object.entries(assets).map(([name,bytes])=>[name,hash(bytes)])),offsets}));
const length=Buffer.alloc(4);length.writeUInt32LE(header.length);
await fs.writeFile(path.join(root,'public/nav-optics-fields-v9.bin'),Buffer.concat([length,header,...buffers]));
const url=bytes=>'data:image/png;base64,'+bytes.toString('base64');
let source=config.replace(/\bmap: "[^"]*"/,'map: '+JSON.stringify(url(normal))).replace(/\bcoordinates: "[^"]*"/,'coordinates: '+JSON.stringify(url(coordinates))).replace(/\brims: \[[^\]]*\]/,'rims: '+JSON.stringify(rims.map(url))).replace(/\bcircle: "[^"]*"/,'circle: '+JSON.stringify(url(buffers[0]))).replace(/\bbackground: "[^"]*"/,'background: '+JSON.stringify(url(background)));
if(!source.includes(url(background)))throw new Error('Cannot embed navigation inputs');
await fs.writeFile(htmlPath,html.slice(0,start)+source+html.slice(end));
console.log('Prepared v9 optical fields: '+offsets.at(-1)+' bytes, 129 cached aspects and six self-contained live inputs.');
