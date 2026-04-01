export const SOROBAN_RPC_TIMEOUT_MS = 8_000;
export const SOROBAN_RPC_MAX_RETRIES = 3;
export const SOROBAN_RPC_RETRY_BASE_DELAY_MS = 200;

declare const setTimeout: (handler: (...args: unknown[]) => void, timeout?: number) => unknown;

export interface SorobanClientConfig {
  rpcUrl: string;
  networkPassphrase: string;
  timeoutMs?: number;
  maxRetries?: number;
  baseDelayMs?: number;
}

export interface HttpAdapterRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

export interface HttpAdapterResponse {
  status: number;
  json: unknown;
}

export interface HttpAdapter {
  send(request: HttpAdapterRequest): Promise<HttpAdapterResponse>;
}

export interface SimulateContractCallParams {
  transaction: string;
  resourceConfig?: Record<string, unknown>;
}

export interface SimulateContractCallResult {
  id: string;
  latestLedger?: number;
  transactionData?: string;
  minResourceFee?: string;
  raw: unknown;
}

export interface SendTransactionParams {
  transaction: string;
}

export interface SendTransactionResult {
  id: string;
  hash?: string;
  status?: string;
  raw: unknown;
}

export interface GetLedgerEntryParams {
  key: string;
}

export interface GetLedgerEntryResult {
  id: string;
  latestLedger?: number;
  entries?: unknown[];
  raw: unknown;
}

export interface JsonRpcSuccess<T> {
  jsonrpc: "2.0";
  id: string;
  result: T;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: string;
  error: JsonRpcError;
}

export type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcFailure;

class FetchHttpAdapter implements HttpAdapter {
  async send(request: HttpAdapterRequest): Promise<HttpAdapterResponse> {
    const fetchRef = (globalThis as unknown as {
      fetch?: (url: string, init?: {
        method?: string;
        headers?: Record<string, string>;
        body?: string;
      }) => Promise<{
        status: number;
        json: () => Promise<unknown>;
      }>;
    }).fetch;

    if (!fetchRef) {
      throw new Error("Global fetch is unavailable in runtime.");
    }

    const response = await fetchRef(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    const json = await response.json().catch(() => null);
    return {
      status: response.status,
      json,
    };
  }
}

export class SorobanClient {
  private readonly config: Required<Pick<SorobanClientConfig, "rpcUrl" | "networkPassphrase" | "timeoutMs" | "maxRetries" | "baseDelayMs">>;
  private readonly httpAdapter: HttpAdapter;

  constructor(config: SorobanClientConfig, httpAdapter: HttpAdapter = new FetchHttpAdapter()) {
    this.config = {
      rpcUrl: config.rpcUrl,
      networkPassphrase: config.networkPassphrase,
      timeoutMs: config.timeoutMs ?? SOROBAN_RPC_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? SOROBAN_RPC_MAX_RETRIES,
      baseDelayMs: config.baseDelayMs ?? SOROBAN_RPC_RETRY_BASE_DELAY_MS,
    };
    this.httpAdapter = httpAdapter;
  }

  async simulateContractCall(params: SimulateContractCallParams): Promise<SimulateContractCallResult> {
    const response = await this.rpcCall<Record<string, unknown>>(
      "simulateTransaction",
      {
        transaction: params.transaction,
        resourceConfig: params.resourceConfig,
      },
      { retry: true, idempotentRead: true },
    );

    return {
      id: response.id,
      latestLedger: this.toNumber(response.result.latestLedger),
      transactionData: this.toString(response.result.transactionData),
      minResourceFee: this.toString(response.result.minResourceFee),
      raw: response.result,
    };
  }

  async sendTransaction(params: SendTransactionParams): Promise<SendTransactionResult> {
    const response = await this.rpcCall<Record<string, unknown>>(
      "sendTransaction",
      {
        transaction: params.transaction,
      },
      { retry: false, idempotentRead: false },
    );

    return {
      id: response.id,
      hash: this.toString(response.result.hash),
      status: this.toString(response.result.status),
      raw: response.result,
    };
  }

  async getLedgerEntry(params: GetLedgerEntryParams): Promise<GetLedgerEntryResult> {
    const response = await this.rpcCall<Record<string, unknown>>(
      "getLedgerEntries",
      {
        keys: [params.key],
      },
      { retry: true, idempotentRead: true },
    );

    const entriesValue = response.result.entries;

    return {
      id: response.id,
      latestLedger: this.toNumber(response.result.latestLedger),
      entries: Array.isArray(entriesValue) ? entriesValue : undefined,
      raw: response.result,
    };
  }

  private async rpcCall<T extends Record<string, unknown>>(
    method: string,
    params: Record<string, unknown>,
    options: { retry: boolean; idempotentRead: boolean },
  ): Promise<JsonRpcSuccess<T>> {
    const attemptLimit = options.retry ? this.config.maxRetries + 1 : 1;

    let attempt = 0;
    while (attempt < attemptLimit) {
      attempt += 1;

      try {
        const payload = {
          jsonrpc: "2.0",
          id: this.makeRequestId(),
          method,
          params,
        };

        const response = await this.withTimeout(
          this.httpAdapter.send({
            url: this.config.rpcUrl,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-network-passphrase": this.config.networkPassphrase,
            },
            body: JSON.stringify(payload),
            timeoutMs: this.config.timeoutMs,
          }),
          this.config.timeoutMs,
        );

        if (response.status < 200 || response.status >= 300) {
          throw new Error(`Soroban RPC HTTP ${response.status}`);
        }

        const parsed = this.parseResponse<T>(response.json);
        if ("error" in parsed) {
          throw new Error(`Soroban RPC ${parsed.error.code}: ${parsed.error.message}`);
        }

        return parsed;
      } catch (error) {
        const isLastAttempt = attempt >= attemptLimit;
        if (isLastAttempt) {
          throw this.toSafeError(method, error, options.idempotentRead);
        }

        await this.sleep(this.backoffDelayForAttempt(attempt));
      }
    }

    throw new Error("Unreachable retry state");
  }

  private parseResponse<T extends Record<string, unknown>>(value: unknown): JsonRpcResponse<T> {
    if (!value || typeof value !== "object") {
      throw new Error("Invalid JSON-RPC response format");
    }

    const candidate = value as Record<string, unknown>;

    if (candidate.jsonrpc !== "2.0") {
      throw new Error("Unexpected JSON-RPC version");
    }

    if (typeof candidate.id !== "string") {
      throw new Error("Missing JSON-RPC response id");
    }

    if (candidate.error && typeof candidate.error === "object") {
      const rpcError = candidate.error as Record<string, unknown>;
      return {
        jsonrpc: "2.0",
        id: candidate.id,
        error: {
          code: typeof rpcError.code === "number" ? rpcError.code : -1,
          message: typeof rpcError.message === "string" ? rpcError.message : "Unknown RPC error",
          data: rpcError.data,
        },
      };
    }

    return {
      jsonrpc: "2.0",
      id: candidate.id,
      result: (candidate.result ?? {}) as T,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  private backoffDelayForAttempt(attempt: number): number {
    return this.config.baseDelayMs * (2 ** (attempt - 1));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(() => resolve(), ms));
  }

  private makeRequestId(): string {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  private toString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }

  private toNumber(value: unknown): number | undefined {
    return typeof value === "number" ? value : undefined;
  }

  private toSafeError(method: string, error: unknown, idempotentRead: boolean): Error {
    const detail = error instanceof Error ? error.message : "Unknown error";
    const operationType = idempotentRead ? "idempotent read" : "write";
    return new Error(`Soroban RPC ${method} failed (${operationType}): ${detail}`);
  }
}
