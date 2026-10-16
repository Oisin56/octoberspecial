/** The front page's sample round: its slug, and the event its notes and clips are "posted" with. Kept tiny, because
 *  every on-course queue checks it before sending anything. */
export const SAMPLE_SLUG = "sample-round";
export const isSample = (slug: string | null | undefined) => slug === SAMPLE_SLUG;
export const SAMPLE_POST_EVENT = "mgs-sample-post";
