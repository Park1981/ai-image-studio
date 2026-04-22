/**
 * useToastStore - 전역 토스트 알림.
 * 우측 하단에서 쌓이며, 자동으로 타이머 만료 시 제거.
 */

"use client";

import { create } from "zustand";

export type ToastKind = "info" | "success" | "error" | "warn";

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  desc?: string;
  /** ms, 0이면 수동 닫기 전용 */
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ duration, ...rest }) => {
    const id = `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const d = duration ?? 3800;
    set((s) => ({ toasts: [...s.toasts, { id, duration: d, ...rest }] }));
    if (d > 0) {
      setTimeout(() => get().dismiss(id), d);
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** 편의 함수 */
export const toast = {
  info: (title: string, desc?: string) =>
    useToastStore.getState().push({ kind: "info", title, desc }),
  success: (title: string, desc?: string) =>
    useToastStore.getState().push({ kind: "success", title, desc }),
  warn: (title: string, desc?: string) =>
    useToastStore.getState().push({ kind: "warn", title, desc }),
  error: (title: string, desc?: string) =>
    useToastStore.getState().push({ kind: "error", title, desc, duration: 6000 }),
};
