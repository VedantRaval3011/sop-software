import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Force-kill stray Codex CLI processes (e.g. after dev-server HMR lost run tracking). */
export async function killOrphanComplianceCodexProcesses(): Promise<number> {
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
