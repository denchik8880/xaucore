import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';

const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8').replaceAll('\r\n','\n');
const start=html.indexOf('const NAV_OPTICS ='),end=html.indexOf('function navBind(bar){',start);
assert.ok(start>=0&&end>start);
const original=fs.readFileSync(new URL('../public/nav-normal-map.png',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');

function fixture(load=true){
  const counts={nodes:0,images:[],writes:0};
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
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),glassOn:()=>true,navBox:()=>box,lgDefsReady(){},_lgDefs:defs,
    Image:class{constructor(){counts.images.push(this);}},
    document:{getElementById:id=>defs.children.find(n=>n.getAttribute('id')===id)||null,
      createElementNS:(_,tag)=>{counts.nodes++;return new Element(tag);}},
  };
  vm.createContext(ctx);
  vm.runInContext(html.slice(start,end)+'\nglobalThis.api={NAV_OPTICS,navOpticsBind,navLens};',ctx);
  ctx.api.navOpticsBind(bar);
  if(load)for(const image of counts.images)image.onload();
  return {...ctx.api,ctx,bar,source,box,counts,filter:ctx.NB.optical.filter};
}

test('one original 23 October normal map is the only foreground refraction field',()=>{
  const h=fixture(),map=Buffer.from(h.NAV_OPTICS.map.split(',')[1],'base64');
  assert.equal(sha(original),'2e6fb05ced8964950c2d44e98df98c565e0073c39c764d743f3a62d7cb0150b6');
  assert.equal(sha(map),sha(original));
  assert.equal(h.filter.querySelectorAll('feImage').length,1);
  assert.equal(h.filter.querySelector('feImage').getAttribute('href'),h.NAV_OPTICS.map);
  assert.equal(h.ctx.NB.optical.dms.length,3);
  for(const dm of h.ctx.NB.optical.dms)assert.equal(dm.getAttribute('in2'),'normals');
  assert.ok(!html.includes('navFieldsPrepare')&&!html.includes('navFieldAt')&&!html.includes('nav-optics-fields-v9.bin'));
  assert.equal(h.NAV_OPTICS.bend,27);assert.equal(h.NAV_OPTICS.motion,4);
});

test('the original map and existing backdrop decode before either effect begins',()=>{
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

test('the saved refraction settings control the original field without changing drop geometry',()=>{
  const h=fixture(),shape={...h.box},scale=()=>+h.ctx.NB.optical.dms[1].getAttribute('scale');
  assert.equal(scale(),27);
  h.ctx.LG_UI.refract=.74;h.navLens(1);assert.ok(Math.abs(scale()-19.98)<.001);
  h.ctx.LGQ.r=2.65;h.navLens(1);assert.ok(Math.abs(scale()-27*.74*2.65/2.155)<.001);
  h.ctx.NB.opticalEnergy=1;h.navLens(1);assert.ok(Math.abs(scale()-31*.74*2.65/2.155)<.001);
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
