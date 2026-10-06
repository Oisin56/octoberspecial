/**
 * Scorecards for the October Special 2026.
 * Sources: offcourse.co and golfsherpa.co.uk scorecards (Oct 2026).
 * Stroke indexes change from time to time: CHECK AGAINST THE CARD ON THE DAY.
 * The organiser can edit par/SI in the app before teeing off.
 */

export interface CourseData {
  slug: string;
  name: string;
  location: string;
  lat: number;
  lon: number;
  par: number[]; // 18
  si: number[]; // 18
  tees: Record<string, number[]>; // yards per hole
  blurb: string;
}

export const COURSES: CourseData[] = [
  {
    slug: "druids-heath",
    name: "Druids Heath",
    location: "Newtownmountkennedy, Co. Wicklow",
    lat: 53.075,
    lon: -6.085,
    // Druids Glen Resort card (par 71). SI from the resort's published card (hole 12 = index 1).
    par: [4, 5, 3, 5, 3, 4, 4, 4, 4, 4, 3, 4, 4, 3, 5, 4, 4, 4],
    si: [2, 8, 14, 18, 16, 6, 4, 12, 10, 7, 13, 1, 5, 17, 15, 3, 9, 11],
    tees: {
      White: [420, 540, 185, 503, 178, 454, 408, 351, 391, 385, 185, 457, 338, 159, 475, 449, 375, 367],
      Green: [406, 528, 168, 491, 148, 370, 352, 313, 347, 373, 147, 413, 329, 148, 407, 415, 335, 359],
    },
    blurb:
      "Pat Ruddy's 2003 course at the Druids Glen resort: heathland with links-like touches, gorse, deep bunkers, lakes and sea breezes, with views of the mountains and the Irish Sea.",
  },
  {
    slug: "wicklow",
    name: "Wicklow Golf Club",
    location: "Wicklow Town, Co. Wicklow",
    lat: 52.974,
    lon: -6.031,
    par: [5, 4, 4, 4, 4, 4, 3, 4, 3, 4, 3, 4, 4, 5, 4, 5, 3, 4],
    si: [8, 1, 18, 12, 16, 4, 10, 6, 15, 2, 17, 7, 5, 3, 9, 13, 11, 14],
    tees: {
      Blue: [522, 401, 264, 302, 301, 406, 137, 396, 144, 363, 170, 397, 348, 545, 356, 474, 161, 348],
      White: [515, 392, 252, 297, 296, 355, 119, 364, 143, 354, 164, 383, 341, 540, 318, 456, 143, 337],
    },
    blurb:
      "A clifftop course above Wicklow town. Short on the card at par 71, but the wind off the sea does the defending.",
  },
  {
    slug: "macreddin",
    name: "Macreddin",
    location: "Macreddin Village, Co. Wicklow",
    lat: 52.898,
    lon: -6.348,
    par: [4, 5, 4, 3, 4, 4, 3, 5, 4, 4, 4, 4, 5, 3, 5, 4, 3, 4],
    si: [6, 8, 10, 16, 4, 18, 14, 12, 2, 13, 17, 1, 11, 15, 5, 3, 9, 7],
    tees: {
      Black: [407, 556, 434, 178, 433, 317, 209, 615, 449, 316, 339, 442, 535, 186, 552, 481, 190, 440],
      White: [363, 513, 396, 173, 402, 299, 177, 564, 412, 302, 292, 398, 499, 162, 514, 451, 165, 411],
      Yellow: [338, 482, 361, 159, 354, 287, 157, 529, 378, 294, 265, 360, 466, 127, 480, 419, 137, 385],
    },
    blurb:
      "A Paddy Merrigan design in a secluded valley in the Wicklow hills, over 7,000 yards from the back. Water and elevation everywhere.",
  },
  {
    slug: "rathsallagh",
    name: "Rathsallagh",
    location: "Dunlavin, Co. Wicklow",
    lat: 53.035,
    lon: -6.689,
    par: [5, 4, 4, 3, 4, 5, 3, 4, 4, 4, 5, 4, 3, 4, 4, 5, 3, 4],
    si: [13, 2, 15, 11, 9, 6, 17, 4, 7, 1, 10, 12, 18, 14, 8, 5, 16, 3],
    tees: {
      White: [506, 436, 367, 158, 373, 490, 177, 351, 370, 438, 510, 355, 134, 332, 374, 516, 170, 426],
    },
    blurb:
      "Parkland on a historic estate on the Wicklow–Kildare border, designed by Peter McEvoy and Christy O'Connor Jnr. Mature trees, water and fast greens.",
  },
  {
    slug: "concra-wood",
    name: "Concra Wood",
    location: "Castleblayney, Co. Monaghan",
    lat: 54.105,
    lon: -6.74,
    par: [5, 4, 4, 5, 4, 3, 4, 4, 3, 4, 4, 3, 5, 3, 5, 4, 4, 4],
    si: [13, 3, 17, 5, 1, 15, 11, 7, 9, 6, 4, 16, 12, 18, 14, 2, 8, 10],
    tees: {
      Gold: [535, 418, 372, 577, 440, 179, 374, 383, 191, 447, 385, 187, 531, 173, 484, 442, 403, 403],
      Black: [500, 400, 352, 543, 410, 177, 380, 370, 178, 433, 367, 187, 497, 161, 470, 427, 410, 373],
      Green: [471, 352, 325, 508, 384, 153, 332, 310, 168, 403, 345, 164, 474, 150, 420, 384, 363, 342],
    },
    blurb:
      "A Christy O'Connor Jnr design wrapped around Lough Muckno. Big drumlin country, lakeside holes and one of the best newer courses in Ulster.",
  },
  {
    slug: "slieve-russell",
    name: "Slieve Russell",
    location: "Ballyconnell, Co. Cavan",
    lat: 54.112,
    lon: -7.592,
    par: [4, 4, 4, 3, 4, 5, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5],
    si: [10, 1, 6, 16, 3, 18, 8, 14, 12, 2, 11, 4, 9, 17, 5, 7, 15, 13],
    tees: {
      Blue: [425, 428, 394, 162, 433, 507, 220, 389, 548, 408, 189, 436, 528, 370, 452, 170, 409, 533],
      White: [397, 403, 371, 151, 410, 485, 200, 329, 509, 393, 173, 415, 494, 346, 410, 156, 376, 512],
    },
    blurb:
      "A big parkland championship course in the Cavan lakelands, with lakes and water in play and a stern run of par 4s.",
  },
  {
    slug: "farnham-estate",
    name: "Farnham Estate",
    location: "Cavan Town, Co. Cavan",
    lat: 54.0,
    lon: -7.405,
    par: [4, 4, 4, 4, 3, 5, 4, 3, 5, 4, 4, 3, 4, 4, 5, 3, 4, 5],
    si: [15, 11, 5, 1, 7, 17, 9, 3, 13, 16, 12, 6, 2, 8, 18, 10, 4, 14],
    tees: {
      Blue: [365, 375, 355, 420, 170, 536, 377, 192, 456, 335, 423, 180, 400, 275, 541, 161, 386, 476],
      White: [347, 356, 337, 399, 162, 509, 358, 182, 433, 318, 402, 171, 380, 261, 514, 153, 367, 452],
      Yellow: [329, 338, 320, 378, 153, 482, 339, 173, 410, 302, 381, 162, 360, 248, 487, 145, 347, 428],
    },
    blurb:
      "A Jeff Howes design through 1,300 acres of ancient woodland and lakes on the Farnham Estate. A fitting place for the 40-point finale.",
  },
];

export function courseBySlug(slug: string) {
  return COURSES.find((c) => c.slug === slug);
}
