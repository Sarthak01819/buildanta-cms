import React from 'react'
import { mediaUrl } from './supabase.js'

// What this project will look like on the website.
//
// Two views, because they answer different questions. The grid card answers
// "is this the right photo and shape". The open state answers "what does this
// colour actually DO" — which is the one thing a colour swatch cannot tell you,
// since the accent tints the entire page around the photo when a visitor opens
// it.
//
// Approximated in CSS rather than by running the real WebGL world. The world is
// a heavy scene and a third one inside the admin would cost more than it
// teaches; what matters here is shape, photo and colour, and those are honest
// in CSS. It is labelled as a preview so nobody mistakes it for the real thing.
export default function CardPreview({ item, media }) {
  const src = media?.storage_path ? mediaUrl(media.storage_path) : null
  const isVideo = media?.kind === 'video'
  const accent = item.accent || '#888888'
  const ratio = media ? `${media.width} / ${media.height}` : '4 / 3'

  const Media = ({ style }) => {
    if (!src) return <div style={{ ...style, display: 'grid', placeItems: 'center',
      color: '#666', fontSize: 12, background: '#141416' }}>no photo yet</div>
    return isVideo
      ? <video src={src} muted loop playsInline autoPlay style={style} />
      : <img src={src} alt="" style={style} />
  }

  return (
    <div>
      {/* ---- among the other projects ---- */}
      <div className="prev">
        <div className="prev__label">Among the other projects</div>
        <div className="prev__stage">
          <Media style={{ width: '68%', aspectRatio: ratio, objectFit: 'cover',
            display: 'block', margin: '0 auto' }} />
        </div>
        <p className="prev__note">
          {media
            ? `Your photo is ${media.width > media.height ? 'wide' : media.width < media.height ? 'tall' : 'square'} — the card matches its shape.`
            : 'Add a photo and the card takes its shape.'}
        </p>
      </div>

      {/* ---- when someone opens it ---- */}
      <div className="prev" style={{ marginTop: 14 }}>
        <div className="prev__label">When someone opens it</div>
        <div className="prev__stage prev__stage--open">
          {/* The neighbours, striped in this project's colour. That striping is
              the effect the colour drives, and it is why the swatch alone is
              not enough to judge it. */}
          <div className="prev__side" style={{ background:
            `repeating-linear-gradient(180deg, ${accent} 0 2px, #000 2px 5px)` }} />
          <Media style={{ width: '52%', aspectRatio: ratio, objectFit: 'cover', display: 'block' }} />
          <div className="prev__side" style={{ background:
            `repeating-linear-gradient(180deg, ${accent} 0 2px, #000 2px 5px)` }} />
        </div>
        <div className="prev__caption">
          <strong>{item.title || 'Untitled'}</strong>
          <span>{item.author || 'Buildanta'}</span>
          {item.show_caption && item.caption && <em>{item.caption}</em>}
        </div>
        <p className="prev__note">
          Everything around the photo glows in this colour.
        </p>
      </div>
    </div>
  )
}
