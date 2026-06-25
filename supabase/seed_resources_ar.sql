-- =====================================================================
-- Arabic (MSA) content for the resource directories. Run AFTER 0007.
-- Idempotent: pure UPDATEs keyed by slug (tourism/services) and sort (emergency).
-- =====================================================================

-- ---------- tourism (name_ar, summary_ar) ----------
update public.tourism_spots set name_ar='البتراء', summary_ar='مدينة نبطية منحوتة في الصخر، تشتهر بالخزنة والدير، وهي مدرجة على قائمة التراث العالمي لليونسكو وإحدى عجائب الدنيا السبع الجديدة.' where slug='petra';
update public.tourism_spots set name_ar='وادي رم', summary_ar='وادٍ صحراوي محمي تتخلله جبال من الحجر الرملي والغرانيت وتقطنه مجتمعات بدوية، وهو موقع تراث عالمي مختلط لليونسكو، ويشتهر بجولات سيارات الجيب والتخييم.' where slug='wadi-rum';
update public.tourism_spots set name_ar='جرش', summary_ar='من أفضل المدن الرومانية المحفوظة في العالم، وتضم شارعًا تحيط به الأعمدة، وميدانًا لسباق الخيل، ومسارح، والساحة البيضاوية.' where slug='jerash';
update public.tourism_spots set name_ar='جبل القلعة (قلعة عمّان)', summary_ar='موقع أثري على قمة جبل في وسط عمّان (جبل القلعة) يضم آثارًا رومانية وبيزنطية وأموية، من بينها معبد هرقل والقصر الأموي.' where slug='amman-citadel';
update public.tourism_spots set name_ar='أم قيس (جدارا)', summary_ar='مدينة يونانية رومانية من مدن الديكابولس في أقصى الشمال، تطل على بحيرة طبريا ووادي اليرموك وهضبة الجولان.' where slug='umm-qais';
update public.tourism_spots set name_ar='قلعة عجلون', summary_ar='قلعة إسلامية أيوبية من القرن الثاني عشر (قلعة الربض)، بناها أحد قادة صلاح الدين للسيطرة على المنطقة والتصدي للتوسع الصليبي.' where slug='ajloun-castle';
update public.tourism_spots set name_ar='محمية غابات عجلون', summary_ar='محمية طبيعية تديرها الجمعية الملكية لحماية الطبيعة، تضم غابات البلوط والفستق الحلبي في المرتفعات الشمالية، وتوفر مسارات للمشي وبرامج للحفاظ على الطبيعة.' where slug='ajloun-forest-reserve';
update public.tourism_spots set name_ar='قلعة الكرك', summary_ar='قلعة كبيرة من العصر الصليبي تقع على طريق الملوك، جرى توسيعها لاحقًا في عهد الأيوبيين والمماليك.' where slug='karak-castle';
update public.tourism_spots set name_ar='مادبا', summary_ar='تُعرف بـ«مدينة الفسيفساء»؛ وتضم كنيسة القديس جاورجيوس خريطة مادبا الفسيفسائية من القرن السادس الميلادي، وهي أقدم تمثيل خرائطي باقٍ للأراضي المقدسة.' where slug='madaba';
update public.tourism_spots set name_ar='جبل نيبو', summary_ar='مرتفع يُروى أن النبي موسى رأى منه الأرض الموعودة، ويضم كنيسة تذكارية بيزنطية مزدانة بالفسيفساء تطل على وادي الأردن والبحر الميت.' where slug='mount-nebo';
update public.tourism_spots set name_ar='بيت عنيا عبر الأردن (المغطس)', summary_ar='موقع على الضفة الشرقية لنهر الأردن يُعتقد أنه مكان تعميد السيد المسيح، وهو مدرج على قائمة التراث العالمي لليونسكو.' where slug='baptism-site';
update public.tourism_spots set name_ar='السلط', summary_ar='مدينة جبلية من أواخر العهد العثماني مبنية من الحجر الجيري الأصفر، تشتهر بعمارتها وتاريخها في التعايش بين الأديان، وهي مدرجة على قائمة التراث العالمي لليونسكو.' where slug='as-salt';
update public.tourism_spots set name_ar='البحر الميت', summary_ar='بحيرة شديدة الملوحة تقع في أخفض بقعة يابسة على سطح الأرض (نحو 430 مترًا تحت سطح البحر)، تشتهر بالطفو الميسور وبطينها الغني بالمعادن، وتتركز منتجعاتها الشاطئية قرب السويمة.' where slug='dead-sea';
update public.tourism_spots set name_ar='وادي الموجب', summary_ar='وادٍ نهري مهيب ينحدر نحو البحر الميت، وتديره الجمعية الملكية لحماية الطبيعة؛ ويُعد مسار السيق وجهة شائعة للمشي في المياه، ويُفتح موسميًا.' where slug='wadi-mujib';
update public.tourism_spots set name_ar='محمية ضانا للمحيط الحيوي', summary_ar='أكبر محمية طبيعية في الأردن، تمتد من المرتفعات إلى الصحراء عبر عدة نطاقات جغرافية حيوية، وتضم مسارات للمشي وقرية ضانا.' where slug='dana-reserve';
update public.tourism_spots set name_ar='قلعة الشوبك (مونتريال)', summary_ar='قلعة صليبية أُسست عام 1115 باسم «مونس رياليس» على طريق الملوك، وآلت لاحقًا إلى الأيوبيين والمماليك.' where slug='shobak-castle';
update public.tourism_spots set name_ar='العقبة', summary_ar='المدينة الساحلية الوحيدة في الأردن، تقع على خليج العقبة في البحر الأحمر، وتشتهر بالغوص بين الشعاب المرجانية والغطس والمنتجعات الشاطئية.' where slug='aqaba';
update public.tourism_spots set name_ar='قصير عمرة (قصر عمرة)', summary_ar='قصر صحراوي أموي مع حمّام يعود إلى أوائل القرن الثامن الميلادي، يشتهر بجدارياته التصويرية، وهو مدرج على قائمة التراث العالمي لليونسكو.' where slug='quseir-amra';
update public.tourism_spots set name_ar='قصر الأزرق', summary_ar='حصن صحراوي من البازلت الأسود بُني على أسس رومانية واستُخدم حتى العهد العثماني؛ وكان مقرًا للورانس العرب في شتاء 1917-1918.' where slug='qasr-al-azraq';
update public.tourism_spots set name_ar='أم الرصاص', summary_ar='موقع روماني وبيزنطي وإسلامي مبكر يضم فسيفساء كنسية محفوظة جيدًا، من بينها أرضية كنيسة القديس ستيفن، وهو مدرج على قائمة التراث العالمي لليونسكو.' where slug='umm-ar-rasas';
update public.tourism_spots set name_ar='أم الجمال', summary_ar='بلدة واسعة من البازلت الأسود تعود إلى العصور النبطية والرومانية والبيزنطية والأموية في صحراء البازلت الشمالية، وهي مدرجة على قائمة التراث العالمي لليونسكو.' where slug='umm-el-jimal';

-- ---------- gov services (name_ar, summary_ar) ----------
update public.gov_services set name_ar='دائرة الأحوال المدنية والجوازات', summary_ar='تصدر بطاقات الهوية الوطنية وجوازات السفر، وتحفظ السجلات المدنية من ولادات وزواج ووفيات.' where slug='cspd';
update public.gov_services set name_ar='إدارة ترخيص السواقين والمركبات', summary_ar='إدارة تابعة للأمن العام تصدر رخص القيادة وتجددها وتتولى تسجيل المركبات.' where slug='dvld';
update public.gov_services set name_ar='دائرة الجمارك الأردنية', summary_ar='تخلّص الواردات والصادرات، وتجبي الرسوم الجمركية، وتحدد مخصصات المسافرين على حدود الأردن.' where slug='customs';
update public.gov_services set name_ar='دائرة ضريبة الدخل والمبيعات', summary_ar='تدير وتجبي ضريبة الدخل وضريبة المبيعات العامة للأفراد والشركات.' where slug='istd';
update public.gov_services set name_ar='المؤسسة العامة للضمان الاجتماعي', summary_ar='تدير الضمان الاجتماعي، بما في ذلك رواتب التقاعد والعجز والوفاة.' where slug='ssc';
update public.gov_services set name_ar='وزارة العمل', summary_ar='مسؤولة عن سياسات العمل وتصاريح العمل والتفتيش العمالي وشكاوى العمال.' where slug='mol';
update public.gov_services set name_ar='أمانة عمّان الكبرى', summary_ar='تتولى التخطيط الحضري والتراخيص والنظافة ومواقف السيارات والخدمات المحلية في مدينة عمّان.' where slug='gam';
update public.gov_services set name_ar='دائرة الأراضي والمساحة', summary_ar='تتولى تسجيل الأراضي والعقارات وأعمال المساحة وتقييم العقارات.' where slug='dls';
update public.gov_services set name_ar='وزارة الداخلية', summary_ar='الأمن الداخلي والإدارة المدنية والإقامة والنظام العام.' where slug='moi';
update public.gov_services set name_ar='وزارة الصحة', summary_ar='تشرف على سياسات الصحة العامة والمستشفيات والخدمات الصحية على مستوى المملكة.' where slug='moh';
update public.gov_services set name_ar='وزارة الصناعة والتجارة والتموين', summary_ar='تنظم التجارة والصناعة وتموين المستهلك، وتتولى تسجيل الشركات عبر دائرة مراقبة الشركات.' where slug='mit';
update public.gov_services set name_ar='بوابة الحكومة الإلكترونية الأردنية', summary_ar='بوابة وطنية موحدة للخدمات الحكومية الرقمية، يدعمها مركز الاتصال الوطني.' where slug='egov';
update public.gov_services set name_ar='تطبيق سند', summary_ar='التطبيق الحكومي الموحد في الأردن، يوفر مئات الخدمات الرقمية والهوية الرقمية من حساب واحد.' where slug='sanad';

-- ---------- emergency (label_ar, description_ar) ----------
update public.emergency_numbers set label_ar='الطوارئ الموحدة', description_ar='الشرطة والإسعاف والإطفاء/الدفاع المدني عبر رقم واحد على مستوى المملكة.' where sort=1;
update public.emergency_numbers set label_ar='الشرطة', description_ar='خط الشرطة المباشر (ويصل الرقم 911 إلى الشرطة أيضًا).' where sort=2;
update public.emergency_numbers set label_ar='الإسعاف', description_ar='خط الإسعاف/الطوارئ الطبية المباشر (والرقم 911 يعمل أيضًا).' where sort=3;
update public.emergency_numbers set label_ar='الدفاع المدني (الإطفاء والإنقاذ)', description_ar='خط الدفاع المدني المباشر للإطفاء والإنقاذ (والرقم 911 يعمل أيضًا).' where sort=4;
update public.emergency_numbers set label_ar='الشرطة السياحية', description_ar='خط ساخن تابع للأمن العام لمساعدة السياح والتعامل مع الطوارئ.' where sort=5;
update public.emergency_numbers set label_ar='وزارة الصحة', description_ar='الخط الرئيسي لوزارة الصحة للاستفسارات الصحية.' where sort=6;
update public.emergency_numbers set label_ar='الخدمات الحكومية (سند)', description_ar='مركز الاتصال الوطني للخدمات الحكومية الإلكترونية واستفسارات المواطنين.' where sort=7;
update public.emergency_numbers set label_ar='أعطال الكهرباء — جيبكو (JEPCO) (عمّان والزرقاء ومادبا والبلقاء)', description_ar='خط مجاني تابع لشركة جيبكو (JEPCO) للإبلاغ عن أعطال الكهرباء وطوارئها في منطقتها الوسطى.' where sort=8;
update public.emergency_numbers set label_ar='الكهرباء — إيديكو (IDECO) (شمال الأردن)', description_ar='خدمة عملاء شركة كهرباء محافظة إربد للمحافظات الشمالية.' where sort=9;
update public.emergency_numbers set label_ar='شكاوى المياه والصرف الصحي', description_ar='الخط الساخن الوطني الموحد للمياه (شركات مياهنا واليرموك ومياه العقبة).' where sort=10;
