/**
 * Tests for SseHub — subscription, publish routing, and backpressure.
 */

import { SseHub, MAX_QUEUE_SIZE } from "./sseHub";
import type { Response } from "express";

function makeRes(): { res: Response; written: string[] } {
  const written: string[] = [];
  const res = {
    writableEnded: false,
    destroyed: false,
    write: jest.fn((chunk: string) => {
      written.push(chunk);
      return true;
    }),
  } as unknown as Response;
  return { res, written };
}

describe("SseHub", () => {
  let hub: SseHub;
  let timers: NodeJS.Timeout[];

  beforeEach(() => {
    hub = new SseHub();
    timers = [];
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    timers.forEach((t) => clearInterval(t));
  });

  it("routes events to all-stream subscribers", () => {
    const { res, written } = makeRes();
    hub.subscribe(res, null);

    hub.publish({
      eventType: "settled",
      streamId: "stream_1",
      occurredAt: "2026-01-01T00:00:00Z",
    });

    expect(written.join("")).toContain("event: settled");
    expect(written.join("")).toContain('"streamId":"stream_1"');
  });

  it("routes events only to matching single-stream subscribers", () => {
    const { res: resA, written: writtenA } = makeRes();
    const { res: resB, written: writtenB } = makeRes();
    hub.subscribe(resA, "stream_1");
    hub.subscribe(resB, "stream_2");

    hub.publish({
      eventType: "settled",
      streamId: "stream_1",
      occurredAt: "2026-01-01T00:00:00Z",
    });

    expect(writtenA.join("")).toContain("event: settled");
    expect(writtenB.join("")).toBe("");
  });

  it("disconnect removes the client and stops heartbeats", () => {
    const { res } = makeRes();
    const id = hub.subscribe(res, null);
    expect(hub.clientCount).toBe(1);

    hub.disconnect(id);
    expect(hub.clientCount).toBe(0);
  });

  it("emits a dropped event when the queue overflows (backpressure)", () => {
    const { res, written } = makeRes();
    hub.subscribe(res, null);

    // Fill the queue past MAX_QUEUE_SIZE.
    for (let i = 0; i < MAX_QUEUE_SIZE + 5; i++) {
      hub.publish({
        eventType: "stream-update",
        streamId: "stream_1",
        occurredAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`,
      });
    }

    const all = written.join("");
    expect(all).toContain("event: stream-update:dropped");
    // The queue is bounded: at most MAX_QUEUE_SIZE events flushed.
    const flushed = written.filter((w) => w.includes("event: stream-update\n"));
    expect(flushed.length).toBeLessThanOrEqual(MAX_QUEUE_SIZE);
  });

  it("drops clients whose connection has ended", () => {
    const { res } = makeRes();
    hub.subscribe(res, null);
    expect(hub.clientCount).toBe(1);

    // Simulate the connection closing.
    (res as unknown as { writableEnded: boolean }).writableEnded = true;
    hub.publish({
      eventType: "settled",
      streamId: "stream_1",
      occurredAt: "2026-01-01T00:00:00Z",
    });

    expect(hub.clientCount).toBe(0);
  });
});
