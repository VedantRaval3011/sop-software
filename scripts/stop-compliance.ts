/**
 * Force-stop compliance analysis (kills Codex CLI subprocesses on this machine).
 *
 * Usage:
 *   npx tsx scripts/stop-compliance.ts
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

async function killCodex(): Promise<number> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq codex.exe", "/FO", "CSV", "/NH"], {
        windowsHide: true,
      });
      const lines = stdout.trim().split(/\r?\n/).filter((l) => l.includes("codex.exe"));
      if (!lines.length) return 0;
      await execFileAsync("taskkill", ["/F", "/IM", "codex.exe", "/T"], { windowsHide: true });
      return lines.length;
    } catch {
      return 0;
    }
  }
  try {
    await execFileAsync("pkill", ["-f", "codex exec"], { windowsHide: true });
    return 1;
  } catch {
    return 0;
  }
}

async function main() {
  const n = await killCodex();
  console.log(n > 0 ? `Killed ${n} codex process(es).` : "No codex processes found.");
  console.log(
    "If the dev server is running, also POST /api/compliance/cancel with { stopAll: true } to abort in-process runs.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
