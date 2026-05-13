import type {
  CompareCategoryDiffJSON,
  CompareKeyAnchorJSON,
  VisionCompareAnalysisV4,
} from "@/lib/api/types";
import { hasKorean } from "@/lib/prompt-language";

export type CompareDisplayLang = "ko" | "en";

export interface CompareDisplayText {
  text: string;
  lang: CompareDisplayLang;
  hasUsableKo: boolean;
  ko: string;
  en: string;
}

export function hasUsableKorean(ko: string | null | undefined): boolean {
  return hasKorean((ko ?? "").trim());
}

export function pickCompareText(
  ko: string | null | undefined,
  en: string | null | undefined,
): CompareDisplayText {
  const koText = (ko ?? "").trim();
  const enText = (en ?? "").trim();
  if (hasUsableKorean(koText)) {
    return {
      text: koText,
      lang: "ko",
      hasUsableKo: true,
      ko: koText,
      en: enText,
    };
  }
  return {
    text: enText || koText,
    lang: "en",
    hasUsableKo: false,
    ko: koText,
    en: enText,
  };
}

export function pickCompareTextList(
  koList: string[],
  enList: string[],
): CompareDisplayText[] {
  const max = Math.max(koList.length, enList.length);
  const items: CompareDisplayText[] = [];
  for (let i = 0; i < max; i += 1) {
    const item = pickCompareText(koList[i], enList[i]);
    if (item.text) items.push(item);
  }
  return items;
}

export function rowHasUsableKorean(row: CompareCategoryDiffJSON): boolean {
  return (
    hasUsableKorean(row.image1Ko) ||
    hasUsableKorean(row.image2Ko) ||
    hasUsableKorean(row.diffKo)
  );
}

export function anchorHasUsableKorean(anchor: CompareKeyAnchorJSON): boolean {
  return hasUsableKorean(anchor.image1Ko) || hasUsableKorean(anchor.image2Ko);
}

export function analysisHasUsableKorean(
  analysis: VisionCompareAnalysisV4,
): boolean {
  if (
    hasUsableKorean(analysis.summaryKo) ||
    analysis.commonPointsKo.some(hasUsableKorean) ||
    analysis.keyDifferencesKo.some(hasUsableKorean) ||
    hasUsableKorean(analysis.transformPromptKo) ||
    hasUsableKorean(analysis.uncertainKo)
  ) {
    return true;
  }

  if (Object.values(analysis.categoryDiffs).some(rowHasUsableKorean)) {
    return true;
  }

  return analysis.keyAnchors.some(anchorHasUsableKorean);
}
