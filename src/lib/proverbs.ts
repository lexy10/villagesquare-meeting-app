export interface Proverb { text: string; origin: string; native?: string }

// Origins are named only where well established; the rest stay "African proverb".
const PROVERBS: Proverb[] = [
  { text: 'If you want to go fast, go alone. If you want to go far, go together.', origin: 'African proverb' },
  { text: 'It takes a village to raise a child.', origin: 'African proverb' },
  { text: 'Hurry, hurry has no blessing.', origin: 'Swahili proverb', native: 'Haraka haraka haina baraka.' },
  { text: 'Unity is strength, division is weakness.', origin: 'Swahili proverb', native: 'Umoja ni nguvu, utengano ni udhaifu.' },
  { text: 'When spider webs unite, they can tie up a lion.', origin: 'Ethiopian proverb' },
  { text: 'However long the night, the dawn will break.', origin: 'African proverb' },
  { text: 'Rain does not fall on one roof alone.', origin: 'African proverb' },
  { text: 'A single bracelet does not jingle.', origin: 'African proverb' },
  { text: 'Sticks in a bundle are unbreakable.', origin: 'African proverb' },
  { text: 'Wisdom is like a baobab tree; no one person can embrace it.', origin: 'African proverb' },
  { text: 'The one who asks questions does not lose their way.', origin: 'African proverb' },
  { text: 'He who learns, teaches.', origin: 'Ethiopian proverb' },
  { text: 'Smooth seas do not make skilful sailors.', origin: 'African proverb' },
  { text: 'No matter how long a log stays in the water, it does not become a crocodile.', origin: 'African proverb' },
  { text: 'A roaring lion kills no game.', origin: 'African proverb' },
  { text: 'Knowledge is like a garden: if it is not cultivated, it cannot be harvested.', origin: 'African proverb' },
  { text: 'When the music changes, so does the dance.', origin: 'African proverb' },
  { text: 'Talking with one another is loving one another.', origin: 'African proverb' },
  { text: 'Two ants do not fail to pull one grasshopper.', origin: 'African proverb' },
  { text: 'Do not look where you fell, but where you slipped.', origin: 'African proverb' },
  { text: 'Patience can cook a stone.', origin: 'African proverb' },
  { text: 'Character is beauty.', origin: 'Yoruba proverb', native: 'Ìwà lẹ̀wà.' },
  { text: 'Let no one leave their brother behind.', origin: 'Igbo proverb', native: 'Onye aghana nwanne ya.' },
  { text: 'Little by little fills the measure.', origin: 'Swahili proverb', native: 'Haba na haba hujaza kibaba.' },
  { text: 'One finger cannot crush a louse.', origin: 'Swahili proverb', native: 'Kidole kimoja hakivunji chawa.' },
  { text: 'Words are sweet, but they never take the place of food.', origin: 'African proverb' },
  { text: 'The best way to eat an elephant in your path is to cut it into little pieces.', origin: 'African proverb' },
  { text: 'A family tie is like a tree: it can bend, but it cannot break.', origin: 'African proverb' },
  { text: 'Tomorrow belongs to the people who prepare for it today.', origin: 'African proverb' },
  { text: 'The fool speaks, the wise listen.', origin: 'Ethiopian proverb' },
];

/** Same proverb for everyone all day (local midnight to midnight), a new one tomorrow. */
export function proverbOfTheDay(d = new Date()): Proverb {
  const day = Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
  return PROVERBS[day % PROVERBS.length];
}
