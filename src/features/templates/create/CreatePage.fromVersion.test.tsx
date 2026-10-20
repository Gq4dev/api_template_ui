import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { TemplateContentResponse } from "../../../api/types";
import { templateKeys } from "../../../queries/queryKeys";
import { CreatePage } from "./CreatePage";
import { fromVersionHref } from "./createForm.logic";

// "Create from this version": kept apart from CreatePage.test.tsx because these
// tests need the preview engine mocked and a router carrying a query string.

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
      create: vi.fn(),
      list: vi.fn(),
    },
  };
});

// jsdom has no Worker/Pyodide; these tests are about seeding and submitting.
vi.mock("../../../preview/client", () => ({
  fetchCatalogue: vi.fn(),
  renderDraft: vi.fn(),
  initPreviewEngine: vi.fn(),
  PreviewEngineError: class extends Error {},
  resetPreviewEngine: vi.fn(),
}));

const { templatesApi } = await import("../../../api/templatesClient");
const { fetchCatalogue } = await import("../../../preview/client");

const UNKNOWN_ACTION_CATALOGUE = {
  action: "order.created",
  variant: "single" as const,
  template: null,
  known: false,
  problem: { kind: "TEMPLATE_NOT_FOUND" as const, message: "no template" },
  variables: [],
  context: {},
};

const SOURCE: TemplateContentResponse = {
  templateKey: "order_created",
  version: 3,
  status: "ACTIVE",
  action: "ORDER",
  actionType: "CREATED",
  collector: null,
  subject: "Your order",
  variables: ["orderId"],
  html: "<p>original</p>",
  effectiveFrom: "2026-07-01T00:00:00Z",
  effectiveTo: null,
  fallbackToGeneric: false,
};

// Exposes the router's current query string so tests can assert on the URL.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

function renderFromSource(source: TemplateContentResponse = SOURCE) {
  // The stored catalogue decides the spelling sent (see `spellingFor`). Here it
  // holds the source itself, as it would live.
  vi.mocked(templatesApi.list).mockResolvedValue({
    content: [
      {
        templateKey: source.templateKey,
        version: source.version,
        status: source.status,
        action: source.action ?? "",
        actionType: source.actionType ?? "",
        collector: source.collector ?? null,
        subject: source.subject,
        effectiveFrom: source.effectiveFrom,
        effectiveTo: source.effectiveTo,
        createdBy: "seed",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ],
    page: 0,
    size: 500,
    totalElements: 1,
    totalPages: 1,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MantineProvider defaultColorScheme="light">
        <MemoryRouter initialEntries={[fromVersionHref({ ...source, collector: source.collector ?? null })]}>
          <Routes>
            <Route
              path="/create"
              element={
                <>
                  <CreatePage />
                  <LocationProbe />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return { user, client };
}

function textbox(name: RegExp): HTMLInputElement {
  return screen.getByRole("textbox", { name }) as HTMLInputElement;
}

describe("CreatePage — create from an existing version", () => {
  it("prefills content and identity from the source version", async () => {
    vi.mocked(templatesApi.getVersion).mockResolvedValue(SOURCE);
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);

    renderFromSource();

    expect(await screen.findByText("Basado en order_created v3")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("<p>original</p>")).toBeInTheDocument();
    expect(templatesApi.getVersion).toHaveBeenCalledWith("order_created", 3);
    expect(textbox(/^action$/i)).toHaveValue("ORDER");
    expect(textbox(/^action type$/i)).toHaveValue("CREATED");
    expect(textbox(/^collector$/i)).toHaveValue("");
    expect(textbox(/^template key$/i)).toHaveValue("order_created");
    expect(textbox(/^subject$/i)).toHaveValue("Your order");
  });

  // The refetch returns DIFFERENT content on purpose: an equal payload keeps the
  // same object reference through structural sharing and would never re-run the
  // seed effect, so the test would pass with the guard removed.
  it("does not clobber edits when the source version refetches", async () => {
    vi.mocked(templatesApi.getVersion)
      .mockResolvedValueOnce(SOURCE)
      .mockResolvedValue({ ...SOURCE, html: "<p>server-changed</p>" });
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);

    const { user, client } = renderFromSource();
    await screen.findByDisplayValue("<p>original</p>");

    await user.clear(textbox(/^html body$/i));
    await user.type(textbox(/^html body$/i), "<p>local</p>");

    await client.invalidateQueries({
      queryKey: templateKeys.version("order_created", 3),
    });
    await waitFor(() => {
      expect(templatesApi.getVersion).toHaveBeenCalledTimes(2);
    });

    expect(textbox(/^html body$/i)).toHaveValue("<p>local</p>");
  });

  it("submits the edited values as a new version of the same template", async () => {
    vi.mocked(templatesApi.getVersion).mockResolvedValue(SOURCE);
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);
    vi.mocked(templatesApi.create).mockResolvedValue({
      templateKey: "order_created",
      version: 4,
      status: "DRAFT",
      s3Key: "templates/order_created/v4.html",
      checksum: "sha256:new",
    });

    const { user } = renderFromSource();
    await screen.findByDisplayValue("<p>original</p>");

    await user.clear(textbox(/^html body$/i));
    await user.type(textbox(/^html body$/i), "<p>edited</p>");
    await user.clear(textbox(/^subject$/i));
    await user.type(textbox(/^subject$/i), "Nuevo asunto");
    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));

    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalledTimes(1);
    });
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toEqual({
      action: "ORDER",
      actionType: "CREATED",
      templateKey: "order_created",
      html: "<p>edited</p>",
      subject: "Nuevo asunto",
    });
  });

  it("creates a new variant, without the copied key, when the collector changes", async () => {
    vi.mocked(templatesApi.getVersion).mockResolvedValue(SOURCE);
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);
    vi.mocked(templatesApi.create).mockResolvedValue({
      templateKey: "order_created__bbva",
      version: 1,
      status: "DRAFT",
      s3Key: "templates/order_created__bbva/v1.html",
      checksum: "sha256:new",
    });

    const { user } = renderFromSource();
    await screen.findByDisplayValue("<p>original</p>");

    await user.type(textbox(/^collector$/i), "bbva");
    expect(
      screen.getByText(/plantilla nueva, no una versión de order_created/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));

    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalledTimes(1);
    });
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toMatchObject({
      action: "ORDER",
      actionType: "CREATED",
      collector: "bbva",
      html: "<p>original</p>",
      subject: "Your order",
    });
    expect(payload).not.toHaveProperty("templateKey");
  });

  it("turns a variant source into a generic when the collector is blanked", async () => {
    const VARIANT: TemplateContentResponse = {
      ...SOURCE,
      templateKey: "order_created__bbva",
      collector: "bbva",
    };
    vi.mocked(templatesApi.getVersion).mockResolvedValue(VARIANT);
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);
    vi.mocked(templatesApi.create).mockResolvedValue({
      templateKey: "order_created",
      version: 5,
      status: "DRAFT",
      s3Key: "templates/order_created/v5.html",
      checksum: "sha256:new",
    });

    const { user } = renderFromSource(VARIANT);
    await screen.findByDisplayValue("<p>original</p>");
    expect(textbox(/^collector$/i)).toHaveValue("bbva");

    await user.clear(textbox(/^collector$/i));
    // The copied `__bbva` key is gone; the server derives the generic's key.
    expect(textbox(/^template key$/i)).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => {
      expect(templatesApi.create).toHaveBeenCalledTimes(1);
    });
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toEqual({
      action: "ORDER",
      actionType: "CREATED",
      html: "<p>original</p>",
      subject: "Your order",
    });
  });

  it("clears the source from the URL on Crear otra", async () => {
    vi.mocked(templatesApi.getVersion).mockResolvedValue(SOURCE);
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);
    vi.mocked(templatesApi.create).mockResolvedValue({
      templateKey: "order_created",
      version: 4,
      status: "DRAFT",
      s3Key: "templates/order_created/v4.html",
      checksum: "sha256:new",
    });

    const { user } = renderFromSource();
    await screen.findByDisplayValue("<p>original</p>");
    expect(screen.getByTestId("location-search").textContent).toContain("fromKey=");

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await user.click(await screen.findByRole("button", { name: /crear otra/i }));

    expect(screen.getByTestId("location-search").textContent).toBe("");
    expect(screen.queryByText(/basado en/i)).not.toBeInTheDocument();
    expect(textbox(/^action$/i)).toHaveValue("");
    expect(textbox(/^html body$/i)).toHaveValue("");
  });

  it.each([
    ["DRAFT" as const, true],
    ["ARCHIVED" as const, false],
  ])("does not copy from a %s source", async (status, offersEdit) => {
    vi.mocked(templatesApi.getVersion).mockResolvedValue({ ...SOURCE, status });
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);

    renderFromSource();

    expect(
      await screen.findByText(/order_created v3 no es una versión publicada/i),
    ).toBeInTheDocument();
    // Identity from the link only; no content copied.
    expect(textbox(/^action$/i)).toHaveValue("ORDER");
    expect(textbox(/^html body$/i)).toHaveValue("");
    expect(textbox(/^subject$/i)).toHaveValue("");

    const editLink = screen.queryByRole("link", { name: /editar borrador/i });
    if (offersEdit) {
      expect(editLink).toHaveAttribute("href", "/templates/order_created/versions/3/edit");
    } else {
      expect(editLink).toBeNull();
    }
  });

  it("keeps the form usable from scratch when the source cannot be loaded", async () => {
    vi.mocked(templatesApi.getVersion).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    vi.mocked(fetchCatalogue).mockResolvedValue(UNKNOWN_ACTION_CATALOGUE);

    renderFromSource();

    expect(
      await screen.findByText(/no se pudo cargar la versión de origen/i),
    ).toBeInTheDocument();
    // Identity still comes from the link; the body is blank and editable.
    expect(textbox(/^action$/i)).toHaveValue("ORDER");
    expect(textbox(/^html body$/i)).toHaveValue("");
    expect(textbox(/^html body$/i)).not.toBeDisabled();
  });
});
