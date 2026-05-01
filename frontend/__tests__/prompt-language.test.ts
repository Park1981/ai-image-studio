/**
 * Phase 5 후속 (2026-05-01) — prompt-language 휴리스틱 검증.
 */

import { describe, expect, it } from "vitest";
import {
  countPhrases,
  hasEnglish,
  hasKorean,
} from "@/lib/prompt-language";

describe("hasKorean", () => {
  it("한글 음절 1자 이상이면 true", () => {
    expect(hasKorean("안녕")).toBe(true);
    expect(hasKorean("Korean 한국어 mix")).toBe(true);
    expect(hasKorean("ㄱㄴㄷ")).toBe(true);
    expect(hasKorean("a")).toBe(false);
  });

  it("순수 영문 / 빈 문자열 / 숫자 → false", () => {
    expect(hasKorean("")).toBe(false);
    expect(hasKorean("Cat in space")).toBe(false);
    expect(hasKorean("12345")).toBe(false);
    expect(hasKorean("(beautiful:1.2)")).toBe(false);
  });
});

describe("hasEnglish", () => {
  it("영문 알파벳 1자 이상이면 true", () => {
    expect(hasEnglish("Cat")).toBe(true);
    expect(hasEnglish("한국 woman")).toBe(true);
    expect(hasEnglish("a")).toBe(true);
  });

  it("순수 한글 / 빈 / 숫자 → false", () => {
    expect(hasEnglish("")).toBe(false);
    expect(hasEnglish("안녕하세요")).toBe(false);
    expect(hasEnglish("12345")).toBe(false);
  });
});

describe("countPhrases", () => {
  it("comma 로 분리된 phrase 개수", () => {
    expect(countPhrases("a, b, c")).toBe(3);
    expect(countPhrases("single phrase")).toBe(1);
    expect(countPhrases("")).toBe(0);
    expect(countPhrases("   ")).toBe(0);
  });

  it("빈 phrase / 공백만 phrase 는 skip", () => {
    expect(countPhrases("a, , b,  ")).toBe(2);
    expect(countPhrases(",,,")).toBe(0);
  });

  it("newline 도 phrase 분리자", () => {
    expect(countPhrases("a\nb\nc")).toBe(3);
    expect(countPhrases("a, b\nc, d")).toBe(4);
  });
});
