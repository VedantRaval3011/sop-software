"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileText,
  Calendar,
  Database,
} from "lucide-react";

export default function SOPComplianceSyncPage() {
  useAuthGuard();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{
    updated: number;
    skipped: number;
    errors: number;
  } | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.toLowerCase().endsWith(".docx")) {
          formData.append("files", file);
        }
      }

      const response = await fetch("/api/sop-compliance-sync/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setResult({
          updated: data.updated,
          skipped: data.skipped,
          errors: data.errors,
        });
        setTimeout(() => router.push("/dashboard"), 3000);
      } else {
        alert(`Upload failed: ${data.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("Upload failed. Check the console for details.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/dashboard" className="text-sm text-purple-200 hover:text-white">
            ← Back to Dashboard
          </Link>
        </div>

        <div className="mb-8 flex items-center gap-4">
          <div className="rounded-2xl bg-gradient-to-br from-green-600 to-emerald-600 p-4 shadow-lg">
            <Database className="h-10 w-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">SOP Compliance Date Sync</h1>
            <p className="mt-1 text-purple-200">
              Upload department DOCX tables to update effective and review dates
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur">
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="text-sm text-amber-100">
              <p className="font-semibold">Expected table format</p>
              <p className="mt-1 text-amber-200/80">
                Sr. No. | SOP Subject | SOP No. | Version No. | Effective Date | Review Date
              </p>
            </div>
          </div>

          <label className="flex cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed border-purple-400/40 bg-purple-500/10 p-12 transition hover:border-purple-300/60 hover:bg-purple-500/20">
            {uploading ? (
              <Loader2 className="h-12 w-12 animate-spin text-purple-300" />
            ) : (
              <Upload className="h-12 w-12 text-purple-300" />
            )}
            <div className="text-center">
              <p className="text-lg font-semibold text-white">
                {uploading ? "Processing files…" : "Click to upload DOCX files"}
              </p>
              <p className="mt-1 text-sm text-purple-300">One or more department files (e.g. 1. QA.docx)</p>
            </div>
            <input
              type="file"
              accept=".docx"
              multiple
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>

          {result && (
            <div className="mt-6 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-6">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                <p className="font-semibold text-emerald-100">Sync complete</p>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-white">{result.updated}</p>
                  <p className="text-xs text-emerald-300">Updated</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{result.skipped}</p>
                  <p className="text-xs text-amber-300">Skipped</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-white">{result.errors}</p>
                  <p className="text-xs text-red-300">Errors</p>
                </div>
              </div>
              <p className="mt-4 text-center text-sm text-purple-200">
                Redirecting to dashboard…
              </p>
            </div>
          )}

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg bg-white/5 p-4">
              <FileText className="mb-2 h-5 w-5 text-purple-300" />
              <p className="text-sm font-medium text-white">DOCX tables</p>
              <p className="text-xs text-purple-300">Parses Word table cells</p>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <Calendar className="mb-2 h-5 w-5 text-purple-300" />
              <p className="text-sm font-medium text-white">Date fields</p>
              <p className="text-xs text-purple-300">DD/MM/YYYY format</p>
            </div>
            <div className="rounded-lg bg-white/5 p-4">
              <Database className="mb-2 h-5 w-5 text-purple-300" />
              <p className="text-sm font-medium text-white">SOP registry</p>
              <p className="text-xs text-purple-300">Matches by SOP number</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
