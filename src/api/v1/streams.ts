import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  StreamRepository,
  FindAllParams,
  ExportParams,
  UpdateStreamParams,
} from "../../repositories/streamRepository";
import { Stream } from "../../db/schema";
import { accrualService } from "../../services/accrualService";
import {
  TenantContext,
  tenantAuthorizationService,
} from "../../services/tenantAuthorizationService";
import { tenantContextMiddleware } from "../../middleware/tenantContext";

const router = Router();
const streamRepository = new StreamRepository();

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidSchema = z.string().regex(uuidRegex);

const allowedUpdateFields = new Set([
  "labels",
  "offChainMemo",
  "status",
  "updatedAt",
]);

const validStreamStatuses = ["active", "paused", "cancelled", "completed"];

const createStreamSchema = z.object({
  tenantId: z.string().min(1).optional(),
  payer: z.string().min(1, "payer is required"),
  recipient: z.string().min(1, "recipient is required"),
  ratePerSecond: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "ratePerSecond must be a positive decimal string"),
  startTime: z.string().datetime({ message: "startTime must be an ISO-8601 datetime" }),
  endTime: z
    .string()
    .datetime({ message: "endTime must be an ISO-8601 datetime" })
    .optional(),
  totalAmount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "totalAmount must be a positive decimal string"),
});

type CreateStreamBody = z.infer<typeof createStreamSchema>;

/**
 * Resolves optional tenant scope for repository operations based on request context.
 */
function getTargetTenantId(
  req: Request,
  explicitContext?: TenantContext | null,
): string | undefined {
  const context = explicitContext ?? req.tenantContext;
  if (!context || context.isServiceBypass) {
    return undefined;
  }
  const hasTenantScope = Boolean(
    req.header("x-tenant-id") ||
      req.header("x-tenant") ||
      (req.apiKey as Record<string, unknown> | undefined)?.tenantId,
  );
  return hasTenantScope ? context.tenantId : undefined;
}

router.use(tenantContextMiddleware);

router.post("/", async (req: Request, res: Response) => {
  try {
    const parsed = createStreamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const body = parsed.data as CreateStreamBody;
    const context = req.tenantContext;
    const targetTenantId = getTargetTenantId(req);

    if (body.tenantId && targetTenantId && !context?.isServiceBypass && body.tenantId !== targetTenantId) {
      return res.status(403).json({ error: "Cannot create stream for another tenant" });
    }

    const streamTenantId =
      context?.isServiceBypass && body.tenantId
        ? body.tenantId
        : (targetTenantId ?? body.tenantId ?? null);

    const stream = await streamRepository.create({
      tenantId: streamTenantId,
      payer: body.payer,
      recipient: body.recipient,
      ratePerSecond: body.ratePerSecond,
      startTime: new Date(body.startTime),
      endTime: body.endTime ? new Date(body.endTime) : undefined,
      totalAmount: body.totalAmount,
      status: "active",
      lastSettledAt: new Date(body.startTime),
    });

    if (context?.isServiceBypass && req.header("x-admin-bypass") === "true") {
      await tenantAuthorizationService.auditBypass(context, {
        streamId: stream.id,
        action: "create_stream",
        route: req.originalUrl,
        method: req.method,
      });
    }

    return res.status(201).json(stream);
  } catch (error) {
    console.error("Error creating stream:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Enforces Bearer-token authentication using the JWT_SECRET environment
 * variable. Timing-safe comparison prevents timing-oracle attacks.
 */
function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: "Server misconfiguration: missing JWT_SECRET" });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(secret);
  if (
    tokenBuf.length !== secretBuf.length ||
    !crypto.timingSafeEqual(tokenBuf, secretBuf)
  ) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

const CSV_HEADER =
  "id,payer,recipient,status,ratePerSecond,startTime,endTime,totalAmount,lastSettledAt,createdAt,updatedAt\r\n";

/**
 * RFC 4180-compliant field escaping.
 */
function escapeCsvField(value: string): string {
  if (/[,"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Serializes stream fields to CSV format.
 */
function rowToCsvLine(stream: Stream): string {
  const fields: string[] = [
    stream.id,
    stream.payer,
    stream.recipient,
    stream.status,
    stream.ratePerSecond,
    stream.startTime.toISOString(),
    stream.endTime ? stream.endTime.toISOString() : "",
    stream.totalAmount,
    stream.lastSettledAt.toISOString(),
    stream.createdAt.toISOString(),
    stream.updatedAt.toISOString(),
  ];
  return fields.map(escapeCsvField).join(",") + "\r\n";
}

router.get("/export.csv", requireAuth, async (req: Request, res: Response) => {
  try {
    const { payer, recipient, status } = req.query;
    const { context } = tenantAuthorizationService.extractTenantContext(req);
    const targetTenantId = getTargetTenantId(req, context);

    const filters: ExportParams = {
      payer: payer as string | undefined,
      recipient: recipient as string | undefined,
      status: status as ExportParams["status"],
      ...(targetTenantId ? { tenantId: targetTenantId } : {}),
    };

    if (context?.isServiceBypass && req.header("x-admin-bypass") === "true") {
      await tenantAuthorizationService.auditBypass(context, {
        action: "export_streams",
        route: req.originalUrl,
        method: req.method,
      });
    }

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="streams-export.csv"',
    );

    res.write(CSV_HEADER);

    let cursor: { createdAt: Date; id: string } | undefined;

    while (true) {
      const batch = await streamRepository.findForExport({
        ...filters,
        cursorCreatedAt: cursor?.createdAt,
        cursorId: cursor?.id,
      });

      for (const row of batch.rows) {
        if (!context || tenantAuthorizationService.canAccessStream(context, row)) {
          res.write(rowToCsvLine(row));
        }
      }

      if (!batch.nextCursor) break;
      cursor = batch.nextCursor;
    }

    res.end();
  } catch (error) {
    console.error("Error exporting streams CSV:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

router.get("/:id/accrual-preview", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!uuidSchema.safeParse(id).success) {
      return res.status(400).json({ error: "Invalid stream ID format" });
    }

    const context = req.tenantContext;
    const stream = await streamRepository.findById(id);

    if (!stream || (context && !tenantAuthorizationService.canAccessStream(context, stream))) {
      return res.status(404).json({ error: "Stream not found" });
    }

    if (context?.isServiceBypass && req.header("x-admin-bypass") === "true") {
      await tenantAuthorizationService.auditBypass(context, {
        streamId: stream.id,
        action: "preview_accrual",
        route: req.originalUrl,
        method: req.method,
      });
    }

    const preview = accrualService.calculateAccrual(stream);

    res.json({
      ...preview,
      disclaimer:
        "This value is an estimate based on database records and contract formula. It may differ from the actual on-chain state due to indexing latency or pending transactions.",
      note: "This endpoint is under heavy rate limiting.",
    });
  } catch (error) {
    console.error("Error generating accrual preview:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: "Invalid stream ID format" });
    }
    const includeDeleted = req.query.includeDeleted === "true";
    const context = req.tenantContext;
    const stream = await streamRepository.findById(id, includeDeleted);

    if (!stream || (context && !tenantAuthorizationService.canAccessStream(context, stream))) {
      return res.status(404).json({ error: "Stream not found" });
    }

    if (context?.isServiceBypass && req.header("x-admin-bypass") === "true") {
      await tenantAuthorizationService.auditBypass(context, {
        streamId: stream.id,
        action: "read_stream",
        route: req.originalUrl,
        method: req.method,
      });
    }

    res.json(stream);
  } catch (error) {
    console.error("Error fetching stream:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

interface UpdateStreamRequestBody {
  labels?: string[];
  offChainMemo?: string | null;
  status?: string;
  updatedAt?: string;
}

/**
 * Validates whether the incoming payload is a genuine non-null object.
 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const requestBody = req.body ?? {};

    if (!uuidSchema.safeParse(id).success) {
      return res.status(400).json({ error: "Invalid stream ID format" });
    }

    if (!isJsonObject(requestBody)) {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }

    const updates = requestBody as UpdateStreamRequestBody;
    const invalidFields = Object.keys(updates).filter(
      (field) => !allowedUpdateFields.has(field),
    );
    if (invalidFields.length > 0) {
      return res
        .status(400)
        .json({ error: `Invalid fields: ${invalidFields.join(", ")}` });
    }

    if (updates.status && !validStreamStatuses.includes(updates.status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    if (
      updates.labels !== undefined &&
      (!Array.isArray(updates.labels) ||
        !updates.labels.every((label) => typeof label === "string"))
    ) {
      return res
        .status(400)
        .json({ error: "Labels must be an array of strings" });
    }

    if (
      updates.offChainMemo !== undefined &&
      updates.offChainMemo !== null &&
      typeof updates.offChainMemo !== "string"
    ) {
      return res
        .status(400)
        .json({ error: "offChainMemo must be a string or null" });
    }

    let currentUpdatedAt: Date | undefined;
    if (updates.updatedAt) {
      currentUpdatedAt = new Date(updates.updatedAt);
      if (Number.isNaN(currentUpdatedAt.getTime())) {
        return res.status(400).json({ error: "Invalid updatedAt format" });
      }
    }

    const context = req.tenantContext;
    const repositoryUpdates: UpdateStreamParams = {};
    if (updates.labels !== undefined) repositoryUpdates.labels = updates.labels;
    if (updates.offChainMemo !== undefined)
      repositoryUpdates.offChainMemo = updates.offChainMemo;
    if (updates.status !== undefined)
      repositoryUpdates.status = updates.status as UpdateStreamParams["status"];

    const targetTenantId = getTargetTenantId(req);
    const updatedStream = targetTenantId
      ? await streamRepository.updateById(
          id,
          repositoryUpdates,
          currentUpdatedAt,
          targetTenantId,
        )
      : await streamRepository.updateById(
          id,
          repositoryUpdates,
          currentUpdatedAt,
        );

    if (!updatedStream) {
      return res
        .status(404)
        .json({ error: "Stream not found or update conflict" });
    }

    if (context?.isServiceBypass && req.header("x-admin-bypass") === "true") {
      await tenantAuthorizationService.auditBypass(context, {
        streamId: id,
        action: "update_stream",
        route: req.originalUrl,
        method: req.method,
      });
    }

    const streamWithEstimate = await streamRepository.findById(id);
    res.json(streamWithEstimate ?? updatedStream);
  } catch (error) {
    console.error("Error updating stream:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post(
  "/:id/restore",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({ error: "Invalid stream ID format" });
      }

      const context = req.tenantContext;
      const targetTenantId = getTargetTenantId(req);
      const restored = targetTenantId
        ? await streamRepository.restoreById(id, targetTenantId)
        : await streamRepository.restoreById(id);

      if (!restored) {
        return res.status(404).json({ error: "Deleted stream not found" });
      }

      if (context?.isServiceBypass && req.header("x-admin-bypass") === "true") {
        await tenantAuthorizationService.auditBypass(context, {
          streamId: id,
          action: "restore_stream",
          route: req.originalUrl,
          method: req.method,
        });
      }

      const stream = await streamRepository.findById(id);
      if (!stream || (context && !tenantAuthorizationService.canAccessStream(context, stream))) {
        return res.status(404).json({ error: "Stream not found" });
      }

      return res.json(stream);
    } catch (error) {
      console.error("Error restoring stream:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

router.delete(
  "/:id",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({ error: "Invalid stream ID format" });
      }

      const context = req.tenantContext;
      const targetTenantId = getTargetTenantId(req);
      const deleted = targetTenantId
        ? await streamRepository.softDeleteById(id, targetTenantId)
        : await streamRepository.softDeleteById(id);

      if (!deleted) {
        return res.status(404).json({ error: "Stream not found" });
      }

      if (context?.isServiceBypass && req.header("x-admin-bypass") === "true") {
        await tenantAuthorizationService.auditBypass(context, {
          streamId: id,
          action: "delete_stream",
          route: req.originalUrl,
          method: req.method,
        });
      }

      res.status(204).end();
    } catch (error) {
      console.error("Error deleting stream:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

const getStreamsQuerySchema = z.object({
  payer: z.string().optional(),
  recipient: z.string().optional(),
  status: z
    .enum(["active", "paused", "cancelled", "completed"])
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

router.get(
  "/",
  async (req: Request, res: Response) => {
    try {
      const queryResult = getStreamsQuerySchema.safeParse(req.query);
      if (!queryResult.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: queryResult.error.flatten().fieldErrors,
        });
      }

      const context = req.tenantContext;
      const targetTenantId = getTargetTenantId(req);
      const params: FindAllParams = {
        ...(queryResult.data as FindAllParams),
        ...(targetTenantId ? { tenantId: targetTenantId } : {}),
      };

      const result = await streamRepository.findAll(params);
      const filteredStreams = context && !context.isServiceBypass && targetTenantId
        ? result.streams.filter((s) =>
            tenantAuthorizationService.canAccessStream(context, s),
          )
        : result.streams;

      if (context?.isServiceBypass && req.header("x-admin-bypass") === "true") {
        await tenantAuthorizationService.auditBypass(context, {
          action: "list_streams",
          route: req.originalUrl,
          method: req.method,
        });
      }

      res.json({
        ...result,
        streams: filteredStreams,
        total: filteredStreams.length,
      });
    } catch (error) {
      console.error("Error fetching streams:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
