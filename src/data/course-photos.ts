/**
 * Free-licence course photos (Geograph Ireland, CC BY-SA 2.0), credited on the site.
 * The organiser can replace any of them with their own in Admin → Rounds.
 * Images are fetched and resized by the site's image service (next/image), not hot-linked by visitors.
 */
export interface CoursePhoto {
  src: string;
  page: string;
  author: string;
  licence: string;
  alt: string;
  nearby: boolean;
}

export const COURSE_PHOTOS: Record<string, CoursePhoto> = {
  "druids-heath": {
    "src": "https://s0.geograph.org.uk/geophotos/01/58/73/1587318_673124ca.jpg",
    "page": "https://www.geograph.ie/photo/1587318",
    "author": "Dean Molyneaux",
    "licence": "CC BY-SA 2.0",
    "alt": "Golfers on the first hole at Druids Glen",
    "nearby": false
  },
  "wicklow": {
    "src": "https://s0.geograph.org.uk/photos/22/89/228956_6e237de9.jpg",
    "page": "https://www.geograph.ie/photo/228956",
    "author": "Margaret Clough",
    "licence": "CC BY-SA 2.0",
    "alt": "Golf course on Wicklow Head",
    "nearby": false
  },
  "macreddin": {
    "src": "https://s0.geograph.org.uk/geophotos/04/59/03/4590316_84e6bd37.jpg",
    "page": "https://www.geograph.ie/photo/4590316",
    "author": "Jonathan Thacker",
    "licence": "CC BY-SA 2.0",
    "alt": "Path through the golf course at Macreddin, ~3 km from Aughrim",
    "nearby": false
  },
  "concra-wood": {
    "src": "https://s0.geograph.org.uk/geophotos/03/65/91/3659108_817bd313.jpg",
    "page": "https://www.geograph.ie/photo/3659108",
    "author": "D Gore",
    "licence": "CC BY-SA 2.0",
    "alt": "9th green at Concra Wood, ground falling away to Lough Muckno with Hope Castle beyond",
    "nearby": false
  },
  "slieve-russell": {
    "src": "https://s0.geograph.org.uk/geophotos/06/48/77/6487792_a1462708.jpg",
    "page": "https://www.geograph.ie/photo/6487792",
    "author": "Sean Davis",
    "licence": "CC BY-SA 2.0",
    "alt": "First tee",
    "nearby": false
  },
  "farnham-estate": {
    "src": "https://s0.geograph.org.uk/geophotos/02/14/54/2145427_ef110cc6.jpg",
    "page": "https://www.geograph.ie/photo/2145427",
    "author": "D Gore",
    "licence": "CC BY-SA 2.0",
    "alt": "Farnham House and its estate grounds",
    "nearby": true
  }
};

/** Golf scenes (not landmarks) used as a stand-in for any course without a photo of its own. */
const STAND_INS = ["druids-heath", "wicklow", "concra-wood", "slieve-russell"];

/** The course's own free-licence photo, else a stand-in golf course photo picked by its name (always the same one). */
export function coursePhotoFor(slug: string, name: string): (CoursePhoto & { standIn: boolean }) | null {
  const own = COURSE_PHOTOS[slug.replace(/^local:/, "")];
  if (own) return { ...own, standIn: false };
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const p = COURSE_PHOTOS[STAND_INS[h % STAND_INS.length]];
  return p ? { ...p, alt: "A golf course (a stand-in until there's a photo of this one)", standIn: true } : null;
}
