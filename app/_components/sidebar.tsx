"use client";

import { useState } from "react";
import {
  MODULES,
  MORE_NAV,
  PRIMARY_NAV,
  SERIF,
  SESSION_HISTORY_ENABLED,
  type ModuleKey,
  type SessionSummary,
} from "../_lib/lex-data";

interface SidebarProps {
  module: ModuleKey;
  onNavigate: (key: ModuleKey) => void;
  onNewChat: () => void;
  username: string | null;
  sessions: SessionSummary[];
  activeSessionId: number | null;
  onLoadSession: (id: number) => void;
  onDeleteSession: (id: number) => void;
  onSwitchUser: () => void;
}

const svg = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function NavIcon({ k }: { k: ModuleKey }) {
  switch (k) {
    case "ask":
      return (
        <svg {...svg}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case "invoice":
      return (
        <svg {...svg}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8M16 17H8" />
        </svg>
      );
    case "vendor":
      return (
        <svg {...svg}>
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <path d="M3 6h18" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
      );
    case "register":
      return (
        <svg {...svg}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "queue":
      return (
        <svg {...svg}>
          <path d="M22 12h-6l-2 3h-4l-2-3H2" />
          <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      );
    case "alerts":
      return (
        <svg {...svg}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
    case "history":
      return (
        <svg {...svg}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "reports":
      return (
        <svg {...svg}>
          <path d="M3 3v18h18" />
          <path d="M7 16V9M12 16v-5M17 16v-9" />
        </svg>
      );
  }
}

function NavButton({
  k,
  active,
  collapsed,
  onClick,
}: {
  k: ModuleKey;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={MODULES[k].title}
      style={{
        width: "100%",
        textAlign: "left",
        border: "none",
        background: active ? "#eceae5" : "transparent",
        borderRadius: 9,
        padding: collapsed ? "10px 0" : "9px 11px",
        marginBottom: 2,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 10,
        justifyContent: collapsed ? "center" : "flex-start",
        color: active ? "#1a1a1a" : "#5a564d",
      }}
    >
      <span style={{ flex: "none", display: "flex" }}>
        <NavIcon k={k} />
      </span>
      {!collapsed && (
        <span
          style={{
            fontSize: 13.5,
            fontWeight: active ? 600 : 500,
            flex: 1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {MODULES[k].title}
        </span>
      )}
    </button>
  );
}

export function Sidebar({
  module,
  onNavigate,
  onNewChat,
  username,
  sessions,
  activeSessionId,
  onLoadSession,
  onDeleteSession,
  onSwitchUser,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div
      style={{
        flex: "none",
        width: collapsed ? 62 : 252,
        transition: "width .18s ease",
        background: "#fafaf9",
        borderRight: "1px solid #ececea",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* header: brand + retract toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          gap: 8,
          padding: collapsed ? "16px 0 10px" : "16px 14px 10px",
        }}
      >
        {!collapsed && (
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 19,
              fontWeight: 600,
              letterSpacing: "-.01em",
              whiteSpace: "nowrap",
            }}
          >
            Project Lex
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={iconBtn}
        >
          <svg {...svg} width={18} height={18}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
          </svg>
        </button>
      </div>

      {/* new chat */}
      <div style={{ padding: collapsed ? "0 10px 8px" : "0 12px 8px" }}>
        <button
          onClick={onNewChat}
          title="New chat"
          style={{
            width: "100%",
            border: "1px solid #e6e6e2",
            background: "#fff",
            borderRadius: 10,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 9,
            justifyContent: collapsed ? "center" : "flex-start",
            padding: collapsed ? "9px 0" : "9px 12px",
            color: "#3a3a36",
          }}
        >
          <svg {...svg} width={16} height={16}>
            <path d="M12 5v14M5 12h14" />
          </svg>
          {!collapsed && <span style={{ fontSize: 13.5, fontWeight: 600 }}>New chat</span>}
        </button>
      </div>

      {/* nav + sessions */}
      <div
        className="lex-scroll"
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: collapsed ? "4px 9px" : "4px 12px",
        }}
      >
        {PRIMARY_NAV.map((key) => (
          <NavButton
            key={key}
            k={key}
            active={key === module && activeSessionId === null}
            collapsed={collapsed}
            onClick={() => onNavigate(key)}
          />
        ))}

        {/* More — the rest of the modules, hidden by default */}
        {!collapsed && (
          <>
            <button
              onClick={() => setShowMore((s) => !s)}
              style={{
                width: "100%",
                textAlign: "left",
                border: "none",
                background: "transparent",
                borderRadius: 9,
                padding: "9px 11px",
                marginBottom: 2,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
                color: "#8a8a85",
              }}
            >
              <span style={{ fontSize: 9, width: 17, textAlign: "center", flex: "none" }}>
                {showMore ? "▾" : "▸"}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>More</span>
            </button>
            {showMore &&
              MORE_NAV.map((key) => (
                <NavButton
                  key={key}
                  k={key}
                  active={key === module && activeSessionId === null}
                  collapsed={collapsed}
                  onClick={() => onNavigate(key)}
                />
              ))}
          </>
        )}

        {/* divider + saved sessions (hidden while session history is off) */}
        {!collapsed && SESSION_HISTORY_ENABLED && (
          <>
            <div style={{ borderTop: "1px solid #e8e8e4", margin: "10px 4px 8px" }} />
            {username ? (
              sessions.length === 0 ? (
                <div style={{ fontSize: 12, color: "#b4b4ae", padding: "6px 11px", lineHeight: 1.5 }}>
                  Your chats will appear here.
                </div>
              ) : (
                sessions.map((s) => {
                  const active = s.id === activeSessionId;
                  return (
                    <div
                      key={s.id}
                      onMouseEnter={() => setHovered(s.id)}
                      onMouseLeave={() => setHovered((h) => (h === s.id ? null : h))}
                      style={{ position: "relative" }}
                    >
                      <button
                        onClick={() => onLoadSession(s.id)}
                        title={s.title}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          background: active ? "#eceae5" : "transparent",
                          borderRadius: 9,
                          padding: "8px 11px",
                          paddingRight: 30,
                          marginBottom: 1,
                          cursor: "pointer",
                          color: active ? "#1a1a1a" : "#5a564d",
                          fontSize: 13,
                          fontWeight: active ? 600 : 500,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          display: "block",
                        }}
                      >
                        {s.title}
                      </button>
                      {(hovered === s.id || active) && (
                        <button
                          onClick={() => onDeleteSession(s.id)}
                          title="Delete chat"
                          style={{
                            position: "absolute",
                            top: 6,
                            right: 6,
                            width: 22,
                            height: 22,
                            border: "none",
                            background: "none",
                            borderRadius: 6,
                            cursor: "pointer",
                            color: "#a8a8a2",
                            fontSize: 14,
                            lineHeight: 1,
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })
              )
            ) : (
              <div style={{ fontSize: 12, color: "#b4b4ae", padding: "6px 11px", lineHeight: 1.5 }}>
                Choose a username to save your chat history.
              </div>
            )}
          </>
        )}
      </div>

      {/* identity footer */}
      {!collapsed && (
        <div style={{ flex: "none", padding: 12, borderTop: "1px solid #f0f0ee" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div
              style={{
                flex: "none",
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: username ? "#1a1a1a" : "#d6d6d0",
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {username ? username[0].toUpperCase() : "?"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "#b4b4ae" }}>
                Signed in as
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#1a1a1a",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {username ? `@${username}` : "Unknown"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onSwitchUser} title="Change username" style={footerBtn}>
              Switch user
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  flex: "none",
  width: 32,
  height: 32,
  border: "none",
  background: "none",
  borderRadius: 8,
  cursor: "pointer",
  color: "#8a8a85",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const footerBtn: React.CSSProperties = {
  flex: 1,
  border: "1px solid #e0e0db",
  background: "#fff",
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  color: "#5a564d",
  padding: "6px 10px",
  cursor: "pointer",
};
