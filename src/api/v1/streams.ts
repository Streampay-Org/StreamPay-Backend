import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { StreamRepository, FindAllParams, ExportParams } from "../../repositories/streamRepository";
import { Stream } from "../../db/schema";

const router = Router();
const streamRepository = new StreamRepository();

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/**
 * Enforces Bearer-token authentication using the JWT_SECRET environment
 * variable.  Timing-safe comparison prevents timing-oracle attacks.
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
//
// Registered BEFORE /:id so Express does not treat "export.csv" as a UUID.
//
// Auth:    Bearer <JWT_SECRET>
// Filters: ?payer=&recipient=&status=   (same as the list endpoint)
// Response: chunked text/csv stream — memory-safe regardless of dataset size.

/**
 * @openapi
 * /api/v1/streams/export.csv:
 *   get:
 *     summary: Export streams as CSV
 *     description: >
 *       Streams a CSV file containing all streams that match the supplied
 *       filters.  Rows are fetched from the database in cursor-based batches
 *       so memory usage is bounded regardless of dataset size.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: payer
 *         schema: { type: string }
 *       - in: query
 *         name: recipient
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, paused, cancelled, completed] }
 *     responses:
 *       200:
 *         description: CSV file download
 *         content:
 *           text/csv:
 *             schema: { type: string }
 *       401:
 *         description: Missing or invalid Bearer token
 */
router.get("/export.csv", requireAuth, async (req: Request, res: Response) => {
  try {
    const { payer, recipient, status } = req.query;

    const filters: Pick<ExportParams, "payer" | "recipient" | "status"> = {
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

// GET /api/v1/streams/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Basic UUID validation (regex)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: "Invalid stream ID format" });
    }

    const stream = await streamRepository.findById(id);

    if (!stream) {
      return res.status(404).json({ error: "Stream not found" });
    }

    res.json(stream);
  } catch (error) {
    console.error("Error fetching stream:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/streams
router.get("/", async (req: Request, res: Response) => {
  try {
    const { payer, recipient, status, limit, offset } = req.query;

    const params: FindAllParams = {
      payer: payer as string | undefined,
      recipient: recipient as string | undefined,
      status: status as FindAllParams["status"],
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    };

    const result = await streamRepository.findAll(params);

    res.json(result);
  } catch (error) {
    console.error("Error fetching streams:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
