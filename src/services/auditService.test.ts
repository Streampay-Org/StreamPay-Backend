import { AuditService } from "./auditService";
import { AuditRepository } from "../repositories/auditRepository";

describe("AuditService", () => {
  it("should normalize IPv4-mapped IPv6 before persisting", async () => {
    const createSpy = jest
      .spyOn(AuditRepository.prototype, "create")
      .mockResolvedValue({ id: "audit-1" } as never);

    const service = new AuditService();

    await service.logSensitiveAction({
      actor: "admin",
      action: "stream_admin_action",
      streamId: "123e4567-e89b-12d3-a456-426614174000",
      ipAddress: "::ffff:127.0.0.1",
      metadata: { key: "value" },
    });

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ipAddress: "127.0.0.1",
      }),
    );

    createSpy.mockRestore();
  });
});
