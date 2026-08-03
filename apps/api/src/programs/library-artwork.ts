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
    code: "ESPRESSO_SHOT",
    name: "Espresso cup",
    nameAr: "فنجان إسبريسو",
    description: "A compact espresso cup and saucer.",
    descriptionAr: "فنجان إسبريسو صغير مع صحن.",
    fill: "#9A5A34",
    stroke: "#40251A",
    draw: (fill, stroke) =>
      `<path d="M24 39h48v16c0 15-9 24-24 24S24 70 24 55V39Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M72 44h8c8 0 8 15 0 16h-8" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/><path d="M18 82h62" stroke="${stroke}" stroke-width="6" stroke-linecap="round"/><path d="M39 31c-5-6 5-9 0-15M55 31c-5-6 5-9 0-15" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>`,
  },
  {
    code: "LATTE_CUP",
    name: "Latte cup",
    nameAr: "كوب لاتيه",
    description: "A tall latte cup with simple leaf foam art.",
    descriptionAr: "كوب لاتيه طويل مع رسمة ورقة بسيطة.",
    fill: "#C8895C",
    stroke: "#5A3321",
    draw: (fill, stroke, state) =>
      `<path d="M24 27h52l-5 57H29l-5-57Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><ellipse cx="50" cy="28" rx="26" ry="9" fill="${state === "EMPTY" ? "#FFFDF8" : "#F6D9B7"}" stroke="${stroke}" stroke-width="4"/><path d="M50 34c-10-8-19 6 0 18 19-12 10-26 0-18Zm0 0v18" fill="none" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`,
  },
  {
    code: "COFFEE_BEAN",
    name: "Coffee bean",
    nameAr: "حبة قهوة",
    description: "A bold roasted coffee bean.",
    descriptionAr: "حبة قهوة محمصة واضحة.",
    fill: "#6F4631",
    stroke: "#2F211B",
    draw: (fill, stroke) =>
      `<ellipse cx="50" cy="50" rx="29" ry="38" transform="rotate(32 50 50)" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M35 22c17 15 22 34 29 57" fill="none" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/><path d="M39 31c8 7 11 15 15 26" fill="none" stroke="#FFFDF8" stroke-width="3" stroke-linecap="round" opacity=".65"/>`,
  },
  {
    code: "BREAD_LOAF",
    name: "Bread loaf",
    nameAr: "رغيف خبز",
    description: "A rounded artisan bread loaf.",
    descriptionAr: "رغيف خبز حِرفي مستدير.",
    fill: "#C88343",
    stroke: "#633A20",
    draw: (fill, stroke, state) =>
      `<path d="M18 70c0-28 12-47 32-47s32 19 32 47v12H18V70Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><g fill="none" stroke="${state === "EMPTY" ? stroke : "#F7D59E"}" stroke-width="5" stroke-linecap="round"><path d="m32 39 10 10M49 31l10 11M65 39l8 9"/></g>`,
  },
  {
    code: "CUPCAKE",
    name: "Cupcake",
    nameAr: "كب كيك",
    description: "A cheerful frosted cupcake.",
    descriptionAr: "قطعة كب كيك مبهجة بالكريمة.",
    fill: "#E7658D",
    stroke: "#762A48",
    draw: (fill, stroke, state) =>
      `<path d="M29 52h42l-5 34H34l-5-34Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M25 51c-2-12 8-19 17-17 1-10 18-14 23-2 11-1 18 9 13 19H25Z" fill="${state === "EMPTY" ? "#FFFDF8" : "#F6B4C8"}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><circle cx="51" cy="22" r="7" fill="${fill}" stroke="${stroke}" stroke-width="4"/><path d="M42 62v16M52 60v20M62 62v16" stroke="${stroke}" stroke-width="3" opacity=".55"/>`,
  },
  {
    code: "CROISSANT",
    name: "Croissant",
    nameAr: "كرواسون",
    description: "A curved layered croissant.",
    descriptionAr: "قطعة كرواسون منحنية بطبقات واضحة.",
    fill: "#D99A55",
    stroke: "#704322",
    draw: (fill, stroke, state) =>
      `<path d="M14 59c7-23 19-37 36-38 17 1 29 15 36 38-11 17-24 23-36 23S25 76 14 59Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><path d="M25 50c7 8 10 17 11 27M42 31c3 15 3 32 0 49M58 31c-3 15-3 32 0 49M75 50c-7 8-10 17-11 27" fill="none" stroke="${state === "EMPTY" ? stroke : "#F6D29D"}" stroke-width="4" stroke-linecap="round"/>`,
  },
  {
    code: "CAR_SPARKLE",
    name: "Polished car",
    nameAr: "سيارة لامعة",
    description: "A polished car with clean detailing glints.",
    descriptionAr: "سيارة لامعة مع لمسات تلميع واضحة.",
    fill: "#315D78",
    stroke: "#142F3F",
    draw: (fill, stroke, state) =>
      `<path d="M14 61 23 40c2-5 6-8 12-8h28c6 0 10 3 13 8l9 21v16H15V66c0-2 0-4-1-5Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M29 55h42l-7-14H36l-7 14Z" fill="${state === "EMPTY" ? "#FFFDF8" : "#DDF5FF"}" stroke="${stroke}" stroke-width="3"/><circle cx="30" cy="77" r="7" fill="#FFFDF8" stroke="${stroke}" stroke-width="5"/><circle cx="70" cy="77" r="7" fill="#FFFDF8" stroke="${stroke}" stroke-width="5"/><path d="M76 16v14M69 23h14M22 19v9M17 24h10" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>`,
  },
  {
    code: "FOAM_BUBBLES",
    name: "Wash foam",
    nameAr: "رغوة غسيل",
    description: "A cluster of clean wash bubbles and a water line.",
    descriptionAr: "مجموعة فقاعات غسيل مع موجة ماء.",
    fill: "#63C5DD",
    stroke: "#1D6072",
    draw: (fill, stroke, state) =>
      `<g fill="${fill}" stroke="${stroke}" stroke-width="4"><circle cx="31" cy="38" r="17"/><circle cx="58" cy="28" r="13"/><circle cx="72" cy="51" r="18"/><circle cx="43" cy="61" r="15"/></g><path d="M16 79c12-9 22 9 34 0s22 9 34 0" fill="none" stroke="${stroke}" stroke-width="6" stroke-linecap="round"/><g fill="${state === "EMPTY" ? stroke : "#FFFFFF"}" opacity=".75"><circle cx="26" cy="33" r="4"/><circle cx="54" cy="24" r="3"/><circle cx="67" cy="45" r="4"/></g>`,
  },
  {
    code: "BEAUTY_SPARKLE",
    name: "Beauty sparkle",
    nameAr: "لمعة جمال",
    description: "Three elegant beauty glints.",
    descriptionAr: "ثلاث لمعات أنيقة للجمال.",
    fill: "#C879A8",
    stroke: "#69304F",
    draw: (fill, stroke) =>
      `<path d="M50 10c5 18 10 23 28 28-18 5-23 10-28 28-5-18-10-23-28-28 18-5 23-10 28-28Z" fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round"/><path d="M76 57c3 10 6 13 16 16-10 3-13 6-16 16-3-10-6-13-16-16 10-3 13-6 16-16ZM24 60c2 7 4 9 11 11-7 2-9 4-11 11-2-7-4-9-11-11 7-2 9-4 11-11Z" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`,
  },
  {
    code: "NAIL_POLISH",
    name: "Nail polish",
    nameAr: "طلاء أظافر",
    description: "A modern nail-polish bottle.",
    descriptionAr: "عبوة طلاء أظافر عصرية.",
    fill: "#E45C7A",
    stroke: "#76283D",
    draw: (fill, stroke, state) =>
      `<path d="M37 12h26v25H37V12Z" fill="${state === "EMPTY" ? "#FFFDF8" : "#38323A"}" stroke="${stroke}" stroke-width="5"/><path d="M29 34h42l6 13v38H23V47l6-13Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><path d="M34 54h32v20H34V54Z" fill="${state === "EMPTY" ? "#FFFDF8" : "#FFC7D3"}" stroke="${stroke}" stroke-width="3"/><path d="M42 65h16" stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`,
  },
  {
    code: "LOTUS",
    name: "Lotus",
    nameAr: "زهرة لوتس",
    description: "A balanced wellness lotus.",
    descriptionAr: "زهرة لوتس متوازنة للعناية والهدوء.",
    fill: "#7CA08B",
    stroke: "#365746",
    draw: (fill, stroke) =>
      `<path d="M50 18c13 13 14 28 0 43-14-15-13-30 0-43Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/><path d="M19 38c18 2 28 11 31 29-18-3-29-12-31-29ZM81 38C63 40 53 49 50 67c18-3 29-12 31-29Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/><path d="M12 61c16-3 28 3 38 19-17 3-30-3-38-19ZM88 61C72 58 60 64 50 80c17 3 30-3 38-19Z" fill="${fill}" stroke="${stroke}" stroke-width="4"/><path d="M20 84h60" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    code: "RAZOR",
    name: "Straight razor",
    nameAr: "شفرة حلاقة",
    description: "A classic folding straight razor.",
    descriptionAr: "شفرة حلاقة كلاسيكية قابلة للطي.",
    fill: "#5B7883",
    stroke: "#263E47",
    draw: (fill, stroke, state) =>
      `<path d="M15 53h57c10 0 17 8 13 17-3 7-10 11-20 11H26L15 53Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><path d="m24 50 22-31h38C72 36 56 48 37 53" fill="${state === "EMPTY" ? "#FFFDF8" : "#D9E4E8"}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><circle cx="69" cy="68" r="5" fill="#FFFDF8" stroke="${stroke}" stroke-width="3"/>`,
  },
  {
    code: "COMB",
    name: "Barber comb",
    nameAr: "مشط حلاقة",
    description: "A clean barber comb silhouette.",
    descriptionAr: "مشط حلاقة بخطوط واضحة.",
    fill: "#4E8294",
    stroke: "#234653",
    draw: (fill, stroke) =>
      `<path d="M14 29h72v24H14V29Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M22 52v30M31 52v22M40 52v30M49 52v22M58 52v30M67 52v22M76 52v30" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/><path d="M24 40h52" stroke="#FFFDF8" stroke-width="4" stroke-linecap="round" opacity=".65"/>`,
  },
  {
    code: "BARBER_POLE",
    name: "Barber pole",
    nameAr: "عمود الحلاق",
    description: "A traditional striped barber pole.",
    descriptionAr: "عمود حلاق تقليدي بخطوط مميزة.",
    fill: "#B94B45",
    stroke: "#243F52",
    draw: (fill, stroke, state) =>
      `<path d="M32 18h36v64H32V18Z" fill="${state === "EMPTY" ? "#FFFDF8" : "#F6EFE4"}" stroke="${stroke}" stroke-width="5"/><path d="m34 32 31-13M34 49l32-14M34 66l32-14M37 81l29-13" stroke="${fill}" stroke-width="8"/><path d="M26 15h48M26 85h48" stroke="${stroke}" stroke-width="7" stroke-linecap="round"/>`,
  },
  {
    code: "DINNER_PLATE",
    name: "Dinner plate",
    nameAr: "طبق مائدة",
    description: "A dining plate with a simple place setting.",
    descriptionAr: "طبق طعام مع ترتيب مائدة بسيط.",
    fill: "#D16B5B",
    stroke: "#6F3028",
    draw: (fill, stroke, state) =>
      `<circle cx="50" cy="50" r="32" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="50" cy="50" r="20" fill="${state === "EMPTY" ? "#FFFDF8" : "#FFE8D8"}" stroke="${stroke}" stroke-width="3"/><path d="M12 22v56M7 22v20M17 22v20M88 22v56M83 22c0 14 10 14 10 0" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>`,
  },
  {
    code: "CLOCHE",
    name: "Serving cloche",
    nameAr: "طبق تقديم",
    description: "A refined covered serving dish.",
    descriptionAr: "طبق تقديم أنيق بغطاء.",
    fill: "#B99655",
    stroke: "#4D432F",
    draw: (fill, stroke, state) =>
      `<path d="M18 69c2-24 14-37 32-37s30 13 32 37H18Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="50" cy="24" r="8" fill="${state === "EMPTY" ? "#FFFDF8" : fill}" stroke="${stroke}" stroke-width="4"/><path d="M12 72h76M22 82h56" stroke="${stroke}" stroke-width="6" stroke-linecap="round"/><path d="M34 48c8-8 24-8 32 0" fill="none" stroke="#FFFDF8" stroke-width="4" opacity=".65"/>`,
  },
  {
    code: "FORK_KNIFE",
    name: "Fork and knife",
    nameAr: "شوكة وسكين",
    description: "A timeless fork-and-knife place setting.",
    descriptionAr: "ترتيب كلاسيكي لشوكة وسكين.",
    fill: "#B44F42",
    stroke: "#5E2B26",
    draw: (fill, stroke) =>
      `<path d="M28 14v25M20 14v20c0 12 16 12 16 0V14M28 39v47" fill="none" stroke="${stroke}" stroke-width="6" stroke-linecap="round"/><path d="M62 14c15 11 18 31 7 45v27H56V23c0-6 2-9 6-9Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/>`,
  },
  {
    code: "BURGER",
    name: "Quick bite",
    nameAr: "وجبة سريعة",
    description: "A compact layered burger.",
    descriptionAr: "برغر مدمج بطبقات واضحة.",
    fill: "#E16A3F",
    stroke: "#6B3322",
    draw: (fill, stroke, state) =>
      `<path d="M17 45c3-19 16-29 33-29s30 10 33 29H17Z" fill="${state === "EMPTY" ? "#FFFDF8" : "#F3B64F"}" stroke="${stroke}" stroke-width="5"/><path d="M15 52h70l-9 15H24L15 52Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><path d="M20 70h60v14H20V70Z" fill="${state === "EMPTY" ? "#FFFDF8" : "#F3B64F"}" stroke="${stroke}" stroke-width="5"/><path d="M31 31h1M48 25h1M67 33h1" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    code: "PRICE_TAG",
    name: "Price tag",
    nameAr: "بطاقة سعر",
    description: "A bold retail price tag.",
    descriptionAr: "بطاقة سعر واضحة للتجزئة.",
    fill: "#8B55B7",
    stroke: "#472760",
    draw: (fill, stroke, state) =>
      `<path d="M15 19h42l29 30-37 37-30-29-4-38Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><circle cx="35" cy="38" r="8" fill="${state === "EMPTY" ? "#FFFDF8" : "#F4D7FF"}" stroke="${stroke}" stroke-width="4"/><path d="m47 61 16-16" stroke="#FFFDF8" stroke-width="5" stroke-linecap="round" opacity=".75"/>`,
  },
  {
    code: "MEMBER_BADGE",
    name: "Member badge",
    nameAr: "شارة عضو",
    description: "A premium circular membership badge.",
    descriptionAr: "شارة عضوية دائرية بطابع مميز.",
    fill: "#C9A650",
    stroke: "#55451F",
    draw: (fill, stroke, state) =>
      `<circle cx="50" cy="43" r="31" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="50" cy="43" r="20" fill="${state === "EMPTY" ? "#FFFDF8" : "#F8E4A4"}" stroke="${stroke}" stroke-width="3"/><path d="m31 67-7 22 19-10M69 67l7 22-19-10" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><path d="M40 43h20" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    code: "PACKAGE_BOX",
    name: "Store package",
    nameAr: "طرد متجر",
    description: "A clean modular retail package.",
    descriptionAr: "طرد متجر منظم بخطوط بسيطة.",
    fill: "#668AA5",
    stroke: "#314C60",
    draw: (fill, stroke, state) =>
      `<path d="m18 34 32-18 32 18v40L50 90 18 74V34Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><path d="m18 34 32 18 32-18M50 52v38M34 25l32 18" fill="none" stroke="${stroke}" stroke-width="4"/><path d="M26 46v20" stroke="${state === "EMPTY" ? stroke : "#DCEAF2"}" stroke-width="5" stroke-linecap="round"/>`,
  },
  {
    code: "REWARD_LOOP",
    name: "Reward loop",
    nameAr: "دائرة مكافأة",
    description: "A continuous modern reward loop.",
    descriptionAr: "دائرة مكافأة عصرية ومتواصلة.",
    fill: "#8D78D6",
    stroke: "#43366F",
    draw: (fill, stroke, state) =>
      `<path d="M50 16c19 0 34 15 34 34S69 84 50 84 16 69 16 50c0-10 4-18 10-24" fill="none" stroke="${fill}" stroke-width="15" stroke-linecap="round"/><path d="m18 17 17 2-4 17" fill="${state === "EMPTY" ? "#FFFDF8" : fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><circle cx="50" cy="50" r="12" fill="${state === "EMPTY" ? "#FFFDF8" : fill}" stroke="${stroke}" stroke-width="5"/>`,
  },
  {
    code: "NEUTRAL_MARK",
    name: "Neutral loyalty mark",
    nameAr: "علامة ولاء محايدة",
    description: "A restrained pair of interlocking forms.",
    descriptionAr: "شكلان مترابطان بطابع محايد وهادئ.",
    fill: "#68756F",
    stroke: "#34413B",
    draw: (fill, stroke, state) =>
      `<rect x="18" y="26" width="42" height="48" rx="20" fill="${fill}" stroke="${stroke}" stroke-width="5"/><rect x="40" y="26" width="42" height="48" rx="20" fill="${state === "EMPTY" ? "#FFFDF8" : "#A7B2AD"}" stroke="${stroke}" stroke-width="5"/><path d="M42 40v20" stroke="#FFFDF8" stroke-width="4" stroke-linecap="round" opacity=".7"/>`,
  },
  {
    code: "VISIT_BADGE",
    name: "Everyday visit badge",
    nameAr: "شارة زيارة يومية",
    description: "A friendly layered visit badge.",
    descriptionAr: "شارة ودودة بطبقات للزيارات اليومية.",
    fill: "#C9654B",
    stroke: "#6D3425",
    draw: (fill, stroke, state) =>
      `<path d="M50 10 62 22l17-1 1 17 12 12-12 12-1 17-17-1-12 12-12-12-17 1-1-17L8 50l12-12 1-17 17 1 12-12Z" fill="${fill}" stroke="${stroke}" stroke-width="5" stroke-linejoin="round"/><circle cx="50" cy="50" r="20" fill="${state === "EMPTY" ? "#FFFDF8" : "#F5D28D"}" stroke="${stroke}" stroke-width="4"/><circle cx="50" cy="50" r="6" fill="${stroke}"/>`,
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
