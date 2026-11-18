// Fills the database with demo data so every screen has something to show: two demo hosts, public and
// private quizzes across the categories, solo leaderboards, live games (finished, waiting in the lobby,
// and one linked to a tournament round with its scores not yet sent) and two tournaments with teams.
//
// Run with: npm run db:seed            (reads DATABASE_URL from .env.local)
//           npm run db:seed -- --reset (removes the demo accounts and everything they own, nothing else)
//
// Safe to run again: everything the demo accounts own is removed first and made afresh, so there is
// always one set of demo data. Other people's rows are never touched.
//
// Demo logins (password "DemoPass-2026" for both):
//   demo.host@quizotab.test     "Demo Host"      most of the public quizzes, the live games, the tournaments
//   demo.school@quizotab.test   "Mwalimu Demo"   the kids and Swahili quizzes, two private quizzes
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { hashPassword } from "@/lib/auth/password";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";
import { advance, answer, gameById, join, launch, playerByToken, type Game, type Player } from "@/lib/quiz/engine";
import { ownQuiz, publicQuiz, saveQuiz, type PublicQuiz } from "@/lib/quiz/quizzes";
import { soloAnswer, soloRunByToken, soloStart } from "@/lib/quiz/solo";
import { hostTournaments, tournamentTeams } from "@/lib/quiz/tournament-link";

config({ path: ".env.local" });

const DEMO_PASSWORD = "DemoPass-2026";
const DEMO_ACCOUNTS = {
  host: { email: "demo.host@quizotab.test", name: "Demo Host" },
  school: { email: "demo.school@quizotab.test", name: "Mwalimu Demo" },
};
type Owner = keyof typeof DEMO_ACCOUNTS;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}
const db: Db = drizzle(neon(process.env.DATABASE_URL), { schema });
// No screens are watching while this runs, so the live-game doorbell has no one to ring
delete process.env.SUPABASE_URL;

// A small seeded random generator (mulberry32), so every run makes the same scores
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function value<R extends { ok: true; value: unknown } | { ok: false; error: string }>(result: R): Extract<R, { ok: true }>["value"] {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const agoMs = (ms: number) => sql`clock_timestamp() - ${Math.round(ms)}::int * interval '1 millisecond'`;

// ---------- The quizzes ----------

type Q = { text: string; answers: string[]; correct: number; time: 10 | 20 | 30; points: 0 | 1 | 2 };
type DemoQuiz = { owner: Owner; title: string; description: string; category?: string; newCategory?: string; isPublic: boolean; questions: Q[] };

const q = (text: string, answers: string[], correct: number, time: 10 | 20 | 30 = 20, points: 0 | 1 | 2 = 1): Q => ({ text, answers, correct, time, points });

const DEMO_QUIZZES: DemoQuiz[] = [
  {
    owner: "host",
    title: "Tanzania: Mountains, Lakes and Rivers",
    description: "From the roof of Africa to the shores of Lake Tanganyika. How well do you know Tanzania's map?",
    category: "geography",
    isPublic: true,
    questions: [
      q("Which is the highest mountain in Africa?", ["Mount Kenya", "Mount Kilimanjaro", "Mount Meru", "Rwenzori"], 1, 10),
      q("Lake Victoria is shared by Tanzania, Uganda and which other country?", ["Kenya", "Rwanda", "Burundi", "Zambia"], 0, 20),
      q("Which is the deepest lake in Africa?", ["Lake Victoria", "Lake Malawi", "Lake Tanganyika", "Lake Natron"], 2, 20),
      q("The Rufiji is Tanzania's longest river. Into which ocean does it flow?", ["Atlantic Ocean", "Indian Ocean"], 1, 10),
      q("Which national park is famous for the great wildebeest migration?", ["Serengeti", "Ruaha", "Mikumi", "Tarangire"], 0, 20, 2),
      q("Ngorongoro Crater lies in which region?", ["Arusha", "Kilimanjaro", "Manyara", "Mara"], 0, 30),
      q("What is the capital city of Tanzania?", ["Dar es Salaam", "Dodoma", "Arusha", "Mwanza"], 1, 10, 2),
    ],
  },
  {
    owner: "host",
    title: "East African Community Basics",
    description: "Flags, capitals, currencies and founding facts of the EAC partner states.",
    category: "eastafrica",
    isPublic: true,
    questions: [
      q("Where is the headquarters of the East African Community?", ["Nairobi", "Kampala", "Arusha", "Kigali"], 2, 20),
      q("Which of these is NOT a founding member of the EAC (1967)?", ["Kenya", "Uganda", "Tanzania", "Rwanda"], 3, 20),
      q("What is the currency of Uganda?", ["Shilling", "Franc", "Birr", "Dollar"], 0, 10),
      q("Which country joined the EAC in 2022?", ["South Sudan", "Democratic Republic of the Congo", "Somalia", "Ethiopia"], 1, 20, 2),
      q("What does 'Jumuiya' mean in Swahili?", ["Community", "Union", "Market", "Parliament"], 0, 10),
      q("Which EAC country has Kigali as its capital?", ["Burundi", "Rwanda", "South Sudan", "Uganda"], 1, 10),
      q("The EAC anthem is sung in which language?", ["English", "French", "Swahili", "Kinyarwanda"], 2, 20),
      q("Which city is the commercial capital of Tanzania?", ["Dodoma", "Mwanza", "Dar es Salaam", "Zanzibar City"], 2, 30, 2),
    ],
  },
  {
    owner: "host",
    title: "Science Around Us",
    description: "Everyday science for secondary school: water, light, the body and the sky.",
    category: "science",
    isPublic: true,
    questions: [
      q("At sea level, water boils at what temperature?", ["90 °C", "100 °C", "110 °C", "120 °C"], 1, 10),
      q("Which gas do plants take in during photosynthesis?", ["Oxygen", "Nitrogen", "Carbon dioxide", "Hydrogen"], 2, 20),
      q("Which planet is closest to the Sun?", ["Venus", "Mercury", "Mars", "Earth"], 1, 10),
      q("Roughly how many bones does an adult human body have?", ["106", "156", "206", "306"], 2, 20),
      q("Malaria is spread by which insect?", ["Tsetse fly", "Female Anopheles mosquito", "House fly", "Bedbug"], 1, 20, 2),
      q("Which part of a plant takes in water from the soil?", ["Leaves", "Flowers", "Roots", "Stem"], 2, 30),
    ],
  },
  {
    owner: "host",
    title: "History of East Africa",
    description: "Independence, leaders and turning points from the coast to the Great Lakes.",
    category: "history",
    isPublic: true,
    questions: [
      q("In which year did Tanganyika gain independence?", ["1961", "1963", "1964", "1967"], 0, 20),
      q("Who was Kenya's first president?", ["Daniel arap Moi", "Jomo Kenyatta", "Tom Mboya", "Mwai Kibaki"], 1, 10),
      q("Tanganyika and Zanzibar united to form Tanzania in which year?", ["1962", "1964", "1966", "1970"], 1, 20, 2),
      q("The Arusha Declaration of 1967 set out which policy?", ["Ujamaa", "Harambee", "Structural adjustment", "Federation"], 0, 20),
      q("Uganda became independent from Britain in which year?", ["1960", "1962", "1963", "1965"], 1, 20),
      q("Which island was a centre of the East African slave and spice trade in the 1800s?", ["Mafia", "Pemba", "Zanzibar", "Lamu"], 2, 30),
      q("Who led Tanzania to independence and is called Baba wa Taifa?", ["Julius Nyerere", "Abeid Karume", "Rashidi Kawawa", "Benjamin Mkapa"], 0, 10, 2),
    ],
  },
  {
    owner: "host",
    title: "Sports: East Africa and the World",
    description: "Runners, footballers and the big tournaments. Quick questions for a sports night.",
    category: "sports",
    isPublic: true,
    questions: [
      q("Eliud Kipchoge, the marathon great, comes from which country?", ["Ethiopia", "Uganda", "Kenya", "Tanzania"], 2, 10),
      q("Which Tanzanian club is nicknamed 'Wekundu wa Msimbazi'?", ["Yanga", "Simba SC", "Azam FC", "Coastal Union"], 1, 20),
      q("How many players does a football team have on the pitch?", ["9", "10", "11", "12"], 2, 10),
      q("Joshua Cheptegei set world records in which events?", ["Marathon", "5000 m and 10,000 m", "100 m and 200 m", "High jump"], 1, 20, 2),
      q("The FIFA World Cup is held every how many years?", ["2", "3", "4", "5"], 2, 10),
      q("Which sport is played at Wimbledon?", ["Cricket", "Tennis", "Golf", "Rugby"], 1, 20),
      q("Simba SC and Yanga, Tanzania's great rivals, both come from which city?", ["Mwanza", "Arusha", "Dar es Salaam", "Dodoma"], 2, 30),
    ],
  },
  {
    owner: "host",
    title: "Bible Knowledge: Old and New Testament",
    description: "A friendly Sunday quiz: people, places and well-known verses.",
    category: "faith",
    isPublic: true,
    questions: [
      q("How many books are in the Bible (Protestant canon)?", ["27", "39", "66", "73"], 2, 20),
      q("Who built the ark?", ["Moses", "Noah", "Abraham", "David"], 1, 10),
      q("In which city was Jesus born?", ["Nazareth", "Jerusalem", "Bethlehem", "Capernaum"], 2, 10),
      q("Who was swallowed by a great fish?", ["Jonah", "Elijah", "Daniel", "Peter"], 0, 20),
      q("How many disciples did Jesus choose?", ["7", "10", "12", "70"], 2, 10, 2),
      q("'The Lord is my shepherd' opens which Psalm?", ["Psalm 1", "Psalm 23", "Psalm 91", "Psalm 119"], 1, 20),
      q("Which book comes first in the New Testament?", ["Mark", "Matthew", "Luke", "John"], 1, 30),
    ],
  },
  {
    owner: "host",
    title: "Business and Money in East Africa",
    description: "Currencies, taxes, banks and a little arithmetic for the shop counter.",
    category: "business",
    isPublic: true,
    questions: [
      q("What is the currency of Tanzania?", ["Tanzanian shilling", "Kenyan shilling", "Tanzanian franc", "Rand"], 0, 10),
      q("Which authority collects taxes in Tanzania?", ["TRA", "KRA", "URA", "BoT"], 0, 20),
      q("What does VAT stand for?", ["Value Added Tax", "Variable Annual Tax", "Vendor Account Total", "Verified Asset Transfer"], 0, 20),
      q("Tanzania's stock market in Dar es Salaam is called the...", ["Dar Bourse", "Dar es Salaam Stock Exchange", "Tanzania Securities Market", "Kariakoo Exchange"], 1, 30),
      q("A shop buys a crate of soda for 20,000 TSh and sells it for 26,000 TSh. What is the profit?", ["4,000 TSh", "6,000 TSh", "8,000 TSh", "46,000 TSh"], 1, 20, 2),
      q("A SACCO is a...", ["Savings and credit cooperative", "Government bank", "Mobile money app", "Tax office"], 0, 20),
      q("Which bank issues Kenya's banknotes?", ["Equity Bank", "KCB", "Central Bank of Kenya", "Bank of Africa"], 2, 10),
    ],
  },
  {
    owner: "host",
    title: "Technology and Mobile Money",
    description: "Phones, apps and the internet, from M-Pesa to the web. For anyone who has a smartphone.",
    category: "technology",
    isPublic: true,
    questions: [
      q("M-Pesa was first launched in Kenya in which year?", ["2003", "2007", "2011", "2015"], 1, 20),
      q("Which company makes the Android operating system?", ["Apple", "Microsoft", "Google", "Samsung"], 2, 10),
      q("What does CPU stand for?", ["Central Processing Unit", "Computer Power Unit", "Core Program Utility", "Central Print Unit"], 0, 20),
      q("Which of these is a programming language?", ["Chrome", "Python", "Excel", "Wi-Fi"], 1, 10),
      q("What does the 'www' in a web address stand for?", ["World Wide Web", "Web Without Wires", "Wide World Window", "World Web Works"], 0, 10),
      q("Which messaging app is owned by Meta?", ["Telegram", "Signal", "WhatsApp", "Viber"], 2, 20, 2),
      q("Vodacom, Airtel and Halotel are examples of...", ["Banks", "Mobile network operators", "Television stations", "Search engines"], 1, 30),
    ],
  },
  {
    owner: "host",
    title: "Music and Movies: Bongo to Hollywood",
    description: "Bongo Flava, Taarab, Afrobeats and the films everyone has seen.",
    category: "entertainment",
    isPublic: true,
    questions: [
      q("Diamond Platnumz, the Bongo Flava star, comes from which country?", ["Kenya", "Tanzania", "Uganda", "Nigeria"], 1, 10),
      q("Sauti Sol is a band from which country?", ["Tanzania", "Rwanda", "Kenya", "South Africa"], 2, 10),
      q("Taarab music is most associated with which island?", ["Pemba", "Lamu", "Mafia", "Zanzibar"], 3, 20),
      q("Lupita Nyong'o won an Oscar for her role in which film?", ["Black Panther", "12 Years a Slave", "Queen of Katwe", "Us"], 1, 20, 2),
      q("'Hakuna Matata' from The Lion King is a phrase in which language?", ["Zulu", "Swahili", "Yoruba", "Amharic"], 1, 10),
      q("Eddy Kenzo's hit 'Sitya Loss' comes from which country?", ["Uganda", "Tanzania", "Kenya", "Burundi"], 0, 20),
      q("Which film is set in the fictional African kingdom of Wakanda?", ["Coming to America", "Black Panther", "The Woman King", "Beasts of No Nation"], 1, 30),
    ],
  },
  {
    owner: "school",
    title: "Kids: Swahili Words and Numbers",
    description: "Colours, animals and counting in Kiswahili. Made for primary school classes.",
    category: "kids",
    isPublic: true,
    questions: [
      q("Say hello! What does 'Jambo' mean?", ["Goodbye", "Hello", "Thank you", "Please"], 1, 10, 0),
      q("What is 'tano' in English?", ["Three", "Four", "Five", "Six"], 2, 10),
      q("Which animal is 'simba'?", ["Lion", "Elephant", "Giraffe", "Zebra"], 0, 10),
      q("What colour is 'nyekundu'?", ["Blue", "Green", "Red", "Yellow"], 2, 20),
      q("'Asante sana' means...", ["Good morning", "Thank you very much", "See you", "Welcome"], 1, 10),
      q("'Tembo' is which animal?", ["Elephant", "Hippo", "Monkey", "Crocodile"], 0, 20, 2),
    ],
  },
  {
    owner: "school",
    title: "Methali: Swahili Proverbs",
    description: "Finish the proverb and say what it means. Good for Kiswahili lessons and family evenings.",
    newCategory: "Swahili proverbs",
    isPublic: true,
    questions: [
      q("What is 'methali' in English?", ["A song", "A proverb", "A riddle", "A story"], 1, 10),
      q("'Haraka haraka haina baraka' teaches that...", ["Hurrying brings no blessing", "The early bird eats", "Work hard every day", "Silence is golden"], 0, 20),
      q("Complete the proverb: 'Haba na haba, ...'", ["hujaza kibaba", "huvunjika guu", "pana njia", "mpe jembe"], 0, 20),
      q("Complete the proverb: 'Asiyesikia la mkuu ...'", ["hujaza kibaba", "huvunjika guu", "sharti ainame", "chajitembeza"], 1, 20),
      q("'Mgeni siku mbili, siku ya tatu ...'", ["mpe chai", "mpe jembe", "mpe zawadi", "msindikize"], 1, 20, 2),
      q("Complete the proverb: 'Penye nia ...'", ["pana njia", "pana mto", "pana baraka", "pana kazi"], 0, 10),
      q("'Mtaka cha mvunguni sharti ainame' means that...", ["What you want takes effort", "Tall people have an advantage", "Never hide your things", "Sweep under the bed daily"], 0, 30),
    ],
  },
  // Private: only Mwalimu Demo sees these
  {
    owner: "school",
    title: "Staff: Exam Invigilation Rules",
    description: "Internal briefing for teachers before the mock examinations. Not published.",
    category: "business",
    isPublic: false,
    questions: [
      q("How early should an invigilator be in the examination room?", ["5 minutes before", "30 minutes before", "At the start", "Whenever free"], 1, 20),
      q("What must candidates leave outside the examination room?", ["Pens", "Mobile phones", "Water", "Their ID"], 1, 10),
      q("If a candidate is caught cheating, the invigilator should first...", ["Send them home", "Record it and report to the chief invigilator", "Deduct marks", "Ignore it"], 1, 20, 2),
      q("Candidates may leave the room before the end only...", ["Never", "With the invigilator's permission", "After an hour", "When finished"], 1, 20),
      q("Who signs the attendance register?", ["Only the invigilator", "Only the candidates", "Each candidate and the invigilator", "The head teacher"], 2, 10),
    ],
  },
  {
    owner: "school",
    title: "Form Two Chemistry Revision (draft)",
    description: "Still being written. Will be published once there are ten questions.",
    category: "science",
    isPublic: false,
    questions: [
      q("What is the chemical symbol for sodium?", ["So", "Na", "S", "Sd"], 1, 10),
      q("Which gas makes up about 78% of the air?", ["Oxygen", "Carbon dioxide", "Nitrogen", "Argon"], 2, 20),
      q("An acid turns blue litmus paper...", ["Red", "Green", "Yellow", "White"], 0, 10),
      q("What is the pH of pure water?", ["0", "5", "7", "14"], 2, 20, 2),
      q("Rust forms when iron reacts with oxygen and...", ["Salt", "Water", "Sand", "Carbon"], 1, 30),
    ],
  },
];

// Solo leaderboards go on these public quizzes (titles from the list above)
const SOLO_BOARDS: Record<string, string[]> = {
  "Tanzania: Mountains, Lakes and Rivers": ["Neema", "Baraka", "Zawadi", "Juma K", "Amani", "Rehema", "Faraja", "Kelvin", "Lulu", "Hassan"],
  "East African Community Basics": ["Achieng", "Brian O", "Wanjiru", "Okello", "Nakato", "Sifa", "Mutesi", "Deo"],
  "Bible Knowledge: Old and New Testament": ["Grace M", "Emmanuel", "Joyce", "Petro", "Esther W", "Daudi", "Naomi", "Yohana", "Mary K"],
  "Kids: Swahili Words and Numbers": ["Aisha", "Tumaini", "Imani", "Noel", "Glory", "Ibrahim"],
  "Methali: Swahili Proverbs": ["Bi Halima", "Mzee Omari", "Salma", "Kassim"],
};

// The finished live game: 10 players, each with a rough accuracy and speed
const LIVE_PLAYERS = [
  { name: "Asha", accuracy: 0.95, speed: 0.2 },
  { name: "Juma", accuracy: 0.85, speed: 0.35 },
  { name: "Neema", accuracy: 0.8, speed: 0.25 },
  { name: "Baraka", accuracy: 0.7, speed: 0.5 },
  { name: "Zawadi", accuracy: 0.65, speed: 0.3 },
  { name: "Kelvin", accuracy: 0.55, speed: 0.6 },
  { name: "Rehema", accuracy: 0.45, speed: 0.45 },
  { name: "Faraja", accuracy: 0.35, speed: 0.75 },
  { name: "Lightness", accuracy: 0.6, speed: 0.4 },
  { name: "Omari", accuracy: 0.5, speed: 0.55 },
];
const LIVE_GAME_QUIZ = "East African Community Basics";
const LOBBY_GAME_QUIZ = "Tanzania: Mountains, Lakes and Rivers";
const LOBBY_PLAYERS = ["Amina", "Omari", "Lightness"];
const TOURNAMENT_GAME_QUIZ = "Business and Money in East Africa";

// ---------- The tournaments ----------

type Round = { id: string; stage: string; match: string | null; name: string; minPoints: number; maxPoints: number };
type DemoTournament = {
  name: string;
  category: string;
  year: number;
  startDate: string;
  endDate: string;
  format: "quiz-night" | "championship";
  maxScorePerRound: number;
  rounds: Round[];
  teams: Array<{ name: string; members: string }>;
  // Approved scores already entered by a judge, as team name -> points, for the first round
  firstRoundScores: Record<string, number>;
};

const round = (id: string, stage: string, match: string | null, name: string, maxPoints: number, minPoints = 0): Round => ({ id, stage, match, name, minPoints, maxPoints });

const DEMO_TOURNAMENTS: DemoTournament[] = [
  {
    name: "Dar Quiz Night: November 2026",
    category: "Quiz night",
    year: 2026,
    startDate: "2026-11-20",
    endDate: "2026-11-20",
    format: "quiz-night",
    maxScorePerRound: 10,
    rounds: ["General knowledge", "Picture round", "Music", "Sport", "Current affairs", "Final round"].map((topic, i) => round(`qn-r${i + 1}`, "quiz", null, `Round ${i + 1}: ${topic}`, 10)),
    teams: [
      { name: "Kariakoo Kings", members: "Hamisi, Salome, Idd" },
      { name: "Mikocheni Minds", members: "Grace, Tito, Zuhura" },
      { name: "Oyster Bay Owls", members: "Peter, Nancy, Kim" },
      { name: "Masaki Mavericks", members: "Ally, Doreen, Fred" },
      { name: "Kinondoni Brains", members: "Mwajuma, Boniface" },
      { name: "Sinza Scholars", members: "Ester, Yusuph, Lilian" },
    ],
    firstRoundScores: { "Kariakoo Kings": 8, "Mikocheni Minds": 7, "Sinza Scholars": 6 },
  },
  {
    name: "Lake Zone Schools Championship 2026",
    category: "Schools",
    year: 2026,
    startDate: "2026-10-05",
    endDate: "2026-12-12",
    format: "championship",
    maxScorePerRound: 100,
    rounds: [
      round("ch-m1-r1", "preliminary", "Match 1", "Round 1: Categories", 100),
      round("ch-m1-r2", "preliminary", "Match 1", "Round 2: Written Puzzle Questions", 100),
      round("ch-m2-r1", "preliminary", "Match 2", "Round 1: Brain Maze Questions", 100),
      round("ch-m2-r2", "preliminary", "Match 2", "Round 2: East African Knowledge", 100),
      round("ch-m3-r1", "preliminary", "Match 3", "Round 1: Categories", 100),
      round("ch-m3-r2", "preliminary", "Match 3", "Round 2: Conquer the Clue Questions", 100),
      round("ch-qf-r1", "quarter-final", null, "Round 1: Category Selection", 60, 10),
      round("ch-qf-r2", "quarter-final", null, "Round 2: Pictorial Round", 60, 10),
      round("ch-sf-r1", "semi-final", null, "Round 1: Mental Arithmetic", 60, 10),
      round("ch-sf-r2", "semi-final", null, "Round 2: Hot Seat", 60, 10),
    ],
    teams: [
      { name: "Mwanza Secondary", members: "Joseph, Esther, Daniel, Lucy" },
      { name: "Bwiru Girls", members: "Neema, Rehema, Sarah, Joyce" },
      { name: "Nyegezi Seminary", members: "Paulo, Yohana, Elia, Petro" },
      { name: "Musoma Boys", members: "Chacha, Marwa, Ghati, Mwita" },
      { name: "Bukoba High", members: "Kokugonza, Alex, Beatrice, Ivan" },
      { name: "Geita Day", members: "Kulwa, Doto, Pili, Lucas" },
      { name: "Sengerema Secondary", members: "Magesa, Anna, Shija, Nyanda" },
      { name: "Tabora Boys", members: "Hamza, Juma, Said, Omary" },
    ],
    firstRoundScores: { "Mwanza Secondary": 92, "Bwiru Girls": 85, "Nyegezi Seminary": 78, "Musoma Boys": 74, "Bukoba High": 70, "Geita Day": 66, "Sengerema Secondary": 61, "Tabora Boys": 55 },
  },
];
// The tournament game counts towards this round of the first tournament
const TOURNAMENT_GAME_ROUND = "qn-r1";

// ---------- Accounts ----------

// The demo accounts, made or brought up to date, as owner -> user id
async function demoAccounts() {
  const password = await hashPassword(DEMO_PASSWORD);
  const ids = {} as Record<Owner, number>;
  for (const [owner, account] of Object.entries(DEMO_ACCOUNTS) as Array<[Owner, { email: string; name: string }]>) {
    const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, account.email));
    if (existing) {
      // Keep the account (and its id) but make sure the documented login works
      await db.update(schema.users).set({ name: account.name, password, role: "host", emailVerifiedAt: new Date() }).where(eq(schema.users.id, existing.id));
      ids[owner] = existing.id;
    } else {
      const [row] = await db.insert(schema.users).values({ name: account.name, email: account.email, password, role: "host", emailVerifiedAt: new Date() }).returning({ id: schema.users.id });
      ids[owner] = row.id;
    }
  }
  return ids;
}

// Everything the demo accounts own. Games first (players and answers follow by cascade), then quizzes
// (solo runs follow) and tournaments (teams and state follow). Games don't reference quizzes by foreign key.
async function clearDemoData(ownerIds: number[]) {
  const games = await db.delete(schema.quizGames).where(inArray(schema.quizGames.ownerId, ownerIds)).returning({ id: schema.quizGames.id });
  const quizzes = await db.delete(schema.quizzes).where(inArray(schema.quizzes.ownerId, ownerIds)).returning({ id: schema.quizzes.id });
  const tournaments = await db.delete(schema.tournaments).where(inArray(schema.tournaments.ownerId, ownerIds)).returning({ id: schema.tournaments.id });
  return { games: games.length, quizzes: quizzes.length, tournaments: tournaments.length };
}

// --reset: the demo accounts go too, and everything they own goes with them
async function resetDemo() {
  const emails = Object.values(DEMO_ACCOUNTS).map((account) => account.email);
  const accounts = await db.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.email, emails));
  if (accounts.length === 0) {
    console.log("No demo accounts found; nothing to remove.");
    return;
  }
  const ids = accounts.map((account) => account.id);
  const cleared = await clearDemoData(ids);
  await db.delete(schema.users).where(inArray(schema.users.id, ids));
  console.log(`Removed ${cleared.quizzes} quizzes, ${cleared.games} games, ${cleared.tournaments} tournaments and ${ids.length} demo accounts.`);
}

// ---------- Quizzes and solo play ----------

async function createQuizzes(ownerIds: Record<Owner, number>) {
  const ids = new Map<string, number>();
  for (const quiz of DEMO_QUIZZES) {
    const saved = value(
      await saveQuiz(db, ownerIds[quiz.owner], {
        title: quiz.title,
        description: quiz.description,
        category: quiz.category,
        new_category: quiz.newCategory,
        is_public: quiz.isPublic,
        questions: quiz.questions,
      }),
    );
    ids.set(quiz.title, saved.id);
  }
  return ids;
}

// One solo run played through the real solo engine. The plan says, per question, whether the answer is
// right, wrong or never came, and how long it took. The engine's clock is the database's, so each
// question's "opened at" is moved into the past by that long before the answer goes in.
type SoloPlan = Array<{ choice: number; elapsedMs: number }>;

async function playSoloRun(quiz: PublicQuiz, nickname: string, plan: SoloPlan, finishedAt: Date) {
  const started = value(await soloStart(db, quiz, nickname));
  let run = (await soloRunByToken(db, started.token))!;
  for (const [i, step] of plan.entries()) {
    await db.update(schema.quizSoloRuns).set({ questionOpenedAt: agoMs(step.elapsedMs) }).where(eq(schema.quizSoloRuns.id, run.id));
    run = (await soloRunByToken(db, started.token))!;
    value(await soloAnswer(db, run, quiz, i, step.choice));
  }
  // Spread the runs over the past weeks, so the board doesn't look like it was made today
  const createdAt = new Date(finishedAt.getTime() - plan.length * 25_000);
  await db.update(schema.quizSoloRuns).set({ createdAt, finishedAt }).where(eq(schema.quizSoloRuns.id, run.id));
}

async function createSoloRuns(ids: Map<string, number>) {
  const random = seeded(2026);
  let total = 0;
  for (const [title, nicknames] of Object.entries(SOLO_BOARDS)) {
    const quiz = (await publicQuiz(db, ids.get(title)!))!;
    // Every run is planned first, so the seeded numbers come out the same however the runs interleave
    const runs = nicknames.map((nickname, i) => {
      const accuracy = 0.4 + random() * 0.6;
      const plan: SoloPlan = quiz.questions.map((question) => {
        const roll = random();
        const limit = question.time * 1000;
        if (roll < accuracy) return { choice: question.correct, elapsedMs: limit * (0.1 + random() * 0.7) };
        if (roll < accuracy + 0.6 * (1 - accuracy)) return { choice: (question.correct + 1) % question.answers.length, elapsedMs: limit * (0.3 + random() * 0.6) };
        return { choice: -1, elapsedMs: limit + 1500 }; // time ran out
      });
      const finishedAt = new Date(Date.now() - (nicknames.length - i) * 2.5 * 86_400_000 - Math.round(random() * 6 * 3_600_000));
      return { nickname, plan, finishedAt };
    });
    await Promise.all(runs.map((run) => playSoloRun(quiz, run.nickname, run.plan, run.finishedAt)));
    total += runs.length;
  }
  return total;
}

// ---------- Live games ----------

const game = async (id: number) => (await gameById(db, id))!;

type LivePlayer = { player: Player; accuracy: number; speed: number };

// A whole game played through: every player answers every question. The engine scores each answer from
// the game's clock, so before each answer the question's start is moved into the past by how long that
// player took (fastest first, so the clock only ever moves one way within a question).
async function playThrough(gameId: number, players: LivePlayer[], random: () => number) {
  let g: Game = value(await advance(db, await game(gameId), "start"));
  for (let i = 0; i < g.questions.length; i++) {
    if (g.status !== "question" || g.currentIndex !== i) throw new Error(`Game ${gameId} is at ${g.status}/${g.currentIndex}, expected question ${i}`);
    const question = g.questions[i];
    const turns = players
      .map(({ player, accuracy, speed }) => {
        const right = random() < accuracy;
        const wrong = (question.correct + 1 + Math.floor(random() * (question.answers.length - 1))) % question.answers.length;
        return { player, choice: right ? question.correct : wrong, elapsedMs: Math.round(question.time * 1000 * Math.min(0.95, speed + random() * 0.25)) };
      })
      .sort((a, b) => a.elapsedMs - b.elapsedMs);
    for (const turn of turns) {
      await db
        .update(schema.quizGames)
        .set({ questionStartedAt: agoMs(turn.elapsedMs), questionEndsAt: agoMs(turn.elapsedMs - question.time * 1000) })
        .where(eq(schema.quizGames.id, gameId));
      value(await answer(db, await game(gameId), turn.player, i, turn.choice));
    }
    g = value(await advance(db, await game(gameId), "reveal"));
    g = value(await advance(db, g, "next")); // leaderboard, or finished after the last question
    if (g.status === "leaderboard") g = value(await advance(db, g, "next"));
  }
  if (g.status !== "finished") throw new Error(`Game ${gameId} ended in status ${g.status}`);
}

async function playFinishedGame(hostId: number, quizId: number) {
  const quiz = (await ownQuiz(db, quizId, hostId))!;
  const gameId = value(await launch(db, quiz, hostId, null));
  const players: LivePlayer[] = [];
  for (const p of LIVE_PLAYERS) {
    const token = value(await join(db, await game(gameId), p.name, null));
    players.push({ player: (await playerByToken(db, token))!, accuracy: p.accuracy, speed: p.speed });
  }
  await playThrough(gameId, players, seeded(7));
  return gameId;
}

async function openLobbyGame(hostId: number, quizId: number) {
  const quiz = (await ownQuiz(db, quizId, hostId))!;
  const gameId = value(await launch(db, quiz, hostId, null));
  for (const name of LOBBY_PLAYERS) value(await join(db, await game(gameId), name, null));
  return game(gameId);
}

// The teams of a tournament round play a quiz to the end. The scores wait for the host to send them.
async function playTournamentGame(hostId: number, quizId: number, tournamentId: string, roundId: string) {
  const mine = await hostTournaments(db, hostId);
  const tournament = mine.find((t) => t.id === tournamentId)!;
  const target = tournament.rounds.find((r) => r.id === roundId)!;
  const teams = await tournamentTeams(db, tournamentId);

  const quiz = (await ownQuiz(db, quizId, hostId))!;
  const gameId = value(await launch(db, quiz, hostId, { tournamentId, roundId, label: `${tournament.name}, ${target.label}`, teams }));
  const random = seeded(11);
  const players: LivePlayer[] = [];
  for (const team of teams) {
    const token = value(await join(db, await game(gameId), null, team.id));
    players.push({ player: (await playerByToken(db, token))!, accuracy: 0.45 + random() * 0.5, speed: 0.2 + random() * 0.5 });
  }
  await playThrough(gameId, players, random);
  return gameId;
}

// ---------- Tournaments ----------

// A tournament as the host app stores it: the row, its teams, and the "config" and "scores" documents
async function createTournaments(hostId: number) {
  const ids: string[] = [];
  for (const t of DEMO_TOURNAMENTS) {
    const [row] = await db
      .insert(schema.tournaments)
      .values({ ownerId: hostId, name: t.name, category: t.category, year: t.year, startDate: t.startDate, endDate: t.endDate, status: "active" })
      .returning({ id: schema.tournaments.id });
    const teams = await db
      .insert(schema.teams)
      .values(t.teams.map((team) => ({ tournamentId: row.id, name: team.name, category: t.category, members: team.members, registeredBy: "Host" })))
      .returning({ id: schema.teams.id, name: schema.teams.name });

    const config = {
      setupDone: true,
      name: t.name,
      startDate: t.startDate,
      endDate: t.endDate,
      format: t.format,
      maxScorePerRound: t.maxScorePerRound,
      qualificationCount: 8,
      conflictAvoidance: "one-up-one-down",
      pairingMethod: "fold",
      rounds: t.rounds,
    };
    const enteredAt = new Date(Date.now() - 86_400_000).toISOString();
    const scores = Object.entries(t.firstRoundScores).map(([teamName, points], i) => ({
      id: `demo-${t.rounds[0].id}-${i + 1}`,
      teamId: teams.find((team) => team.name === teamName)!.id,
      roundId: t.rounds[0].id,
      points,
      judgeName: "Judge Amina",
      enteredAt,
      approved: true,
    }));
    await db.insert(schema.tournamentState).values([
      { tournamentId: row.id, key: "config", value: config },
      { tournamentId: row.id, key: "scores", value: scores },
    ]);
    ids.push(row.id);
  }
  return ids;
}

// ---------- Run ----------

if (process.argv.includes("--reset")) {
  await resetDemo();
  process.exit(0);
}

const owners = await demoAccounts();
console.log(`Demo accounts ready (user ids ${owners.host} and ${owners.school})`);

const cleared = await clearDemoData(Object.values(owners));
if (cleared.quizzes || cleared.games || cleared.tournaments) {
  console.log(`Removed the previous demo data: ${cleared.quizzes} quizzes, ${cleared.games} games, ${cleared.tournaments} tournaments`);
}

const quizIds = await createQuizzes(owners);
console.log(`Saved ${quizIds.size} quizzes`);
const soloRuns = await createSoloRuns(quizIds);
console.log(`Played ${soloRuns} solo runs`);
const finishedId = await playFinishedGame(owners.host, quizIds.get(LIVE_GAME_QUIZ)!);
const lobby = await openLobbyGame(owners.host, quizIds.get(LOBBY_GAME_QUIZ)!);
const tournamentIds = await createTournaments(owners.host);
const tournamentGameId = await playTournamentGame(owners.host, quizIds.get(TOURNAMENT_GAME_QUIZ)!, tournamentIds[0], TOURNAMENT_GAME_ROUND);

const publicCount = DEMO_QUIZZES.filter((quiz) => quiz.isPublic).length;
console.log(`
Demo data is in place.

  Log in as:        ${DEMO_ACCOUNTS.host.email} or ${DEMO_ACCOUNTS.school.email}, password ${DEMO_PASSWORD}
  Quizzes:          ${quizIds.size} (${publicCount} public, ${quizIds.size - publicCount} private)
  Solo runs:        ${soloRuns} finished runs on ${Object.keys(SOLO_BOARDS).length} quizzes
  Tournaments:      ${DEMO_TOURNAMENTS.map((t) => `"${t.name}" (${t.teams.length} teams)`).join(", ")}
  Live games:       3
    Finished game:  id ${finishedId} ("${LIVE_GAME_QUIZ}", ${LIVE_PLAYERS.length} players) -> /quiz/host/${finishedId}
    Lobby game:     id ${lobby.id}, PIN ${lobby.pin} ("${LOBBY_GAME_QUIZ}", ${LOBBY_PLAYERS.length} waiting) -> /quiz/host/${lobby.id}
    Tournament:     id ${tournamentGameId} ("${TOURNAMENT_GAME_QUIZ}", ${DEMO_TOURNAMENTS[0].teams.length} teams, scores not yet sent) -> /quiz/host/${tournamentGameId}
`);
