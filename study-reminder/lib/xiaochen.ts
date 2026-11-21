import { retrieveLocal } from "./retrieval";
import { todayKey, uid } from "./storage";
import type { AppData, ChatMessage, Task } from "./types";

export type ProgressChange = {
  action: "checked" | "created" | "updated";
  task: Task;
  minutes?: number;
};

export type XiaoChenResult = {
  reply: string;
  data: AppData;
  changes: ProgressChange[];
  progressNote?: string;
  mode: "local" | "llm";
};

const DONE_VERBS =
  /(完成了?|做完了?|学完了?|看完了?|写完了?|搞定了?|勾掉了?|打卡了?|结束了?|过完了?)/;

function parseMinutes(text: string): number | undefined {
  const half = text.match(/半\s*小时/);
  if (half) return 30;
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|钟头|h\b)/i);
  if (hours) return Math.round(parseFloat(hours[1]!) * 60);
  const mins = text.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分|min)/i);
  if (mins) return Math.round(parseFloat(mins[1]!));
  const spent = text.match(/(?:花了|用了|学了|投入了)\s*(\d+(?:\.\d+)?)\s*(?:分钟|分)?/);
  if (spent) {
    const n = parseFloat(spent[1]!);
    // if "学了2" without unit near 小时 already handled; bare number after 学了 often minutes if > 3
    if (text.includes("小时")) return Math.round(n * 60);
    return Math.round(n);
  }
  return undefined;
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[，。！？、,.!?\s]/g, "")
    .replace(/^(完成了?|做完了?|学完了?|看完了?|写完了?|搞定了?|勾掉了?|打卡了?)/, "");
}

function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x.includes(y) || y.includes(x)) return 0.9;
  let hits = 0;
  const grams = new Set<string>();
  for (let i = 0; i < y.length - 1; i++) grams.add(y.slice(i, i + 2));
  for (let i = 0; i < x.length - 1; i++) {
    if (grams.has(x.slice(i, i + 2))) hits++;
  }
  return hits / Math.max(grams.size, 1);
}

function extractCompletedPhrases(text: string): string[] {
  const phrases: string[] = [];
  const patterns = [
    /(?:完成了?|做完了?|学完了?|看完了?|写完了?|搞定了?|勾掉了?|打卡了?)([^\n，。！？,.!?]{1,40})/g,
    /把([^\n，。！？,.!?]{1,30})(?:完成|做完|学完|搞定)/g,
    /([^\n，。！？,.!?]{2,30})(?:完成了|做完了|学完了|搞定了|打卡了)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const p = (m[1] || "").trim().replace(/^(了|的)/, "").trim();
      if (p && p.length >= 2 && !/^(今天|刚才|已经|终于|一下)/.test(p)) {
        phrases.push(p.replace(/(大约|大概|左右)?\d+(?:\.\d+)?\s*(分钟|分|小时|钟头|min|h).*$/i, "").trim());
      }
    }
  }
  return [...new Set(phrases.filter((p) => p.length >= 2))];
}

function bestTaskMatch(tasks: Task[], phrase: string): Task | null {
  let best: Task | null = null;
  let score = 0.35;
  for (const t of tasks) {
    const s = similarity(t.text, phrase);
    if (s > score) {
      score = s;
      best = t;
    }
  }
  return best;
}

export function detectAndApplyProgress(
  data: AppData,
  userText: string
): { data: AppData; changes: ProgressChange[]; progressNote?: string } {
  const today = todayKey();
  const minutes = parseMinutes(userText);
  const looksDone = DONE_VERBS.test(userText) || /打卡|搞定|完成/.test(userText);
  const phrases = extractCompletedPhrases(userText);

  let tasks = [...data.tasks];
  const changes: ProgressChange[] = [];

  // Duration-only update on a recently unfinished or last mentioned task
  if (!looksDone && minutes && !phrases.length) {
    const todayTasks = tasks.filter((t) => t.date === today);
    const target =
      todayTasks.find((t) => !t.done) ||
      todayTasks[todayTasks.length - 1] ||
      null;
    if (target) {
      tasks = tasks.map((t) =>
        t.id === target.id
          ? { ...t, minutesSpent: (t.minutesSpent || 0) + minutes }
          : t
      );
      const updated = tasks.find((t) => t.id === target.id)!;
      changes.push({ action: "updated", task: updated, minutes });
    }
  }

  const toProcess = phrases.length
    ? phrases
    : looksDone
      ? [userText.replace(DONE_VERBS, "").trim().slice(0, 40) || "今日学习"]
      : [];

  for (const phrase of toProcess) {
    if (!phrase || phrase.length < 2) continue;
    const todayTasks = tasks.filter((t) => t.date === today);
    const match = bestTaskMatch(todayTasks, phrase);
    if (match) {
      tasks = tasks.map((t) => {
        if (t.id !== match.id) return t;
        return {
          ...t,
          done: true,
          minutesSpent: minutes
            ? (t.minutesSpent || 0) + minutes
            : t.minutesSpent,
        };
      });
      const updated = tasks.find((t) => t.id === match.id)!;
      changes.push({
        action: match.done && !minutes ? "updated" : "checked",
        task: updated,
        minutes,
      });
    } else {
      const created: Task = {
        id: uid("task"),
        text: phrase.slice(0, 60),
        done: true,
        date: today,
        minutesSpent: minutes,
      };
      tasks = [...tasks, created];
      changes.push({ action: "created", task: created, minutes });
    }
  }

  // If only minutes + a task name without strong verb, still try match
  if (!changes.length && minutes) {
    const todayTasks = tasks.filter((t) => t.date === today);
    for (const t of todayTasks) {
      if (similarity(userText, t.text) > 0.5) {
        tasks = tasks.map((x) =>
          x.id === t.id
            ? {
                ...x,
                done: true,
                minutesSpent: (x.minutesSpent || 0) + minutes,
              }
            : x
        );
        const updated = tasks.find((x) => x.id === t.id)!;
        changes.push({ action: "checked", task: updated, minutes });
        break;
      }
    }
  }

  if (!changes.length) {
    return { data, changes: [] };
  }

  // Dedupe by task id keeping last
  const byId = new Map<string, ProgressChange>();
  for (const c of changes) byId.set(c.task.id, c);
  const unique = [...byId.values()];

  const note = unique
    .map((c) => {
      const time = c.minutes ? ` · ${c.minutes} 分钟` : "";
      if (c.action === "created") return `新建并完成「${c.task.text}」${time}`;
      if (c.action === "checked") return `勾选完成「${c.task.text}」${time}`;
      return `更新「${c.task.text}」用时${time || ""}`;
    })
    .join("；");

  return {
    data: { ...data, tasks },
    changes: unique,
    progressNote: note,
  };
}

function todayProgress(data: AppData) {
  const today = todayKey();
  const list = data.tasks.filter((t) => t.date === today);
  const done = list.filter((t) => t.done);
  const minutes = list.reduce((s, t) => s + (t.minutesSpent || 0), 0);
  return {
    list,
    done,
    open: list.filter((t) => !t.done),
    pct: list.length ? Math.round((done.length / list.length) * 100) : 0,
    minutes,
  };
}

function materialHint(data: AppData, userText: string): string | null {
  if (!data.materials.length) return null;
  const q = userText.length > 4 ? userText : data.goals || "重点";
  const { citations } = retrieveLocal(q, data.materials, 1);
  if (!citations.length) {
    const m = data.materials[0]!;
    return `资料「${m.title}」还在，随时问我里面的内容～`;
  }
  return `联想到资料「${citations[0]!.title}」：${citations[0]!.snippet.slice(0, 48)}…`;
}

export function buildLocalXiaoChenReply(
  data: AppData,
  userText: string,
  changes: ProgressChange[]
): string {
  const name = data.userName?.trim() || "同学";
  const prog = todayProgress(data);
  const goal = data.goals?.trim().slice(0, 36);
  const tailWag = ["汪！尾巴摇起来了～", "快乐小狗式冲刺成功！", "哼哼，骄傲地转了两圈！"];
  const wag = tailWag[Math.floor(Math.random() * tailWag.length)]!;

  if (changes.length) {
    const lines = changes.map((c) => {
      const time = c.minutes ? `（${c.minutes} 分钟）` : "";
      if (c.action === "created") return `· 记下并勾选「${c.task.text}」${time}`;
      if (c.action === "checked") return `· 已勾选「${c.task.text}」${time}`;
      return `· 「${c.task.text}」用时已更新${time}`;
    });
    const openHint = prog.open.length
      ? `还剩：${prog.open
          .slice(0, 2)
          .map((t) => t.text)
          .join("、")}${prog.open.length > 2 ? "…" : ""}。`
      : "今日清单都亮起来了！";
    const goalLine = goal ? `朝着「${goal}」又近了一步。` : "今天的你很稳。";
    return `${name}，收到啦！${wag}\n\n我已经帮你同步进度：\n${lines.join("\n")}\n\n今日 ${prog.done.length}/${prog.list.length || prog.done.length} · ${prog.pct}%${prog.minutes ? ` · 累计约 ${prog.minutes} 分钟` : ""}。${goalLine}${openHint}`;
  }

  // Study question / material ask
  if (/[？?]|什么|怎么|如何|为什么|解释|定义|总结/.test(userText)) {
    const local = retrieveLocal(userText, data.materials, 2);
    if (local.citations.length) {
      return `${name}，我翻了翻你的课件（本地检索）～\n\n${local.answer.replace(/^根据你上传的资料，相关内容如下（本地检索，未调用模型）：\n\n/, "")}\n\n有不懂的再丢给我，快乐小狗随时待命！`;
    }
    return `${name}，课件里暂时没找到很贴的段落。你可以先在「资料」里贴一点相关笔记，我就能摇着尾巴帮你找重点啦。`;
  }

  const openList = prog.open.length
    ? `待完成：${prog.open
        .slice(0, 3)
        .map((t) => t.text)
        .join("、")}`
    : "今天还没写任务的话，丢一句「我要学××」给我也行。";
  const mat = materialHint(data, userText);
  const goalLine = goal ? `长期目标「${goal}」我记着呢。` : "你的长期目标我还空着，去「计划」写一句我会记得。";

  return `${name}，嗨！我是小辰，开朗的快乐小狗伙伴（比喻啦）～\n\n${goalLine}${mat ? `\n${mat}` : ""}\n今日进度 ${prog.pct}% · ${prog.done.length}/${prog.list.length || 0}。${openList}\n\n学完了就跟我说：「完成了××，学了30分钟」，我会自动勾进度，再给你鼓劲！`;
}

export function welcomeMessage(data: AppData): ChatMessage {
  const name = data.userName?.trim() || "同学";
  return {
    id: uid("chat"),
    role: "xiaochen",
    text: `嗨 ${name}！我是小辰～像一只快乐小狗一样陪你学习（比喻，不是真狗啦）。\n\n跟我汇报「完成了什么、学了多久」，我会自动勾任务、记时长，再摇尾巴鼓励你。你的目标、课件和任务列表我都会记住。`,
    createdAt: Date.now(),
  };
}

export function applyXiaoChenTurn(
  data: AppData,
  userText: string
): Omit<XiaoChenResult, "mode"> {
  const trimmed = userText.trim();
  const { data: next, changes, progressNote } = detectAndApplyProgress(data, trimmed);
  const reply = buildLocalXiaoChenReply(next, trimmed, changes);
  return { reply, data: next, changes, progressNote };
}
