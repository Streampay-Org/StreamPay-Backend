import { Request, Response, Router } from "express";
import { validate } from "../../middleware/validate";
import {
  FindAllParams,
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

type UpdateStreamRequestBody = Omit<Partial<UpdateStreamParams>, "updatedAt"> & {
  updatedAt?: string;
};

const isJsonObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

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

