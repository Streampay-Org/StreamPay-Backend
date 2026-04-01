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

// PATCH /api/v1/streams/:id
router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body as Partial<UpdateStreamParams> & { updatedAt?: string };

    // Basic UUID validation (regex)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: "Invalid stream ID format" });
    }

    // Validate writable fields whitelist
    const allowedFields = ["labels", "offChainMemo", "status", "updatedAt"];
    const invalidFields = Object.keys(updates).filter(field => !allowedFields.includes(field));
    if (invalidFields.length > 0) {
      return res.status(400).json({ error: `Invalid fields: ${invalidFields.join(", ")}` });
    }

    // Validate status if provided
    if (updates.status && !["active", "paused", "cancelled", "completed"].includes(updates.status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    // Validate labels if provided (should be array of strings)
    if (updates.labels !== undefined && (!Array.isArray(updates.labels) || !updates.labels.every(label => typeof label === "string"))) {
      return res.status(400).json({ error: "Labels must be an array of strings" });
    }

    // Validate offChainMemo if provided (should be string or null)
    if (updates.offChainMemo !== undefined && updates.offChainMemo !== null && typeof updates.offChainMemo !== "string") {
      return res.status(400).json({ error: "offChainMemo must be a string or null" });
    }

    // Parse updatedAt if provided for optimistic locking
    let currentUpdatedAt: Date | undefined;
    if (updates.updatedAt) {
      currentUpdatedAt = new Date(updates.updatedAt);
      if (isNaN(currentUpdatedAt.getTime())) {
        return res.status(400).json({ error: "Invalid updatedAt format" });
      }
      delete updates.updatedAt; // Remove from updates as it's for locking
    }

    const updatedStream = await streamRepository.updateById(id, updates as UpdateStreamParams, currentUpdatedAt);

    if (!updatedStream) {
      return res.status(404).json({ error: "Stream not found or update conflict" });
    }

    // Return the updated stream with accruedEstimate
    const streamWithEstimate = await streamRepository.findById(id);
    res.json(streamWithEstimate);
  } catch (error) {
    console.error("Error updating stream:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

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
