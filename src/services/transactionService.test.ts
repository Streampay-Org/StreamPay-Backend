import {
  TransactionNetworkClient,
  TransactionService,
  TransactionSigner,
  buildTransactionServiceConfigFromEnv,
} from "./transactionService";

declare const describe: (name: string, run: () => void) => void;
declare const it: (name: string, run: () => void | Promise<void>) => void;
declare const expect: {
  (value: unknown): {
    toEqual: (expected: unknown) => void;
    toBe: (expected: unknown) => void;
    toContain: (expected: string) => void;
    toHaveBeenCalledWith: (...args: unknown[]) => void;
    toHaveBeenCalled: () => void;
    not: {
      toContain: (expected: string) => void;
      toHaveBeenCalled: () => void;
    };
    rejects: {
      toThrow: (expected: string) => Promise<void>;
    };
  };
};
declare const jest: {
  fn: () => {
    (...args: unknown[]): unknown;
    mockResolvedValue: (value: unknown) => void;
    mockRejectedValue: (value: unknown) => void;
  };
};

describe("TransactionService", () => {
  const createMockNetwork = () => ({
    submitSignedTransaction: jest.fn(),
  });

  const createMockSigner = () => ({
    signTransactionXdr: jest.fn(),
  });

  it("submits signed transaction in backend_sign mode", async () => {
    const network = createMockNetwork();
    const signer = createMockSigner();

    signer.signTransactionXdr.mockResolvedValue("signed-xdr");
    network.submitSignedTransaction.mockResolvedValue({ hash: "abc123", ledger: 10 });

    const service = new TransactionService(
      {
        mode: "backend_sign",
        horizonUrl: "https://horizon-testnet.stellar.org",
        nodeEnv: "development",
      },
      network as TransactionNetworkClient,
      signer as TransactionSigner,
    );

    const result = await service.submitTransaction({ unsignedXdr: "unsigned-xdr" });

    expect(signer.signTransactionXdr).toHaveBeenCalledWith("unsigned-xdr");
    expect(network.submitSignedTransaction).toHaveBeenCalledWith("signed-xdr");
    expect(result).toEqual({
      status: "submitted",
      mode: "backend_sign",
      hash: "abc123",
      ledger: 10,
      signedXdr: "signed-xdr",
    });
  });

  it("returns unsigned XDR instructions in external_signer mode", async () => {
    const network = createMockNetwork();

    const service = new TransactionService(
      {
        mode: "external_signer",
        horizonUrl: "https://horizon-testnet.stellar.org",
        nodeEnv: "production",
        externalSignerUrl: "https://signer.internal",
      },
      network as TransactionNetworkClient,
    );

    const result = await service.submitTransaction({ unsignedXdr: "unsigned-xdr" });

    expect(network.submitSignedTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "awaiting_external_signature",
      mode: "external_signer",
      unsignedXdr: "unsigned-xdr",
      signerUrl: "https://signer.internal",
    });
  });

  it("submits externally signed XDR", async () => {
    const network = createMockNetwork();
    network.submitSignedTransaction.mockResolvedValue({ hash: "hash-1" });

    const service = new TransactionService(
      {
        mode: "external_signer",
        horizonUrl: "https://horizon-testnet.stellar.org",
        nodeEnv: "test",
      },
      network as TransactionNetworkClient,
    );

    const result = await service.submitSignedXdr("signed-xdr", "external_signer");

    expect(result).toEqual({
      status: "submitted",
      mode: "external_signer",
      hash: "hash-1",
      signedXdr: "signed-xdr",
      ledger: undefined,
    });
  });

  it("fails when backend_sign mode has no signer", async () => {
    const network = createMockNetwork();

    const service = new TransactionService(
      {
        mode: "backend_sign",
        horizonUrl: "https://horizon-testnet.stellar.org",
        nodeEnv: "test",
      },
      network as TransactionNetworkClient,
    );

    await expect(service.submitTransaction({ unsignedXdr: "unsigned-xdr" })).rejects.toThrow(
      "Signer is required when TX_SIGNER_MODE=backend_sign",
    );
  });

  it("redacts seed phrase from failure error messages", async () => {
    const network = createMockNetwork();
    const signer = createMockSigner();
    const seed = "SDEV-SEED-MUST-NOT-LEAK";

    signer.signTransactionXdr.mockRejectedValue(new Error(`bad seed ${seed}`));

    const service = new TransactionService(
      {
        mode: "backend_sign",
        horizonUrl: "https://horizon-testnet.stellar.org",
        nodeEnv: "development",
        signingSeed: seed,
      },
      network as TransactionNetworkClient,
      signer as TransactionSigner,
    );

    await expect(service.submitTransaction({ unsignedXdr: "unsigned-xdr" })).rejects.toThrow(
      "Failed to sign and submit transaction",
    );

    try {
      await service.submitTransaction({ unsignedXdr: "unsigned-xdr" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain(seed);
      expect(message).toContain("[REDACTED]");
    }
  });

  it("maps env config into service config", () => {
    const config = buildTransactionServiceConfigFromEnv({
      RPC_URL: "https://horizon-testnet.stellar.org",
      NODE_ENV: "test",
      TX_SIGNER_MODE: "external_signer",
      TX_SIGNING_SEED: undefined,
      TX_SIGNING_KMS_KEY_ID: undefined,
      TX_EXTERNAL_SIGNER_URL: "https://signer.internal",
    });

    expect(config.mode).toBe("external_signer");
    expect(config.horizonUrl).toBe("https://horizon-testnet.stellar.org");
  });
});
