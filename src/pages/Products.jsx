import { useMemo, useState } from 'react'
import ResourceLayout from '../components/ResourceLayout.jsx'
import Seo from '../components/Seo.jsx'
import ProductArt from '../components/shop/ProductArt.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useCart } from '../hooks/useCart.js'
import {
  CATEGORIES,
  PRODUCTS,
  PRODUCT_BY_ID,
  GOVERNORATES,
  FREE_SHIP_OVER,
  formatPrice,
} from '../data/shopProducts.js'

const DISCORD_INVITE = 'https://discord.gg/makejordangreatagain'

const COLOR_SWATCH = {
  black: '#1c1f25',
  white: '#eef0f2',
  sand: '#d6c7ab',
  olive: '#5f6549',
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h3l2.4 12.2a1.5 1.5 0 0 0 1.5 1.2h8.1a1.5 1.5 0 0 0 1.5-1.2L21 7H6" />
    </svg>
  )
}

function ProductCard({ product, onAdd }) {
  const { t, lang } = useLang()
  const [color, setColor] = useState(product.colors[0])
  const [size, setSize] = useState(product.sizes[0])
  const sizeLabel = (s) => (s.startsWith('shop.') ? t(s) : s)

  return (
    <div className="shop-card">
      <div className="shop-art">
        <ProductArt type={product.type} color={color} placement={product.placement} />
        {product.badgeKey && <span className="shop-badge">{t(product.badgeKey)}</span>}
      </div>

      <div className="shop-card-body">
        <div className="shop-card-head">
          <h3>{t(product.nameKey)}</h3>
          <span className="shop-price">{formatPrice(product.price, lang)}</span>
        </div>
        <p className="shop-desc">{t(product.descKey)}</p>

        <div className="shop-opt">
          <span className="shop-opt-label">{t('shop.color')}</span>
          <div className="shop-swatches">
            {product.colors.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${c === color ? ' on' : ''}`}
                style={{ '--sw': COLOR_SWATCH[c] }}
                onClick={() => setColor(c)}
                aria-label={t(`shop.color.${c}`)}
                aria-pressed={c === color}
                title={t(`shop.color.${c}`)}
              />
            ))}
          </div>
        </div>

        <div className="shop-opt">
          <span className="shop-opt-label">{t('shop.size')}</span>
          <div className="shop-sizes">
            {product.sizes.map((s) => (
              <button
                key={s}
                type="button"
                className={`size-chip${s === size ? ' on' : ''}`}
                onClick={() => setSize(s)}
                aria-pressed={s === size}
              >
                {sizeLabel(s)}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="btn btn-green shop-add"
          onClick={() => onAdd(product.id, color, size)}
        >
          <CartIcon /> {t('shop.add')}
        </button>
      </div>
    </div>
  )
}

function CartLine({ line, onQty, onRemove }) {
  const { t, lang } = useLang()
  const p = PRODUCT_BY_ID[line.id]
  if (!p) return null
  const sizeLabel = line.size.startsWith('shop.') ? t(line.size) : line.size
  return (
    <div className="cart-line">
      <div className="cart-thumb">
        <ProductArt type={p.type} color={line.color} placement={p.placement} />
      </div>
      <div className="cart-line-main">
        <div className="cart-line-top">
          <span className="cart-line-name">{t(p.nameKey)}</span>
          <button type="button" className="cart-x" onClick={() => onRemove(line.key)} aria-label={t('shop.cart.remove')}>
            ×
          </button>
        </div>
        <span className="cart-line-variant">
          {t(`shop.color.${line.color}`)} · {sizeLabel}
        </span>
        <div className="cart-line-bottom">
          <div className="qty">
            <button type="button" onClick={() => onQty(line.key, line.qty - 1)} aria-label="−">
              −
            </button>
            <span>{line.qty}</span>
            <button type="button" onClick={() => onQty(line.key, line.qty + 1)} aria-label="+">
              +
            </button>
          </div>
          <span className="cart-line-price">{formatPrice(p.price * line.qty, lang)}</span>
        </div>
      </div>
    </div>
  )
}

const EMPTY_FORM = { name: '', phone: '', gov: GOVERNORATES[0].en, address: '', notes: '' }

export default function Products() {
  const { t, lang } = useLang()
  const toast = useToast()
  const cart = useCart()
  const [cat, setCat] = useState('all')
  const [open, setOpen] = useState(false)
  const [checkout, setCheckout] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const list = useMemo(
    () => (cat === 'all' ? PRODUCTS : PRODUCTS.filter((p) => p.cat === cat)),
    [cat],
  )

  const handleAdd = (id, color, size) => {
    cart.add(id, color, size)
    toast(t('shop.added'), 'success')
    setOpen(true)
  }

  const buildOrder = () => {
    const lines = cart.items.map((l) => {
      const p = PRODUCT_BY_ID[l.id]
      const sz = l.size.startsWith('shop.') ? t(l.size, undefined) : l.size
      return `• ${t(p.nameKey)} — ${t(`shop.color.${l.color}`)} / ${sz} ×${l.qty} = ${formatPrice(p.price * l.qty, lang)}`
    })
    const gov = GOVERNORATES.find((g) => g.en === form.gov)
    return [
      '🧢 MJGA order',
      ...lines,
      `${t('shop.cart.subtotal')}: ${formatPrice(cart.subtotal, lang)}`,
      `${t('shop.cart.shipping')}: ${cart.shipping === 0 ? t('shop.cart.free') : formatPrice(cart.shipping, lang)}`,
      `${t('shop.cart.total')}: ${formatPrice(cart.total, lang)}`,
      '—',
      `${t('shop.co.name')}: ${form.name}`,
      `${t('shop.co.phone')}: ${form.phone}`,
      `${t('shop.co.gov')}: ${gov ? gov[lang] || gov.en : form.gov}`,
      `${t('shop.co.address')}: ${form.address}`,
      form.notes ? `${t('shop.co.notes')}: ${form.notes}` : null,
    ]
      .filter(Boolean)
      .join('\n')
  }

  const placeOrder = (e) => {
    e.preventDefault()
    const summary = buildOrder()
    try {
      navigator.clipboard?.writeText(summary)
    } catch {
      /* clipboard blocked — the Discord tab still opens */
    }
    window.open(DISCORD_INVITE, '_blank', 'noopener')
    toast(t('shop.co.success'), 'success')
    cart.clear()
    setForm(EMPTY_FORM)
    setCheckout(false)
    setOpen(false)
  }

  const canPlace = form.name.trim() && form.phone.trim() && form.address.trim()

  return (
    <ResourceLayout>
      <Seo
        title="MJGA Shop — Hats, Shirts & Hoodies"
        description="Official MJGA merch: caps, tees, polos, hoodies and long-sleeves with the Jordan flag wordmark. Wear it with pride."
        path="/products"
      />

      <div className="res-hero shop-hero">
        <span className="res-eyebrow">{t('shop.eyebrow')}</span>
        <h1>{t('shop.title')}</h1>
        <p>{t('shop.lede')}</p>
        <div className="shop-trust">
          <span className="shop-trust-pill">🚚 {t('shop.trust.shipping', { amount: formatPrice(FREE_SHIP_OVER, lang) })}</span>
          <span className="shop-trust-pill">🧵 {t('shop.trust.quality')}</span>
          <span className="shop-trust-pill">❤️ {t('shop.trust.community')}</span>
        </div>
      </div>

      <div className="chip-row shop-cats">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`chip${cat === c.key ? ' on' : ''}`}
            onClick={() => setCat(c.key)}
          >
            {t(c.labelKey)}
          </button>
        ))}
      </div>

      <div className="shop-grid">
        {list.map((p) => (
          <ProductCard key={p.id} product={p} onAdd={handleAdd} />
        ))}
      </div>

      <p className="shop-foot-note">{t('shop.disclaimer')}</p>

      {/* floating cart button */}
      <button
        type="button"
        className="cart-fab"
        onClick={() => setOpen(true)}
        aria-label={t('shop.cart.title')}
      >
        <CartIcon />
        {cart.count > 0 && <span className="cart-fab-count">{cart.count}</span>}
      </button>

      {/* cart drawer */}
      {open && <div className="cart-overlay" onClick={() => setOpen(false)} />}
      <aside className={`cart-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="cart-head">
          <h2>{checkout ? t('shop.co.title') : t('shop.cart.title')}</h2>
          <button type="button" className="cart-close" onClick={() => setOpen(false)} aria-label={t('shop.cart.close')}>
            ×
          </button>
        </div>

        {cart.items.length === 0 ? (
          <div className="cart-empty">
            <span className="cart-empty-emoji">🛒</span>
            <p>{t('shop.cart.empty')}</p>
            <button type="button" className="btn btn-line btn-sm" onClick={() => setOpen(false)}>
              {t('shop.cart.continue')}
            </button>
          </div>
        ) : checkout ? (
          <form className="cart-co" onSubmit={placeOrder}>
            <p className="cart-co-note">{t('shop.co.note')}</p>
            <label className="cart-field">
              <span>{t('shop.co.name')}</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="cart-field">
              <span>{t('shop.co.phone')}</span>
              <input
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                required
              />
            </label>
            <label className="cart-field">
              <span>{t('shop.co.gov')}</span>
              <select value={form.gov} onChange={(e) => setForm({ ...form, gov: e.target.value })}>
                {GOVERNORATES.map((g) => (
                  <option key={g.en} value={g.en}>
                    {g[lang] || g.en}
                  </option>
                ))}
              </select>
            </label>
            <label className="cart-field">
              <span>{t('shop.co.address')}</span>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
            </label>
            <label className="cart-field">
              <span>{t('shop.co.notes')}</span>
              <textarea
                rows="2"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>

            <div className="cart-totals">
              <div className="cart-total-row">
                <span>{t('shop.cart.total')}</span>
                <span className="cart-total-val">{formatPrice(cart.total, lang)}</span>
              </div>
            </div>

            <button type="submit" className="btn btn-green cart-checkout" disabled={!canPlace}>
              {t('shop.co.place')}
            </button>
            <button type="button" className="cart-back" onClick={() => setCheckout(false)}>
              ← {t('shop.co.back')}
            </button>
          </form>
        ) : (
          <>
            <div className="cart-lines">
              {cart.items.map((l) => (
                <CartLine key={l.key} line={l} onQty={cart.setQty} onRemove={cart.remove} />
              ))}
            </div>

            <div className="cart-totals">
              <div className="cart-total-row sub">
                <span>{t('shop.cart.subtotal')}</span>
                <span>{formatPrice(cart.subtotal, lang)}</span>
              </div>
              <div className="cart-total-row sub">
                <span>{t('shop.cart.shipping')}</span>
                <span>{cart.shipping === 0 ? t('shop.cart.free') : formatPrice(cart.shipping, lang)}</span>
              </div>
              <div className="cart-total-row">
                <span>{t('shop.cart.total')}</span>
                <span className="cart-total-val">{formatPrice(cart.total, lang)}</span>
              </div>
            </div>

            <button type="button" className="btn btn-green cart-checkout" onClick={() => setCheckout(true)}>
              {t('shop.cart.checkout')}
            </button>
            <button type="button" className="cart-back" onClick={() => setOpen(false)}>
              {t('shop.cart.continue')}
            </button>
          </>
        )}
      </aside>
    </ResourceLayout>
  )
}
