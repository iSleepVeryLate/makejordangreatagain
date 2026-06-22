-- =====================================================================
-- Jordan Trivia question bank. Run AFTER 0001_init.sql.
-- answer_idx is the 0-based index into the choices array.
-- Safe to re-run: it clears and reloads the question bank.
-- =====================================================================
truncate table public.trivia_questions;

insert into public.trivia_questions (category, question, choices, answer_idx, difficulty) values
('geography', 'What is the capital of Jordan?', '["Irbid","Amman","Zarqa","Aqaba"]', 1, 1),
('geography', 'Which famous ancient city carved into rose-red rock is in Jordan?', '["Petra","Jerash","Palmyra","Baalbek"]', 0, 1),
('geography', 'Jordan''s only coastal city, on the Red Sea, is:', '["Aqaba","Madaba","Salt","Karak"]', 0, 1),
('geography', 'The lowest point on Earth''s land surface, bordering Jordan, is the:', '["Dead Sea","Sea of Galilee","Red Sea","Caspian Sea"]', 0, 1),
('geography', 'Which desert in southern Jordan is famous for its red sand and was a filming location for many movies?', '["Wadi Rum","Sahara","Negev","Wadi Mujib"]', 0, 1),
('geography', 'Roughly how many governorates does Jordan have?', '["6","9","12","15"]', 2, 2),
('geography', 'The Jordan River forms part of the border between Jordan and which country?', '["Egypt","Iraq","Israel/Palestine","Saudi Arabia"]', 2, 2),
('geography', 'Which northern Jordanian city is known for its well-preserved Roman ruins?', '["Jerash","Aqaba","Maan","Tafilah"]', 0, 2),
('geography', 'Mount Nebo, where Moses is said to have viewed the Promised Land, is near which town?', '["Madaba","Ajloun","Ramtha","Jarash"]', 0, 2),
('geography', 'Which body of water borders Jordan to the far south-west?', '["Mediterranean Sea","Red Sea","Black Sea","Persian Gulf"]', 1, 1),

('food', 'What is the national dish of Jordan, made with lamb cooked in fermented dried yogurt?', '["Mansaf","Maqluba","Kabsa","Koshari"]', 0, 1),
('food', 'Mansaf is traditionally served over which grain?', '["Bulgur","Rice","Couscous","Freekeh"]', 1, 1),
('food', 'The dried fermented yogurt used in mansaf is called:', '["Labneh","Jameed","Shanklish","Ayran"]', 1, 2),
('food', 'Which sweet cheese-based dessert soaked in syrup is popular across Jordan?', '["Kunafa","Baklava","Basbousa","Maamoul"]', 0, 1),
('food', 'Maqluba literally means what in Arabic?', '["Upside-down","Mixed","Golden","Layered"]', 0, 2),
('food', 'Falafel is most commonly made from which legume in the Levant?', '["Lentils","Chickpeas","Black beans","Peas"]', 1, 1),
('food', 'Which herb-and-spice blend, often eaten with olive oil and bread, is a breakfast staple?', '["Zaatar","Sumac","Baharat","Dukkah"]', 0, 1),

('culture', 'What is the official language of Jordan?', '["Turkish","Arabic","Persian","Aramaic"]', 1, 1),
('culture', 'The Jordanian flag contains a star with how many points?', '["5","6","7","8"]', 2, 2),
('culture', 'The traditional checkered headscarf worn by Jordanian men is the:', '["Keffiyeh","Turban","Fez","Beret"]', 0, 1),
('culture', 'What currency is used in Jordan?', '["Dinar","Riyal","Pound","Lira"]', 0, 1),
('culture', 'Which red-and-white keffiyeh pattern is especially associated with Jordan?', '["Shemagh","Houndstooth","Paisley","Tartan"]', 0, 2),

('history', 'Who is the current King of Jordan (as of the 2020s)?', '["King Hussein","King Abdullah II","King Talal","King Faisal"]', 1, 1),
('history', 'In which year did Jordan gain full independence?', '["1921","1946","1952","1967"]', 1, 2),
('history', 'Petra was built by which ancient civilization?', '["Romans","Nabataeans","Phoenicians","Assyrians"]', 1, 2),
('history', 'Jordan''s long-reigning king before Abdullah II, known as a peacemaker, was:', '["King Hussein","King Hassan","King Ghazi","King Zeid"]', 0, 2),
('history', 'What was the historical name of the region/state before it became the Hashemite Kingdom of Jordan?', '["Transjordan","Mesopotamia","Levantia","Canaan"]', 0, 2),
('history', 'Petra is often nicknamed the:', '["Golden City","Rose City","Lost City of Stone","White City"]', 1, 1);
