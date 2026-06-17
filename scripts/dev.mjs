import { execSync, spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = Number(process.env.PORT || 3000);
const clean = process.argv.includes("--clean");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function killPort(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const pids = new Set();
      for (const line of out.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts.at(-1);
        if (pid && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          console.log(`Stopped stale process on port ${port} (PID ${pid})`);
        } catch {
          // already exited
        }
      }
    } else {
      execSync(`lsof -ti :${port} | xargs -r kill -9`, { stdio: "ignore" });
    }
  } catch {
    // nothing listening
  }
}

if (clean) {
  rmSync(path.join(root, ".next"), { recursive: true, force: true });
  console.log("Cleared .next cache");
}

killPort(PORT);

execSync("node scripts/seed-admin.mjs", { cwd: root, stdio: "inherit" });

const child = spawn("npx", ["next", "dev", "--webpack", "-p", String(PORT)], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => process.exit(code ?? 0));
