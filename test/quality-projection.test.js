import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateQualityProjection as project, evaluateComponent } from '../public/q10-math.js';
const item = id => ({id, name:id, type:'item'});
const set = (...components) => ({type:'set', components});
test('all half-point thresholds preserve existing rounding; high qualities never downgraded', () => {
  for(let q=1;q<10;q++) {
    const p=project(set(item('a'),item('b')),['a','b'],{a:q,b:q+1});
    assert.equal(p.current.quality,q+1);
    assert.equal(p.possible.quality,Math.round((Math.max(5,q)+Math.max(5,q+1))/2));
  }
});
test('nested sets count once and repairs propagate through rounded subset outputs', () => {
  const root=set(set(item('a'),item('b'),item('c')),item('d'));
  const qualities={a:1,b:1,c:1,d:10};
  const p=project(root,Object.keys(qualities),qualities);
  assert.equal(p.current.quality,6);
  assert.equal(p.possible.quality,8);
  assert.deepEqual(qualities,{a:1,b:1,c:1,d:10});
  const repaired={...qualities};
  for(const r of p.repairs) repaired[r.id]=r.to;
  assert.equal(evaluateComponent(root,Object.keys(qualities),repaired).quality,8);
});
test('unknown/unselected/invalid values and empty sets never invent a result', () => {
  for(const [ids,qs] of [[[],{a:10}],[['a'],{}],[['a'],{a:0}],[['a'],{a:11}],[['a'],{a:2.5}]]) {
    const p=project(set(item('a')),ids,qs);
    assert.equal(p.current.complete,false);
    assert.equal(p.possible,null);
  }
  assert.equal(project(set(),[],{}).possible,null);
});
test('no unnecessary repairs when rounding prevents improvement', () => {
  const p=project(set(item('a'),...Array.from({length:9},(_,i)=>item(String(i)))),['a',...Array.from({length:9},(_,i)=>String(i))],{a:4,...Object.fromEntries(Array.from({length:9},(_,i)=>[String(i),10]))});
  assert.equal(p.current.quality,9);
  assert.equal(p.possible.quality,10);
  assert.deepEqual(p.repairs,[{id:'a',name:'a',from:4,to:5}]);
  const unchanged=project(set(item('a'),item('b'),item('c')),['a','b','c'],{a:4,b:10,c:10});
  assert.equal(unchanged.current.quality,8);
  assert.equal(unchanged.possible.quality,8);
  assert.deepEqual(unchanged.repairs,[]);
});
test('repair plan attains exhaustive maximum for small nested projects', () => {
 const root=set(set(item('a'),item('b')),item('c'));
 for(let a=1;a<=10;a++) for(let b=1;b<=10;b++) for(let c=1;c<=10;c++) {
  const qs={a,b,c},ids=Object.keys(qs),p=project(root,ids,qs);
  let max=0;
  for(let mask=0;mask<8;mask++) {
   const trial=Object.fromEntries(ids.map((id,i)=>[id,mask&(1<<i)?Math.max(5,qs[id]):qs[id]]));
   max=Math.max(max,evaluateComponent(root,ids,trial).quality);
  }
  assert.equal(p.possible.quality,max);
  const repaired={...qs};p.repairs.forEach(r=>repaired[r.id]=5);
  assert.equal(evaluateComponent(root,ids,repaired).quality,max);
 }
});

test('Q10 target panel is separate from the output projection', async () => {
  const {readFileSync}=await import('node:fs');
  const vm=await import('node:vm');
  const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('function renderQ10Progress('),source.indexOf('function makeQualitySelect('));
  const main={},detail={};const panel={classList:{add(){}},querySelector:s=>s==='.q10-progress-main'?main:detail};
  const node={querySelector:s=>{assert.equal(s,'.q10-progress:not(.quality-projection)');return panel;}};
  vm.runInNewContext(fn+';renderQ10Progress(node,{status:"achieved",finalAverage:9.5})',{node});
  assert.match(main.textContent,/Q10 achieved/);
});
