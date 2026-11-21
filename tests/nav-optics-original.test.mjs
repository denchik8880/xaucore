import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=html.indexOf('const NAV_OPTICS ='),end=html.indexOf('function navBind(bar){',start);
assert.ok(start>=0&&end>start);

function fixture(load=true){
  const counts={nodes:0,images:[],writes:0,canvases:[]};
  class Element{
    constructor(tag){this.tag=tag;this.attrs=new Map();this.children=[];this.isConnected=true;this.style={filter:'',setProperty(){}};}
    setAttribute(k,v){counts.writes++;this.attrs.set(k,String(v));}
    getAttribute(k){return this.attrs.get(k)??null;}
    appendChild(node){this.children.push(node);return node;}
    querySelectorAll(tag){return this.children.filter(n=>n.tag===tag);}
    querySelector(selector){
      const result=selector.match(/^\[result="([^"]+)"\]$/);
      return result?this.children.find(n=>n.getAttribute('result')===result[1])||null:this.querySelectorAll(selector)[0]||null;
    }
  }
  const defs=new Element('defs'),source=new Element('source'),bar=new Element('bar');
  bar.clientWidth=384;bar.clientHeight=64;bar.querySelector=s=>s==='.nr-optics'?source:null;
  const box={left:1.2,sx:1.5,sy:1},ctx={
    Math,LG_LENS:true,LG_UI:{refract:1},LGQ:{r:2.155},DISP:{on:true,drops:true,str:50},
    NB:{clear:1,opticalEnergy:0,a:1,b:2,lift:0,optical:null},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),glassOn:()=>true,navBox:()=>box,navCorner:()=>.5,navOval:c=>1+.35*Math.max(0,Math.min(1,c)),navDarkLens:()=>false,NAV_DARK:{magnify:.2,reach:.2,reachMotion:0,lift:.16},NAV_N:5,lgDefsReady(){},_lgDefs:defs,
    Image:class{constructor(){counts.images.push(this);}},
    document:{getElementById:id=>defs.children.find(n=>n.getAttribute('id')===id)||null,
      createElementNS:(_,tag)=>{counts.nodes++;return new Element(tag);},
      createElement:tag=>{
        const c={width:0,height:0,image:null,getContext:()=>({createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),putImageData:img=>{c.image=img;}}),
          toDataURL:()=>'data:image/png;base64,GENERATED'};
        counts.canvases.push(c);return c;
      }},
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start,end)+'\nglobalThis.api={NAV_OPTICS,navOpticsBind,navLens};',ctx);
  ctx.api.navOpticsBind(bar);
  if(load)for(const image of counts.images)image.onload();
  return {...ctx.api,ctx,bar,source,box,counts,filter:ctx.NB.optical.filter};
}

test('one generated rim field, drawn once, is the only foreground refraction field',()=>{
  const h=fixture();
  assert.equal(h.counts.canvases.length,1,'The field is drawn once, whatever binds it');
  h.navOpticsBind(h.bar);h.navLens(.5);assert.equal(h.counts.canvases.length,1);
  assert.equal(h.filter.querySelectorAll('feImage').length,1);
  assert.equal(h.filter.querySelector('feImage').getAttribute('href'),'data:image/png;base64,GENERATED');
  assert.equal(h.ctx.NB.optical.dms.length,3);
  for(const dm of h.ctx.NB.optical.dms)assert.equal(dm.getAttribute('in2'),'normals');
  assert.ok(!html.includes('navFieldsPrepare')&&!html.includes('navFieldAt')&&!html.includes('nav-optics-fields-v9.bin'));
  assert.equal(h.NAV_OPTICS.reach,.18);assert.equal(h.NAV_OPTICS.reachMotion,.05,'in flight the reference bends about as softly as at rest (2026-11-17)');assert.equal(h.NAV_OPTICS.gamma,6);
  assert.equal(h.filter.querySelector('[result="normals"]').tag,'feColorMatrix','The field reaches per axis through one matrix');
});

test('the fitted field pulls towards the middle as rho to the sixth, strongest at the sides',()=>{
  const h=fixture(),O=h.NAV_OPTICS,img=h.counts.canvases[0].image,W=img.width,H=img.height;
  assert.equal(W,O.mapW);assert.equal(H,O.mapH);
  const px=(x,y)=>{const i=(y*W+x)*4;return [img.data[i],img.data[i+1]];};
  const cx=W/2|0,cy=H/2|0,m=O.mapM;
  assert.deepEqual(px(cx,cy),[128,128],'No bend in the middle: the magnifier is the source transform');
  assert.ok(Math.abs(px(cx-60,cy)[0]-128)<=2,'Barely any half way out');
  assert.ok(px(W-m-1,cy)[0]<36,'Right rim samples inward (to the left)');
  assert.ok(px(m,cy)[0]>220,'Left rim samples inward (to the right)');
  assert.ok(px(cx,m)[1]>150&&px(cx,m)[1]<200,'Top rim samples below it, gentler than the sides');
  assert.ok(px(cx,H-m-1)[1]<106&&px(cx,H-m-1)[1]>56,'Foot samples above it, gentler than the sides');
  // monotonic rise across the band to the rim
  let last=0;for(let x=cx;x<W-m;x++){const v=128-px(x,cy)[0];assert.ok(v>=last-1);last=v;}
});

test('the generated field and existing backdrop decode before either effect begins',()=>{
  const h=fixture(false);assert.equal(h.counts.images.length,2);assert.equal(h.source.style.filter,'');
  h.counts.images[0].onload();h.navLens(1);assert.equal(h.source.style.filter,'');
  h.counts.images[1].onload();assert.equal(h.source.style.filter,'url(#xc-nav-optics)');
});

test('transparent glyph coverage and RGB dispersion remain intact',()=>{
  const h=fixture(),byResult=n=>h.filter.querySelector('[result="'+n+'"]');
  assert.equal(byResult('inkCoverage').children.length,3);
  assert.equal(byResult('navigationEmpty').getAttribute('in2'),'inkCoverage');
  assert.equal(byResult('navigationRGBA').getAttribute('k3'),'-1');
  const scales=()=>h.ctx.NB.optical.dms.map(n=>+n.getAttribute('scale'));
  assert.ok(scales()[0]<scales()[1]&&scales()[1]<scales()[2]);
  h.ctx.DISP.on=false;h.navLens(1);assert.equal(new Set(scales()).size,1);
});

test('the saved refraction settings control the field without changing drop geometry',()=>{
  const h=fixture(),shape={...h.box},scale=()=>+h.ctx.NB.optical.dms[1].getAttribute('scale');
  const O=h.NAV_OPTICS,w=384/5*h.box.sx,hh=55*h.box.sy,half=Math.max(w,hh)/2,base=2*O.reach*O.gmax*half;
  assert.ok(Math.abs(scale()-base)<.001,'scale '+scale()+' vs '+base);
  h.ctx.LG_UI.refract=.74;h.navLens(1);assert.ok(Math.abs(scale()-base*.74)<.001);
  h.ctx.LGQ.r=2.65;h.navLens(1);assert.ok(Math.abs(scale()-base*.74*2.65/2.155)<.001);
  h.ctx.NB.opticalEnergy=1;h.navLens(1);assert.ok(Math.abs(scale()-base*(O.reach+O.reachMotion)/O.reach*.74*2.65/2.155)<.001);
  // the shorter axis reaches proportionally less, through the matrix on the field
  const m=h.filter.querySelector('[result="normals"]').getAttribute('values').split(' ').map(Number);
  assert.ok(Math.abs(m[6]-hh/w)<.001&&Math.abs(m[0]-1)<.001);
  h.ctx.LG_UI.refract=0;h.navLens(1);assert.equal(h.source.style.filter,'');
  h.ctx.LG_UI.refract=1;h.navLens(1);assert.equal(h.source.style.filter,'url(#xc-nav-optics)');
  assert.deepEqual(h.box,shape);
});

test('the motion loop reuses one filter and no image, Blob or filter node is created in a frame',()=>{
  const h=fixture(),nodes=h.counts.nodes,images=h.counts.images.length;
  for(let i=0;i<300;i++){h.box.left=1.2+i/300;h.ctx.NB.opticalEnergy=(i%100)/100;h.navLens((i%99+1)/100);}
  assert.equal(h.counts.nodes,nodes);assert.equal(h.counts.images.length,images);
  h.navOpticsBind(h.bar);assert.equal(h.counts.nodes,nodes);assert.equal(h.counts.images.length,images);
  h.navLens(0);assert.equal(h.source.style.filter,'');
});

test('light (the user’s v3 video): no channel is bent apart, the red glyphs grow a pale cyan rim that fades with the glass',()=>{
  const h=fixture(),byResult=n=>h.filter.querySelector('[result="'+n+'"]'),scales=()=>h.ctx.NB.optical.dms.map(n=>+n.getAttribute('scale'));
  h.ctx.document.documentElement={dataset:{}};h.navLens(1);
  assert.equal(new Set(scales()).size,1,'all three wavelengths bent alike: no magenta beside the cyan');
  const r1=+byResult('sample0x').getAttribute('radius');assert.ok(r1>.3&&r1<1.2,'rim '+r1);
  assert.equal(+byResult('inkSample0x').getAttribute('radius'),r1,'the coverage keeps the rim');
  assert.equal(byResult('channel0').getAttribute('in'),'sample0x');assert.equal(byResult('inkCoverage').children[0].getAttribute('in'),'inkSample0x');
  assert.equal(byResult('inkCoverage').children.length,3);
  h.navLens(.5);assert.ok(Math.abs(+byResult('sample0x').getAttribute('radius')-r1/2)<1e-3,'fades with the glass');
  h.ctx.DISP.on=false;h.navLens(1);assert.equal(+byResult('sample0x').getAttribute('radius'),0);h.ctx.DISP.on=true;
  // Aurora (and dark) keep the split and the plain red sample
  h.ctx.document.documentElement={dataset:{theme:'dark',tone:'aurora'}};h.navLens(1);
  assert.ok(scales()[0]<scales()[1]&&scales()[1]<scales()[2]);
  assert.equal(byResult('channel0').getAttribute('in'),'sample0');assert.equal(byResult('inkCoverage').children[0].getAttribute('in'),'inkSample0');
  assert.equal(+byResult('sample0x').getAttribute('radius'),0);
});
