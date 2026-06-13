"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, X } from "lucide-react";
import {
  buildOfficeOnlineEmbedUrl,
  buildPreviewHref,
  isOfficePreviewAvailable,
} from "@/lib/file-urls";

export function DocPreviewModal({
  filePath,
  label,
  isPdf,
  onClose,
}: {
  filePath: string;
  label: string;
  isPdf: boolean;
  onClose: () => void;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const previewSrc = `/api/sops/preview?path=${encodeURIComponent(filePath)}&type=pdf`;
  const officeEmbedSrc = !isPdf ? buildOfficeOnlineEmbedUrl(filePath, origin) : null;
  const officeAvailable = !isPdf && isOfficePreviewAvailable(filePath, origin);
  const downloadHref = buildPreviewHref(filePath);
  const [iframeLoading, setIframeLoading] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setIframeLoading(true);
  }, [officeEmbedSrc, previewSrc]);

  const modal = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        style={{ height: "min(90vh, 900px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-2">
          <span className="truncate text-sm font-semibold text-gray-800">{label}</span>
          <div className="flex items-center gap-2">
            <a
              href={downloadHref}
              download
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="h-3 w-3" />
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
              title="Close preview"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-white">
          {!isPdf && !officeAvailable ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-gray-600">
              <p>Office Online preview needs a public file URL.</p>
              <p className="text-xs text-gray-500">
                On localhost, use Download or deploy the app so Microsoft can reach the file.
              </p>
              <a
                href={downloadHref}
                download
                className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                <Download className="h-3.5 w-3.5" />
                Download file
              </a>
            </div>
          ) : (
            <>
              {iframeLoading && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white text-sm text-gray-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading preview…
                </div>
              )}
              <iframe
                src={isPdf ? previewSrc : officeEmbedSrc!}
                className="absolute inset-0 h-full w-full border-0"
                title={`Preview: ${label}`}
                allowFullScreen
                onLoad={() => setIframeLoading(false)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
