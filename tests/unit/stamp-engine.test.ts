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
    expect(rendered.svg).not.toContain("alert(1)");
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

  it("keeps stamps free of implicit checkmarks and numbers", () => {
    const rendered = renderStampSvg({
      goal: 6,
      progress: 3,
      layout: "GRID",
      filledColor: "#6B3F2A",
      emptyColor: "#E7B56B",
      accentColor: "#222222",
    });
    expect(rendered.svg).not.toContain("<text");
    expect(rendered.svg).not.toContain("✓");
    expect(rendered.svg).not.toMatch(/>1<\/text>|>2<\/text>|>3<\/text>/);
  });

  it("ignores milestone artwork and uses only FILLED and EMPTY visual states", () => {
    const milestone = {
      kind: "svg" as const,
      trusted: true as const,
      content:
        '<svg xmlns="http://www.w3.org/2000/svg"><path id="reward-star" d="M50 2l12 32h34L69 54l11 34-30-20-30 20 11-34L4 34h34z"/></svg>',
    };
    const rendered = renderStampSvg({
      goal: 8,
      progress: 5,
      layout: "PATH",
      layoutConfiguration: { columns: 4, serpentine: true },
      filledColor: "#6B3F2A",
      emptyColor: "#E7B56B",
      accentColor: "#222222",
      milestones: [{ position: 4, artwork: milestone }],
    });
    expect(rendered.svg).not.toContain("data-milestone");
    expect(rendered.svg).not.toContain(Buffer.from(milestone.content, "utf8").toString("base64"));
    expect(rendered.svg).toContain('data-visual-state="FILLED"');
    expect(rendered.svg).toContain('data-visual-state="EMPTY"');
    expect(rendered.svg).not.toContain("<text");
  });

  it.each([
    { progress: 0, filled: 0, rewardReady: false },
    { progress: 5, filled: 5, rewardReady: false },
    { progress: 8, filled: 8, rewardReady: true },
  ])("renders the locked two-state grid at progress $progress", (state) => {
    const rendered = renderStampSvg({
      goal: 8,
      progress: state.progress,
      layout: "GRID",
      filledColor: "#6B3F2A",
      emptyColor: "#E7B56B",
      accentColor: "#222222",
      rewardReady: state.rewardReady,
    });
    expect(rendered.positions.filter((position) => position.filled)).toHaveLength(state.filled);
    expect(rendered.svg).toContain(`data-reward-ready="${String(state.rewardReady)}"`);
    expect(rendered.svg).not.toContain("data-milestone");
    expect(rendered.svg).not.toContain("<text");
  });

  it("renders Arabic labels only when explicitly enabled", () => {
    const rendered = renderStampSvg({
      goal: 4,
      progress: 2,
      layout: "ROW",
      filledColor: "#6B3F2A",
      emptyColor: "#E7B56B",
      accentColor: "#222222",
      progressLabelVisible: true,
      rewardLabelVisible: true,
      label: "ختمان من أربعة",
      rewardLabel: "المكافأة التالية",
    });
    expect(rendered.svg).toContain("ختمان من أربعة");
    expect(rendered.svg).toContain("المكافأة التالية");
    expect(rendered.svg).toContain("Noto Sans Arabic");
  });
});
