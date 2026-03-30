export type TransactionSignerMode = "backend_sign" | "external_signer";

export interface TransactionServiceConfig {
  mode: TransactionSignerMode;
  horizonUrl: string;
  nodeEnv: "development" | "production" | "test";
  signingSeed?: string;
  signingKmsKeyId?: string;
  externalSignerUrl?: string;
}

export interface TransactionSigner {
  signTransactionXdr(unsignedXdr: string): Promise<string>;
}

export interface TransactionSubmissionResult {
  hash: string;
  ledger?: number;
  raw?: unknown;
}

export interface TransactionNetworkClient {
  submitSignedTransaction(signedXdr: string): Promise<TransactionSubmissionResult>;
}

export interface SubmitTransactionInput {
  unsignedXdr: string;
}

export type SubmitTransactionOutcome =
  | {
      status: "submitted";
      mode: TransactionSignerMode;
      hash: string;
      ledger?: number;
      signedXdr: string;
    }
  | {
      status: "awaiting_external_signature";
      mode: "external_signer";
      unsignedXdr: string;
      signerUrl?: string;
    };

export const buildTransactionServiceConfigFromEnv = (
  config: {
    RPC_URL: string;
    NODE_ENV: "development" | "production" | "test";
    TX_SIGNER_MODE: TransactionSignerMode;
    TX_SIGNING_SEED?: string;
    TX_SIGNING_KMS_KEY_ID?: string;
    TX_EXTERNAL_SIGNER_URL?: string;
  },
): TransactionServiceConfig => ({
  mode: config.TX_SIGNER_MODE,
  horizonUrl: config.RPC_URL,
  nodeEnv: config.NODE_ENV,
  signingSeed: config.TX_SIGNING_SEED,
  signingKmsKeyId: config.TX_SIGNING_KMS_KEY_ID,
  externalSignerUrl: config.TX_EXTERNAL_SIGNER_URL,
});

export class HorizonNetworkClient implements TransactionNetworkClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async submitSignedTransaction(signedXdr: string): Promise<TransactionSubmissionResult> {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl.slice(0, -1) : this.baseUrl;
    const endpoint = `${base}/transactions`;
    const body = `tx=${encodeURIComponent(signedXdr)}`;

    const globalFetch = (
      globalThis as unknown as {
        fetch?: (url: string, init?: {
          method?: string;
          headers?: Record<string, string>;
          body?: string;
        }) => Promise<{
          ok: boolean;
          status: number;
          json: () => Promise<unknown>;
        }>;
      }
    ).fetch;

    if (!globalFetch) {
      throw new Error("Global fetch is unavailable in the runtime environment.");
    }

    const response = await globalFetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(`Network rejected transaction with status ${response.status}`);
    }

    const parsedPayload = payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;

    const hash = parsedPayload && typeof parsedPayload.hash === "string"
      ? parsedPayload.hash
      : "unknown";
    const ledger = parsedPayload && typeof parsedPayload.ledger === "number"
      ? parsedPayload.ledger
      : undefined;

    return { hash, ledger, raw: parsedPayload };
  }
}

export class DevelopmentSeedSigner implements TransactionSigner {
  private readonly seed: string;

  constructor(seed: string) {
    this.seed = seed;
  }

  async signTransactionXdr(unsignedXdr: string): Promise<string> {
    if (!this.seed) {
      throw new Error("Missing development signing seed");
    }

    // Development-only placeholder signature marker.
    return `${unsignedXdr}.devsig`;
  }
}

export class TransactionService {
  private readonly config: TransactionServiceConfig;
  private readonly networkClient: TransactionNetworkClient;
  private readonly signer?: TransactionSigner;

  constructor(
    config: TransactionServiceConfig,
    networkClient: TransactionNetworkClient,
    signer?: TransactionSigner,
  ) {
    this.config = config;
    this.networkClient = networkClient;
    this.signer = signer;
  }

  async submitTransaction(input: SubmitTransactionInput): Promise<SubmitTransactionOutcome> {
    this.assertUnsignedXdr(input.unsignedXdr);

    if (this.config.mode === "external_signer") {
      return {
        status: "awaiting_external_signature",
        mode: "external_signer",
        unsignedXdr: input.unsignedXdr,
        signerUrl: this.config.externalSignerUrl,
      };
    }

    if (!this.signer) {
      throw new Error("Signer is required when TX_SIGNER_MODE=backend_sign");
    }

    try {
      const signedXdr = await this.signer.signTransactionXdr(input.unsignedXdr);
      return this.submitSignedXdr(signedXdr, "backend_sign");
    } catch (error) {
      throw this.toSafeError("Failed to sign and submit transaction", error);
    }
  }

  async submitSignedXdr(
    signedXdr: string,
    mode: TransactionSignerMode = "external_signer",
  ): Promise<SubmitTransactionOutcome> {
    if (!signedXdr || !signedXdr.trim()) {
      throw new Error("signedXdr is required");
    }

    try {
      const result = await this.networkClient.submitSignedTransaction(signedXdr);
      return {
        status: "submitted",
        mode,
        hash: result.hash,
        ledger: result.ledger,
        signedXdr,
      };
    } catch (error) {
      throw this.toSafeError("Failed to submit transaction", error);
    }
  }

  private assertUnsignedXdr(unsignedXdr: string): void {
    if (!unsignedXdr || !unsignedXdr.trim()) {
      throw new Error("unsignedXdr is required");
    }
  }

  private toSafeError(message: string, cause: unknown): Error {
    const details = cause instanceof Error ? this.redact(cause.message) : "Unknown error";
    return new Error(`${message}: ${details}`);
  }

  private redact(value: string): string {
    let redacted = value;

    if (this.config.signingSeed) {
      redacted = redacted.split(this.config.signingSeed).join("[REDACTED]");
    }

    return redacted;
  }
}
