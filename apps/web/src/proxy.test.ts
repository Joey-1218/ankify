import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const originalOrigins = process.env.ANKILEET_EXTENSION_ORIGINS;
const originalProfile = process.env.ANKILEET_PROFILE;

afterEach(() => {
  if (originalOrigins === undefined) {
    delete process.env.ANKILEET_EXTENSION_ORIGINS;
  } else {
    process.env.ANKILEET_EXTENSION_ORIGINS = originalOrigins;
  }
  if (originalProfile === undefined) {
    delete process.env.ANKILEET_PROFILE;
  } else {
    process.env.ANKILEET_PROFILE = originalProfile;
  }
});

describe("extension session CORS", () => {
  it("keeps the product homepage public for Google OAuth verification", async () => {
    const response = await proxy(
      new NextRequest("https://ankileet.example.com/"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
  });

  it("keeps the extension welcome page public before sign-in", async () => {
    const response = await proxy(
      new NextRequest("https://ankileet.example.com/welcome?source=extension"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
  });

  it("lets Vercel Queue callbacks reach the queue SDK without a user cookie", async () => {
    const response = await proxy(
      new NextRequest("https://ankileet.example.com/api/queues/ai-generation", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
  });

  it("lets Stripe webhooks through without a cookie but keeps checkout private", async () => {
    const webhook = await proxy(
      new NextRequest("https://ankileet.example.com/api/billing/webhook", { method: "POST" }),
    );
    expect(webhook.status).toBe(200);

    const checkout = await proxy(
      new NextRequest("https://ankileet.example.com/api/billing/checkout", { method: "POST" }),
    );
    expect(checkout.status).toBe(401);
  });

  it("opens the fixed-session login only in the QA profile", async () => {
    process.env.ANKILEET_PROFILE = "qa";
    const qaResponse = await proxy(
      new NextRequest("http://localhost:3000/api/qa/login"),
    );
    expect(qaResponse.status).toBe(200);

    process.env.ANKILEET_PROFILE = "local";
    const localResponse = await proxy(
      new NextRequest("http://localhost:3000/api/qa/login"),
    );
    expect(localResponse.status).toBe(401);
  });

  it("allows credentialed preflight only for configured extension origins", async () => {
    process.env.ANKILEET_EXTENSION_ORIGINS = extensionOrigin;
    const response = await proxy(
      new NextRequest("https://ankileet.example.com/api/capture", {
        method: "OPTIONS",
        headers: { origin: extensionOrigin },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type, X-Ankileet-Owner-Token");
  });

  it("does not let retired x-ankileet-token headers bypass session auth", async () => {
    process.env.ANKILEET_EXTENSION_ORIGINS = extensionOrigin;
    const response = await proxy(
      new NextRequest("https://ankileet.example.com/api/me", {
        headers: {
          origin: extensionOrigin,
          "x-ankileet-token": "retired-token",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not grant CORS to an untrusted extension", async () => {
    process.env.ANKILEET_EXTENSION_ORIGINS = extensionOrigin;
    const response = await proxy(
      new NextRequest("https://ankileet.example.com/api/me", {
        headers: {
          origin: "chrome-extension://pppppppppppppppppppppppppppppppp",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
  });
});
