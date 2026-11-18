
function dedent(text){
  const lines=text.replace(/^\n/,"").replace(/\n\s*$/,"").split("\n");
  let min=Infinity;
  for (const line of lines){
    if (!line.trim()) continue;
    const n=line.match(/^ */)[0].length;
    if (n<min) min=n;
  }
  if (!isFinite(min)) min=0;
  return lines.map(l=>l.slice(min)).join("\n");
}
function parseSnap(text){
  const body=dedent(text);
  if ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'"))) {
    let inner=body.slice(1,-1);
    inner=inner.replace(/\\"/g,'"').replace(/\\\\/g,"\\");
    return inner;
  }
  if (body.startsWith("[") || body.startsWith("{")) return Function('"use strict"; return ('+body+");")();
  return body;
}
function eq(a,b){
  if (Object.is(a,b)) return true;
  if (typeof a!=="object"||typeof b!=="object"||!a||!b) return false;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length!==b.length) return false;
    for (let i=0;i<a.length;i++) if (a[i]!==b[i]) return false;
    return true;
  }
  if (Array.isArray(a)&&Array.isArray(b)) return a.length===b.length && a.every((v,i)=>eq(v,b[i]));
  const ka=Object.keys(a), kb=Object.keys(b);
  return ka.length===kb.length && ka.every(k=>eq(a[k],b[k]));
}
const jobs=[];
function describe(n,fn){fn()}
describe.skipIf=(cond)=>(n,fn)=>{ if(!cond) describe(n,fn) };
function it(n,fn){jobs.push([n,fn])}
const test = it;
const afters=[];
function afterAll(fn){afters.push(fn)}
function beforeEach(fn){jobs.befores=jobs.befores||[]; jobs.befores.push(fn)}
function expect(actual){
  const api={
    toBe(e){ if(!Object.is(actual,e)) throw new Error("toBe "+JSON.stringify(actual)+" !== "+JSON.stringify(e)); },
    toEqual(e){ if(!eq(actual,e)) throw new Error("toEqual "+JSON.stringify(actual)+" vs "+JSON.stringify(e)); },
    toMatch(e){
      const ok = e instanceof RegExp ? e.test(String(actual)) : String(actual).includes(String(e));
      if(!ok) throw new Error("toMatch "+JSON.stringify(String(actual).slice(0,200))+" !~ "+e);
    },
    toMatchObject(e){ if(!eq(pick(actual,e), e)) throw new Error("toMatchObject "+JSON.stringify(actual)); },
    toThrowError(e){
      let err;
      try { actual(); } catch (x) { err=x; }
      if(!err) throw new Error("toThrowError did not throw");
      const msg=String(err.message||err);
      const ok = e instanceof RegExp ? e.test(msg) : msg.includes(String(e));
      if(!ok) throw new Error("toThrowError "+msg);
    },
    toMatchInlineSnapshot(expected){
      const parsed=parseSnap(String(expected));
      if(!eq(actual, parsed) && actual!==parsed) throw new Error("snapshot "+JSON.stringify(actual).slice(0,240)+" vs "+JSON.stringify(parsed).slice(0,240));
    },
    toHaveLength(n){ if(!actual || actual.length!==n) throw new Error("length "+actual?.length+" !== "+n); },
  };
  Object.defineProperty(api, "to", { get(){ return { eql(e){ api.toEqual(e); }, equal(e){ api.toEqual(e); }, have: { lengthOf(n){ if(!actual || actual.length!==n) throw new Error("lengthOf "+actual?.length+" !== "+n); } } }; } });
  return api;
}
function pick(actual, shape){
  if (Array.isArray(shape)) return Array.isArray(actual)? actual.map((v,i)=>pick(v, shape[i])) : actual;
  if (shape && typeof shape==="object") {
    const o={};
    for (const k of Object.keys(shape)) o[k]=pick(actual?.[k], shape[k]);
    return o;
  }
  return actual;
}
globalThis.describe=describe; globalThis.it=it; globalThis.test=it; globalThis.beforeEach=beforeEach; globalThis.expect=expect;
export {describe,it,test,expect,beforeEach,afterAll};
queueMicrotask(async()=>{
  let failed=0;
  for (const [name,fn] of jobs){
    try { for (const b of jobs.befores||[]) await b(); await fn(); }
    catch(e){ failed++; console.log("FAIL", name, e && e.message ? e.message.slice(0,300) : e); }
  }
  for (const fn of afters){ try { await fn(); } catch(e){ failed++; console.log('FAIL after', e && e.message); } }
  if (failed){ console.log("Error:", failed, "failed"); process.exit(1); }
  console.log("ok", jobs.length);
});
