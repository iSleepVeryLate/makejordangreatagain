// UI string dictionary for the public resource area (English + Arabic).
// Keys are looked up via the `t()` helper from LanguageContext. Data content
// (place names, summaries) lives in Supabase `*_ar` columns, not here.
export const STRINGS = {
  // nav
  'nav.explore': { en: 'Explore', ar: 'استكشف' },
  'nav.tourism': { en: 'Tourism', ar: 'السياحة' },
  'nav.services': { en: 'Services', ar: 'الخدمات' },
  'nav.emergency': { en: 'Emergency', ar: 'الطوارئ' },
  'nav.games': { en: 'Games', ar: 'الألعاب' },
  'nav.signin': { en: 'Sign in', ar: 'تسجيل الدخول' },

  // explore hub
  'explore.eyebrow': { en: 'A resource for residents', ar: 'دليل لسكّان الأردن' },
  'explore.title': { en: 'Everything you need, in one place', ar: 'كل ما تحتاجه في مكان واحد' },
  'explore.lede': {
    en: 'A growing, free directory for everyone in Jordan — where to go, who to call, and what to see. No account needed.',
    ar: 'دليل مجاني ومتنامٍ للجميع في الأردن — أين تذهب، بمن تتّصل، وماذا تشاهد. دون الحاجة إلى حساب.',
  },
  'explore.tourism.title': { en: 'Tourism & places to visit', ar: 'السياحة وأماكن الزيارة' },
  'explore.tourism.desc': {
    en: "Petra, Wadi Rum, the Dead Sea, Jerash and more — explore Jordan's wonders by governorate and category.",
    ar: 'البتراء، وادي رم، البحر الميت، جرش والمزيد — اكتشف عجائب الأردن حسب المحافظة والتصنيف.',
  },
  'explore.services.title': { en: 'Government offices & services', ar: 'الدوائر والخدمات الحكومية' },
  'explore.services.desc': {
    en: 'Civil status, passports, driving licences, taxes and municipalities — what they do, hours and how to reach them.',
    ar: 'الأحوال المدنية، الجوازات، رخص القيادة، الضرائب والبلديات — ماذا تقدّم، وأوقات الدوام، وكيفية التواصل.',
  },
  'explore.emergency.title': { en: 'Emergency & useful numbers', ar: 'الطوارئ والأرقام المهمّة' },
  'explore.emergency.desc': {
    en: 'Police, ambulance, civil defense and other important hotlines — one tap to call.',
    ar: 'الشرطة، الإسعاف، الدفاع المدني وأرقام مهمّة أخرى — اتّصل بضغطة واحدة.',
  },
  'explore.open': { en: 'Open', ar: 'افتح' },
  'explore.quickEmergency': { en: 'Quick emergency numbers', ar: 'أرقام الطوارئ السريعة' },
  'explore.allNumbers': { en: 'All numbers →', ar: 'كل الأرقام ←' },

  // tourism page
  'tourism.title': { en: 'Tourism & places to visit', ar: 'السياحة وأماكن الزيارة' },
  'tourism.subtitle': {
    en: "Discover Jordan's archaeological wonders, nature reserves and seaside escapes.",
    ar: 'اكتشف عجائب الأردن الأثرية والمحميات الطبيعية وملاذات البحر.',
  },
  'tourism.allTypes': { en: 'All types', ar: 'كل التصنيفات' },
  'tourism.allJordan': { en: 'All Jordan', ar: 'كل الأردن' },
  'tourism.openMaps': { en: 'Open in Maps', ar: 'افتح في الخرائط' },
  'tourism.empty': { en: 'No spots match those filters yet.', ar: 'لا توجد أماكن تطابق هذه الفلاتر بعد.' },

  // services page
  'services.title': { en: 'Government offices & services', ar: 'الدوائر والخدمات الحكومية' },
  'services.subtitle': {
    en: 'Key departments and what they handle — with hours, phone numbers and official websites.',
    ar: 'أهمّ الدوائر وما تقدّمه — مع أوقات الدوام وأرقام الهاتف والمواقع الرسمية.',
  },
  'services.allServices': { en: 'All services', ar: 'كل الخدمات' },
  'services.website': { en: 'Website', ar: 'الموقع' },
  'services.empty': { en: 'No services match that filter yet.', ar: 'لا توجد خدمات تطابق هذا الفلتر بعد.' },

  // emergency page
  'emergency.title': { en: 'Emergency & useful numbers', ar: 'الطوارئ والأرقام المهمّة' },
  'emergency.subtitle': {
    en: 'Tap any number to call. In a life-threatening emergency, dial 911.',
    ar: 'اضغط أي رقم للاتصال. في الحالات الطارئة المهدّدة للحياة، اتّصل بالرقم 911.',
  },
  'emergency.unified': { en: 'Unified emergency', ar: 'الطوارئ الموحّد' },
  'emergency.unifiedSub': { en: 'Police · Ambulance · Civil Defense', ar: 'الشرطة · الإسعاف · الدفاع المدني' },

  // footer
  'foot.tagline': {
    en: 'Jordan Stand Tall — a community resource for residents of Jordan.',
    ar: 'الأردن يقف شامخاً — دليل مجتمعي لسكّان الأردن.',
  },
  'foot.note': {
    en: 'An independent, non-political community space. Information is provided for convenience; please verify official details before relying on them.',
    ar: 'مساحة مجتمعية مستقلّة وغير سياسية. المعلومات مقدّمة للتسهيل؛ يُرجى التحقّق من التفاصيل الرسمية قبل الاعتماد عليها.',
  },
  'foot.verify': { en: 'Listings verified June 2026 ·', ar: 'حُدّثت البيانات في حزيران 2026 ·' },
  'foot.report': { en: 'Spot something out of date? Tell us', ar: 'لاحظت معلومة قديمة؟ أخبِرنا' },

  // language toggle (label shows the language you switch TO)
  'lang.switch': { en: 'العربية', ar: 'English' },
}
