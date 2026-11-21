import type { Material } from "./types";

function tokenize(text: string): string[] {
  const cleaned = text.toLowerCase().replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const grams: string[] = [];
  for (const p of parts) {
    if (/[\u4e00-\u9fff]/.test(p)) {
      for (let i = 0; i < p.length; i++) {
        grams.push(p[i]!);
        if (i + 1 < p.length) grams.push(p.slice(i, i + 2));
        if (i + 2 < p.length) grams.push(p.slice(i, i + 3));
      }
    } else if (p.length > 1) {
      grams.push(p);
    }
  }
  return grams;
}

function score(query: string, doc: string) {
  const q = new Set(tokenize(query));
  if (!q.size) return 0;
  const d = tokenize(doc);
  let hit = 0;
  const bag = new Set(d);
  for (const t of q) {
    if (bag.has(t)) hit += t.length > 1 ? 2 : 1;
  }
  return hit / Math.sqrt(d.length + 1);
}

export function retrieveLocal(
  question: string,
  materials: Material[],
  topK = 3
): { answer: string; citations: { title: string; snippet: string }[] } {
  if (!materials.length) {
    return {
      answer:
        "还没有课件资料。先在「资料」里粘贴或上传课程内容，我就能根据你的材料回答。",
      citations: [],
    };
  }

  const ranked = materials
    .map((m) => ({
      m,
      s: score(question, `${m.title}\n${m.content}`),
    }))
    .sort((a, b) => b.s - a.s);

  const top = ranked.filter((r) => r.s > 0).slice(0, topK);
  if (!top.length) {
    return {
      answer:
        "在已上传的资料里没有找到很贴近的内容。可以换个问法，或补充相关课件后再问我。",
      citations: [],
    };
  }

  const citations = top.map(({ m }) => {
    const idx = m.content.indexOf(question.slice(0, 4));
    const start = idx >= 0 ? Math.max(0, idx - 20) : 0;
    const snippet = m.content.slice(start, start + 160).trim();
    return { title: m.title, snippet: snippet || m.content.slice(0, 160) };
  });

  const body = citations
    .map((c, i) => `【${i + 1} · ${c.title}】\n${c.snippet}`)
    .join("\n\n");

  return {
    answer: `根据你上传的资料，相关内容如下（本地检索，未调用模型）：\n\n${body}\n\n若需要更完整的讲解，可配置模型密钥后再次提问。`,
    citations,
  };
}
