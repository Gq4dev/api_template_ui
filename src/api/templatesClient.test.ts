import { afterEach, describe, expect, it, vi } from "vitest";
import { templatesApi } from "./templatesClient";

// The base URL vite.config.ts provides to every test run.
const BASE = "http://localhost/api/v1/templates";

/** Stubs fetch with one JSON answer and returns the mock to inspect the request. */
function answer(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof answer>) {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, body: init.body ? JSON.parse(String(init.body)) : undefined };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const WIRE_SUMMARY = {
  template_key: "payment_approved__BBVA",
  version: 2,
  status: "ACTIVE",
  action: "payment",
  action_type: "approved",
  collector: "BBVA",
  subject: "Hola",
  effective_from: "2026-10-01T00:00:00Z",
  effective_to: null,
  created_by: "dev@local",
  created_at: "2026-09-30T12:00:00Z",
};

const WIRE_CREATE_RESULT = {
  template_key: "payment_approved",
  version: 1,
  status: "DRAFT",
  s3_key: "templates/payment_approved/v1.html",
  checksum: "sha256:ab",
};

describe("templatesApi — snake_case at the boundary", () => {
  it("sends list filters as snake_case query params and maps the page", async () => {
    const fetchMock = answer({
      content: [WIRE_SUMMARY],
      page: 0,
      size: 20,
      total_elements: 1,
      total_pages: 1,
    });

    const page = await templatesApi.list({
      actionType: "approved",
      templateKey: "payment",
      collector: "",
      page: 0,
      size: 20,
    });

    const url = new URL(sent(fetchMock).url);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action_type: "approved",
      template_key: "payment",
      page: "0",
      size: "20",
    });
    expect(page).toEqual({
      content: [
        {
          templateKey: "payment_approved__BBVA",
          version: 2,
          status: "ACTIVE",
          action: "payment",
          actionType: "approved",
          collector: "BBVA",
          subject: "Hola",
          effectiveFrom: "2026-10-01T00:00:00Z",
          effectiveTo: null,
          createdBy: "dev@local",
          createdAt: "2026-09-30T12:00:00Z",
        },
      ],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });
  });

  it("creates with a snake_case body, omitting unset fields, and maps the result", async () => {
    const fetchMock = answer(
      {
        template_key: "payment_approved",
        version: 1,
        status: "DRAFT",
        s3_key: "templates/payment_approved/v1.html",
        checksum: "sha256:ab",
      },
      201,
    );

    const result = await templatesApi.create(
      { action: "payment", actionType: "approved", html: "<p/>" },
      { author: "dev@local", idempotencyKey: "k-1" },
    );

    const { url, init, body } = sent(fetchMock);
    expect(url).toBe(BASE);
    expect(init.headers).toMatchObject({ "X-User-Email": "dev@local", "Idempotency-Key": "k-1" });
    expect(body).toEqual({ action: "payment", action_type: "approved", html: "<p/>" });
    expect(result).toEqual({
      templateKey: "payment_approved",
      version: 1,
      status: "DRAFT",
      s3Key: "templates/payment_approved/v1.html",
      checksum: "sha256:ab",
    });
  });

  it("updates a draft with PUT, the author header and a snake_case body", async () => {
    const fetchMock = answer(WIRE_CREATE_RESULT);

    const result = await templatesApi.updateDraft(
      "payment_approved__BBVA",
      2,
      { html: "<p>v2</p>", subject: "Hola", variables: ["name"] },
      { author: "dev@local" },
    );

    const { url, init, body } = sent(fetchMock);
    expect(url).toBe(`${BASE}/payment_approved__BBVA/versions/2`);
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "X-User-Email": "dev@local",
    });
    expect(body).toEqual({ html: "<p>v2</p>", subject: "Hola", variables: ["name"] });
    expect(result.s3Key).toBe("templates/payment_approved/v1.html");
  });

  it("commits with the author header and a snake_case body", async () => {
    const fetchMock = answer(WIRE_CREATE_RESULT, 201);

    await templatesApi.commit(
      {
        action: "payment",
        actionType: "approved",
        templateKey: "payment_approved__BBVA",
        s3Key: "templates/payment_approved__BBVA/v1.html",
        variables: ["name"],
        subject: "Hola",
        collector: "BBVA",
      },
      { author: "dev@local" },
    );

    const { url, init, body } = sent(fetchMock);
    expect(url).toBe(`${BASE}/commit`);
    expect(init.method).toBe("POST");
    // No Idempotency-Key: the commit endpoint does not declare one.
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "X-User-Email": "dev@local",
    });
    expect(body).toEqual({
      action: "payment",
      action_type: "approved",
      template_key: "payment_approved__BBVA",
      s3_key: "templates/payment_approved__BBVA/v1.html",
      variables: ["name"],
      subject: "Hola",
      collector: "BBVA",
    });
  });

  it("requests an upload URL with a snake_case body and maps the answer", async () => {
    const fetchMock = answer({
      upload_url: "https://s3.example/put",
      s3_key: "templates/payment_approved/v1.html",
      expires_in: 900,
    });

    const result = await templatesApi.requestUploadUrl({
      templateKey: "payment_approved",
      action: "payment",
      actionType: "approved",
    });

    const { url, init, body } = sent(fetchMock);
    expect(url).toBe(`${BASE}/upload-url`);
    expect(init.method).toBe("POST");
    // The endpoint declares no author header.
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(body).toEqual({
      template_key: "payment_approved",
      action: "payment",
      action_type: "approved",
    });
    expect(result).toEqual({
      uploadUrl: "https://s3.example/put",
      s3Key: "templates/payment_approved/v1.html",
      expiresIn: 900,
    });
  });

  it("archives with a bodiless POST and no author header", async () => {
    const fetchMock = answer({
      template_key: "payment_approved",
      version: 1,
      status: "ARCHIVED",
      effective_from: "2026-01-01T00:00:00Z",
      effective_to: "2026-10-20T00:00:00Z",
    });

    const result = await templatesApi.archive("payment_approved", 1);

    const { url, init, body } = sent(fetchMock);
    expect(url).toBe(`${BASE}/payment_approved/versions/1/archive`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(body).toBeUndefined();
    expect(result).toEqual({
      templateKey: "payment_approved",
      version: 1,
      status: "ARCHIVED",
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2026-10-20T00:00:00Z",
    });
  });

  it("publishes with the author header", async () => {
    const fetchMock = answer({
      template_key: "payment_approved",
      version: 1,
      status: "ACTIVE",
      effective_from: "2026-10-20T00:00:00Z",
      effective_to: null,
    });

    await templatesApi.publish("payment_approved", 1, {}, { author: "dev@local" });

    const { init, body } = sent(fetchMock);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      "X-User-Email": "dev@local",
    });
    // An empty payload means "live now": nothing is sent, not nulls.
    expect(body).toEqual({});
  });

  it("publishes with snake_case effectivity and maps the status", async () => {
    const fetchMock = answer({
      template_key: "payment_approved",
      version: 1,
      status: "SCHEDULED",
      effective_from: "2030-01-01T00:00:00Z",
      effective_to: null,
    });

    const result = await templatesApi.publish("payment_approved", 1, {
      effectiveFrom: "2030-01-01T00:00:00Z",
    });

    const { url, body } = sent(fetchMock);
    expect(url).toBe(`${BASE}/payment_approved/versions/1/publish`);
    expect(body).toEqual({ effective_from: "2030-01-01T00:00:00Z" });
    expect(result).toEqual({
      templateKey: "payment_approved",
      version: 1,
      status: "SCHEDULED",
      effectiveFrom: "2030-01-01T00:00:00Z",
      effectiveTo: null,
    });
  });

  it("resolves by action with action_type and maps the content", async () => {
    const fetchMock = answer({
      template_key: "payment_approved",
      version: 3,
      status: "ACTIVE",
      action: "payment",
      action_type: "approved",
      collector: null,
      subject: null,
      variables: ["name"],
      html: "<p>{{ name }}</p>",
      effective_from: "2026-01-01T00:00:00Z",
      effective_to: null,
      fallback_to_generic: true,
    });

    const content = await templatesApi.resolveByAction("payment", "approved", {
      collector: "BBVA",
    });

    const url = new URL(sent(fetchMock).url);
    expect(url.pathname).toBe("/api/v1/templates/resolve");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "payment",
      action_type: "approved",
      collector: "BBVA",
    });
    expect(content).toMatchObject({
      templateKey: "payment_approved",
      actionType: "approved",
      collector: null,
      variables: ["name"],
      effectiveFrom: "2026-01-01T00:00:00Z",
      fallbackToGeneric: true,
    });
  });

  // `resolutionOutcome` tells "the server never mentioned the collector" from
  // "the server said: the generic" by key presence. The mapper must keep it.
  it("leaves collector and fallbackToGeneric absent when the body lacks them", async () => {
    answer({
      template_key: "payment_approved",
      version: 1,
      status: "ACTIVE",
      action: "payment",
      action_type: "approved",
      subject: null,
      variables: [],
      html: "<p/>",
      effective_from: null,
      effective_to: null,
    });

    const content = await templatesApi.getVersion("payment_approved", 1);

    expect("collector" in content).toBe(false);
    expect("fallbackToGeneric" in content).toBe(false);
  });

  it("maps the addressed resolve, which has an s3 key and no action", async () => {
    answer({
      template_key: "payment_approved",
      version: 1,
      status: "ACTIVE",
      collector: null,
      s3_key: "templates/payment_approved/v1.html",
      subject: null,
      variables: null,
      effective_from: "2026-01-01T00:00:00Z",
      effective_to: null,
    });

    expect(await templatesApi.resolve("payment_approved")).toEqual({
      templateKey: "payment_approved",
      version: 1,
      status: "ACTIVE",
      s3Key: "templates/payment_approved/v1.html",
      collector: null,
      subject: null,
      variables: [],
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: null,
    });
  });
});
