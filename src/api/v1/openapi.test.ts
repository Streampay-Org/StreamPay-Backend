import request from "supertest";
import app from "../../index";
import { generateOpenApi } from "./openapi";

describe("OpenAPI Specification", () => {
  it("should serve the OpenAPI JSON at /api/openapi.json", async () => {
    const response = await request(app).get("/api/openapi.json");
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe("3.0.0");
    expect(response.body.info.title).toBe("StreamPay API");
  });

  it("should include health and stream paths", () => {
    const spec = generateOpenApi();
    expect(spec.paths).toHaveProperty("/health");
    expect(spec.paths).toHaveProperty("/api/v1/streams");
    expect(spec.paths).toHaveProperty("/api/v1/streams/{id}");
  });

  it("should match the snapshot", () => {
    const spec = generateOpenApi();
    // We normalize some fields if necessary, but here we just snapshot
    expect(spec).toMatchSnapshot();
  });
});
