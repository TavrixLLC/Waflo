import { createHash } from "node:crypto";
import { latestProgramTemplates, type ProgramTemplateArtworkReference } from "@waflo/contracts";

export const LIBRARY_ARTWORK_SCHEMA_VERSION = 2;

export type LibraryArtworkCategory = "STAMP_FILLED" | "STAMP_EMPTY" | "STAMP_MILESTONE";

export interface LibraryArtwork {
  code: string;
  version: number;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: LibraryArtworkCategory;
  content: string;
}

type ArtworkState = "FILLED" | "EMPTY" | "MILESTONE";

interface ConceptDefinition {
  code: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  fill: string;
  stroke: string;
  draw: (fill: string, stroke: string, state: ArtworkState) => string;
}

function svg(content: string, state: ArtworkState): string {
  const milestone =
    state === "MILESTONE"
      ? '<circle cx="50" cy="50" r="45" fill="#FFF5CC" stroke="#D99A19" stroke-width="5"/>'
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${milestone}${content}</svg>`;
}

function colors(
  definition: ConceptDefinition,
  state: ArtworkState,
): { fill: string; stroke: string } {
  return state === "EMPTY"
    ? { fill: "#FFFDF8", stroke: definition.stroke }
    : { fill: definition.fill, stroke: definition.stroke };
}

const concepts: ConceptDefinition[] = [
  {
    code: "COOKIE",
    name: "Cookie",
    nameAr: "كوكيز",
    description: "A round chocolate-chip cookie.",
    descriptionAr: "قطعة كوكيز مستديرة برقائق الشوكولاتة.",
    fill: "#E9A04B",
    stroke: "#6B351B",
    draw: (fill, stroke, state) =>
      `<path d="M50 14a36 36 0 1 0 36 36c-12 2-20-7-18-18-11 2-20-6-18-18Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><g fill="${state === "EMPTY" ? "#FFFDF8" : stroke}" stroke="${stroke}" stroke-width="${state === "EMPTY" ? 3 : 0}"><circle cx="34" cy="35" r="5"/><circle cx="52" cy="55" r="5"/><circle cx="31" cy="64" r="4"/><circle cx="58" cy="29" r="4"/><circle cx="72" cy="59" r="4"/></g>`,
  },
  {
    code: "COFFEE_CUP",
    name: "Coffee cup",
    nameAr: "كوب قهوة",
    description: "A steaming coffee cup.",
    descriptionAr: "كوب قهوة ساخن.",
    fill: "#A66A43",
    stroke: "#4A2818",
    draw: (fill, stroke) =>
      `<path d="M25 38h48v20c0 16-10 26-24 26S25 74 25 58V38Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><path d="M73 44h7c9 0 10 18 0 20h-8" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/><path d="M36 29c-6-7 6-10 0-17M50 29c-6-7 6-10 0-17M64 29c-6-7 6-10 0-17" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/><path d="M20 85h61" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    code: "CAR",
    name: "Car",
    nameAr: "سيارة",
    description: "A clean compact car.",
    descriptionAr: "سيارة نظيفة.",
    fill: "#3B9DC4",
    stroke: "#16445B",
    draw: (fill, stroke) =>
      `<path d="M18 58 27 36c2-5 6-8 12-8h23c6 0 10 3 13 8l9 22v17H16V63c0-3 1-4 2-5Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><path d="M31 54h39l-6-15H38l-7 15Z" fill="#EAF8FF" stroke="${stroke}" stroke-width="4"/><circle cx="31" cy="76" r="8" fill="#FFFDF8" stroke="${stroke}" stroke-width="5"/><circle cx="70" cy="76" r="8" fill="#FFFDF8" stroke="${stroke}" stroke-width="5"/><path d="M22 61h10M68 61h11" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    code: "WATER_DROP",
    name: "Water drop",
    nameAr: "قطرة ماء",
    description: "A clear water drop.",
    descriptionAr: "قطرة ماء صافية.",
    fill: "#55BCE8",
    stroke: "#17658A",
    draw: (fill, stroke) =>
      `<path d="M50 10S22 43 22 63a28 28 0 0 0 56 0C78 43 50 10 50 10Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M36 64c1 8 6 13 14 15" fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity=".8"/>`,
  },
  {
    code: "STAR",
    name: "Star",
    nameAr: "نجمة",
    description: "A five-point reward star.",
    descriptionAr: "نجمة مكافأة خماسية.",
    fill: "#F3B42B",
    stroke: "#8A5A00",
    draw: (fill, stroke) =>
      `<path d="m50 10 11 25 28 3-21 19 6 28-24-14-24 14 6-28-21-19 28-3 11-25Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/>`,
  },
  {
    code: "HEART",
    name: "Heart",
    nameAr: "قلب",
    description: "A warm heart.",
    descriptionAr: "قلب دافئ.",
    fill: "#E96783",
    stroke: "#8A2941",
    draw: (fill, stroke) =>
      `<path d="M50 84 18 54C2 37 13 16 31 17c9 0 15 5 19 12 4-7 10-12 19-12 18-1 29 20 13 37L50 84Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/>`,
  },
  {
    code: "FLOWER",
    name: "Flower",
    nameAr: "زهرة",
    description: "A six-petal flower.",
    descriptionAr: "زهرة بست بتلات.",
    fill: "#DF78B5",
    stroke: "#7B2D62",
    draw: (fill, stroke) =>
      `<g fill="${fill}" stroke="${stroke}" stroke-width="4"><ellipse cx="50" cy="25" rx="13" ry="19"/><ellipse cx="72" cy="38" rx="13" ry="19" transform="rotate(60 72 38)"/><ellipse cx="72" cy="64" rx="13" ry="19" transform="rotate(120 72 64)"/><ellipse cx="50" cy="76" rx="13" ry="19"/><ellipse cx="28" cy="64" rx="13" ry="19" transform="rotate(60 28 64)"/><ellipse cx="28" cy="38" rx="13" ry="19" transform="rotate(120 28 38)"/></g><circle cx="50" cy="50" r="13" fill="#F7C94B" stroke="${stroke}" stroke-width="4"/>`,
  },
  {
    code: "SCISSORS",
    name: "Scissors",
    nameAr: "مقص",
    description: "A recognizable pair of scissors.",
    descriptionAr: "مقص واضح.",
    fill: "#5D8CA0",
    stroke: "#244552",
    draw: (fill, stroke) =>
      `<circle cx="28" cy="69" r="14" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="57" cy="69" r="14" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="28" cy="69" r="5" fill="#FFFDF8"/><circle cx="57" cy="69" r="5" fill="#FFFDF8"/><path d="m36 58 39-43 8 4-31 43M47 58 22 18l8-4 29 46" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/>`,
  },
  {
    code: "DONUT",
    name: "Donut",
    nameAr: "دونات",
    description: "A glazed ring donut.",
    descriptionAr: "دونات مزججة.",
    fill: "#E98A9F",
    stroke: "#7C3A49",
    draw: (fill, stroke, state) =>
      `<circle cx="50" cy="50" r="36" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="50" cy="50" r="13" fill="#FFFDF8" stroke="${stroke}" stroke-width="4"/><g stroke="${state === "EMPTY" ? stroke : "#FFF3A7"}" stroke-width="4" stroke-linecap="round"><path d="m30 34 6 3M58 26l2 7M68 46l7-2M28 60l7-2M59 70l5 4"/></g>`,
  },
  {
    code: "SHOPPING_BAG",
    name: "Shopping bag",
    nameAr: "حقيبة تسوق",
    description: "A handled shopping bag.",
    descriptionAr: "حقيبة تسوق بمقبض.",
    fill: "#6E7ED0",
    stroke: "#303A7A",
    draw: (fill, stroke) =>
      `<path d="M22 35h56l-5 49H27l-5-49Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><path d="M37 40V28c0-9 6-15 13-15s13 6 13 15v12" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/><path d="M36 57h28" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" opacity=".75"/>`,
  },
  {
    code: "GENERAL_CIRCLE",
    name: "Visit circle",
    nameAr: "دائرة زيارة",
    description: "A simple general-purpose visit mark.",
    descriptionAr: "علامة دائرية عامة للزيارات.",
    fill: "#D35B3D",
    stroke: "#762B1B",
    draw: (fill, stroke) =>
      `<circle cx="50" cy="50" r="36" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="50" cy="50" r="22" fill="none" stroke="#FFFDF8" stroke-width="5" opacity=".8"/><circle cx="50" cy="50" r="6" fill="${stroke}"/>`,
  },
  {
    code: "GIFT",
    name: "Gift",
    nameAr: "هدية",
    description: "A wrapped reward gift.",
    descriptionAr: "هدية مكافأة مغلفة.",
    fill: "#E05D55",
    stroke: "#7A2925",
    draw: (fill, stroke) =>
      `<path d="M20 43h60v43H20V43Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M15 32h70v18H15V32Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M50 32v54M31 31c-13-8-8-23 2-19 8 3 17 20 17 20M69 31c13-8 8-23-2-19-8 3-17 20-17 20" fill="none" stroke="#F8D37A" stroke-width="6" stroke-linejoin="round"/>`,
  },
];

function conceptArtwork(definition: ConceptDefinition, state: ArtworkState): LibraryArtwork {
  const palette = colors(definition, state);
  return {
    code: `${definition.code}_${state}`,
    version: 2,
    name: `${definition.name} ${state.toLowerCase()}`,
    nameAr: definition.nameAr,
    description: definition.description,
    descriptionAr: definition.descriptionAr,
    category:
      state === "FILLED" ? "STAMP_FILLED" : state === "EMPTY" ? "STAMP_EMPTY" : "STAMP_MILESTONE",
    content: svg(definition.draw(palette.fill, palette.stroke, state), state),
  };
}

function legacyBadge(fill: string, stroke: string, empty = false) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 4c7 8 14 7 21 5 1 8 7 13 15 15-3 8-1 15 5 21-6 6-8 13-5 21-8 2-14 7-15 15-7-2-14-3-21 5-7-8-14-7-21-5-1-8-7-13-15-15 3-8 1-15-5-21 6-6 8-13 5-21 8-2 14-7 15-15 7 2 14 3 21-5Z" fill="${empty ? "#F7F4EE" : fill}" stroke="${stroke}" stroke-width="5"/></svg>`;
}

const legacyCodes = [
  "COOKIES",
  "COFFEE",
  "BAKERY",
  "PIZZA",
  "SMOOTHIE",
  "SALON",
  "FITNESS",
  "RETAIL",
  "FLOWERS",
  "BOOKS",
  "JUICE",
  "PETCARE",
] as const;

const legacyArtwork: LibraryArtwork[] = legacyCodes.flatMap((code) => [
  {
    code: `${code}_FILLED`,
    version: 1,
    name: `${code} legacy filled`,
    nameAr: code,
    description: "Legacy W2 artwork retained for historical rendering.",
    descriptionAr: "رسم تاريخي محفوظ.",
    category: "STAMP_FILLED",
    content: legacyBadge("#E4572E", "#8A2D18"),
  },
  {
    code: `${code}_EMPTY`,
    version: 1,
    name: `${code} legacy empty`,
    nameAr: code,
    description: "Legacy W2 artwork retained for historical rendering.",
    descriptionAr: "رسم تاريخي محفوظ.",
    category: "STAMP_EMPTY",
    content: legacyBadge("#F7F4EE", "#8A2D18", true),
  },
  {
    code: `${code}_MILESTONE`,
    version: 1,
    name: `${code} legacy milestone`,
    nameAr: code,
    description: "Legacy W2 artwork retained for historical rendering.",
    descriptionAr: "رسم تاريخي محفوظ.",
    category: "STAMP_MILESTONE",
    content: legacyBadge("#F3A712", "#8A5A00"),
  },
]);

export const libraryArtwork: readonly LibraryArtwork[] = [
  ...legacyArtwork,
  ...concepts.flatMap((definition) =>
    (["FILLED", "EMPTY", "MILESTONE"] as const).map((state) => conceptArtwork(definition, state)),
  ),
];

export function artworkFor(
  reference: ProgramTemplateArtworkReference | string,
  version?: number,
): LibraryArtwork | undefined {
  const code = typeof reference === "string" ? reference : reference.code;
  const targetVersion = typeof reference === "string" ? version : reference.version;
  const matches = libraryArtwork.filter((item) => item.code === code);
  if (targetVersion !== undefined) return matches.find((item) => item.version === targetVersion);
  return matches.toSorted((left, right) => right.version - left.version)[0];
}

export function canonicalArtworkBytes(artwork: LibraryArtwork): Buffer {
  return Buffer.from(artwork.content.replace(/\r\n/g, "\n").trim(), "utf8");
}

export function libraryArtworkDigest(artwork: LibraryArtwork): string {
  return createHash("sha256")
    .update(`waflo-library:${LIBRARY_ARTWORK_SCHEMA_VERSION}:`)
    .update(canonicalArtworkBytes(artwork))
    .digest("hex");
}

export function conceptTemplates() {
  return latestProgramTemplates();
}
