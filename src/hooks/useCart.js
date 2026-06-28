import { useCallback, useEffect, useState } from 'react'
import { PRODUCT_BY_ID, FREE_SHIP_OVER, SHIP_FEE } from '../data/shopProducts.js'

// Client-side cart, persisted to localStorage. A line is keyed by
// product + colour + size so the same shirt in two sizes stays separate.
// Lines store only {id, color, size, qty}; price/name/art are resolved from the
// catalog at render time, so they can never drift out of date.
const KEY = 'mjga-cart-v1'

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(parsed) ? parsed.filter((l) => PRODUCT_BY_ID[l.id]) : []
  } catch {
    return []
  }
}

export function lineKey(id, color, size) {
  return `${id}|${color}|${size}`
}

export function useCart() {
  const [items, setItems] = useState(read)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items))
    } catch {
      /* storage unavailable / full — keep the in-memory cart */
    }
  }, [items])

  const add = useCallback((id, color, size, qty = 1) => {
    const key = lineKey(id, color, size)
    setItems((cur) => {
      const i = cur.findIndex((l) => l.key === key)
      if (i >= 0) {
        const next = [...cur]
        next[i] = { ...next[i], qty: Math.min(99, next[i].qty + qty) }
        return next
      }
      return [...cur, { key, id, color, size, qty }]
    })
  }, [])

  const setQty = useCallback((key, qty) => {
    setItems((cur) =>
      qty <= 0
        ? cur.filter((l) => l.key !== key)
        : cur.map((l) => (l.key === key ? { ...l, qty: Math.min(99, qty) } : l)),
    )
  }, [])

  const remove = useCallback((key) => {
    setItems((cur) => cur.filter((l) => l.key !== key))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  const count = items.reduce((s, l) => s + l.qty, 0)
  const subtotal = items.reduce((s, l) => s + l.qty * (PRODUCT_BY_ID[l.id]?.price || 0), 0)
  const shipping = subtotal === 0 || subtotal >= FREE_SHIP_OVER ? 0 : SHIP_FEE
  const total = subtotal + shipping

  return { items, add, setQty, remove, clear, count, subtotal, shipping, total }
}
