"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildEncouragement,
  shouldFireReminder,
} from "../lib/encouragement";
import {
  loadLocal,
  loadMaterialsFromIdb,
  saveLocal,
  todayKey,
  uid,
} from "../lib/storage";
import type { AppData, Material, StudyWindow, Task } from "../lib/types";
import {
  androidInstallHint,
  isAndroid,
  isStandaloneDisplay,
  type BeforeInstallPromptEvent,
} from "../lib/platform";
import XiaoChenChat from "./XiaoChenChat";

type Tab = "today" | "plan" | "materials" | "xiaochen";

export default function StudyApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [tab, setTab] = useState<Tab>("today");
  const [toast, setToast] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [androidUa, setAndroidUa] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const deferredRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const local = loadLocal();
    void loadMaterialsFromIdb().then((mats) => {
      if (mats && mats.length && (!local.materials || !local.materials.length)) {
        local.materials = mats;
      }
      setData(local);
    });
  }, []);

  useEffect(() => {
    if (!data) return;
    saveLocal(data);
  }, [data]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setAndroidUa(isAndroid());
    setInstalled(isStandaloneDisplay());

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const onBip = (e: Event) => {
      e.preventDefault();
      const ev = e as BeforeInstallPromptEvent;
      deferredRef.current = ev;
      setDeferredPrompt(ev);
    };
    const onInstalled = () => {
      deferredRef.current = null;
      setDeferredPrompt(null);
      setInstalled(true);
      setToast("已安装到主屏幕，可从桌面图标打开");
      window.setTimeout(() => setToast(null), 3200);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (
      tabParam === "today" ||
      tabParam === "plan" ||
      tabParam === "materials" ||
      tabParam === "xiaochen" ||
      tabParam === "ask"
    ) {
      setTab(tabParam === "ask" ? "xiaochen" : tabParam);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!data) return;
    if (started.current) return;
    started.current = true;
    const tick = () => {
      setData((prev) => {
        if (!prev) return prev;
        if (!shouldFireReminder(prev)) return prev;
        const msg = buildEncouragement(prev);
        showInAppAndNotify(msg, prev.notificationsEnabled);
        return { ...prev, lastReminderAt: Date.now() };
      });
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => {
      window.clearInterval(id);
      started.current = false;
    };
    // Intentionally once after first data load; tick reads latest via setData updater.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);

  const encouragement = useMemo(
    () => (data ? buildEncouragement(data) : ""),
    [data]
  );

  const todayTasks = useMemo(() => {
    if (!data) return [] as Task[];
    const key = todayKey();
    return data.tasks.filter((t) => t.date === key);
  }, [data]);

  const progress = useMemo(() => {
    if (!todayTasks.length) return { done: 0, total: 0, pct: 0 };
    const done = todayTasks.filter((t) => t.done).length;
    return {
      done,
      total: todayTasks.length,
      pct: Math.round((done / todayTasks.length) * 100),
    };
  }, [todayTasks]);

  function patch( partial: Partial<AppData> ) {
    setData((d) => (d ? { ...d, ...partial } : d));
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }

  async function showAndroidNotification(msg: string) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg?.showNotification) {
        const opts: NotificationOptions & {
          renotify?: boolean;
          vibrate?: number[];
          badge?: string;
        } = {
          body: msg,
          icon: "/icons/icon-192.png",
          badge: "/icons/badge-96.png",
          tag: "jiayouxue-reminder",
          renotify: true,
          vibrate: [120, 60, 120],
          data: { url: "/?source=pwa&from=notification" },
        };
        await reg.showNotification("加油学", opts);
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      new Notification("加油学", {
        body: msg,
        icon: "/icons/icon-192.png",
        tag: "jiayouxue-reminder",
      });
    } catch {
      /* ignore */
    }
  }

  function showInAppAndNotify(msg: string, notify: boolean) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 4500);
    if (notify) void showAndroidNotification(msg);
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") {
      showToast("当前环境不支持系统通知，应用内提醒仍可用");
      return;
    }
    // Must run from a user gesture on Android Chrome
    const perm = await Notification.requestPermission();
    const ok = perm === "granted";
    patch({ notificationsEnabled: ok });
    if (ok) {
      showToast("已开启通知。应用在前台或最近使用时更可靠");
      await showAndroidNotification("通知已就绪。学习时段到了会提醒你。");
    } else if (perm === "denied") {
      showToast("通知被拒绝：可在 Chrome 站点设置里重新允许");
    } else {
      showToast("未授权通知，仍会在应用内提醒");
    }
  }

  function addTask() {
    const text = newTask.trim();
    if (!text || !data) return;
    const task: Task = {
      id: uid("task"),
      text,
      done: false,
      date: todayKey(),
    };
    patch({ tasks: [...data.tasks, task], onboardingDone: true });
    setNewTask("");
  }

  function toggleTask(id: string) {
    if (!data) return;
    patch({
      tasks: data.tasks.map((t) =>
        t.id === id ? { ...t, done: !t.done } : t
      ),
    });
  }

  function addMaterialFromText(title: string, content: string) {
    if (!data) return;
    const m: Material = {
      id: uid("mat"),
      title: title || "未命名资料",
      content: content.trim(),
      createdAt: Date.now(),
    };
    if (!m.content) return;
    patch({ materials: [m, ...data.materials], onboardingDone: true });
    showToast("资料已保存到本机");
  }

  async function onFile(file: File) {
    const text = await file.text();
    addMaterialFromText(file.name, text);
  }

  function updateWindow(id: string, field: keyof StudyWindow, value: string) {
    if (!data) return;
    patch({
      windows: data.windows.map((w) =>
        w.id === id ? { ...w, [field]: value } : w
      ),
    });
  }

  function addWindow() {
    if (!data) return;
    patch({
      windows: [
        ...data.windows,
        { id: uid("w"), label: "新时段", start: "14:00", end: "16:00" },
      ],
    });
  }

  function removeWindow(id: string) {
    if (!data) return;
    patch({ windows: data.windows.filter((w) => w.id !== id) });
  }

  async function tryInstall() {
    if (installed || isStandaloneDisplay()) {
      showToast("已在主屏幕模式运行");
      return;
    }
    const promptEvent = deferredRef.current || deferredPrompt;
    if (promptEvent) {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      deferredRef.current = null;
      setDeferredPrompt(null);
      if (choice.outcome === "accepted") {
        showToast("正在安装到主屏幕…");
      } else {
        showToast("已取消安装。可随时再点「安装到主屏幕」");
      }
      return;
    }
    showToast(
      androidUa
        ? "请点 Chrome 右上角 ⋮ →「安装应用」或「添加到主屏幕」"
        : "请用浏览器菜单「添加到主屏幕 / 安装应用」"
    );
  }

  function InstallPanel({ tone }: { tone: "hero" | "panel" }) {
    if (installed) {
      return tone === "panel" ? (
        <p className="limit-note">当前已是主屏幕应用模式（standalone）。</p>
      ) : (
        <p className="install-hint">已从主屏幕打开，可专注学习。</p>
      );
    }
    if (tone === "hero") {
      return (
        <p className="install-hint">
          {deferredPrompt
            ? "检测到可安装：点「安装到主屏幕」即可一键添加。"
            : androidInstallHint()}
          {" "}iPhone 请用 Safari 分享菜单。
        </p>
      );
    }
    return (
      <div className="install-banner">
        <h3>安装到 Android 主屏幕</h3>
        <p>
          {deferredPrompt
            ? "Chrome 已允许安装。点下面按钮，确认后会出现桌面图标。"
            : "若按钮未弹出系统安装框，请按下列步骤手动添加。"}
        </p>
        {!deferredPrompt && (
          <ol className="steps">
            <li>用 <strong>Chrome</strong> 打开本页（不要用内置浏览器）。</li>
            <li>点右上角 <strong>⋮</strong>。</li>
            <li>选择 <strong>「安装应用」</strong> 或 <strong>「添加到主屏幕」</strong>。</li>
            <li>确认后从桌面图标打开，体验接近独立 App。</li>
          </ol>
        )}
        <button type="button" className="btn btn-solid btn-block" onClick={() => void tryInstall()}>
          {deferredPrompt ? "安装到主屏幕" : "查看安装提示"}
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-shell">
        <div className="panel" style={{ paddingTop: 80 }}>
          <p className="lede">正在打开你的学习角落…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {tab === "today" && !data.onboardingDone ? (
        <section className="hero" aria-label="欢迎">
          <div className="hero-atmosphere" aria-hidden />
          <div className="hero-content">
            <p className="brand">加油学</p>
            <h1>温柔督促，把今天学完。</h1>
            <p>
              为 {data.userName} 准备。记下计划与学习时段，到点提醒你；也可找底栏的「小辰」汇报进度。
            </p>
            <div className="cta-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  patch({ onboardingDone: true });
                  setTab("plan");
                }}
              >
                开始设置
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  patch({ onboardingDone: true });
                  setTab("xiaochen");
                }}
              >
                找小辰聊聊
              </button>
            </div>
            <div className="cta-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void tryInstall()}
              >
                {deferredPrompt ? "安装到主屏幕" : "添加到主屏幕"}
              </button>
            </div>
            <InstallPanel tone="hero" />
          </div>
        </section>
      ) : null}

      {/* Always keep bottom nav visible so 小辰 is discoverable on first open / Try Live */}
      {(data.onboardingDone || tab !== "today") && (
        <>
          {tab === "today" && data.onboardingDone && (
            <div className="panel">
              <header className="section" style={{ marginTop: 8 }}>
                <p
                  className="brand"
                  style={{
                    fontSize: "2.2rem",
                    color: "var(--pine-deep)",
                    marginBottom: 4,
                  }}
                >
                  加油学
                </p>
                <h2>今日</h2>
                <p className="lede">按你的节奏推进，不必一次做完所有事。</p>
              </header>

              <div className="banner" role="status">
                <span className="banner-mark" aria-hidden />
                <p>{encouragement}</p>
              </div>

              <div className="progress-wrap">
                <div className="progress-meta">
                  <span>今日进度</span>
                  <span>
                    {progress.done}/{progress.total || 0} · {progress.pct}%
                  </span>
                </div>
                <div className="progress-bar" aria-hidden>
                  <div
                    className="progress-fill"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
              </div>

              <ul className="task-list">
                {todayTasks.map((t) => (
                  <li
                    key={t.id}
                    className={`task-item${t.done ? " done" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={t.done}
                      onChange={() => toggleTask(t.id)}
                      aria-label={t.text}
                    />
                    <span>
                      {t.text}
                      {t.minutesSpent ? (
                        <em className="task-mins"> · {t.minutesSpent} 分钟</em>
                      ) : null}
                    </span>
                  </li>
                ))}
                {!todayTasks.length && (
                  <li className="task-item">
                    <span style={{ color: "var(--muted)" }}>
                      还没有今日任务。加一条很小的即可。
                    </span>
                  </li>
                )}
              </ul>

              <div className="field" style={{ marginTop: 16 }}>
                <label htmlFor="new-task">添加任务</label>
                <input
                  id="new-task"
                  value={newTask}
                  onChange={(e) => setNewTask(e.target.value)}
                  placeholder="例如：精读第三章前 10 页"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addTask();
                  }}
                />
              </div>
              <button type="button" className="btn btn-solid btn-block" onClick={addTask}>
                记下这一步
              </button>

              <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-soft btn-block"
                  onClick={() => void enableNotifications()}
                >
                  {data.notificationsEnabled ? "通知已开启 · 再测一条" : "开启学习提醒通知"}
                </button>
                <button
                  type="button"
                  className="btn btn-soft btn-block"
                  onClick={() =>
                    showInAppAndNotify(buildEncouragement(data), data.notificationsEnabled)
                  }
                >
                  立刻给我一句鼓励
                </button>
              </div>

              <InstallPanel tone="panel" />

              <p className="limit-note">
                Android 提示：系统通知在应用打开或最近使用时最稳；锁屏后部分国产机可能清掉后台定时。应用内横幅始终可用。未接入推送服务时，完全退出后不会定时弹系统通知。
              </p>
            </div>
          )}

          {tab === "plan" && (
            <div className="panel">
              <div className="section">
                <h2>计划与作息</h2>
                <p className="lede">写下目标、计划与每日学习时段，提醒会据此出现。</p>
              </div>

              <div className="field">
                <label htmlFor="name">怎么称呼你</label>
                <input
                  id="name"
                  value={data.userName}
                  onChange={(e) => patch({ userName: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="goals">目标</label>
                <textarea
                  id="goals"
                  value={data.goals}
                  onChange={(e) => patch({ goals: e.target.value })}
                  placeholder="例如：期末高数稳住 85+；每天保持英语输入"
                />
              </div>
              <div className="field">
                <label htmlFor="plan">学习计划</label>
                <textarea
                  id="plan"
                  value={data.studyPlan}
                  onChange={(e) => patch({ studyPlan: e.target.value })}
                  placeholder="本周重点、章节安排、复习节奏…"
                />
              </div>
              <div className="field">
                <label htmlFor="routine">日常作息</label>
                <textarea
                  id="routine"
                  value={data.routine}
                  onChange={(e) => patch({ routine: e.target.value })}
                  placeholder="起床、上课、运动、睡眠大概时间"
                />
              </div>

              <div className="section" style={{ marginTop: 8 }}>
                <h2>学习时段</h2>
                <p className="lede">落在这些时间窗口内时，会弹出提醒与鼓励。</p>
              </div>

              {data.windows.map((w) => (
                <div className="window-row" key={w.id}>
                  <div className="field">
                    <label>名称</label>
                    <input
                      value={w.label}
                      onChange={(e) => updateWindow(w.id, "label", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>开始</label>
                    <input
                      type="time"
                      value={w.start}
                      onChange={(e) => updateWindow(w.id, "start", e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>结束</label>
                    <input
                      type="time"
                      value={w.end}
                      onChange={(e) => updateWindow(w.id, "end", e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-soft"
                    onClick={() => removeWindow(w.id)}
                    aria-label="删除时段"
                  >
                    删
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-solid btn-block" onClick={addWindow}>
                添加时段
              </button>
            </div>
          )}

          {tab === "materials" && (
            <div className="panel">
              <div className="section">
                <h2>学习资料</h2>
                <p className="lede">粘贴或上传课件文本，保存在本机，供答疑检索。</p>
              </div>

              <MaterialComposer onSave={addMaterialFromText} />

              <input
                ref={fileRef}
                className="hidden-file"
                type="file"
                accept=".txt,.md,.markdown,.csv,.json,text/plain"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn btn-soft btn-block"
                style={{ marginBottom: 16 }}
                onClick={() => fileRef.current?.click()}
              >
                上传文本文件
              </button>

              {data.materials.map((m) => (
                <article className="material" key={m.id}>
                  <h3>{m.title}</h3>
                  <p>{m.content}</p>
                  <button
                    type="button"
                    className="chip"
                    style={{ marginTop: 8 }}
                    onClick={() =>
                      patch({
                        materials: data.materials.filter((x) => x.id !== m.id),
                      })
                    }
                  >
                    删除
                  </button>
                </article>
              ))}
              {!data.materials.length && (
                <p className="lede">暂无资料。先贴一段课堂笔记试试看。</p>
              )}
            </div>
          )}

          {tab === "xiaochen" && (
            <XiaoChenChat
              data={data}
              onDataChange={(next) => setData(next)}
              onToast={showToast}
            />
          )}
        </>
      )}

      <nav className="nav" aria-label="主导航">
        {(
          [
            ["today", "今日", "今"],
            ["plan", "计划", "计"],
            ["materials", "资料", "资"],
            ["xiaochen", "小辰", "辰"],
          ] as const
        ).map(([id, label, ico]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            onClick={() => {
              if (id !== "today") patch({ onboardingDone: true });
              setTab(id);
            }}
          >
            <span className="ico">{ico}</span>
            {label}
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function MaterialComposer({
  onSave,
}: {
  onSave: (title: string, content: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  return (
    <>
      <div className="field">
        <label htmlFor="mat-title">标题</label>
        <input
          id="mat-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如：高数 · 第三章笔记"
        />
      </div>
      <div className="field">
        <label htmlFor="mat-body">内容</label>
        <textarea
          id="mat-body"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="粘贴课件摘要、笔记、重点…"
        />
      </div>
      <button
        type="button"
        className="btn btn-solid btn-block"
        style={{ marginBottom: 10 }}
        onClick={() => {
          onSave(title, content);
          setTitle("");
          setContent("");
        }}
      >
        保存资料
      </button>
    </>
  );
}
