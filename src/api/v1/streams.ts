import { Router, Request, Response } from "express";
import { StreamRepository } from "../../repositories/streamRepository";
import { validate } from "../../middleware/validate";
import {
  getStreamsQuerySchema,
  uuidParamSchema,
} from "../../validation/schemas";

const router = Router();
const streamRepository = new StreamRepository();

// GET /api/v1/streams/:id
router.get(
  "/:id",
  validate({ params: uuidParamSchema }),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;

      const stream = await streamRepository.findById(id);

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

// GET /api/v1/streams
router.get(
  "/",
  validate({ query: getStreamsQuerySchema }),
  async (req: Request, res: Response) => {
    try {
      const params = req.query;

      const result = await streamRepository.findAll(params);

      res.json(result);
    } catch (error) {
      console.error("Error fetching streams:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
