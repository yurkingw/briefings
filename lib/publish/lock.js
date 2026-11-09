import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fail } from "./errors.js";

// The helper holds a kernel flock. It dies with its parent, including SIGKILL,
// so a crashed caller does not leave a lock that later calls can only time out on.
const HELPER = `
import ctypes, os, sys, time
import fcntl
libc = ctypes.CDLL("libc.so.6", use_errno=True)
if libc.prctl(1, 9) != 0:
    raise SystemExit(2)
if os.getppid() == 1:
    raise SystemExit(2)
lock_path, timeout = sys.argv[1], float(sys.argv[2])
fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o644)
deadline = time.monotonic() + timeout
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() >= deadline:
            raise SystemExit(30)
        time.sleep(0.01)
os.ftruncate(fd, 0)
os.lseek(fd, 0, os.SEEK_SET)
os.write(fd, f"parent={os.getppid()} helper={os.getpid()}\\n".encode())
sys.stdout.write("locked\\n")
sys.stdout.flush()
sys.stdin.read()
`;

export async function withLock(dir, { timeoutMs }, fn) {
  fs.mkdirSync(dir, { recursive: true });
  const lockPath = path.join(dir, "publish.lock");
  const child = spawn("python3", ["-c", HELPER, lockPath, String(Math.max(timeoutMs, 0) / 1000)], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  let settled = false;
  const acquired = await new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk;
      if (!settled && buf.includes("locked")) {
        settled = true;
        resolve(true);
      }
    });
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      if (code === 30) resolve(false);
      else reject(fail(30, "lock_lost"));
    });
  });
  if (!acquired) throw fail(30, "lock_timeout");
  let lost = false;
  child.on("exit", () => {
    lost = true;
  });
  try {
    const value = await fn();
    if (lost) throw fail(30, "lock_lost");
    return value;
  } finally {
    if (child.exitCode === null && !child.killed) {
      child.stdin.end();
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
}
