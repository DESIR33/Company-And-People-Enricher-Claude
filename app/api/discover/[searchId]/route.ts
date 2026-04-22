import { NextRequest, NextResponse } from "next/server";
import {
  getSearch,
  getSearchAbort,
  listLeadsBySearch,
  updateSearch,
} from "@/lib/discovery-store";

type RouteContext = { params: Promise<{ searchId: string }> };

export async function GET(_request: NextRequest, ctx: RouteContext) {
  const { searchId } = await ctx.params;
  const search = getSearch(searchId);
  if (!search) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }
  const leads = listLeadsBySearch(searchId);
  return NextResponse.json({ search, leads });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext) {
  const { searchId } = await ctx.params;
  const search = getSearch(searchId);
  if (!search) {
    return NextResponse.json({ error: "Search not found" }, { status: 404 });
  }
  if (search.status === "running" || search.status === "queued") {
    getSearchAbort(searchId)?.abort();
    updateSearch(searchId, { status: "cancelled", completedAt: Date.now() });
  }
  return NextResponse.json({ ok: true });
}
