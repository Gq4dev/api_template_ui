import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter } from "react-router-dom";
import type { TemplateSummary } from "../../../api/types";
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
      collectorsInventory: vi.fn(),
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
): TemplateSummary {
  return {
    templateKey,
    version: 1,
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
  row("payment_approved__bbva", "payment", "approved", "bbva"),
  row("payment_pending", "payment", "pending", null),
  row("withdrawal_create__santander", "withdrawal", "create", "santander"),
];

function renderBrowse(): User {
  vi.mocked(templatesApi.list).mockResolvedValue({
    content: ROWS,
    page: 0,
    size: 500,
    totalElements: ROWS.length,
    totalPages: 1,
  });
  // The inventory endpoint is not deployed; the page falls back to the catalogue.
  vi.mocked(templatesApi.collectorsInventory).mockRejectedValue(
    new TypeError("Failed to fetch"),
  );

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

async function pick(user: User, name: RegExp, option: string) {
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
      fromVersion: "1",
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
});
