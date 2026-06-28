// MJGA merch catalog. Pure data — the page renders these through <ProductArt>
// (the SVG mockups) so adding a product is just another entry here.

export const CATEGORIES = [
  { key: 'all', labelKey: 'shop.cat.all' },
  { key: 'hats', labelKey: 'shop.cat.hats' },
  { key: 'tops', labelKey: 'shop.cat.tops' },
  { key: 'hoodies', labelKey: 'shop.cat.hoodies' },
]

export const PRODUCTS = [
  {
    id: 'dad-cap',
    cat: 'hats',
    type: 'cap',
    placement: 'center',
    price: 18,
    nameKey: 'shop.p.cap.name',
    descKey: 'shop.p.cap.desc',
    badgeKey: 'shop.badge.bestseller',
    colors: ['black', 'sand', 'white'],
    sizes: ['shop.size.one'],
  },
  {
    id: 'classic-tee',
    cat: 'tops',
    type: 'tee',
    placement: 'center',
    price: 22,
    nameKey: 'shop.p.tee.name',
    descKey: 'shop.p.tee.desc',
    colors: ['black', 'white', 'olive'],
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    id: 'pocket-tee',
    cat: 'tops',
    type: 'tee',
    placement: 'left',
    price: 22,
    nameKey: 'shop.p.pocket.name',
    descKey: 'shop.p.pocket.desc',
    colors: ['black', 'sand', 'white'],
    sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    id: 'polo',
    cat: 'tops',
    type: 'polo',
    placement: 'left',
    price: 28,
    nameKey: 'shop.p.polo.name',
    descKey: 'shop.p.polo.desc',
    colors: ['black', 'olive', 'white'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    id: 'hoodie',
    cat: 'hoodies',
    type: 'hoodie',
    placement: 'center',
    price: 38,
    nameKey: 'shop.p.hoodie.name',
    descKey: 'shop.p.hoodie.desc',
    badgeKey: 'shop.badge.new',
    colors: ['black', 'olive'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  },
  {
    id: 'long-tee',
    cat: 'tops',
    type: 'longsleeve',
    placement: 'center',
    price: 28,
    nameKey: 'shop.p.long.name',
    descKey: 'shop.p.long.desc',
    colors: ['black', 'sand'],
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  },
]

export const PRODUCT_BY_ID = Object.fromEntries(PRODUCTS.map((p) => [p.id, p]))

// Jordan's 12 governorates — used for the delivery address on checkout.
export const GOVERNORATES = [
  { en: 'Amman', ar: 'عمّان' },
  { en: 'Irbid', ar: 'إربد' },
  { en: 'Zarqa', ar: 'الزرقاء' },
  { en: 'Balqa', ar: 'البلقاء' },
  { en: 'Madaba', ar: 'مأدبا' },
  { en: 'Mafraq', ar: 'المفرق' },
  { en: 'Jerash', ar: 'جرش' },
  { en: 'Ajloun', ar: 'عجلون' },
  { en: 'Karak', ar: 'الكرك' },
  { en: 'Tafilah', ar: 'الطفيلة' },
  { en: "Ma'an", ar: 'معان' },
  { en: 'Aqaba', ar: 'العقبة' },
]

// Free delivery over this subtotal (JOD); otherwise a flat fee applies.
export const FREE_SHIP_OVER = 50
export const SHIP_FEE = 3

export function formatPrice(value, lang) {
  return lang === 'ar' ? `${value} د.أ` : `${value} JD`
}
