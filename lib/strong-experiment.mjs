import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { evaluateSnapshot } from "./supervised-model.mjs";
export const STRONG_VERSION = "strong-background-2026-10-15-v1";
const read = async (p, f) => {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return f;
  }
};
export async function retainStrongFirsts(
  root,
  items,
  model,
  background,
  asOf,
  prices = [],
) {
  const dir = path.join(root, "work/strong-models");
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(root, "work/strong-display-config.json");
  let config = await read(configPath, null);
  if (!config) {
    config = {
      version: STRONG_VERSION,
      activatedAt: asOf,
      configuration: "scaled-001",
      note: "用户选择只展示强增权实验；既有记录不补造首次判断。",
    };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), {
      flag: "wx",
    });
  }
  if (
    config.version !== STRONG_VERSION ||
    config.configuration !== "scaled-001"
  )
    throw Error("Strong display version mismatch");
  const modelId =
      STRONG_VERSION +
      "-" +
      createHash("sha256")
        .update(JSON.stringify(model))
        .digest("hex")
        .slice(0, 20),
    modelPath = path.join(dir, modelId + ".json"),
    value = { version: STRONG_VERSION, modelId, model };
  try {
    await fs.writeFile(modelPath, JSON.stringify(value, null, 2), {
      flag: "wx",
    });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    if (JSON.stringify(await read(modelPath, null)) !== JSON.stringify(value))
      throw Error("Strong model collision");
  }
  const storePath = path.join(root, "work/strong-predictions.json"),
    store = await read(storePath, { version: STRONG_VERSION, predictions: [] });
  let inserted = 0;
  for (const item of items) {
    const trial = item.weightEvidence?.trials?.find(
      (t) => t.config.id === "scaled-001",
    );
    if (!trial) continue;
    let first = store.predictions.find(
      (p) => p.recordId === item.record.id && p.modelVersion === STRONG_VERSION,
    );
    const r = item.record;
    if (
      !first &&
      !r.imported &&
      r.sourceType === "original" &&
      new Date(r.createdAt) >= new Date(config.activatedAt) &&
      new Date(r.createdAt) <= new Date(asOf)
    ) {
      first = {
        recordId: r.id,
        publishedAt: r.publishedAt,
        predictionAt: asOf,
        modelVersion: STRONG_VERSION,
        modelId,
        configuration: "scaled-001",
        trainN: background.samples.length,
        pDown: trial.pDown,
        pUp: 1 - trial.pDown,
        direction: trial.pDown >= 0.5 ? "down" : "up",
        features: item.backgroundFeatures.values,
        kind: "first-strong-experiment",
        prospectiveCandidate: true,
        calibrated: false,
      };
      await fs.writeFile(
        path.join(dir, r.id + "-" + STRONG_VERSION + ".json"),
        JSON.stringify(first, null, 2),
        { flag: "wx" },
      );
      store.predictions.push(first);
      inserted++;
    }
    if (first)
      item.firstStrongEstimate = {
        ...first,
        outcome: evaluateSnapshot(first, prices, asOf),
      };
  }
  if (inserted) {
    await fs.writeFile(storePath + ".tmp", JSON.stringify(store, null, 2));
    await fs.rename(storePath + ".tmp", storePath);
  }
  return {
    version: STRONG_VERSION,
    activatedAt: config.activatedAt,
    count: store.predictions.length,
    outcomes: store.predictions.map((p) => evaluateSnapshot(p, prices, asOf)),
    note: "仅用户切换后新采集作品可留首次；旧视频当前试算不计前瞻。",
  };
}
