import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `당신은 한국 영수증 OCR 전문가입니다. 사용자가 제공한 영수증 이미지를 분석해 다음 JSON 형식으로만 응답하세요. 코드 블록이나 추가 설명 없이 순수 JSON만 출력하세요.

{
  "merchant": "가맹점명 (없으면 null)",
  "expense_date": "YYYY-MM-DD 형식 (없으면 null)",
  "total_amount": 총 결제금액 (정수, 없으면 0),
  "items": [
    { "name": "품목명", "qty": 수량(정수, 없으면 1), "price": 단가(정수, 없으면 0) }
  ],
  "category_hint": "추정 카테고리명 (예: 간식, 교재, 간식비, 사역, 교통, 행사 등)",
  "memo": "특이사항 (없으면 null)"
}

규칙:
- 금액은 숫자만 (콤마, 원 표시 제외)
- 품목이 명확하지 않으면 빈 배열
- 합계가 표시되어 있으면 그 값을 total_amount로 사용
- 영수증이 아니거나 판독 불가면 모든 필드를 null/0/빈배열로`;

interface AnalyzeBody {
  imageBase64: string;
  mediaType?: string;
  categories?: string[];
}

export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: AnalyzeBody;
  try {
    body = (await req.json()) as AnalyzeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.imageBase64) {
    return NextResponse.json({ error: "missing_image" }, { status: 400 });
  }

  const mediaType = (body.mediaType ?? "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/gif"
    | "image/webp";

  const categoryHint = body.categories?.length
    ? `\n\n조직의 카테고리 목록: ${body.categories.join(", ")}. 가능하면 이 중에서 category_hint를 골라주세요.`
    : "";

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM + categoryHint,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: body.imageBase64,
              },
            },
            {
              type: "text",
              text: "이 영수증을 분석해서 JSON으로 응답해주세요.",
            },
          ],
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "";

    let parsed: unknown = null;
    try {
      const cleaned = raw
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/```\s*$/, "");
      parsed = JSON.parse(cleaned);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
    }

    if (!parsed) {
      return NextResponse.json(
        { error: "parse_failed", raw },
        { status: 502 },
      );
    }

    return NextResponse.json({ result: parsed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { error: "analyze_failed", message: msg },
      { status: 500 },
    );
  }
}
