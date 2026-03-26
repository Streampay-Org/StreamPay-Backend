import { Router, Request, Response } from "express";
import { StreamRepository, FindAllParams } from "../../repositories/streamRepository";

const router = Router();
const streamRepository = new StreamRepository();

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
