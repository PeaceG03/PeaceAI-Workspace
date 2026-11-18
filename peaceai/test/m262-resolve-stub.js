function normalize(path) {
  const abs = path.startsWith("/");
  const parts = [];
  for (const piece of path.split("/")) {
    if (!piece || piece === ".") continue;
    if (piece === "..") { parts.pop(); continue; }
    parts.push(piece);
  }
  const joined = parts.join("/");
  return abs ? "/" + joined : joined;
}

export default function resolve(input, base) {
  const value = input || "";
  if (!base) return normalize(value);
  if (value.startsWith("/")) return value;
  return normalize(base + value);
}
