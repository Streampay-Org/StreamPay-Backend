import { AuditRepository } from "../repositories/auditRepository";

/**
 * Input describing a single sensitive action to record in the audit log.
 */
export interface LogSensitiveActionInput {
  /** Identifier of the actor (user id, service principal, etc.). */
  actor: string;
  /** Discriminator for the type of action being recorded. */
  action: "stream_create" | "stream_update" | "stream_admin_action";
  /** Optional stream id the action targeted. */
  streamId?: string;
  /** Client IP address; will be normalized before persistence. */
  ipAddress: string;
  /** Arbitrary JSON-safe metadata about the action. */
  metadata?: Record<string, unknown>;
}

/**
 * Service that writes sensitive-action records to the audit log.
 *
 * IP addresses are normalized (IPv4-mapped IPv6 prefixes are stripped) so that
 * downstream analytics see a canonical value.
 */
export class AuditService {
  private readonly repository: AuditRepository;

  constructor(repository = new AuditRepository()) {
    this.repository = repository;
  }

  /**
   * Persist a sensitive action to the audit log.
   *
   * @returns the newly created audit record.
   */
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
