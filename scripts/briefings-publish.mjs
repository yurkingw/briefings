#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { publishReadyFile } from "../lib/publish/cas.js";
import { machineResult } from "../lib/publish/result.js";
import { createGithubGitDataTransport } from "../lib/publish/transport/github-git-data.js";

function parseArgs(argv) {
  let ready = null;
  let receiptDir = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--ready") ready = argv[++index];
    else if (arg === "--receipt-dir") receiptDir = argv[++index];
    else return { error: true };
    if (ready === undefined || receiptDir === undefined) return { error: true };
  }
  if (!ready || !receiptDir) return { error: true };
  return { ready, receiptDir };
}

function emit(stdout, stderr, fields) {
  const line = `${JSON.stringify(machineResult(fields))}\n`;
  stdout.write(line);
  stderr.write(line);
}

export async function main(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const parsed = parseArgs(argv);
  if (parsed.error) {
    emit(stdout, stderr, { result: "bad_args", exit: 10 });
    return 10;
  }
  const outcome = await publishReadyFile({
    readyPath: parsed.ready,
    receiptDir: parsed.receiptDir,
    transport: io.transport ?? createGithubGitDataTransport(),
  });
  emit(stdout, stderr, outcome.body);
  return outcome.exit;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
