'use client'

/**
 * The film.
 *
 * The thesis is not a list of features, so it is not told as cards. It is one
 * continuous shot: a life's payments arrive one at a time, wire themselves
 * into a graph, resolve into things a stranger can say about you out loud —
 * and then get taken apart.
 *
 * It is drawn, not filmed. A generative canvas costs a few kilobytes where a
 * video costs megabytes, it is sharp at every density, it scrubs exactly with
 * the scroll instead of buffering, and it can hold the product's own palette
 * rather than approximating it.
 *
 * The drawing itself lives in `film-engine`; this file is the projector.
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { usePrefersReducedMotion } from '@/lib/hooks/use-motion'
import { buildGraph, clamp01, groundDarkness, paint, ramp } from './film-engine'

/* ------------------------------------------------------------------ */
/* the component                                                       */
/* ------------------------------------------------------------------ */

export interface Beat {
  /** [enter, exit] in film progress, 0..1. */
  at: [number, number]
  /** Beats over the inverted frames need light type. */
  invert?: boolean
  children: ReactNode
}

export function ScrollFilm({ beats, viewports = 7 }: { beats: Beat[]; viewports?: number }) {
  const reduced = usePrefersReducedMotion()
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const beatRefs = useRef<(HTMLDivElement | null)[]>([])

  useEffect(() => {
    const canvas = canvasRef.current
    const track = trackRef.current
    if (!canvas || !track) return
    const context = canvas.getContext('2d')
    if (!context) return

    const graph = buildGraph()
    const fontFamily =
      getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'

    let width = 0
    let height = 0
    const resize = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    // Development affordance: `/?film=0.62` pins a single frame so a beat can
    // be composed against the image it sits on. Production ignores it.
    const pinned =
      process.env.NODE_ENV === 'development'
        ? Number(new URLSearchParams(window.location.search).get('film'))
        : NaN

    let target = 0
    let current = 0
    let lastFrame = 0
    const readScroll = () => {
      const rect = track.getBoundingClientRect()
      const span = rect.height - window.innerHeight
      target = span > 0 ? clamp01(-rect.top / span) : 0
      // Frame callbacks are throttled in backgrounded or occluded tabs. If one
      // has not arrived recently, drop the spring and track the scroll exactly
      // — a film that lags a full act behind the copy is worse than one that
      // scrubs stiffly.
      if (performance.now() - lastFrame > 260) {
        current = target
        render(performance.now())
      }
    }

    let frame = 0

    const applyBeats = (p: number) => {
      beats.forEach((beat, index) => {
        const element = beatRefs.current[index]
        if (!element) return
        const [enter, exit] = beat.at
        const fade = Math.min(0.055, (exit - enter) * 0.34)
        const alpha = ramp(p, enter, enter + fade) * (1 - ramp(p, exit - fade, exit))
        element.style.opacity = `${alpha}`
        element.style.transform = `translate3d(0, ${(1 - alpha) * 18}px, 0)`
        element.style.visibility = alpha < 0.01 ? 'hidden' : 'visible'
      })
    }

    // Anything drawn over the film has to know which ground it is on. A data
    // attribute rather than React state: this changes every frame, and a
    // re-render per frame would be absurd.
    let ground = ''
    const render = (time: number) => {
      paint(context, width, height, current, time, graph, fontFamily)
      applyBeats(current)
      const next = groundDarkness(current) > 0.5 ? 'dark' : 'light'
      if (next !== ground) {
        ground = next
        document.documentElement.dataset.filmGround = next
      }
    }

    if (Number.isFinite(pinned)) {
      const still = () => {
        resize()
        paint(context, width, height, pinned, 0, graph, fontFamily)
      }
      still()
      applyBeats(pinned)
      window.addEventListener('resize', still)
      return () => {
        window.removeEventListener('resize', resize)
        window.removeEventListener('resize', still)
      }
    }

    if (reduced) {
      // No scrub, no loop: draw the frame the film resolves to and pin the
      // copy that goes with it.
      const still = () => {
        resize()
        paint(context, width, height, 0.92, 0, graph, fontFamily)
      }
      still()
      applyBeats(0.92)
      window.addEventListener('resize', still)
      return () => {
        window.removeEventListener('resize', resize)
        window.removeEventListener('resize', still)
      }
    }

    // The spring is the scrub: scroll sets a target, the frame chases it, and
    // the lag is what makes it read as footage rather than as a slider.
    const tick = (time: number) => {
      lastFrame = time
      current += (target - current) * 0.09
      render(time)
      frame = requestAnimationFrame(tick)
    }
    readScroll()
    window.addEventListener('scroll', readScroll, { passive: true })
    current = target
    render(performance.now())
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      delete document.documentElement.dataset.filmGround
      window.removeEventListener('resize', resize)
      window.removeEventListener('scroll', readScroll)
    }
  }, [beats, reduced])

  return (
    <div ref={trackRef} style={{ height: `${viewports * 100}svh` }} className="relative">
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
        <div className="absolute inset-0">
          {beats.map((beat, index) => (
            <div
              key={index}
              ref={(node) => {
                beatRefs.current[index] = node
              }}
              style={{ opacity: 0 }}
              className={`absolute inset-0 flex flex-col items-center justify-start px-6 pt-[9vh] text-center will-change-[opacity,transform] sm:justify-center sm:pt-0 ${
                beat.invert ? 'text-glass-ink' : ''
              }`}
            >
              {/* Copy gets its own ground. The vignette darkens the frame's
                  edges; this clears its middle, and it fades with the beat so
                  the image is never obscured by type that is not there. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `radial-gradient(62% 44% at 50% ${
                    beat.invert ? '50%' : '46%'
                  }, ${
                    beat.invert ? 'var(--color-ink)' : 'var(--color-canvas)'
                  } 30%, transparent 100%)`,
                }}
              />
              <div className="relative">{beat.children}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * One frame of the film, held.
 *
 * The connect screen is the next thing a visitor sees after the film ends, so
 * it ends up looking like a different product unless it carries the same
 * image. This is that image: the closing frame, drawn from the same engine,
 * with no scroll attached to it.
 */
export function FilmStill({
  at = 0.97,
  className = '',
}: {
  at?: number
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return
    const graph = buildGraph()
    const fontFamily = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
    const draw = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (width === 0 || height === 0) return
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      paint(context, width, height, at, 0, graph, fontFamily)
    }
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [at])

  return <canvas ref={canvasRef} className={className} aria-hidden />
}
