import { describe, expect, it } from "vitest";
import {
  validateLimit,
  validateEnum,
  intArg,
  requireForce,
  safeProfileName,
  bookmarkSorts,
  collectionViews,
  exportFormats,
  backupFormats,
  sharingRoles,
  highlightColors,
} from "../src/core/validators.js";
import { CLIError } from "../src/core/errors.js";

function expectError(fn: () => void, code: string) {
  try {
    fn();
    expect.unreachable("expected an error");
  } catch (e) {
    expect(e).toBeInstanceOf(CLIError);
    expect((e as CLIError).code).toBe(code);
    return e as CLIError;
  }
}

describe("validators", () => {
  describe("validateLimit", () => {
    it("accepts valid limits", () => {
      expect(validateLimit(1)).toBe(1);
      expect(validateLimit(25)).toBe(25);
      expect(validateLimit(50)).toBe(50);
      expect(validateLimit(undefined)).toBe(50);
    });

    it("rejects out-of-range limits", () => {
      expectError(() => validateLimit(0), "invalid_limit");
      expectError(() => validateLimit(51), "invalid_limit");
      expectError(() => validateLimit(-1), "invalid_limit");
      expectError(() => validateLimit(100), "invalid_limit");
    });
  });

  describe("validateEnum", () => {
    it("accepts valid bookmark sorts", () => {
      for (const sort of bookmarkSorts) {
        expect(validateEnum(sort, bookmarkSorts, "sort", "")).toBe(sort);
      }
    });

    it("accepts valid collection views", () => {
      for (const view of collectionViews) {
        expect(validateEnum(view, collectionViews, "view", "")).toBe(view);
      }
    });

    it("accepts valid export formats", () => {
      for (const fmt of exportFormats) {
        expect(validateEnum(fmt, exportFormats, "format", "")).toBe(fmt);
      }
    });

    it("accepts valid backup formats", () => {
      for (const fmt of backupFormats) {
        expect(validateEnum(fmt, backupFormats, "format", "")).toBe(fmt);
      }
    });

    it("accepts valid sharing roles", () => {
      for (const role of sharingRoles) {
        expect(validateEnum(role, sharingRoles, "role", "")).toBe(role);
      }
    });

    it("accepts valid highlight colors", () => {
      for (const color of highlightColors) {
        expect(validateEnum(color, highlightColors, "color", "")).toBe(color);
      }
    });

    it("rejects invalid enum with valid_values in envelope", () => {
      const err = expectError(
        () =>
          validateEnum(
            "invalid",
            bookmarkSorts,
            "sort",
            "raindrop bookmark list --sort -created",
          ),
        "invalid_sort",
      );
      expect(err.validValues).toEqual(bookmarkSorts);
      expect(err.usage).toBe("raindrop bookmark list --sort -created");
    });

    it("rejects invalid view", () => {
      const err = expectError(
        () =>
          validateEnum(
            "cards",
            collectionViews,
            "view",
            "raindrop collection create --view list",
          ),
        "invalid_view",
      );
      expect(err.validValues).toEqual(collectionViews);
    });

    it("rejects invalid export format", () => {
      const err = expectError(
        () =>
          validateEnum(
            "pdf",
            exportFormats,
            "format",
            "raindrop export bookmarks 0 csv --output out.csv",
          ),
        "invalid_format",
      );
      expect(err.validValues).toEqual(exportFormats);
    });

    it("rejects invalid sharing role", () => {
      const err = expectError(
        () =>
          validateEnum(
            "admin",
            sharingRoles,
            "role",
            "raindrop collection sharing invite 123 --role viewer --email a@b.com",
          ),
        "invalid_role",
      );
      expect(err.validValues).toEqual(sharingRoles);
    });

    it("rejects invalid highlight color", () => {
      const err = expectError(
        () =>
          validateEnum(
            "magenta",
            highlightColors,
            "color",
            "raindrop highlight add 123 --text quote --color yellow",
          ),
        "invalid_color",
      );
      expect(err.validValues).toEqual(highlightColors);
    });
  });

  describe("intArg", () => {
    it("parses valid integers", () => {
      expect(intArg("0", "id")).toBe(0);
      expect(intArg("123", "id")).toBe(123);
      expect(intArg("-99", "id")).toBe(-99);
    });

    it("rejects non-integers", () => {
      expectError(() => intArg("abc", "id"), "invalid_integer");
      expectError(() => intArg("1.5", "id"), "invalid_integer");
    });
  });

  describe("requireForce", () => {
    it("passes when force is true", () => {
      expect(() => requireForce(true, "test")).not.toThrow();
    });

    it("throws when force is false", () => {
      const err = expectError(
        () => requireForce(false, "bookmark delete"),
        "force_required",
      );
      expect(err.hint).toContain("--force");
    });

    it("throws when force is undefined", () => {
      expectError(() => requireForce(undefined, "test"), "force_required");
    });
  });

  describe("safeProfileName", () => {
    it("accepts valid profile names", () => {
      expect(safeProfileName("default")).toBe("default");
      expect(safeProfileName("my-profile")).toBe("my-profile");
      expect(safeProfileName("work_2")).toBe("work_2");
      expect(safeProfileName("a.b")).toBe("a.b");
    });

    it("rejects invalid profile names", () => {
      expectError(() => safeProfileName(""), "invalid_profile");
      expectError(() => safeProfileName("has space"), "invalid_profile");
      expectError(() => safeProfileName("special!"), "invalid_profile");
      expectError(() => safeProfileName("a/b"), "invalid_profile");
    });
  });

  describe("error envelope structure", () => {
    it("CLIError envelope includes all optional fields when present", () => {
      const err = new CLIError({
        code: "test_code",
        message: "test message",
        hint: "try this",
        status: 400,
        validValues: ["a", "b"],
        usage: "cmd --flag a",
        exitCode: 2,
        requestId: "req-123",
        rateLimit: { limit: 120, remaining: 0, reset: 60 },
      });
      const env = err.envelope();
      expect(env.error).toEqual({
        code: "test_code",
        message: "test message",
        hint: "try this",
        status: 400,
        valid_values: ["a", "b"],
        usage: "cmd --flag a",
        request_id: "req-123",
        rate_limit: { limit: 120, remaining: 0, reset: 60 },
      });
    });

    it("CLIError envelope omits undefined optional fields", () => {
      const err = new CLIError({
        code: "simple",
        message: "simple error",
      });
      const env = err.envelope();
      expect(env.error).toEqual({
        code: "simple",
        message: "simple error",
      });
      expect(env.error).not.toHaveProperty("hint");
      expect(env.error).not.toHaveProperty("valid_values");
      expect(env.error).not.toHaveProperty("usage");
    });

    it("validation errors use exit code 2", () => {
      const err = expectError(
        () => validateEnum("x", ["a", "b"], "test", "cmd --test a"),
        "invalid_test",
      );
      expect(err.exitCode).toBe(2);
    });

    it("force-required errors use exit code 2", () => {
      const err = expectError(
        () => requireForce(false, "test"),
        "force_required",
      );
      expect(err.exitCode).toBe(2);
    });
  });
});
