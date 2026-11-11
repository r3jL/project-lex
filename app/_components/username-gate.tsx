"use client";

import { useState } from "react";
import { SERIF } from "../_lib/lex-data";

// Shown once on first visit so the user can pick a handle (to keep session
// history + use the Review Queue) or continue as a guest. Not auth — just
// identity for history and routing.
export function UsernameGate({ onChosen }: { onChosen: (username: string | null) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"user" | "guest" | null>(null);

  async function choose(payload: { username?: string; guest?: boolean }, which: "user" | "guest") {
    setBusy(which);
    setError("");
    try {
      const res = await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Could not continue.");
      onChosen(data.username ?? null);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    void choose({ username: name }, "user");
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fafaf9",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 400,
          border: "1px solid #ececea",
          borderRadius: 16,
          background: "#fff",
          padding: "32px 28px",
          textAlign: "center",
          animation: "lexrise .3s ease both",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".14em",
            color: "#b4b4ae",
            marginBottom: 6,
          }}
        >
          PROJECT LEX
        </div>
        <h1 style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 600, margin: "0 0 6px" }}>
          Who’s asking?
        </h1>
        <p style={{ fontSize: 13, color: "#9a9a93", margin: "0 0 22px", lineHeight: 1.55 }}>
          Pick a username to keep your chat history and use the Review Queue — or
          continue without one.
        </p>

        <form onSubmit={submit}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="username"
            spellCheck={false}
            autoCapitalize="none"
            style={{
              width: "100%",
              border: "1px solid #e0e0db",
              borderRadius: 10,
              padding: "12px 14px",
              fontSize: 15,
              textAlign: "center",
              outline: "none",
              marginBottom: 12,
              boxSizing: "border-box",
            }}
          />
          {error && (
            <div style={{ fontSize: 13, color: "#9a3b30", marginBottom: 12 }}>{error}</div>
          )}
          <button
            type="submit"
            disabled={!name.trim() || !!busy}
            style={{
              width: "100%",
              border: "1px solid #1a1a1a",
              borderRadius: 99,
              background: !name.trim() || !!busy ? "#f0efec" : "#1a1a1a",
              color: !name.trim() || !!busy ? "#9a9a93" : "#fff",
              fontSize: 14,
              fontWeight: 600,
              padding: "11px 0",
              cursor: !name.trim() || !!busy ? "default" : "pointer",
            }}
          >
            {busy === "user" ? "Continuing…" : "Continue with username"}
          </button>
        </form>

        <button
          onClick={() => choose({ guest: true }, "guest")}
          disabled={!!busy}
          style={{
            width: "100%",
            marginTop: 10,
            border: "none",
            background: "none",
            fontSize: 13,
            fontWeight: 500,
            color: "#8a8a85",
            cursor: busy ? "default" : "pointer",
            padding: "6px 0",
          }}
        >
          {busy === "guest" ? "Continuing…" : "Continue without a username"}
        </button>
      </div>
    </div>
  );
}
