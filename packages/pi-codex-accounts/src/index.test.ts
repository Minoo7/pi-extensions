import { describe, expect, it } from "vitest";
import { accountForProvider, decodeJwtPayload, normalizeAccountName } from "./index.js";

describe("normalizeAccountName", () => {
  it("normalizes aliases for provider ids", () => {
    expect(normalizeAccountName(" Work ChatGPT+Codex ")).toBe("work-chatgpt-codex");
    expect(normalizeAccountName("_Personal_Account_")).toBe("_personal_account_");
    expect(normalizeAccountName("---")).toBe("");
  });
});

describe("accountForProvider", () => {
  it("maps Codex provider ids back to account aliases", () => {
    expect(accountForProvider("openai-codex")).toBe("current");
    expect(accountForProvider("openai-codex-work")).toBe("work");
    expect(accountForProvider("anthropic")).toBeUndefined();
    expect(accountForProvider(undefined)).toBeUndefined();
  });
});

describe("decodeJwtPayload", () => {
  it("decodes URL-safe JWT payloads without validating signatures", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "user", "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" } })).toString("base64url");

    expect(decodeJwtPayload(`header.${payload}.signature`)).toEqual({
      sub: "user",
      "https://api.openai.com/auth": { chatgpt_account_id: "acct_123" },
    });
  });

  it("returns null for malformed tokens", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
  });
});
