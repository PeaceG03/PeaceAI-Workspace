const Tag = "tag";
const Text = "text";
function element(name) {
  return { type: name === "script" ? "script" : name === "style" ? "style" : Tag, name, attribs: {}, children: [] };
}
function text(data) { return { type: Text, data }; }
export function parseDocument(html) {
  const root = [];
  const stack = [{ children: root }];
  const re = /<\/?([A-Za-z0-9]+)[^>]*>|([^<]+)/g;
  let match;
  while ((match = re.exec(html))) {
    if (match[2] != null) { if (match[2]) stack.at(-1).children.push(text(match[2])); }
    else if (match[0].startsWith("</")) stack.pop();
    else {
      const node = element(match[1]);
      stack.at(-1).children.push(node);
      if (!match[0].endsWith("/>")) stack.push(node);
    }
  }
  return { type: "root", children: root };
}
