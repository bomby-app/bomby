import { Blocks, ListTodo, type LucideProps } from "lucide-react"
import type { SVGProps } from "react"

/** Each extension's icon by id, for Settings and Project settings; a generic one otherwise. */
export function ExtensionIcon({ id, ...props }: { id: string } & LucideProps) {
  switch (id) {
    case "todos":
      return <ListTodo {...props} />
    case "zapier":
      return <ZapierLogo className={props.className} />
    case "composio":
      return <ComposioLogo className={props.className} />
    default:
      return <Blocks {...props} />
  }
}

// The vendors' logos, drawn in `currentColor` so they follow the theme like text (as the
// voice providers' do, features/setup/provider-logos.tsx).

/** Zapier's mark, from its own mask icon (cdn.zapier.com/zapier/images/logo_zapier_black.svg). */
export function ZapierLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        d="M16 0H0v16h16V0Zm-2 11H2v3h12v-3Z"
        fill="currentColor"
      />
    </svg>
  )
}

/** Composio's mark, from its logo (logos.composio.dev/api/composio), without the tile. */
export function ComposioLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="30 22 120 136" aria-hidden="true" {...props}>
      <path
        d="M 91.33 89.96 Q 91.33 91.02 91.31 105.09 A 0.55 0.54 -1.8 0 0 91.90 105.64 Q 113.89 103.94 132.32 102.57 Q 139.29 102.05 141.39 103.41 C 145.82 106.27 146.33 109.09 146.35 114.75 Q 146.39 126.10 146.21 128.71 C 145.93 132.81 143.08 135.16 139.13 136.95 Q 130.98 140.65 103.96 153.18 Q 100.62 154.72 99.36 155.08 A 4.44 4.07 33.5 0 1 98.35 155.24 Q 89.84 155.56 87.63 147.24 A 1.13 1.08 -55.0 0 1 87.58 146.91 L 87.54 132.43 A 0.35 0.35 0.0 0 0 87.12 132.09 Q 78.63 133.82 72.53 135.07 Q 64.01 136.82 60.74 130.55 Q 59.27 127.73 59.43 122.79 Q 59.55 118.99 59.44 112.42 A 0.36 0.35 87.7 0 0 59.07 112.07 L 41.52 112.86 A 2.89 2.77 52.2 0 1 40.50 112.71 Q 36.84 111.43 34.85 108.21 Q 33.74 106.41 33.67 101.11 Q 33.66 100.13 33.66 89.95 Q 33.66 79.78 33.67 78.80 Q 33.74 73.50 34.85 71.70 Q 36.84 68.48 40.50 67.20 A 2.89 2.77 -52.2 0 1 41.52 67.05 L 59.07 67.84 A 0.36 0.35 -87.7 0 0 59.44 67.49 Q 59.55 60.92 59.43 57.12 Q 59.27 52.18 60.74 49.36 Q 64.01 43.09 72.53 44.84 Q 78.63 46.09 87.12 47.82 A 0.35 0.35 0.0 0 0 87.54 47.48 L 87.59 33.00 A 1.13 1.08 55.0 0 1 87.64 32.67 Q 89.85 24.36 98.36 24.68 A 4.44 4.07 -33.5 0 1 99.37 24.84 Q 100.63 25.20 103.97 26.74 Q 130.99 39.27 139.13 42.97 C 143.08 44.76 145.93 47.11 146.21 51.21 Q 146.39 53.82 146.35 65.17 C 146.33 70.83 145.82 73.65 141.39 76.51 Q 139.29 77.87 132.32 77.35 Q 113.89 75.98 91.90 74.28 A 0.55 0.54 1.8 0 0 91.31 74.82 Q 91.33 88.90 91.33 89.96 Z M 92.09 52.71 A 0.62 0.62 0.0 0 0 91.35 53.32 L 91.32 69.91 A 0.72 0.72 0.0 0 0 91.99 70.63 Q 119.75 72.54 134.79 73.80 Q 137.89 74.06 139.12 73.41 C 142.93 71.39 143.23 67.45 142.59 63.55 A 0.78 0.77 1.8 0 0 141.98 62.90 L 92.09 52.71 Z M 63.95 72.35 A 0.61 0.61 0.0 0 0 63.30 72.96 L 63.30 106.95 A 0.61 0.61 0.0 0 0 63.95 107.56 L 86.97 106.00 A 0.61 0.61 0.0 0 0 87.54 105.39 L 87.54 74.47 A 0.61 0.61 0.0 0 0 86.97 73.86 L 63.95 72.35 Z M 92.11 127.16 L 141.95 117.07 A 0.78 0.77 -1.7 0 0 142.56 116.43 C 143.20 112.53 142.91 108.60 139.11 106.57 Q 137.88 105.92 134.78 106.18 Q 119.76 107.41 92.04 109.27 A 0.72 0.72 0.0 0 0 91.37 109.99 L 91.37 126.55 A 0.62 0.62 0.0 0 0 92.11 127.16 Z"
        fill="currentColor"
      />
    </svg>
  )
}
