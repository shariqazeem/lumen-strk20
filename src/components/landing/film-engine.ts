/**
 * The film's drawing logic, with no React in it.
 *
 * Kept separate from the component so the act structure can be asserted
 * directly — a scroll-driven canvas is exactly the kind of thing that breaks
 * silently, and screenshots are a poor way to notice.
 */

/* ------------------------------------------------------------------ */
/* the graph                                                           */
/* ------------------------------------------------------------------ */

/** Deterministic: the same life, every visit, on every device. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export interface Cluster {
  /** Normalised centre, roughly -1..1 on both axes. */
  cx: number
  cy: number
  count: number
  /** What a stranger reads off this cluster — the actual output of analysis. */
  inference: string
  /** Where the sentence sits relative to the cluster. */
  side: 'left' | 'right'
  sample: string[]
}

export const CLUSTERS: Cluster[] = [
  {
    cx: -0.62, cy: -0.44, count: 4, side: 'left',
    inference: 'Pays rent on the 1st',
    sample: ['$1,200', '$1,200', '$1,200'],
  },
  {
    cx: 0.54, cy: -0.52, count: 5, side: 'right',
    inference: 'Same employer since March',
    sample: ['+$3,400', '+$3,400', '+$3,400'],
  },
  {
    cx: -0.30, cy: 0.14, count: 9, side: 'left',
    inference: 'Same café, weekday mornings',
    sample: ['$4.50', '$4.50', '$5.25', '$4.50'],
  },
  {
    cx: 0.36, cy: 0.26, count: 4, side: 'right',
    inference: 'Refills a prescription monthly',
    sample: ['$68.00', '$68.00'],
  },
  {
    cx: 0.04, cy: -0.14, count: 7, side: 'right',
    inference: 'Commutes Tue–Thu',
    sample: ['$2.75', '$2.75', '$2.75'],
  },
  {
    cx: -0.66, cy: 0.50, count: 5, side: 'left',
    inference: 'Was in another city on the 14th',
    sample: ['$212.40', '$38.00'],
  },
  {
    cx: 0.62, cy: 0.56, count: 5, side: 'right',
    inference: 'Sends money home every Friday',
    sample: ['$150.00', '$150.00'],
  },
]

export interface Node {
  x: number
  y: number
  r: number
  /** Order of arrival — the film deals them out one at a time. */
  turn: number
  cluster: number
  /** Index within its cluster, so amounts can be thinned to stay legible. */
  slot: number
  label: string
  phase: number
}

export interface Edge {
  a: number
  b: number
  /** Bridges between clusters are the whole point; they draw last and darkest. */
  bridge: boolean
  turn: number
}

export function buildGraph(): { nodes: Node[]; edges: Edge[] } {
  const random = rng(0x10c1e)
  const nodes: Node[] = []

  CLUSTERS.forEach((cluster, index) => {
    for (let i = 0; i < cluster.count; i += 1) {
      const angle = random() * Math.PI * 2
      const radius = 0.05 + random() * 0.13
      nodes.push({
        x: cluster.cx + Math.cos(angle) * radius * 1.35,
        y: cluster.cy + Math.sin(angle) * radius,
        r: 3.2 + random() * 4,
        turn: 0,
        cluster: index,
        slot: i,
        label: cluster.sample[i % cluster.sample.length],
        phase: random() * Math.PI * 2,
      })
    }
  })

  // Arrival order is shuffled on purpose: payments do not show up grouped by
  // meaning. The grouping is something the observer does afterwards.
  const order = nodes.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  order.forEach((nodeIndex, turn) => {
    nodes[nodeIndex].turn = turn / (order.length - 1)
  })

  const edges: Edge[] = []
  // Within a cluster: chain each node to its nearest already-placed sibling.
  CLUSTERS.forEach((_, index) => {
    const members = nodes.map((n, i) => ({ n, i })).filter((m) => m.n.cluster === index)
    for (let i = 1; i < members.length; i += 1) {
      let best = 0
      let bestDistance = Infinity
      for (let j = 0; j < i; j += 1) {
        const dx = members[i].n.x - members[j].n.x
        const dy = members[i].n.y - members[j].n.y
        const d = dx * dx + dy * dy
        if (d < bestDistance) {
          bestDistance = d
          best = j
        }
      }
      edges.push({ a: members[i].i, b: members[best].i, bridge: false, turn: random() })
    }
  })
  // Between clusters: the lines that turn a pile of receipts into a person.
  const bridges: [number, number][] = [[0, 2], [2, 4], [4, 1], [1, 6], [2, 3], [5, 4], [3, 6], [0, 5]]
  for (const [from, to] of bridges) {
    const a = nodes.findIndex((n) => n.cluster === from)
    const b = nodes.findIndex((n) => n.cluster === to)
    if (a >= 0 && b >= 0) edges.push({ a, b, bridge: true, turn: 0.45 + random() * 0.5 })
  }

  return { nodes, edges }
}

/* ------------------------------------------------------------------ */
/* timing                                                              */
/* ------------------------------------------------------------------ */

export const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

/** 0 below `a`, 1 above `b`, eased between. */
export function ramp(value: number, a: number, b: number): number {
  const t = clamp01((value - a) / (b - a || 1))
  return t * t * (3 - 2 * t)
}

/** The act structure, in film progress. */
export const ACT = {
  arrive: [0.04, 0.34] as const,
  wire: [0.30, 0.52] as const,
  name: [0.5, 0.6] as const,
  /** The strike lands before the cut; the cut itself is two frames wide. */
  strike: [0.615, 0.652] as const,
  cut: [0.655, 0.668] as const,
  erase: [0.68, 0.86] as const,
  calm: [0.86, 1.0] as const,
}

/* ------------------------------------------------------------------ */
/* the canvas                                                          */
/* ------------------------------------------------------------------ */

/**
 * How dark the frame's ground is at `p`, 0..1.
 *
 * Exported because the page furniture over the film — the nav, chiefly — has
 * to invert with it or it vanishes for a third of the sequence. It returns to
 * paper before the last act, so the film hands off to the rest of the page on
 * the same ground the page sits on.
 */
export function groundDarkness(p: number): number {
  return ramp(p, ACT.cut[0], ACT.cut[1]) * (1 - ramp(p, 0.855, 0.925))
}

/** Left edge for a run of type beside a cluster, kept inside the frame. */
function place(
  textWidth: number,
  box: { minX: number; maxX: number },
  preferRight: boolean,
  frameWidth: number,
): number {
  const margin = 24
  const gap = 18
  const right = box.maxX + gap
  const left = box.minX - gap - textWidth
  const fitsRight = right + textWidth <= frameWidth - margin
  const fitsLeft = left >= margin
  if (preferRight && fitsRight) return right
  if (!preferRight && fitsLeft) return left
  if (fitsRight) return right
  if (fitsLeft) return left
  return Math.max(margin, Math.min(frameWidth - margin - textWidth, right))
}

/** Screen-space bounds of one cluster, for anchoring type beside it. */
function clusterBox(
  graph: { nodes: Node[] },
  cluster: number,
  project: (node: Node) => number[],
): { minX: number; maxX: number; minY: number } | null {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let found = false
  for (const node of graph.nodes) {
    if (node.cluster !== cluster) continue
    const [x, y] = project(node)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    found = true
  }
  return found ? { minX, maxX, minY } : null
}

export function paint(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  p: number,
  time: number,
  graph: { nodes: Node[]; edges: Edge[] },
  fontFamily: string,
) {
  const dark = groundDarkness(p)
  // A hard flip, matched to the cut: nothing is ever read on a grey ground.
  const onDark = dark > 0.5
  const erased = ramp(p, ACT.erase[0], ACT.erase[1])

  // Ground.
  const ink = [18, 18, 20]
  const paper = [243, 242, 240]
  const mix = (a: number, b: number) => Math.round(a + (b - a) * dark)
  context.fillStyle = `rgb(${mix(paper[0], ink[0])},${mix(paper[1], ink[1])},${mix(paper[2], ink[2])})`
  context.fillRect(0, 0, width, height)

  const foreground = onDark ? [245, 244, 248] : [18, 18, 20]
  const fg = (alpha: number) =>
    `rgba(${foreground[0]},${foreground[1]},${foreground[2]},${Math.max(0, Math.min(1, alpha))})`

  // Camera: a slow push in, then a pull back once the graph comes apart. The
  // graph is wider than it is tall, so height sets the framing on a desktop
  // and width takes over on a phone.
  // Seven sentences anchored to seven clusters is a wall on a phone. Narrow
  // frames get the graph up top and the sentences underneath, one at a time.
  const narrow = width < 760
  const fit = narrow ? width * 0.42 : Math.min(height * 0.62, width * 0.44)
  const scale = fit * (1 + ramp(p, 0, ACT.name[1]) * 0.08 - ramp(p, ACT.erase[0], 1) * 0.1)
  // Points keep their weight relative to the frame they sit in.
  const dot = Math.max(0.55, scale / 560)
  const cx = width / 2
  const cy = height * (narrow ? 0.46 : 0.5)
  const project = (node: Node) => {
    // Drift keeps the frame alive while the page is still; once erased, the
    // graph loosens and the points wander apart.
    const loosen = erased * 0.16
    const wander = Math.sin(time * 0.00022 + node.phase) * (0.006 + loosen)
    const wanderY = Math.cos(time * 0.00019 + node.phase * 1.7) * (0.006 + loosen)
    const spread = 1 + erased * 0.22
    return [cx + (node.x * spread + wander) * scale, cy + (node.y * spread + wanderY) * scale]
  }

  const dealt = (node: Node) => ramp(p, ACT.arrive[0] + node.turn * 0.22, ACT.arrive[0] + node.turn * 0.22 + 0.06)

  // Vignette — depth, and it keeps the copy legible over the busiest frames.
  // Every path out of this function ends here.
  const finish = () => {
    const vignette = context.createRadialGradient(
      cx, cy, Math.min(width, height) * 0.16,
      cx, cy, Math.max(width, height) * 0.72,
    )
    const edgeColor = onDark ? '12,12,14' : '243,242,240'
    vignette.addColorStop(0, `rgba(${edgeColor},0)`)
    vignette.addColorStop(0.55, `rgba(${edgeColor},0.1)`)
    vignette.addColorStop(1, `rgba(${edgeColor},0.72)`)
    context.fillStyle = vignette
    context.fillRect(0, 0, width, height)
  }

  // Edges.
  const wired = ramp(p, ACT.wire[0], ACT.wire[1])
  context.lineCap = 'round'
  for (const edge of graph.edges) {
    const a = graph.nodes[edge.a]
    const b = graph.nodes[edge.b]
    const born = clamp01((wired - edge.turn * 0.55) / 0.35)
    const life = born * (1 - erased)
    if (life <= 0.01) continue
    const [ax, ay] = project(a)
    const [bx, by] = project(b)
    context.strokeStyle = fg((edge.bridge ? 0.3 : 0.16) * life * Math.min(dealt(a), dealt(b)))
    context.lineWidth = edge.bridge ? 1.15 : 0.75
    context.beginPath()
    context.moveTo(ax, ay)
    context.lineTo(ax + (bx - ax) * born, ay + (by - ay) * born)
    context.stroke()
  }

  // Nodes.
  for (const node of graph.nodes) {
    const shown = dealt(node)
    if (shown <= 0.01) continue
    const [x, y] = project(node)
    const landing = 1 - Math.pow(1 - shown, 3)
    context.fillStyle = fg(0.9 * shown * (1 - erased * 0.55))
    context.beginPath()
    context.arc(x, y, node.r * dot * landing, 0, Math.PI * 2)
    context.fill()

    // The halo of a payment still settling.
    if (shown < 1) {
      context.strokeStyle = fg(0.22 * (1 - shown))
      context.lineWidth = 1
      context.beginPath()
      context.arc(x, y, node.r * dot + (1 - shown) * 26, 0, Math.PI * 2)
      context.stroke()
    }
  }

  // Amounts — legible while the graph is being read, gone once it is not.
  const amounts = ramp(p, ACT.arrive[0] + 0.04, ACT.wire[0]) * (1 - ramp(p, ACT.name[0] - 0.04, ACT.name[0] + 0.05))
  if (amounts > 0.01 && !narrow) {
    context.font = `500 11px ${fontFamily}`
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    for (const node of graph.nodes) {
      // Every node labelled turned the frame into noise; every other one
      // still reads as a life without becoming a spreadsheet. On a phone
      // there is no room for any of them, and the copy carries it instead.
      if (node.slot % 2 === 1) continue
      const shown = dealt(node)
      if (shown < 0.6) continue
      const [x, y] = project(node)
      context.fillStyle = fg(0.34 * amounts * shown)
      context.fillText(node.label, x + node.r * dot + 6, y)
    }
  }

  // The inferences: the point of the whole sequence. They fade up as the graph
  // finishes wiring and are struck through at the cut.
  const named = ramp(p, ACT.name[0], ACT.name[1])
  const gone = ramp(p, ACT.cut[0], ACT.cut[1])
  if (named > 0.01 && gone < 0.999) {
    context.font = `600 ${Math.max(12.5, Math.min(16, width / 92))}px ${fontFamily}`
    context.textBaseline = 'middle'
    const strike = ramp(p, ACT.strike[0], ACT.strike[1])

    if (narrow) {
      const step = (ACT.name[1] - ACT.name[0]) / CLUSTERS.length
      const lineHeight = 26
      const top = height * 0.68
      context.textAlign = 'left'
      const left = Math.max(24, (width - 300) / 2)
      CLUSTERS.forEach((cluster, index) => {
        const said = ramp(p, ACT.name[0] + index * step, ACT.name[0] + index * step + step * 0.7)
        const alpha = said * (1 - gone)
        if (alpha <= 0.01) return
        const y = top + index * lineHeight
        context.fillStyle = fg(0.9 * alpha)
        context.fillText(cluster.inference, left, y)
        if (strike > 0.01) {
          const w = context.measureText(cluster.inference).width
          context.strokeStyle = fg(0.85 * alpha)
          context.lineWidth = 1.4
          context.beginPath()
          context.moveTo(left, y)
          context.lineTo(left + w * strike, y)
          context.stroke()
        }
      })
      return finish()
    }

    CLUSTERS.forEach((cluster, index) => {
      const box = clusterBox(graph, index, project)
      if (!box) return
      // Anchored past the cluster's own edge, not at its centre — a sentence
      // laid over its own evidence is unreadable, and the sentence is the
      // point of this act.
      const w = context.measureText(cluster.inference).width
      const ty = Math.max(28, box.minY - 16)
      // Preferred side, unless the sentence would run off the frame — the
      // one thing that must never happen to the line the act exists for.
      const x0 = place(w, box, cluster.side === 'right', width)
      context.textAlign = 'left'
      const alpha = named * (1 - gone)
      context.fillStyle = fg(0.9 * alpha)
      context.fillText(cluster.inference, x0, ty)

      if (strike > 0.01) {
        context.strokeStyle = fg(0.85 * alpha)
        context.lineWidth = 1.4
        context.beginPath()
        context.moveTo(x0, ty)
        context.lineTo(x0 + w * strike, ty)
        context.stroke()
      }
    })
  }

  // What is left afterwards: the same account, with nothing to read.
  const redacted = ramp(p, ACT.erase[0] + 0.04, ACT.erase[1]) * (1 - ramp(p, 0.95, 1))
  if (redacted > 0.01 && narrow) {
    const left = Math.max(24, (width - 300) / 2)
    CLUSTERS.forEach((_, index) => {
      context.fillStyle = fg(0.14 * redacted)
      context.beginPath()
      context.roundRect(left, height * 0.68 + index * 26 - 4, 96 + ((index * 23) % 84), 8, 4)
      context.fill()
    })
  } else if (redacted > 0.01) {
    CLUSTERS.forEach((cluster, index) => {
      const box = clusterBox(graph, index, project)
      if (!box) return
      const w = 54 + ((index * 17) % 46)
      const x0 = place(w, box, cluster.side === 'right', width)
      context.fillStyle = fg(0.14 * redacted)
      context.beginPath()
      context.roundRect(x0, Math.max(24, box.minY - 20), w, 8, 4)
      context.fill()
    })
  }

  finish()
}

