import { NextResponse } from "next/server";

import { getServicePartnerDocumentDownload } from "@/features/service-partners/services/service-partner.service";
import { getCurrentSession } from "@/lib/auth/session";

function isInlineMimeType(mimeType: string) {
  return mimeType.startsWith("image/") || mimeType === "application/pdf";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getCurrentSession();
  if (!session?.user?.id || !session.user.servicePartnerId) {
    return NextResponse.json({ ok: false, error: { message: "Authentication required." } }, { status: 401 });
  }

  const { id } = await params;

  try {
    const file = await getServicePartnerDocumentDownload(session as never, id);
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `${isInlineMimeType(file.mimeType) ? "inline" : "attachment"}; filename="${file.fileName}"`,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.toLowerCase().includes("permission")) {
        return NextResponse.json({ ok: false, error: { message: "Document permission denied." } }, { status: 403 });
      }
      if (error.message.toLowerCase().includes("not found")) {
        return NextResponse.json({ ok: false, error: { message: "Document not found." } }, { status: 404 });
      }
    }

    throw error;
  }
}
