import { Router, Request, Response } from "express";
import { z } from "zod";
import { StreamRepository, FindAllParams } from "../../repositories/streamRepository";

const router = Router();
const streamRepository = new StreamRepository();

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
