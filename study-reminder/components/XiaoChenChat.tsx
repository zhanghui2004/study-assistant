"use client";

import { useEffect, useRef, useState } from "react";
import { todayKey, uid } from "../lib/storage";
import {
  applyXiaoChenTurn,
  welcomeMessage,
} from "../lib/xiaochen";
import type { AppData, ChatMessage } from "../lib/types";

type Props = {
  data: AppData;
  onDataChange: (next: AppData) => void;
  onToast: (msg: string) => void;
};

export default function XiaoChenChat({ data, onDataChange, onToast }: Props) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const history = data.chatHistory;

  useEffect(() => {
    if (history.length) return;
    const welcome = welcomeMessage(data);
    onDataChange({ ...data, chatHistory: [welcome] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length, sending]);

  async function send(text?: string) {
    const content = (text ?? draft).trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");

    const userMsg: ChatMessage = {
      id: uid("chat"),
      role: "user",
      text: content,
      createdAt: Date.now(),
    };

    const afterUser = {
      ...data,
      chatHistory: [...data.chatHistory, userMsg],
    };
    onDataChange(afterUser);

    const local = applyXiaoChenTurn(afterUser, content);
    let replyText = local.reply;

    const today = todayKey();
    const tasksSummary = local.data.tasks
      .filter((t) => t.date === today)
      .map(
        (t) =>
          `${t.done ? "✓" : "○"} ${t.text}${t.minutesSpent ? ` (${t.minutesSpent}分)` : ""}`
      )
      .join("\n");
    const materialsContext = local.data.materials
      .slice(0, 4)
      .map((m) => `## ${m.title}\n${m.content.slice(0, 1500)}`)
      .join("\n\n");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          userName: local.data.userName,
          goals: local.data.goals,
          studyPlan: local.data.studyPlan,
          tasksSummary,
          materialsContext,
          progressNote: local.progressNote,
          localReply: local.reply,
          history: afterUser.chatHistory.slice(-8).map((m) => ({
            role: m.role,
            text: m.text,
          })),
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { reply?: string | null };
        if (json.reply) replyText = json.reply;
      }
    } catch {
      /* keep local */
    }

    const botMsg: ChatMessage = {
      id: uid("chat"),
      role: "xiaochen",
      text: replyText,
      createdAt: Date.now(),
      progressNote: local.progressNote,
    };

    onDataChange({
      ...local.data,
      chatHistory: [...afterUser.chatHistory, botMsg],
    });

    if (local.progressNote) {
      onToast(`进度已更新：${local.progressNote}`);
    }
    setSending(false);
    inputRef.current?.focus();
  }

  const chips = [
    "完成了精读第三章，学了40分钟",
    "我的目标是什么？",
    "根据课件讲讲极限",
  ];

  return (
    <div className="chat-root">
      <header className="chat-header">
        <div className="chat-avatar" aria-hidden>
          辰
        </div>
        <div>
          <h2>小辰</h2>
          <p className="lede" style={{ margin: 0 }}>
            快乐小狗式学习伙伴 · 记得你的目标与进度
          </p>
        </div>
      </header>

      <div className="chat-thread" role="log" aria-live="polite">
        {history.map((m) => (
          <div
            key={m.id}
            className={`chat-bubble-wrap ${m.role === "user" ? "is-user" : "is-bot"}`}
          >
            {m.role !== "user" && (
              <span className="chat-avatar sm" aria-hidden>
                辰
              </span>
            )}
            <div className={`chat-bubble ${m.role === "user" ? "user" : "bot"}`}>
              <p>{m.text}</p>
              {m.progressNote && (
                <div className="chat-progress-tag">已同步：{m.progressNote}</div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="chat-bubble-wrap is-bot">
            <span className="chat-avatar sm" aria-hidden>
              辰
            </span>
            <div className="chat-bubble bot typing">小辰摇尾巴想事情…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-compose">
        <div className="chip-row chat-chips">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              disabled={sending}
              onClick={() => void send(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="chat-input-row">
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            placeholder="跟小辰说：完成了什么、学了多久…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button
            type="button"
            className="btn btn-solid chat-send"
            disabled={sending || !draft.trim()}
            onClick={() => void send()}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
