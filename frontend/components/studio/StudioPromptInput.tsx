"use client";

import type {
  RefObject,
  TextareaHTMLAttributes,
} from "react";
import Icon from "@/components/ui/Icon";
import PromptHistoryPeek from "@/components/studio/PromptHistoryPeek";
import PromptToolsButtons from "@/components/studio/prompt-tools/PromptToolsButtons";
import PromptToolsResults from "@/components/studio/prompt-tools/PromptToolsResults";
import type { UsePromptToolsReturn } from "@/hooks/usePromptTools";
import type { PromptHistoryMode } from "@/stores/usePromptHistoryStore";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

interface StudioPromptInputProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> {
  value: string;
  onChange: (next: string) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  historyMode?: PromptHistoryMode;
  onHistorySelect?: (prompt: string) => void;
  tools?: UsePromptToolsReturn;
  showTools?: boolean;
  showResults?: boolean;
  showClear?: boolean;
  clearLabel?: string;
}

export default function StudioPromptInput({
  value,
  onChange,
  textareaRef,
  historyMode,
  onHistorySelect,
  tools,
  showTools = true,
  showResults = true,
  showClear = true,
  clearLabel = "프롬프트 비우기",
  className,
  ...textareaProps
}: StudioPromptInputProps) {
  const renderTools = showTools && tools;

  return (
    <>
      <div className="ais-prompt-shell">
        {historyMode && onHistorySelect ? (
          <PromptHistoryPeek mode={historyMode} onSelect={onHistorySelect} />
        ) : null}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={classNames("ais-prompt-textarea", className)}
          {...textareaProps}
        />
        {renderTools ? <PromptToolsButtons tools={tools} /> : null}
        {showClear && value.length > 0 ? (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={clearLabel}
            title={clearLabel}
            className="ais-prompt-clear-icon"
          >
            <Icon name="x" size={12} />
          </button>
        ) : null}
      </div>
      {renderTools && showResults ? <PromptToolsResults tools={tools} /> : null}
    </>
  );
}
