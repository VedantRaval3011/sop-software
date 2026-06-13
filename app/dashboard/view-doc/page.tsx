'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { useEffect, Suspense } from 'react';
import Link from 'next/link';
import DocxPreviewClient, { type DocxViewerPreference } from '../components/DocxPreviewClient';
import PdfPreviewClient from '../components/PdfPreviewClient';

function pathLooksPdf(p: string | null): boolean {
  if (!p) return false;
  const base = p.trim().split(/[?#]/)[0].toLowerCase();
  return base.endsWith('.pdf');
}

/** Side-by-side EN+GUJ preview removed — redirect to single-language view (English default). */
function DualLegacyRedirect({ identifier }: { identifier: string }) {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/dashboard/view-doc?identifier=${encodeURIComponent(identifier)}`);
  }, [identifier, router]);
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-100 p-6">
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      <p className="text-center text-sm text-gray-600">
        Opening document preview… Use the <strong>English</strong> or <strong>Gujarati</strong> DOCX/PDF link from the registry
        for the language you need.
      </p>
      <Link href="/dashboard" className="text-sm font-semibold text-purple-600 hover:underline">
        ← Back to Dashboard
      </Link>
    </div>
  );
}

function SingleDocView() {
  const searchParams = useSearchParams();
  const pathParam = searchParams.get('path');
  const identifierParam = searchParams.get('identifier');
  const languageParam = searchParams.get('language');
  const v = (searchParams.get('viewer') || '').toLowerCase();
  const viewerPreference: DocxViewerPreference = v === 'google' ? 'google' : 'office';

  if (pathParam && pathLooksPdf(pathParam)) {
    return (
      <PdfPreviewClient
        pathParam={pathParam}
        identifierParam={identifierParam}
        languageParam={languageParam}
      />
    );
  }

  return (
    <DocxPreviewClient
      pathParam={pathParam}
      identifierParam={identifierParam}
      languageParam={languageParam}
      viewerPreference={viewerPreference}
    />
  );
}

function ViewDocContent() {
  const searchParams = useSearchParams();
  const dual = searchParams.get('dual') === '1';
  const identifier = searchParams.get('identifier')?.trim();

  if (dual) {
    if (!identifier) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
          <div className="max-w-md text-center text-sm text-gray-600">
            Add <code className="rounded bg-gray-200 px-1">identifier</code> to open a document, or use DOCX/PDF links from the
            registry.
            <Link href="/dashboard" className="mt-4 block font-semibold text-purple-600 hover:underline">
              ← Back to Dashboard
            </Link>
          </div>
        </div>
      );
    }
    return <DualLegacyRedirect identifier={identifier} />;
  }

  return <SingleDocView />;
}

export default function ViewDocPage() {
  useAuthGuard();
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-gray-100">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      }
    >
      <ViewDocContent />
    </Suspense>
  );
}