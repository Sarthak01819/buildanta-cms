// Uploading, and the two things the admin must get right about a file.
//
// 1. Its REAL pixel dimensions. Card geometry downstream is built from the
//    declared size, not from the file, so a 16:9 photo in a slot declared
//    512x512 is silently squashed. Yash chose auto-fit: read the truth here and
//    store it, and the card reshapes to the art instead.
// 2. Its accent. Derived the same way the world's own tool does it — mean hue
//    of the image, pushed to signal saturation — and editable afterwards.
import { supabase } from './supabase.js'

export function readImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not decode that image'))
    img.src = URL.createObjectURL(file)
  })
}

export function readVideo(file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(v)
    v.onerror = () => reject(new Error('could not read that video'))
    v.src = URL.createObjectURL(file)
  })
}

// Mean hue of the image, at fixed saturation and lightness.
//
// Averaging the hue as an ANGLE would put the midpoint of 350° and 10° at 180°
// — the opposite colour — so it is averaged as a vector, weighted by how
// saturated and bright each pixel is. Near-black pixels carry hue that is
// mostly sensor noise and would drag the answer around.
export function accentFrom(img) {
  const c = document.createElement('canvas')
  const N = 64
  c.width = N; c.height = N
  const g = c.getContext('2d', { willReadFrequently: true })
  g.drawImage(img, 0, 0, N, N)
  const { data } = g.getImageData(0, 0, N, N)

  let x = 0, y = 0, w = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, gg = data[i + 1] / 255, b = data[i + 2] / 255
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn
    if (d < 0.02) continue
    let h
    if (mx === r) h = ((gg - b) / d) % 6
    else if (mx === gg) h = (b - r) / d + 2
    else h = (r - gg) / d + 4
    h = ((h * 60) + 360) % 360
    const weight = d * mx
    x += Math.cos(h * Math.PI / 180) * weight
    y += Math.sin(h * Math.PI / 180) * weight
    w += weight
  }
  // A genuinely grey image has no hue to take; give it a neutral rather than
  // snapping it to red, which is what atan2(0,0) would do.
  if (w < 0.001) return '#8a8a8a'
  const hue = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
  return hslHex(hue, 0.85, 0.5)
}

function hslHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const xx = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const t = h / 60
  const [r, g, b] =
    t < 1 ? [c, xx, 0] : t < 2 ? [xx, c, 0] : t < 3 ? [0, c, xx] :
    t < 4 ? [0, xx, c] : t < 5 ? [xx, 0, c] : [c, 0, xx]
  const hx = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${hx(r)}${hx(g)}${hx(b)}`
}

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// The long edge nothing needs to exceed.
//
// The world draws a card at a few hundred pixels and the opened state at
// roughly half the viewport, so 2000px is already generous on a 5K display. A
// photo straight off a phone is 4000–6000px and 4–8 MB, and every one of those
// megabytes is paid for again by every visitor to the live site — the admin is
// the only place that can stop it, because after this it is just a file in a
// bucket.
const MAX_EDGE = 2000
const JPEG_Q = 0.88

// Re-encode only when it actually helps. Videos are left alone — re-encoding
// one in a browser canvas would be a silent quality massacre.
async function shrink(file, img) {
  const long = Math.max(img.naturalWidth, img.naturalHeight)
  if (long <= MAX_EDGE) return null
  const scale = MAX_EDGE / long
  const w = Math.round(img.naturalWidth * scale)
  const h = Math.round(img.naturalHeight * scale)
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  c.getContext('2d').drawImage(img, 0, 0, w, h)
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', JPEG_Q))
  // A PNG screenshot of flat colour can come out BIGGER as a JPEG. Only take
  // the new one if it is genuinely smaller.
  if (!blob || blob.size >= file.size) return null
  return { blob, w, h }
}

export async function uploadMedia(file, { alt = '' } = {}) {
  const isVideo = /^video\//.test(file.type)
  let width, height, accent = null
  let body = file, mime = file.type

  if (isVideo) {
    const v = await readVideo(file)
    width = v.videoWidth; height = v.videoHeight
  } else {
    const img = await readImage(file)
    width = img.naturalWidth; height = img.naturalHeight
    accent = accentFrom(img)          // from the ORIGINAL, before any re-encode
    const small = await shrink(file, img)
    if (small) {
      body = small.blob; mime = 'image/jpeg'
      width = small.w; height = small.h
    }
  }

  if (!width || !height) throw new Error('that file reported no dimensions')

  // Name it by content, not by the original filename: two people uploading
  // "hero.jpg" a week apart must not collide, and re-uploading the same file
  // should not create a second copy.
  const stamp = Date.now().toString(36)
  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'file'
  // The extension must follow what we are actually storing. A shrunk PNG is a
  // JPEG now, and a file called .png served as image/jpeg is a bug waiting for
  // a strict browser.
  const ext = mime === 'image/jpeg' && body !== file
    ? '.jpg'
    : (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase() || (isVideo ? '.mp4' : '.jpg')
  const path = `art/${base}-${stamp}${ext}`

  const { error: upErr } = await supabase.storage.from('media').upload(path, body, {
    cacheControl: '31536000',
    contentType: mime
  })
  if (upErr) throw upErr

  const { data, error } = await supabase.from('media').insert({
    storage_path: path,
    kind: isVideo ? 'video' : 'image',
    mime,
    width, height,
    bytes: body.size,
    accent,
    alt
  }).select().single()

  if (error) {
    // Do not leave an orphan in the bucket when the row fails.
    await supabase.storage.from('media').remove([path])
    throw error
  }
  return data
}
