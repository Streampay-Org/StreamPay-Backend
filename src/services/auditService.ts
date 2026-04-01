import { AuditRepository } from "../repositories/auditRepository";

export interface LogSensitiveActionInput {
  actor: string;
  action: "stream_create" | "stream_update" | "stream_admin_action";
  streamId?: string;
  ipAddress: string;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  private readonly repository: AuditRepository;

  constructor(repository = new AuditRepository()) {
    this.repository = repository;
  }

  async logSensitiveAction(input: LogSensitiveActionInput) {
    const safeIpAddress = this.normalizeIpAddress(input.ipAddress);

    return this.repository.create({
      actor: input.actor,
      action: input.action,
      streamId: input.streamId,
      ipAddress: safeIpAddress,
      metadata: input.metadata ?? null,
    });
  }

  private normalizeIpAddress(ipAddress: string): string {
    const trimmed = ipAddress.trim();
    if (!trimmed) return "unknown";

    // Express can expose IPv4 clients as ::ffff:127.0.0.1.
    return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  }
}
