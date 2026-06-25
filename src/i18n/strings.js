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

  // ===== landing / home page =====
  'land.nav.community': { en: 'Community', ar: 'المجتمع' },
  'land.nav.inside': { en: "What's inside", ar: 'ماذا يوجد' },
  'land.nav.explore': { en: 'Explore Jordan', ar: 'استكشف الأردن' },
  'land.nav.games': { en: 'Games', ar: 'الألعاب' },
  'land.nav.faq': { en: 'FAQ', ar: 'الأسئلة الشائعة' },
  'land.nav.openhub': { en: 'Open game hub', ar: 'افتح صالة الألعاب' },
  'land.nav.signin': { en: 'Sign in', ar: 'تسجيل الدخول' },

  'land.hero.pill': { en: 'A community, not a campaign', ar: 'مجتمع، لا حملة' },
  'land.hero.lede': {
    en: "A warm online home for the people and residents of Jordan to connect, share culture, and play games together. Pull up a seat — the kettle's on.",
    ar: 'بيت إلكتروني دافئ لأهل الأردن وسكّانه؛ نتواصل ونتشارك ثقافتنا ونلعب معًا. تفضّل بالجلوس — القهوة جاهزة.',
  },
  'land.hero.btnPlay': { en: 'Sign in & play games', ar: 'سجّل الدخول والعب' },
  'land.hero.join': { en: 'Join the Discord', ar: 'انضم إلى ديسكورد' },
  'land.hero.trust': { en: 'Loved by Jordanians at home and abroad', ar: 'محبوب من الأردنيين في الوطن والمهجر' },

  'land.stats.members': { en: 'members', ar: 'عضو' },
  'land.stats.online': { en: 'online now', ar: 'متصل الآن' },
  'land.stats.govs': { en: 'governorates represented', ar: 'محافظة ممثَّلة' },
  'land.stats.dailyNum': { en: 'Daily', ar: 'يوميًا' },
  'land.stats.dailyLbl': { en: 'chats, voice & game nights', ar: 'دردشة وصوت وأمسيات ألعاب' },

  'land.disc.badge': { en: 'Not a political party', ar: 'ليست حزبًا سياسيًا' },
  'land.disc.text': {
    en: 'This site is the home of the Jordan Stand Tall Discord community only — a cultural gathering place for Jordanians, with no affiliation to any political party, movement, government body, or campaign.',
    ar: 'هذا الموقع هو بيت مجتمع «الأردن يقف شامخاً» على ديسكورد فقط — مكان ثقافي يجتمع فيه الأردنيون، دون أي ارتباط بأي حزب سياسي أو حركة أو جهة حكومية أو حملة.',
  },

  'land.feat.eyebrow': { en: "What you'll find inside", ar: 'ماذا ستجد بالداخل' },
  'land.feat.h2': { en: 'A community that feels like home', ar: 'مجتمع يشبه البيت' },
  'land.feat.sub': {
    en: 'Real people, warm conversation, and games to play together — wherever in the world you are.',
    ar: 'أناس حقيقيون، وحديث دافئ، وألعاب نلعبها معًا — أينما كنت في العالم.',
  },
  'land.feat.c1h': { en: 'Real community', ar: 'مجتمع حقيقي' },
  'land.feat.c1p': {
    en: 'Lively channels for hometowns, food, football, music, and everyday life across the kingdom and the diaspora.',
    ar: 'قنوات نابضة بالحياة للمدن والطعام وكرة القدم والموسيقى والحياة اليومية في المملكة والمهجر.',
  },
  'land.feat.c2h': { en: 'Look out for each other', ar: 'نعتني ببعضنا' },
  'land.feat.c2p': {
    en: 'Share tips, ask for advice, and lend a helping hand. This is a space where members genuinely support one another.',
    ar: 'شاركوا النصائح، واطلبوا المشورة، ومدّوا يد العون. هذه مساحة يدعم فيها الأعضاء بعضهم بصدق.',
  },
  'land.feat.c3h': { en: 'Games & tournaments', ar: 'ألعاب وبطولات' },
  'land.feat.c3p': {
    en: 'Sign in and play Tic-Tac-Toe, Connect Four, Chess and Jordan Trivia head-to-head. Climb the leaderboard and challenge friends.',
    ar: 'سجّل الدخول والعب إكس-أو، وفور إن أ رو، والشطرنج، ومسابقة الأردن وجهًا لوجه. تسلّق لوحة الصدارة وتحدَّ أصدقاءك.',
  },
  'land.feat.cta': { en: 'Sign in & start playing', ar: 'سجّل الدخول وابدأ اللعب' },
  'land.feat.ctaHub': { en: 'Open the game hub', ar: 'افتح صالة الألعاب' },

  'land.val.h1': { en: 'Respect first', ar: 'الاحترام أولًا' },
  'land.val.p1': { en: 'Everyone is welcome and treated with kindness, no exceptions.', ar: 'الجميع مُرحَّب بهم ويُعامَلون بلطف، دون استثناء.' },
  'land.val.h2': { en: 'Open to all', ar: 'مفتوح للجميع' },
  'land.val.p2': { en: 'Jordanians at home, abroad, and friends of Jordan are all family here.', ar: 'الأردنيون في الوطن والمهجر وأصدقاء الأردن كلهم عائلة هنا.' },
  'land.val.h3': { en: 'Always free', ar: 'مجاني دائمًا' },
  'land.val.p3': { en: 'No fees, no catch. A community space, now and always.', ar: 'بلا رسوم ولا شروط خفية. مساحة مجتمعية، الآن ودائمًا.' },
  'land.val.h4': { en: 'Active & moderated', ar: 'نشِط ومُدار' },
  'land.val.p4': { en: 'A friendly team keeps things safe, on-topic, and welcoming.', ar: 'فريق ودود يحافظ على الأمان والنظام والترحيب.' },

  'land.res.eyebrow': { en: 'More than games', ar: 'أكثر من مجرّد ألعاب' },
  'land.res.h2': { en: 'A resource for everyone in Jordan', ar: 'دليل لكل من في الأردن' },
  'land.res.sub': {
    en: 'Open to all, no account needed — where to go, who to call, and what to see across the kingdom.',
    ar: 'مفتوح للجميع دون حساب — أين تذهب، بمن تتّصل، وماذا تشاهد في أنحاء المملكة.',
  },
  'land.res.c1h': { en: 'Tourism & places', ar: 'السياحة والأماكن' },
  'land.res.c1p': {
    en: "Petra, Wadi Rum, the Dead Sea, Jerash and more — browse Jordan's wonders by governorate and category.",
    ar: 'البتراء، وادي رم، البحر الميت، جرش والمزيد — تصفّح عجائب الأردن حسب المحافظة والتصنيف.',
  },
  'land.res.c2h': { en: 'Government services', ar: 'الخدمات الحكومية' },
  'land.res.c2p': {
    en: 'Civil status, passports, driving licences, taxes and municipalities — what they do and how to reach them.',
    ar: 'الأحوال المدنية، الجوازات، رخص القيادة، الضرائب والبلديات — ماذا تقدّم وكيف تصل إليها.',
  },
  'land.res.c3h': { en: 'Emergency numbers', ar: 'أرقام الطوارئ' },
  'land.res.c3p': {
    en: 'Police, ambulance, civil defense and other key hotlines — saved in one place, one tap to call.',
    ar: 'الشرطة، الإسعاف، الدفاع المدني وأرقام مهمة أخرى — مجموعة في مكان واحد، اتصال بضغطة.',
  },
  'land.res.cta': { en: 'Explore Jordan', ar: 'استكشف الأردن' },

  'land.faq.eyebrow': { en: 'Good to know', ar: 'معلومات مفيدة' },
  'land.faq.h2': { en: 'Frequently asked questions', ar: 'الأسئلة الشائعة' },
  'land.faq.sub': { en: 'A few quick answers before you join.', ar: 'بعض الإجابات السريعة قبل أن تنضمّ.' },
  'land.faq.q1': { en: 'Is this a political party or movement?', ar: 'هل هذا حزب أو حركة سياسية؟' },
  'land.faq.a1': {
    en: 'No. Jordan Stand Tall is purely a social and cultural community for Jordanians. We have no affiliation with any political party, movement, government body, or campaign — and we never will.',
    ar: 'لا. «الأردن يقف شامخاً» مجتمع اجتماعي وثقافي بحت للأردنيين. لا ارتباط لنا بأي حزب سياسي أو حركة أو جهة حكومية أو حملة — ولن يكون.',
  },
  'land.faq.q2': { en: 'How do the games work?', ar: 'كيف تعمل الألعاب؟' },
  'land.faq.a2': {
    en: 'Sign in with your Discord account, head to the game hub, and challenge other members to Tic-Tac-Toe, Connect Four, Chess, or Jordan Trivia in real time. Wins earn you rating points on the leaderboard.',
    ar: 'سجّل الدخول بحساب ديسكورد، وتوجّه إلى صالة الألعاب، وتحدَّ الأعضاء في إكس-أو أو فور إن أ رو أو الشطرنج أو مسابقة الأردن في الوقت الحقيقي. الفوز يمنحك نقاطًا على لوحة الصدارة.',
  },
  'land.faq.q3': { en: 'Who can join?', ar: 'من يمكنه الانضمام؟' },
  'land.faq.a3': {
    en: 'Anyone who loves Jordan — residents, citizens at home or abroad, and friends of Jordan. Everyone is welcome.',
    ar: 'كل من يحبّ الأردن — المقيمون والمواطنون في الوطن أو المهجر وأصدقاء الأردن. الجميع مُرحَّب بهم.',
  },
  'land.faq.q4': { en: 'Does it cost anything?', ar: 'هل هناك أي تكلفة؟' },
  'land.faq.a4': {
    en: 'Not a thing. The community and the games are completely free to join and take part in.',
    ar: 'لا شيء على الإطلاق. الانضمام إلى المجتمع والألعاب والمشاركة فيها مجاني تمامًا.',
  },

  'land.cta.h2': { en: 'Ready to stand tall with us?', ar: 'مستعدّ لتقف شامخًا معنا؟' },
  'land.cta.p': { en: 'Everyone who loves Jordan is welcome. Free, friendly, and always will be.', ar: 'كل من يحبّ الأردن مُرحَّب به. مجاني وودود، الآن ودائمًا.' },
  'land.cta.btn': { en: 'Sign in & play', ar: 'سجّل الدخول والعب' },
  'land.cta.btnHub': { en: 'Open the game hub', ar: 'افتح صالة الألعاب' },

  'land.foot.desc': { en: 'A warm, independent online home for the people of Jordan.', ar: 'بيت إلكتروني دافئ ومستقل لأهل الأردن.' },
  'land.foot.community': { en: 'Community', ar: 'المجتمع' },
  'land.foot.inside': { en: "What's inside", ar: 'ماذا يوجد' },
  'land.foot.games': { en: 'Games', ar: 'الألعاب' },
  'land.foot.faq': { en: 'FAQ', ar: 'الأسئلة الشائعة' },
  'land.foot.joindiscord': { en: 'Join Discord', ar: 'انضم إلى ديسكورد' },
  'land.foot.resources': { en: 'Resources', ar: 'الأدلّة' },
  'land.foot.tourism': { en: 'Tourism', ar: 'السياحة' },
  'land.foot.services': { en: 'Government services', ar: 'الخدمات الحكومية' },
  'land.foot.emergency': { en: 'Emergency numbers', ar: 'أرقام الطوارئ' },
  'land.foot.play': { en: 'Play', ar: 'اللعب' },
  'land.foot.signin': { en: 'Sign in', ar: 'تسجيل الدخول' },
  'land.foot.leaderboard': { en: 'Leaderboard', ar: 'لوحة الصدارة' },
  'land.foot.notpolitical': { en: 'Not political', ar: 'غير سياسي' },
  'land.foot.copyright': { en: 'makejordangreatagain.com — © 2026 Jordan Stand Tall community', ar: 'makejordangreatagain.com — © 2026 مجتمع الأردن يقف شامخاً' },
  'land.foot.note': {
    en: 'An independent, non-political community space. Not affiliated with any party, government, or campaign.',
    ar: 'مساحة مجتمعية مستقلة وغير سياسية. غير مرتبطة بأي حزب أو حكومة أو حملة.',
  },

  // language toggle (label shows the language you switch TO)
  'lang.switch': { en: 'العربية', ar: 'English' },
}
