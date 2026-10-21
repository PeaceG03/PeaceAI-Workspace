import json, re, os, glob
R = "/workspace/batch-v8/grade"
cen = [x for x in json.load(open("census.json")) if not x["v3"]]
lc = {}; cur = None
for l in open("cov.lcov"):
    l = l.strip()
    if l.startswith("SF:"): cur = l[3:] if not l[3:].startswith("/") else os.path.relpath(l[3:], R); lc[cur] = {"DA": {}, "BRDA": []}
    elif l.startswith("DA:"): a, b = l[3:].split(",")[:2]; lc[cur]["DA"][int(a)] = int(b)
    elif l.startswith("BRDA:"): p = l[5:].split(","); lc[cur]["BRDA"].append((int(p[0]), p[3]))
tests = {t: open(t).read() for t in glob.glob(f"{R}/src/*.test.ts")}
out = []
for x in cen:
    src = open(f"{R}/{x['f']}").read().split("\n")
    s = next(i for i, l in enumerate(src) if re.match(rf"export function {x['fn']}\b", l))
    depth = 0; e = s; started = False
    for i in range(s, len(src)):
        depth += src[i].count("{") - src[i].count("}")
        if "{" in src[i]: started = True
        if started and depth <= 0: e = i; break
    L = lc.get(x["f"], {"DA": {}, "BRDA": []})
    unl = [i for i in range(s + 2, e + 2) if L["DA"].get(i) == 0]
    unbr = sorted({ln for ln, t in L["BRDA"] if s + 1 <= ln <= e + 1 and t in ("0", "-")})
    hits = L["DA"].get(s + 1)
    direct = [os.path.basename(t) for t, c in tests.items() if re.search(rf"\b{x['fn']}\s*\(", c)]
    imp = [os.path.basename(t) for t, c in tests.items() if re.search(rf"\b{x['fn']}\b", c)]
    out.append({"f": x["f"], "fn": x["fn"], "lines": f"{s+1}-{e+1}", "hits": hits, "unl": unl, "unbr": unbr, "direct": direct, "mentions": len(imp), "v1": bool(x["v1"]), "v2": bool(x["v2"])})
json.dump(out, open("an.json", "w"), indent=0)
for o in out:
    if o["unl"] or o["unbr"] or not o["direct"]:
        print(("v3" if o["v2"] else "v2" if o["v1"] else "v1"), o["f"], o["fn"], o["lines"], "hits", o["hits"], "unl", o["unl"], "unbr", o["unbr"], "direct", len(o["direct"]), "mentions", o["mentions"])
