import crypto from "crypto";
import { Request, Response, NextFunction } from "express";

declare module "express" {
  interface Request {
    apiKey?: {
      id: string;
    };
  }
}

export interface ApiKeyRecord {
  id: string;
  hash: string; // SHA-256 of API key
  revoked: boolean;
}

export class ApiKeyStore {
  private keys = new Map<string, ApiKeyRecord>();

  constructor(initialKeys: ApiKeyRecord[] = []) {
    for (const key of initialKeys) {
      this.addKeyRecord(key);
    }
  }

  addKeyRecord(record: ApiKeyRecord): void {
    if (!record || !record.id || !record.hash) {
      throw new Error("ApiKeyStore: invalid key record");
    }
    this.keys.set(record.id, record);
  }

  addPlaintextKey(id: string, apiKey: string, revoked = false): ApiKeyRecord {
    const hash = hashApiKey(apiKey);
    const record: ApiKeyRecord = { id, hash, revoked };
    this.addKeyRecord(record);
    return record;
  }

  revokeKey(id: string): void {
    const record = this.keys.get(id);
    if (!record) return;
    record.revoked = true;
    this.keys.set(id, record);
  }

  clear(): void {
    this.keys.clear();
  }

  getKeys(): ApiKeyRecord[] {
    return Array.from(this.keys.values());
  }

  findKeyByValue(apiKey: string): ApiKeyRecord | null {
    const candidateHash = hashApiKey(apiKey);
    const candidateBuffer = Buffer.from(candidateHash, "hex");

    for (const record of this.keys.values()) {
      if (record.revoked) continue;

      const storedBuffer = Buffer.from(record.hash, "hex");

      if (storedBuffer.length !== candidateBuffer.length) {
        continue;
      }

      if (crypto.timingSafeEqual(candidateBuffer, storedBuffer)) {
        return record;
      }
    }

    return null;
  }

  static fromEnv(): ApiKeyStore {
    const store = new ApiKeyStore();

    const plaintextValues = process.env.API_KEYS?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];

    for (const [index, apiKey] of plaintextValues.entries()) {
      store.addPlaintextKey(`env-${index}`, apiKey);
    }

    const hashedValues = process.env.API_KEY_HASHES?.split(",").map((v) => v.trim()).filter(Boolean) ?? [];

    for (const [index, hash] of hashedValues.entries()) {
      if (!/^[0-9a-f]{64}$/i.test(hash)) {
        throw new Error("API_KEY_HASHES must be a comma-separated list of SHA256 hex hashes");
      }
      store.addKeyRecord({ id: `env-hash-${index}`, hash: hash.toLowerCase(), revoked: false });
    }

    return store;
  }
}

export const hashApiKey = (apiKey: string): string => {
  if (!apiKey) {
    throw new Error("API key is required for hashing");
  }
  const hash = crypto.createHash("sha256").update(apiKey, "utf-8").digest("hex");
  return hash;
};

// Shared store; tests can reset.
export const apiKeyStore = ApiKeyStore.fromEnv();

export const refreshApiKeyStore = (): void => {
  apiKeyStore.clear();
  const replacement = ApiKeyStore.fromEnv();
  for (const record of replacement.getKeys()) {
    apiKeyStore.addKeyRecord(record);
  }
};

const parseAuthorization = (headerValue: string): string | null => {
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  const bearerMatch = trimmed.match(/^ApiKey\s+(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1].trim();
  }

  return null;
};

export const apiKeyAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const rawHeader = req.header("x-api-key") || req.header("authorization");

  const apiKey = rawHeader
    ? rawHeader.startsWith("ApiKey")
      ? parseAuthorization(rawHeader)!
      : rawHeader
    : undefined;

  if (!apiKey) {
    res.status(401).json({ error: "API key missing" });
    return;
  }

  const record = apiKeyStore.findKeyByValue(apiKey);

  if (!record) {
    res.status(401).json({ error: "API key invalid or revoked" });
    return;
  }

  // Inject metadata for downstream handlers if needed
  req.apiKey = { id: record.id };
  next();
};
