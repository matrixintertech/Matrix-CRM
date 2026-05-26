import { NextResponse } from "next/server";

import { getNavigationForSession } from "@/features/navigation/services/navigation.service";
import { failure } from "@/lib/http/api-response";
import { getCurrentSession } from "@/lib/auth/session";

export async function GET() {
  const session = await getCurrentSession();

  if (!session?.user?.id) {
    return NextResponse.json(failure("UNAUTHORIZED", "Authentication required."), { status: 401 });
  }

  const navigation = await getNavigationForSession(session);
  return NextResponse.json({ ok: true, data: navigation });
}
