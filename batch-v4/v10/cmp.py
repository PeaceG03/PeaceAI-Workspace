import json,re,subprocess
R="PeaceG03/PeaceAI-Workspace"
for l in open("/workspace/v10f/filed.txt"):
    z,u=l.split(); n=u.rsplit("/",1)[1]
    labels=[x["name"] for x in json.loads(subprocess.run(["gh","issue","view",n,"-R",R,"--json","labels"],capture_output=True,text=True).stdout)["labels"]]
    cs=json.loads(subprocess.run(["gh","api",f"repos/{R}/issues/{n}/comments"],capture_output=True,text=True).stdout)
    bot=[c for c in cs if c["user"]["login"]=="github-actions[bot]"]
    rev=[c for c in bot if c["body"].startswith("PeaceAI review")]
    if not rev:
        print(z,n,labels,"no-review"," | ".join(c["body"][:140].replace("\n"," ") for c in bot)); continue
    b=rev[-1]["body"]
    cands=re.findall(r"### Candidate ([A-Z])",b); diffs=re.findall(r"```diff\n(.*?)\n```",b,re.S)
    local=open(f"/workspace/v10f/runs/{z}/out/candidates/candidate-1.diff").read().rstrip("\n")
    same=len(diffs)==1 and diffs[0].rstrip("\n")==local
    rule=re.findall(r"public-test-case-existing-v\d",b)
    grading=re.findall(r"COUNTS|UNGRADABLE|NOT_COUNTS|DOES_NOT_COUNT",b)
    print(z,n,labels,"cands",cands,"diff_match",same,"rule",sorted(set(rule)),"grading",sorted(set(grading)),"review",rev[-1]["id"])
