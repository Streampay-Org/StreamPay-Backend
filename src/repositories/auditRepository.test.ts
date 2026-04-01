import { AuditRepository } from "./auditRepository";
import { db } from "../db/index";

jest.mock("../db/index", () => ({
  db: {
    insert: jest.fn(),
    select: jest.fn(),
  },
}));

describe("AuditRepository", () => {
  let repository: AuditRepository;

  beforeEach(() => {
    repository = new AuditRepository();
    jest.clearAllMocks();
  });

  it("should persist an audit row", async () => {
    const insertedRow = {
      id: "123e4567-e89b-12d3-a456-426614174111",
      actor: "admin-user",
      action: "stream_admin_action",
      streamId: "123e4567-e89b-12d3-a456-426614174000",
      ipAddress: "127.0.0.1",
      metadata: { adminAction: "pause" },
      createdAt: new Date(),
    };

    const returning = jest.fn().mockResolvedValue([insertedRow]);
    const values = jest.fn().mockReturnValue({ returning });
    (db.insert as jest.Mock).mockReturnValue({ values });

    const result = await repository.create({
      actor: "admin-user",
      action: "stream_admin_action",
      streamId: "123e4567-e89b-12d3-a456-426614174000",
      ipAddress: "127.0.0.1",
      metadata: { adminAction: "pause" },
    });

    expect(db.insert).toHaveBeenCalled();
    expect(result).toEqual(insertedRow);
  });
});
