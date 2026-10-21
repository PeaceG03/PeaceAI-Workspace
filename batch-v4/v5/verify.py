import json,subprocess,re,sys
m={l.split()[0]:l.split()[1].rsplit('/',1)[1] for l in open('/workspace/batch-v5/filed.txt')}
order=['tenMinPairManifestKey','isIdleScannerRun','countGappedPlannedFetches','countOrphanFetches','shouldDispatchHeal','planCancelDispatchedRun','planUpgraded','parseFetchIdentityKey']
for i,fn in enumerate(order,1):
    n=m[fn]
    j=json.loads(subprocess.run(['gh','issue','view',n,'-R','PeaceG03/PeaceAI-Workspace','--json','comments,labels'],capture_output=True,text=True).stdout)
    revs=[c for c in j['comments'] if c['body'].startswith('PeaceAI review')]
    other=[c for c in j['comments'] if not c['body'].startswith('PeaceAI review')]
    if not revs:
        print(n,fn,'NO REVIEW', [c['body'][:200].replace('\n',' ') for c in other[-1:]]); continue
    b=revs[-1]['body']; cands=re.findall(r'### Candidate (\w)',b)
    diffs=re.findall(r'```diff\n(.*?)\n```',b,re.S)
    local=open(f'/workspace/batch-v5/runs-final/V{i}/out/candidates/candidate-1.diff').read().rstrip('\n')
    print(n,fn,'cands',cands,'match_local',[d.rstrip('\n')==local for d in diffs],revs[-1]['url'])
