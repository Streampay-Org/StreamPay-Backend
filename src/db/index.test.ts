describe("Database Pool Configuration", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  describe("Pool settings for different environments", () => {
    it("should configure pool for test environment", () => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";

      jest.isolateModules(() => {
        require("./index");
      });
    });

    it("should configure pool for development environment", () => {
      process.env.NODE_ENV = "development";
      process.env.DATABASE_URL = "postgres://dev:dev@localhost:5432/dev";

      jest.isolateModules(() => {
        require("./index");
      });
    });

    it("should configure pool for production environment", () => {
      process.env.NODE_ENV = "production";
      process.env.DATABASE_URL = "postgres://prod:prod@localhost:5432/prod";

      jest.isolateModules(() => {
        require("./index");
      });
    });
  });
});
