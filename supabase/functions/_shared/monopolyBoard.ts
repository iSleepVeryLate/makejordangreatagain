// =====================================================================
// Jordan Monopoly — static board data (SERVER MIRROR — authoritative for money)
// =====================================================================
//
// MIRROR of src/games/monopolyBoard.js. Deno cannot import from src/, so this is
// a hand-kept copy (same precedent as checkers-move mirroring checkersRules.js).
// monopolyBoard.test.ts deep-compares the two files so they can never drift.
// KEEP IN SYNC: any edit here must be made identically in the .js copy.

export const GO_SALARY = 200
export const JAIL_FINE = 50
export const START_CASH = 1500
export const GO_INDEX = 0
export const JAIL_INDEX = 10
export const FREE_PARKING_INDEX = 20
export const GO_TO_JAIL_INDEX = 30
export const MAX_PLAYERS = 8
export const MIN_PLAYERS = 2
export const HOUSE_SUPPLY = 32
export const HOTEL_SUPPLY = 12
export const MORTGAGE_INTEREST = 0.1
export const BANKRUPTCY_FEE = 0.1

export const TOKENS = ['car', 'ship', 'thimble', 'dog', 'hat', 'boot', 'iron', 'wheelbarrow']

export const COLOR_GROUPS: Record<string, { hex: string; size: number }> = {
  brown: { hex: '#8d6239', size: 2 },
  cyan: { hex: '#7fd3e6', size: 3 },
  pink: { hex: '#cf5b97', size: 3 },
  orange: { hex: '#e08a3c', size: 3 },
  red: { hex: '#d23b32', size: 3 },
  yellow: { hex: '#f2c94c', size: 3 },
  green: { hex: '#2e8b57', size: 3 },
  blue: { hex: '#3461c7', size: 2 },
}

const N = (en: string, ar: string) => ({ en, ar })

export interface Tile {
  i: number
  type: string
  name: { en: string; ar: string }
  color?: string
  group?: string
  price?: number
  rent?: number[]
  house?: number
  mortgage?: number
  tax?: number
}

export const BOARD: Tile[] = [
  { i: 0, type: 'go', name: N('GO', 'انطلاق') },
  { i: 1, type: 'property', name: N('As-Salt', 'السلط'), color: 'brown', price: 60, rent: [2, 10, 30, 90, 160, 250], house: 50, mortgage: 30 },
  { i: 2, type: 'chest', name: N('Community Chest', 'صندوق المجتمع') },
  { i: 3, type: 'property', name: N('Irbid', 'إربد'), color: 'brown', price: 60, rent: [4, 20, 60, 180, 320, 450], house: 50, mortgage: 30 },
  { i: 4, type: 'tax', name: N('Income Tax', 'ضريبة الدخل'), tax: 200 },
  { i: 5, type: 'railroad', name: N('Queen Alia Airport', 'مطار الملكة علياء'), group: 'railroad', price: 200, mortgage: 100 },
  { i: 6, type: 'property', name: N('Zarqa', 'الزرقاء'), color: 'cyan', price: 100, rent: [6, 30, 90, 270, 400, 550], house: 50, mortgage: 50 },
  { i: 7, type: 'chance', name: N('Chance', 'الحظ') },
  { i: 8, type: 'property', name: N('Mafraq', 'المفرق'), color: 'cyan', price: 100, rent: [6, 30, 90, 270, 400, 550], house: 50, mortgage: 50 },
  { i: 9, type: 'property', name: N('Ajloun', 'عجلون'), color: 'cyan', price: 120, rent: [8, 40, 100, 300, 450, 600], house: 50, mortgage: 60 },
  { i: 10, type: 'jail', name: N('Jail / Just Visiting', 'السجن / زيارة') },
  { i: 11, type: 'property', name: N('Madaba', 'مادبا'), color: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], house: 100, mortgage: 70 },
  { i: 12, type: 'utility', name: N('Electricity Authority', 'سلطة الكهرباء'), group: 'utility', price: 150, mortgage: 75 },
  { i: 13, type: 'property', name: N('Karak', 'الكرك'), color: 'pink', price: 140, rent: [10, 50, 150, 450, 625, 750], house: 100, mortgage: 70 },
  { i: 14, type: 'property', name: N('Tafilah', 'الطفيلة'), color: 'pink', price: 160, rent: [12, 60, 180, 500, 700, 900], house: 100, mortgage: 80 },
  { i: 15, type: 'railroad', name: N('Aqaba Port', 'ميناء العقبة'), group: 'railroad', price: 200, mortgage: 100 },
  { i: 16, type: 'property', name: N('Jerash', 'جرش'), color: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], house: 100, mortgage: 90 },
  { i: 17, type: 'chest', name: N('Community Chest', 'صندوق المجتمع') },
  { i: 18, type: 'property', name: N("Ma'an", 'معان'), color: 'orange', price: 180, rent: [14, 70, 200, 550, 750, 950], house: 100, mortgage: 90 },
  { i: 19, type: 'property', name: N('Wadi Rum', 'وادي رم'), color: 'orange', price: 200, rent: [16, 80, 220, 600, 800, 1000], house: 100, mortgage: 100 },
  { i: 20, type: 'free_parking', name: N('Free Parking', 'موقف مجاني') },
  { i: 21, type: 'property', name: N('Dead Sea', 'البحر الميت'), color: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], house: 150, mortgage: 110 },
  { i: 22, type: 'chance', name: N('Chance', 'الحظ') },
  { i: 23, type: 'property', name: N('Dana Reserve', 'محمية ضانا'), color: 'red', price: 220, rent: [18, 90, 250, 700, 875, 1050], house: 150, mortgage: 110 },
  { i: 24, type: 'property', name: N('Petra', 'البتراء'), color: 'red', price: 240, rent: [20, 100, 300, 750, 925, 1100], house: 150, mortgage: 120 },
  { i: 25, type: 'railroad', name: N('Amman Bus Terminal', 'مجمّع عمّان'), group: 'railroad', price: 200, mortgage: 100 },
  { i: 26, type: 'property', name: N('Umm Qais', 'أم قيس'), color: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], house: 150, mortgage: 130 },
  { i: 27, type: 'property', name: N('Pella', 'طبقة فحل'), color: 'yellow', price: 260, rent: [22, 110, 330, 800, 975, 1150], house: 150, mortgage: 130 },
  { i: 28, type: 'utility', name: N('Water Authority', 'سلطة المياه'), group: 'utility', price: 150, mortgage: 75 },
  { i: 29, type: 'property', name: N('Ajloun Castle', 'قلعة عجلون'), color: 'yellow', price: 280, rent: [24, 120, 360, 850, 1025, 1200], house: 150, mortgage: 140 },
  { i: 30, type: 'go_to_jail', name: N('Go To Jail', 'إلى السجن') },
  { i: 31, type: 'property', name: N('Rainbow Street', 'شارع الرينبو'), color: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], house: 200, mortgage: 150 },
  { i: 32, type: 'property', name: N('Abdoun', 'عبدون'), color: 'green', price: 300, rent: [26, 130, 390, 900, 1100, 1275], house: 200, mortgage: 150 },
  { i: 33, type: 'chest', name: N('Community Chest', 'صندوق المجتمع') },
  { i: 34, type: 'property', name: N('Amman Citadel', 'جبل القلعة'), color: 'green', price: 320, rent: [28, 150, 450, 1000, 1200, 1400], house: 200, mortgage: 160 },
  { i: 35, type: 'railroad', name: N('King Hussein Bridge', 'جسر الملك حسين'), group: 'railroad', price: 200, mortgage: 100 },
  { i: 36, type: 'chance', name: N('Chance', 'الحظ') },
  { i: 37, type: 'property', name: N('Wadi Rum Luxury Camp', 'مخيّم وادي رم'), color: 'blue', price: 350, rent: [35, 175, 500, 1100, 1300, 1500], house: 200, mortgage: 175 },
  { i: 38, type: 'tax', name: N('Luxury Tax', 'ضريبة الكماليات'), tax: 100 },
  { i: 39, type: 'property', name: N('Amman Downtown', 'وسط البلد'), color: 'blue', price: 400, rent: [50, 200, 600, 1400, 1700, 2000], house: 200, mortgage: 200 },
]

export interface Card {
  id: string
  effect: Record<string, unknown>
  text: { en: string; ar: string }
}

export const CHANCE: Card[] = [
  { id: 'c1', effect: { kind: 'move_to', tile: 0, collectGo: true }, text: N('Advance to GO. Collect 200 JOD.', 'تقدّم إلى الانطلاق. اقبض 200 دينار.') },
  { id: 'c2', effect: { kind: 'move_to', tile: 24, collectGo: true }, text: N('Advance to Petra. If you pass GO, collect 200 JOD.', 'تقدّم إلى البتراء. إذا مررت بالانطلاق اقبض 200 دينار.') },
  { id: 'c3', effect: { kind: 'move_to', tile: 39, collectGo: true }, text: N('Advance to Amman Downtown.', 'تقدّم إلى وسط البلد.') },
  { id: 'c4', effect: { kind: 'move_to', tile: 11, collectGo: true }, text: N('Advance to Madaba. If you pass GO, collect 200 JOD.', 'تقدّم إلى مادبا. إذا مررت بالانطلاق اقبض 200 دينار.') },
  { id: 'c5', effect: { kind: 'move_to', tile: 5, collectGo: true }, text: N('Take a trip to Queen Alia Airport.', 'سافر إلى مطار الملكة علياء.') },
  { id: 'c6', effect: { kind: 'move_to_nearest', kind2: 'railroad', rentMult: 2 }, text: N('Advance to the nearest transit hub and pay double rent.', 'تقدّم إلى أقرب محطة نقل وادفع ضعف الأجرة.') },
  { id: 'c7', effect: { kind: 'move_to_nearest', kind2: 'utility' }, text: N('Advance to the nearest utility.', 'تقدّم إلى أقرب مرفق خدمي.') },
  { id: 'c8', effect: { kind: 'move_rel', steps: -3 }, text: N('Go back 3 spaces.', 'ارجع 3 مربعات.') },
  { id: 'c9', effect: { kind: 'goto_jail' }, text: N('Go directly to Jail. Do not pass GO.', 'اذهب إلى السجن مباشرة. لا تمر بالانطلاق.') },
  { id: 'c10', effect: { kind: 'collect', amount: 50 }, text: N('Bank pays you a dividend of 50 JOD.', 'يدفع لك البنك أرباحًا قدرها 50 دينارًا.') },
  { id: 'c11', effect: { kind: 'goojf' }, text: N('Get Out of Jail Free — keep this card.', 'بطاقة خروج من السجن مجانًا — احتفظ بها.') },
  { id: 'c12', effect: { kind: 'pay', amount: 15 }, text: N('Speeding fine of 15 JOD.', 'غرامة سرعة قدرها 15 دينارًا.') },
  { id: 'c13', effect: { kind: 'collect', amount: 150 }, text: N('Your building loan matures. Collect 150 JOD.', 'استحق قرض البناء. اقبض 150 دينارًا.') },
  { id: 'c14', effect: { kind: 'pay_each', amount: 50 }, text: N('You are elected chairman of the board. Pay each player 50 JOD.', 'انتُخبت رئيسًا للمجلس. ادفع لكل لاعب 50 دينارًا.') },
  { id: 'c15', effect: { kind: 'repairs', perHouse: 25, perHotel: 100 }, text: N('General repairs: pay 25 JOD per house and 100 JOD per hotel.', 'إصلاحات عامة: ادفع 25 دينارًا لكل بيت و100 لكل فندق.') },
  { id: 'c16', effect: { kind: 'move_to', tile: 15, collectGo: true }, text: N('Advance to Aqaba Port. If you pass GO, collect 200 JOD.', 'تقدّم إلى ميناء العقبة. إذا مررت بالانطلاق اقبض 200 دينار.') },
]

export const CHEST: Card[] = [
  { id: 'm1', effect: { kind: 'move_to', tile: 0, collectGo: true }, text: N('Advance to GO. Collect 200 JOD.', 'تقدّم إلى الانطلاق. اقبض 200 دينار.') },
  { id: 'm2', effect: { kind: 'collect', amount: 200 }, text: N('Bank error in your favor. Collect 200 JOD.', 'خطأ بنكي لصالحك. اقبض 200 دينار.') },
  { id: 'm3', effect: { kind: 'pay', amount: 50 }, text: N("Doctor's fee. Pay 50 JOD.", 'أتعاب الطبيب. ادفع 50 دينارًا.') },
  { id: 'm4', effect: { kind: 'collect', amount: 50 }, text: N('From sale of goods you get 50 JOD.', 'من بيع البضائع تحصل على 50 دينارًا.') },
  { id: 'm5', effect: { kind: 'goojf' }, text: N('Get Out of Jail Free — keep this card.', 'بطاقة خروج من السجن مجانًا — احتفظ بها.') },
  { id: 'm6', effect: { kind: 'goto_jail' }, text: N('Go directly to Jail. Do not pass GO.', 'اذهب إلى السجن مباشرة. لا تمر بالانطلاق.') },
  { id: 'm7', effect: { kind: 'collect', amount: 100 }, text: N('Holiday fund matures. Collect 100 JOD.', 'استحق صندوق العطلة. اقبض 100 دينار.') },
  { id: 'm8', effect: { kind: 'collect', amount: 20 }, text: N('Income tax refund. Collect 20 JOD.', 'استرداد ضريبة الدخل. اقبض 20 دينارًا.') },
  { id: 'm9', effect: { kind: 'collect_from_each', amount: 10 }, text: N('It is your birthday. Collect 10 JOD from every player.', 'إنه عيد ميلادك. اقبض 10 دنانير من كل لاعب.') },
  { id: 'm10', effect: { kind: 'collect', amount: 100 }, text: N('Life insurance matures. Collect 100 JOD.', 'استحق التأمين على الحياة. اقبض 100 دينار.') },
  { id: 'm11', effect: { kind: 'pay', amount: 100 }, text: N('Hospital fees. Pay 100 JOD.', 'رسوم المستشفى. ادفع 100 دينار.') },
  { id: 'm12', effect: { kind: 'pay', amount: 50 }, text: N('School fees. Pay 50 JOD.', 'رسوم المدرسة. ادفع 50 دينارًا.') },
  { id: 'm13', effect: { kind: 'collect', amount: 25 }, text: N('Consultancy fee. Collect 25 JOD.', 'أتعاب استشارة. اقبض 25 دينارًا.') },
  { id: 'm14', effect: { kind: 'repairs', perHouse: 40, perHotel: 115 }, text: N('Street repairs: pay 40 JOD per house and 115 JOD per hotel.', 'إصلاح الشوارع: ادفع 40 دينارًا لكل بيت و115 لكل فندق.') },
  { id: 'm15', effect: { kind: 'collect', amount: 100 }, text: N('You inherit 100 JOD.', 'ورثت 100 دينار.') },
  { id: 'm16', effect: { kind: 'collect', amount: 10 }, text: N('You won second prize in a beauty contest. Collect 10 JOD.', 'فزت بالجائزة الثانية في مسابقة جمال. اقبض 10 دنانير.') },
]

export const OWNABLE = BOARD.filter((t) => t.type === 'property' || t.type === 'railroad' || t.type === 'utility').map((t) => t.i)

export const tileAt = (i: number) => BOARD[((i % 40) + 40) % 40]
export const isOwnable = (i: number) => OWNABLE.includes(i)
export const groupTiles = (color: string) => BOARD.filter((t) => t.color === color).map((t) => t.i)
export const railroadTiles = () => BOARD.filter((t) => t.group === 'railroad').map((t) => t.i)
export const utilityTiles = () => BOARD.filter((t) => t.group === 'utility').map((t) => t.i)

if (BOARD.length !== 40) throw new Error('monopolyBoard: BOARD must have 40 tiles')
if (OWNABLE.length !== 28) throw new Error('monopolyBoard: expected 28 ownable tiles')
