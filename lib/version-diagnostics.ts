import { getGroupedRegistryRows } from "@/lib/dashboardRegistrySource";
import {
  baseIdentifierFromIdentifier,
} from "@/lib/sop-utils";
import { isBunnyConfigured } from "@/lib/validateEnv";
import {
  buildBunnyVersionFileIndex,
  lookupBunnyVersionFile,
} from "@/lib/bunny-version-index";
import type { RegistrySOP } from "@/lib/types";

/* ─── Types ──────────────────────────────────────────────────────────── */

export type VersionFileFormat = "docx" | "pdf";
export type VersionLang = "ENG" | "GUJ";
export type VersionScope = "current" | "prior";

export interface MissingVersionFile {
  scope: VersionScope;
  version: string;
  lang: VersionLang;
  format: VersionFileFormat;
  /** The versioned SOP code this file belongs to (e.g. PEGE01-09). */
  fileIdentifier: string;
  /** Whether a matching file was found in Bunny storage (null = not checked). */
  inBunny: boolean | null;
  bunnyUrl?: string;
}

export interface IncompleteSop {
  identifier: string;
  department: string;
  language: string;
  currentVersion: string;
  missing: MissingVersionFile[];
}

export interface VersionDiagnosticsReport {
  bunnyConfigured: boolean;
  bunnyChecked: boolean;
  totalActive: number;
  versionComplete: number;
  versionIncomplete: number;
  summary: {
    missingDocx: number;
    missingPdf: number;
    missingCurrent: number;
    missingPrior: number;
    /** Missing files that DO exist in Bunny (uploaded but not linked → relinkable). */
    relinkableFromBunny: number;
    /** Missing files genuinely absent from Bunny (need re-upload). */
    notInBunny: number;
  };
  incompleteSops: IncompleteSop[];
}

/* ─── Per-SOP missing-file computation ───────────────────────────────────
 * Mirrors the version-completeness rule used by the dashboard capsules
 * (lib/sop-utils.ts → buildCapsule / applyFilters), but records exactly WHICH
 * file is missing instead of blanket-marking every slot. */

export function computeMissingFiles(sop: RegistrySOP): MissingVersionFile[] {
  const needsEn = sop.language === "ENG" || sop.language === "ENG-GUJ";
  const needsGu = sop.language === "GUJ" || sop.language === "ENG-GUJ";
  const base = baseIdentifierFromIdentifier(sop.identifier);
  const missing: MissingVersionFile[] = [];

  const push = (
    scope: VersionScope,
    version: string,
    lang: VersionLang,
    format: VersionFileFormat,
    fileIdentifier: string,
  ) => missing.push({ scope, version, lang, format, fileIdentifier, inBunny: null });

  // Current version: must have docx + pdf for each required language.
  if (needsEn) {
    if (!sop.files.docx.en) push("current", sop.version, "ENG", "docx", sop.identifier);
    if (!sop.files.pdf.en) push("current", sop.version, "ENG", "pdf", sop.identifier);
  }
  if (needsGu) {
    if (!sop.files.docx.gu) push("current", sop.version, "GUJ", "docx", sop.identifier);
    if (!sop.files.pdf.gu) push("current", sop.version, "GUJ", "pdf", sop.identifier);
  }

  // Prior versions: each must have BOTH docx + pdf for its language.
  for (const pv of sop.priorVersions) {
    const lang: VersionLang = pv.language === "GUJ" ? "GUJ" : "ENG";
    const ident = `${base}-${pv.version}`;
    if (pv.missing) {
      // Whole revision was never uploaded for this language.
      push("prior", pv.version, lang, "docx", ident);
      push("prior", pv.version, lang, "pdf", ident);
      continue;
    }
    if (!pv.docx) push("prior", pv.version, lang, "docx", ident);
    if (!pv.pdf) push("prior", pv.version, lang, "pdf", ident);
  }

  return missing;
}

function slotLanguage(lang: VersionLang): "English" | "Gujarati" {
  return lang === "GUJ" ? "Gujarati" : "English";
}

/* ─── Main entry point ───────────────────────────────────────────────── */

export async function buildVersionDiagnostics(opts: {
  checkBunny?: boolean;
  department?: string;
}): Promise<VersionDiagnosticsReport> {
  const rows = await getGroupedRegistryRows();
  const active = rows.filter((s) => !s.isObsolete);
  const dept = opts.department?.trim();
  const scoped = dept && dept !== "All" && dept !== "Total"
    ? active.filter((s) => s.department === dept)
    : active;

  const bunnyConfigured = isBunnyConfigured();
  const wantBunny = Boolean(opts.checkBunny) && bunnyConfigured;
  const bunnyIndex = wantBunny ? await buildBunnyVersionFileIndex() : null;

  const incompleteSops: IncompleteSop[] = [];
  let versionComplete = 0;
  const summary = {
    missingDocx: 0,
    missingPdf: 0,
    missingCurrent: 0,
    missingPrior: 0,
    relinkableFromBunny: 0,
    notInBunny: 0,
  };

  for (const sop of scoped) {
    const missing = computeMissingFiles(sop);
    if (missing.length === 0) {
      versionComplete++;
      continue;
    }

    for (const m of missing) {
      if (m.format === "docx") summary.missingDocx++;
      else summary.missingPdf++;
      if (m.scope === "current") summary.missingCurrent++;
      else summary.missingPrior++;

      if (bunnyIndex) {
        const hit = lookupBunnyVersionFile(
          bunnyIndex,
          m.fileIdentifier,
          slotLanguage(m.lang),
          m.format,
        );
        m.inBunny = Boolean(hit);
        if (hit) {
          m.bunnyUrl = hit.fileUrl;
          summary.relinkableFromBunny++;
        } else {
          summary.notInBunny++;
        }
      }
    }

    incompleteSops.push({
      identifier: sop.identifier,
      department: sop.department,
      language: sop.language,
      currentVersion: sop.version,
      missing,
    });
  }

  // Worst offenders first: most missing files at the top.
  incompleteSops.sort((a, b) => b.missing.length - a.missing.length);

  return {
    bunnyConfigured,
    bunnyChecked: Boolean(bunnyIndex),
    totalActive: scoped.length,
    versionComplete,
    versionIncomplete: incompleteSops.length,
    summary,
    incompleteSops,
  };
}
