import type { VideoReference } from '@/types';

/**
 * ---------------------------------------------------------------------------
 * VIDEO CONFIGURATION
 * ---------------------------------------------------------------------------
 * Every entry below with `verified: false` is a **YouTube search URL**, not a
 * specific video. The UI labels those as "Search YouTube" rather than
 * "Watch video" so nothing pretends to be a hand-checked link.
 *
 * To pin a real video:
 *   1. Open the search link, find a clip you like from a creator you trust.
 *   2. Either replace the entry here (url + title + creator + duration) and set
 *      `verified: true`, or paste the link in Settings → Videos, which stores a
 *      per-exercise override in IndexedDB without touching this file.
 *
 * Preferred creators: Squat University, Tom Merrick (Bodyweight Warrior),
 * Strength Side, Precision Movement, Knees Over Toes Guy, Renaissance
 * Periodization, E3 Rehab, FitnessFAQs, Calisthenicmovement.
 * ---------------------------------------------------------------------------
 */

export function youTubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query).replace(
    /%20/g,
    '+',
  )}`;
}

function search(
  exerciseId: string,
  query: string,
  creator: string,
  title?: string,
): VideoReference {
  return {
    exerciseId,
    title: title ?? `${query} — technique`,
    creator,
    url: youTubeSearchUrl(query),
    verified: false,
  };
}

/**
 * Candidate follow-along routine for Wednesday.
 * The URL resolved to a live page titled "20 Min Mobility Routine (FOLLOW ALONG)"
 * at authoring time, but channel and duration were NOT independently confirmed —
 * hence `verified: false`. Watch it once, then flip `verified` to true (or replace
 * it in Settings) if it suits you.
 */
export const MOBILITY_FOLLOW_ALONG_CANDIDATES: VideoReference[] = [
  {
    exerciseId: 'mobility-follow-along',
    title: '20 Min Mobility Routine (FOLLOW ALONG)',
    creator: 'Tom Merrick / Bodyweight Warrior (unconfirmed)',
    url: 'https://www.youtube.com/watch?v=BSkPVmh7-qA',
    duration: '~20 min',
    verified: false,
  },
  {
    exerciseId: 'mobility-follow-along',
    title: '20 Minute Full Body Flexibility Routine (FOLLOW ALONG)',
    creator: 'Tom Merrick / Bodyweight Warrior (unconfirmed)',
    url: 'https://www.youtube.com/watch?v=lPKRiU9u_Hc',
    duration: '~20 min',
    verified: false,
  },
];

/** Default follow-along shown on the Wednesday screen — a search until you pin one. */
export const MOBILITY_FOLLOW_ALONG: VideoReference = {
  exerciseId: 'mobility-follow-along',
  title: 'Full-body mobility follow-along (shoulders, t-spine, hips, ankles)',
  creator: 'Tom Merrick / Strength Side / Precision Movement',
  url: youTubeSearchUrl('Tom Merrick 20 minute full body mobility routine follow along'),
  duration: '15-25 min',
  verified: false,
};

export const EXERCISE_VIDEOS: VideoReference[] = [
  search('scapular-pull-up', 'FitnessFAQs scapular pull up tutorial', 'FitnessFAQs'),
  search('strict-pull-up', 'Calisthenicmovement strict pull up technique', 'Calisthenicmovement'),
  search('chin-up', 'Calisthenicmovement chin up form tutorial', 'Calisthenicmovement'),
  search('negative-pull-up', 'FitnessFAQs negative pull up progression', 'FitnessFAQs'),
  search('band-assisted-pull-up', 'FitnessFAQs band assisted pull up', 'FitnessFAQs'),
  search('dead-hang', 'Tom Merrick dead hang benefits shoulder', 'Tom Merrick'),
  search('band-face-pull', 'E3 Rehab band face pull technique', 'E3 Rehab'),
  search('band-external-rotation', 'E3 Rehab band external rotation rotator cuff', 'E3 Rehab'),
  search(
    'band-pull-apart',
    'Renaissance Periodization band pull apart form',
    'Renaissance Periodization',
  ),
  search(
    'band-straight-arm-pulldown',
    'straight arm pulldown band lat technique',
    'Renaissance Periodization',
  ),
  search('standard-push-up', 'Calisthenicmovement perfect push up tutorial', 'Calisthenicmovement'),
  search(
    'decline-push-up',
    'Calisthenicmovement decline push up upper chest',
    'Calisthenicmovement',
  ),
  search('pike-push-up', 'Calisthenicmovement pike push up tutorial', 'Calisthenicmovement'),
  search(
    'pike-push-up-elevated',
    'elevated pike push up beginner progression',
    'Calisthenicmovement',
  ),
  search('inverted-row', 'FitnessFAQs inverted row technique', 'FitnessFAQs'),
  search('trx-row', 'ring row technique FitnessFAQs', 'FitnessFAQs'),
  search('band-row', 'resistance band row technique E3 Rehab', 'E3 Rehab'),
  search('step-up', 'Squat University step up knee friendly technique', 'Squat University'),
  search('band-lateral-walk', 'E3 Rehab banded lateral walk glute medius', 'E3 Rehab'),
  search('monster-walk', 'monster walk band glute activation technique', 'E3 Rehab'),
  search('terminal-knee-extension', 'E3 Rehab terminal knee extension', 'E3 Rehab'),
  search('glute-bridge', 'Squat University glute bridge technique', 'Squat University'),
  search(
    'hip-thrust',
    'Renaissance Periodization hip thrust technique',
    'Renaissance Periodization',
  ),
  search(
    'sl-rdl-bodyweight',
    'Squat University single leg romanian deadlift technique',
    'Squat University',
  ),
  search('kickstand-rdl', 'kickstand romanian deadlift technique E3 Rehab', 'E3 Rehab'),
  search('single-leg-balance', 'Precision Movement single leg balance drill', 'Precision Movement'),
  search(
    'single-leg-reach',
    'single leg reach balance drill Precision Movement',
    'Precision Movement',
  ),
  search('goblet-squat', 'Squat University goblet squat technique', 'Squat University'),
  search(
    'bodyweight-squat-supported',
    'assisted bodyweight squat knee pain Squat University',
    'Squat University',
  ),
  search(
    'supported-split-squat',
    'split squat technique knee friendly Squat University',
    'Squat University',
  ),
  search('standing-calf-raise', 'Knees Over Toes Guy calf raise tutorial', 'Knees Over Toes Guy'),
  search('tibialis-raise', 'Knees Over Toes Guy tibialis raise tutorial', 'Knees Over Toes Guy'),
  search('hamstring-slider-curl', 'hamstring slider curl technique E3 Rehab', 'E3 Rehab'),
  search('pallof-press', 'Squat University pallof press anti rotation core', 'Squat University'),
  search('farmer-carry', 'Squat University farmer carry technique', 'Squat University'),
  search('suitcase-carry', 'suitcase carry technique core Squat University', 'Squat University'),
  search('shoulder-car', 'Precision Movement shoulder CARs tutorial', 'Precision Movement'),
  search('hip-car', 'Precision Movement hip CARs tutorial', 'Precision Movement'),
  search('wall-slide', 'wall slide shoulder mobility E3 Rehab', 'E3 Rehab'),
  search('open-book', 'thoracic open book rotation Strength Side', 'Strength Side'),
  search('ninety-ninety', 'Strength Side 90 90 hip transition tutorial', 'Strength Side'),
  search('couch-stretch', 'Tom Merrick couch stretch hip flexor tutorial', 'Tom Merrick'),
  search(
    'worlds-greatest-stretch',
    "Strength Side world's greatest stretch tutorial",
    'Strength Side',
  ),
  search('ankle-rock', 'Knees Over Toes Guy ankle knee over toe rock', 'Knees Over Toes Guy'),
  search('deep-squat-hold', 'Tom Merrick deep squat hold mobility', 'Tom Merrick'),
  search('bear-crawl', 'Strength Side bear crawl technique', 'Strength Side'),
  search('quadruped-shoulder-tap', 'quadruped shoulder tap core stability tutorial', 'E3 Rehab'),
  search('forward-treadmill-walk', 'incline treadmill walking form tips', 'E3 Rehab'),
  search(
    'backward-treadmill-walk',
    'Knees Over Toes Guy backwards treadmill walking',
    'Knees Over Toes Guy',
  ),
  search(
    'backward-floor-walk',
    'backwards walking knee health Knees Over Toes Guy',
    'Knees Over Toes Guy',
  ),
  search('arm-circles', 'arm circles shoulder warm up tutorial', 'Precision Movement'),
  search(
    'scapular-push-up',
    'scapular push up serratus tutorial Calisthenicmovement',
    'Calisthenicmovement',
  ),
  search('bodyweight-squat', 'bodyweight squat technique Squat University', 'Squat University'),

  /* ------------------------------------- 14-week hypertrophy block */
  search(
    'incline-dumbbell-press',
    'incline dumbbell press technique Renaissance Periodization',
    'Renaissance Periodization',
  ),
  search(
    'incline-smith-press',
    'incline smith machine press technique',
    'Renaissance Periodization',
  ),
  search('flat-dumbbell-press', 'flat dumbbell bench press technique', 'Renaissance Periodization'),
  search('chest-press-machine', 'chest press machine setup technique', 'Renaissance Periodization'),
  search(
    'seated-dumbbell-shoulder-press',
    'seated dumbbell shoulder press technique',
    'Renaissance Periodization',
  ),
  search(
    'cable-lateral-raise',
    'cable lateral raise side delt technique',
    'Renaissance Periodization',
  ),
  search('dumbbell-lateral-raise', 'dumbbell lateral raise technique', 'Renaissance Periodization'),
  search('chest-supported-row', 'chest supported row technique', 'Renaissance Periodization'),
  search(
    'neutral-grip-lat-pulldown',
    'neutral grip lat pulldown technique',
    'Renaissance Periodization',
  ),
  search('cable-face-pull', 'cable face pull technique shoulder health E3 Rehab', 'E3 Rehab'),
  search(
    'smith-machine-squat',
    'smith machine squat technique Squat University',
    'Squat University',
  ),
  search('leg-press', 'leg press technique setup Squat University', 'Squat University'),
  search('leg-extension', 'leg extension technique knee health E3 Rehab', 'E3 Rehab'),
  search('seated-leg-curl', 'seated leg curl technique hamstrings', 'Renaissance Periodization'),
  search('lying-leg-curl', 'lying leg curl technique hamstrings', 'Renaissance Periodization'),
  search('cable-crunch', 'kneeling cable crunch technique abs', 'Renaissance Periodization'),
  search(
    'captains-chair-leg-raise',
    'captains chair leg raise technique abs',
    'Calisthenicmovement',
  ),
  search('lying-leg-raise', 'lying leg raise technique lower abs', 'Calisthenicmovement'),
  search('cable-curl', 'cable curl proper form biceps', 'Jeff Nippard'),
  search('rope-triceps-pressdown', 'rope triceps pushdown proper form', 'Jeff Nippard'),
];

const BY_ID: Record<string, VideoReference> = Object.fromEntries(
  EXERCISE_VIDEOS.map((v) => [v.exerciseId, v]),
);

/** Resolves the video for an exercise, honouring a user override from Settings. */
export function getVideo(
  exerciseId: string,
  overrides: Record<string, VideoReference> = {},
): VideoReference | undefined {
  const override = overrides[exerciseId];
  if (override) return override;
  return BY_ID[exerciseId];
}

export function isSearchLink(video: VideoReference): boolean {
  return !video.verified || video.url.includes('/results?search_query=');
}
