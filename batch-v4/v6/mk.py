import json
NOTE=("(Builder pre-file, {skill}, {rule}): Peace's task (source: peace). {why} Self-zone task on PeaceAI-Workspace: {scope} "
      "No gate, grading, approval, leak, rule or workflow file is touched. {dry} Disjoint file: each task in this batch creates its own new test file. Expected {exp}.)")
TE=("TEST_CASE_EXISTING","public-test-case-existing-v1")
T=[
("S1","self-tests/helpers","utcDayKey","peaceai/self-tests/helpers/dates.ts","utc day keys","characterization test for the UTC day key helper",
 ['utcDayKey(new Date("2026-10-17T05:59:00Z")) is "2026-10-17"','utcDayKey(new Date("2026-12-31T23:59:59Z")) is "2026-12-31"','utcDayKey(new Date("2024-02-29T00:00:00Z")) is "2024-02-29"'],
 "The existing helpers test checks one mid-day value only; this pins the UTC day boundary, year end and a leap day.",TE,"one new peaceai/self-tests/helpers/*.test.ts file only."),
("S2","self-tests/helpers","minutesOfUtcDay","peaceai/self-tests/helpers/dates.ts","utc minute bounds","characterization test for minutes of the UTC day at the bounds",
 ['minutesOfUtcDay(new Date("2026-10-16T00:00:00Z")) is 0','minutesOfUtcDay(new Date("2026-10-16T23:59:59Z")) is 1439','minutesOfUtcDay(new Date("2026-10-16T12:30:00Z")) is 750'],
 "The existing helpers test checks one value; this pins both ends of the day (seconds are dropped).",TE,"one new peaceai/self-tests/helpers/*.test.ts file only."),
("S3","self-tests/helpers","plural","peaceai/self-tests/helpers/text.ts","plural counts","characterization test for plural at zero and negative counts",
 ['plural(0, "run") is "0 runs"','plural(1, "file") is "1 file"','plural(-1, "run") is "-1 runs"'],
 "The existing helpers test covers 1 and 3 only; this pins zero and negative counts.",TE,"one new peaceai/self-tests/helpers/*.test.ts file only."),
("S4","self-tests/helpers","truncate","peaceai/self-tests/helpers/text.ts","truncate edges","characterization test for the helper truncate at its edges",
 ['truncate("abcd", 1) is "\u2026"','truncate("abcd", 4) is "abcd"','truncate("abcd", -2) is ""','truncate("", 3) is ""'],
 "The existing helpers test does not cover max 1, an exact fit, a negative max or empty text; this pins them.",TE,"one new peaceai/self-tests/helpers/*.test.ts file only."),
("S5","text","truncate","src/text.ts","short limits","characterization test for truncate with limits of one or less",
 ['truncate("abc", 1) is "a"','truncate("abc", 0) is ""','truncate("abcd", 2) is "a\u2026"'],
 "src/text.test.ts never reaches the maxLength <= 1 branch; this pins it (the negative-limit case is a separate bug task, not pinned here).",TE,"one new src/*.test.ts file only."),
("S6","text","slugify","src/text.ts","slug edges","characterization test for slugify on empty and punctuation-only titles",
 ['slugify("") is ""','slugify("---") is ""','slugify("Top 10 Tips") is "top-10-tips"'],
 "src/text.test.ts covers one title; this pins empty and punctuation-only input and digits.",TE,"one new src/*.test.ts file only."),
("S7","config","parseQuantity","src/config.ts","quantity parsing","characterization test for parseQuantity on decimals, zero, padding and exponents",
 ['parseQuantity("2.5") is 1','parseQuantity("0") is 1','parseQuantity(" 3 ") is 3','parseQuantity("1e2") is 100'],
 "src/config.test.ts covers 7, -2 and abc; this pins decimals, zero, padded and exponent input (Number() semantics).",TE,"one new src/*.test.ts file only."),
]
tasks=[]
for (i,mod,fn,f,short,tl,bul,why,(skill,rule),scope) in T:
    body=f"Target: PeaceG03/PeaceAI-Workspace\n\nadd a characterization test for {fn} in {f}: {short}\n"+"".join(f"- {b}\n" for b in bul)+"\n"+NOTE.format(skill=skill,rule=rule,why=why,scope=scope,dry="{DRY}",exp="COUNTS")
    tasks.append({"id":i,"title":f"[{mod}] {fn}: {tl}","body":body,"expect":"solve","accept":{"mutate":{"file":f,"fn":fn}}})
# S8: real bug, bounded replacement (expected refusal today: src/text.ts not in EDITABLE_PATHS)
b8=("Target: PeaceG03/PeaceAI-Workspace\n\nin truncate in src/text.ts: replace return text.slice(0, maxLength) with text.slice(0, Math.max(0, maxLength))\n"
    "- truncate(\"abc\", -1) is \"\"\n- truncate(\"abc\", 1) is \"a\"\n- truncate(\"abc\", 0) is \"\"\n\n"
    "(Builder pre-file, MODIFY_BODY, public-replace-expression-v2): Peace's task (source: peace). Bug: truncate(\"abc\", -1) returns \"ab\", longer than the limit, because slice(0, -1) counts from the end. Self-zone task on PeaceAI-Workspace: one expression in src/text.ts plus one new src/*.test.ts file. {DRY} Expected: refused today (src/text.ts is not in the replace rule's EDITABLE_PATHS).)")
tasks.append({"id":"S8","title":"[text] truncate: a negative limit returns text longer than the limit","body":b8,"expect":"refuse","accept":{}})
for t in tasks:
    assert all(ord(c)>=32 or c=="\n" for c in t["body"]) and "\\u" not in t["body"]
json.dump({"schema":"peaceai-stress-suite:v1","target":"PeaceG03/PeaceAI-Workspace","base":"c7ba0a5","tasks":tasks},open("tasks.json","w"),indent=1,ensure_ascii=False)
print(len(tasks))
