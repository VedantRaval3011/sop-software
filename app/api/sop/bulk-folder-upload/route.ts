import { NextRequest } from "next/server";
import { processSopUpload } from "@/lib/sop-upload";
import { requireAuth } from "@/lib/withAuth";

export const maxDuration = 300;

const SKIP_PATTERN = /annexure|appendix|cover\s*page|index/i;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;

  const formData = await request.formData();
  const files = formData.getAll("files") as File[];
  const filtered = files.filter((f) => !SKIP_PATTERN.test(f.name));

  const nextForm = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key !== "files") nextForm.append(key, value);
  }
  for (const file of filtered) nextForm.append("files", file);

  return processSopUpload(nextForm);
}
