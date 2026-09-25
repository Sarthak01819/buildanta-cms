// The web address, derived from the name — and when it is safe to change it.
//
// A slug is a URL. Changing one breaks every link anyone has ever shared, so
// the normal rule is that it is set once and never touched. But a name that has
// only ever been auto-generated has never been a link to anybody: nothing is
// published, nothing is shared, nothing can break. Those are exactly the names
// Yash is about to type over — 58 of them — and leaving them alone would put
// the real portfolio on /work/placeholder-23 for good.
//
// So: derive freely while the slug is still one we made up, and freeze the
// moment it is a real one.
const AUTO = /^(placeholder-\d+|new-project-[a-z0-9]+)$/

export const isAuto = (slug) => AUTO.test(slug || '')

export function slugFrom(title, current) {
  if (!isAuto(current)) return current
  const base = (title || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  // An empty result would violate the not-null constraint with an error nobody
  // could act on. Keep what we had.
  return base || current
}
