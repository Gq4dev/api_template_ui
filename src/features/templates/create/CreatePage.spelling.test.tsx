import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TemplateSummary } from "../../../api/types";
import { CreatePage } from "./CreatePage";

// The spelling sent on create, against a catalogue shaped like the live one:
// the generic and the bbva variant stored as PAYMENT/APPROVED.

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
      list: vi.fn(),
      create: vi.fn(),
    },
  };
});

// jsdom has no Worker/Pyodide; these tests are about the payload.
vi.mock("../../../preview/client", () => ({
  fetchCatalogue: vi.fn(),
  renderDraft: vi.fn(),
  initPreviewEngine: vi.fn(),
  PreviewEngineError: class extends Error {},
  resetPreviewEngine: vi.fn(),
}));

const { templatesApi } = await import("../../../api/templatesClient");
const { fetchCatalogue } = await import("../../../preview/client");

function row(
  templateKey: string,
  version: number,
  collector: string | null,
  action = "PAYMENT",
  actionType = "APPROVED",
): TemplateSummary {
  return {
    templateKey,
    version,
    status: "ACTIVE",
    action,
    actionType,
    collector,
    subject: null,
    effectiveFrom: null,
    effectiveTo: null,
    createdBy: "seed",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const CATALOGUE = [row("payment_approved", 3, null), row("payment_approved__bbva", 1, "bbva")];

function renderCreate(catalogue: TemplateSummary[] | "loading" | "error" = CATALOGUE) {
  if (catalogue === "loading") {
    // Never settles: the catalogue stays on its first load.
    vi.mocked(templatesApi.list).mockReturnValue(new Promise(() => {}));
  } else if (catalogue === "error") {
    vi.mocked(templatesApi.list).mockRejectedValue(new TypeError("Failed to fetch"));
  } else {
    vi.mocked(templatesApi.list).mockResolvedValue({
      content: catalogue,
      page: 0,
      size: 500,
      totalElements: catalogue.length,
      totalPages: 1,
    });
  }
  vi.mocked(fetchCatalogue).mockResolvedValue({
    action: "payment.approved",
    variant: "single",
    template: null,
    known: false,
    problem: { kind: "TEMPLATE_NOT_FOUND", message: "no template" },
    variables: [],
    context: {},
  });
  vi.mocked(templatesApi.create).mockResolvedValue({
    templateKey: "payment_approved",
    version: 4,
    status: "DRAFT",
    s3Key: "templates/payment_approved/v4.html",
    checksum: "sha256:new",
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MantineProvider defaultColorScheme="light">
        <MemoryRouter initialEntries={["/create"]}>
          <Routes>
            <Route path="/create" element={<CreatePage />} />
          </Routes>
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return user;
}

function textbox(name: RegExp): HTMLElement {
  return screen.getByRole("textbox", { name });
}

async function typeIdentity(
  user: ReturnType<typeof userEvent.setup>,
  collector: string,
  action = "payment",
  actionType = "approved",
) {
  await waitFor(() => expect(templatesApi.list).toHaveBeenCalled());
  await user.type(textbox(/^action$/i), action);
  await user.type(textbox(/^action type$/i), actionType);
  if (collector) await user.type(textbox(/^collector$/i), collector);
  await user.type(textbox(/^html body$/i), "<p>hola</p>");
}

describe("CreatePage — spelling sent", () => {
  // Rule 1: the key exists, and it only accepts the spelling it reserved.
  it("sends a new version of a PAYMENT key as PAYMENT, even typed as payment", async () => {
    const user = renderCreate();
    await typeIdentity(user, "");

    expect(
      await screen.findByText("Se enviará como PAYMENT para coincidir con la plantilla existente."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Se enviará como APPROVED para coincidir con la plantilla existente."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => expect(templatesApi.create).toHaveBeenCalledTimes(1));
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toMatchObject({ action: "PAYMENT", actionType: "APPROVED" });
    expect(payload).not.toHaveProperty("collector");
  });

  // Rule 2: a new variant takes the generic's spelling, so a sender resolving
  // PAYMENT/APPROVED for that collector finds it.
  it("sends a new variant under a PAYMENT generic in the generic's spelling", async () => {
    const user = renderCreate();
    await typeIdentity(user, "newco");

    expect(
      await screen.findByText("Se enviará como PAYMENT para coincidir con la plantilla genérica."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => expect(templatesApi.create).toHaveBeenCalledTimes(1));
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toMatchObject({
      action: "PAYMENT",
      actionType: "APPROVED",
      collector: "newco",
    });
  });

  // Rule 3: no generic, so the variants' most common spelling.
  it("sends a variant with no generic in its siblings' spelling", async () => {
    const user = renderCreate([
      row("order_created__a", 1, "a", "Order", "Created"),
      row("order_created__b", 1, "b", "Order", "Created"),
    ]);
    await typeIdentity(user, "z", "order", "created");

    expect(
      await screen.findByText("Se enviará como Order para coincidir con las variantes existentes."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => expect(templatesApi.create).toHaveBeenCalledTimes(1));
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toMatchObject({ action: "Order", actionType: "Created", collector: "z" });
  });

  // Rule 4: nothing stored for the pair.
  it("sends a brand-new pair in its canonical form", async () => {
    const user = renderCreate();
    await typeIdentity(user, "", "Refund Done", "OK");

    expect(
      await screen.findByText("Se enviará como refund_done en su forma canónica."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /guardar borrador/i }));
    await waitFor(() => expect(templatesApi.create).toHaveBeenCalledTimes(1));
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toMatchObject({ action: "refund_done", actionType: "ok" });
  });

  // A click that beat the catalogue would skip every rule above.
  it("blocks the submit while the catalogue is still loading", async () => {
    const user = renderCreate("loading");
    await typeIdentity(user, "");

    const submit = screen.getByRole("button", { name: /guardar borrador/i });
    expect(submit).toBeDisabled();
    expect(screen.getByText("Comprobando el catálogo…")).toBeInTheDocument();

    await user.click(submit);
    expect(templatesApi.create).not.toHaveBeenCalled();
  });

  // The backend guard stays the last line of defence, so saving is allowed —
  // but never silently unchecked.
  it("warns and sends the typed spelling when the catalogue cannot be read", async () => {
    const user = renderCreate("error");
    expect(
      await screen.findByText(
        "No se pudo leer el catálogo: se enviará Action/Action type tal como los escribiste, sin comprobar cómo están guardados.",
      ),
    ).toBeInTheDocument();
    await typeIdentity(user, "");

    const submit = screen.getByRole("button", { name: /guardar borrador/i });
    expect(submit).toBeEnabled();
    await user.click(submit);
    await waitFor(() => expect(templatesApi.create).toHaveBeenCalledTimes(1));
    const [payload] = vi.mocked(templatesApi.create).mock.calls[0];
    expect(payload).toMatchObject({ action: "payment", actionType: "approved" });
  });
});
