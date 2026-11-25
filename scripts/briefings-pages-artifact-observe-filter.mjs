import fs from "node:fs";
import { acceptPublicLine, publicObservation } from "../lib/pages-artifact-observe.js";

const text = fs.readFileSync(0, "utf8");
let chosen = null;
for (const line of text.split("\n")) {
  if (!line.includes("pages-artifact-list")) continue;
  try {
    const parsed = JSON.parse(line);
    const accepted = acceptPublicLine(parsed);
    if (accepted) chosen = accepted;
  } catch {
    // A non-JSON line cannot be a public observation.
  }
}
process.stdout.write(`${JSON.stringify(chosen || publicObservation({ list: "error", errorCode: "list_failed" }))}\n`);
