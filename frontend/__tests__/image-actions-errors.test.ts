import { describe, expect, it } from "vitest";
import { formatImageFileError } from "@/lib/image-actions";

describe("formatImageFileError", () => {
  it("maps known loadImageFile error codes to one Korean copy set", () => {
    expect(formatImageFileError(new Error("not-image"))).toBe(
      "이미지 파일만 업로드할 수 있습니다.",
    );
    expect(formatImageFileError(new Error("image-load-failed"))).toBe(
      "이미지 로드 실패",
    );
    expect(formatImageFileError(new Error("image-decode-failed"))).toBe(
      "이미지 로드 실패",
    );
    expect(formatImageFileError(new Error("file-read-failed"))).toBe(
      "파일 읽기 실패",
    );
  });

  it("falls back to the generic file-read copy for unknown errors", () => {
    expect(formatImageFileError(new Error("unknown"))).toBe("파일 읽기 실패");
    expect(formatImageFileError("unknown")).toBe("파일 읽기 실패");
  });
});
