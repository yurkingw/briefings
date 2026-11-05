import path from "node:path";
import { loadBriefings } from "../../lib/load-briefings.js";

const root = path.resolve(import.meta.dirname, "../..");

export default function () {
  return loadBriefings(path.join(root, "content"));
}
