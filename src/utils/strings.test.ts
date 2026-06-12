import { isBlank, toCamelCase, truncate } from "./strings";

describe("truncate", () => {
  it("returns the original string when shorter than maxLength", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });

  it("returns the original string when exactly maxLength", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("appends an ellipsis when truncation occurs", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("returns an empty string for non-positive maxLength", () => {
    expect(truncate("anything", 0)).toBe("");
    expect(truncate("anything", -3)).toBe("");
  });
});

describe("isBlank", () => {
  it.each([
    [null, true],
    [undefined, true],
    ["", true],
    ["   ", true],
    ["\n\t", true],
    [" a ", false],
    ["x", false],
  ])("isBlank(%p) -> %p", (input, expected) => {
    expect(isBlank(input as string | null | undefined)).toBe(expected);
  });
});

describe("toCamelCase", () => {
  it("converts kebab-case", () => {
    expect(toCamelCase("hello-world-foo")).toBe("helloWorldFoo");
  });

  it("converts snake_case", () => {
    expect(toCamelCase("hello_world_foo")).toBe("helloWorldFoo");
  });

  it("leaves already-camel input untouched", () => {
    expect(toCamelCase("helloWorld")).toBe("helloWorld");
  });
});
