import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import type { TemplateContentResponse, TemplateSummary } from "../../../api/types";
import { BrowsePage } from "./BrowsePage";
import { WITHOUT_OWN_VARIANT, WITH_OWN_VARIANT } from "./browse.logic";

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
      resolveByAction: vi.fn(),
    },
  };
});

// jsdom has no Worker/Pyodide, and nothing here renders a mail.
vi.mock("../../../preview/client", () => ({
  fetchCatalogue: vi.fn(),
  renderDraft: vi.fn(),
  initPreviewEngine: vi.fn(),
  PreviewEngineError: class extends Error {},
  resetPreviewEngine: vi.fn(),
}));

const { templatesApi } = await import("../../../api/templatesClient");

type User = ReturnType<typeof userEvent.setup>;

function row(
  templateKey: string,
  action: string,
  actionType: string,
  collector: string | null,
  version = 1,
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

const ROWS = [
  row("payment_approved", "payment", "approved", null),
  // v2, so a switch to another collector visibly lands on a different version.
  row("payment_approved__bbva", "payment", "approved", "bbva", 2),
  row("payment_pending", "payment", "pending", null),
  row("withdrawal_create__santander", "withdrawal", "create", "santander"),
];

/** `totalElements` above `rows.length` makes the catalogue read as truncated. */
function renderBrowse(rows: TemplateSummary[] = ROWS, totalElements = rows.length): User {
  vi.mocked(templatesApi.list).mockResolvedValue({
    content: rows,
    page: 0,
    size: 500,
    totalElements,
    totalPages: 1,
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      {/* env="test" turns off transitions and portals, so dropdowns open in place. */}
      <MantineProvider defaultColorScheme="light" env="test">
        <MemoryRouter>
          <BrowsePage />
        </MemoryRouter>
      </MantineProvider>
    </QueryClientProvider>,
  );
  return user;
}

// Mantine's Select input carries aria-expanded, which makes it a combobox.
function field(name: RegExp): HTMLInputElement {
  return screen.getByRole("combobox", { name }) as HTMLInputElement;
}

/**
 * Opens one Select and returns ITS listbox.
 *
 * Scoped through `aria-controls` because closed dropdowns stay in the DOM: the
 * Action and Action type lists both carry the same two headings, so an unscoped
 * query would find the closed list's copy too.
 */
async function openList(user: User, name: RegExp): Promise<HTMLElement> {
  const input = field(name);
  await user.click(input);
  let listbox: HTMLElement | null = null;
  await waitFor(() => {
    const id = input.getAttribute("aria-controls");
    listbox = id ? document.getElementById(id) : null;
    expect(listbox).not.toBeNull();
  });
  return listbox as unknown as HTMLElement;
}

async function pick(user: User, name: RegExp, option: string | RegExp) {
  const listbox = await openList(user, name);
  await user.click(within(listbox).getByRole("option", { name: option }));
}

/** The option texts rendered under one heading of an open listbox. */
function optionsUnder(listbox: HTMLElement, heading: string): string[] {
  const group = within(listbox).getByText(heading).parentElement as HTMLElement;
  return within(group)
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

async function waitForCatalogue() {
  await waitFor(() => expect(field(/^action$/i)).not.toBeDisabled());
}

async function switchToCollectorFirst(user: User) {
  await waitForCatalogue();
  await user.click(screen.getByRole("radio", { name: "Por collector" }));
}

describe("BrowsePage — collector-first order", () => {
  it("defaults to the template-first order", async () => {
    renderBrowse();
    await waitForCatalogue();
    expect(screen.getByRole("radio", { name: "Por plantilla" })).toBeChecked();
    expect(screen.queryByText(/solo se listan los collectors/i)).not.toBeInTheDocument();
  });

  it("asks for the collector first, from the catalogue, and says what that list omits", async () => {
    const user = renderBrowse();
    await switchToCollectorFirst(user);

    expect(screen.getByText(/solo se listan los collectors/i)).toBeInTheDocument();
    expect(field(/^action$/i)).toBeDisabled();

    const listbox = await openList(user, /^collector$/i);
    expect(
      within(listbox).getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Genérica", "bbva", "santander"]);
  });

  it("lists every action and type under the collector, marked by stored variant", async () => {
    const user = renderBrowse();
    await switchToCollectorFirst(user);
    await pick(user, /^collector$/i, "bbva");

    const actions = await openList(user, /^action$/i);
    expect(optionsUnder(actions, WITH_OWN_VARIANT)).toEqual(["payment"]);
    expect(optionsUnder(actions, WITHOUT_OWN_VARIANT)).toEqual(["withdrawal"]);
    await user.click(within(actions).getByRole("option", { name: "payment" }));

    const types = await openList(user, /^action type$/i);
    expect(optionsUnder(types, WITH_OWN_VARIANT)).toEqual(["approved"]);
    expect(optionsUnder(types, WITHOUT_OWN_VARIANT)).toEqual(["pending"]);
  });

  it("hands the downstream actions the same triple the template-first order would", async () => {
    const user = renderBrowse();
    await switchToCollectorFirst(user);
    await pick(user, /^collector$/i, "bbva");
    await pick(user, /^action$/i, "payment");
    await pick(user, /^action type$/i, "approved");

    // The stored key behind (payment, approved, bbva), its default version, and
    // the create-from link carrying exactly that identity.
    expect(await screen.findByText("payment_approved__bbva")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /crear a partir de esta versión/i });
    const params = new URLSearchParams(link.getAttribute("href")!.split("?")[1]);
    expect(Object.fromEntries(params)).toMatchObject({
      action: "payment",
      actionType: "approved",
      collector: "bbva",
      fromKey: "payment_approved__bbva",
      fromVersion: "2",
    });
  });

  it("treats a triple with no variant like today: catalogue says so, send path stays usable", async () => {
    const user = renderBrowse();
    await switchToCollectorFirst(user);
    await pick(user, /^collector$/i, "bbva");
    await pick(user, /^action$/i, "payment");
    await pick(user, /^action type$/i, "pending");

    expect(
      await screen.findByText(/no hay ninguna plantilla guardada para “bbva”/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /qué se envía ahora/i })).toBeEnabled();
  });

  it("keeps a complete triple across a switch in both directions", async () => {
    const user = renderBrowse();
    await switchToCollectorFirst(user);
    await pick(user, /^collector$/i, "bbva");
    await pick(user, /^action$/i, "payment");
    await pick(user, /^action type$/i, "approved");
    await screen.findByText("payment_approved__bbva");

    await user.click(screen.getByRole("radio", { name: "Por plantilla" }));
    expect(screen.getByText("payment_approved__bbva")).toBeInTheDocument();
    expect(field(/^collector$/i)).toHaveValue("bbva");

    await user.click(screen.getByRole("radio", { name: "Por collector" }));
    expect(screen.getByText("payment_approved__bbva")).toBeInTheDocument();
    expect(field(/^collector$/i)).toHaveValue("bbva");
  });

  it("clears an unanswered pair on the way into collector-first", async () => {
    const user = renderBrowse();
    await waitForCatalogue();
    await pick(user, /^action$/i, "payment (3)");

    await user.click(screen.getByRole("radio", { name: "Por collector" }));
    expect(field(/^collector$/i)).toHaveValue("");
    expect(field(/^action$/i)).toHaveValue("");
    expect(field(/^action$/i)).toBeDisabled();
  });

  // Changing the collector keeps the pair (every action is offered under every
  // collector) but never the version, which belonged to the previous key.
  it("clears the version on a collector change, landing on the new collector's template or none", async () => {
    const user = renderBrowse();
    await switchToCollectorFirst(user);
    await pick(user, /^collector$/i, "bbva");
    await pick(user, /^action$/i, "payment");
    await pick(user, /^action type$/i, "approved");
    expect(await screen.findByText("payment_approved__bbva")).toBeInTheDocument();
    expect(field(/^version$/i)).toHaveValue("v2 · ACTIVE");

    // santander has nothing under payment/approved.
    await pick(user, /^collector$/i, "santander");
    expect(
      await screen.findByText(/no hay ninguna plantilla guardada para “santander”/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("payment_approved__bbva")).not.toBeInTheDocument();
    expect(field(/^version$/i)).toHaveValue("");

    // The generic does: its own key, at its own default version.
    await pick(user, /^collector$/i, "Genérica");
    expect(await screen.findByText("payment_approved")).toBeInTheDocument();
    expect(field(/^version$/i)).toHaveValue("v1 · ACTIVE");
  });
});

describe("BrowsePage — a pair written more than one way", () => {
  // The live shape: generic and bbva as PAYMENT/APPROVED, dell as payment/approved.
  const DRIFTED = [
    row("payment_approved", "PAYMENT", "APPROVED", null),
    row("payment_approved__bbva", "PAYMENT", "APPROVED", "bbva"),
    row("payment_approved__dell", "payment", "approved", "dell"),
  ];

  function content(overrides: Partial<TemplateContentResponse>): TemplateContentResponse {
    return {
      templateKey: "payment_approved",
      version: 1,
      status: "ACTIVE",
      action: "PAYMENT",
      actionType: "APPROVED",
      collector: null,
      subject: null,
      variables: [],
      html: "<p>x</p>",
      effectiveFrom: null,
      effectiveTo: null,
      fallbackToGeneric: false,
      ...overrides,
    };
  }

  async function waitForCollectorList() {
    await waitFor(() => expect(field(/^collector$/i)).not.toBeDisabled());
  }

  it("offers one marked action and asks the send path once per stored spelling", async () => {
    // What the live API does: PAYMENT for dell falls back, payment finds dell.
    vi.mocked(templatesApi.resolveByAction).mockImplementation(async (action: string) =>
      action === "PAYMENT"
        ? content({ collector: null, fallbackToGeneric: true })
        : content({
            templateKey: "payment_approved__dell",
            action: "payment",
            actionType: "approved",
            collector: "dell",
          }),
    );
    const user = renderBrowse(DRIFTED);
    await waitForCatalogue();

    const actions = await openList(user, /^action$/i);
    expect(within(actions).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "payment (3) · 2 formas de escritura",
    ]);
    await user.click(within(actions).getAllByRole("option")[0]);
    // The sole action type is picked for the reader, as always.
    await waitFor(() =>
      expect(field(/^action type$/i)).toHaveValue("approved (3) · 2 formas de escritura"),
    );
    await waitForCollectorList();
    // Inventory options carry their version, status and delivery badge.
    await pick(user, /^collector$/i, /^dell/);

    // The catalogue panel finds dell's variant despite its spelling.
    expect(await screen.findByText("payment_approved__dell")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /qué se envía ahora/i }));

    expect(
      await screen.findByText(/está escrita de más de una forma en el catálogo/i),
    ).toBeInTheDocument();
    expect(templatesApi.resolveByAction).toHaveBeenCalledTimes(2);
    expect(templatesApi.resolveByAction).toHaveBeenCalledWith("PAYMENT", "APPROVED", {
      collector: "dell",
    });
    expect(templatesApi.resolveByAction).toHaveBeenCalledWith("payment", "approved", {
      collector: "dell",
    });
    expect(screen.getAllByText(/pedida como/i)).toHaveLength(2);
    expect(
      screen.getByText(/no hay plantilla vigente para “dell” — se muestra la genérica/i),
    ).toBeInTheDocument();
    expect(screen.getByText("dell tiene su propia versión")).toBeInTheDocument();
  });

  // The browser finding: asked only as PAYMENT, the inventory left dell out.
  it("merges the collector inventory across stored spellings", async () => {
    const user = renderBrowse([
      ...DRIFTED,
      // bbva is also stored in the other spelling, as a draft: whether bbva gets
      // its own mail depends on how the sender spells the action.
      { ...row("payment_approved__bbva", "payment", "approved", "bbva", 2), status: "DRAFT" },
    ]);
    await waitForCatalogue();
    await pick(user, /^action$/i, "payment (3) · 2 formas de escritura");
    await waitForCollectorList();

    // Derived from the catalogue: no request beyond the list itself.
    expect(templatesApi.list).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/2 collectors con variante propia, reunidos de 2 formas de escritura/),
    ).toBeInTheDocument();

    const listbox = await openList(user, /^collector$/i);
    const texts = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");
    const dell = texts.find((text) => text.startsWith("dell"));
    const bbva = texts.find((text) => text.startsWith("bbva"));
    expect(dell).toContain("v1");
    expect(dell).not.toContain("según escritura");
    expect(bbva).toContain("según escritura");
  });

  it("makes exactly one call, with no warning, for a pair written one way", async () => {
    vi.mocked(templatesApi.resolveByAction).mockResolvedValue(
      content({
        templateKey: "payment_approved__bbva",
        action: "payment",
        actionType: "approved",
        collector: "bbva",
      }),
    );
    const user = renderBrowse();
    await waitForCatalogue();
    await pick(user, /^action$/i, "payment (3)");
    await pick(user, /^action type$/i, "approved (2)");
    await waitForCollectorList();
    await pick(user, /^collector$/i, /^bbva/);

    await user.click(screen.getByRole("button", { name: /qué se envía ahora/i }));

    expect(await screen.findByText("bbva tiene su propia versión")).toBeInTheDocument();
    expect(templatesApi.resolveByAction).toHaveBeenCalledTimes(1);
    expect(templatesApi.resolveByAction).toHaveBeenCalledWith("payment", "approved", {
      collector: "bbva",
    });
    expect(screen.queryByText(/más de una forma/i)).not.toBeInTheDocument();
  });
});

describe("BrowsePage — a truncated catalogue", () => {
  async function waitForCollectorList() {
    await waitFor(() => expect(field(/^collector$/i)).not.toBeDisabled());
  }

  // santander's variant was read; whether a generic exists is in the rows that were not.
  const NO_GENERIC_READ = [row("withdrawal_create__santander", "withdrawal", "create", "santander")];

  it("warns in the Collector step and never claims the generic is missing", async () => {
    const user = renderBrowse(NO_GENERIC_READ, 5);
    await waitForCatalogue();
    await pick(user, /^action$/i, "withdrawal (1)");
    await waitForCollectorList();

    expect(await screen.findByText("Inventario incompleto")).toBeInTheDocument();
    expect(screen.queryByText(/no existe plantilla genérica/i)).not.toBeInTheDocument();

    const listbox = await openList(user, /^collector$/i);
    const texts = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");
    expect(texts.find((text) => text.startsWith("Genérica"))).toContain("No encontrada");
    expect(texts.find((text) => text.startsWith("santander"))).toContain("Se envía la suya");
  });

  it("does claim it when the catalogue was read in full", async () => {
    const user = renderBrowse(NO_GENERIC_READ);
    await waitForCatalogue();
    await pick(user, /^action$/i, "withdrawal (1)");
    await waitForCollectorList();

    expect(await screen.findByText(/no existe plantilla genérica/i)).toBeInTheDocument();
    expect(screen.queryByText("Inventario incompleto")).not.toBeInTheDocument();
  });
});
