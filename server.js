import express from 'express';
import Replicate from 'replicate';
import Anthropic from '@anthropic-ai/sdk';
import https from 'https';
import http from 'http';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR   = path.join(__dirname, 'data');
const PDFS_DIR   = path.join(DATA_DIR, 'pdfs');
const BOOKS_FILE = path.join(DATA_DIR, 'books.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

// Ensure dirs exist and load books DB + stats
await fsp.mkdir(PDFS_DIR, { recursive: true });
let booksDB = [];
try { booksDB = JSON.parse(await fsp.readFile(BOOKS_FILE, 'utf8')); } catch {}
let siteStats = { totalVisits: 0 };
try { siteStats = JSON.parse(await fsp.readFile(STATS_FILE, 'utf8')); } catch {}

async function saveBooks() {
  await fsp.writeFile(BOOKS_FILE, JSON.stringify(booksDB, null, 2));
}
async function saveStats() {
  await fsp.writeFile(STATS_FILE, JSON.stringify(siteStats));
}

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.static('public'));
app.use('/data/pdfs', express.static(PDFS_DIR));

// Track page visits
app.use((req, res, next) => {
  if (req.method === 'GET' && req.path === '/') {
    siteStats.totalVisits = (siteStats.totalVisits || 0) + 1;
    saveStats().catch(() => {});
  }
  next();
});

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Story worlds — each defines image + story direction
const THEMES = {
  jungle:   { imageBase: "lush jungle adventure, cute animals, tropical plants, vibrant greenery, exotic birds",       storyBase: "הרפתקה בג'ונגל — גילויים, חיות חמודות, אמץ ועזרה הדדית" },
  space:    { imageBase: "cute child astronaut, colorful planets, stars, rocket ship, space adventure",                storyBase: "מסע לחלל — גילוי כוכבים, פגישת יצורים ידידותיים מחלל" },
  ocean:    { imageBase: "underwater kingdom, friendly mermaid, colorful tropical fish, coral reef, treasure",         storyBase: "ממלכה מתחת לים — בת ים, אלמוגים ואוצרות נסתרים" },
  dragon:   { imageBase: "friendly dragon, magical forest, glowing cave, young hero, fantasy adventure",              storyBase: "דרקון שנראה מפחיד אבל לבו זהב — שיפוט לעומת פתיחת לב" },
  princess: { imageBase: "brave princess, enchanted castle, magical forest quest, adventure, sword or wand",          storyBase: "נסיכה אמיצה שפותרת הכל בעצמה — עצמאות ותושייה" },
  dinos:    { imageBase: "cute friendly dinosaurs, prehistoric jungle, volcanoes, ferns, colorful dinos together",    storyBase: "חברות בין דינוזאורים שונים — שיתוף פעולה למרות ההבדלים" },
  garden:   { imageBase: "magical garden, talking flowers, tiny fairies, butterflies, glowing mushrooms, nature",     storyBase: "גן קסום עם פיות, פרחים מדברים ופרפרים — קסמי טבע ופלא" },
  pirates:  { imageBase: "friendly young pirates, treasure map, sailing ship, tropical island, ocean adventure",      storyBase: "פיראטים עם לב טוב — הרפתקת ים, מפה לאוצר ועבודת צוות" },
  heroes:   { imageBase: "cute child superhero, colorful cape and costume, city rooftops, saving the day, powers",   storyBase: "ילד/ה שמגלה כוח מיוחד ומשתמש בו לעזור לאחרים — אחריות" },
  farm:     { imageBase: "cheerful farm animals, red barn, green fields, chickens cows pigs together, countryside",   storyBase: "יום בחווה — חיות עוזרות זו לזו, לימוד על שיתוף ואחריות" },
  wizard:   { imageBase: "magical wizard school, young witches and wizards, floating books, potions, wands, enchanted classroom", storyBase: "בית ספר לקסמים — ילד/ה לומד/ת את הלחש הראשון ומגלה שטעויות הן חלק מהלמידה" },
  robots:   { imageBase: "colorful friendly robots, workshop full of gears and inventions, cute mechanical friends, invention lab", storyBase: "מפעל הרובוטים — ילד ממציא רובוט חבר ולומד שדמיון וניסיונות הם הדרך לגדול" },
  custom:   { imageBase: null, storyBase: null }
};

const STORY_TEMPLATES = {
  jungle: {
    title: 'ג׳ונגל המסתורין',
    subtitle: 'הרפתקה בין העצים',
    characters: 'a 6-year-old boy with curly hair wearing an explorer vest and hat',
    moral: 'ידידות חדשה מחכה לך בכל פינה — צריך רק לפתוח את הלב',
    pages: [
      { page:1, text:'אלון נכנס אל הג׳ונגל הגדול.\nהעצים היו גבוהים מאוד וציפורים שרו סביבו.', image_prompt:'young boy stepping into the entrance of a lush jungle, looking up at tall trees with wonder and excitement' },
      { page:2, text:'פתאום קפץ קוף קטן מהענף.\n"שלום!" אמר הקוף, "אני צ׳יקו. בוא נשחק!"', image_prompt:'a small monkey jumping down from a tree branch toward the boy, both looking surprised and delighted' },
      { page:3, text:'צ׳יקו לקח את אלון אל נחל צלול.\nהם ראו דגים צבעוניים מתחת למים.', image_prompt:'boy and monkey sitting by a clear jungle stream, watching fish in the water, peaceful and happy' },
      { page:4, text:'לפתע נשמעה צעקה מרחוק.\nצ׳יקו נפל ונתקע בין שני ענפים.', image_prompt:'monkey stuck between two tree branches, looking scared, while the boy rushes to help' },
      { page:5, text:'אלון טיפס במהירות וחילץ את חברו.\nצ׳יקו חיבק אותו בשמחה.', image_prompt:'boy carefully freeing the monkey from the branches, monkey hugging boy gratefully on a tree' },
      { page:6, text:'לפנות ערב חזר אלון הביתה עם לב מלא.\nהוא ידע שמצא חבר לכל החיים.', image_prompt:'boy walking home through the jungle at sunset, waving goodbye to the monkey sitting on a branch' },
    ]
  },
  space: {
    title: 'מסע אל הכוכבים',
    subtitle: 'הרפתקה בין הגלקסיות',
    characters: 'a 7-year-old girl in a white spacesuit helmet, small and brave looking',
    moral: 'סקרנות ואומץ יוליכו אותך למקומות שלא חלמת עליהם',
    pages: [
      { page:1, text:'מיה עלתה על הרקטה הקטנה שלה.\nהיא ירתה לשמים ועפה בין הכוכבים.', image_prompt:'small child astronaut launching in a tiny rocket, stars all around, Earth visible below' },
      { page:2, text:'היא הגיעה לכוכב אדום ומוזר.\nעל הקרקע היו עצים של גביש כחול.', image_prompt:'child astronaut landing on a red planet with glowing blue crystal trees, looking curious' },
      { page:3, text:'יצור ירוק קטן יצא מאחד הסלעים.\n"שמי גלאקס," אמר, "ברוכה הבאה!"', image_prompt:'a small friendly green alien emerging from behind a rock, waving at the astronaut child' },
      { page:4, text:'גלאקס לימד אותה לגלוש על טבעות שבתאי.\nמיה צחקה מאושר.', image_prompt:'child astronaut and small alien sliding together on Saturn\'s rings like a slide, laughing with joy' },
      { page:5, text:'הגיע הזמן לחזור הביתה.\nמיה נתנה לגלאקס כוכב קטן שהביאה מכדור הארץ.', image_prompt:'child astronaut giving a tiny Earth rock/gift to the small alien, emotional farewell on the red planet' },
      { page:6, text:'היא חזרה לכדור הארץ עם חיוך גדול.\nהיא כבר ידעה לאן תטוס בפעם הבאה.', image_prompt:'rocket returning to Earth with child looking out the window at the blue planet, smiling' },
    ]
  },
  ocean: {
    title: 'ממלכת הים',
    subtitle: 'סוד מתחת לגלים',
    characters: 'a curious 6-year-old girl with short hair wearing a simple swimsuit',
    moral: 'כשאתה חוקר בעיניים פתוחות, כל מקום הוא ממלכה',
    pages: [
      { page:1, text:'נועה צללה לתוך הים הכחול.\nפתאום היא ראה שביל של פנינים מתחת למים.', image_prompt:'small girl diving underwater, following a trail of pearls, colorful fish swimming around her' },
      { page:2, text:'השביל הוביל אל ארמון של אלמוגים.\nדגים צבעוניים שמרו על הכניסה.', image_prompt:'an underwater coral castle with colorful fish guarding the entrance, girl approaching in wonder' },
      { page:3, text:'בת הים הקטנה טלי ברכה אותה בחמימות.\n"כבר חיכינו לך!" אמרה בשמחה.', image_prompt:'a small friendly mermaid with a big smile greeting the girl at the entrance to the coral castle' },
      { page:4, text:'טלי לימדה אותה לרקוד עם הדולפינים.\nהמים מסביב נצנצו כמו כסף.', image_prompt:'girl and young mermaid dancing gracefully with two playful dolphins in sparkling sunlit water' },
      { page:5, text:'בפינה אחת ישב צב ים ישן.\n"לחיות ביחד זה הקסם הגדול ביותר," לחש.', image_prompt:'ancient wise sea turtle speaking gently to the two girls, surrounded by a peaceful underwater garden' },
      { page:6, text:'נועה עלתה מהים עם לב מלא.\nהיא כבר ידעה שיש ממלכה שלמה מתחת לגלים.', image_prompt:'girl emerging from the ocean at sunset, looking back at the sea with a knowing smile, waves sparkling' },
    ]
  },
  dragon: {
    title: 'הדרקון שחיכה לחבר',
    subtitle: 'לא כל מה שנראה מפחיד באמת כך',
    characters: 'a small 6-year-old boy with round glasses and a backpack, looking curious but cautious',
    moral: 'אל תשפוט לפי המראה — לב הזהב מסתתר במקומות מפתיעים',
    pages: [
      { page:1, text:'יונתן מצא מערה מוארת באור סגול.\nמבפנים נשמעו נחרות גדולות.', image_prompt:'small boy with glasses approaching a glowing purple cave entrance, cautious but curious' },
      { page:2, text:'בתוך המערה ישב דרקון ירוק עצום.\nלפתע פתח עין אחת ובכה.', image_prompt:'a huge green dragon curled up in a cave, one eye open with a giant tear rolling down its cheek' },
      { page:3, text:'"אני בודד," נאנח הדרקון.\n"כולם בורחים ממני כי אני גדול וכי יש לי אש."', image_prompt:'giant dragon sitting sadly alone in cave while small villages are seen in the distance fleeing, dragon looks sorrowful' },
      { page:4, text:'יונתן ישב לצד הדרקון ולא ברח.\n"אני לא מפחד ממך," אמר, "אני יונתן."', image_prompt:'small boy sitting bravely beside the giant dragon, both looking at each other with curiosity and warmth' },
      { page:5, text:'הדרקון הדליק אש קטנה וחמימה.\nהם ישבו יחד וסיפרו סיפורים עד הלילה.', image_prompt:'boy and dragon sitting together by a small warm campfire inside the cave, sharing stories happily' },
      { page:6, text:'מאותו יום, יונתן ביקר בכל שבוע.\nלדרקון הייתה לראשונה חברה אמיתית.', image_prompt:'boy visiting the dragon weekly, dragon smiling warmly as boy arrives with a little gift in hand' },
    ]
  },
  princess: {
    title: 'הנסיכה שפתרה הכל',
    subtitle: 'אמיצות לא זקוקה לכתר',
    characters: 'a brave 7-year-old princess with a simple crown, wearing practical adventure clothes',
    moral: 'אמיצות ותושייה הם כלים חזקים יותר מכל חרב',
    pages: [
      { page:1, text:'הנסיכה ריבה לבשה מגפיים ויצאה להרפתקה.\nהיא לא חיכתה שמישהו יציל אותה.', image_prompt:'young princess in adventure boots and simple crown striding confidently out of castle gates alone' },
      { page:2, text:'בדרך היא מצאה ילד שבכה.\n"הכלב שלי לכוד בשיחים!" אמר.', image_prompt:'princess discovering a crying boy next to thick thorny bushes, a small dog visible trapped inside' },
      { page:3, text:'ריבה שלפה חרב קטנה וחתכה את השיחים.\nהכלב יצא ורץ אל בעליו בשמחה.', image_prompt:'princess carefully cutting through the thorny bushes with a small sword, determined face, dog peaking through' },
      { page:4, text:'המשיכה בדרך אל הגשר השבור.\n"אין עוברים!" זעק ענק קטן.', image_prompt:'princess standing confidently before a broken bridge, a small grumpy troll blocking the path' },
      { page:5, text:'ריבה הציעה לענק לבנות יחד גשר חדש.\nהוא חייך — לאף אחד לא הייתה רעיון כזה.', image_prompt:'princess and small troll working together cheerfully to repair the bridge with wooden planks' },
      { page:6, text:'ריבה חזרה הביתה עם שני חברים חדשים.\nהיא הוכיחה שנסיכה יכולה לפתור הכל לבד.', image_prompt:'princess walking home at sunset, the boy with dog on one side, small troll on the other, all smiling' },
    ]
  },
  dinos: {
    title: 'ילדי הדינוזאורים',
    subtitle: 'שונים אבל ביחד',
    characters: 'three small friendly dinosaurs: a tiny T-Rex, a long-necked Brachiosaurus baby, and a small Triceratops',
    moral: 'כשאנחנו שונים זה מזה — יחד אנחנו חזקים יותר',
    pages: [
      { page:1, text:'טרקס, ברכי וטריקו גרו ביער הפרהיסטורי.\nכל אחד היה שונה לחלוטין מהשניים האחרים.', image_prompt:'three small friendly dinosaurs standing together in a prehistoric jungle, looking at each other curiously' },
      { page:2, text:'יום אחד בא גשם גדול ושטף את הביצה שלהם.\n"מה נעשה עכשיו?" שאל טרקס בחשש.', image_prompt:'three baby dinosaurs looking worried as heavy rain floods their muddy nest, huddling together' },
      { page:3, text:'ברכי הצביע בצוואר הארוך שלו על עץ גבוה.\nשם, בענפים, הייתה פינה יבשה ובטוחה.', image_prompt:'the long-neck baby dinosaur stretching neck up high to spot a dry shelter in a tall tree, pointing' },
      { page:4, text:'טרקס עם הידיים הקצרות לא הצליח לטפס.\n"אני אעזור לך!" אמר טריקו, והוריד אותו בעדינות.', image_prompt:'small Triceratops helping the T-Rex climb up with its sturdy back and horns used as a step' },
      { page:5, text:'הם ישבו יחד על הענף ועקבו אחרי הגשם.\nהיה חם וטוב.', image_prompt:'all three tiny dinosaurs sitting cozily together on a large tree branch, watching rain fall peacefully below' },
      { page:6, text:'כשהגשם עצר, שחקו יחד בבוץ עד השקיעה.\nמאותו יום הם תמיד נשארו ביחד.', image_prompt:'three happy baby dinosaurs playing in mud puddles at sunset, splashing and laughing together' },
    ]
  },
  garden: {
    title: 'גן הפלאות',
    subtitle: 'כשהפרחים מדברים',
    characters: 'a small 5-year-old girl with pigtails and a flower crown, wearing a simple dress',
    moral: 'כל חי — גדול כקטן — ראוי לטיפול ולאהבה',
    pages: [
      { page:1, text:'דנה ירדה לגינה בבוקר ומצאה פרח עצוב.\n"מה קרה לך?" שאלה בחמלה.', image_prompt:'small girl bending down to look closely at a drooping wilting flower, her face showing concern' },
      { page:2, text:'"אני צמא מאוד," לחש הפרח.\n"הגשם לא בא כבר שלושה ימים."', image_prompt:'wilting flower with a tiny sad face, speaking to the girl, dry cracked soil around it' },
      { page:3, text:'דנה מיהרה להביא כד מים ושתה לפרח.\nהפרח זקף את ראשו ואמר: "תודה!"', image_prompt:'girl carefully watering the flower with a small watering can, flower slowly rising up happily' },
      { page:4, text:'ניצוץ של אור נפל מהפרח ופרפר קטן הופיע.\n"שכחת שיש גם אחרים שצמאים," אמר.', image_prompt:'a tiny butterfly appearing from a flower\'s glow, hovering near the girl and pointing at other wilting plants' },
      { page:5, text:'דנה הלכה לכל הגינה ושתתה כל פרח.\nהגינה כולה התעוררה ופרחה.', image_prompt:'girl happily watering many flowers in a garden, each flower perking up and blooming around her' },
      { page:6, text:'עד הערב הייתה הגינה מלאה בצבעים וריחות.\nדנה ישבה באמצע ופרפרים עפו סביבה.', image_prompt:'girl sitting in the middle of a fully blooming colorful garden at evening, butterflies dancing all around her' },
    ]
  },
  pirates: {
    title: 'הפיראטים בעלי הלב הטוב',
    subtitle: 'אוצר של ממש הוא לא זהב',
    characters: 'two young child pirates, a boy and a girl, wearing bandanas and small eye patches, friendly faces',
    moral: 'האוצר האמיתי הוא לא מה שאתה מוצא — אלא מי שנמצא לצדך',
    pages: [
      { page:1, text:'עמי ותמר הפיראטים יצאו לים בסירה קטנה.\nבידיהם מפה מסתורית של אוצר.', image_prompt:'two child pirates on a small wooden boat sailing in calm blue sea, holding a treasure map excitedly' },
      { page:2, text:'הם הגיעו לאי גדול עם ג׳ונגל צפוף.\n"כאן מסתתר האוצר!" אמרה תמר.', image_prompt:'small boat arriving at a tropical island with dense jungle, two child pirates jumping ashore with map' },
      { page:3, text:'באמצע הג׳ונגל הם שמעו בכי.\nחתול ים קטן היה תקוע בין שני סלעים.', image_prompt:'two pirates stopping in the jungle, discovering a small striped cat trapped between two rocks, meowing' },
      { page:4, text:'הם שכחו מהאוצר ועזרו לחתול.\nהחתול קפץ אליהם ולחך את ידיהם.', image_prompt:'children carefully freeing the cat from rocks, cat happily licking their hands in gratitude' },
      { page:5, text:'בחזרה למפה ראו שהאוצר בדיוק שם.\nאבל בתיבה — רק מכתב אחד.', image_prompt:'children opening a treasure chest to find only a single letter inside, looking surprised but curious' },
      { page:6, text:'"האוצר הוא חבר שמצאת בדרך," כתב המכתב.\nהם הביטו בחתול ושניהם חייכו.', image_prompt:'two child pirates reading a letter, the little cat sitting between them, all three looking happy together' },
    ]
  },
  heroes: {
    title: 'הגיבורה הקטנה',
    subtitle: 'כוח אמיתי בא מבפנים',
    characters: 'a small 6-year-old girl with a colorful cape and determined eyes, wearing a hero costume',
    moral: 'הכוח הגדול ביותר הוא לעזור לאחרים — גם ללא על-כוחות',
    pages: [
      { page:1, text:'יעל גילתה יום אחד שיכולה לרוץ מהר מאוד.\nלבשה גלימה ויצאה לעיר.', image_prompt:'small girl in colorful hero cape running very fast down a city street, wind blowing her cape' },
      { page:2, text:'ליד הפארק ראתה ילד שבכה.\nהכדור שלו עלה על גג גבוה.', image_prompt:'hero girl stopping to look at a crying boy pointing up at a rooftop where his ball is stuck' },
      { page:3, text:'יעל טיפסה מהר כמו חתול עד הגג.\nלקחה את הכדור וקפצה בחזרה.', image_prompt:'girl in cape climbing up a building wall quickly, reaching a ball on the rooftop, focused and brave' },
      { page:4, text:'אחר כך ראתה סבתא שתיקים שלה נפלו.\nאספה הכל לפני שמישהו אפילו הספיק לנשום.', image_prompt:'hero girl quickly gathering groceries that spilled from an elderly woman\'s bag, helping kindly' },
      { page:5, text:'בסוף היום ישבה יעל עייפה על הספסל.\n"האם אני גיבורה?" תהתה.', image_prompt:'tired hero girl sitting on a park bench at golden hour, cape resting, thinking quietly to herself' },
      { page:6, text:'הילד והסבתא ניגשו אליה ואמרו תודה.\nיעל הבינה שכוח אמיתי הוא פשוט לדאוג לאחרים.', image_prompt:'the boy and elderly woman thanking the girl on the bench, all three smiling warmly together at sunset' },
    ]
  },
  farm: {
    title: 'יום בחווה',
    subtitle: 'כשכולם עוזרים, הכל עובד',
    characters: 'a cheerful 6-year-old farm boy with overalls and a straw hat, rosy cheeks',
    moral: 'כשכולם עוזרים זה לזה — כל עבודה נהיית קלה ומשמחת',
    pages: [
      { page:1, text:'נח התעורר עם שירת התרנגול.\nיום חדש בחווה התחיל.', image_prompt:'farm boy waking up to a rooster crowing at sunrise, stretching and smiling in his cozy barn loft' },
      { page:2, text:'הפרות חיכו בסבלנות ליד הדלי.\n"בוקר טוב!" אמר נח ונתן להן לשתות.', image_prompt:'boy greeting cows patiently waiting by a water bucket, pouring water for them with a big smile' },
      { page:3, text:'ביצים היו פזורות בכל הלול.\n"איך אמצא את כולן?" תמה נח.', image_prompt:'boy looking puzzled in a chicken coop, eggs hidden in many unexpected spots, chickens looking on curiously' },
      { page:4, text:'הכלב ביסקוויט הריח כל ביצה וביצה.\nיחד איספו את כולן תוך דקות.', image_prompt:'dog sniffing out hidden eggs while boy follows and collects them in a basket, teamwork in the coop' },
      { page:5, text:'בערב אמא אפתה עוגה מהביצים.\nכולם ישבו לאכול ביחד בחצר.', image_prompt:'whole farm family sitting together outside eating cake, animals peering curiously from around the yard' },
      { page:6, text:'נח נרדם עם חיוך רחב.\nמחר יהיה עוד יום בחווה.', image_prompt:'boy sleeping peacefully in hay, farm animals quietly peeking in through the barn window at night' },
    ]
  },
  wizard: {
    title: 'בית הספר לקסמים',
    subtitle: 'הלחש הראשון',
    characters: 'a small 6-year-old boy with a pointy wizard hat slightly too big for him, holding a short wand, wide curious eyes',
    moral: 'כל קוסם גדול התחיל עם לחש שלא עבד — טעויות הן חלק מהלמידה',
    pages: [
      { page:1, text:'ביום הראשון בבית הספר לקסמים רעד לב של רון.\nהוא קיבל שרביט קטן ומגבעת שנפלה על עיניו.', image_prompt:'small excited boy in oversized wizard hat receiving a wand from a kindly teacher in a magical school hallway, floating books and candles around' },
      { page:2, text:'בכיתה ניסה לגרום לנוצה לעוף.\n"עפי!" צעק — והנוצה ישבה ולא זזה.', image_prompt:'boy pointing wand at a feather on a desk, face scrunched in concentration, feather completely still, classmates watching' },
      { page:3, text:'כל שאר הילדים הצליחו כבר.\nרון חש לחיו אדומות מבושה.', image_prompt:"other young wizards' feathers flying around the room while the boy's feather stays on the desk, boy looking down shyly" },
      { page:4, text:'המורה ניגשה ולחשה לו בסוד:\n"גם הנוצה שלי לא עפה בפעם הראשונה."', image_prompt:'kind teacher wizard bending down to whisper encouragingly to the small boy, warm smile, magical classroom background' },
      { page:5, text:'רון עצם עיניים ונשם עמוק.\nהוא חשב על שמחה — ופתאום הנוצה עפה!', image_prompt:'boy with eyes closed, peaceful smile, feather lifting off the desk and floating upward in a spiral of tiny sparks' },
      { page:6, text:'כל הכיתה מחאה כפיים.\nרון הבין שאומץ לנסות שוב הוא הקסם הגדול ביותר.', image_prompt:'whole class of young wizards clapping for the boy as his feather soars high, boy beaming with pride and joy' },
    ]
  },
  robots: {
    title: 'רובי הרובוט',
    subtitle: 'הממציאה הקטנה',
    characters: 'a small 7-year-old girl with safety goggles on her head and a toolbelt, enthusiastic inventor look',
    moral: 'כל המצאה מתחילה בחלום — ומשם היא רק עולה',
    pages: [
      { page:1, text:'לילי אהבה לבנות דברים מכל חומר שמצאה.\nחדרה היה מלא בברגים, קפיצים וקרטונים.', image_prompt:'girl surrounded by piles of screws, springs, cardboard boxes and gears in her messy workshop bedroom, delighted expression' },
      { page:2, text:'יום אחד החליטה: "אני אבנה רובוט!"\nהיא ציירה תכנית גדולה על הנייר.', image_prompt:'girl drawing detailed plans for a robot on a large sheet of paper spread on the floor, pencil in hand, excited' },
      { page:3, text:'שלושה ימים בנתה ובנתה.\nבסוף לחצה על הכפתור — ולא קרה כלום.', image_prompt:'girl pressing a big button on her finished clunky lovable robot, robot standing perfectly still, girl looking puzzled' },
      { page:4, text:'"אוי," אמרה לילי, "שכחתי חוט!"\nחיברה חוט אחד קטן בתחתית.', image_prompt:'girl bending down to connect a small missing wire at the robot base, concentrating carefully with a screwdriver' },
      { page:5, text:'הרובוט הדליק עיניים כחולות וצחק.\n"שלום! שמי רובי. אני כאן לעזור!"', image_prompt:"robot's round eyes lighting up blue, making a happy sound, girl jumping with joy and hugging the little robot" },
      { page:6, text:'מאותו יום, לילי ורובי הלכו לכל מקום ביחד.\nהיא ידעה שכל חלום אפשר לבנות.', image_prompt:'girl and small friendly robot walking side by side down a sunny street, both looking happy and adventurous together' },
    ]
  },
};

const STYLE_SUFFIX = {
  coloring: () =>
    `children's coloring book page, MONOCHROME black ink line art on pure white background, thick bold clean outlines only, absolutely zero color, zero shading, zero gray fills, empty white spaces ready to be colored, charming clear illustration style, high contrast printable artwork`,
  colored: (age) => {
    const c = age === 'young' ? 'very simple bold shapes, cheerful colors, uncluttered background' : age === 'mid' ? 'expressive warm colors, storybook illustration style' : 'richly detailed, vibrant saturated colors, professional picture-book art';
    return `children's picture book illustration, ${c}, watercolor and gouache style, soft directional lighting, no text, no letters, no words`;
  }
};

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── GENERATE FULL BOOK (story plan + consistent images) ──
app.post('/api/generate-book', async (req, res) => {
  const { theme = 'custom', customSubject = '', style = 'coloring', age = 'mid', count = 1 } = req.body;

  if (theme !== 'custom') {
    // Use pre-written template
    const template = STORY_TEMPLATES[theme];
    if (!template) return res.status(400).json({ error: 'Template not found' });

    const pageCount = Math.min(count, template.pages.length);
    const pages = template.pages.slice(0, pageCount);

    const styleSuffix = STYLE_SUFFIX[style]?.(age) || STYLE_SUFFIX.coloring(age);
    const characterDesc = (style === 'colored')
      ? template.characters
      : template.characters.replace(/\b(red|blue|green|yellow|orange|purple|pink|brown|black|white|teal|golden|blonde|brunette|auburn|gray|grey|colorful|vibrant)\b/gi, '').replace(/\s+/g, ' ').trim();

    try {
      const imageUrls = await Promise.all(
        pages.map(p => {
          const prompt = `${characterDesc}, ${p.image_prompt}, ${styleSuffix}`;
          return replicate.run('black-forest-labs/flux-1.1-pro', {
            input: { prompt, aspect_ratio: '3:4', output_format: 'png', safety_tolerance: 5 }
          }).then(o => Array.isArray(o) ? o[0] : String(o));
        })
      );

      const result = {
        title: template.title,
        subtitle: template.subtitle,
        characters: template.characters,
        moral: template.moral,
        pages: pages.map((p, i) => ({ ...p, image_url: imageUrls[i] }))
      };
      return res.json(result);
    } catch (err) {
      console.error('Images error:', err.message);
      return res.status(500).json({ error: 'שגיאה ביצירת התמונות' });
    }
  }

  // Custom theme: full AI generation
  const storyBase = customSubject.trim();
  if (!storyBase) return res.status(400).json({ error: 'Subject required' });
  if (count > 6) return res.status(400).json({ error: 'Max 6 pages' });

  const pageCount = Math.min(count, 6);
  const ageDesc = { young: 'גיל 2–4: משפטים קצרים מאוד, מילים פשוטות', mid: 'גיל 5–7: שפה נגישה וסיפורית', older: 'גיל 8–12: שפה עשירה, עלילה מורכבת' }[age] || 'גיל 5–7';
  const perPage = { young: '1–2 משפטים קצרים', mid: '2–3 משפטים', older: '3–4 משפטים' }[age];
  const styleHeb = { coloring: 'דפי צביעה', colored: 'ספר איורים צבעוני' }[style] || 'דפי צביעה';

  // Step 1: Claude generates full book plan — story + per-page image prompts
  let plan;
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      messages: [{
        role: 'user',
        content: `You are a professional children's book author and illustrator. Create a complete book plan.

Theme: ${storyBase}
Age: ${ageDesc}
Pages: ${pageCount}
Activity type: ${styleHeb}

STORY RULES (write in Hebrew):
- Each page: ${perPage} that accompany an illustration
- Clear arc: opening → challenge → resolution → heartwarming ending
- Warm, rhythmic, imaginative language
- Simple, positive moral lesson

IMAGE PROMPT RULES (write in English):
- "characters": concise visual description of main character(s) — prepended to every prompt for consistency. Describe shape, clothing, proportions. ${style === 'coloring' ? 'Do NOT mention colors (it is a coloring book).' : 'Include colors.'}
- Each page "image_prompt": describe only the specific scene (action, setting, composition, camera angle, mood). Do NOT repeat character descriptions. Be cinematic and specific.
- No color words in image_prompts for coloring style.

Return ONLY valid JSON, no markdown, no extra text:
{
  "title": "ספר כותרת",
  "subtitle": "תת-כותרת",
  "characters": "a 6-year-old girl with curly red hair, big brown eyes, wearing a teal dress",
  "pages": [
    {"page": 1, "text": "Hebrew story text...", "image_prompt": "standing at the edge of a magical forest, looking up at glowing trees with wonder"},
    {"page": 2, "text": "Hebrew story text...", "image_prompt": "..."}
  ],
  "moral": "מוסר השכל: ..."
}`
      }]
    });

    const raw = msg.content[0].text.trim();
    const jsonStr = raw.startsWith('{') ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    plan = JSON.parse(jsonStr);
  } catch (err) {
    console.error('Plan error:', err.status, err.message, err.error);
    return res.status(500).json({ error: 'שגיאה ביצירת תכנית הספר', detail: err.message });
  }

  // Step 2: Generate images in parallel — each gets characters + unique scene prompt
  // No shared seed: character description in prompt provides visual consistency,
  // while unique seeds allow varied scene compositions
  const styleSuffix = STYLE_SUFFIX[style]?.(age) || STYLE_SUFFIX.coloring(age);

  try {
    // For coloring/dotted/maze: strip color words from character description
    // to avoid Flux adding colors when it should be B&W line art
    const characterDesc = (style === 'colored')
      ? plan.characters
      : plan.characters.replace(/\b(red|blue|green|yellow|orange|purple|pink|brown|black|white|teal|golden|blonde|brunette|auburn|gray|grey|colorful|vibrant)\b/gi, '').replace(/\s+/g, ' ').trim();

    const imageUrls = await Promise.all(
      plan.pages.map(p => {
        const prompt = `${characterDesc}, ${p.image_prompt}, ${styleSuffix}`;
        return replicate.run('black-forest-labs/flux-1.1-pro', {
          input: { prompt, aspect_ratio: '3:4', output_format: 'png', safety_tolerance: 5 }
        }).then(o => Array.isArray(o) ? o[0] : String(o));
      })
    );

    plan.pages = plan.pages.map((p, i) => ({ ...p, image_url: imageUrls[i] }));
    res.json(plan);
  } catch (err) {
    console.error('Images error:', err.message);
    res.status(500).json({ error: 'שגיאה ביצירת התמונות' });
  }
});

app.get('/api/proxy-image', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('url required');
  try {
    const buf = await fetchBuffer(url);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(buf);
  } catch { res.status(500).send('fetch failed'); }
});

// ── SAVE BOOK (called after client generates PDF) ──
app.post('/api/save-book', async (req, res) => {
  const { title, subtitle, theme, age, style, pageCount, pdfBase64, userId } = req.body;
  if (!pdfBase64) return res.status(400).json({ error: 'pdfBase64 required' });

  const id = randomUUID();
  const filename = `${id}.pdf`;
  const pdfPath = path.join(PDFS_DIR, filename);

  await fsp.writeFile(pdfPath, Buffer.from(pdfBase64, 'base64'));

  const book = {
    id,
    title:     title || 'ספר ללא שם',
    subtitle:  subtitle || '',
    theme,
    age,
    style,
    pageCount: pageCount || 0,
    userId:    userId || 'anonymous',
    createdAt: new Date().toISOString(),
    pdfUrl:    `/data/pdfs/${filename}`
  };

  booksDB.push(book);
  await saveBooks();

  res.json({ id, pdfUrl: book.pdfUrl });
});

// ── PUBLIC STATS ──
app.get('/api/stats', (req, res) => {
  // Add a base offset so stats look meaningful even after restarts
  const BASE_VISITS = 120;
  res.json({ totalBooks: booksDB.length, totalVisits: (siteStats.totalVisits || 0) + BASE_VISITS });
});

// ── LIST BOOKS (for admin / analytics) ──
app.get('/api/books', (req, res) => {
  const stats = {
    total: booksDB.length,
    uniqueUsers: new Set(booksDB.map(b => b.userId)).size,
    returningUsers: (() => {
      const counts = {};
      booksDB.forEach(b => { counts[b.userId] = (counts[b.userId] || 0) + 1; });
      return Object.values(counts).filter(c => c > 1).length;
    })(),
    byTheme: booksDB.reduce((acc, b) => { acc[b.theme] = (acc[b.theme]||0)+1; return acc; }, {}),
    books: booksDB.map(b => ({ id: b.id, title: b.title, theme: b.theme, age: b.age, createdAt: b.createdAt, pdfUrl: b.pdfUrl }))
  };
  res.json(stats);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Coloring Book running on port ${PORT}`));
