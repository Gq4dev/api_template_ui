import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TemplateContentResponse } from "../../../api/types";
import { EditDraftPage } from "./EditDraftPage";

afterEach(cleanup);
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
      getVersion: vi.fn(),
      updateDraft: vi.fn(),
    },
  };
});

// The preview engine is a Web Worker running Pyodide. jsdom has neither, and
// these tests are about the edit form's behaviour, not about rendering Jinja —
// that is covered where the extractor itself is tested.
vi.mock("../../../preview/client", () => ({
  fetchCatalogue: vi.fn(),
  renderDraft: vi.fn(),
  initPreviewEngine: vi.fn(),
  PreviewEngineError: class extends Error {},
  resetPreviewEngine: vi.fn(),
}));

const { templatesApi } = await import("../../../api/templatesClient");
const { fetchCatalogue } = await import("../../../preview/client");

/** An action the vendored render core has no template for. */
const UNKNOWN_ACTION_CATALOGUE = {
  action: "order.created",
  variant: "single" as const,
  template: null,
  known: false,
  problem: { kind: "TEMPLATE_NOT_FOUND" as const, message: "no template" },
  variables: [],
  context: {},
};

const DRAFT: TemplateContentResponse = {
  templateKey: "order_created",
  version: 3,
  status: "DRAFT",
  action: "ORDER",
  actionType: "CREATED",
  subject: "Your order",
  variables: ["orderId"],
  html: "<p>original {{orderId}}</p>",
  effectiveFrom: null,
  effectiveTo: null,
};

// A fresh QueryClient per render: AppProviders holds a module-scope client, and a
// shared cache would let one test's stored version answer the next test's fetch.
function renderEditPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MantineProvider defaultColorScheme="light">
        <MemoryRouter
          initialEntries={["/templates/order_created/versions/3/edit"]}
        >
          <Routes>
            <Route
              path="/templates/:templateKey/versions/:version/edit"
              element={<EditDraftPage />}
            />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return user;
}

function htmlBody(): HTMLTextAreaElement {
  return screen.getByRole("textbox", {
    name: /^html body$/i,
  }) as HTMLTextAreaElement;
}

describe("EditDraftPage", () => {
  it("prefills the form from the stored draft", async () => {
    vi.mocked(templatesApi.getVersion).mockResolvedValue(DRAFT);
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);

    renderEditPage();

    expect(await screen.findByDisplayValue(/original \{\{orderId\}\}/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Your order")).toBeInTheDocument();
  });

  it("saves in place: same version, no new version created", async () => {
    vi.mocked(templatesApi.getVersion).mockResolvedValue(DRAFT);
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);
    vi.mocked(templatesApi.updateDraft).mockResolvedValue({
      templateKey: "order_created",
      version: 3,
      status: "DRAFT",
      s3Key: "templates/order_created/v3.html",
      checksum: "sha256:new",
    });

    const user = renderEditPage();
    await screen.findByDisplayValue(/original/);

    await user.clear(htmlBody());
    await user.type(htmlBody(), "<p>fixed</p>");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(templatesApi.updateDraft).toHaveBeenCalledWith(
        "order_created",
        3,
        expect.objectContaining({ html: "<p>fixed</p>" }),
        expect.anything(),
      );
    });
    // The create endpoint is never touched — editing a draft must not mint a
    // version, which is the entire reason drafts are mutable.
    expect(templatesApi.getVersion).toHaveBeenCalledWith("order_created", 3);
  });

  /**
   * Saving invalidates the templates key space, so this query refetches. The seed
   * effect must NOT fire on that second result — otherwise whatever the author
   * has in the editor is silently replaced by the server's copy.
   *
   * The refetch deliberately returns DIFFERENT content from the first load. That
   * is what makes this test bite: React Query does structural sharing, so a
   * refetch that resolves to deep-equal data keeps the same object reference and
   * the effect would not re-run anyway. Only a changed payload produces the new
   * reference that fires it — an earlier version of this test reused one object
   * and passed with the guard removed, proving nothing.
   */
  it("does not clobber the editor when the version refetches after a save", async () => {
    vi.mocked(templatesApi.getVersion)
      .mockResolvedValueOnce(DRAFT)
      .mockResolvedValue({ ...DRAFT, html: "<p>server-changed</p>" });
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);
    vi.mocked(templatesApi.updateDraft).mockResolvedValue({
      templateKey: "order_created",
      version: 3,
      status: "DRAFT",
      s3Key: "templates/order_created/v3.html",
      checksum: "sha256:new",
    });

    const user = renderEditPage();
    await screen.findByDisplayValue(/original/);

    await user.clear(htmlBody());
    await user.type(htmlBody(), "<p>local</p>");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await screen.findByText(/draft saved/i);
    await waitFor(() => {
      expect(templatesApi.getVersion).toHaveBeenCalledTimes(2);
    });

    expect(htmlBody().value).toBe("<p>local</p>");
  });

  it("refuses to edit a version that is already published", async () => {
    vi.mocked(templatesApi.getVersion).mockResolvedValue({
      ...DRAFT,
      status: "ACTIVE",
      effectiveFrom: "2026-07-01T00:00:00Z",
    });
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);

    renderEditPage();

    expect(
      await screen.findByText(/no longer editable/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /save changes/i }),
    ).not.toBeInTheDocument();
  });
});
