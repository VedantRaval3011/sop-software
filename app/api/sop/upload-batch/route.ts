import { NextRequest } from "next/server";
import { processSopUpload } from "@/lib/sop-upload";
import { requireAuth } from "@/lib/withAuth";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireAuth(["admin", "trainer"]);
  if (auth.error) return auth.error;
  const formData = await request.formData();
  return processSopUpload(formData);
}
