import crypto from "crypto";
import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate";
import { Stream } from "../../db/schema";
import {
  FindAllParams,
  ExportParams,
  StreamRepository,
  UpdateStreamParams,
} from "../../repositories/streamRepository";
import { accrualService } from "../../services/accrualService";
import {
  getStreamsQuerySchema,
  uuidParamSchema,
  uuidSchema,
} from "../../validation/schemas";

const router = Router();
const streamRepository = new StreamRepository();
const allowedUpdateFields = new Set(["labels", "offChainMemo", "status", "updatedAt"]);
const validStreamStatuses = ["active", "paused", "cancelled", "completed"] as const;
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UpdateStreamRequestBody = Omit<Partial<UpdateStreamParams>, "updatedAt"> & {
  updatedAt?: string;
};

const isJsonObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const createStreamSchema = z.object({
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

// POST /api/v1/streams
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

    const stream = await streamRepository.create({
      payer: body.payer,
      recipient: body.recipient,
      ratePerSecond: body.ratePerSecond,
      startTime: new Date(body.startTime),
      endTime: body.endTime ? new Date(body.endTime) : undefined,
      totalAmount: body.totalAmount,
      status: "active",
      lastSettledAt: new Date(body.startTime),
    });

    return res.status(201).json(stream);
  } catch (error) {
    console.error("Error creating stream:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

const CSV_HEADER =
  "id,payer,recipient,status,ratePerSecond,startTime,endTime,totalAmount,lastSettledAt,createdAt,updatedAt\r\n";

/** RFC 4180-compliant field escaping. */
function escapeCsvField(value: string): string {
  if (/[,"\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

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

// ---------------------------------------------------------------------------
// GET /api/v1/streams/export.csv
// ---------------------------------------------------------------------------
router.get("/export.csv", requireAuth, async (req: Request, res: Response) => {
  try {
    const { payer, recipient, status } = req.query;

    const filters: ExportParams = {
      payer: payer as string | undefined,
      recipient: recipient as string | undefined,
      status: status as ExportParams["status"],
    };

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="streams-export.csv"'
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
        res.write(rowToCsvLine(row));
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

// GET /api/v1/streams/:id/accrual-preview
router.get("/:id/accrual-preview", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!uuidSchema.safeParse(id).success) {
      return res.status(400).json({ error: "Invalid stream ID format" });
    }

    const stream = await streamRepository.findById(id);

    if (!stream) {
      return res.status(404).json({ error: "Stream not found" });
    }

    const preview = accrualService.calculateAccrual(stream);

    res.json({
      ...preview,
      disclaimer: "This value is an estimate based on database records and contract formula. It may differ from the actual on-chain state due to indexing latency or pending transactions.",
      note: "This endpoint is under heavy rate limiting.",
    });
  } catch (error) {
    console.error("Error generating accrual preview:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/streams/:id
router.get(
  "/:id",
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      if (!uuidRegex.test(id)) {
        return res.status(400).json({ error: "Invalid stream ID format" });
      }
      const includeDeleted = req.query.includeDeleted === "true";
      const stream = await streamRepository.findById(id, includeDeleted);

      if (!stream) {
        return res.status(404).json({ error: "Stream not found" });
      }

      res.json(stream);
    } catch (error) {
      console.error("Error fetching stream:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PATCH /api/v1/streams/:id
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
    const invalidFields = Object.keys(updates).filter((field) => !allowedUpdateFields.has(field));
    if (invalidFields.length > 0) {
      return res.status(400).json({ error: `Invalid fields: ${invalidFields.join(", ")}` });
    }

    if (updates.status && !validStreamStatuses.includes(updates.status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    if (
      updates.labels !== undefined &&
      (!Array.isArray(updates.labels) || !updates.labels.every((label) => typeof label === "string"))
    ) {
      return res.status(400).json({ error: "Labels must be an array of strings" });
    }

    if (updates.offChainMemo !== undefined && updates.offChainMemo !== null && typeof updates.offChainMemo !== "string") {
      return res.status(400).json({ error: "offChainMemo must be a string or null" });
    }

    let currentUpdatedAt: Date | undefined;
    if (updates.updatedAt) {
      currentUpdatedAt = new Date(updates.updatedAt);
      if (Number.isNaN(currentUpdatedAt.getTime())) {
        return res.status(400).json({ error: "Invalid updatedAt format" });
      }
    }

    const repositoryUpdates: UpdateStreamParams = {};
    if (updates.labels !== undefined) repositoryUpdates.labels = updates.labels;
    if (updates.offChainMemo !== undefined) repositoryUpdates.offChainMemo = updates.offChainMemo;
    if (updates.status !== undefined) repositoryUpdates.status = updates.status;

    const updatedStream = await streamRepository.updateById(id, repositoryUpdates, currentUpdatedAt);

    if (!updatedStream) {
      return res.status(404).json({ error: "Stream not found or update conflict" });
    }

    const streamWithEstimate = await streamRepository.findById(id);
    res.json(streamWithEstimate ?? updatedStream);
  } catch (error) {
    console.error("Error updating stream:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/v1/streams/:id
router.delete(
  "/:id",
  validate({ params: uuidParamSchema }),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const deleted = await streamRepository.softDeleteById(id);

      if (!deleted) {
        return res.status(404).json({ error: "Stream not found" });
      }

      res.status(204).end();
    } catch (error) {
      console.error("Error deleting stream:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// GET /api/v1/streams
router.get(
  "/",
  validate({ query: getStreamsQuerySchema }),
  async (req: Request, res: Response) => {
    try {
      const params = req.query as unknown as FindAllParams;
      const result = await streamRepository.findAll(params);

      res.json(result);
    } catch (error) {
      console.error("Error fetching streams:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

