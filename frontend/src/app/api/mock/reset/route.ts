import { NextResponse } from "next/server";
import { resetMockStore } from "@/lib/mock-store";

export async function POST() {
  if (process.env.MOCK_API !== "true") {
    return NextResponse.json(
      { error: { message: "Mock API disabled." } },
      { status: 404 },
    );
  }

  resetMockStore();
  return NextResponse.json({ ok: true });
}
