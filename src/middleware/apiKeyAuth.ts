import crypto from "crypto";
import { NextFunction, Request, Response } from "express";

const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/i;
const AUTHORIZATION_API_KEY_REGEX = /^ApiKey\s+(.+)$/i;

declare module "express" {
  interface Request {
    apiKey?: {
      id: string;
    };
  }
}

/**
 * Persisted representation of an API key.
 *
 * The plaintext key is never stored — only its SHA-256 hash. Revoked records
 * stay in the store so validation performs digest comparison work for active
 * and rotated-out keys while still rejecting revoked matches.
 */
export interface ApiKeyRecord {
  /** Stable identifier exposed to operators (e.g. for audit logs). */
  id: string;
  /** SHA-256 hex digest of the plaintext API key. */
  hash: string;
  /** True once the key has been rotated out; the store rejects matches. */
  revoked: boolean;
}

type StoredApiKeyRecord = {
  record: ApiKeyRecord;
  hashBuffer: Buffer;
};

const copyApiKeyRecord = (record: ApiKeyRecord): ApiKeyRecord => ({ ...record });
const normalizeHash = (hash: string): string => hash.toLowerCase();

/**
 * In-memory store of {@link ApiKeyRecord} entries keyed by stable key id.
 *
 * Requests are checked by hashing the candidate key and comparing that digest
 * against every configured record with `crypto.timingSafeEqual`. Stored digests
 * are validated and pre-decoded to `Buffer`s when records are added, avoiding
 * repeated hex parsing on every request. The scan intentionally does not
 * short-circuit on a match, which avoids leaking which key id matched and keeps
 * revoked records on the same comparison path as active records.
 */
export class ApiKeyStore {
  private readonly keys = new Map<string, StoredApiKeyRecord>();

  constructor(initialKeys: ApiKeyRecord[] = []) {
    for (const key of initialKeys) {
      this.addKeyRecord(key);
    }
  }

  addKeyRecord(record: ApiKeyRecord): void {
    if (!record || !record.id || !record.hash || typeof record.revoked !== "boolean") {
      throw new Error("ApiKeyStore: invalid key record");
    }

    if (!SHA256_HEX_REGEX.test(record.hash)) {
      throw new Error("ApiKeyStore: key hash must be a SHA-256 hex digest");
    }

    const normalizedRecord = copyApiKeyRecord({
      ...record,
      hash: normalizeHash(record.hash),
    });

    this.keys.set(normalizedRecord.id, {
      record: normalizedRecord,
      hashBuffer: Buffer.from(normalizedRecord.hash, "hex"),
    });
  }

  addPlaintextKey(id: string, apiKey: string, revoked = false): ApiKeyRecord {
    const record: ApiKeyRecord = { id, hash: hashApiKey(apiKey), revoked };
    this.addKeyRecord(record);
    return copyApiKeyRecord(record);
  }

  revokeKey(id: string): void {
    const entry = this.keys.get(id);
    if (!entry) return;

    this.keys.set(id, {
      ...entry,
      record: { ...entry.record, revoked: true },
    });
  }

  clear(): void {
    this.keys.clear();
  }

  getKeys(): ApiKeyRecord[] {
    return Array.from(this.keys.values(), ({ record }) => copyApiKeyRecord(record));
  }

  findKeyByValue(apiKey: string): ApiKeyRecord | null {
    const candidateBuffer = Buffer.from(hashApiKey(apiKey), "hex");
    let matchedRecord: ApiKeyRecord | null = null;

    for (const { record, hashBuffer } of this.keys.values()) {
      const isMatch = crypto.timingSafeEqual(candidateBuffer, hashBuffer);

      if (isMatch && !record.revoked) {
        matchedRecord = record;
      }
    }

    return matchedRecord ? copyApiKeyRecord(matchedRecord) : null;
  }

  static fromEnv(): ApiKeyStore {
    const store = new ApiKeyStore();

    const plaintextValues = process.env.API_KEYS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];

    for (const [index, apiKey] of plaintextValues.entries()) {
      store.addPlaintextKey(`env-${index}`, apiKey);
    }

    const hashedValues = process.env.API_KEY_HASHES?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];

    for (const [index, hash] of hashedValues.entries()) {
      if (!SHA256_HEX_REGEX.test(hash)) {
        throw new Error("API_KEY_HASHES must be a comma-separated list of SHA-256 hex hashes");
      }

      store.addKeyRecord({ id: `env-hash-${index}`, hash, revoked: false });
    }

    return store;
  }
}

export const hashApiKey = (apiKey: string): string => {
  if (!apiKey) {
    throw new Error("API key is required for hashing");
  }

  return crypto.createHash("sha256").update(apiKey, "utf-8").digest("hex");
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

const parseAuthorizationApiKey = (headerValue: string): string | null => {
  const match = headerValue.trim().match(AUTHORIZATION_API_KEY_REGEX);
  return match ? match[1].trim() : null;
};

const getApiKeyFromRequest = (req: Request): string | undefined => {
  const headerApiKey = req.header("x-api-key")?.trim();
  if (headerApiKey) return headerApiKey;

  const authorizationHeader = req.header("authorization");
  if (!authorizationHeader) return undefined;

  return parseAuthorizationApiKey(authorizationHeader) ?? undefined;
};

export const apiKeyAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.path === "/streams/export.csv") {
    next();
    return;
  }

  const apiKey = getApiKeyFromRequest(req);

  if (!apiKey) {
    res.status(401).json({ error: "API key missing" });
    return;
  }

  const record = apiKeyStore.findKeyByValue(apiKey);

  if (!record) {
    res.status(401).json({ error: "API key invalid or revoked" });
    return;
  }

  // Inject metadata for downstream handlers if needed.
  req.apiKey = { id: record.id };
  next();
};
