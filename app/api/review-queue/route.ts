import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { notifications, queryLog } from "@/lib/db/schema";
import { usernameFrom } from "@/lib/auth/user";
import { appendMessage, titleFromText } from "@/lib/db/sessions";

export const runtime = "nodejs";

// The Review Queue: escalated Q&A from signed-in users, persisted in the shared
// cloud DB (query_log) and visible to every user, newest-first. Only rows with a
// username are shown — an escalation can only be answered-and-returned when
// there's a person + session to route the answer back to.
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ items: [], dbReady: false });
  }
  try {
    const items = await db
      .select({
        id: queryLog.id,
        question: queryLog.question,
        escalationReason: queryLog.escalationReason,
        confidence: queryLog.confidence,
        taxType: queryLog.taxType,
        username: queryLog.username,
        createdAt: queryLog.createdAt,
      })
      .from(queryLog)
      .where(and(eq(queryLog.status, "escalate"), isNotNull(queryLog.username)))
      .orderBy(desc(queryLog.createdAt))
      .limit(200);
    return NextResponse.json({ items, dbReady: true });
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to load the review queue.";
    return NextResponse.json({ error: message, items: [], dbReady: true }, { status: 500 });
  }
}

// Answer a queued question and send it back to the asker. Any signed-in user may
// do this (no role gate for now). The answer is appended to the asker's original
// session as a 'reviewer' message, the escalation is marked resolved, and a
// notification is created so the asker is pinged.
//   POST { id: number, answer: string }
export async function POST(req: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }
  const reviewer = usernameFrom(req);
  if (!reviewer) {
    return NextResponse.json(
      { error: "Choose a username to answer questions in the queue." },
      { status: 401 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const id = Number(body?.id);
  const answer = typeof body?.answer === "string" ? body.answer.trim() : "";
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Missing question id." }, { status: 400 });
  }
  if (!answer) {
    return NextResponse.json({ error: "Write an answer before sending." }, { status: 400 });
  }

  try {
    const [row] = await db
      .select({
        id: queryLog.id,
        question: queryLog.question,
        username: queryLog.username,
        sessionId: queryLog.sessionId,
        status: queryLog.status,
      })
      .from(queryLog)
      .where(eq(queryLog.id, id))
      .limit(1);

    if (!row) return NextResponse.json({ error: "Question not found." }, { status: 404 });
    if (row.status !== "escalate") {
      return NextResponse.json({ error: "Already answered." }, { status: 409 });
    }
    if (!row.username || !row.sessionId) {
      return NextResponse.json(
        { error: "This question has no session to send an answer back to." },
        { status: 400 },
      );
    }

    // Drop the human answer into the asker's original thread.
    const messageId = await appendMessage(row.sessionId, "reviewer", answer, {
      reviewedBy: reviewer,
    });

    // Resolve the escalation so it leaves the queue.
    await db
      .update(queryLog)
      .set({
        status: "resolved",
        reviewerAnswer: answer,
        reviewedBy: reviewer,
        reviewedAt: new Date(),
      })
      .where(eq(queryLog.id, id));

    // Ping the asker.
    await db.insert(notifications).values({
      username: row.username,
      sessionId: row.sessionId,
      messageId,
      queryLogId: id,
      title: titleFromText(row.question),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send the answer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Delete escalations from the queue. Any user may do this (open demo, no role
// gate). Scoped to status = 'escalate'
// so it can ONLY remove queue items, never answered Q&A history.
//   DELETE /api/review-queue?id=123  → remove one escalation
//   DELETE /api/review-queue?all=1   → clear the entire queue
export async function DELETE(req: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "No database configured." }, { status: 503 });
  }
  const params = new URL(req.url).searchParams;
  const all = params.get("all");

  try {
    if (all === "1" || all === "true") {
      const deleted = await db
        .delete(queryLog)
        .where(eq(queryLog.status, "escalate"))
        .returning({ id: queryLog.id });
      return NextResponse.json({ ok: true, deleted: deleted.length });
    }

    const id = Number(params.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { error: "Pass ?id=<n> to delete one escalation, or ?all=1 to clear the queue." },
        { status: 400 },
      );
    }
    const deleted = await db
      .delete(queryLog)
      .where(and(eq(queryLog.id, id), eq(queryLog.status, "escalate")))
      .returning({ id: queryLog.id });
    if (deleted.length === 0) {
      return NextResponse.json({ error: "Not found (already removed?)." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, deleted: deleted.length });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to delete.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
