'use strict';

// CRAFT / LEXICON: the small word lists the revision passes lean on. Short
// on purpose: each is a prompt to look, and a false alarm costs a glance.
// English only. Lists are lowercase; patterns are regex sources.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.KibitzCraft = root.KibitzCraft || {}).lexicon = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const words = (s) => new Set(s.trim().split(/\s+/));

  // The senses, for "a paragraph that only uses sight".
  const SENSES = {
    sight: words(`see saw seen seeing look looked looking glance glanced stare stared watch watched gaze gazed glimpse
      bright dark darkness light lit shadow shadows glow glowed gleam gleamed glint shine shone shining glitter flash flashed
      pale color colour colors red blue green yellow white black gray grey brown orange purple pink silver golden
      dim faded shiny sparkle sparkled blur blurred visible`),
    sound: words(`hear heard hearing sound sounds noise noisy loud quiet quietly silence silent hum hummed buzz buzzed
      whisper whispered roar roared ring rang ringing creak creaked click clicked bang banged echo echoed thud hiss hissed
      crack cracked music voice voices shout shouted murmur rumble rumbled clatter clang squeak squeal beep beeped`),
    smell: words(`smell smelled smelt smells scent stink stank stench odor odour reek reeked fragrance perfume whiff sniff
      sniffed musty smoky rancid aroma`),
    touch: words(`touch touched rough smooth cold hot warm cool wet damp sticky soft hard sharp itch itched ache ached
      sting stung heat chill chilled grip gripped brushed slick gritty prickle prickled numb sore sweat sweaty
      clammy greasy tender burning freezing`),
    taste: words(`taste tasted tastes bitter sweet sour salty salt tongue swallow swallowed savory savoury metallic
      bland spicy chewed`)
  };

  // Words that place a scene in time, for "a chapter whose first two
  // sentences don't say when we are".
  const TIME_RE = new RegExp('\\b(?:' + [
    'morning', 'mornings', 'afternoon', 'evening', 'night', 'nights', 'tonight', 'dawn', 'dusk', 'noon', 'midnight', 'sunrise', 'sunset',
    'day', 'days', 'today', 'yesterday', 'tomorrow', 'week', 'weeks', 'weekend', 'month', 'months', 'year', 'years',
    'hour', 'hours', 'minute', 'minutes', 'later', 'earlier', 'ago', 'since', 'until', 'after', 'before', 'already', 'still', 'once',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'spring', 'summer', 'autumn', 'fall', 'winter', 'shift', 'breakfast', 'lunch', 'dinner', 'supper', "o'clock", 'o’clock',
    'first', 'last', 'next', 'then', 'now', 'when', 'while'
  ].join('|') + ')\\b|\\b\\d{1,2}(?::\\d{2})?\\s?(?:a\\.?m|p\\.?m)\\b|\\b\\d{1,2}:\\d{2}\\b|\\b(?:1[6-9]|2\\d)\\d{2}\\b', 'i');

  // Dialogue tags that don't disappear the way "said" does.
  const LOUD_TAGS = words(`exclaimed retorted interjected opined queried inquired enquired declared hissed growled snarled
    chortled chuckled laughed smiled grinned sighed breathed spat quipped intoned announced stated ejaculated
    articulated asserted bellowed gushed hollered moaned remarked responded sneered`);

  // Verbs that only move someone from one place to another.
  const MOTION = words(`walked went headed moved crossed entered left returned came stepped drove ran hurried wandered
    made climbed got`);
  const DIRECTIONS = words('to into across back out through down up over toward towards onto inside outside home away');

  // The narrator describing a face they can't see. Possessives slot in.
  const POSSESSIVE = '(?:my|his|her|their)';
  const OWN_FACE = [
    `(?:smile|grin|frown|smirk)\\s+(?:tugged|played|spread|crept|curled|pulled|twitched)\\s+(?:at|on|across)\\s+(?:the corners of\\s+)?${POSSESSIVE}\\s+(?:lips|mouth|face)`,
    `${POSSESSIVE}\\s+(?:face|cheeks)\\s+(?:flushed|reddened|burned|paled|went\\s+(?:red|pale|white|hot))`,
    `${POSSESSIVE}\\s+eyes\\s+(?:widened|narrowed|sparkled|twinkled|glittered|darkened|softened|hardened|lit up)`,
    `${POSSESSIVE}\\s+(?:jaw|lips|mouth)\\s+(?:tightened|thinned|pursed|twitched|dropped|fell open)`,
    `${POSSESSIVE}\\s+(?:brow|brows|eyebrows)\\s+(?:furrowed|knitted|rose|shot up|arched)`
  ];

  const COLORS = 'blue|green|brown|hazel|grey|gray|black|amber|violet|blond|blonde|red|auburn|brunette|raven|golden|silver|ginger|dark|light|fair|sandy|chestnut|copper|emerald|sapphire';
  const EYE_HAIR = [
    `(?:${COLORS})[\\s-]+(?:eyed|haired)`,
    `(?:${COLORS})\\s+(?:eyes|hair|curls|locks)`,
    `(?:eyes|hair)\\s+(?:was|were)\\s+(?:a\\s+)?(?:\\w+\\s+)?(?:${COLORS})`
  ];

  // Capitalised words that aren't anyone's name.
  const NOT_NAMES = words(`i i'm i'd i'll i've the a an and but or so then when if mr mrs ms dr st sgt
    monday tuesday wednesday thursday friday saturday sunday january february march april may june july august
    september october november december god ok okay yes no oh hey`);

  return { SENSES, TIME_RE, LOUD_TAGS, MOTION, DIRECTIONS, OWN_FACE, EYE_HAIR, NOT_NAMES };
});
