// Static UI metadata for the resource pages. The content itself lives in
// Supabase (tourism_spots / gov_services / emergency_numbers); this file is
// just the chrome used to build filter chips and tint cards — it mirrors the
// GAMES registry idea in games/config.js. The category keys here MUST match the
// `category` values seeded in supabase/seed_resources.sql.

// The 12 governorates of Jordan (tourism + services filtering).
export const GOVERNORATES = [
  'Amman', 'Irbid', 'Zarqa', 'Balqa', 'Madaba', 'Karak',
  'Tafilah', "Ma'an", 'Aqaba', 'Mafraq', 'Jerash', 'Ajloun',
]

// Tourism categories → label + emoji + tint. Tints reuse the .gicon/.gcard
// color keys already defined in app.css (g = green, s = sky, a = amber, r = rose).
export const TOURISM_CATEGORIES = [
  { key: 'archaeological', label: 'Archaeological', emoji: '🏛️', tint: 'a' },
  { key: 'nature',         label: 'Nature',         emoji: '🏞️', tint: 'g' },
  { key: 'religious',      label: 'Religious',      emoji: '🕌', tint: 's' },
  { key: 'leisure',        label: 'Leisure',        emoji: '🏖️', tint: 's' },
  { key: 'cultural',       label: 'Cultural',       emoji: '🎭', tint: 'r' },
  { key: 'adventure',      label: 'Adventure',      emoji: '🧗', tint: 'a' },
]

// Government service categories → label.
export const SERVICE_CATEGORIES = [
  { key: 'civil',     label: 'Civil status & ID' },
  { key: 'traffic',   label: 'Driving & vehicles' },
  { key: 'tax',       label: 'Tax & customs' },
  { key: 'social',    label: 'Social security & labour' },
  { key: 'municipal', label: 'Municipal & land' },
  { key: 'ministry',  label: 'Ministries' },
  { key: 'egov',      label: 'E-government' },
]

export const tourismCat = (key) => TOURISM_CATEGORIES.find((c) => c.key === key)
export const serviceCat = (key) => SERVICE_CATEGORIES.find((c) => c.key === key)
