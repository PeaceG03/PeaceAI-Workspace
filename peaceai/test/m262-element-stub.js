export const ElementType = {
  Root: "root",
  Text: "text",
  Directive: "directive",
  Comment: "comment",
  Script: "script",
  Style: "style",
  Tag: "tag",
  CDATA: "cdata",
  Doctype: "doctype",
};
export function isTag(element) {
  return !!element && (element.type === "tag" || element.type === "script" || element.type === "style");
}
