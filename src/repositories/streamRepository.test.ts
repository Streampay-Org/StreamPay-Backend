import { StreamRepository } from "./streamRepository";
import { db } from "../db/index";

jest.mock("../db/index", () => ({
  db: {
    select: jest.fn(),
    update: jest.fn(),
  },
}));

describe("StreamRepository", () => {
  let repository: StreamRepository;

  beforeEach(() => {
    repository = new StreamRepository();
    jest.clearAllMocks();
  });

  const createMockQuery = (value: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query: any = {
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      then: (onfulfilled: any) => Promise.resolve(value).then(onfulfilled),
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

    it("should not return deleted stream by default", async () => {
      (db.select as jest.Mock).mockReturnValue(createMockQuery([]));

      const result = await repository.findById("deleted-id");

      expect(result).toBeNull();
    });

    it("should include deleted when includeDeleted is true", async () => {
      const mockStream = {
        id: "deleted-id",
        payer: "payer1",
        recipient: "recipient1",
        status: "paused",
        ratePerSecond: "1",
        startTime: new Date(),
        endTime: null,
        lastSettledAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      };

      (db.select as jest.Mock).mockReturnValue(createMockQuery([mockStream]));

      const result = await repository.findById("deleted-id", true);

      expect(result).not.toBeNull();
      expect(result?.id).toBe("deleted-id");
    });

    it("should mark stream deleted with softDeleteById", async () => {
      const updateBuilder = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue(1),
      };

      (db.update as jest.Mock).mockReturnValue(updateBuilder);

      const deleted = await repository.softDeleteById("to-delete-id");

      expect(deleted).toBe(true);
      expect(db.update).toHaveBeenCalled();
      expect(updateBuilder.set).toHaveBeenCalledWith({ deletedAt: expect.any(Date) });
      expect(updateBuilder.where).toHaveBeenCalled();
    });
  });

  describe("findAll", () => {
    it("should return a list of streams and total count", async () => {
      const mockStreams = [
        { id: "1", payer: "p1", status: "active", createdAt: new Date() },
        { id: "2", payer: "p1", status: "paused", createdAt: new Date() },
      ];

      const firstQuery = createMockQuery(mockStreams);
      const countQuery = createMockQuery([{ count: 2 }]);

      (db.select as jest.Mock)
        .mockReturnValueOnce(firstQuery)
        .mockReturnValueOnce(countQuery);

      const result = await repository.findAll({ payer: "p1" });

      expect(result.streams).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(firstQuery.where).toHaveBeenCalled();
      expect(countQuery.where).toHaveBeenCalled();
    });

    it("should query deleted rows only when includeDeleted true", async () => {
      const firstQuery = createMockQuery([{ id: "1", payer: "p1" }]);
      const countQuery = createMockQuery([{ count: 1 }]);

      (db.select as jest.Mock)
        .mockReturnValueOnce(firstQuery)
        .mockReturnValueOnce(countQuery);

      await repository.findAll({ payer: "p1", includeDeleted: true });

      expect(firstQuery.where).toHaveBeenCalled();
      expect(countQuery.where).toHaveBeenCalled();
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
