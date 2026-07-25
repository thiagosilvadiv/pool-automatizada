import { describe, expect, it, vi } from "vitest";

vi.mock("@orca-so/whirlpools-sdk", () => ({}));
vi.mock("@orca-so/common-sdk", () => ({}));

import { resolveKaminoReopenOpenOptions } from "../src/orca.js";

describe("Kamino reopen wallet policy", () => {
  it("removes borrowed-only caps when the free wallet balance should be included", () => {
    expect(resolveKaminoReopenOpenOptions({
      useWalletBalance: true,
      reservedTokenA: 0.25,
      reservedTokenB: 4
    })).toBeUndefined();
  });

  it("keeps the legacy borrowed-only caps when explicitly disabled", () => {
    expect(resolveKaminoReopenOpenOptions({
      useWalletBalance: false,
      reservedTokenA: 0.25,
      reservedTokenB: 4
    })).toEqual({ maxTokenA: 0.25, maxTokenB: 4 });
  });
});
