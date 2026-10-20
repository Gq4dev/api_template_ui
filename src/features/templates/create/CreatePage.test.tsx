import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "../../../app/providers";
import { CreatePage } from "./CreatePage";

// This project does not set `test.globals: true`, so Testing Library's
// automatic afterEach-cleanup detection (which relies on a global
// `afterEach`) never registers. Clean up explicitly to avoid duplicate
// DOM nodes leaking between tests in this file.
afterEach(cleanup);

// The `create` mock lives at module scope (created once by the vi.mock factory),
// so its call history and implementation would otherwise leak between tests.
// Reset per test to keep call-count assertions isolated.
afterEach(() => {
  vi.resetAllMocks();
});

vi.mock("../../../api/templatesClient", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../api/templatesClient")>();
  return {
    ...actual,
    templatesApi: {
      ...actual.templatesApi,
      create: vi.fn(),
      // The stored catalogue gates and shapes the submit; see renderCreatePage.
      list: vi.fn(),
    },
  };
});

async function renderCreatePage() {
  // A catalogue holding the ORDER/CREATED generic in the spelling these tests
  // type, so the spelling rule sends exactly what is typed. The submit stays
  // disabled until the catalogue has loaded, hence the wait.
  const { templatesApi } = await import("../../../api/templatesClient");
  vi.mocked(templatesApi.list).mockResolvedValue({
    content: [
      {
        templateKey: "order_created",
        version: 1,
        status: "ACTIVE",
        action: "ORDER",
        actionType: "CREATED",
        collector: null,
        subject: null,
        effectiveFrom: null,
        effectiveTo: null,
        createdBy: "seed",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    page: 0,
    size: 500,
    totalElements: 1,
    totalPages: 1,
  });

  const user = userEvent.setup();
  render(
    <AppProviders>
      <CreatePage />
    </AppProviders>,
  );
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /guardar borrador/i })).toBeEnabled();
  });
  return user;
}

// Fills the three required fields so submit reaches the API layer.
async function fillRequiredFields(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: /^action$/i }), "ORDER");
  await user.type(
    screen.getByRole("textbox", { name: /^action type$/i }),
    "CREATED",
  );
  await user.type(
    screen.getByRole("textbox", { name: /^html body$/i }),
    "<p>hi</p>",
  );
}

function submitButton(): HTMLElement {
  return screen.getByRole("button", { name: /guardar borrador/i });
}

// The `Idempotency-Key` sent on the Nth create call (0-indexed). `create` is the
// mocked templatesApi.create; typed via vi.mocked so `opts` is inferred.
function idempotencyKeyOfCall(
  create: typeof import("../../../api/templatesClient").templatesApi.create,
  callIndex: number,
): string | undefined {
  return vi.mocked(create).mock.calls[callIndex]?.[1]?.idempotencyKey;
}

const SUCCESS_RESPONSE = {
  templateKey: "order-created",
  version: 1,
  status: "DRAFT" as const,
  s3Key: "s3://bucket/order-created/1.html",
  checksum: "sha256:abc123",
};

describe("CreatePage", () => {
  it("shows required-field errors and does not call the API when submitted empty", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    const user = await renderCreatePage();

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));

    expect(
      await screen.findByText("Action es obligatorio."),
    ).toBeInTheDocument();
    expect(screen.getByText("Action type es obligatorio.")).toBeInTheDocument();
    expect(screen.getByText("HTML body es obligatorio.")).toBeInTheDocument();
    expect(templatesApi.create).not.toHaveBeenCalled();
  });

  it("submits with an idempotency key and shows the success panel", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    vi.mocked(templatesApi.create).mockResolvedValueOnce({
      templateKey: "order-created",
      version: 1,
      status: "DRAFT",
      s3Key: "s3://bucket/order-created/1.html",
      checksum: "sha256:abc123",
    });

    const user = await renderCreatePage();

    // getByRole's accessible-name computation excludes the aria-hidden "*"
    // required-marker span, unlike getByLabelText's raw textContent match.
    await user.type(screen.getByRole("textbox", { name: /^action$/i }), "ORDER");
    await user.type(
      screen.getByRole("textbox", { name: /^action type$/i }),
      "CREATED",
    );
    await user.type(
      screen.getByRole("textbox", { name: /^html body$/i }),
      "<p>hi</p>",
    );

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));

    expect(
      await screen.findByText(/status: DRAFT/i),
    ).toBeInTheDocument();
    expect(screen.getByText("order-created", { exact: false })).toBeInTheDocument();

    expect(templatesApi.create).toHaveBeenCalledTimes(1);
    const [payload, opts] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toMatchObject({
      action: "ORDER",
      actionType: "CREATED",
      html: "<p>hi</p>",
    });
    expect(opts?.idempotencyKey).toEqual(expect.any(String));
  });

  it("surfaces a distinct message on network failure", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    vi.mocked(templatesApi.create).mockRejectedValueOnce(
      new TypeError("Failed to fetch"),
    );

    const user = await renderCreatePage();

    await user.type(screen.getByRole("textbox", { name: /^action$/i }), "ORDER");
    await user.type(
      screen.getByRole("textbox", { name: /^action type$/i }),
      "CREATED",
    );
    await user.type(
      screen.getByRole("textbox", { name: /^html body$/i }),
      "<p>hi</p>",
    );

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/no se puede llegar al servidor/i),
      ).toBeInTheDocument();
    });
  });

  it("REUSES the idempotency key when resubmitting after a network failure", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    // Every attempt fails at the transport layer (no ApiError) → NETWORK kind.
    vi.mocked(templatesApi.create).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );

    const user = await renderCreatePage();
    await fillRequiredFields(user);

    await user.click(submitButton());
    await waitFor(() => {
      expect(screen.getByText(/no se puede llegar al servidor/i)).toBeInTheDocument();
    });

    // Resubmit the same (unedited) form — a retry of the same logical attempt.
    await user.click(submitButton());
    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalledTimes(2);
    });

    const key1 = idempotencyKeyOfCall(templatesApi.create, 0);
    const key2 = idempotencyKeyOfCall(templatesApi.create, 1);
    expect(key1).toEqual(expect.any(String));
    expect(key2).toEqual(key1);
  });

  it("RESETS the idempotency key when resubmitting after a typed API error", async () => {
    const { templatesApi, ApiError } = await import(
      "../../../api/templatesClient"
    );
    // Server rejected this attempt (VALIDATION_ERROR) → typed error, new key next time.
    vi.mocked(templatesApi.create).mockRejectedValue(
      new ApiError(400, {
        code: "VALIDATION_ERROR",
        extendedCode: 4000,
        message: "html: must not be blank",
      }),
    );

    const user = await renderCreatePage();
    await fillRequiredFields(user);

    await user.click(submitButton());
    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalledTimes(1);
    });

    // Correct the form and resubmit — a NEW logical create.
    await user.click(submitButton());
    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalledTimes(2);
    });

    const key1 = idempotencyKeyOfCall(templatesApi.create, 0);
    const key2 = idempotencyKeyOfCall(templatesApi.create, 1);
    expect(key1).toEqual(expect.any(String));
    expect(key2).toEqual(expect.any(String));
    expect(key2).not.toEqual(key1);
  });

  it("RESETS the idempotency key after a successful create", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    vi.mocked(templatesApi.create).mockResolvedValue(SUCCESS_RESPONSE);

    const user = await renderCreatePage();
    await fillRequiredFields(user);
    await user.click(submitButton());

    expect(await screen.findByText(/status: DRAFT/i)).toBeInTheDocument();
    const key1 = idempotencyKeyOfCall(templatesApi.create, 0);

    // "Create another" resets the form for an unrelated create attempt.
    await user.click(screen.getByRole("button", { name: /crear otra/i }));
    await fillRequiredFields(user);
    await user.click(submitButton());

    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalledTimes(2);
    });
    const key2 = idempotencyKeyOfCall(templatesApi.create, 1);
    expect(key1).toEqual(expect.any(String));
    expect(key2).toEqual(expect.any(String));
    expect(key2).not.toEqual(key1);
  });

  // With a collector set, the template key stops being a decision and becomes a
  // confirmation of what the server is about to derive. It must show the
  // derived key, refuse edits, and NOT travel in the payload — the server
  // rejects any templateKey that does not match what it derived, so sending our
  // own copy could only ever be wrong.
  it("derives a read-only template key once a collector is typed", async () => {
    const user = await renderCreatePage();

    await user.type(screen.getByRole("textbox", { name: /^action$/i }), "PAYMENT");
    await user.type(
      screen.getByRole("textbox", { name: /^action type$/i }),
      "APPROVED",
    );
    await user.type(
      screen.getByRole("textbox", { name: /^collector$/i }),
      "BBVA",
    );

    // Action and type lowercased, the collector kept as typed — as the server does.
    const keyField = screen.getByRole("textbox", { name: /^template key$/i });
    expect(keyField).toHaveValue("payment_approved__BBVA");
    expect(keyField).toHaveAttribute("readonly");
  });

  it("sends the collector and omits the templateKey the server derives", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    vi.mocked(templatesApi.create).mockResolvedValueOnce(SUCCESS_RESPONSE);

    const user = await renderCreatePage();
    await fillRequiredFields(user);
    await user.type(
      screen.getByRole("textbox", { name: /^collector$/i }),
      "bbva",
    );
    await user.click(submitButton());

    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalledTimes(1);
    });
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload.collector).toBe("bbva");
    expect(payload).not.toHaveProperty("templateKey");
  });

  // A malformed collector is a hard 400 server-side, not a quiet fallback to
  // the generic. Catching it here saves the round trip and keeps the two
  // outcomes distinct.
  it("blocks submit on a malformed collector", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    const user = await renderCreatePage();

    await fillRequiredFields(user);
    await user.type(
      screen.getByRole("textbox", { name: /^collector$/i }),
      "bbva sa",
    );
    await user.click(submitButton());

    expect(
      await screen.findByText(/separados por un único guion bajo/i),
    ).toBeInTheDocument();
    expect(templatesApi.create).not.toHaveBeenCalled();
  });

  it("names the generic in the success panel when no collector was set", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    vi.mocked(templatesApi.create).mockResolvedValueOnce(SUCCESS_RESPONSE);

    const user = await renderCreatePage();
    await fillRequiredFields(user);
    await user.click(submitButton());

    expect(await screen.findByText(/collector: Genérica/i)).toBeInTheDocument();
  });

  it("maps a VALIDATION_ERROR detail onto the associated form field", async () => {
    const { templatesApi, ApiError } = await import(
      "../../../api/templatesClient"
    );
    vi.mocked(templatesApi.create).mockRejectedValueOnce(
      new ApiError(400, {
        code: "VALIDATION_ERROR",
        extendedCode: 4000,
        message: "html: must not be blank",
      }),
    );

    const user = await renderCreatePage();
    await fillRequiredFields(user);
    await user.click(submitButton());

    // The detail is rendered as the html field's error and the field is
    // marked invalid — i.e. it is associated with the HTML body input.
    expect(
      await screen.findByText("html: must not be blank"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /^html body$/i }),
    ).toHaveAttribute("aria-invalid", "true");
  });
});
