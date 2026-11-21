import { NextResponse } from "next/server";

type Body = {
  message?: string;
  userName?: string;
  goals?: string;
  studyPlan?: string;
  tasksSummary?: string;
  materialsContext?: string;
  progressNote?: string;
  localReply?: string;
  history?: { role: string; text: string }[];
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "请先输入内容" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      mode: "unavailable",
      reply: null,
      message: "未配置 OPENAI_API_KEY，使用本地小辰回复。",
    });
  }

  const history = (body.history ?? []).slice(-8);
  const system = `你是「加油学」里的伙伴「小辰」：开朗活泼，常用「快乐小狗」作比喻（不是真的狗），说简体中文，温暖有活力，但不油腻、不刷屏表情。
你不是通用聊天机器人：必须结合用户的长期目标、课件资料摘要、今日任务列表来回应。
若用户汇报完成任务或学习时长，系统可能已自动改进度；progressNote 里是已同步的结果，请确认并鼓励，不要否认已勾选的进度。
回答简洁（一般不超过 180 字），可提下一步很小的行动。资料不足时诚实说。`;

  const memory = `用户称呼：${body.userName || "同学"}
长期目标：${(body.goals || "（未填）").slice(0, 500)}
学习计划：${(body.studyPlan || "（未填）").slice(0, 500)}
任务概况：${(body.tasksSummary || "（无）").slice(0, 800)}
课件摘要：${(body.materialsContext || "（无）").slice(0, 6000)}
本次进度同步：${body.progressNote || "（无自动进度变更）"}
本地草稿回复（可润色，勿推翻事实）：${(body.localReply || "").slice(0, 800)}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.7,
        messages: [
          { role: "system", content: system },
          { role: "system", content: memory },
          ...history.map((h) => ({
            role: h.role === "xiaochen" ? "assistant" : "user",
            content: h.text.slice(0, 600),
          })),
          { role: "user", content: message },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("小辰 LLM error", res.status, errText.slice(0, 200));
      return NextResponse.json({
        mode: "error",
        reply: null,
        message: "模型暂时不可用，已用本地小辰回复。",
      });
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const reply = data.choices?.[0]?.message?.content?.trim() || null;
    return NextResponse.json({ mode: "llm", reply });
  } catch (e) {
    console.error("小辰 LLM fetch failed", e);
    return NextResponse.json({
      mode: "error",
      reply: null,
      message: "网络失败，已用本地小辰回复。",
    });
  }
}
