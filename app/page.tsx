"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./_components/sidebar";
import { PlannedModules } from "./_components/planned-modules";
import { Markdown } from "./_components/markdown";
import { UsernameGate } from "./_components/username-gate";
import { NotificationBell } from "./_components/notification-bell";
import {
  CONF_MAP,
  SAMPLE_INVOICE,
  SERIF,
  SESSION_HISTORY_ENABLED,
  filterToTaxType,
  resolveSample,
  type AnswerResult,
  type Determination,
  type InvoiceFieldsData,
  type Message,
  type ModuleKey,
  type NotificationItem,
  type SessionSummary,
  type TaxFilter,
} from "./_lib/lex-data";
import { DeterminationCard, InvoiceFieldsCard, Spinner } from "./_components/invoice-cards";

// Map a persisted session's rows back into the thread's Message shape.
function rowsToMessages(
  rows: { id: number; role: string; content: string; data: unknown }[],
): Message[] {
  return rows.map((r) => {
    const data = (r.data ?? {}) as Record<string, unknown>;
    if (r.role === "assistant") {
      // A persisted inline invoice check reloads as a completed invoice card.
      if (data.type === "invoice") {
        return {
          role: "invoice",
          fileName: typeof data.fileName === "string" ? data.fileName : "invoice",
          phase: "done",
          fields: data.fields as InvoiceFieldsData | undefined,
          det: data.det as Determination | undefined,
        };
      }
      return { role: "assistant", resp: r.data as AnswerResult, showReasoning: false };
    }
    if (r.role === "reviewer") {
      return {
        role: "reviewer",
        text: r.content,
        from: typeof data.reviewedBy === "string" ? data.reviewedBy : undefined,
        messageId: r.id,
      };
    }
    const files = Array.isArray(data.files) ? (data.files as string[]) : undefined;
    return { role: "user", text: r.content, files: files?.length ? files : undefined };
  });
}

export default function Workspace() {
  const [module, setModule] = useState<ModuleKey>("ask");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<TaxFilter>("All");
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("Reviewing FTA law");
  const [files, setFiles] = useState<File[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // Identity + saved history.
  const [username, setUsername] = useState<string | null>(null);
  // The username picker opens only on request (sidebar / Review Queue), never
  // on first visit — visitors land straight in the chat as guests.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);

  const threadRef = useRef<HTMLDivElement>(null);

  // Bootstrap identity: restore a previously chosen username, if any.
  useEffect(() => {
    let active = true;
    fetch("/api/user")
      .then((r) => r.json())
      .then((d) => {
        if (active) setUsername(d.username ?? null);
      })
      .catch(() => {}); // stay a guest — never block the app
    return () => {
      active = false;
    };
  }, []);

  const refreshSessions = useCallback(() => {
    if (!SESSION_HISTORY_ENABLED) return; // archive hidden — nothing to list
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {});
  }, []);

  // Load history when a username is present. Guests keep the empty initial list;
  // switchUser() clears it explicitly, so no synchronous reset is needed here.
  useEffect(() => {
    if (username) refreshSessions();
  }, [username, refreshSessions]);

  // Keep the thread pinned to the latest message, like the comp.
  useEffect(() => {
    if (module === "ask" && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, loading, module]);

  // Window-level drag-and-drop: dragging files anywhere over the app raises a
  // drop overlay; dropping stages them in the composer (and jumps to Ask if
  // another module is open). A depth counter ignores child enter/leave churn.
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragActive(true);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // required, or the browser opens the file
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragActive(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragActive(false);
      const dropped = e.dataTransfer?.files;
      if (dropped?.length) {
        setFiles((prev) => mergeFiles(prev, Array.from(dropped)));
        setModule("ask");
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  async function send(text: string, filterOverride?: TaxFilter) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    const effFilter = filterOverride ?? filter;
    const attached = files;

    setQ("");
    setFiles([]);
    if (filterOverride) setFilter(filterOverride);
    setMessages((m) => [
      ...m,
      {
        role: "user",
        text: trimmed,
        files: attached.length ? attached.map((f) => f.name) : undefined,
      },
    ]);
    setLoadingLabel(attached.length ? "Reading your document" : "Reviewing FTA law");
    setLoading(true);

    let resp: AnswerResult;
    try {
      const taxType = filterToTaxType(effFilter);
      let res: Response;
      if (attached.length) {
        // With attachments we send multipart so the files ride along; the server
        // extracts their text and uses it as extra context.
        const fd = new FormData();
        fd.append("question", trimmed);
        if (taxType) fd.append("taxType", taxType);
        if (activeSessionId) fd.append("sessionId", String(activeSessionId));
        attached.forEach((f) => fd.append("files", f));
        res = await fetch("/api/chat", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, taxType, sessionId: activeSessionId }),
        });
      }
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error ?? "Request failed");
      resp = data as AnswerResult;
      // The server persists the turn for signed-in users and returns the session
      // it saved to; track it so follow-ups append, and refresh the sidebar.
      if (typeof data.sessionId === "number") {
        setActiveSessionId(data.sessionId);
        refreshSessions();
      }
    } catch (err) {
      if (attached.length) {
        // For a document question, a canned sample would be nonsense — surface
        // the real problem (e.g. a scanned PDF) as a clear escalation instead.
        resp = {
          status: "escalate",
          answer: "",
          reasoning: "",
          citations: [],
          confidence: "low",
          flaggedPremise: null,
          escalationReason:
            (err as Error)?.message || "I couldn't read the attached file. Please try another copy.",
        };
      } else {
        // Offline / unconfigured backend: fall back to the canned sample matcher
        // so the workspace stays demonstrable on its own.
        resp = resolveSample(trimmed);
      }
    }

    setMessages((m) => [...m, { role: "assistant", resp, showReasoning: false }]);
    setLoading(false);
  }

  function ask() {
    void send(q);
  }

  function toggleMsg(idx: number) {
    setMessages((m) =>
      m.map((msg, i) =>
        i === idx && msg.role === "assistant"
          ? { ...msg, showReasoning: !msg.showReasoning }
          : msg,
      ),
    );
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask();
    }
  }

  // ── Inline invoice VAT checks (the merged Ask+Invoice workspace) ──────────
  const [invoiceBusy, setInvoiceBusy] = useState(false);

  // Monotonic client-side key so in-flight cards can be updated in place
  // regardless of React's update batching.
  const invoiceUid = useRef(0);

  function patchInvoiceMsg(uid: number, patch: Partial<Extract<Message, { role: "invoice" }>>) {
    setMessages((prev) =>
      prev.map((m) => (m.role === "invoice" && m.uid === uid ? { ...m, ...patch } : m)),
    );
  }

  async function checkOneInvoice(file: File) {
    const uid = ++invoiceUid.current;
    setMessages((m) => [
      ...m,
      { role: "user", text: `VAT check: ${file.name}`, files: [file.name] },
      { role: "invoice", uid, fileName: file.name, phase: "extracting" },
    ]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/invoice/extract", {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(70_000),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error ?? "Extraction failed");
      patchInvoiceMsg(uid, { phase: "review", fields: data as InvoiceFieldsData });
    } catch (e) {
      patchInvoiceMsg(uid, {
        phase: "error",
        error:
          (e as Error)?.message || "I couldn't read that file. Please try another copy.",
      });
    }
  }

  // "Check VAT" on the staged files: each becomes its own card, sequentially
  // (spaced to stay under free-tier per-minute limits).
  async function runInvoiceChecks() {
    const staged = files;
    if (!staged.length || loading || invoiceBusy) return;
    setFiles([]);
    setInvoiceBusy(true);
    try {
      for (let i = 0; i < staged.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 2500));
        await checkOneInvoice(staged[i]);
      }
    } finally {
      setInvoiceBusy(false);
    }
  }

  // Confirm & run: the fields card's button. Persists to the session so the
  // check reloads with history and follow-up questions can reference it.
  async function runDetermination(target: Extract<Message, { role: "invoice" }>) {
    if (target.uid == null || !target.fields) return;
    patchInvoiceMsg(target.uid, { phase: "determining", error: undefined });
    setInvoiceBusy(true);
    try {
      const res = await fetch("/api/invoice/determine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: target.fields,
          fileName: target.fileName,
          sessionId: activeSessionId,
        }),
        signal: AbortSignal.timeout(75_000),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error ?? "Determination failed");
      patchInvoiceMsg(target.uid, { phase: "done", det: data as Determination });
      if (typeof data.sessionId === "number") {
        setActiveSessionId(data.sessionId);
        refreshSessions();
      }
    } catch (e) {
      // Keep the editable card so the user can retry — don't lose their edits.
      patchInvoiceMsg(target.uid, {
        phase: "review",
        error: (e as Error)?.message || "The check failed — please try again.",
      });
    } finally {
      setInvoiceBusy(false);
    }
  }

  function editInvoiceField(target: Extract<Message, { role: "invoice" }>) {
    return <K extends keyof InvoiceFieldsData>(k: K, v: InvoiceFieldsData[K]) => {
      if (target.uid == null || !target.fields) return;
      patchInvoiceMsg(target.uid, { fields: { ...target.fields, [k]: v } });
    };
  }

  // Demo: a canned invoice + determination, no upload or model call.
  function loadSampleInvoice() {
    setMessages((m) => [
      ...m,
      { role: "user", text: "VAT check: sample_invoice.pdf (demo)", files: ["sample_invoice.pdf"] },
      {
        role: "invoice",
        fileName: "sample_invoice.pdf",
        phase: "done",
        fields: SAMPLE_INVOICE.fields,
        det: SAMPLE_INVOICE.determination,
      },
    ]);
  }

  function go(key: ModuleKey) {
    setModule(key);
  }

  function newChat() {
    setModule("ask");
    setMessages([]);
    setQ("");
    setFiles([]);
    setActiveSessionId(null);
  }

  // Load a saved thread into the Ask view — including any reviewer answer that
  // was sent back into it.
  async function loadSession(id: number) {
    setModule("ask");
    setQ("");
    setFiles([]);
    try {
      const res = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMessages(rowsToMessages(data.messages ?? []));
      setActiveSessionId(id);
    } catch {
      /* session may have been deleted — ignore */
    }
  }

  async function deleteSession(id: number) {
    if (!window.confirm("Delete this chat? This can’t be undone.")) return;
    if (activeSessionId === id) newChat();
    setSessions((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    } catch {
      refreshSessions();
    }
  }

  // Clicking a notification opens the session the answer landed in.
  function openNotification(n: NotificationItem) {
    void loadSession(n.sessionId);
  }

  async function switchUser() {
    try {
      await fetch("/api/user", { method: "DELETE" });
    } catch {
      /* ignore */
    }
    setUsername(null);
    setSessions([]);
    setActiveSessionId(null);
    setMessages([]);
    setPickerOpen(true);
  }

  const empty = messages.length === 0 && !loading;

  const composerEl = (
    <Composer
      q={q}
      loading={loading || invoiceBusy}
      files={files}
      onQ={setQ}
      onFiles={setFiles}
      onKeyDown={onKeyDown}
      onAsk={ask}
      onCheckVat={runInvoiceChecks}
    />
  );

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        background: "#fff",
        color: "#1a1a1a",
        overflow: "hidden",
      }}
    >
      <Sidebar
        module={module}
        onNavigate={go}
        onNewChat={newChat}
        username={username}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onLoadSession={loadSession}
        onDeleteSession={deleteSession}
        onSwitchUser={switchUser}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* top bar — notification bell (signed-in users only) */}
        <div
          style={{
            flex: "none",
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "10px 16px 0",
            minHeight: 20,
          }}
        >
          {SESSION_HISTORY_ENABLED && (
            <NotificationBell username={username} onOpen={openNotification} />
          )}
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {module === "ask" ? (
            empty ? (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "24px 0 52px",
                }}
              >
                <h1
                  style={{
                    fontFamily: SERIF,
                    fontSize: 30,
                    fontWeight: 600,
                    letterSpacing: "-.01em",
                    textAlign: "center",
                    margin: "0 0 22px",
                    padding: "0 24px",
                  }}
                >
                  How can I help with UAE tax?
                </h1>
                {composerEl}
                <button
                  onClick={loadSampleInvoice}
                  style={{
                    marginTop: 16,
                    border: "1px solid #e6e6e2",
                    borderRadius: 99,
                    background: "#fff",
                    color: "#5a564d",
                    fontSize: 12.5,
                    fontWeight: 500,
                    padding: "7px 16px",
                    cursor: "pointer",
                  }}
                >
                  🧾 Try a sample invoice (demo)
                </button>
                <div style={{ fontSize: 11, color: "#cbcbc4", marginTop: 14, textAlign: "center" }}>
                  Ask a question, or attach an invoice and run a VAT check — all in one thread.
                  Decision-support only — a human reviews before use.
                </div>
              </div>
            ) : (
              <>
                <div
                  className="lex-scroll lex-thread"
                  ref={threadRef}
                  style={{ flex: 1, overflowY: "auto" }}
                >
                  <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px 14px" }}>
                    {messages.map((m, i) =>
                      m.role === "user" ? (
                        <UserMessage key={i} text={m.text} files={m.files} first={i === 0} />
                      ) : m.role === "reviewer" ? (
                        <ReviewerMessage key={i} text={m.text} from={m.from} />
                      ) : m.role === "invoice" ? (
                        <InvoiceCheckMessage
                          key={m.uid ?? `h${i}`}
                          msg={m}
                          onField={m.phase === "review" ? editInvoiceField(m) : undefined}
                          onRun={m.phase === "review" ? () => runDetermination(m) : undefined}
                        />
                      ) : (
                        <AssistantMessage
                          key={i}
                          resp={m.resp}
                          showReasoning={m.showReasoning}
                          onToggle={() => toggleMsg(i)}
                        />
                      ),
                    )}

                    {loading && <TypingIndicator label={loadingLabel} />}
                  </div>
                </div>

                <div style={{ flex: "none", padding: "6px 0 14px" }}>
                  {composerEl}
                  <div
                    style={{
                      fontSize: 11,
                      color: "#b4b4ae",
                      marginTop: 9,
                      textAlign: "center",
                    }}
                  >
                    Decision-support only — a human reviews before use.
                  </div>
                </div>
              </>
            )
          ) : (
            <PlannedModules module={module} hasUsername={!!username} onChooseUsername={switchUser} />
          )}
        </div>
      </div>

      {pickerOpen && (
        <UsernameGate
          onChosen={(u) => {
            setUsername(u);
            setPickerOpen(false);
          }}
        />
      )}

      {dragActive && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(255,255,255,0.78)",
            backdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "lexfade .15s ease both",
          }}
        >
          <div
            style={{
              border: "2px dashed #b9b9b2",
              borderRadius: 22,
              background: "#fff",
              boxShadow: "0 14px 52px rgba(0,0,0,0.13)",
              padding: "44px 60px",
              textAlign: "center",
              animation: "lexdroppop .2s ease both",
            }}
          >
            <div style={{ fontSize: 36, lineHeight: 1, marginBottom: 12 }}>📄</div>
            <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 600 }}>
              Drop files to attach
            </div>
            <div style={{ fontSize: 13, color: "#9a9a93", marginTop: 7, lineHeight: 1.5 }}>
              PDF, image, Excel, CSV or Word — then ask about them
              <br />
              or run an invoice VAT check.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ask thread pieces ────────────────────────────────────────────────────────

function UserMessage({
  text,
  files,
  first,
}: {
  text: string;
  files?: string[];
  first: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        margin: first ? "0 0 4px" : "26px 0 4px",
        animation: "lexrise .3s ease both",
      }}
    >
      {files && files.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            justifyContent: "flex-end",
            maxWidth: "80%",
            marginBottom: 6,
          }}
        >
          {files.map((name, i) => (
            <span
              key={i}
              title={name}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                maxWidth: 220,
                background: "#fff",
                border: "1px solid #e6e6e2",
                borderRadius: 10,
                padding: "5px 10px",
                fontSize: 12,
                color: "#5a564d",
              }}
            >
              <span style={{ flex: "none" }}>📄</span>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {name}
              </span>
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          maxWidth: "80%",
          background: "#f3f2ee",
          borderRadius: "16px 16px 5px 16px",
          padding: "12px 16px",
          fontSize: 15.5,
          lineHeight: 1.5,
          fontFamily: SERIF,
        }}
      >
        {text}
      </div>
    </div>
  );
}

// Strip internal [chunkId:N] / 【chunkId:N】 tags (and the debris they leave)
// from model text before it's shown to the user — citations live in their own
// Sources block, so these markers are noise in the prose.
function stripRefs(text: string): string {
  return text
    .replace(/[【[]\s*chunk\s*id\s*[:#]?\s*\d+\s*[\]】]/gi, "")
    .replace(/chunk\s*id\s*[:#]?\s*\d+/gi, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:)])/g, "$1")
    .trim();
}

function AssistantMessage({
  resp,
  showReasoning,
  onToggle,
}: {
  resp: AnswerResult;
  showReasoning: boolean;
  onToggle: () => void;
}) {
  const isEscalate = resp.status === "escalate";
  const isAnswered = resp.status === "answered";
  const conf = CONF_MAP[resp.confidence] ?? CONF_MAP.low;
  const cleanAnswer = stripRefs(resp.answer ?? "");
  const cleanReasoning = stripRefs(resp.reasoning ?? "");
  const hasReasoning = cleanReasoning.length > 0;
  // Only answered responses have grounded sources to show; escalations don't.
  const hasCitations = isAnswered && resp.citations && resp.citations.length > 0;

  return (
    <div style={{ margin: "18px 0 30px", animation: "lexrise .35s ease both" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 14,
          marginBottom: 12,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".13em", color: "#b4b4ae" }}>
          LEX
        </span>
        {isAnswered && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12.5,
              fontWeight: 600,
              color: conf.color,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: conf.color }} />
            {conf.label}
          </span>
        )}
        {isEscalate && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12.5,
              fontWeight: 600,
              color: "#9a6b18",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#c9952a" }} />
            Escalated to review
          </span>
        )}
      </div>

      {isEscalate && (
        <div style={{ borderLeft: "2px solid #c9952a", padding: "2px 0 2px 16px" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "#9a6b18",
              marginBottom: 6,
            }}
          >
            Why this needs a human
          </div>
          <div style={{ fontFamily: SERIF, fontSize: 16, lineHeight: 1.7, color: "#33312c" }}>
            {stripRefs(resp.escalationReason ?? "") ||
              "This one needs a finance reviewer's judgement before we can give a grounded answer."}
          </div>
        </div>
      )}

      {isAnswered && (
        <>
          {resp.flaggedPremise && (
            <div
              style={{
                borderLeft: "2px solid #c9952a",
                padding: "2px 0 2px 16px",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "#9a6b18",
                  marginBottom: 5,
                }}
              >
                Check this assumption
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "#5a564d" }}>
                {resp.flaggedPremise}
              </div>
            </div>
          )}
          {cleanAnswer && <Markdown serif size={16.5}>{cleanAnswer}</Markdown>}
        </>
      )}

      {isAnswered && hasReasoning && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={onToggle}
            style={{
              border: "none",
              background: "none",
              padding: "4px 0",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 500,
              color: "#8a8a85",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span style={{ fontSize: 9, width: 9, display: "inline-block" }}>
              {showReasoning ? "▾" : "▸"}
            </span>
            {showReasoning ? "Hide reasoning" : "Show reasoning"}
          </button>
          {showReasoning && (
            <div style={{ marginTop: 8, borderLeft: "2px solid #ececea", paddingLeft: 16 }}>
              <Markdown size={14} color="#6b6b66">
                {cleanReasoning}
              </Markdown>
            </div>
          )}
        </div>
      )}

      {hasCitations && (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "#b4b4ae",
              marginBottom: 10,
            }}
          >
            Sources
          </div>
          {resp.citations.map((c, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                padding: "7px 0",
                borderTop: "1px solid #f1f1ee",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14.5, flex: "none" }}>
                {c.articleRef}
              </span>
              <span style={{ fontSize: 12.5, color: "#a8a8a2", flex: 1 }}>
                {c.effectiveDate ? `Effective ${c.effectiveDate}` : ""}
              </span>
              {c.sourceUrl && (
                <a
                  href={c.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 13,
                    color: "#1a1a1a",
                    fontWeight: 500,
                    textDecoration: "underline",
                    textUnderlineOffset: 2,
                    textDecorationColor: "#cdcdc8",
                    flex: "none",
                  }}
                >
                  source ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// A human answer sent back from the Review Queue, shown inline in the thread.
function ReviewerMessage({ text, from }: { text: string; from?: string }) {
  return (
    <div style={{ margin: "18px 0 30px", animation: "lexrise .35s ease both" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".13em", color: "#2f7a52" }}
        >
          REVIEWER
        </span>
        {from && <span style={{ fontSize: 12.5, color: "#8a8a85" }}>@{from}</span>}
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: "#2f7a52",
            background: "#eaf3ee",
            borderRadius: 99,
            padding: "2px 8px",
          }}
        >
          Human answer
        </span>
      </div>
      <div
        style={{
          borderLeft: "2px solid #2f7a52",
          padding: "2px 0 2px 16px",
        }}
      >
        <Markdown serif size={16.5}>
          {text}
        </Markdown>
      </div>
    </div>
  );
}

function TypingIndicator({ label = "Reviewing FTA law" }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "18px 0 30px" }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".13em", color: "#b4b4ae" }}>
        LEX
      </span>
      <span style={{ fontSize: 13, color: "#a8a8a2" }}>{label}</span>
      <span style={{ display: "inline-flex", gap: 3 }}>
        {[0, 0.15, 0.3].map((delay) => (
          <span
            key={delay}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "#b4b4ae",
              animation: `lexdot 1s infinite ${delay}s`,
            }}
          />
        ))}
      </span>
    </div>
  );
}

const MAX_FILES = 4;

// Stage incoming files, deduped by name+size, capped at MAX_FILES. Shared by
// the picker, and window-level drag-and-drop.
function mergeFiles(prev: File[], incoming: File[]): File[] {
  const merged = [...prev];
  for (const f of incoming) {
    if (merged.length >= MAX_FILES) break;
    if (!merged.some((p) => p.name === f.name && p.size === f.size)) merged.push(f);
  }
  return merged;
}

const FILE_ACCEPT =
  "image/*,application/pdf,.xlsx,.csv,.tsv,.txt,.md,.docx," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv,text/plain";

// One inline invoice check in the thread: reading → confirm fields →
// checking → cited treatment. Errors keep the card (and any edits) in place.
function InvoiceCheckMessage({
  msg,
  onField,
  onRun,
}: {
  msg: Extract<Message, { role: "invoice" }>;
  onField?: <K extends keyof InvoiceFieldsData>(k: K, v: InvoiceFieldsData[K]) => void;
  onRun?: () => void;
}) {
  return (
    <div style={{ margin: "0 0 22px", display: "grid", gap: 12 }}>
      {msg.phase === "extracting" && (
        <div
          style={{
            border: "1px solid #ececea",
            borderRadius: 14,
            padding: 18,
            fontSize: 14,
            color: "#9a9a93",
            display: "flex",
            alignItems: "center",
            gap: 9,
          }}
        >
          <Spinner /> Reading {msg.fileName}…
        </div>
      )}

      {msg.phase === "error" && (
        <div
          style={{
            border: "1px solid #f0dedb",
            background: "#fdf7f6",
            borderRadius: 14,
            padding: 18,
            fontSize: 13.5,
            color: "#b0453a",
            lineHeight: 1.55,
          }}
        >
          {msg.error ?? "Something went wrong reading this file."}
        </div>
      )}

      {msg.fields && msg.phase !== "extracting" && msg.phase !== "error" && (
        <>
          {msg.error && (
            <div style={{ fontSize: 12.5, color: "#b0453a" }}>{msg.error}</div>
          )}
          {/* Stacked while the check runs; once a treatment exists and the
              thread is wide enough, the pair goes side by side (CSS container
              query — .lex-pair-wide in globals.css). */}
          <div className={`lex-invoice-pair${msg.det ? " lex-pair-wide" : ""}`}>
            <InvoiceFieldsCard
              fields={msg.fields}
              fileName={msg.fileName}
              determining={msg.phase === "determining"}
              onField={onField}
              onRun={onRun}
            />
            {msg.phase === "determining" && (
              <div
                style={{
                  fontSize: 13.5,
                  color: "#9a9a93",
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <Spinner /> Retrieving the relevant VAT provisions…
              </div>
            )}
            {msg.det && <DeterminationCard det={msg.det} />}
          </div>
        </>
      )}
    </div>
  );
}

function Composer({
  q,
  loading,
  files,
  onQ,
  onFiles,
  onKeyDown,
  onAsk,
  onCheckVat,
}: {
  q: string;
  loading: boolean;
  files: File[];
  onQ: (v: string) => void;
  onFiles: React.Dispatch<React.SetStateAction<File[]>>;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onAsk: () => void;
  onCheckVat: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLTextAreaElement>(null);
  const [multiline, setMultiline] = useState(false);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    onFiles((prev) => mergeFiles(prev, incoming));
  }

  // Decide single-line vs layered AND size the visible textarea — both measured
  // off-screen at the relevant fixed width via the mirror. Driving everything
  // from the mirror (not the live, mid-switch textarea) means it can't flicker
  // and it reliably collapses back to one line the moment the text fits again.
  useEffect(() => {
    const box = boxRef.current;
    const m = mirrorRef.current;
    const ta = taRef.current;
    if (!box || !m) return;
    const rowWidth = Math.max(box.clientWidth - 14 - 80, 40); // single-row text width
    const fullWidth = Math.max(box.clientWidth - 14, 40); // layered (full) text width

    // one-line baseline + does the text need more than one line at row width?
    m.style.width = `${rowWidth}px`;
    m.value = "x";
    m.style.height = "0px";
    const oneLine = m.scrollHeight;
    m.value = q || "x";
    m.style.height = "0px";
    const layered = m.scrollHeight > oneLine + 4;
    setMultiline(layered);

    // size the visible textarea at the width it will actually have
    if (ta) {
      m.style.width = `${layered ? fullWidth : rowWidth}px`;
      m.value = q;
      m.style.height = "0px";
      ta.style.height = `${Math.min(Math.max(m.scrollHeight, oneLine), 200)}px`;
    }
  }, [q]);

  const canSend = !loading && q.trim().length > 0;
  const atFileLimit = files.length >= MAX_FILES;

  return (
    <div style={{ width: "100%", padding: "0 24px" }}>
      <div style={{ maxWidth: 740, margin: "0 auto" }}>
        <div
          ref={boxRef}
          style={{
            position: "relative",
            border: "1px solid #e6e6e2",
            borderRadius: 24,
            background: "#fff",
            boxShadow: "0 2px 22px rgba(0,0,0,0.07)",
            padding: "6px 7px",
          }}
        >
          {files.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, margin: "2px 2px 8px" }}>
              {files.map((f, i) => (
                <span
                  key={i}
                  title={f.name}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    maxWidth: 240,
                    background: "#fafaf9",
                    border: "1px solid #ececea",
                    borderRadius: 10,
                    padding: "5px 8px 5px 10px",
                    fontSize: 12,
                    color: "#5a564d",
                  }}
                >
                  <span style={{ flex: "none" }}>📄</span>
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {f.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onFiles((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove ${f.name}`}
                    style={{
                      flex: "none",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      color: "#a8a8a2",
                      fontSize: 15,
                      lineHeight: 1,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept={FILE_ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {/* off-screen mirror: measures text wrap at the single-row width */}
          <textarea
            ref={mirrorRef}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            style={{
              position: "absolute",
              top: 0,
              left: -9999,
              height: 0,
              overflow: "hidden",
              visibility: "hidden",
              pointerEvents: "none",
              boxSizing: "border-box",
              border: "none",
              padding: "7px 6px",
              fontSize: 15.5,
              lineHeight: 1.4,
              fontFamily: SERIF,
              resize: "none",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
            }}
          />

          {/* flex-wrap row: single line by default; when layered, the textarea
              takes the full top row and the buttons drop below. Switching is
              CSS-only (order/flex-basis) so the textarea keeps focus. */}
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 6 }}>
            <button
              type="button"
              className="lex-attach"
              onClick={() => fileRef.current?.click()}
              disabled={loading || atFileLimit}
              title={
                atFileLimit
                  ? `Up to ${MAX_FILES} files`
                  : "Attach files — PDF, image, Excel, CSV or Word"
              }
              style={{
                order: multiline ? 1 : 0,
                flex: "none",
                width: 34,
                height: 34,
                borderRadius: "50%",
                color: atFileLimit ? "#cdcdc8" : "#5a564d",
                cursor: loading || atFileLimit ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>

            <textarea
              ref={taRef}
              className="lex-noscroll"
              value={q}
              onChange={(e) => onQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a UAE tax question…"
              rows={1}
              style={{
                order: multiline ? 0 : 1,
                flexGrow: 1,
                flexShrink: 1,
                flexBasis: multiline ? "100%" : "0%",
                boxSizing: "border-box",
                border: "none",
                background: "none",
                padding: "7px 6px",
                fontSize: 15.5,
                lineHeight: 1.4,
                color: "#1a1a1a",
                resize: "none",
                outline: "none",
                fontFamily: SERIF,
                maxHeight: 200,
                overflowY: "auto",
                transition: "height .12s ease",
              }}
            />

            {files.length > 0 && (
              <button
                type="button"
                onClick={onCheckVat}
                disabled={loading}
                title="Run the invoice VAT check on the attached file(s)"
                style={{
                  order: 2,
                  marginLeft: multiline ? "auto" : 0,
                  flex: "none",
                  height: 34,
                  border: "1px solid #1a1a1a",
                  borderRadius: 99,
                  background: "#fff",
                  color: loading ? "#9a9a93" : "#1a1a1a",
                  fontSize: 12.5,
                  fontWeight: 600,
                  padding: "0 14px",
                  cursor: loading ? "default" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Check VAT
              </button>
            )}

            <button
              onClick={onAsk}
              disabled={!canSend}
              title="Send"
              style={{
                order: 2,
                marginLeft: multiline ? "auto" : 0,
                flex: "none",
                width: 34,
                height: 34,
                border: "none",
                borderRadius: "50%",
                background: canSend ? "#1a1a1a" : "#e2e1dc",
                color: "#fff",
                cursor: canSend ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "background .15s ease",
              }}
            >
              {loading ? (
                <span
                  style={{
                    width: 14,
                    height: 14,
                    border: "2px solid rgba(255,255,255,.4)",
                    borderTopColor: "#fff",
                    borderRadius: "50%",
                    display: "inline-block",
                    animation: "lexspin .7s linear infinite",
                  }}
                />
              ) : (
                <span style={{ fontSize: 17, lineHeight: 1 }}>↑</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
