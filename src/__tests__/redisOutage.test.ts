import { NextFunction, Request, Response } from "express";
import { requireRedisForMutation, redisMutationsRequired } from "../middleware/redisAvailability";
import { markRedisAvailable, markRedisUnavailable, recordRedisStateChange, register } from "../metrics/prometheus";
import { InMemoryJobLease, RedisJobLease } from "../services/jobLease";

const responseMock = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  (response.status as jest.Mock).mockReturnValue(response);
  return response;
};

const requestMock = (method: string): Request => ({ method } as Request);

describe("Redis outage policy", () => {
  afterEach(() => {
    delete process.env.REDIS_REQUIRED_FOR_MUTATIONS;
  });

  it("does not require Redis when degraded mode is not configured", async () => {
    const next = jest.fn() as NextFunction;
    await requireRedisForMutation(requestMock("POST"), responseMock(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(redisMutationsRequired()).toBe(false);
  });

  it("fails closed for configured mutations when Redis is unavailable", async () => {
    process.env.REDIS_REQUIRED_FOR_MUTATIONS = "true";
    const response = responseMock();
    const next = jest.fn() as NextFunction;

    await requireRedisForMutation(requestMock("PATCH"), response, next);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      error: "redis_unavailable",
      retryable: true,
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it("does not block read-only requests during a Redis outage", async () => {
    process.env.REDIS_REQUIRED_FOR_MUTATIONS = "true";
    const next = jest.fn() as NextFunction;

    await requireRedisForMutation(requestMock("GET"), responseMock(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Redis cannot provide a job lease", async () => {
    const lease = new InMemoryJobLease(false);
    expect(await lease.acquire("delivery-1", "worker-1")).toBe(false);
    expect(lease.has("delivery-1")).toBe(false);
  });

  it("allows only one worker to own a job at a time", async () => {
    const lease = new InMemoryJobLease();
    const results = await Promise.all([
      lease.acquire("delivery-1", "worker-a"),
      lease.acquire("delivery-1", "worker-b"),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(lease.has("delivery-1")).toBe(true);
    await lease.release("delivery-1", "worker-b");
    expect(lease.has("delivery-1")).toBe(true);
    await lease.release("delivery-1", "worker-a");
    expect(lease.has("delivery-1")).toBe(false);
  });

  it("maps Redis SET outcomes to acquired and busy decisions", async () => {
    const set = jest.fn()
      .mockResolvedValueOnce("OK")
      .mockResolvedValueOnce(null);
    const fakeClient = { set, eval: jest.fn() };
    const lease = new RedisJobLease(async () => fakeClient as never, () => "nonce");

    expect(await lease.acquire("delivery-1", "worker-a", 10_000)).toBe(true);
    expect(await lease.acquire("delivery-1", "worker-b", 10_000)).toBe(false);
    expect(set).toHaveBeenNthCalledWith(1, "streampay:job-lease:delivery-1", "worker-a:nonce", {
      NX: true,
      PX: 10_000,
    });
  });

  it("treats Redis lease errors as a safe skip", async () => {
    const lease = new RedisJobLease(async () => ({
      set: jest.fn().mockRejectedValue(new Error("connection lost")),
    } as never));
    expect(await lease.acquire("delivery-1", "worker-a")).toBe(false);
  });

  it("releases only through the owner-checked Redis script", async () => {
    const evalFn = jest.fn().mockResolvedValue(1);
    const lease = new RedisJobLease(async () => ({ eval: evalFn } as never));
    await lease.release("delivery-1", "worker-a");

    expect(evalFn).toHaveBeenCalledWith(expect.stringContaining("redis.call('get'"), {
      keys: ["streampay:job-lease:delivery-1"],
      arguments: ["worker-a"],
    });
  });

  it("exposes availability and transition metrics for operators", async () => {
    markRedisUnavailable("test");
    recordRedisStateChange("failure", "test");
    markRedisAvailable("test");
    recordRedisStateChange("recovery", "test");
    const output = await register.metrics();

    expect(output).toContain('redis_availability{component="test"} 1');
    expect(output).toContain('redis_state_changes_total{component="test",state="failure"}');
    expect(output).toContain('redis_state_changes_total{component="test",state="recovery"}');
  });
});
