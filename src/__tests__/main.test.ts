import { describe, expect, it, vi } from "vitest";
import { openAbsolutePathWithShell } from "../utils/openDefaultApp";

describe("openAbsolutePathWithShell", () => {
  it("succeeds when Electron reports no error", async () => {
    const shell = {
      openPath: vi.fn().mockResolvedValue(""),
    };

    await expect(openAbsolutePathWithShell("/tmp/paper.pdf", shell)).resolves.toBeUndefined();
    expect(shell.openPath).toHaveBeenCalledWith("/tmp/paper.pdf");
  });

  it("throws when Electron returns an error string", async () => {
    const shell = {
      openPath: vi.fn().mockResolvedValue("No application is associated with this file."),
    };

    await expect(openAbsolutePathWithShell("/tmp/paper.pdf", shell)).rejects.toThrow(
      "No application is associated with this file.",
    );
  });

  it("propagates thrown shell errors", async () => {
    const shell = {
      openPath: vi.fn().mockRejectedValue(new Error("boom")),
    };

    await expect(openAbsolutePathWithShell("/tmp/paper.pdf", shell)).rejects.toThrow("boom");
  });
});
