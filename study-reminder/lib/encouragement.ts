import type { AppData } from "./types";
import { todayKey } from "./storage";

function progressOf(data: AppData) {
  const today = todayKey();
  const tasks = data.tasks.filter((t) => t.date === today);
  if (!tasks.length) return { done: 0, total: 0, pct: 0 };
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, pct: Math.round((done / tasks.length) * 100) };
}

export function buildEncouragement(data: AppData, now = new Date()): string {
  const name = data.userName?.trim() || "同学";
  const { done, total, pct } = progressOf(data);
  const hour = now.getHours();
  const goalHint = data.goals?.trim()
    ? data.goals.trim().slice(0, 40)
    : "今天的学习目标";

  const windowNow = data.windows.find((w) => inWindow(w.start, w.end, now));

  if (windowNow) {
    if (pct === 0 && total === 0) {
      return `${name}，现在是「${windowNow.label}」时段。先把今天要完成的一小步写下来，我们一起往「${goalHint}」靠近。`;
    }
    if (pct < 40) {
      return `${name}，「${windowNow.label}」还在。进度 ${pct}%——不用赶，把这一段时间用扎实就好。`;
    }
    if (pct < 100) {
      return `${name}，已经完成 ${done}/${total}。继续保持，学习时段结束前再收紧一点就更稳了。`;
    }
    return `${name}，今日任务都勾完了。若还有余力，复习一遍关键概念；若累了，就好好休息，明天接着来。`;
  }

  const next = nextWindow(data, now);
  if (hour < 8) {
    return `${name}，早安。今天也温柔而坚定一点。${next ? `下一档学习是 ${next.start}「${next.label}」。` : ""}`;
  }
  if (hour >= 22) {
    return `${name}，夜深了。把今天收个尾：回顾一句收获，早点睡——明天的你会感谢现在的你。`;
  }
  if (pct >= 100 && total > 0) {
    return `${name}，今天的清单已经完成。给自己一点肯定，也给大脑一点空隙。`;
  }
  if (next) {
    return `${name}，距离「${next.label}」（${next.start}）还有一点时间。先休息或整理资料，到点我们再出发。`;
  }
  return `${name}，学习不是冲刺一场，而是每天多一点点。你已经在路上了。`;
}

export function inWindow(start: string, end: string, now = new Date()) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const a = sh * 60 + sm;
  const b = eh * 60 + em;
  if (a <= b) return mins >= a && mins < b;
  return mins >= a || mins < b;
}

function nextWindow(data: AppData, now: Date) {
  const mins = now.getHours() * 60 + now.getMinutes();
  const sorted = [...data.windows].sort((x, y) => {
    const [xh, xm] = x.start.split(":").map(Number);
    const [yh, ym] = y.start.split(":").map(Number);
    return xh * 60 + xm - (yh * 60 + ym);
  });
  for (const w of sorted) {
    const [h, m] = w.start.split(":").map(Number);
    if (h * 60 + m > mins) return w;
  }
  return sorted[0] ?? null;
}

export function shouldFireReminder(data: AppData, now = new Date()) {
  const inAny = data.windows.some((w) => inWindow(w.start, w.end, now));
  if (!inAny) return false;
  const last = data.lastReminderAt ?? 0;
  // at most once per 45 minutes while inside a window
  return now.getTime() - last > 45 * 60 * 1000;
}
