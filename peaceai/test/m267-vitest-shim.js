
function eq(a,b){
  if (Object.is(a,b)) return true;
  if (typeof a!=="object"||typeof b!=="object"||!a||!b) return false;
  if (Array.isArray(a)&&Array.isArray(b)) return a.length===b.length && a.every((v,i)=>eq(v,b[i]));
  const ka=Object.keys(a), kb=Object.keys(b);
  return ka.length===kb.length && ka.every(k=>eq(a[k],b[k]));
}
const jobs=[];
function describe(n,fn){fn()}
describe.skipIf=(cond)=>(n,fn)=>{ if(!cond) describe(n,fn) };
function it(n,fn){jobs.push(fn)}
const beforeAlls=[], afterAlls=[], befores=[];
function beforeAll(fn){beforeAlls.push(fn)}
function afterAll(fn){afterAlls.push(fn)}
function beforeEach(fn){befores.push(fn)}
function expect(actual){
  return {
    toBe(e){ if(!Object.is(actual,e)) throw new Error("toBe "+JSON.stringify(actual)+" !== "+JSON.stringify(e)); },
    toEqual(e){ if(!eq(actual,e)) throw new Error("toEqual "+JSON.stringify(actual)+" vs "+JSON.stringify(e)); },
    toMatchInlineSnapshot(expected){
      const text=String(expected).trim();
      if (text.startsWith("[") || text.startsWith("{")) {
        const parsed=Function('"use strict"; return ('+text+");")();
        if(!eq(actual, parsed)) throw new Error("snapshot "+JSON.stringify(actual));
        return;
      }
      const inner = text.startsWith('"') && text.endsWith('"') ? text.slice(1,-1) : text;
      if(actual !== inner) throw new Error("snapshot "+JSON.stringify(actual)+" vs "+JSON.stringify(inner));
    },
  };
}
globalThis.describe=describe; globalThis.it=it; globalThis.test=it;
globalThis.beforeAll=beforeAll; globalThis.afterAll=afterAll; globalThis.beforeEach=beforeEach;
globalThis.expect=expect;
export {describe,it,expect,beforeAll,afterAll,beforeEach};
queueMicrotask(async()=>{
  let failed=0;
  try { for (const fn of beforeAlls) await fn(); } catch(e){ failed++; console.log("FAIL", e); }
  for (const fn of jobs){
    try { for (const b of befores) await b(); await fn(); }
    catch(e){ failed++; console.log("FAIL", e && e.message ? e.message : e); }
  }
  try { for (const fn of afterAlls) await fn(); } catch(e){ failed++; console.log("FAIL", e); }
  if (failed){ console.log("Error:", failed, "failed"); process.exit(1); }
  console.log("ok", jobs.length);
});
