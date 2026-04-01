import { desc, eq } from "drizzle-orm";
import { db } from "../db/index";
import { auditLogs, AuditLog, NewAuditLog } from "../db/schema";

export class AuditRepository {
  async create(input: NewAuditLog): Promise<AuditLog> {
    const [row] = await db.insert(auditLogs).values(input).returning();

    if (!row) {
      throw new Error("Failed to persist audit log");
    }

    return row;
  }

  async findByStreamId(streamId: string): Promise<AuditLog[]> {
    return db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.streamId, streamId))
      .orderBy(desc(auditLogs.createdAt));
  }
}
