import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function atomicWrite(file, bytes) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  const fd = fs.openSync(tmp, "w", 0o644);
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export function writeTempOnly(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  fs.writeFileSync(`${file}.tmp-crash`, data);
}
