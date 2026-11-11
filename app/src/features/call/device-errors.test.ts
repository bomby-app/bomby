import { Track } from "livekit-client"
import { beforeEach, describe, expect, it, vi } from "vite-plus/test"

import { reportDeviceError } from "./device-errors"

const { invoke, showErrorToast } = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
  showErrorToast: vi.fn(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@/components/error-toast", () => ({ showErrorToast }))

describe("a device error from the call's control bar", () => {
  beforeEach(() => {
    invoke.mockClear()
    showErrorToast.mockClear()
  })

  it("tells the user the mic failed, and logs the raw error", () => {
    reportDeviceError({
      source: Track.Source.Microphone,
      error: new Error("NotReadableError"),
    })
    expect(showErrorToast).toHaveBeenCalledWith(
      "Couldn't use the mic. Check it's connected and allowed?"
    )
    expect(invoke).toHaveBeenCalledWith("app_log", {
      line: "microphone device failed: Error: NotReadableError",
    })
  })

  it("only logs another device's", () => {
    reportDeviceError({ source: Track.Source.Camera, error: new Error("x") })
    expect(showErrorToast).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledOnce()
  })
})
