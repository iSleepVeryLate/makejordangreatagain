// Static UI metadata for the resource pages. The content itself lives in
// Supabase (tourism_spots / gov_services / emergency_numbers); this file is
// just the chrome used to build filter chips and tint cards — it mirrors the
// GAMES registry idea in games/config.js. The category keys here MUST match the
// `category` values seeded in supabase/seed_resources.sql.

// The 12 governorates of Jordan (English keys are used for filtering; the data's
// `governorate` field is stored in English).
export const GOVERNORATES = [
  'Amman', 'Irbid', 'Zarqa', 'Balqa', 'Madaba', 'Karak',
  'Tafilah', "Ma'an", 'Aqaba', 'Mafraq', 'Jerash', 'Ajloun',
]

// English governorate → Arabic name (for display when lang === 'ar').
export const GOV_AR = {
  Amman: 'عمّان', Irbid: 'إربد', Zarqa: 'الزرقاء', Balqa: 'البلقاء',
  Madaba: 'مادبا', Karak: 'الكرك', Tafilah: 'الطفيلة', "Ma'an": 'معان',
  Aqaba: 'العقبة', Mafraq: 'المفرق', Jerash: 'جرش', Ajloun: 'عجلون',
}

export const govLabel = (gov, lang) => (lang === 'ar' && GOV_AR[gov]) || gov

// Tourism categories → label + emoji + tint (tints reuse the .gicon/.gcard color
// keys already defined in app.css: g = green, s = sky, a = amber, r = rose).
export const TOURISM_CATEGORIES = [
  { key: 'archaeological', label: 'Archaeological', label_ar: 'أثري',     emoji: '🏛️', tint: 'a' },
  { key: 'nature',         label: 'Nature',         label_ar: 'طبيعة',    emoji: '🏞️', tint: 'g' },
  { key: 'religious',      label: 'Religious',      label_ar: 'ديني',     emoji: '🕌', tint: 's' },
  { key: 'leisure',        label: 'Leisure',        label_ar: 'استجمام',  emoji: '🏖️', tint: 's' },
  { key: 'cultural',       label: 'Cultural',       label_ar: 'ثقافي',    emoji: '🎭', tint: 'r' },
  { key: 'adventure',      label: 'Adventure',      label_ar: 'مغامرة',   emoji: '🧗', tint: 'a' },
]

// Government service categories → label.
export const SERVICE_CATEGORIES = [
  { key: 'civil',     label: 'Civil status & ID',        label_ar: 'الأحوال المدنية' },
  { key: 'traffic',   label: 'Driving & vehicles',       label_ar: 'القيادة والمركبات' },
  { key: 'tax',       label: 'Tax & customs',            label_ar: 'الضرائب والجمارك' },
  { key: 'social',    label: 'Social security & labour', label_ar: 'الضمان والعمل' },
  { key: 'municipal', label: 'Municipal & land',         label_ar: 'البلديات والأراضي' },
  { key: 'ministry',  label: 'Ministries',               label_ar: 'الوزارات' },
  { key: 'egov',      label: 'E-government',              label_ar: 'الحكومة الإلكترونية' },
]

// Pick a category's label in the active language.
export const catLabel = (cat, lang) => (cat ? ((lang === 'ar' && cat.label_ar) || cat.label) : '')

export const tourismCat = (key) => TOURISM_CATEGORIES.find((c) => c.key === key)
export const serviceCat = (key) => SERVICE_CATEGORIES.find((c) => c.key === key)
