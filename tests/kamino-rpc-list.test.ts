import { describe, expect, it } from "vitest";
import { buildRpcUrlList } from "../src/kamino-utils.js";

describe("buildRpcUrlList", () => {
  it("deduplicates and preserves order", () => {
    const list = buildRpcUrlList(
      "https://primary",
      " https://primary ,https://a, https://b , https://a  "
    );
    expect(list).toEqual(["https://primary", "https://a", "https://b"]);
  });

  it("returns primary when extras are empty", () => {
    const list = buildRpcUrlList("https://primary", " , , ");
    expect(list).toEqual(["https://primary"]);
  });
});
