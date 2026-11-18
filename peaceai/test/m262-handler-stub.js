import { isTag as raw } from "domelementtype";
export function isTag(node) { return !!node && raw(node); }
export function hasChildren(node) { return !!node && Array.isArray(node.children); }
