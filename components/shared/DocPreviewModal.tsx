"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
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

  // Drag-to-move the modal: grab the header and the panel follows the pointer
  // (free reposition, no placeholder, no blur). Pointer events + pointer capture
  // give one code path for mouse/touch/pen across browsers and keep the drag
  // smooth even when the pointer passes over the preview iframe or the page
  // behind (the iframe would otherwise swallow window-level move events).
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number; startY: number; baseX: number; baseY: number;
    naturalLeft: number; naturalTop: number; width: number; height: number;
  } | null>(null);

  // Clamp a translate offset so the panel stays fully inside the viewport.
  // `natural` is the panel's position when offset is 0 (it's centred via flex).
  const clampAxis = (value: number, natural: number, size: number, viewport: number) => {
    const min = -natural;
    const max = viewport - natural - size;
    if (max < min) return min; // panel larger than viewport: pin to top/left edge
    return Math.min(Math.max(value, min), max);
  };

  const handleHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Let the download link / close button work normally.
    if ((e.target as HTMLElement).closest("button, a, input")) return;
    const el = modalRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      baseX: pos.x, baseY: pos.y,
      naturalLeft: rect.left - pos.x,
      naturalTop: rect.top - pos.y,
      width: rect.width, height: rect.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const handleHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const nextX = clampAxis(d.baseX + (e.clientX - d.startX), d.naturalLeft, d.width, window.innerWidth);
    const nextY = clampAxis(d.baseY + (e.clientY - d.startY), d.naturalTop, d.height, window.innerHeight);
    setPos({ x: nextX, y: nextY });
  };
  const handleHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  // Keep the panel on-screen if the window is resized after it was moved.
  useEffect(() => {
    const onResize = () =>
      setPos((p) => {
        const el = modalRef.current;
        if (!el) return p;
        const rect = el.getBoundingClientRect();
        const naturalLeft = rect.left - p.x;
        const naturalTop = rect.top - p.y;
        return {
          x: clampAxis(p.x, naturalLeft, rect.width, window.innerWidth),
          y: clampAxis(p.y, naturalTop, rect.height, window.innerHeight),
        };
      });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    setIframeLoading(true);
  }, [officeEmbedSrc, previewSrc]);

  const modal = (
    // No dimming/click-catching backdrop: the layer ignores pointer events
    // (pointer-events-none) so the page behind stays visible and interactive
    // while the preview is open. Close via the X button or Escape.
    <div className="pointer-events-none fixed inset-0 z-100 flex items-center justify-center p-4">
      <div
        ref={modalRef}
        className="pointer-events-auto flex w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        style={{ height: "min(90vh, 900px)", transform: `translate(${pos.x}px, ${pos.y}px)` }}
      >
        <div
          className="flex shrink-0 cursor-grab touch-none select-none items-center justify-between border-b border-gray-200 px-4 py-2 active:cursor-grabbing"
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
          onPointerCancel={handleHeaderPointerUp}
        >
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
