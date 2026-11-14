// A versioned, searchable selection of specific interests. These are stable tags,
// not a live IMDb or Spotify ranking: chart positions change far more often than profiles.
export type ExpandedEntry = readonly [code: string, label: string, emoji: string, aliases?: string, labelRu?: string];
function names(prefix: string, emoji: string, lines: string): ExpandedEntry[] {
  return lines.trim().split('\n').map(line => {
    const [code, label, ru] = line.trim().split('|');
    return [`${prefix}_${code}`, label, emoji, undefined, ru || label];
  });
}

export const expandedInterests: Record<string, readonly ExpandedEntry[]> = {
  sports: [
    // Summer Olympic sports and disciplines, plus winter sports and LA28 additions.
    ['archery', 'Archery', '🏹', '', 'Стрельба из лука'],
    ['athletics', 'Athletics', '🏃', 'track and field', 'Лёгкая атлетика'],
    ['sprinting', 'Sprinting', '🏃', '100m|200m|short distance running', 'Спринт'],
    ['marathon', 'Marathon', '🏃', 'marathon running|42k', 'Марафон'],
    ['race_walking', 'Race walking', '🚶', 'athletic walking', 'Спортивная ходьба'],
    ['artistic_swimming', 'Artistic swimming', '🏊', 'synchronized swimming|synchronised swimming', 'Синхронное плавание'],
    ['diving_sport', 'Diving', '🤿', 'springboard diving|platform diving', 'Прыжки в воду'],
    ['water_polo', 'Water polo', '🤽', '', 'Водное поло'],
    ['basketball_3x3', '3x3 basketball', '🏀', 'three on three basketball|street basketball', 'Баскетбол 3×3'],
    ['beach_volleyball', 'Beach volleyball', '🏐', '', 'Пляжный волейбол'],
    ['canoe_sprint', 'Canoe sprint', '🛶', 'sprint kayaking|flatwater canoeing', 'Гребля на байдарках и каноэ'],
    ['canoe_slalom', 'Canoe slalom', '🛶', 'whitewater slalom', 'Гребной слалом'],
    ['rowing', 'Rowing', '🚣', 'crew|rowing club', 'Академическая гребля'],
    ['track_cycling', 'Track cycling', '🚴', 'velodrome', 'Велотрек'],
    ['bmx_racing', 'BMX racing', '🚴', 'bmx race', 'BMX-гонки'],
    ['bmx_freestyle', 'BMX freestyle', '🚴', 'bmx park', 'BMX-фристайл'],
    ['equestrian', 'Equestrian sport', '🐎', 'horse riding|show jumping|dressage|eventing', 'Конный спорт'],
    ['fencing', 'Fencing', '🤺', 'foil|epee|sabre', 'Фехтование'],
    ['artistic_gymnastics', 'Artistic gymnastics', '🤸', 'gymnastics|gymnast', 'Спортивная гимнастика'],
    ['rhythmic_gymnastics', 'Rhythmic gymnastics', '🤸', '', 'Художественная гимнастика'],
    ['trampoline_gymnastics', 'Trampoline', '🤸', 'trampolining', 'Прыжки на батуте'],
    ['golf', 'Golf', '⛳', '', 'Гольф'],
    ['handball', 'Handball', '🤾', '', 'Гандбол'],
    ['field_hockey', 'Field hockey', '🏑', 'hockey on grass', 'Хоккей на траве'],
    ['judo', 'Judo', '🥋', '', 'Дзюдо'],
    ['modern_pentathlon', 'Modern pentathlon', '🤺', 'pentathlon', 'Современное пятиборье'],
    ['rugby_sevens', 'Rugby sevens', '🏉', 'rugby 7s', 'Регби-7'],
    ['taekwondo', 'Taekwondo', '🥋', 'tae kwon do', 'Тхэквондо'],
    ['table_tennis', 'Table tennis', '🏓', 'ping pong', 'Настольный теннис'],
    ['sport_shooting', 'Sport shooting', '🎯', 'shooting sports|rifle|pistol|clay shooting', 'Спортивная стрельба'],
    ['sailing_sport', 'Sailing sport', '⛵', 'sailing|dinghy sailing|sail racing', 'Парусный спорт'],
    ['triathlon', 'Triathlon', '🏊', 'swim bike run', 'Триатлон'],
    ['wrestling', 'Wrestling', '🤼', 'freestyle wrestling|greco roman wrestling', 'Борьба'],
    ['sport_climbing', 'Sport climbing', '🧗', 'speed climbing|lead climbing|bouldering', 'Спортивное скалолазание'],
    ['breaking', 'Breaking', '🕺', 'breakdance|b-boying', 'Брейкинг'],
    ['karate', 'Karate', '🥋', '', 'Карате'],
    ['alpine_skiing', 'Alpine skiing', '⛷️', 'downhill skiing|slalom', 'Горные лыжи'],
    ['cross_country_skiing', 'Cross-country skiing', '🎿', 'xc skiing|nordic skiing', 'Лыжные гонки'],
    ['freestyle_skiing', 'Freestyle skiing', '🎿', 'moguls|aerial skiing|ski cross', 'Фристайл на лыжах'],
    ['biathlon', 'Biathlon', '🎿', '', 'Биатлон'],
    ['bobsleigh', 'Bobsleigh', '🛷', 'bobsled', 'Бобслей'],
    ['curling', 'Curling', '🥌', '', 'Кёрлинг'],
    ['figure_skating', 'Figure skating', '⛸️', 'ice skating|pair skating', 'Фигурное катание'],
    ['ice_hockey', 'Ice hockey', '🏒', 'hockey', 'Хоккей с шайбой'],
    ['luge', 'Luge', '🛷', '', 'Санный спорт'],
    ['nordic_combined', 'Nordic combined', '🎿', '', 'Лыжное двоеборье'],
    ['short_track', 'Short track speed skating', '⛸️', 'short track', 'Шорт-трек'],
    ['skeleton', 'Skeleton', '🛷', '', 'Скелетон'],
    ['ski_jumping', 'Ski jumping', '🎿', '', 'Прыжки с трамплина'],
    ['ski_mountaineering', 'Ski mountaineering', '🎿', 'skimo', 'Ски-альпинизм'],
    ['speed_skating', 'Speed skating', '⛸️', '', 'Конькобежный спорт'],
    ['baseball', 'Baseball', '⚾', '', 'Бейсбол'],
    ['softball', 'Softball', '🥎', '', 'Софтбол'],
    ['cricket', 'Cricket', '🏏', 't20 cricket', 'Крикет'],
    ['flag_football', 'Flag football', '🏈', '', 'Флаг-футбол'],
    ['lacrosse', 'Lacrosse', '🥍', '', 'Лакросс'],
    ['squash', 'Squash', '🎾', '', 'Сквош'],
  ],
  food: [
    ['vegan', 'Vegan', '🥬', 'vegan diet|veganism', 'Веган'],
    ['vegetarian', 'Vegetarian', '🥦', 'vegetarian diet|vegetarianism', 'Вегетарианец'],
    ['pescatarian', 'Pescatarian', '🐟', 'pescetarian', 'Пескетарианец'],
    ['gluten_free', 'Gluten-free', '🌾', 'gluten free diet', 'Без глютена'],
  ],
  music: [
    ['r_and_b', 'R&B', '🎙️', 'rhythm and blues|rnb', 'R&B'],
    ['afrobeats', 'Afrobeats', '🥁', 'afropop', 'Афробитс'],
    ['reggaeton', 'Reggaeton', '🎧', 'reggaetón', 'Реггетон'],
    ['latin_pop', 'Latin pop', '🎤', '', 'Латиноамериканский поп'],
    ['country_music', 'Country music', '🪕', '', 'Кантри'],
    ['blues', 'Blues', '🎸', '', 'Блюз'],
    ['gospel', 'Gospel', '🎙️', '', 'Госпел'],
    ['disco', 'Disco', '🪩', '', 'Диско'],
    ['hyperpop', 'Hyperpop', '🎛️', '', 'Хайперпоп'],
    ['city_pop', 'City pop', '🌃', 'japanese city pop', 'Сити-поп'],
    ['jpop', 'J-pop', '🎤', 'japanese pop', 'Джей-поп'],
    ['grime', 'Grime', '🎤', '', 'Грайм'],
    ['phonk', 'Phonk', '🎧', '', 'Фонк'],
    ['post_rock', 'Post-rock', '🎸', '', 'Построк'],
    ['bossa_nova', 'Bossa nova', '🎸', '', 'Босса-нова'],
    ...names('artist', '🎵', `bad_bunny|Bad Bunny|Бэд Банни
taylor_swift|Taylor Swift|Тейлор Свифт
the_weeknd|The Weeknd|Уикенд
drake|Drake|Дрейк
billie_eilish|Billie Eilish|Билли Айлиш
bruno_mars|Bruno Mars|Бруно Марс
ariana_grande|Ariana Grande|Ариана Гранде
arijit_singh|Arijit Singh|Арджит Сингх
fuerza_regida|Fuerza Regida
lady_gaga|Lady Gaga|Леди Гага
sabrina_carpenter|Sabrina Carpenter|Сабрина Карпентер
sza|SZA
dua_lipa|Dua Lipa|Дуа Липа
olivia_rodrigo|Olivia Rodrigo|Оливия Родриго
lana_del_rey|Lana Del Rey|Лана Дель Рей
post_malone|Post Malone|Пост Мэлоун
travis_scott|Travis Scott|Трэвис Скотт
tyler_the_creator|Tyler, The Creator|Тайлер, The Creator
frank_ocean|Frank Ocean|Фрэнк Оушен
the_beatles|The Beatles|Битлз
queen|Queen|Квин
pink_floyd|Pink Floyd|Пинк Флойд
led_zeppelin|Led Zeppelin|Лед Зеппелин
the_rolling_stones|The Rolling Stones|Роллинг Стоунз
fleetwood_mac|Fleetwood Mac|Флитвуд Мак
nirvana|Nirvana|Нирвана
the_cure|The Cure|The Cure
the_smiths|The Smiths|The Smiths
joy_division|Joy Division|Joy Division
new_order|New Order|New Order
the_strokes|The Strokes|The Strokes
arctic_monkeys|Arctic Monkeys|Arctic Monkeys
the_1975|The 1975
oasis|Oasis|Оазис
blur|Blur|Blur
gorillaz|Gorillaz|Gorillaz
arcade_fire|Arcade Fire|Arcade Fire
tame_impala|Tame Impala|Tame Impala
bon_iver|Bon Iver|Bon Iver
phoebe_bridgers|Phoebe Bridgers|Фиби Бриджерс
boygenius|boygenius|boygenius
mitski|Mitski|Мицки
laufey|Laufey|Лауфей
hozier|Hozier|Хозиер
adele|Adele|Адель
amy_winehouse|Amy Winehouse|Эми Уайнхаус
rihanna|Rihanna|Рианна
beyonce|Beyoncé|Бейонсе
jay_z|JAY-Z|Джей-Зи
kanye_west|Ye (Kanye West)|Канье Уэст
eminem|Eminem|Эминем
nas|Nas|Nas
outkast|OutKast|OutKast
missy_elliott|Missy Elliott|Мисси Эллиотт
lauryn_hill|Lauryn Hill|Лорин Хилл
anderson_paak|Anderson .Paak|Андерсон Пак
childish_gambino|Childish Gambino|Чайлдиш Гамбино
doja_cat|Doja Cat|Доджа Кэт
megan_thee_stallion|Megan Thee Stallion|Меган Ти Сталлион
rosalia|ROSALÍA|Росалия
shakira|Shakira|Шакира
karol_g|Karol G|Кароль Джи
j_balvin|J Balvin|Джей Бальвин
anitta|Anitta|Анитта
burna_boy|Burna Boy|Бурна Бой
wizkid|Wizkid|Wizkid
tems|Tems|Tems
fela_kuti|Fela Kuti|Фела Кути
stromae|Stromae|Стромай
angela|Angèle|Анжель
aya_nakamura|Aya Nakamura|Айя Накамура
seventeen|SEVENTEEN
bts|BTS
blackpink|BLACKPINK
newjeans|NewJeans
stray_kids|Stray Kids
twice|TWICE
aespa|aespa
iu|IU
yoasobi|YOASOBI
utada_hikaru|Hikaru Utada|Хикару Утада
king_gnu|King Gnu
one_ok_rock|ONE OK ROCK
the_marias|The Marías|The Marías
khruangbin|Khruangbin|Khruangbin
men_i_trust|Men I Trust
beach_house|Beach House|Beach House
cocteau_twins|Cocteau Twins|Cocteau Twins
slowdive|Slowdive|Slowdive
my_bloody_valentine|My Bloody Valentine|My Bloody Valentine
the_national|The National|The National
sigur_ros|Sigur Rós|Sigur Rós
aurora|AURORA|Аврора
enya|Enya|Эния
max_richter|Max Richter|Макс Рихтер
ludovico_einaudi|Ludovico Einaudi|Людовико Эйнауди
hans_zimmer|Hans Zimmer|Ханс Циммер
john_williams|John Williams|Джон Уильямс
miles_davis|Miles Davis|Майлз Дэвис
john_coltrane|John Coltrane|Джон Колтрейн
herbie_hancock|Herbie Hancock|Херби Хэнкок
ella_fitzgerald|Ella Fitzgerald|Элла Фицджеральд
bill_evans|Bill Evans|Билл Эванс
chet_baker|Chet Baker|Чет Бейкер
four_tet|Four Tet|Four Tet
fred_again|Fred again..|Fred again..
skrillex|Skrillex|Skrillex
deadmau5|deadmau5|deadmau5
flume|Flume|Flume
odesza|ODESZA|ODESZA
calvin_harris|Calvin Harris|Кэлвин Харрис
tiesto|Tiësto|Тиесто
armin_van_buuren|Armin van Buuren|Армин ван Бюрен
kraftwerk|Kraftwerk|Kraftwerk
the_chemical_brothers|The Chemical Brothers|The Chemical Brothers
the_prodigy|The Prodigy|The Prodigy
underworld|Underworld|Underworld
caribou|Caribou|Caribou
bonobo|Bonobo|Bonobo
floating_points|Floating Points|Floating Points
nils_frahm|Nils Frahm|Нильс Фрам
jon_hopkins|Jon Hopkins|Джон Хопкинс
jamie_xx|Jamie xx|Jamie xx
o_p_n|Oneohtrix Point Never|Oneohtrix Point Never
arca|Arca|Arca
grimes|Grimes|Граймс
caroline_polachek|Caroline Polachek|Кэролайн Полачек`),
  ],
  art: [
    ['watercolor', 'Watercolor painting', '🎨', 'watercolour|aquarelle', 'Акварель'],
    ['oil_painting', 'Oil painting', '🖌️', 'oils|oil paints', 'Масляная живопись'],
    ['acrylic_painting', 'Acrylic painting', '🎨', 'acrylics', 'Акриловая живопись'],
    ['gouache', 'Gouache', '🎨', '', 'Гуашь'],
    ['pastels', 'Pastels', '🖍️', 'soft pastels|oil pastels', 'Пастель'],
    ['charcoal_drawing', 'Charcoal drawing', '✏️', 'charcoal sketching', 'Рисунок углём'],
    ['ink_drawing', 'Ink drawing', '🖋️', 'pen and ink', 'Рисунок тушью'],
    ['manga_drawing', 'Drawing manga', '✏️', 'manga art|draw manga|making manga', 'Рисую мангу'],
    ['digital_illustration', 'Digital illustration', '🖥️', 'digital painting|procreate', 'Цифровая иллюстрация'],
    ['concept_art', 'Concept art', '🖼️', 'character design|environment design', 'Концепт-арт'],
    ['comic_drawing', 'Drawing comics', '✏️', 'making comics|comics art', 'Рисую комиксы'],
    ['calligraphy', 'Calligraphy', '🖋️', 'lettering|hand lettering', 'Каллиграфия'],
    ['linocut', 'Linocut', '🖼️', 'linoleum print|lino printing', 'Линогравюра'],
    ['screen_printing', 'Screen printing', '🖼️', 'silkscreen|serigraphy', 'Шелкография'],
    ['watercolor_sketching', 'Watercolor sketching', '🎨', '', 'Акварельные скетчи'],
    ['art_history', 'Art history', '🏛️', 'history of art', 'История искусства'],
    ['impressionism', 'Impressionism', '🖼️', 'impressionist art', 'Импрессионизм'],
    ['surrealism', 'Surrealism', '🌀', 'surrealist art', 'Сюрреализм'],
    ['street_art_making', 'Making street art', '🎨', 'painting murals|graffiti art', 'Создаю стрит-арт'],
  ],
  creative: [
    ['bass_guitar', 'Bass guitar', '🎸', 'bass player|electric bass', 'Бас-гитара'],
    ['electric_guitar', 'Electric guitar', '🎸', 'electric guitarist', 'Электрогитара'],
    ['acoustic_guitar', 'Acoustic guitar', '🎸', 'acoustic guitarist', 'Акустическая гитара'],
    ['ukulele', 'Ukulele', '🪕', '', 'Укулеле'],
    ['violin', 'Violin', '🎻', 'fiddle', 'Скрипка'],
    ['viola', 'Viola', '🎻', '', 'Альт'],
    ['cello', 'Cello', '🎻', 'violoncello', 'Виолончель'],
    ['double_bass', 'Double bass', '🎻', 'upright bass', 'Контрабас'],
    ['saxophone', 'Saxophone', '🎷', 'sax', 'Саксофон'],
    ['trumpet', 'Trumpet', '🎺', '', 'Труба'],
    ['trombone', 'Trombone', '🎺', '', 'Тромбон'],
    ['clarinet', 'Clarinet', '🎶', '', 'Кларнет'],
    ['flute', 'Flute', '🪈', '', 'Флейта'],
    ['oboe', 'Oboe', '🎶', '', 'Гобой'],
    ['harmonica', 'Harmonica', '🎶', 'mouth organ', 'Губная гармоника'],
    ['accordion', 'Accordion', '🪗', '', 'Аккордеон'],
    ['banjo', 'Banjo', '🪕', '', 'Банджо'],
    ['harp', 'Harp', '🎶', '', 'Арфа'],
    ['synthesizer', 'Synthesizer', '🎹', 'synth|synths', 'Синтезатор'],
    ['keyboard_instrument', 'Keyboard', '🎹', 'playing keyboard', 'Клавишные'],
    ['percussion', 'Percussion', '🥁', 'percussion instruments', 'Перкуссия'],
    ['beatmaking', 'Beatmaking', '🎛️', 'making beats|beat maker', 'Битмейкинг'],
    ['choir_singing', 'Choir singing', '🎤', 'choral singing', 'Хоровое пение'],
    ['songwriting', 'Songwriting', '✍️', 'writing songs', 'Сочиняю песни'],
    ['embroidery', 'Embroidery', '🪡', 'embroidering', 'Вышивка'],
    ['crochet', 'Crochet', '🧶', '', 'Вязание крючком'],
    ['pottery_wheel', 'Pottery wheel', '🏺', 'wheel throwing', 'Гончарный круг'],
    ['leatherworking', 'Leatherworking', '🪡', 'leather craft', 'Работа с кожей'],
  ],
  films: [
    ['thrillers', 'Thrillers', '🔪', 'thriller films|suspense films', 'Триллеры'],
    ['comedy_films', 'Comedy films', '😄', 'film comedy|comedy movies', 'Комедии'],
    ['romantic_comedies', 'Romantic comedies', '💞', 'romcom|rom com', 'Романтические комедии'],
    ['drama_films', 'Drama films', '🎭', 'drama movies', 'Драмы'],
    ['action_films', 'Action films', '💥', 'action movies', 'Боевики'],
    ['fantasy_films', 'Fantasy films', '🪄', 'fantasy movies', 'Фэнтези-фильмы'],
    ['crime_films', 'Crime films', '🕵️', 'crime movies|gangster films', 'Криминальное кино'],
    ['mystery_films', 'Mystery films', '🔍', 'mystery movies|detective films', 'Детективы'],
    ['historical_films', 'Historical films', '🏛️', 'period films|period dramas', 'Историческое кино'],
    ['musical_films', 'Musicals', '🎶', 'musical movies', 'Мюзиклы'],
    ['western_films', 'Westerns', '🤠', 'western movies', 'Вестерны'],
    ['war_films', 'War films', '🪖', 'war movies', 'Военное кино'],
    ['mockumentaries', 'Mockumentaries', '🎥', 'fake documentaries', 'Псевдодокументальное кино'],
    ['found_footage', 'Found footage', '📹', 'found footage films', 'Найденная плёнка'],
    ['stop_motion', 'Stop-motion animation', '🎞️', 'stop motion', 'Кукольная анимация'],
    ['korean_cinema', 'Korean cinema', '🎬', 'korean films|korean movies', 'Корейское кино'],
    ['japanese_cinema', 'Japanese cinema', '🎬', 'japanese films|japanese movies', 'Японское кино'],
    ['french_new_wave', 'French New Wave', '🎬', 'nouvelle vague', 'Французская новая волна'],
    ...names('director', '🎬', `christopher_nolan|Christopher Nolan|Кристофер Нолан
quentin_tarantino|Quentin Tarantino|Квентин Тарантино
martin_scorsese|Martin Scorsese|Мартин Скорсезе
steven_spielberg|Steven Spielberg|Стивен Спилберг
greta_gerwig|Greta Gerwig|Грета Гервиг
denis_villeneuve|Denis Villeneuve|Дени Вильнёв
guillermo_del_toro|Guillermo del Toro|Гильермо дель Торо
alfonso_cuaron|Alfonso Cuarón|Альфонсо Куарон
alejandro_inarritu|Alejandro G. Iñárritu|Алехандро Гонсалес Иньярриту
pedro_almodovar|Pedro Almodóvar|Педро Альмодовар
park_chan_wook|Park Chan-wook|Пак Чхан-ук
hiro_koreeda|Hirokazu Kore-eda|Хирокадзу Корээда
ryusuke_hamaguchi|Ryusuke Hamaguchi|Рюсукэ Хамагути
akira_kurosawa|Akira Kurosawa|Акира Куросава
yasujiro_ozu|Yasujirō Ozu|Ясудзиро Одзу
isao_takahata|Isao Takahata|Исао Такахата
makoto_shinkai|Makoto Shinkai|Макото Синкай
mamoru_hosoda|Mamoru Hosoda|Мамору Хосода
sofia_coppola|Sofia Coppola|София Коппола
francis_ford_coppola|Francis Ford Coppola|Фрэнсис Форд Коппола
stanley_kubrick|Stanley Kubrick|Стэнли Кубрик
ridley_scott|Ridley Scott|Ридли Скотт
tony_scott|Tony Scott|Тони Скотт
james_cameron|James Cameron|Джеймс Кэмерон
george_miller|George Miller|Джордж Миллер
george_lucas|George Lucas|Джордж Лукас
peter_jackson|Peter Jackson|Питер Джексон
taika_waititi|Taika Waititi|Тайка Вайтити
chloe_zhao|Chloé Zhao|Хлоя Чжао
barry_jenkins|Barry Jenkins|Барри Дженкинс
jordan_peele|Jordan Peele|Джордан Пил
ari_aster|Ari Aster|Ари Астер
robert_eggers|Robert Eggers|Роберт Эггерс
yorgos_lanthimos|Yorgos Lanthimos|Йоргос Лантимос
ruben_ostlund|Ruben Östlund|Рубен Эстлунд
lukas_dhont|Lukas Dhont|Лукас Донт
justine_triet|Justine Triet|Жюстин Трие
alice_rohrwacher|Alice Rohrwacher|Аличе Рорвахер
paolo_sorrentino|Paolo Sorrentino|Паоло Соррентино
federico_fellini|Federico Fellini|Федерико Феллини
ingmar_bergman|Ingmar Bergman|Ингмар Бергман
abbas_kiarostami|Abbas Kiarostami|Аббас Киаростами
asghar_farhadi|Asghar Farhadi|Асгар Фархади
anurag_kashyap|Anurag Kashyap|Анураг Кашьяп
ss_rajamouli|S. S. Rajamouli|С. С. Раджамули
g_noe|Gaspar Noé|Гаспар Ноэ
terrence_malick|Terrence Malick|Терренс Малик
richard_linklater|Richard Linklater|Ричард Линклейтер
kelly_reichardt|Kelly Reichardt|Келли Райхардт
sean_baker|Sean Baker|Шон Бейкер
the_safdies|The Safdie Brothers|Братья Сэфди
ryan_coogler|Ryan Coogler|Райан Куглер
spike_lee|Spike Lee|Спайк Ли
gillian_armstrong|Gillian Armstrong|Джиллиан Армстронг
jane_campion|Jane Campion|Джейн Кэмпион
kathryn_bigelow|Kathryn Bigelow|Кэтрин Бигелоу
ava_duvernay|Ava DuVernay|Ава Дюверней
luc_besson|Luc Besson|Люк Бессон
jean_luc_godard|Jean-Luc Godard|Жан-Люк Годар
francois_truffaut|François Truffaut|Франсуа Трюффо`),
    ...names('actor', '🎭', `leonardo_dicaprio|Leonardo DiCaprio|Леонардо ДиКаприо
margot_robbie|Margot Robbie|Марго Робби
florence_pugh|Florence Pugh|Флоренс Пью
zendaya|Zendaya|Зендея
timothee_chalamet|Timothée Chalamet|Тимоти Шаламе
emma_stone|Emma Stone|Эмма Стоун
ryan_gosling|Ryan Gosling|Райан Гослинг
cillian_murphy|Cillian Murphy|Киллиан Мёрфи
robert_downey_jr|Robert Downey Jr.|Роберт Дауни-младший
scarlett_johansson|Scarlett Johansson|Скарлетт Йоханссон
viola_davis|Viola Davis|Виола Дэвис
cate_blanchett|Cate Blanchett|Кейт Бланшетт
michelle_yeoh|Michelle Yeoh|Мишель Йео
paul_mescal|Paul Mescal|Пол Мескал
andrew_scott|Andrew Scott|Эндрю Скотт
colman_domingo|Colman Domingo|Колман Доминго
pedro_pascal|Pedro Pascal|Педро Паскаль
oscar_isaac|Oscar Isaac|Оскар Айзек
adam_driver|Adam Driver|Адам Драйвер
joaquin_phoenix|Joaquin Phoenix|Хоакин Феникс
christian_bale|Christian Bale|Кристиан Бейл
brad_pitt|Brad Pitt|Брэд Питт
angelina_jolie|Angelina Jolie|Анджелина Джоли
tom_cruise|Tom Cruise|Том Круз
keanu_reeves|Keanu Reeves|Киану Ривз
denzel_washington|Denzel Washington|Дензел Вашингтон
samuel_l_jackson|Samuel L. Jackson|Сэмюэл Л. Джексон
morgan_freeman|Morgan Freeman|Морган Фриман
meryl_streep|Meryl Streep|Мэрил Стрип
frances_mcdormand|Frances McDormand|Фрэнсис Макдорманд
natalie_portman|Natalie Portman|Натали Портман
amy_adams|Amy Adams|Эми Адамс
greta_lee|Greta Lee|Грета Ли
glen_powell|Glen Powell|Глен Пауэлл
jonathan_bailey|Jonathan Bailey|Джонатан Бейли
paul_dano|Paul Dano|Пол Дано
robert_pattinson|Robert Pattinson|Роберт Паттинсон
kristen_stewart|Kristen Stewart|Кристен Стюарт
daniel_kaluuya|Daniel Kaluuya|Дэниел Калуя
lakeith_stanfield|LaKeith Stanfield|Лакит Стэнфилд
lupita_nyongo|Lupita Nyong'o|Лупита Нионго
song_kang_ho|Song Kang-ho|Сон Кан-хо
choi_woo_shik|Choi Woo-shik|Чхве У-щик
park_so_dam|Park So-dam|Пак Со-дам
gong_yoo|Gong Yoo|Кон Ю
tony_leung|Tony Leung|Тони Люн
maggie_cheung|Maggie Cheung|Мэгги Чун
jackie_chan|Jackie Chan|Джеки Чан
michelle_williams|Michelle Williams|Мишель Уильямс
saoirse_ronan|Saoirse Ronan|Сирша Ронан
anya_taylor_joy|Anya Taylor-Joy|Аня Тейлор-Джой
tilda_swinton|Tilda Swinton|Тильда Суинтон
isabelle_huppert|Isabelle Huppert|Изабель Юппер
juliette_binoche|Juliette Binoche|Жюльет Бинош
lea_seydoux|Léa Seydoux|Леа Сейду
marion_cotillard|Marion Cotillard|Марион Котийяр
penelope_cruz|Penélope Cruz|Пенелопа Крус
javier_bardem|Javier Bardem|Хавьер Бардем
gael_garcia_bernal|Gael García Bernal|Гаэль Гарсиа Берналь
diego_luna|Diego Luna|Диего Луна`),
    ...names('screen', '🌸', `one_piece|One Piece|Ван-Пис
attack_on_titan|Attack on Titan|Атака титанов
demon_slayer|Demon Slayer|Клинок, рассекающий демонов
naruto|Naruto|Наруто
death_note|Death Note|Тетрадь смерти
fullmetal_alchemist|Fullmetal Alchemist|Стальной алхимик
cowboy_bebop|Cowboy Bebop|Ковбой Бибоп
evangelion|Neon Genesis Evangelion|Евангелион
chainsaw_man|Chainsaw Man|Человек-бензопила
jujutsu_kaisen|Jujutsu Kaisen|Магическая битва
spirited_away|Spirited Away|Унесённые призраками
totoro|My Neighbor Totoro|Мой сосед Тоторо
princess_mononoke|Princess Mononoke|Принцесса Мононоке
akira|Akira|Акира
perfect_blue|Perfect Blue|Идеальная грусть
ghost_in_the_shell|Ghost in the Shell|Призрак в доспехах
your_name|Your Name|Твоё имя
vinland_saga|Vinland Saga|Сага о Винланде
frieren|Frieren: Beyond Journey's End|Фрирен
mob_psycho_100|Mob Psycho 100|Моб Психо 100`),
    ...names('film', '🎞️', `parasite|Parasite|Паразиты
interstellar|Interstellar|Интерстеллар
inception|Inception|Начало
oppenheimer|Oppenheimer|Оппенгеймер
barbie|Barbie|Барби
pulp_fiction|Pulp Fiction|Криминальное чтиво
the_godfather|The Godfather|Крёстный отец
everything_everywhere|Everything Everywhere All at Once|Всё везде и сразу
eternal_sunshine|Eternal Sunshine of the Spotless Mind|Вечное сияние чистого разума
the_matrix|The Matrix|Матрица
blade_runner_2049|Blade Runner 2049|Бегущий по лезвию 2049
arrival|Arrival|Прибытие
la_la_land|La La Land|Ла-Ла Ленд
whiplash|Whiplash|Одержимость
moonlight|Moonlight|Лунный свет
before_sunrise|Before Sunrise|Перед рассветом
her|Her|Она
aftersun|Aftersun|Солнце моё
past_lives|Past Lives|Прошлые жизни
perfect_days|Perfect Days|Идеальные дни
the_grand_budapest_hotel|The Grand Budapest Hotel|Отель «Гранд Будапешт»
the_lobster|The Lobster|Лобстер
the_substance|The Substance|Субстанция
get_out|Get Out|Прочь
the_truman_show|The Truman Show|Шоу Трумана
the_social_network|The Social Network|Социальная сеть
chungking_express|Chungking Express|Чунгкингский экспресс
in_the_mood_for_love|In the Mood for Love|Любовное настроение
amelie|Amélie|Амели
portrait_of_a_lady_on_fire|Portrait of a Lady on Fire|Портрет девушки в огне
the_banshees_of_inisherin|The Banshees of Inisherin|Банши Инишерина
memories_of_murder|Memories of Murder|Воспоминания об убийстве
the_handmaiden|The Handmaiden|Служанка
oldboy|Oldboy|Олдбой
lady_bird|Lady Bird|Леди Бёрд`),
  ],
  books: [
    ['literary_fiction', 'Literary fiction', '📖', 'literary novels', 'Литературная проза'],
    ['mystery_books', 'Mystery novels', '🔍', 'detective novels|whodunits', 'Детективы'],
    ['thriller_books', 'Thriller novels', '🔪', 'thriller books', 'Триллеры'],
    ['horror_books', 'Horror books', '👻', 'horror novels', 'Хоррор'],
    ['historical_fiction', 'Historical fiction', '🏛️', 'historical novels', 'Исторические романы'],
    ['romance_books', 'Romance novels', '💞', 'romance books', 'Любовные романы'],
    ['romantasy', 'Romantasy', '🐉', 'romantic fantasy', 'Романтическое фэнтези'],
    ['memoirs', 'Memoirs', '📚', 'autobiographies', 'Мемуары'],
    ['biographies', 'Biographies', '📚', 'biography books', 'Биографии'],
    ['popular_science_books', 'Popular science books', '🔬', 'science nonfiction', 'Научпоп'],
    ['history_books', 'History books', '📜', 'history nonfiction', 'Исторические книги'],
    ['philosophy_books', 'Philosophy books', '💭', 'philosophical books', 'Книги по философии'],
    ['essays', 'Essays', '✍️', 'essay collections', 'Эссе'],
    ['graphic_novels', 'Graphic novels', '💬', '', 'Графические романы'],
    ['audiobooks', 'Audiobooks', '🎧', 'audio books', 'Аудиокниги'],
    ...names('author', '📚', `jane_austen|Jane Austen|Джейн Остин
virginia_woolf|Virginia Woolf|Вирджиния Вулф
george_orwell|George Orwell|Джордж Оруэлл
haruki_murakami|Haruki Murakami|Харуки Мураками
han_kang|Han Kang|Хан Ган
sally_rooney|Sally Rooney|Салли Руни
elena_ferrante|Elena Ferrante|Элена Ферранте
margaret_atwood|Margaret Atwood|Маргарет Этвуд
neil_gaiman|Neil Gaiman|Нил Гейман
brandon_sanderson|Brandon Sanderson|Брэндон Сандерсон
patrick_rothfuss|Patrick Rothfuss|Патрик Ротфусс
robin_hobb|Robin Hobb|Робин Хобб
jo_abercrombie|Joe Abercrombie|Джо Аберкромби
liu_cixin|Liu Cixin|Лю Цысинь
ted_chiang|Ted Chiang|Тед Чан
andy_weir|Andy Weir|Энди Вейер
frank_herbert|Frank Herbert|Фрэнк Герберт
isaac_asimov|Isaac Asimov|Айзек Азимов
philip_k_dick|Philip K. Dick|Филип К. Дик
ray_bradbury|Ray Bradbury|Рэй Брэдбери
agatha_christie|Agatha Christie|Агата Кристи
stephen_king|Stephen King|Стивен Кинг
harry_potter_author|J. K. Rowling|Дж. К. Роулинг
fyodor_dostoevsky|Fyodor Dostoevsky|Фёдор Достоевский
leo_tolstoy|Leo Tolstoy|Лев Толстой
vladimir_nabokov|Vladimir Nabokov|Владимир Набоков
mikhail_bulgakov|Mikhail Bulgakov|Михаил Булгаков
gabriel_garcia_marquez|Gabriel García Márquez|Габриэль Гарсиа Маркес
isabel_allende|Isabel Allende|Исабель Альенде
chimamanda_adichie|Chimamanda Ngozi Adichie|Чимаманда Нгози Адичи`),
    ...names('book', '📖', `dune|Dune|Дюна
lord_of_the_rings|The Lord of the Rings|Властелин колец
harry_potter|Harry Potter|Гарри Поттер
the_hobbit|The Hobbit|Хоббит
three_body_problem|The Three-Body Problem|Задача трёх тел
earthsea|Earthsea|Земноморье
discworld|Discworld|Плоский мир
foundation|Foundation|Основание
neuromancer|Neuromancer|Нейромант
hyperion|Hyperion|Гиперион
the_martian|The Martian|Марсианин
the_handmaids_tale|The Handmaid's Tale|Рассказ служанки
pride_and_prejudice|Pride and Prejudice|Гордость и предубеждение
crime_and_punishment|Crime and Punishment|Преступление и наказание
master_and_margarita|The Master and Margarita|Мастер и Маргарита
one_hundred_years_of_solitude|One Hundred Years of Solitude|Сто лет одиночества
normal_people|Normal People|Нормальные люди
fourth_wing|Fourth Wing|Четвёртое крыло
project_hail_mary|Project Hail Mary|Проект «Аве Мария»
the_name_of_the_wind|The Name of the Wind|Имя ветра`),
  ],
  games: [
    ...names('game', '🎮', `minecraft|Minecraft|Майнкрафт
roblox|Roblox|Роблокс
fortnite|Fortnite|Фортнайт
league_of_legends|League of Legends|Лига легенд
dota_2|Dota 2|Дота 2
counter_strike_2|Counter-Strike 2|Counter-Strike 2
valorant|Valorant|Валорант
elden_ring|Elden Ring|Elden Ring
baldurs_gate_3|Baldur's Gate 3|Baldur's Gate 3
stardew_valley|Stardew Valley|Stardew Valley
animal_crossing|Animal Crossing|Animal Crossing
genshin_impact|Genshin Impact|Genshin Impact
zelda_breath_of_the_wild|Zelda: Breath of the Wild|Zelda: Breath of the Wild
zelda_tears_of_the_kingdom|Zelda: Tears of the Kingdom|Zelda: Tears of the Kingdom
mario_kart|Mario Kart|Mario Kart
civilization|Civilization|Civilization
hades|Hades|Hades
hollow_knight|Hollow Knight|Hollow Knight
disco_elysium|Disco Elysium|Disco Elysium
the_witcher_3|The Witcher 3|Ведьмак 3
cyberpunk_2077|Cyberpunk 2077|Cyberpunk 2077
red_dead_redemption_2|Red Dead Redemption 2|Red Dead Redemption 2
gta_v|Grand Theft Auto V|GTA V
world_of_warcraft|World of Warcraft|World of Warcraft
final_fantasy_xiv|Final Fantasy XIV|Final Fantasy XIV
overwatch_2|Overwatch 2|Overwatch 2
apex_legends|Apex Legends|Apex Legends
rocket_league|Rocket League|Rocket League
dead_by_daylight|Dead by Daylight|Dead by Daylight
the_sims_4|The Sims 4|The Sims 4
terraria|Terraria|Terraria
factorio|Factorio|Factorio
rimworld|RimWorld|RimWorld
slay_the_spire|Slay the Spire|Slay the Spire
celeste|Celeste|Celeste
portal_2|Portal 2|Portal 2
among_us|Among Us|Among Us
pokemon|Pokémon|Покемон
warframe|Warframe|Warframe
destiny_2|Destiny 2|Destiny 2
helldivers_2|Helldivers 2|Helldivers 2
resident_evil|Resident Evil|Resident Evil
silent_hill|Silent Hill|Silent Hill
alan_wake_2|Alan Wake 2|Alan Wake 2
outer_wilds|Outer Wilds|Outer Wilds
sea_of_thieves|Sea of Thieves|Sea of Thieves
pokemon_go|Pokémon GO|Покемон GO
five_nights_at_freddys|Five Nights at Freddy's|Five Nights at Freddy's
mass_effect|Mass Effect|Mass Effect
dragon_age|Dragon Age|Dragon Age
the_last_of_us|The Last of Us|The Last of Us
god_of_war|God of War|God of War
sekiro|Sekiro|Sekiro
dark_souls|Dark Souls|Dark Souls
bloodborne|Bloodborne|Bloodborne
split_fiction|Split Fiction|Split Fiction
it_takes_two|It Takes Two|It Takes Two
the_binding_of_isaac|The Binding of Isaac|The Binding of Isaac
balatro|Balatro|Balatro
vampire_survivors|Vampire Survivors|Vampire Survivors`),
  ],
};

export const expandedTagLabelsRu: Record<string, string> = Object.fromEntries(
  Object.values(expandedInterests).flat().map(([code, label, , , ru]) => [code, ru || label]),
);
