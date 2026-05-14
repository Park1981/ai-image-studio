/**
 * ResultBox — 5 모드 결과 박스 통일 base.
 *
 * 외곽 className / 상태 분기 / 0.4s cross-fade / effectOverlay slot 만 담당한다.
 * 모드별 본문은 children 으로 주입한다.
 */

"use client";

import {
  type ForwardedRef,
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import ResultLoadingCanvas from "@/components/studio/ResultLoadingCanvas";
import StudioEmptyState from "@/components/studio/StudioEmptyState";

export type ResultBoxState = "idle" | "loading" | "done";

interface ResultBoxProps
  extends Omit<ComponentPropsWithoutRef<"div">, "children"> {
  state: ResultBoxState;
  variant?: "hero" | "plain";
  modifier?: "edit";
  effectOverlay?: ReactNode;
  emptyState?: ReactNode;
  loadingPlaceholder?: ReactNode;
  loadingLabel?: string;
  children?: ReactNode;
}

const FADE_TRANSITION = { duration: 0.4, ease: "easeInOut" } as const;

function assignRef(ref: ForwardedRef<HTMLDivElement>, value: HTMLDivElement | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    ref.current = value;
  }
}

function defaultLoadingPlaceholder(
  variant: "hero" | "plain",
  modifier?: "edit",
  label?: string,
) {
  return (
    <ResultLoadingCanvas
      variant={variant}
      modifier={modifier}
      label={label}
    />
  );
}

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export const ResultBox = forwardRef<HTMLDivElement, ResultBoxProps>(
  function ResultBox(
    {
      state,
      variant = "hero",
      modifier,
      effectOverlay,
      emptyState,
      loadingPlaceholder,
      loadingLabel,
      children,
      className,
      style,
      ...rest
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [lastStableHeight, setLastStableHeight] = useState<number | null>(null);
    const [[previousState, trackedState], setStatePair] = useState<
      [ResultBoxState, ResultBoxState]
    >([state, state]);
    let transitionFrom = previousState;
    if (trackedState !== state) {
      transitionFrom = trackedState;
      setStatePair([trackedState, state]);
    }
    const fadeTransition = state === "loading" || transitionFrom === "loading";
    const setRootRef = useCallback(
      (node: HTMLDivElement | null) => {
        rootRef.current = node;
        assignRef(ref, node);
      },
      [ref],
    );

    useLayoutEffect(() => {
      const node = rootRef.current;
      if (!node || state === "loading") return;
      const update = () => {
        const nextHeight = Math.round(node.getBoundingClientRect().height);
        if (nextHeight > 0) {
          setLastStableHeight((prev) => (prev === nextHeight ? prev : nextHeight));
        }
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(node);
      return () => ro.disconnect();
    }, [state]);

    const rootClassName =
      variant === "plain"
        ? classNames("ais-result-hero-plain", className)
        : classNames(
            "ais-result-hero",
            modifier === "edit" && "ais-result-hero-edit",
            className,
          );

    const loadingMinHeight =
      state === "loading"
        ? lastStableHeight ?? (modifier === "edit" || variant === "plain" ? 320 : null)
        : null;

    const rootStyle: CSSProperties = {
      display: "grid",
      gridTemplateColumns: "minmax(0, 1fr)",
      gridTemplateRows: "minmax(0, 1fr)",
      placeItems: variant === "hero" && !modifier ? "center" : "stretch",
      ...(loadingMinHeight
        ? { minHeight: loadingMinHeight }
        : null),
      ...style,
    };

    const content =
      state === "done" ? (
        children
      ) : state === "loading" ? (
        <>
          {loadingPlaceholder ??
            defaultLoadingPlaceholder(variant, modifier, loadingLabel)}
          {effectOverlay}
        </>
      ) : (
        <div className="ais-result-state-shell ais-result-empty-shell">
          <div className="ais-result-empty-content">
            {emptyState ?? <StudioEmptyState size="normal" />}
          </div>
        </div>
      );

    return (
      <div
        ref={setRootRef}
        className={rootClassName}
        data-result-state={state}
        data-result-transition={fadeTransition ? "fade" : "instant"}
        style={rootStyle}
        {...rest}
      >
        <AnimatePresence initial={false} mode="sync">
          <motion.div
            key={state}
            initial={{ opacity: fadeTransition ? 0 : 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: fadeTransition ? 0 : 1 }}
            transition={fadeTransition ? FADE_TRANSITION : { duration: 0 }}
            style={{
              gridArea: "1 / 1",
              minWidth: 0,
              width: "100%",
              height:
                state === "loading" || (variant === "hero" && !modifier)
                  ? "100%"
                  : undefined,
              position: "relative",
              display: variant === "hero" && !modifier ? "grid" : "block",
              placeItems: variant === "hero" && !modifier ? "center" : undefined,
            }}
          >
            {content}
          </motion.div>
        </AnimatePresence>
      </div>
    );
  },
);
