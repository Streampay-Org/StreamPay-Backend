import { Router, Request, Response } from "express";
import { StreamRepository, FindAllParams } from "../../repositories/streamRepository";
import { AuditService } from "../../services/auditService";

const router = Router();
const streamRepository = new StreamRepository();
const auditService = new AuditService();

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const getBearerToken = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
};

const isProtectedActionAuthorized = (req: Request): boolean => {
  const expected = process.env.JWT_SECRET;
  if (!expected) return false;

  const token = getBearerToken(req.header("authorization"));
  return token === expected;
};

// GET /api/v1/streams/:id
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

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

// POST /api/v1/streams/:id/admin/pause
router.post("/:id/admin/pause", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: "Invalid stream ID format" });
    }

    if (!isProtectedActionAuthorized(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const stream = await streamRepository.updateStatus(id, "paused");

    if (!stream) {
      return res.status(404).json({ error: "Stream not found" });
    }

    await auditService.logSensitiveAction({
      actor: req.header("x-actor-id") || "unknown",
      action: "stream_admin_action",
      streamId: id,
      ipAddress: req.ip || "unknown",
      metadata: {
        adminAction: "pause",
        endpoint: "/api/v1/streams/:id/admin/pause",
      },
    });

    return res.status(200).json({
      id: stream.id,
      status: stream.status,
    });
  } catch (error) {
    console.error("Error handling admin stream pause action:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
