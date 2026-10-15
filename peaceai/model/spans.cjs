// usage: node spans.cjs file -> JSON [{name,open,end}] of top-level function decl bodies and const arrow bodies
const ts = require(process.env.TSPATH);
const src = require("fs").readFileSync(process.argv[2], "utf8");
const sf = ts.createSourceFile("f.ts", src, ts.ScriptTarget.Latest, true);
const out = [];
const add = (name, body) => { if (body && ts.isBlock(body)) out.push({ name, open: body.getStart(sf) + 1, end: body.getEnd() - 1, text: src.slice(body.getStart(sf) + 1, body.getEnd() - 1) }); };
for (const s of sf.statements) {
  if (ts.isFunctionDeclaration(s) && s.name) add(s.name.text, s.body);
  if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) && ts.isIdentifier(d.name)) add(d.name.text, d.initializer.body);
}
console.log(JSON.stringify(out));
