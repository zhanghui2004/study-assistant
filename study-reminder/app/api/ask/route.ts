import { NextResponse } from "next/server";

type Body = {
  question?: string;
  context?: string;
  goals?: string;
};

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "请先输入问题" }, { status: 400 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      mode: "unavailable",
      answer: null,
      message: "未配置 OPENAI_API_KEY，已回退到本地检索。",
    });
  }

  const context = (body.context ?? "").slice(0, 12000);
  const goals = (body.goals ?? "").slice(0, 500);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          {
            role: "system",
            content:
              "你是「加油学」学习助手。用简体中文回答，语气温暖、轻轻督促。优先依据用户提供的课件资料；资料不足时诚实说明，不要编造。回答简洁、可执行。",
          },
          {
            role: "user",
            content: `学习目标：${goals || "（未填写）"}\n\n课件资料：\n${context || "（无）"}\n\n问题：${question}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("LLM error", res.status, errText.slice(0, 200));
      return NextResponse.json({
        mode: "error",
        answer: null,
        message: "模型暂时不可用，请使用本地检索结果。",
      });
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const answer = data.choices?.[0]?.message?.content?.trim() || null;
    return NextResponse.json({ mode: "llm", answer });
  } catch (e) {
    console.error("LLM fetch failed", e);
    return NextResponse.json({
      mode: "error",
      answer: null,
      message: "网络或模型调用失败，已回退本地检索。",
    });
  }
}
