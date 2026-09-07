import { createHash, randomUUID } from "node:crypto";
import * as z from "zod";
import { CliError } from "../errors.js";
import type { SecretStore } from "./store.js";

const prefix = "cinacli-chunks-v1:";
const manifestSchema = z.strictObject({ generation: z.uuid(), parts: z.number().int().min(1).max(88), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
type Manifest = z.infer<typeof manifestSchema>;
function manifest(raw: string | undefined): Manifest | undefined {
  if (!raw?.startsWith(prefix)) return undefined;
  try { return manifestSchema.parse(JSON.parse(raw.slice(prefix.length))); }
  catch { throw new CliError("AUTHENTICATION_FAILED", "凭据库分块索引损坏，请重新登录。"); }
}
const partKey = (key: string, generation: string, index: number) => `${key}/${generation}/${index}`;
// A damaged index must not prevent an explicit replacement or local logout.
function cleanupManifest(raw: string | undefined): Manifest | undefined {
  try { return manifest(raw); } catch { return undefined; }
}

/** Keep every native value below Windows' blob limit; publish the root index last. */
export function chunkedSecretStore(raw: SecretStore): SecretStore {
  async function clean(key: string, old: Manifest | undefined) {
    if (old) for (let index = 0; index < old.parts; index++) await raw.remove(partKey(key, old.generation, index)).catch(() => {});
  }
  return {
    async get(key, signal) {
      let root = await raw.get(key, signal);
      for (let attempt = 0; attempt < 3; attempt++) {
        const index = manifest(root);
        if (!index) return root;
        let decoded: string | undefined;
        let invalid: CliError | undefined;
        try {
          let encoded = "";
          for (let part = 0; part < index.parts; part++) {
            signal?.throwIfAborted();
            const value = await raw.get(partKey(key, index.generation, part), signal);
            if (!value || value.length > 1000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new CliError("AUTHENTICATION_FAILED", "凭据库分块缺失或损坏，请重新登录。");
            encoded += value;
          }
          const bytes = Buffer.from(encoded, "base64");
          if (bytes.length > 65_536 || bytes.toString("base64") !== encoded || createHash("sha256").update(bytes).digest("hex") !== index.sha256) throw new CliError("AUTHENTICATION_FAILED", "凭据库分块校验失败，请重新登录。");
          decoded = bytes.toString("utf8");
        } catch (error) {
          if (!(error instanceof CliError) || error.code !== "AUTHENTICATION_FAILED") throw error;
          invalid = error;
        }
        // A writer may publish a replacement and retire parts while we read the old index.
        const current = await raw.get(key, signal);
        if (current !== root) { root = current; continue; }
        if (invalid) throw invalid;
        return decoded;
      }
      throw new CliError("CONFLICT", "凭据在读取期间持续更新，请稍后重试。");
    },
    async set(key, value, signal) {
      signal?.throwIfAborted();
      const bytes = Buffer.from(value, "utf8");
      if (bytes.length > 65_536) throw new CliError("CAPABILITY_UNAVAILABLE", "凭据超过系统存储适配器的大小限制。");
      const old = cleanupManifest(await raw.get(key, signal));
      if (value.length <= 1000 && !value.startsWith(prefix)) {
        await raw.set(key, value, signal);
        await clean(key, old);
        return;
      }
      const encoded = bytes.toString("base64");
      const index: Manifest = { generation: randomUUID(), parts: Math.ceil(encoded.length / 1000), sha256: createHash("sha256").update(bytes).digest("hex") };
      let publishing = false;
      try {
        for (let part = 0; part < index.parts; part++) {
          signal?.throwIfAborted();
          await raw.set(partKey(key, index.generation, part), encoded.slice(part * 1000, (part + 1) * 1000), signal);
        }
        signal?.throwIfAborted();
        publishing = true;
        await raw.set(key, prefix + JSON.stringify(index), signal);
      } catch (error) {
        // If publishing is uncertain, retain the new parts: the index may already refer to them.
        if (!publishing) await clean(key, index);
        throw error;
      }
      await clean(key, old);
    },
    async remove(key, signal) {
      const old = cleanupManifest(await raw.get(key, signal));
      const removed = await raw.remove(key, signal);
      await clean(key, old);
      return removed;
    },
  };
}
