// The project page.
//
// Every one of the 58 items already carries `link: "#/work/<slug>"`, and until
// now nothing answered those URLs — the details panel hid its CTA precisely
// because the link went nowhere. This is what they open.
//
// A HASH route, not a path. The preview has to survive as one file opened from
// disk with no server, so there is nothing to rewrite /work/x onto index.html;
// a path route 404s the moment it is reloaded or shared. The hash also means
// the back button works for free, which is the thing people actually reach for.
//
// The world keeps running behind it by design — the scene is expensive to build
// and tearing it down to look at a page would cost a full remount on the way
// back. It is paused instead (see main.js), so it costs nothing while hidden.

import { drawPlaceholder } from './placeholder.js'

export const slugOf = (item) => (item.link || '').split('/').pop()

// #/work/<slug> -> slug, anything else -> null.
export function routeOf(hash = location.hash) {
  const m = /^#\/work\/([a-z0-9-]+)$/i.exec(hash || '')
  return m ? m[1] : null
}

// Video slots hand an .mp4 to this, so pick the medium by the item's TYPE, not
// by its file extension — the single-file inliner rewrites the extension away
// and an <img> pointed at a video is a broken glyph. Same trap as the index.
// `ratio` reserves the item's own aspect inline, which stops the page jumping
// as each file decodes. The gallery passes false: it crops every shot to a
// shared 4:3 in CSS, and an INLINE aspect-ratio beats a stylesheet rule, so
// leaving it on left one portrait uncropped and towering over its row.
function media(item, { eager = false, ratio = true } = {}) {
  const [w, h] = item.image_size
  if (item.type === 'video' && item.file) {
    const v = document.createElement('video')
    v.src = item.file
    v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '')
    v.autoplay = true
    v.width = w; v.height = h
    if (ratio) v.style.aspectRatio = `${w} / ${h}`
    return v
  }
  const img = document.createElement('img')
  img.src = item.file || drawPlaceholder(item).toDataURL('image/png')
  img.alt = item.file ? `${item.title} by ${item.author}` : ''
  img.width = w; img.height = h
  if (ratio) img.style.aspectRatio = `${w} / ${h}`
  img.loading = eager ? 'eager' : 'lazy'
  img.decoding = 'async'
  return img
}

export class ProjectPage {
  constructor({ items, root = document.body, onClose, onOpenItem }) {
    this.items = items
    this.onClose = onClose
    this.onOpenItem = onOpenItem
    this.build(root)
  }

  build(root) {
    const el = document.createElement('article')
    el.className = 'project'
    el.id = 'project'
    el.hidden = true
    // A page, not a decoration: it takes the document's main heading and is
    // announced when it arrives.
    el.setAttribute('role', 'region')
    el.setAttribute('aria-label', 'Project')
    el.tabIndex = -1
    this.el = el

    const bar = document.createElement('div')
    bar.className = 'project__bar'
    this.back = document.createElement('button')
    this.back.type = 'button'
    this.back.className = 'project__back'
    this.back.textContent = '← Back to the world'
    bar.append(this.back)

    this.hero = document.createElement('div')
    this.hero.className = 'project__hero'

    this.title = document.createElement('h1')
    this.title.className = 'project__title'

    this.meta = document.createElement('p')
    this.meta.className = 'project__meta'

    this.body = document.createElement('div')
    this.body.className = 'project__body'

    this.gallery = document.createElement('div')
    this.gallery.className = 'project__gallery'

    this.nextWrap = document.createElement('div')
    this.nextWrap.className = 'project__next'

    el.append(bar, this.hero, this.title, this.meta, this.body, this.gallery, this.nextWrap)
    root.append(el)

    this.onBack = () => this.close()
    this.back.addEventListener('click', this.onBack)
    this.onKey = (e) => { if (e.key === 'Escape' && !this.el.hidden) this.close() }
    addEventListener('keydown', this.onKey)
  }

  // Placeholder copy, deliberately obvious. Real project copy replaces this;
  // lorem ipsum would look finished and quietly ship.
  paragraphs(item) {
    return [
      `${item.caption || 'Replace with real project copy.'} This paragraph is placeholder text for ${item.title} — swap it for the brief, the constraint and what changed as a result.`,
      'A second paragraph carries the middle of the story: what was tried, what was measured, what was thrown away. Two or three of these is usually the whole case study.'
    ]
  }

  // The three cards after this one, wrapping — the same next-project move the
  // world makes, so the two navigations agree.
  related(i) {
    return [1, 2, 3].map((k) => this.items[(i + k) % this.items.length])
  }

  show(slug) {
    const i = this.items.findIndex((it) => slugOf(it) === slug)
    if (i < 0) return false
    const item = this.items[i]
    this.item = item
    this.index = i

    this.hero.replaceChildren(media(item, { eager: true }))
    this.title.textContent = item.title
    this.meta.textContent = `By ${item.author}`
    this.body.replaceChildren(...this.paragraphs(item).map((t) => {
      const p = document.createElement('p'); p.textContent = t; return p
    }))
    this.gallery.replaceChildren(...this.related(i).map((it) => {
      const fig = document.createElement('figure')
      fig.className = 'project__shot'
      fig.append(media(it, { ratio: false }))
      return fig
    }))

    const next = this.items[(i + 1) % this.items.length]
    this.nextWrap.replaceChildren()
    const label = document.createElement('span')
    label.className = 'project__next-label'
    label.textContent = 'Next project'
    const a = document.createElement('a')
    a.className = 'project__next-link'
    a.href = next.link
    a.textContent = next.title
    this.nextWrap.append(label, a)

    // The accent drives the page the way it drives the open state, so a project
    // page feels like the card it came from.
    this.el.style.setProperty('--accent', item.color)
    this.el.hidden = false
    document.documentElement.classList.add('world-project')
    // Top of the page, not wherever the world was scrolled to.
    scrollTo({ top: 0, behavior: 'auto' })
    this.el.focus({ preventScroll: true })
    return true
  }

  close() {
    if (this.el.hidden) return
    // Go through history so the back button and this button agree — setting
    // location.hash directly here would push ANOTHER entry and make Back walk
    // through every project page the visitor opened.
    if (routeOf()) history.pushState(null, '', location.pathname + location.search)
    this.hide()
    this.onClose?.()
  }

  hide() {
    this.el.hidden = true
    document.documentElement.classList.remove('world-project')
    // Detach media so a hidden page is not decoding video in the background.
    this.hero.replaceChildren()
    this.gallery.replaceChildren()
    this.item = null
  }

  dispose() {
    this.back.removeEventListener('click', this.onBack)
    removeEventListener('keydown', this.onKey)
    this.el.remove()
  }
}
