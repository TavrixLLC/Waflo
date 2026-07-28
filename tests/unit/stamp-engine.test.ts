import { describe, expect, it } from "vitest";
import { layoutStampPositions, renderStampSvg } from "@waflo/stamp-engine";

describe("W2 stamp visual engine", () => {
  it("renders deterministic progress with the expected fill count", () => {
    const input = {
      goal: 8,
      progress: 5,
      layout: "GRID" as const,
      filledColor: "#6B3F2A",
      emptyColor: "#E7B56B",
      accentColor: "#222222",
    };
    const first = renderStampSvg(input);
    const second = renderStampSvg(input);
    expect(first.digest).toBe(second.digest);
    expect(first.positions.filter((position) => position.filled)).toHaveLength(5);
    expect(first.svg).toContain('data-filled="true"');
    expect(first.width).toBeGreaterThan(0);
    expect(first.height).toBeGreaterThan(0);
  });

  it.each(["ROW", "GRID", "PATH", "RING"] as const)("supports %s layout", (layout) => {
    const positions = layoutStampPositions(8, layout);
    expect(positions).toHaveLength(8);
    expect(new Set(positions.map((position) => `${position.x}:${position.y}`)).size).toBe(8);
  });

  it("rejects unsafe or unsupported goals and escapes labels", () => {
    expect(() =>
      renderStampSvg({
        goal: 1,
        progress: 0,
        layout: "ROW",
        filledColor: "#000000",
        emptyColor: "#ffffff",
        accentColor: "#000000",
      }),
    ).toThrow();
    const rendered = renderStampSvg({
      goal: 2,
      progress: 2,
      layout: "ROW",
      filledColor: "#000000",
      emptyColor: "#ffffff",
      accentColor: "#000000",
      label: "<script>alert(1)</script>",
    });
    expect(rendered.svg).not.toContain("<script>");
    expect(rendered.svg).toContain("&lt;script&gt;");
  });

  it("renders separate safe filled and empty artwork", () => {
    const filled = {
      kind: "svg" as const,
      trusted: true as const,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg"><path id="filled-cookie" d="M1 1h98v98H1z"/></svg>',
    };
    const empty = {
      kind: "svg" as const,
      trusted: true as const,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg"><path id="empty-cookie" d="M1 1h98v98H1z"/></svg>',
    };
    const rendered = renderStampSvg({
      goal: 2,
      progress: 1,
      layout: "ROW",
      filledColor: "#000000",
      emptyColor: "#ffffff",
      accentColor: "#000000",
      filledArtwork: filled,
      emptyArtwork: empty,
    });
    expect(rendered.svg).toContain(Buffer.from(filled.content, "utf8").toString("base64"));
    expect(rendered.svg).toContain(Buffer.from(empty.content, "utf8").toString("base64"));
    expect(() =>
      renderStampSvg({
        goal: 2,
        progress: 1,
        layout: "ROW",
        filledColor: "#000000",
        emptyColor: "#ffffff",
        accentColor: "#000000",
        filledArtwork: { kind: "svg", trusted: true, content: "<script>alert(1)</script>" },
      }),
    ).toThrow("Unsafe artwork");
  });
});
