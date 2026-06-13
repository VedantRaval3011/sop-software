'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Download, Loader2, ExternalLink } from 'lucide-react';
import { buildOfficeOnlineEmbedUrl, buildPublicFileUrl, isOfficePreviewAvailable } from '@/lib/file-urls';
import { buildDocxDownloadHref, buildPdfDownloadHref } from '@/lib/viewDocLinks';

function ViewDocContent() {
  const params = useSearchParams();
  const path = params.get('path') ?? '';
  const identifier = params.get('identifier') ?? '';
  const language = params.get('language') ?? '';
  const [iframeLoading, setIframeLoading] = useState(true);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const isPdf = path.toLowerCase().endsWith('.pdf');
  const isDocx = path.toLowerCase().endsWith('.docx') || path.toLowerCase().endsWith('.doc');

  const publicFileUrl = buildPublicFileUrl(path, origin);
  const officeEmbedSrc = isDocx ? buildOfficeOnlineEmbedUrl(path, origin) : null;
  const officeAvailable = isDocx && isOfficePreviewAvailable(path, origin);
  const pdfSrc = isPdf ? `/api/sops/file?path=${encodeURIComponent(path)}` : null;

  const downloadHref = isDocx
    ? (buildDocxDownloadHref(path, identifier || null, language || null) ?? publicFileUrl)
    : buildPdfDownloadHref(path, identifier || undefined, language || undefined);

  const title = [identifier, language].filter(Boolean).join(' — ') || 'Document Preview';

  if (!path) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-500">
        No document path provided.
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-2 shadow-sm">
        <span className="truncate text-sm font-semibold text-gray-800">{title}</span>
        <div className="flex items-center gap-2">
          {isDocx && officeEmbedSrc && (
            <a
              href={officeEmbedSrc}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
            >
              <ExternalLink className="h-3 w-3" />
              Office Online
            </a>
          )}
          <a
            href={downloadHref}
            download
            className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="h-3 w-3" />
            Download
          </a>
        </div>
      </div>

      {/* Viewer */}
      <div className="relative min-h-0 flex-1 bg-gray-100">
        {isDocx && !officeAvailable && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-sm text-gray-600">
            <p className="font-medium">Office Online preview requires a public URL.</p>
            <p className="text-xs text-gray-500">
              On localhost, Microsoft cannot reach the file server. Download the file or deploy the
              app to preview it online.
            </p>
            <a
              href={downloadHref}
              download
              className="inline-flex items-center gap-1.5 rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Download className="h-3.5 w-3.5" />
              Download file
            </a>
          </div>
        )}

        {(isPdf || (isDocx && officeAvailable)) && (
          <>
            {iframeLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-white text-sm text-gray-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Loading preview…
              </div>
            )}
            <iframe
              src={isPdf ? pdfSrc! : officeEmbedSrc!}
              className="absolute inset-0 h-full w-full border-0"
              title={title}
              allowFullScreen
              onLoad={() => setIframeLoading(false)}
            />
          </>
        )}

        {!isPdf && !isDocx && (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            Unsupported file type. <a href={publicFileUrl} className="ml-1 text-blue-600 underline">Open directly</a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ViewDocPage() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading…
      </div>
    }>
      <ViewDocContent />
    </Suspense>
  );
}
