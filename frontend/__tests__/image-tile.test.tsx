import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import ImageTile from "@/components/ui/ImageTile";

afterEach(() => {
  cleanup();
});

describe("ImageTile", () => {
  it("adds a stable cache key for backend image refs rendered with CORS", () => {
    render(
      <ImageTile
        seed="http://localhost:8001/images/studio/a.png"
        label="server image"
      />,
    );

    const img = screen.getByRole("img", { name: "server image" });

    expect(img).toHaveAttribute(
      "src",
      "http://localhost:8001/images/studio/a.png?__ais_cors=1",
    );
    expect(img).toHaveAttribute("crossorigin", "anonymous");
  });

  it("keeps external image refs unchanged", () => {
    render(<ImageTile seed="https://example.test/a.png" label="external" />);

    const img = screen.getByRole("img", { name: "external" });

    expect(img).toHaveAttribute("src", "https://example.test/a.png");
    expect(img).not.toHaveAttribute("crossorigin");
  });
});
