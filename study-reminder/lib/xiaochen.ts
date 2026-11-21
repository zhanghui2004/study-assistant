import { retrieveLocal } from "./retrieval";
import { todayKey, uid } from "./storage";
import type { AppData, ChatMessage, Task } from "./types";

export type ProgressChange = {
  action: "checked" | "created" | "updated" | "deleted";
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

/** Phrases that are verbs/duration markers, never task titles */
const INVALID_TASK_TITLE =
  /^(?:我)?(?:花了|用了|学了|投入了|花费了)|^(?:完成了?|做完了?|学完了?|看完了?|写完了?|搞定了?|勾掉了?|打卡了?|结束了?|过完了?)$|^(?:今天|刚才|已经|终于|一下|spend|spent)$/i;

const DURATION_PREFIX =
  /^(?:我)?(?:花了|用了|学了|投入了|花费了)\s*\d+(?:\.\d+)?\s*(?:个)?\s*(?:小时|钟头|分钟|分|h|min)?/i;

function parseMinutes(text: string): number | undefined {
  const half = text.match(/半\s*小时/);
  if (half) return 30;
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(?:个)?\s*(?:小时|钟头|h\b)/i);
  if (hours) return Math.round(parseFloat(hours[1]!) * 60);
  const mins = text.match(/(\d+(?:\.\d+)?)\s*(?:分钟|分|min)\b/i);
  if (mins) return Math.round(parseFloat(mins[1]!));
  // 「花了3」「学了40」— bare number after spend verb; treat as minutes unless 小时 already matched
  const spent = text.match(
    /(?:花了|用了|学了|投入了|花费了)\s*(\d+(?:\.\d+)?)\s*(?:分钟|分)?(?!\s*(?:小时|钟头|h))/i
  );
  if (spent) return Math.round(parseFloat(spent[1]!));
  return undefined;
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[「」『』""''《》\[\]（）()，。！？、,.!?\s]/g, "")
    .replace(
      /^(完成了?|做完了?|学完了?|看完了?|写完了?|搞定了?|勾掉了?|打卡了?)/,
      ""
    );
}

function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  let hits = 0;
  const grams = new Set<string>();
  for (let i = 0; i < y.length - 1; i++) grams.add(y.slice(i, i + 2));
  for (let i = 0; i < x.length - 1; i++) {
    if (grams.has(x.slice(i, i + 2))) hits++;
  }
  return hits / Math.max(grams.size, 1);
}

function stripDurationTail(p: string): string {
  return p
    .replace(
      /(?:大约|大概|左右)?\d+(?:\.\d+)?\s*(?:个)?\s*(?:分钟|分|小时|钟头|min|h).*$/i,
      ""
    )
    .replace(DURATION_PREFIX, "")
    .replace(/^(了|的|，|,)/, "")
    .trim();
}

function isValidTaskTitle(p: string): boolean {
  const t = stripDurationTail(p).trim();
  if (t.length < 2) return false;
  if (INVALID_TASK_TITLE.test(t)) return false;
  if (/^(?:我)?(?:花了|用了|学了|投入了)/.test(t)) return false;
  if (/^\d+(?:\.\d+)?\s*(?:分钟|分|小时|钟头|h|min)?$/i.test(t)) return false;
  return true;
}

function cleanPhrase(raw: string): string | null {
  let p = (raw || "").trim();
  p = p.replace(DURATION_PREFIX, "").trim();
  p = stripDurationTail(p);
  p = p.replace(/^(了|的)/, "").trim();
  if (!isValidTaskTitle(p)) return null;
  return p.slice(0, 60);
}

/** Extract completion objects; duration verbs (花了/用了/学了) never become titles */
export function extractCompletedPhrases(text: string): string[] {
  const fromDoneObject: string[] = [];
  const fromObjectDone: string[] = [];

  // Prefer 「完成了 X」— object after done-verb
  const afterDone =
    /(?:完成了?|做完了?|学完了?|看完了?|写完了?|搞定了?|勾掉了?|打卡了?)([^\n，。！？,.!?]{1,40})/g;
  let m: RegExpExecArray | null;
  while ((m = afterDone.exec(text))) {
    const p = cleanPhrase(m[1] || "");
    if (p) fromDoneObject.push(p);
  }

  // 「把 X 完成」
  const baDone = /把([^\n，。！？,.!?]{1,30})(?:完成|做完|学完|搞定)/g;
  while ((m = baDone.exec(text))) {
    const p = cleanPhrase(m[1] || "");
    if (p) fromDoneObject.push(p);
  }

  // 「X 完成了」— strip leading duration clauses like 「我花了3h」
  const beforeDone =
    /([^\n，。！？,.!?]{2,40})(?:完成了|做完了|学完了|搞定了|打卡了)/g;
  while ((m = beforeDone.exec(text))) {
    let raw = (m[1] || "").trim();
    // Drop everything through the last duration marker so 「我花了3h」vanishes
    raw = raw.replace(
      /^.*?(?:花了|用了|学了|投入了|花费了)\s*\d+(?:\.\d+)?\s*(?:个)?\s*(?:小时|钟头|分钟|分|h|min)?\s*/i,
      ""
    );
    const p = cleanPhrase(raw);
    if (p) fromObjectDone.push(p);
  }

  // Prefer objects after 完成了; only fall back to before-verb if none
  const preferred = fromDoneObject.length ? fromDoneObject : fromObjectDone;
  return [...new Set(preferred.filter((p) => isValidTaskTitle(p)))];
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

function unwrapQuotedNames(text: string): string[] {
  const names: string[] = [];
  const patterns = [
    /[「『"']([^」』"']{1,40})[」』"']/g,
    /[《\[]([^》\]]{1,40})[》\]]/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = (m[1] || "").trim();
      if (n) names.push(n);
    }
  }
  return names;
}

/** Corrections / deletes: 「X」不是任务、删掉「X」、撤销 X */
export function detectTaskCorrections(text: string): string[] {
  const names = new Set<string>();
  for (const n of unwrapQuotedNames(text)) names.add(n);

  const notTask = text.match(
    /[「『"']?([^」』"'，。！？\s]{1,30})[」』"']?\s*(?:不是任务|不是待办|不是todo|错了|弄错了|不对)/i
  );
  if (notTask?.[1]) names.add(notTask[1].trim());

  const del = text.match(
    /(?:删掉|删除|去掉|移除|撤销|取消)(?:任务|待办)?\s*[「『"']?([^」』"'，。！？\s]{1,30})[」』"']?/
  );
  if (del?.[1]) names.add(del[1].trim());

  // 「把 X 删了」
  const baDel = text.match(
    /把\s*[「『"']?([^」』"']{1,30})[」』"']?\s*(?:删掉|删除|去掉|撤销)/
  );
  if (baDel?.[1]) names.add(baDel[1].trim());

  return [...names].filter((n) => n.length >= 1);
}

function applyDeletions(
  tasks: Task[],
  today: string,
  names: string[]
): { tasks: Task[]; changes: ProgressChange[] } {
  const changes: ProgressChange[] = [];
  let next = [...tasks];
  for (const name of names) {
    const todayTasks = next.filter((t) => t.date === today);
    // Exact / high similarity match; also match invalid titles the parser once created
    const match =
      todayTasks.find((t) => normalize(t.text) === normalize(name)) ||
      bestTaskMatch(todayTasks, name) ||
      todayTasks.find((t) => normalize(t.text).includes(normalize(name)));
    if (match) {
      next = next.filter((t) => t.id !== match.id);
      changes.push({ action: "deleted", task: match });
    }
  }
  return { tasks: next, changes };
}

export function detectAndApplyProgress(
  data: AppData,
  userText: string
): { data: AppData; changes: ProgressChange[]; progressNote?: string } {
  const today = todayKey();
  const corrections = detectTaskCorrections(userText);
  let tasks = [...data.tasks];
  const changes: ProgressChange[] = [];

  if (corrections.length) {
    const deleted = applyDeletions(tasks, today, corrections);
    tasks = deleted.tasks;
    changes.push(...deleted.changes);
  }

  const minutes = parseMinutes(userText);
  const looksDone = DONE_VERBS.test(userText) || /打卡|搞定|完成/.test(userText);
  const phrases = extractCompletedPhrases(userText);

  // Duration-only update on a recently unfinished or last mentioned task
  if (!looksDone && minutes && !phrases.length && !corrections.length) {
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
    : looksDone && !corrections.length
      ? (() => {
          // Strip done verbs AND duration clauses before using remainder as title
          let rest = userText
            .replace(DONE_VERBS, " ")
            .replace(
              /(?:我)?(?:花了|用了|学了|投入了|花费了)\s*\d+(?:\.\d+)?\s*(?:个)?\s*(?:小时|钟头|分钟|分|h|min)?/gi,
              " "
            )
            .replace(/\d+(?:\.\d+)?\s*(?:个)?\s*(?:小时|钟头|分钟|分|min|h)/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 40);
          const cleaned = cleanPhrase(rest);
          return cleaned ? [cleaned] : [];
        })()
      : [];

  // Apply minutes only once across all created/checked tasks in this turn
  let minutesApplied = false;
  for (const phrase of toProcess) {
    if (!phrase || !isValidTaskTitle(phrase)) continue;
    const todayTasks = tasks.filter((t) => t.date === today);
    const match = bestTaskMatch(todayTasks, phrase);
    const addMin = !minutesApplied && minutes ? minutes : undefined;
    if (match) {
      tasks = tasks.map((t) => {
        if (t.id !== match.id) return t;
        return {
          ...t,
          done: true,
          minutesSpent: addMin
            ? (t.minutesSpent || 0) + addMin
            : t.minutesSpent,
        };
      });
      const updated = tasks.find((t) => t.id === match.id)!;
      changes.push({
        action: match.done && !addMin ? "updated" : "checked",
        task: updated,
        minutes: addMin,
      });
      if (addMin) minutesApplied = true;
    } else {
      const created: Task = {
        id: uid("task"),
        text: phrase.slice(0, 60),
        done: true,
        date: today,
        minutesSpent: addMin,
      };
      tasks = [...tasks, created];
      changes.push({ action: "created", task: created, minutes: addMin });
      if (addMin) minutesApplied = true;
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

  // Dedupe by task id keeping last (deletes win if same id somehow)
  const byId = new Map<string, ProgressChange>();
  for (const c of changes) byId.set(`${c.action}:${c.task.id}`, c);
  // Collapse create+delete noise: if deleted, drop other actions for that id
  const deletedIds = new Set(
    changes.filter((c) => c.action === "deleted").map((c) => c.task.id)
  );
  const unique = [...byId.values()].filter(
    (c) => c.action === "deleted" || !deletedIds.has(c.task.id)
  );

  const note = unique
    .map((c) => {
      const time = c.minutes ? ` · ${c.minutes} 分钟` : "";
      if (c.action === "created") return `新建并完成「${c.task.text}」${time}`;
      if (c.action === "checked") return `勾选完成「${c.task.text}」${time}`;
      if (c.action === "deleted") return `已删除「${c.task.text}」`;
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
      if (c.action === "deleted") return `· 已删掉「${c.task.text}」`;
      return `· 「${c.task.text}」用时已更新${time}`;
    });
    const openHint = prog.open.length
      ? `还剩：${prog.open
          .slice(0, 2)
          .map((t) => t.text)
          .join("、")}${prog.open.length > 2 ? "…" : ""}。`
      : prog.list.length
        ? "今日清单都亮起来了！"
        : "今日清单空了，需要再加任务随时跟我说。";
    const goalLine = goal ? `朝着「${goal}」又近了一步。` : "今天的你很稳。";
    const deletedOnly = changes.every((c) => c.action === "deleted");
    return `${name}，收到啦！${wag}\n\n我已经帮你同步进度：\n${lines.join("\n")}\n\n今日 ${prog.done.length}/${prog.list.length || 0} · ${prog.pct}%${prog.minutes ? ` · 累计约 ${prog.minutes} 分钟` : ""}。${deletedOnly ? "" : goalLine}${openHint}`;
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
    text: `嗨 ${name}！我是小辰～像一只快乐小狗一样陪你学习（比喻，不是真狗啦）。\n\n跟我汇报「完成了什么、学了多久」，我会自动勾任务、记时长，再摇尾巴鼓励你。你的目标、课件和任务列表我都会记住。\n\n记错了也没关系：说「删掉「某某」」或「「某某」不是任务」，我会帮你改回来。`,
    createdAt: Date.now(),
  };
}

export function applyXiaoChenTurn(
  data: AppData,
  userText: string
): Omit<XiaoChenResult, "mode"> {
  const trimmed = userText.trim();
  const { data: next, changes, progressNote } = detectAndApplyProgress(
    data,
    trimmed
  );
  const reply = buildLocalXiaoChenReply(next, trimmed, changes);
  return { reply, data: next, changes, progressNote };
}
