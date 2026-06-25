import { useEffect } from 'react'

// Lightweight, dependency-free per-route head manager. Sets the document title,
// meta description, canonical link, and og/twitter title+description+url when a
// page mounts. This is what search engines that render JS (Google) and the
// browser tab/bookmarks use. NOTE: social-scraper previews (WhatsApp, Facebook,
// Twitter) generally do NOT run JS, so they read the static defaults in
// index.html — per-page social cards would need build-time prerendering.

const SITE = 'Jordan Stand Tall'
const ORIGIN = 'https://www.makejordangreatagain.com'

function upsertMeta(attr, key, content) {
  if (!content) return
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

export default function Seo({ title, description, path = '' }) {
  useEffect(() => {
    const fullTitle = title ? `${title} · ${SITE}` : SITE
    const url = ORIGIN + path
    document.title = fullTitle
    upsertMeta('name', 'description', description)
    upsertMeta('property', 'og:title', title || SITE)
    upsertMeta('property', 'og:description', description)
    upsertMeta('property', 'og:url', url)
    upsertMeta('name', 'twitter:title', title || SITE)
    upsertMeta('name', 'twitter:description', description)
    upsertLink('canonical', url)
  }, [title, description, path])

  return null
}
