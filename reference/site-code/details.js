import * as K from '../../constants.js'
import { handURL } from '../cursor.js'

// The open state's panel: title above the card, author below, a link out, and
// the prev/next controls.
//
// ---------------------------------------------------------------------------
// Why this is centred rather than projected per frame
//
// The obvious build projects the card's bounds through the camera every frame
// and positions the DOM to match. Two things make that wrong here.
//
// First, the card is not where the projection says: opening ramps the edge-warp
// pass to u_strength 0.6 and u_scale 1.2, and the DOM does not go through that
// shader. A projected overlay would sit next to the card, not on it, and
// inverting the barrel per frame is a Newton solve on every layout.
//
// Second — and this is the way out — the barrel term is `cc * dot(cc, cc)`,
// which is **zero at the centre of the frame and cubic away from it**. The open
// card is flown to the centre by design. So at the one place this panel lives,
// the warp displacement is ~0 and there is nothing to invert.
//
// So the panel is centred, and the only thing it needs from the scene is how
// tall the open card renders — which is arithmetic, not a projection:
//
//   the camera is at z 1500 and an open card at z 300, so d = 1200
//   fov is set so the visible height at z 0 is canvasH * scaleFactor
//   => px per world unit at d = 1200 is 1.25 / scaleFactor
//
// One multiply, recomputed on open and on resize. No per-frame DOM writes,
// which is what would have janked a budget Android.

// src: Round 2 Task A / Round 4 — navHandsSpaceFromCenter, the offset their two
// nav hands sit at. We ship buttons rather than hand meshes (client decision),
// at the same measured offset so the composition matches.
export const CONTROL_OFFSET_DESKTOP = 520
export const CONTROL_OFFSET_TOUCH = 320

// Gap between the card edge and the type, in px.
export const TYPE_GAP = 26
// Control diameter and the margin it must keep from the frame edge.
export const CONTROL_SIZE = 52
export const PAD = 20

export class DetailsPanel {
  constructor({ world, root = document.body }) {
    this.world = world
    this.item = null
    this.build(root)
  }

  build(root) {
    this.el = document.createElement('div')
    this.el.className = 'world-details'

    this.title = document.createElement('h2')
    this.title.className = 'world-details__title'

    this.meta = document.createElement('div')
    this.meta.className = 'world-details__meta'

    this.author = document.createElement('p')
    this.author.className = 'world-details__author'

    this.caption = document.createElement('p')
    this.caption.className = 'world-details__caption'

    this.cta = document.createElement('a')
    this.cta.className = 'world-details__cta'
    this.cta.textContent = 'View project'

    this.meta.append(this.author, this.caption, this.cta)

    // The way back to browsing.
    //
    // Escape closed the open state and nothing else did — no visible control at
    // all. That is invisible to anyone using a mouse, which is most people, and
    // it is the single thing Yash asked for repeatedly while I kept fixing the
    // INDEX's back button instead. Same pill as the index's, deliberately: two
    // different-looking ways out of two different states is two things to learn.
    this.close = document.createElement('button')
    this.close.type = 'button'
    this.close.className = 'world-details__close'
    this.close.textContent = '← Back to the world'

    // The open photograph itself is the link to its project page.
    //
    // It cannot be a handler on the canvas: while a card is open the surface is
    // pointer-events:none (measured — that is what gates the drag), and the
    // canvas never receives pointer events either. So the hit target is a real
    // anchor laid over the card's screen rect, which also means it is a link a
    // keyboard can tab to and a screen reader announces, rather than a click
    // handler on a <canvas> that neither can find.
    this.hit = document.createElement('a')
    this.hit.className = 'world-details__hit'

    this.prev = this.control('prev', 'Previous project')
    this.next = this.control('next', 'Next project')

    this.el.append(this.title, this.meta, this.hit, this.prev, this.next)
    root.append(this.el)
    // The close pill lives on the BODY, not inside the panel. The panel is
    // pointer-events:none with its own 461ms opacity fade, so a control nested
    // in it inherits that compositing (it measured opacity 0 while visible) and
    // gets laid out by the panel's centring grid — it came out 70x115 at
    // left:-35, a squeezed strip off the left edge. Outside, it is just a pill.
    root.append(this.close)

    // The open item changing is a content change a screen reader must hear, and
    // the panel itself is not a live region (its own arrival would announce).
    this.status = document.getElementById('world-status')
  }

  control(kind, label) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `world-details__nav world-details__nav--${kind}`
    b.setAttribute('aria-label', label)
    // The reference flanks its open card with two pointing hands at this exact
    // offset. Ours are buttons (client decision — a hand mesh is not a control
    // a keyboard or a screen reader can reach), but they carry the same hand.
    // Mirrored for prev so both point the way they travel.
    const img = document.createElement('img')
    img.src = handURL('pointer', { flip: kind === 'prev' })
    img.alt = ''
    img.setAttribute('aria-hidden', 'true')
    img.className = 'world-details__hand'
    b.append(img)
    return b
  }

  bind(steps, opener) {
    this.steps = steps
    this.opener = opener
    this.onClose = () => this.opener?.close()
    this.close.addEventListener('click', this.onClose)
    // Clicking the empty field around the card closes it too — the gesture
    // people try first. It cannot live on the world surface: that is
    // pointer-events:none while a card is open (measured, it is what gates the
    // drag), so the panel's own backdrop takes it, and only when the click is
    // the backdrop itself rather than anything sitting on it.
    this.onBackdrop = (e) => { if (e.target === this.el) this.opener?.close() }
    this.el.addEventListener('click', this.onBackdrop)
    this.onPrev = () => steps.prev()
    this.onNext = () => steps.next()
    this.prev.addEventListener('click', this.onPrev)
    this.next.addEventListener('click', this.onNext)
    this.onResize = () => this.layout()
    addEventListener('resize', this.onResize)
  }

  // How tall the open card renders, from the camera arithmetic rather than a
  // projection. See the note at the top.
  layout() {
    const w = this.world
    if (!this.item || !w.scaleFactor) return
    const cell = w.cells.find((c) => c.item === this.item)
    const h = cell ? cell.mesh.geometry.parameters.height : K.CARD_LONG_EDGE
    const pxPerUnit = (K.CAMERA_Z / (K.CAMERA_Z - K.OPEN_Z)) / w.scaleFactor
    const halfPx = (h * K.OPEN_SCALE * pxPerUnit) / 2

    this.el.style.setProperty('--half', `${Math.round(halfPx)}px`)
    // Width too, for the hit target laid over the card. Cards are not square —
    // sizing it from the height alone would leave a wide card's ends dead and
    // overhang a tall one onto the neighbours behind it.
    const wUnits = cell ? cell.mesh.geometry.parameters.width : K.CARD_LONG_EDGE
    const halfW = (wUnits * K.OPEN_SCALE * pxPerUnit) / 2
    this.el.style.setProperty('--half-w', `${Math.round(halfW)}px`)
    this.el.style.setProperty('--gap', `${TYPE_GAP}px`)
    // The measured offset is 520 from centre, which puts the control off-screen
    // for every viewport narrower than ~1120px — including 1024 and 1091, and
    // the next button is the one that takes focus on open. Clamp it to the
    // frame, keeping the measured value wherever it actually fits.
    const wanted = w.touch ? CONTROL_OFFSET_TOUCH : CONTROL_OFFSET_DESKTOP
    const room = w.width / 2 - CONTROL_SIZE - PAD
    this.el.style.setProperty('--control-x', `${Math.min(wanted, Math.max(0, room))}px`)
  }

  show(item) {
    const changed = item !== this.item
    this.item = item
    this.title.textContent = item.title
    this.author.textContent = item.author
    this.caption.textContent = item.show_caption ? item.caption : ''
    this.caption.hidden = !item.show_caption

    // #/work/<slug> now RESOLVES — project-page.js answers those routes — so
    // the CTA is live. It was hidden while nothing served them, on the grounds
    // that a button which looks live and goes nowhere is worse than one that
    // says so; that reason is gone.
    this.cta.href = item.link || '#'
    this.cta.hidden = !item.link
    this.hit.href = item.link || '#'
    this.hit.setAttribute('aria-label', `Open project: ${item.title}`)
    this.cta.setAttribute('aria-label', `View project: ${item.title}`)

    this.layout()
    this.el.classList.add('is-on')
    if (changed && this.status) this.status.textContent = `${item.title} — ${item.author}`
  }

  // Focus goes to the panel's own control, never into the DOM index.
  focusFirst() {
    this.next.focus({ preventScroll: true })
  }

  hide() {
    if (!this.item) return
    this.item = null
    this.el.classList.remove('is-on')
    this.title.textContent = ''
    this.author.textContent = ''
    this.caption.textContent = ''
    if (this.status) this.status.textContent = ''
  }

  dispose() {
    this.close.removeEventListener('click', this.onClose)
    // The pill lives on the BODY, not inside this.el, so removing the panel
    // does not take it with it. Left behind, every Lite-mode remount stacked
    // another one and querySelector kept returning the OLDEST — a pill wired to
    // a disposed opener, which looked exactly like a dead button.
    this.close.remove()
    this.el.removeEventListener('click', this.onBackdrop)
    this.prev.removeEventListener('click', this.onPrev)
    this.next.removeEventListener('click', this.onNext)
    removeEventListener('resize', this.onResize)
    this.el.remove()
    this.item = null
  }
}
