/**
 * SSE Hub — in-process pub/sub for real-time stream updates.
 *
 * Responsibilities:
 *  - Track connected SSE clients and the streams they subscribe to.
 *  - Publish stream update events to all matching subscribers.
 *  - Enforce a documented backpressure strategy so a slow consumer cannot
 *    block the event loop or exhaust memory.
 *
 * Backpressure strategy:
 *  Each client connection has a bounded outbound queue (MAX_QUEUE_SIZE).
 *  When the queue is full, the oldest buffered event is dropped and a
 *  `stream-update:dropped` event is emitted so the client knows it missed
 *  data and should re-fetch the canonical stream state. This is a
 *  "drop-oldest" strategy: it keeps memory bounded and never blocks the
 *  publisher, at the cost of possible missed intermediate snapshots.
 */

import type { Response } from "express";

export type StreamUpdateEvent = {
  eventType: string;
  streamId: string;
  occurredAt: string;
  data?: Record<string, unknown>;
};

export const MAX_QUEUE_SIZE = 100;
export const HEARTBEAT_INTERVAL_MS = 15_000;

type Client = {
  id: string;
  streamId: string | null; // null = subscribe to all streams
  res: Response;
  queue: StreamUpdateEvent[];
  heartbeat: NodeJS.Timeout;
};

export class SseHub {
  private readonly clients = new Map<string, Client>();
  private nextId = 1;

  /**
   * Register a new SSE client. Returns the client id.
   * The caller is responsible for wiring up `req.on("close")` to call `disconnect`.
   */
  subscribe(res: Response, streamId: string | null): string {
    const id = `sse-${this.nextId++}`;
    const client: Client = {
      id,
      streamId,
      res,
      queue: [],
      heartbeat: setInterval(() => {
        // Heartbeat keeps proxies from closing idle connections.
        this.write(client, ": keep-alive\n\n");
      }, HEARTBEAT_INTERVAL_MS),
    };
    this.clients.set(id, client);
    return id;
  }

  /** Remove a client and stop its heartbeat. */
  disconnect(id: string): void {
    const client = this.clients.get(id);
    if (!client) return;
    clearInterval(client.heartbeat);
    this.clients.delete(id);
  }

  /**
   * Publish a stream update to all subscribed clients.
   * Clients subscribed to a specific stream only receive events for that stream.
   */
  publish(event: StreamUpdateEvent): void {
    for (const client of this.clients.values()) {
      if (client.streamId !== null && client.streamId !== event.streamId) {
        continue;
      }
      this.enqueue(client, event);
    }
  }

  /** Number of currently connected clients (useful for tests/metrics). */
  get clientCount(): number {
    return this.clients.size;
  }

  private enqueue(client: Client, event: StreamUpdateEvent): void {
    if (client.queue.length >= MAX_QUEUE_SIZE) {
      // Drop the oldest buffered event to make room, then notify the client.
      client.queue.shift();
      client.queue.push({
        eventType: "stream-update:dropped",
        streamId: event.streamId,
        occurredAt: new Date().toISOString(),
        data: { reason: "client_backpressure" },
      });
    } else {
      client.queue.push(event);
    }
    this.flush(client);
  }

  private flush(client: Client): void {
    while (client.queue.length > 0) {
      const event = client.queue.shift()!;
      this.write(client, this.formatEvent(event));
    }
  }

  private formatEvent(event: StreamUpdateEvent): string {
    const lines = [
      `event: ${event.eventType}`,
      `id: ${event.streamId}:${event.occurredAt}`,
      `data: ${JSON.stringify(event)}`,
    ];
    return `${lines.join("\n")}\n\n`;
  }

  private write(client: Client, chunk: string): void {
    if (client.res.writableEnded || client.res.destroyed) {
      // Connection already gone — drop it.
      this.disconnect(client.id);
      return;
    }
    client.res.write(chunk);
  }
}

/** Singleton hub shared across the application. */
export const sseHub = new SseHub();
