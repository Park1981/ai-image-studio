/**
 * CompareSliderViewer — V4 BeforeAfter 슬라이더 wrap.
 * spec §5.3.2: horizontal wipe 슬라이더 + letterbox + A/B 라벨.
 *
 * 기존 BeforeAfterSlider 컴포넌트 재사용 + Compare 시그니처 (labelVariant="ab" + A/B 라벨).
 * autoMatchAspect=true 로 두 이미지 비율 미세 차이 (~15% 이내) 자동 보정.
 */

"use client";

import BeforeAfterSlider from "@/components/studio/BeforeAfterSlider";

interface Props {
  image1Url: string;
  image2Url: string;
}

export default function CompareSliderViewer({ image1Url, image2Url }: Props) {
  return (
    <BeforeAfterSlider
      beforeSrc={image1Url}
      afterSeed="compare-after"
      afterSrc={image2Url}
      labelVariant="ab"
      beforeLabel="A"
      afterLabel="B"
      beforeFit="contain"
      afterFit="contain"
      autoMatchAspect
      maxHeight="60vh"
    />
  );
}
