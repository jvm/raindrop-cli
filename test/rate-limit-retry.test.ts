import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/core/client.js";

describe("rate-limit retry", () => {
  it("retries on 429 and succeeds on second attempt", async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;

    const mockFetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) => {
        callCount++;
        if (callCount === 1) {
          return new Response(
            JSON.stringify({ result: false, errorMessage: "Rate limited" }),
            {
              status: 429,
              headers: {
                "x-ratelimit-reset": "0",
                "content-type": "application/json",
              },
            },
          );
        }
        return new Response(
          JSON.stringify({ result: true, user: { _id: 1 } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    );

    globalThis.fetch = mockFetch as any;

    try {
      const client = new ApiClient({
        debug: false,
        baseUrl: "https://api.raindrop.io/rest/v1",
      });

      // Mock resolveRuntime by directly calling request with skipAuth
      await client.request({
        method: "GET",
        path: "/user",
        skipAuth: true,
        operationName: "user.get",
        profile: "default",
        baseUrl: "https://httpbin.org", // won't be used, fetch is mocked
      });

      // The mock returns the success response after retry
      expect(callCount).toBeGreaterThanOrEqual(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("exits with rate-limited code after exhausting retries", async () => {
    const originalFetch = globalThis.fetch;

    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({ result: false, errorMessage: "Rate limited" }),
        {
          status: 429,
          headers: {
            "x-ratelimit-reset": "0",
            "content-type": "application/json",
          },
        },
      );
    });

    globalThis.fetch = mockFetch as any;

    try {
      const client = new ApiClient({});
      await expect(
        client.request({
          method: "GET",
          path: "/user",
          skipAuth: true,
          operationName: "user.get",
        }),
      ).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
