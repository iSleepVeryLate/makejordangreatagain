-- =====================================================================
-- Jordan resident resources — REAL, sourced content. Run AFTER 0006_resources.sql.
-- Safe to re-run: it clears and reloads each directory.
-- =====================================================================
--
-- Sourced (2026-06) from official / authoritative sources:
--   Tourism  — Jordan Tourism Board (visitjordan.com) entrance-fees page,
--              UNESCO World Heritage list, Wikipedia (coordinates).
--   Services — each department's official *.gov.jo "Contact Us" page.
--   Numbers  — Public Security (psd.gov.jo) 911 page, the Jordan e-gov
--              "Essential Contact Numbers" page, and the utility companies'
--              official sites (JEPCO, IDECO, the unified 117116 water line).
--
--   Phone numbers, fees, hours and websites change over time — re-verify
--   periodically. Coordinates are decimal degrees. Where a fee/phone could not
--   be confirmed it is left NULL rather than guessed.

truncate table public.tourism_spots;
truncate table public.gov_services;
truncate table public.emergency_numbers;

-- ---------- tourism spots (all 12 governorates represented) ----------
insert into public.tourism_spots
  (slug, name, governorate, category, summary, lat, lng, entry_fee, best_time, maps_url, sort) values
('petra', 'Petra', 'Ma''an', 'archaeological',
 'Nabataean rock-cut city famous for the Treasury (Al-Khazneh) and the Monastery; a UNESCO World Heritage Site and one of the New 7 Wonders of the World.',
 30.32861, 35.44194, '50 JOD (1 day) — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=30.32861,35.44194', 1),
('wadi-rum', 'Wadi Rum', 'Aqaba', 'nature',
 'Protected desert valley of sandstone and granite mountains inhabited by Bedouin communities; a UNESCO mixed World Heritage Site, popular for jeep tours and camping.',
 29.59306, 35.42000, '5 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=29.59306,35.42000', 2),
('jerash', 'Jerash', 'Jerash', 'archaeological',
 'One of the best-preserved provincial Roman cities in the world, with a colonnaded street, hippodrome, theatres and the Oval Plaza.',
 32.28056, 35.89722, '10 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=32.28056,35.89722', 3),
('amman-citadel', 'Amman Citadel', 'Amman', 'archaeological',
 'Hilltop site in central Amman (Jabal al-Qal''a) with Roman, Byzantine and Umayyad remains, including the Temple of Hercules and the Umayyad Palace.',
 31.95470, 35.93430, '3 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=31.95470,35.93430', 4),
('umm-qais', 'Umm Qais (Gadara)', 'Irbid', 'archaeological',
 'Greco-Roman city of the Decapolis in the far north, with views over the Sea of Galilee, the Yarmouk Valley and the Golan Heights.',
 32.65417, 35.68750, '5 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=32.65417,35.68750', 5),
('ajloun-castle', 'Ajloun Castle', 'Ajloun', 'archaeological',
 '12th-century Ayyubid Islamic castle (Qal''at ar-Rabad) built by a commander of Saladin to control the region and counter Crusader expansion.',
 32.32521, 35.72728, '3 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=32.32521,35.72728', 6),
('ajloun-forest-reserve', 'Ajloun Forest Reserve', 'Ajloun', 'nature',
 'RSCN-managed reserve of oak and pistachio woodland in the northern highlands, with hiking trails and conservation programmes.',
 32.38111, 35.76472, '8 JOD (incl. tax) — not in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=32.38111,35.76472', 7),
('karak-castle', 'Karak Castle', 'Karak', 'archaeological',
 'Large Crusader-era castle on the King''s Highway, later expanded under Ayyubid and Mamluk rule.',
 31.18056, 35.70139, '2 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=31.18056,35.70139', 8),
('madaba', 'Madaba', 'Madaba', 'cultural',
 'The "City of Mosaics"; the Church of St George holds the 6th-century Madaba Map, the oldest surviving cartographic depiction of the Holy Land.',
 31.71700, 35.80000, '3 JOD (Archaeological Park) — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=31.71700,35.80000', 9),
('mount-nebo', 'Mount Nebo', 'Madaba', 'religious',
 'Ridge where, by tradition, Moses viewed the Promised Land; site of a Byzantine memorial church with mosaics, overlooking the Jordan Valley and Dead Sea.',
 31.76670, 35.72500, '3 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=31.76670,35.72500', 10),
('baptism-site', 'Bethany Beyond the Jordan (Al-Maghtas)', 'Balqa', 'religious',
 'Site on the east bank of the Jordan River identified as the place of Jesus''s baptism; a UNESCO World Heritage Site.',
 31.83722, 35.55028, '12 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=31.83722,35.55028', 11),
('as-salt', 'As-Salt', 'Balqa', 'cultural',
 'Late-Ottoman hill town of yellow limestone, noted for its architecture and history of interfaith coexistence; a UNESCO World Heritage Site.',
 32.03917, 35.72722, 'Free (town); some museums charge separately', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=32.03917,35.72722', 12),
('dead-sea', 'Dead Sea', 'Balqa', 'leisure',
 'Hypersaline lake at Earth''s lowest land elevation (about -430 m), known for effortless floating and mineral-rich mud; resort beaches cluster near Sweimeh.',
 31.55900, 35.47300, NULL, 'Spring & autumn; winter is mild',
 'https://www.google.com/maps/search/?api=1&query=31.55900,35.47300', 13),
('wadi-mujib', 'Wadi Mujib', 'Madaba', 'adventure',
 'Dramatic river canyon descending to the Dead Sea, managed by the RSCN; the Siq Trail is a popular water-hiking route open seasonally.',
 31.49278, 35.60500, 'From 21 JOD (Siq Trail, incl. tax) — not in Jordan Pass', 'Trails open ~Apr–Oct (closed in winter)',
 'https://www.google.com/maps/search/?api=1&query=31.49278,35.60500', 14),
('dana-reserve', 'Dana Biosphere Reserve', 'Tafilah', 'nature',
 'Jordan''s largest nature reserve, spanning highlands to desert across several bio-geographic zones, with hiking trails and the village of Dana.',
 30.68750, 35.57250, '10 JOD (incl. tax) — not in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=30.68750,35.57250', 15),
('shobak-castle', 'Shobak Castle (Montreal)', 'Ma''an', 'archaeological',
 'Crusader castle founded in 1115 as "Mons Realis" on the King''s Highway, later held by the Ayyubids and Mamluks.',
 30.53130, 35.56000, '1 JOD — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=30.53130,35.56000', 16),
('aqaba', 'Aqaba', 'Aqaba', 'leisure',
 'Jordan''s only coastal city, on the Red Sea''s Gulf of Aqaba, known for coral-reef diving, snorkelling and beach resorts.',
 29.53194, 35.00556, NULL, 'Autumn to spring (Oct–Apr); summers are very hot',
 'https://www.google.com/maps/search/?api=1&query=29.53194,35.00556', 17),
('quseir-amra', 'Quseir Amra (Qasr Amra)', 'Zarqa', 'archaeological',
 'Early-8th-century Umayyad desert castle and bathhouse renowned for its figurative fresco paintings; a UNESCO World Heritage Site.',
 31.80170, 36.58730, '3 JOD (Desert Castles) — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=31.80170,36.58730', 18),
('qasr-al-azraq', 'Qasr al-Azraq', 'Zarqa', 'archaeological',
 'Black-basalt desert fort built over Roman foundations and used into the Ottoman era; T. E. Lawrence''s headquarters in the winter of 1917–18.',
 31.88333, 36.81667, '3 JOD (Desert Castles) — included in Jordan Pass', 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=31.88333,36.81667', 19),
('umm-ar-rasas', 'Umm ar-Rasas', 'Madaba', 'archaeological',
 'Roman, Byzantine and Early Muslim site with well-preserved church mosaics, including the floor of St Stephen''s Church; a UNESCO World Heritage Site.',
 31.50079, 35.92026, NULL, 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=31.50079,35.92026', 20),
('umm-el-jimal', 'Umm el-Jimal', 'Mafraq', 'archaeological',
 'Extensive black-basalt town of Nabataean, Roman, Byzantine and Umayyad date in the northern basalt desert; a UNESCO World Heritage Site.',
 32.32670, 36.36970, NULL, 'Spring & autumn (Mar–May, Sep–Nov)',
 'https://www.google.com/maps/search/?api=1&query=32.32670,36.36970', 21);

-- ---------- government offices & services ----------
insert into public.gov_services
  (slug, name, category, summary, governorate, phone, hotline, website, hours, sort) values
('cspd', 'Civil Status & Passports Department', 'civil',
 'Issues national ID cards and passports and maintains civil records (births, marriages, deaths).',
 NULL, '06 563 6666', NULL, 'cspd.gov.jo', 'Sun–Thu 8:30–15:30 (Airport office 24/7)', 1),
('dvld', 'Drivers & Vehicles Licensing Department', 'traffic',
 'Public Security department that issues and renews driving licences and handles vehicle registration.',
 NULL, NULL, '06 488 8888', 'dvld.gov.jo', 'Sun–Wed 8:00–15:00, Thu 8:00–13:00 (call center)', 2),
('customs', 'Jordan Customs', 'tax',
 'Clears imports and exports, collects customs duties, and sets traveller allowances at Jordan''s borders.',
 NULL, '06 462 3186', '06 500 8080', 'customs.gov.jo', NULL, 3),
('istd', 'Income & Sales Tax Department', 'tax',
 'Administers and collects income tax and general sales tax for individuals and businesses.',
 NULL, '06 460 4444', '06 500 8080', 'istd.gov.jo', 'Sun–Thu 8:30–15:30', 4),
('ssc', 'Social Security Corporation', 'social',
 'Administers social security, including retirement, disability and survivor pensions.',
 NULL, '06 550 1880', '117117', 'ssc.gov.jo', 'Sun–Thu 8:30–15:30', 5),
('mol', 'Ministry of Labour', 'social',
 'Responsible for labour policy, work permits, labour inspection and workers'' complaints.',
 NULL, '06 222 1020', NULL, 'mol.gov.jo', 'Sun–Thu 8:30–15:30', 6),
('gam', 'Greater Amman Municipality', 'municipal',
 'Urban planning, permits, cleanliness, parking and local services across the city of Amman.',
 'Amman', NULL, '117180', 'ammancity.gov.jo', 'Sun–Thu 7:15–16:15 (call center 24/7)', 7),
('dls', 'Department of Lands & Survey', 'municipal',
 'Handles land and property registration, surveying and real-estate valuation.',
 NULL, NULL, '117711', 'dls.gov.jo', 'Sun–Thu 8:00–15:00', 8),
('moi', 'Ministry of Interior', 'ministry',
 'Internal security, civil administration, residency and public order.',
 NULL, '06 569 1141', NULL, 'moi.gov.jo', 'Sun–Thu 8:00–15:00', 9),
('moh', 'Ministry of Health', 'ministry',
 'Oversees public health policy, hospitals and health services nationwide.',
 NULL, '06 520 0230', '06 500 4545', 'moh.gov.jo', NULL, 10),
('mit', 'Ministry of Industry, Trade & Supply', 'ministry',
 'Regulates commerce, industry and consumer supply; handles company registration via the Companies Control Department.',
 NULL, '06 562 9030', NULL, 'mit.gov.jo', 'Sun–Thu 8:30–15:30', 11),
('egov', 'Jordan e-Government Portal', 'egov',
 'Unified national portal for digital government services, backed by the National Contact Center.',
 NULL, NULL, '06 500 8080', 'jordan.gov.jo', '24/7 online', 12),
('sanad', 'Sanad App', 'egov',
 'Jordan''s unified government super-app providing hundreds of digital services and digital identity from one account.',
 NULL, NULL, '06 500 8080', 'sanad.gov.jo', '24/7 online', 13);

-- ---------- emergency & useful numbers ----------
insert into public.emergency_numbers (label, number, category, description, sort) values
('Unified Emergency', '911', 'emergency', 'Police, ambulance and fire / civil defence through one nationwide number.', 1),
('Police', '191', 'emergency', 'Direct police line (911 also reaches police).', 2),
('Ambulance', '193', 'emergency', 'Direct ambulance / medical emergency line (911 also works).', 3),
('Civil Defence (Fire & Rescue)', '199', 'emergency', 'Direct Civil Defence line for fire and rescue (911 also works).', 4),
('Tourist Police', '079 550 5755', 'tourist', 'Public Security hotline for tourist assistance and emergencies.', 5),
('Ministry of Health', '06 520 0230', 'health', 'Ministry of Health main line for health enquiries.', 6),
('Government Services (Sanad)', '06 500 8080', 'social', 'National call center for government e-services and citizen enquiries.', 7),
('Electricity Faults — JEPCO (Amman, Zarqa, Madaba, Balqa)', '116', 'utilities', 'JEPCO toll-free line for power faults and emergencies in its central area.', 8),
('Electricity — IDECO (North Jordan)', '080022005', 'utilities', 'Irbid District Electricity customer service for the northern governorates.', 9),
('Water & Wastewater Complaints', '117116', 'utilities', 'Unified national water hotline (Miyahuna, Yarmouk & Aqaba water companies).', 10);
