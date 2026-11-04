/**
 * The empty top strip of a sidebar on macOS, where the traffic lights sit (overlay title
 * bar). It drags the window. Other platforms have a native title bar, so it hides there.
 * Starts 8px below the window top (sidebar padding) to line up with trafficLightPosition.
 */
export function TitlebarSpacer() {
  return (
    <div
      data-tauri-drag-region
      className="hidden h-titlebar shrink-0 macos:block"
    />
  )
}
