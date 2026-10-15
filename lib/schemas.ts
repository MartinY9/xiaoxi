import { z } from "zod";
import { LABELS } from "./engine.ts";
export const observationSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  label: z.enum(Object.keys(LABELS) as [string, ...string[]]),
  name: z.string().max(100).optional(),
  kind: z.string().max(50).optional(),
  colors: z.array(z.string().max(30)).max(8).optional(),
  count: z.number().int().min(1).max(10000).optional(),
  position: z.string().max(200).optional(),
  orientation: z.string().max(80).optional(),
  actions: z.array(z.string().max(100)).max(10).optional(),
  relations: z
    .array(
      z.object({
        type: z.string().max(60),
        targetId: z.string().max(100).optional(),
        targetName: z.string().max(100).optional(),
        verified: z.boolean().optional(),
      }),
    )
    .max(12)
    .optional(),
  visibleText: z.array(z.string().max(500)).max(15).optional(),
  description: z.string().max(1000),
  confidence: z.number().min(0).max(1),
  frameIndex: z.number().int().min(0).max(9999),
  evidenceTime: z.number().min(0).max(86400).optional(),
  verified: z.boolean(),
});
export const candidateSchema = z.object({
  id: z.string().max(100),
  cue: z.string().max(300),
  evidenceIds: z.array(z.string().max(100)).min(1).max(10),
  mechanism: z.string().max(500),
  meaning: z.string().max(1000),
  bias: z.enum(["bullish", "bearish", "defensive", "weakness", "unknown"]),
  scope: z.string().max(300),
  horizon: z.string().max(300),
  confidence: z.enum(["low", "medium"]),
  alternatives: z.array(z.string().max(500)).min(1).max(5),
  source: z
    .object({
      title: z.string().max(300),
      url: z
        .string()
        .url()
        .max(1500)
        .refine((v) => {
          const u = new URL(v);
          return (
            ["https:", "http:"].includes(u.protocol) &&
            !u.username &&
            !u.password
          );
        }, "来源链接仅允许不含凭据的HTTP(S)"),
    })
    .optional(),
});
export const recordSchema = z.object({
  title: z.string().min(1).max(300),
  url: z.string().url().max(1500),
  publishedAt: z.string().datetime({ offset: true }),
  sourceType: z.enum(["original", "repost", "unknown"]),
  timeVerified: z.boolean(),
  market: z.enum(["a-share", "hk", "global", "unknown"]),
  observations: z.array(observationSchema).max(30),
  notes: z.string().max(6000),
  frames: z.array(z.string().max(150000)).max(6).optional(),
  fileHash: z.string().max(100).optional(),
  imported: z.boolean().optional(),
  coverage: z.enum(["partial", "complete"]).optional(),
  visibleText: z.array(z.string().max(500)).max(30).optional(),
  semanticCandidates: z.array(candidateSchema).max(10).optional(),
  forecast: z
    .object({
      direction: z.enum(["up", "down"]),
      window: z.enum(["next-trading-day", "3-trading-days", "5-trading-days"]),
      basis: z.enum(["decoder_hypothesis", "explicit_text"]),
      reasoning: z.string().min(1).max(1000),
    })
    .optional(),
  riskWindow: z.literal("5-trading-days-2pct").optional(),
});

// 模型返回值不是已确认的证据。只有人工核对画面后才能进入解码。
export function parseVisionObservations(input: unknown, frameCount: number) {
  if (!Array.isArray(input)) throw new Error("视觉结果格式不正确");
  return input.slice(0, 30).flatMap((o: any, i) => {
    if (!o || typeof o !== "object") return [];
    const parsed = observationSchema.safeParse({
      ...o,
      id: typeof o.id === "string" ? o.id : "vision-" + i,
      label: Object.hasOwn(LABELS, o.label) ? o.label : "other",
      name: typeof o.name === "string" ? o.name : undefined,
      description: String(o.description || "").slice(0, 1000),
      confidence: Math.max(0, Math.min(1, Number(o.confidence) || 0)),
      frameIndex: Math.max(
        0,
        Math.min(frameCount - 1, Math.floor(Number(o.frameIndex) || 0)),
      ),
      verified: false,
      relations: Array.isArray(o.relations)
        ? o.relations.slice(0, 12).map((r: any) => ({ ...r, verified: false }))
        : undefined,
    });
    return parsed.success ? [parsed.data] : [];
  });
}
