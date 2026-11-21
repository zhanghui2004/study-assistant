/**
 * Quick regression checks for 小辰 progress parser.
 * Run: node --experimental-strip-types is not ideal; use tsx.
 */
import {
  detectAndApplyProgress,
  extractCompletedPhrases,
  detectTaskCorrections,
} from "../lib/xiaochen.ts";
import { DEFAULT_DATA } from "../lib/types.ts";
import { todayKey } from "../lib/storage.ts";

function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const today = todayKey();
const base = { ...DEFAULT_DATA, tasks: [], chatHistory: [] };

// 1) 花了3h完成了vibe-coding → only vibe-coding, 180 min once
{
  const phrases = extractCompletedPhrases("我花了3h完成了vibe-coding");
  assert(
    phrases.length === 1 && phrases[0] === "vibe-coding",
    `phrases=${JSON.stringify(phrases)} expect [vibe-coding]`
  );
  const { data, changes, progressNote } = detectAndApplyProgress(
    base,
    "我花了3h完成了vibe-coding"
  );
  assert(changes.length === 1, `changes.length=${changes.length}`);
  assert(changes[0].task.text === "vibe-coding", `task=${changes[0]?.task.text}`);
  assert(changes[0].minutes === 180, `minutes=${changes[0]?.minutes}`);
  assert(
    data.tasks.filter((t) => t.date === today).length === 1,
    `today tasks=${data.tasks.length}`
  );
  assert(
    !data.tasks.some((t) => t.text.includes("花了")),
    "no 我花了 task"
  );
  assert(!/我花了/.test(progressNote || ""), `note=${progressNote}`);
}

// 2) correction deletes bogus task
{
  const withBogus = {
    ...base,
    tasks: [
      {
        id: "a",
        text: "vibe-coding",
        done: true,
        date: today,
        minutesSpent: 180,
      },
      {
        id: "b",
        text: "我花了",
        done: false,
        date: today,
        minutesSpent: 180,
      },
    ],
  };
  const names = detectTaskCorrections("「我花了」不是任务，是动词spend");
  assert(names.some((n) => n.includes("我花了")), `correction names=${names}`);
  const { data, changes } = detectAndApplyProgress(
    withBogus,
    "「我花了」不是任务，是动词spend"
  );
  assert(
    changes.some((c) => c.action === "deleted" && c.task.text === "我花了"),
    `deleted change=${JSON.stringify(changes)}`
  );
  assert(
    !data.tasks.some((t) => t.text === "我花了"),
    "bogus task removed"
  );
  assert(
    data.tasks.some((t) => t.text === "vibe-coding"),
    "vibe-coding kept"
  );
}

// 3) 删掉「我花了」
{
  const withBogus = {
    ...base,
    tasks: [
      { id: "b", text: "我花了", done: true, date: today, minutesSpent: 180 },
    ],
  };
  const { data, changes } = detectAndApplyProgress(withBogus, "删掉「我花了」");
  assert(changes[0]?.action === "deleted", "delete via 删掉");
  assert(data.tasks.length === 0, "empty after delete");
}

// 4) never create 花了 as title from duration-only
{
  const { changes } = detectAndApplyProgress(base, "我花了40分钟");
  assert(
    !changes.some((c) => /花了/.test(c.task.text) && c.action === "created"),
    "duration-only does not create 花了 task"
  );
}

console.log(process.exitCode ? "\nSOME FAILED" : "\nALL PASSED");
