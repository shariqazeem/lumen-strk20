// @vitest-environment node

/**
 * A scroll-driven canvas fails quietly: nothing throws, the frame just stops
 * saying what it was supposed to say. These assertions pin the act structure
 * itself — that payments arrive, that lines get drawn between them, that the
 * inferences appear and are struck through, that the frame inverts at the cut,
 * and that what is left afterwards reads as nothing.
 */

import { describe, expect, it } from 'vitest'
import { ACT, buildGraph, CLUSTERS, paint, ramp } from '../film-engine'

/** Records what a frame drew, instead of drawing it. */
function recorder() {
  const calls = {
    fills: [] as string[],
    strokes: [] as string[],
    arcs: 0,
    texts: [] as string[],
    rects: [] as string[],
    rounded: 0,
  }
  let fillStyle = ''
  let strokeStyle = ''
  const context = {
    set fillStyle(value: string) {
      fillStyle = value
    },
    get fillStyle() {
      return fillStyle
    },
    set strokeStyle(value: string) {
      strokeStyle = value
    },
    get strokeStyle() {
      return strokeStyle
    },
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect: () => calls.rects.push(fillStyle),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {
      calls.arcs += 1
    },
    roundRect: () => {
      calls.rounded += 1
    },
    fill: () => calls.fills.push(fillStyle),
    stroke: () => calls.strokes.push(strokeStyle),
    fillText: (text: string) => calls.texts.push(text),
    measureText: (text: string) => ({ width: text.length * 7 }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    setTransform: () => {},
  }
  return { context: context as unknown as CanvasRenderingContext2D, calls }
}

/** One frame at film progress `p`. */
function frame(p: number) {
  const { context, calls } = recorder()
  paint(context, 1440, 900, p, 0, graph, 'sans-serif')
  return calls
}

const graph = buildGraph()

describe('the graph', () => {
  it('deals every payment out exactly once, in a shuffled order', () => {
    const turns = graph.nodes.map((n) => n.turn)
    expect(new Set(turns).size).toBe(graph.nodes.length)
    expect(Math.min(...turns)).toBe(0)
    expect(Math.max(...turns)).toBe(1)
    // Shuffled: arrival order must not track cluster order, or the film would
    // show payments conveniently pre-grouped by meaning.
    const byCluster = graph.nodes.map((n) => n.cluster)
    const sorted = [...byCluster].sort((a, b) => a - b)
    const inOrder = graph.nodes
      .slice()
      .sort((a, b) => a.turn - b.turn)
      .map((n) => n.cluster)
    expect(inOrder).not.toEqual(sorted)
  })

  it('bridges between clusters — the lines that make the graph a person', () => {
    expect(graph.edges.some((e) => e.bridge)).toBe(true)
    for (const edge of graph.edges) {
      if (!edge.bridge) {
        expect(graph.nodes[edge.a].cluster).toBe(graph.nodes[edge.b].cluster)
      }
    }
  })

  it('is identical on every build — the same life, every visit', () => {
    const again = buildGraph()
    expect(again.nodes.map((n) => [n.x, n.y, n.turn])).toEqual(
      graph.nodes.map((n) => [n.x, n.y, n.turn]),
    )
  })
})

describe('the acts', () => {
  it('opens nearly empty', () => {
    expect(frame(0.01).arcs).toBeLessThan(4)
  })

  it('fills with payments as they arrive', () => {
    const early = frame(0.1).arcs
    const late = frame(ACT.arrive[1]).arcs
    expect(late).toBeGreaterThan(early)
    expect(late).toBeGreaterThanOrEqual(graph.nodes.length)
  })

  it('draws amounts while the graph is being read, and not after', () => {
    expect(frame(0.26).texts.length).toBeGreaterThan(6)
    expect(frame(0.8).texts).toHaveLength(0)
  })

  it('wires the payments together', () => {
    expect(frame(0.2).strokes.length).toBeLessThan(frame(ACT.wire[1]).strokes.length)
  })

  it('says out loud what the graph knows', () => {
    const said = frame(ACT.name[1]).texts
    for (const cluster of CLUSTERS) expect(said).toContain(cluster.inference)
  })

  it('inverts the frame at the cut, and only there', () => {
    const paper = /rgb\(24[0-9],/
    expect(frame(0.5).rects[0]).toMatch(paper)
    expect(frame(0.68).rects[0]).not.toMatch(paper)
    expect(frame(0.99).rects[0]).toMatch(paper)
  })

  it('strikes the sentences through before the cut, not after', () => {
    // The strike has to land while there is still something to strike; once
    // the frame cuts to black the sentences are already gone.
    const striking = frame(ACT.strike[0] + 0.01)
    expect(striking.texts.length).toBeGreaterThan(0)
    expect(striking.strokes.length).toBeGreaterThan(0)
    expect(ACT.strike[1]).toBeLessThanOrEqual(ACT.cut[0])
    expect(frame(ACT.cut[1]).texts).toHaveLength(0)
  })

  it('cuts rather than dissolves — no frame is read on grey', () => {
    const grey = (fill: string) => {
      const [r] = fill.match(/\d+/g)!.map(Number)
      return r > 70 && r < 200
    }
    for (let p = ACT.cut[0] - 0.1; p <= ACT.cut[1] + 0.1; p += 0.004) {
      const bg = frame(p).rects[0]
      // The crossfade is allowed to pass through grey, but only for the two
      // frames the cut itself occupies.
      if (grey(bg)) expect(p).toBeGreaterThan(ACT.cut[0] - 0.001)
      if (grey(bg)) expect(p).toBeLessThan(ACT.cut[1] + 0.001)
    }
  })

  it('leaves redaction bars where the sentences were', () => {
    expect(frame(ACT.name[1]).rounded).toBe(0)
    expect(frame(ACT.erase[1]).rounded).toBe(CLUSTERS.length)
  })

  it('never leaves a frame blank between the first payment and the last', () => {
    for (let p = ACT.arrive[0] + 0.06; p <= 1; p += 0.02) {
      expect(frame(p).arcs).toBeGreaterThan(0)
    }
  })
})

describe('ramp', () => {
  it('clamps and eases', () => {
    expect(ramp(-1, 0, 1)).toBe(0)
    expect(ramp(2, 0, 1)).toBe(1)
    expect(ramp(0.5, 0, 1)).toBe(0.5)
    expect(ramp(0.25, 0, 1)).toBeLessThan(0.25)
  })
})
