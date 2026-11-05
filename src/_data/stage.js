import path from "node:path";
import { loadBriefings } from "../../lib/load-briefings.js";
import { selectStage } from "../../lib/stage.js";

const root = path.resolve(import.meta.dirname, "../..");

export default function () {
  return selectStage(loadBriefings(path.join(root, "content")));
}
