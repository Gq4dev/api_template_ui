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

describe("CreatePage", () => {
  it("shows required-field errors and does not call the API when submitted empty", async () => {
    const { templatesApi } = await import("../../../api/templatesClient");
    const user = await renderCreatePage();

    await user.click(screen.getByRole("button", { name: /create template/i }));

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

    await user.click(screen.getByRole("button", { name: /create template/i }));

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

    await user.click(screen.getByRole("button", { name: /create template/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/server is unreachable/i),
      ).toBeInTheDocument();
    });
  });
});
