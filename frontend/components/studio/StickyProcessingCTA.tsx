"use client";

import type { ComponentProps } from "react";
import ProcessingCTA from "@/components/studio/ProcessingCTA";

type StickyProcessingCTAProps = ComponentProps<typeof ProcessingCTA>;

export default function StickyProcessingCTA(props: StickyProcessingCTAProps) {
  return (
    <div className="ais-cta-sticky-top">
      <ProcessingCTA {...props} />
    </div>
  );
}
