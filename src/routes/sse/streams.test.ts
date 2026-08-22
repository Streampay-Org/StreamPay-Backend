/**
 * Tests for the SSE stream update route.
 */

import request from "supertest";
import app from "../../index";
import { refreshApiKeyStore } from "../../middleware/apiKeyAuth";
import { sseHub } from "../../services/sseHub";

describe("SSE Stream Update Routes", () => {
  beforeAll(() => {
    process.env.API_KEYS = "test-1234";
    refreshApiKeyStore();
  });

  afterAll(() => {
    delete process.env.API_KEYS;
  });

  afterEach(() => {
    // Ensure no leaked clients between tests.
    // (The hub is a singleton; disconnect any lingering connections.)
  });

  it("requires an API key", async () => {
    const response = await request(app).get("/api/v1/streams/events");
    expect(response.status).toBe(401);
  });

  it("rejects an invalid stream id for single-stream events", async () => {
    const response = await request(app)
      .get("/api/v1/streams/not-a-uuid/events")
      .set("x-api-key", "test-1234");
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid stream ID format");
  });

  it("opens an SSE connection for all streams and receives published events", async () => {
    const agent = request.agent(app);
    const res = agent
      .get("/api/v1/streams/events")
      .set("x-api-key", "test-1234")
      .set("Accept", "text/event-stream");

    // The connection stays open; publish an event and read the stream.
    const stream = res;
    const dataPromise = new Promise<string>((resolve) => {
      stream.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (text.includes("event: stream-update")) {
          resolve(text);
        }
      });
    });

    // Give the connection a moment to establish.
    await new Promise((r) => setTimeout(r, 50));

    sseHub.publish({
      eventType: "settled",
      streamId: "123e4567-e89b-12d3-a456-426614174000",
      occurredAt: "2026-01-01T00:00:00Z",
    });

    const data = await dataPromise;
    expect(data).toContain("event: stream-update");
    expect(data).toContain("event: settled");
    expect(data).toContain("123e4567-e89b-12d3-a456-426614174000");

    // Clean up the open connection.
    stream.destroy();
  });
});
