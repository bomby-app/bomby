import { useReducedMotion } from "motion/react"
import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

const VERTEX = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`

// Grey noise around mid-grey, which overlay blending leaves unchanged on average: two
// hashes averaged give the softer, bell-shaped spread of film grain rather than static.
const FRAGMENT = `
precision mediump float;
uniform float u_seed;
uniform float u_size;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32 + u_seed);
  return fract(p.x * p.y);
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy / u_size);
  float grain = (hash(cell) + hash(cell + 17.13)) * 0.5;
  gl_FragColor = vec4(vec3(grain), 1.0);
}
`

/** Film runs at 24 frames a second; so does the grain. */
const FRAME_MS = 1000 / 24

function shader(gl: WebGLRenderingContext, type: number, source: string) {
  const compiled = gl.createShader(type)
  if (!compiled) return null
  gl.shaderSource(compiled, source)
  gl.compileShader(compiled)
  return gl.getShaderParameter(compiled, gl.COMPILE_STATUS) ? compiled : null
}

/** Draws grain into `element` until the returned function stops it. */
function startGrain(element: HTMLCanvasElement, still: boolean): () => void {
  const gl = element.getContext("webgl", { antialias: false, alpha: false })
  if (!gl) return () => {}
  const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) return () => {}
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.useProgram(program)

  // Two triangles covering the canvas.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  )
  const position = gl.getAttribLocation(program, "a_position")
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const seed = gl.getUniformLocation(program, "u_seed")
  const size = gl.getUniformLocation(program, "u_size")

  // Grain about a CSS pixel and a half across, at the screen's own resolution.
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const resize = () => {
    element.width = Math.round(element.clientWidth * ratio)
    element.height = Math.round(element.clientHeight * ratio)
    gl.viewport(0, 0, element.width, element.height)
    gl.uniform1f(size, 1.5 * ratio)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(element)
  resize()

  const draw = () => {
    gl.uniform1f(seed, Math.random() * 100)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }
  let frame = 0
  let last = 0
  const tick = (now: number) => {
    if (now - last >= FRAME_MS) {
      last = now
      draw()
    }
    frame = requestAnimationFrame(tick)
  }
  if (still) draw()
  else frame = requestAnimationFrame(tick)

  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
    gl.getExtension("WEBGL_lose_context")?.loseContext()
  }
}

/**
 * A layer of moving film grain over whatever is under it: one WebGL quad, no libraries.
 * Blended with overlay at low opacity, so it textures the colours without greying them.
 * With reduced motion it holds one frame.
 */
export function FilmGrain({ className }: { className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const still = useReducedMotion() === true

  useEffect(() => {
    if (!canvas.current) return
    return startGrain(canvas.current, still)
  }, [still])

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 size-full opacity-[0.09] mix-blend-overlay dark:opacity-[0.12]",
        className
      )}
    />
  )
}
