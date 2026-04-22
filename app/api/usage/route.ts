import { NextResponse } from "next/server";
import { capStatus, getCurrentUsage, listUsage } from "@/lib/usage-store";

export async function GET() {
  const current = getCurrentUsage();
  return NextResponse.json({
    current,
    history: listUsage(12),
    caps: capStatus(current),
  });
}
