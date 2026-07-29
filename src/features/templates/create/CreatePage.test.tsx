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
    },
  };
});

async function renderCreatePage() {
  const user = userEvent.setup();
  render(
    <AppProviders>
      <CreatePage />
    </AppProviders>,
  );
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
  return screen.getByRole("button", { name: /save draft/i });
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

    await user.click(screen.getByRole("button", { name: /save draft/i }));

    expect(
      await screen.findByText("Action is required."),
    ).toBeInTheDocument();
    expect(screen.getByText("Action type is required.")).toBeInTheDocument();
    expect(screen.getByText("HTML body is required.")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /save draft/i }));

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

    await user.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/server is unreachable/i),
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
      expect(screen.getByText(/server is unreachable/i)).toBeInTheDocument();
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
        error: "VALIDATION_ERROR",
        details: ["html: must not be blank"],
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
    await user.click(screen.getByRole("button", { name: /create another/i }));
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

  it("maps a VALIDATION_ERROR detail onto the associated form field", async () => {
    const { templatesApi, ApiError } = await import(
      "../../../api/templatesClient"
    );
    vi.mocked(templatesApi.create).mockRejectedValueOnce(
      new ApiError(400, {
        error: "VALIDATION_ERROR",
        details: ["html: must not be blank"],
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
