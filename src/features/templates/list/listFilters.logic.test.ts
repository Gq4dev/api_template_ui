import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIST_SORT,
  EMPTY_LIST_FILTER_STATE,
  buildListParams,
} from "./listFilters.logic";

describe("buildListParams", () => {
  it("always sends page, size and the default sort", () => {
    const params = buildListParams(EMPTY_LIST_FILTER_STATE);
    expect(params).toEqual({
      page: 0,
      size: 20,
      sort: DEFAULT_LIST_SORT,
    });
  });

  it("drops empty and whitespace-only text filters", () => {
    const params = buildListParams({
      ...EMPTY_LIST_FILTER_STATE,
      status: "",
      templateKey: "   ",
      action: "",
    });
    expect(params).not.toHaveProperty("status");
    expect(params).not.toHaveProperty("templateKey");
    expect(params).not.toHaveProperty("action");
  });

  it("includes trimmed filters when present", () => {
    const params = buildListParams({
      status: "ACTIVE",
      templateKey: " order-created ",
      action: " ORDER ",
      page: 2,
      size: 50,
    });
    expect(params).toEqual({
      status: "ACTIVE",
      templateKey: "order-created",
      action: "ORDER",
      page: 2,
      size: 50,
      sort: DEFAULT_LIST_SORT,
    });
  });

  it("coerces page and size to numbers", () => {
    const params = buildListParams({
      ...EMPTY_LIST_FILTER_STATE,
      // Simulate values arriving as strings from a control.
      page: "3" as unknown as number,
      size: "10" as unknown as number,
    });
    expect(params.page).toBe(3);
    expect(params.size).toBe(10);
    expect(typeof params.page).toBe("number");
    expect(typeof params.size).toBe("number");
  });
});
