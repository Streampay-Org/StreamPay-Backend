import {
  HttpAdapter,
  SOROBAN_RPC_RETRY_BASE_DELAY_MS,
  SOROBAN_RPC_MAX_RETRIES,
  SOROBAN_RPC_TIMEOUT_MS,
  SorobanClient,
} from "./sorobanClient";

declare const describe: (name: string, run: () => void) => void;
declare const it: (name: string, run: () => void | Promise<void>) => void;
declare const expect: {
  (value: unknown): {
    toBe: (expected: unknown) => void;
    toThrow: (expected: string) => Promise<void> | void;
    rejects: {
      toThrow: (expected: string) => Promise<void>;
    };
  };
};

type MockFn = ((...args: unknown[]) => unknown) & {
  mock: {
    calls: unknown[][];
  };
};

declare const jest: {
  fn: (impl?: (...args: unknown[]) => unknown | Promise<unknown>) => MockFn;
};

describe("SorobanClient", () => {
  const createAdapter = (responses: Array<unknown | Error>, status = 200): {
    adapter: HttpAdapter;
    sendMock: MockFn;
  } => {
    let index = 0;

    const sendMock = jest.fn(async () => {
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;

      if (next instanceof Error) {
        throw next;
      }

      return {
        status,
        json: next,
      };
    });

    return {
      adapter: {
        send: sendMock as unknown as HttpAdapter["send"],
      },
      sendMock,
    };
  };

  it("exports retry policy constants", () => {
    expect(SOROBAN_RPC_TIMEOUT_MS).toBe(8000);
    expect(SOROBAN_RPC_MAX_RETRIES).toBe(3);
    expect(SOROBAN_RPC_RETRY_BASE_DELAY_MS).toBe(200);
  });

  it("retries idempotent read and succeeds after transient failures", async () => {
    const { adapter, sendMock } = createAdapter([
      new Error("temporary network issue"),
      {
        jsonrpc: "2.0",
        id: "abc",
        result: {
          latestLedger: 123,
          entries: [{ key: "ledger-key" }],
        },
      },
    ]);

    const client = new SorobanClient(
      {
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        timeoutMs: 100,
        maxRetries: 2,
        baseDelayMs: 1,
      },
      adapter,
    );

    const result = await client.getLedgerEntry({ key: "AAAA" });

    expect(result.latestLedger).toBe(123);
    expect(Array.isArray(result.entries)).toBe(true);
    expect(sendMock.mock.calls.length).toBe(2);
  });

  it("does not retry write operations", async () => {
    const { adapter, sendMock } = createAdapter([new Error("submit failed")]);

    const client = new SorobanClient(
      {
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        timeoutMs: 50,
        maxRetries: 3,
        baseDelayMs: 1,
      },
      adapter,
    );

    await expect(client.sendTransaction({ transaction: "AAAA" })).rejects.toThrow(
      "Soroban RPC sendTransaction failed (write)",
    );
    expect(sendMock.mock.calls.length).toBe(1);
  });

  it("surfaces RPC errors after retry exhaustion", async () => {
    const { adapter, sendMock } = createAdapter([
      {
        jsonrpc: "2.0",
        id: "1",
        error: {
          code: -32000,
          message: "overloaded",
        },
      },
      {
        jsonrpc: "2.0",
        id: "2",
        error: {
          code: -32000,
          message: "still overloaded",
        },
      },
    ]);

    const client = new SorobanClient(
      {
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        timeoutMs: 100,
        maxRetries: 1,
        baseDelayMs: 1,
      },
      adapter,
    );

    await expect(client.simulateContractCall({ transaction: "AAAA" })).rejects.toThrow(
      "Soroban RPC simulateTransaction failed (idempotent read)",
    );
    expect(sendMock.mock.calls.length).toBe(2);
  });

  it("sends passphrase and JSON-RPC payload via HTTP adapter", async () => {
    const { adapter, sendMock } = createAdapter([
      {
        jsonrpc: "2.0",
        id: "read-1",
        result: {
          latestLedger: 44,
          transactionData: "tx-data",
          minResourceFee: "10",
        },
      },
    ]);

    const client = new SorobanClient(
      {
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
        timeoutMs: 100,
        maxRetries: 0,
        baseDelayMs: 1,
      },
      adapter,
    );

    const result = await client.simulateContractCall({ transaction: "AAAA" });

    expect(result.transactionData).toBe("tx-data");

    const call = sendMock.mock.calls[0][0] as {
      headers: Record<string, string>;
      body: string;
    };
    expect(call.headers["x-network-passphrase"]).toBe("Test SDF Network ; September 2015");

    const parsedBody = JSON.parse(call.body);
    expect(parsedBody.jsonrpc).toBe("2.0");
    expect(parsedBody.method).toBe("simulateTransaction");
  });
});
