export type LibraryArtwork = {
  code: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  category: "STAMP_FILLED" | "STAMP_EMPTY";
  content: string;
};

function badge(fill: string, stroke: string, face: string, eyes = stroke) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 4c7 8 14 7 21 5 1 8 7 13 15 15-3 8-1 15 5 21-6 6-8 13-5 21-8 2-14 7-15 15-7-2-14-3-21 5-7-8-14-7-21-5-1-8-7-13-15-15 3-8 1-15-5-21 6-6 8-13 5-21 8-2 14-7 15-15 7 2 14 3 21-5Z" fill="${fill}" stroke="${stroke}" stroke-width="5"/><circle cx="35" cy="40" r="5" fill="${eyes}"/><circle cx="65" cy="40" r="5" fill="${eyes}"/><path d="M34 62c10 8 22 8 32 0" fill="none" stroke="${face}" stroke-width="5" stroke-linecap="round"/></svg>`;
}

const concepts = [
  [
    "COOKIES",
    "Cookies",
    "ملفات تعريف الارتباط",
    "A friendly cookie journey.",
    "رحلة ودودة مع الحلوى.",
    "#E4572E",
    "#B63A18",
  ],
  ["COFFEE", "Coffee", "قهوة", "A warm coffee ritual.", "طقس قهوة دافئ.", "#8B5E3C", "#4A2C1A"],
  [
    "BAKERY",
    "Bakery",
    "مخبز",
    "Fresh rewards from the oven.",
    "مكافآت طازجة من الفرن.",
    "#F3A712",
    "#A45A00",
  ],
  [
    "PIZZA",
    "Pizza",
    "بيتزا",
    "A slice-by-slice journey.",
    "رحلة شريحة بعد شريحة.",
    "#D64545",
    "#7A1F1F",
  ],
  [
    "SMOOTHIE",
    "Smoothie",
    "سموثي",
    "A bright, healthy goal.",
    "هدف صحي ومشرق.",
    "#4BAE75",
    "#1C6A43",
  ],
  [
    "SALON",
    "Salon",
    "صالون",
    "A polished appointment reward.",
    "مكافأة أنيقة للمواعيد.",
    "#B565A7",
    "#68325E",
  ],
  [
    "FITNESS",
    "Fitness",
    "لياقة",
    "Keep moving toward the goal.",
    "واصل الحركة نحو هدفك.",
    "#2E86AB",
    "#174C63",
  ],
  ["RETAIL", "Retail", "تجزئة", "Every visit counts.", "كل زيارة تُحتسب.", "#5C6BC0", "#293477"],
  [
    "FLOWERS",
    "Flowers",
    "زهور",
    "Bloom into a reward.",
    "ازدهر نحو المكافأة.",
    "#E76F9A",
    "#8C294E",
  ],
  [
    "BOOKS",
    "Books",
    "كتب",
    "A chapter-by-chapter reward.",
    "مكافأة فصل بعد فصل.",
    "#6C63A8",
    "#332E62",
  ],
  ["JUICE", "Juice", "عصائر", "A fresh pour of progress.", "تقدم منعش.", "#F08A24", "#984B00"],
  [
    "PETCARE",
    "Pet care",
    "رعاية الحيوانات",
    "Rewards for caring visits.",
    "مكافآت لزيارات الرعاية.",
    "#4D9DE0",
    "#1D507B",
  ],
] as const;

export const libraryArtwork: LibraryArtwork[] = concepts.flatMap(
  ([code, name, nameAr, description, descriptionAr, filled, stroke]) => [
    {
      code: `${code}_FILLED`,
      name,
      nameAr,
      description,
      descriptionAr,
      category: "STAMP_FILLED" as const,
      content: badge(filled, stroke, "#FFFFFF"),
    },
    {
      code: `${code}_EMPTY`,
      name,
      nameAr,
      description,
      descriptionAr,
      category: "STAMP_EMPTY" as const,
      content: badge("#F7F4EE", "#C9BFB1", stroke),
    },
  ],
);

export function artworkFor(code: string) {
  return libraryArtwork.find((item) => item.code === code);
}

export function conceptTemplates() {
  return concepts.map(([code, name, nameAr, description, descriptionAr]) => ({
    code,
    name,
    nameAr,
    description,
    descriptionAr,
    filled: `${code}_FILLED`,
    empty: `${code}_EMPTY`,
    category: ["SALON", "FITNESS", "RETAIL", "BOOKS", "PETCARE"].includes(code)
      ? "services-and-retail"
      : "food-and-beverage",
    version: 1,
  }));
}
