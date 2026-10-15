"""M51: Python twin of peaceai/lib/manifestparts.ts. Reads <dir>/<base>.jsonl or <dir>/<base>/ (index.json +
part-NNN.jsonl), never both; fails closed (ValueError) on a missing index, a missing/altered/extra part, or a combined
sha256 that does not match the index. Returns the whole manifest's bytes."""
import hashlib, json, os, re

PARTS_SCHEMA = "peaceai-manifest-parts:v1"
PART_NAME = re.compile(r"part-\d{3}\.jsonl", re.ASCII)
HEX64 = re.compile(r"[0-9a-f]{64}", re.ASCII)


def _sha(b):
    return hashlib.sha256(b).hexdigest()


def read_manifest_bytes(d, base):
    single, pd = os.path.join(d, base + ".jsonl"), os.path.join(d, base)
    if os.path.lexists(single) and os.path.lexists(pd):
        raise ValueError(f"mixed manifest formats: both {base}.jsonl and {base}/")
    if os.path.lexists(single):
        with open(single, "rb") as f:
            return f.read()
    if not os.path.isdir(pd):
        raise ValueError(f"no manifest: {base}.jsonl or {base}/")
    files = {}
    for e in sorted(os.listdir(pd)):
        if e == "index.json":
            continue
        p = os.path.join(pd, e)
        if os.path.islink(p) or not os.path.isfile(p) or not PART_NAME.fullmatch(e):
            raise ValueError(f"extra file in parts dir: {e}")
        with open(p, "rb") as f:
            files[e] = f.read()
    ip = os.path.join(pd, "index.json")
    if not os.path.isfile(ip):
        raise ValueError("missing parts index")
    with open(ip, encoding="utf-8") as f:
        ix = json.load(f)
    return join_parts(ix, files)


def join_parts(ix, files):
    if not isinstance(ix, dict) or ix.get("schema") != PARTS_SCHEMA or not isinstance(ix.get("parts"), list) or not ix["parts"]:
        raise ValueError("bad parts index")
    if not isinstance(ix.get("combinedSha256"), str) or not HEX64.fullmatch(ix["combinedSha256"]) or type(ix.get("bytes")) is not int:
        raise ValueError("bad parts index")
    names = []
    for i, p in enumerate(ix["parts"]):
        if not isinstance(p, dict) or p.get("name") != f"part-{i:03d}.jsonl":
            raise ValueError(f"bad part name at {i}")
        names.append(p["name"])
    for f in files:
        if f not in names:
            raise ValueError(f"extra file in parts dir: {f}")
    bufs = []
    for p in ix["parts"]:
        b = files.get(p["name"])
        if b is None:
            raise ValueError(f"missing part {p['name']}")
        if len(b) != p.get("bytes") or _sha(b) != p.get("sha256"):
            raise ValueError(f"altered part {p['name']}")
        if not b or b[-1:] != b"\n":
            raise ValueError(f"part {p['name']} does not end at a line")
        bufs.append(b)
    a = b"".join(bufs)
    if len(a) != ix["bytes"] or _sha(a) != ix["combinedSha256"]:
        raise ValueError("combined sha256 does not match the index")
    return a
