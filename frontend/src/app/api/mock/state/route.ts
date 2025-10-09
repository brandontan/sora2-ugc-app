import { NextResponse, type NextRequest } from "next/server";
import { ledgerForUser, jobsForUser } from "@/lib/mock-store";

export async function GET(request: NextRequest) {
  if (process.env.MOCK_API !== "true") {
    return NextResponse.json(
      { error: { message: "Mock API disabled." } },
      { status: 404 },
    );
  }

  const userId =
    request.nextUrl.searchParams.get("user_id") ?? "mock-user";

  const ledger = ledgerForUser(userId);
  const jobs = jobsForUser(userId);

  return NextResponse.json({
    userId,
    ledger,
    jobs,
  });
}
