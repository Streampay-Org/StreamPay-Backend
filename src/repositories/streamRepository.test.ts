import { StreamRepository } from "./streamRepository";
import { db } from "../db/index";

jest.mock("../db/index", () => ({
  db: {
    select: jest.fn(),
  },
}));

describe("StreamRepository", () => {
  let repository: StreamRepository;

  beforeEach(() => {
    repository = new StreamRepository();
    jest.clearAllMocks();
  });

  const createMockQuery = <T>(value: T) => {
    const query = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      then: (onfulfilled: (value: T) => unknown) => Promise.resolve(value).then(onfulfilled),
    };
    return query;
  };

  describe("findById", () => {
    it("should return a stream with accruedEstimate when found and active", async () => {
      const mockStream = {
        id: "123e4567-e89b-12d3-a456-426614174000",
        payer: "payer1",
        recipient: "recipient1",
        status: "active",
        ratePerSecond: "1.5",
        startTime: new Date(),
        endTime: null,
        lastSettledAt: new Date(Date.now() - 10000), // 10 seconds ago
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (db.select as jest.Mock).mockReturnValue(createMockQuery([mockStream]));

      const result = await repository.findById(mockStream.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockStream.id);
      expect(parseFloat(result!.accruedEstimate)).toBeCloseTo(15, 1);
    });

    it("should return null when stream is not found", async () => {
      (db.select as jest.Mock).mockReturnValue(createMockQuery([]));

      const result = await repository.findById("non-existent");

      expect(result).toBeNull();
    });
  });

  describe("findAll", () => {
    it("should return a list of streams and total count", async () => {
      const mockStreams = [
        { id: "1", payer: "p1", status: "active", createdAt: new Date() },
        { id: "2", payer: "p1", status: "paused", createdAt: new Date() },
      ];

      (db.select as jest.Mock)
        .mockReturnValueOnce(createMockQuery(mockStreams)) // for data
        .mockReturnValueOnce(createMockQuery([{ count: 2 }])); // for count

      const result = await repository.findAll({ payer: "p1" });

      expect(result.streams).toHaveLength(2);
      expect(result.total).toBe(2);
    });
  });

  describe("findForExport", () => {
    const makeStream = (overrides: Partial<{ id: string; createdAt: Date }> = {}) => ({
      id: overrides.id ?? "aaaaaaaa-0000-0000-0000-000000000001",
      payer: "0xPayer",
      recipient: "0xRecipient",
      status: "active" as const,
      ratePerSecond: "1.0",
      startTime: new Date("2024-01-01T00:00:00Z"),
      endTime: null,
      totalAmount: "3600.0",
      lastSettledAt: new Date("2024-01-01T00:00:00Z"),
      createdAt: overrides.createdAt ?? new Date("2024-06-01T00:00:00Z"),
      updatedAt: new Date("2024-06-01T00:00:00Z"),
    });

    it("should return all rows with null nextCursor when count <= batchSize", async () => {
      const mockRows = [makeStream({ id: "a" }), makeStream({ id: "b" })];
      (db.select as jest.Mock).mockReturnValue(createMockQuery(mockRows));

      const result = await repository.findForExport({ batchSize: 500 });

      expect(result.rows).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it("should return a page and nextCursor when more rows than batchSize exist", async () => {
      // Simulate batchSize=2 but DB returns 3 rows (batchSize+1)
      const t = new Date("2024-06-01T00:00:00Z");
      const r1 = makeStream({ id: "id-1", createdAt: t });
      const r2 = makeStream({ id: "id-2", createdAt: t });
      const r3 = makeStream({ id: "id-3", createdAt: t }); // sentinel
      (db.select as jest.Mock).mockReturnValue(createMockQuery([r1, r2, r3]));

      const result = await repository.findForExport({ batchSize: 2 });

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].id).toBe("id-1");
      expect(result.rows[1].id).toBe("id-2");
      expect(result.nextCursor).toEqual({ createdAt: t, id: "id-2" });
    });

    it("should apply payer/recipient/status filters", async () => {
      (db.select as jest.Mock).mockReturnValue(createMockQuery([]));

      await repository.findForExport({ payer: "0xA", recipient: "0xB", status: "paused" });

      // select was called — no assertion on internals, just that it resolves without error
      expect(db.select).toHaveBeenCalled();
    });

    it("should return empty rows with null nextCursor for empty result set", async () => {
      (db.select as jest.Mock).mockReturnValue(createMockQuery([]));

      const result = await repository.findForExport({});

      expect(result.rows).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });

    it("should pass cursor arguments when provided", async () => {
      const cursorDate = new Date("2024-05-01T00:00:00Z");
      (db.select as jest.Mock).mockReturnValue(createMockQuery([]));

      const result = await repository.findForExport({
        cursorCreatedAt: cursorDate,
        cursorId: "cursor-id",
      });

      expect(result.rows).toHaveLength(0);
      expect(result.nextCursor).toBeNull();
    });
  });
});
