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
});
