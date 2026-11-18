function pick(actual, shape){
  if (Array.isArray(shape)) return Array.isArray(actual) ? actual.map((v,i)=>pick(v, shape[i])) : actual;
  if (shape && typeof shape==="object") { const o={}; for (const k of Object.keys(shape)) o[k]=pick(actual?.[k], shape[k]); return o; }
  return actual;
}
function eq(a,b){
  if (Object.is(a,b)) return true;
  if (typeof a!=="object"||typeof b!=="object"||!a||!b) return false;
  if (Array.isArray(a)&&Array.isArray(b)) return a.length===b.length && a.every((v,i)=>eq(v,b[i]));
  const ka=Object.keys(a), kb=Object.keys(b);
  return ka.length===kb.length && ka.every(k=>eq(a[k],b[k]));
}
const jobs=[]; const afters=[]; const befores=[]; const afterEachs=[]; const beforeAlls=[];
function describe(n,fn){fn()}
describe.skipIf=(c)=>(n,fn)=>{ if(!c) describe(n,fn) };
function it(n,fn){jobs.push([n,fn])}
it.skip=()=>{}
it.only=it
it.todo=()=>{}
const test=it;
function beforeEach(fn){befores.push(fn)}
function beforeAll(fn){beforeAlls.push(fn)}
function afterAll(fn){afters.push(fn)}
function afterEach(fn){afterEachs.push(fn)}
function dedent(text){
  const lines=text.replace(/^\n/,"").replace(/\n\s*$/,"").split("\n");
  let min=Infinity;
  for (const line of lines){ if(!line.trim()) continue; const n=line.match(/^ */)[0].length; if(n<min) min=n; }
  if(!isFinite(min)) min=0;
  return lines.map(l=>l.slice(min)).join("\n");
}
function parseSnap(text){
  let body=dedent(text).replace(/ from "(\.\/[^"]*)"/g, ' from \\"$1\\"');
  if ((body.startsWith('"') && body.endsWith('"')) || (body.startsWith("'") && body.endsWith("'"))) {
    let inner=body.slice(1,-1).replace(/\\"/g,'"').replace(/\\\\/g,"\\");
    return inner;
  }
  if (body.startsWith("[") || body.startsWith("{")) return Function('"use strict"; return ('+body+");")();
  return body;
}
function expect(actual){
  const api={
    toBe(e){ if(!Object.is(actual,e)) throw new Error("toBe "+JSON.stringify(actual)+" !== "+JSON.stringify(e)); },
    toEqual(e){ if(!eq(actual,e)) throw new Error("toEqual "+JSON.stringify(actual)+" vs "+JSON.stringify(e)); },
    eql(e){ if(!eq(actual,e)) throw new Error("eql "+JSON.stringify(actual)+" vs "+JSON.stringify(e)); },
    toBeDefined(){ if(actual===undefined) throw new Error("toBeDefined"); },
    toBeUndefined(){ if(actual!==undefined) throw new Error("toBeUndefined "+JSON.stringify(actual).slice(0,120)); },
    toHaveBeenCalledTimes(n){ const c=actual?.mock?.calls?.length ?? -1; if(c!==n) throw new Error("called "+c+" !== "+n); },
    toMatch(e){ const ok=e instanceof RegExp?e.test(String(actual)):String(actual).includes(String(e)); if(!ok) throw new Error("toMatch "+String(actual).slice(0,180)); },
    toMatchObject(e){ if(!eq(pick(actual,e), e)) throw new Error("toMatchObject "+JSON.stringify(actual).slice(0,240)+" vs "+JSON.stringify(e).slice(0,180)); },
    toContain(e){ const ok = typeof actual==="string" ? actual.includes(e) : Array.isArray(actual) && actual.some(v=>eq(v,e)); if(!ok) throw new Error("toContain "+JSON.stringify(e)); },
    toHaveLength(n){ if(!actual || actual.length!==n) throw new Error("toHaveLength "+actual?.length+" !== "+n); },
    toBeInstanceOf(ctor){ if(!(actual instanceof ctor)) throw new Error("toBeInstanceOf "+ctor?.name); },
    toBeGreaterThan(n){ if(!(actual>n)) throw new Error("toBeGreaterThan "+actual+" <= "+n); },
    toBeLessThan(n){ if(!(actual<n)) throw new Error("toBeLessThan "+actual); },
    toMatchInlineSnapshot(expected){
      const parsed=parseSnap(String(expected));
      if(!eq(actual, parsed)) throw new Error("snapshot "+JSON.stringify(actual).slice(0,220)+" vs "+JSON.stringify(parsed).slice(0,220));
    },
    toThrow(e){
      let err; try { actual(); } catch(x){ err=x; }
      if(!err) throw new Error("toThrow did not throw");
      if(!e) return;
      const ok = e instanceof RegExp ? e.test(String(err)) : typeof e==="function" ? err instanceof e : String(err).includes(String(e));
      if(!ok) throw new Error("toThrow "+err);
    },
  };
  api.not={
    toContain(e){ const ok = typeof actual==="string" ? actual.includes(e) : Array.isArray(actual)&&actual.some(v=>eq(v,e)); if(ok) throw new Error("not.toContain "+JSON.stringify(e)); },
    toHaveBeenCalled(){ const n=actual?.mock?.calls?.length||0; if(n) throw new Error("not.toHaveBeenCalled "+n+" "+JSON.stringify(actual.mock.calls[0]).slice(0,180)); },
    toBe(e){ if(Object.is(actual,e)) throw new Error("not.toBe"); },
  };
  const have={
    lengthOf(n){ if(!actual||actual.length!==n) throw new Error("length "+actual?.length); },
    length(n){ if(!actual||actual.length!==n) throw new Error("length "+actual?.length+" !== "+n); },
    key(k){ if(actual==null || !(k in actual)) throw new Error("missing key "+k); },
  };
  const notHave={
    key(k){ if(actual!=null && (k in actual)) throw new Error("unexpected key "+k); },
  };
  Object.defineProperty(api,"to",{get(){return {
    eql(e){ api.toEqual(e); },
    equal(e){ api.toEqual(e); },
    contain(e){ api.toContain(e); },
    have,
    not:{
      eql(e){ if(eq(actual,e)) throw new Error("not.eql"); },
      have: notHave,
    },
  };}});
  return api;
}
function viFn(impl){
  let body=impl;
  const f=(...args)=>{ f.mock.calls.push(args); return body? body(...args): undefined; };
  f.mock={calls:[]};
  f.mockResolvedValue=(v)=>{ body=()=>Promise.resolve(v); return f; };
  return f;
}
function spyOn(obj, method){
  const orig=obj[method];
  let impl;
  const f=(...args)=>{ f.mock.calls.push(args); return impl? impl(...args): orig.apply(obj,args); };
  f.mock={calls:[]};
  f.mockImplementation=(i)=>{ impl=i; return f; };
  f.mockRestore=()=>{ obj[method]=orig; };
  obj[method]=f;
  return f;
}
const vi={fn:viFn, spyOn};
globalThis.describe=describe; globalThis.it=it; globalThis.test=test; globalThis.expect=expect; globalThis.vi=vi;
globalThis.beforeEach=beforeEach; globalThis.afterAll=afterAll;
export {describe,it,test,expect,vi,beforeEach,beforeAll,afterEach,afterAll};
queueMicrotask(async()=>{
  let failed=0;
  for (const fn of beforeAlls){ try { await fn(); } catch(e){ failed++; console.log("FAIL before", e&&e.message); } }
  for (const [name,fn] of jobs){
    try { for (const b of befores) await b(); await fn(); for (const a of afterEachs) await a(); }
    catch(e){ failed++; console.log("FAIL", name, e&&e.message?e.message.slice(0,300):e); }
  }
  for (const fn of afters){ try { await fn(); } catch(e){ failed++; console.log("FAIL after", e&&e.message); } }
  if (failed){ console.log("Error:", failed, "failed"); process.exit(1); }
  console.log("ok", jobs.length);
  process.exit(0);
});
