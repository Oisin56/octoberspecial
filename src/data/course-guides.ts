/**
 * Course guides for the October Special courses: background the AI writer uses for
 * previews, bulletins, reports and film narration. Researched from the clubs' own
 * hole guides and published reviews (October 2026); sources listed per course.
 * Holes with no reliable description are left out rather than guessed.
 * The organiser can edit any of this in Admin → Rounds.
 */
import type { CourseGuide } from "@/lib/types";

export const GUIDES: Record<string, CourseGuide & { sources: string[] }> = {
  "druids-heath": {
    "overview": "Druids Heath was designed by Pat Ruddy and opened in 2003 as the second course at the Druids Glen resort near Newtownmountkennedy, Co. Wicklow. It is a mix of heathland and parkland with links-like elements, with gorse-lined rough, plentiful and often deep bunkers, several lakes and views of the mountains and the Irish Sea. Wide, rolling fairways and downhill tee shots are a feature, and sea breezes are a constant factor in how it plays. It hosted the 2006 Irish PGA Championship. The resort's published layout is par 71.",
    "signature": "The 12th, a long par 4 and stroke index 1, is the hole the resort calls one of the great par 4s in Irish golf; the drive must thread between gorse and hillsides. The par-3 14th, the 'quarry hole', is played to a green set in an old rock quarry surrounded by rock and gorse.",
    "holes": {
      "1": "Par 4, dogleg left to right. Keep the tee shot tight to the right side of the fairway; a fairway bunker on the left catches drives.",
      "2": "Downhill risk-reward par 5 with a wide fairway. Two lakes front a small green.",
      "3": "Par 3 protected by water, a pond running from tee to the left side of the green. A slope disguised by the right-hand bunker can help the tee shot.",
      "4": "Short par 5 that looks more daunting than it is. Gorse and bunkers to avoid; keep the tee shot to the right side of the fairway.",
      "5": "Uphill par 3. Take at least one more club, two into the wind.",
      "6": "Par 4 whose fairway narrows the further you go. Avoid the fairway bunkers.",
      "7": "Par 4, dogleg left with a blind tee shot that sets up to mislead; the line is on the left. Long hitters can cut the corner past bunkers.",
      "8": "Short par 4 to an elevated green. Best to lay up to a favourite yardage for the second.",
      "9": "Par 4 with a bunker in the middle of the fairway, which longer hitters can carry.",
      "10": "Long, straightforward par 4 where missing the fairway is heavily punished.",
      "11": "Picturesque, postage-stamp par 3. Short shots are punished; the green slopes from right to left.",
      "12": "Stroke index 1. Long par 4: drive between a left bunker and a right-hand tree, through gorse and hillsides. Downslope helps; misses left, right or short leave a scramble.",
      "13": "Picturesque medium-length par 4. Gorse hillside left off the tee, but keep the drive tight to the left; water right and in front of the green.",
      "14": "The 'quarry hole': short par 3 to a green in an old rock quarry, surrounded by rock and gorse. Club selection vital; do not be short.",
      "15": "Short, uphill risk-reward par 5, the only par 5 on the back nine. Favour the left: tall trees block from the right. Hidden bunkers.",
      "16": "Downhill par 4 whose fairway narrows the further you go. Avoid the bunkers left of the fairway.",
      "17": "Testing par 4. Drive must avoid the bunkers, leaving an uphill second shot.",
      "18": "Par 4 finish that looks harder than it is. Narrow opening to the fairway, bunkers, and an elevated green."
    },
    "sources": [
      "https://www.druidsglenresort.com/?p=650",
      "https://golfdigestme.com/ireland-is-treasure-island-day-5-druids-heath/",
      "https://www.globaltravelerusa.com/irish-rose/",
      "http://www.golftop18.com/druids-heath-golf-club-review.html",
      "https://www.top100golfcourses.com/golf-course/druids-heath",
      "https://www.irishtimes.com/sport/golf/2025/07/03/best-golf-courses-in-co-wicklow-bucket-list-courses-and-hidden-gems-from-the-european-club-along-brittas-bay-to-picturesque-druids-glen/",
      "https://www.golfingrecord.com/golf-scorecard/7d9efc4e-e574-0266-5ba2-c2fa37370be9",
      "https://www.golfingrecord.com/golf-scorecard/24cf295d-065e-b168-63ec-df66247b7d99",
      "https://18birdies.com/golf-courses/club/c659d370-86ac-11e4-8c28-020000005b00/druids-heath-golf-club",
      "https://www.1golf.eu/en/club/druids-heath-golf-club/scorecard/"
    ]
  },
  "wicklow": {
    "overview": "Wicklow Golf Club was founded in 1904 as a nine-hole course on the cliffs at Dunbur Head, just south of Wicklow town, and was extended to 18 holes to a design by Pat Ruddy and the late Tom Craddock in the early 1990s. It is a compact (about 90 acres) clifftop course on parkland-type soil with a links feel, tilting down towards the sea from the clubhouse, with views of the sea from every hole and of the Wicklow Mountains. Fairways roll and hang on slopes, there are blind shots and elevated greens, seven greens sit on or very close to the cliff edge, and exposure to wind makes greens hard to hit. It is hilly; buggies are widely recommended. Par 71.",
    "signature": "The par-4 6th, nicknamed 'Pebble Beach', asks for a tee shot carried over the cliffs and the Irish Sea to reach the fairway from the back tees. Three par 3s – the 7th, 11th and 17th – are played across Dunbur Glen.",
    "holes": {
      "1": "Opening par 5 that tumbles downhill from the clubhouse towards the sea.",
      "6": "Signature par 4, 'Pebble Beach'. From the back (blue) tees the drive must carry rugged cliffs and the Irish Sea, about 175-190 yards, to the fairway.",
      "7": "Short par 3 played across Dunbur Glen. Quirky, eccentric green that can yield a birdie or a triple bogey.",
      "11": "Par 3 played across Dunbur Glen.",
      "17": "Par 3 played across Dunbur Glen."
    },
    "sources": [
      "https://www.irishgolfdesk.com/news-files/2018/12/27/wicklows-clifftop-wonderland",
      "https://www.irishtimes.com/sport/golf/2025/07/03/best-golf-courses-in-co-wicklow-bucket-list-courses-and-hidden-gems-from-the-european-club-along-brittas-bay-to-picturesque-druids-glen/",
      "https://www.todays-golfer.com/courses/europe/rep-of-ireland/co-wicklow/wicklow-golf-club",
      "https://www.leadingcourses.com/clubs/europe+ireland+leinster+county-wicklow/wicklow-golf-club",
      "https://discoverireland.ie/wicklow/wicklow-golf-club",
      "https://www.golfnow.com/courses/-412-wicklow-golf-club-details",
      "https://www.golfpass.com/travel-advisor/courses/20631-wicklow-golf-club",
      "https://www.golfshake.com/course/view/16682/Wicklow_Golf_Club.html",
      "https://www.1golf.eu/en/club/wicklow-golf-club/reviews/",
      "https://www.yourgolftravel.com/wicklow-golf-club",
      "https://www.top100golfcourses.com/golf-course/wicklow"
    ]
  },
  "macreddin": {
    "overview": "Macreddin was Paul McGinley's first course design and remains his only full course design in Ireland; work began in 2005, nine holes opened in September 2007 and the full 18 opened in summer 2008. It is a par-72 parkland course on about 160 acres stretching up both sides of the valley at Macreddin, beside the BrookLodge hotel, with gorse, tall pines and spruce and big elevation changes. The front nine is tree-lined and demanding; the back nine is shaped by the Macreddin and Ballycrean brooks. Many holes are doglegs and accuracy matters more than length. It is hilly with long walks from some greens to tees, so buggies are commonly recommended.",
    "signature": "The par-4 12th ('McGinley's'), stroke index 1 and the designer's favourite, is played from a hugely elevated tee over the ravine of Ballycrean Brook. The par-3 4th ('Kite's Nest') drops to a green about 40 metres below the tee, and the 18th finishes with the brook criss-crossing the fairway.",
    "holes": {
      "1": "'Cronawinna'. Generous fairway for the opening drive; the hole then turns left to a green set in its own vale.",
      "2": "'Deer Run'. First of the tree-lined fairways. Par 5 turning right after the drive to a green nestled among pines and spruce.",
      "3": "'Ballcoog'. Elevated tee with a panoramic view down the valley. Generous landing area, then a straightforward iron to a large green.",
      "4": "'Kite's Nest'. Long par 3 to a green about 40 metres below the tee; the ball hangs in the air a long time.",
      "5": "'Furze & Pheasants'. Plays longer than its yardage, usually into the prevailing wind. Drive positioning is key to a straightforward second.",
      "6": "'Druid's Dell'. Short par 4; a long, accurate drive sets up a birdie chance.",
      "7": "'Forager's Way'. Par 3 from tees nestled in pines and spruce; medium iron to a well-guarded green.",
      "8": "'Croghan'. Par 5, level for the first half, then turns right and runs downhill to a green in the valley.",
      "9": "'The Bridle Path'. Par 4 flanked by woodland on the left. Tricky second shot to a green backed by the Macreddin stone bridge.",
      "10": "'Above Ground'. Short, uphill par 4 with a narrow fairway; short iron to a small, well-guarded green. Mounding hides the lower part of the pin.",
      "11": "'The Blue School'. Short uphill par 4. Stream left of the fairway, woodland right; accurate drive leaves a straightforward approach.",
      "12": "'McGinley's'. Stroke index 1. Dogleg par 4 from a hugely elevated tee; drive over Ballycrean Brook's ravine, then a long iron between pines.",
      "13": "'Hidden Valley'. Tree-lined par 5 playing downhill with the prevailing wind. Risk-reward second to a well-bunkered green.",
      "14": "'The Crooked Birch'. Par 3 with a stream guarding the approach to a long green, allowing widely varying pin positions.",
      "15": "'Coillte'. Last par 5. Densely tree-lined fairway curving right; a meandering stream comes into play for the second shot.",
      "16": "'Pine Valley'. Longest par 4 on the course, carved through woodland; demands length and accuracy.",
      "17": "'Kingfisher'. Downhill par 3; the brook runs across the front of a wide but shallow green.",
      "18": "'Ballycrean'. Risk-reward par-4 finish: an island landing area with the Macreddin brook criss-crossing the fairway."
    },
    "sources": [
      "https://www.macreddingolfclub.com/the-course/",
      "https://www.macreddingolfclub.com/",
      "https://www.irishtimes.com/sport/a-memorable-golfing-experience-in-wicklow-1.932171",
      "https://destinationgolf.travel/macreddin-enjoys-a-rhythm-that-just-builds-from-the-moment-you-step-onto-the-1st-tee/",
      "https://destinationgolf.travel/dg-ireland-top150-2024-macreddin",
      "https://www.brooklodge.com/attractions/golf/",
      "https://www.top100golfcourses.com/golf-course/macreddin",
      "https://www.golfpass.com/travel-advisor/courses/29132-macreddin-golf-club"
    ]
  },
  "rathsallagh": {
    "overview": "Rathsallagh was designed by Peter McEvoy and Christy O'Connor Jnr and opened in 1994 on roughly 270 acres of rolling parkland on the Rathsallagh House estate near Dunlavin, Co. Wicklow. The course was built around the estate's mature beech, oak and lime trees (reportedly not a tree was felled in construction), with burns, ditches, ponds and lakes bringing water into play on several holes. It is par 72, about 6,885 yards from the back tees and 6,483 from the whites, with around 45 well-placed bunkers and USGA-specification greens noted for their contours and tiers. The club closed in February 2015 and reopened under new ownership in June 2016. Tee-shot placement is the recurring theme: tree-lined doglegs and tiered greens punish the wrong side of the fairway.",
    "signature": "The 10th, a long par-4 Index 1 squeezed between oak trees and a ditch on the left and a lake on the right, and the uphill 18th to a multi-tiered green are the holes reviewers single out as among the finest in Ireland. The downhill par-3 13th (134 yards from the whites) and the hazard-strewn par-5 6th are also widely praised.",
    "holes": {
      "1": "Gentle, generous par 5 to open, designed to ease players into their rhythm; an early birdie chance.",
      "2": "Dogleg par 4 through an avenue of trees. Tee-shot placement is key to seeing a green with a narrowing entrance and deep bunkers on both sides.",
      "4": "Par 3 with plenty of trouble around it; one reviewer says it has wrecked many cards.",
      "6": "Par 5 needing a draw around an oak wood left and a tree jutting into the fairway. Drain down the right; humpy green guarded by two lakes and bunkers short.",
      "7": "Par 3 played across a pond to a green set against a backdrop of tall pines and mature trees.",
      "8": "Short par 4 that runs straight then turns sharply, about 90 degrees. Water short and long of the green, a deep bunker and a narrow putting surface.",
      "9": "Strong uphill par 4 that turns right to left, demanding an exacting iron approach to a sharply sloping two-tiered green.",
      "10": "Index 1 par 4. Oaks and a ditch line the left, a large lake sits right. Pulled drives find water or rough; a push rules out reaching in two.",
      "13": "Short downhill par 3 played from a high tee; very pretty, and rated by reviewers as one of the best short holes around.",
      "16": "Par 5 that doglegs twice (a double dogleg).",
      "18": "Long uphill par 4 finisher: out of bounds left, trouble right and a semi-blind approach to a heavily tiered green. Reviewers rate it one of Ireland's toughest closing holes."
    },
    "sources": [
      "https://irishgolfer.ie/latest-golf-news/courses-travel/2017/03/25/after-reopening-in-2016-rathsallagh-has-quickly-returned-to-its-best-d1/",
      "https://www.top100golfcourses.com/golf-course/rathsallagh/reviews/6969",
      "https://www.top100golfcourses.com/golf-course/rathsallagh/reviews",
      "https://www.top100golfcourses.com/golf-course/rathsallagh",
      "https://www.ireland-guide.com/golf/rathsallagh-golf-club.5024.html",
      "https://www.rathsallaghcountryclub.com/",
      "https://www.rathsallaghcountryclub.com/course-history.html",
      "https://www.rathsallagh.com/golf.html",
      "https://irishgolfer.ie/?p=5039",
      "https://destinationgolf.travel/rathsallagh-its-like-playing-through-a-grand-estate/",
      "https://www.1golf.eu/en/club/rathsallagh-golf-country-club/scorecard/",
      "https://18birdies.com/golf-courses/club/7ba9a5d0-86ac-11e4-8c28-020000005b00/rathsallagh-golf-club",
      "https://www.golfpass.com/travel-advisor/courses/20601-rathsallagh-golf-club"
    ]
  },
  "concra-wood": {
    "overview": "Concra Wood was designed by Christy O'Connor Jnr with his uncle Christy O'Connor Snr and formally opened in 2008. It replaced Castleblayney Golf Club, a nine-holer founded in 1905, on a roughly 240-acre estate beside Lough Muckno. The lough borders the course on three sides and, according to Irish Golf Desk, comes into play on 11 holes, with the main water stretches at the 4th to 6th and the 12th to 16th. It is a big, spacious parkland layout of more than 7,000 yards from the championship tees, with significant elevation changes, elevated tees and holes that reveal themselves only from the tee. One reviewer raises concerns about playability at some times of year, and visitor comments recommend a buggy.",
    "signature": "The par-5 4th is usually called the signature hole: a double dogleg that swings right, then runs along the lough and dips left to a narrow shoreside green. The 10th, with its plunging approach from an elevated fairway to a green overlooking the lough, and the lakeside par-5 13th ('Lough Muckno') are the other standouts. The 16th's tee shot over water also draws praise.",
    "holes": {
      "1": "Par-5 opener ('Castleblaney') offering an early scoring chance if the drive finds the fairway.",
      "2": "Solid par 4; a controlled drive sets up a mid-iron approach.",
      "3": "Shorter par 4 dropping quickly downhill and doglegging out towards the lough; the green is guarded by a pond. Rewards accurate positioning off the tee.",
      "4": "Signature par 5, a double dogleg: narrow tee shot, fairway veers sharply right, runs beside the lough, then dips left to a narrow green just above the waterline.",
      "5": "Testing par 4 needing both length and precision to reach in regulation; part of the 4th-6th stretch where Lough Muckno threatens.",
      "6": "Par 3 calling for a precise strike; falls within the 4th-6th lakeside stretch.",
      "7": "Par 4 where accuracy off the tee gives a good chance to attack the green.",
      "9": "Longer par 3 demanding good distance control to avoid trouble.",
      "10": "'Crossmaglen': strong par 4 needing a good drive, then a spectacular approach from an elevated fairway plunging down to a green overlooking the lough.",
      "11": "Par 4 offering birdie chances after a well-placed tee shot.",
      "12": "Quality par 3 with the lake in play; club selection is key.",
      "13": "'Lough Muckno': par 5 with the lake in play and a tempting tiger line to cut the corner. Reaching in two is tough; the green is huge and deceptive.",
      "14": "Shortest hole on the course, about 160 yards, rewarding precision over power; part of the lakeside 12th-16th stretch.",
      "15": "Short par 5 whose tee shot cuts across a corner of the lake; a good chance to pick up a shot.",
      "16": "Long par 4 doglegging right to left. The tee seems to sit in the lake, the drive carries water and the green is lakeside.",
      "17": "Strong penultimate par 4 that tests consistency.",
      "18": "Par-4 finisher ('Christy Jnr') with the clubhouse towering above the green; needs focus and accuracy."
    },
    "sources": [
      "https://www.concrawood.ie/",
      "https://www.concrawood.ie/course-guide/",
      "https://www.irishgolfdesk.com/news-files/2018/2/26/concra-wood-christy-juniors-glittering-lakeside-gem",
      "https://www.top100golfcourses.com/golf-course/concra-wood",
      "https://www.top100golfcourses.com/golf-course/concra-wood/reviews/46654",
      "https://www.top100golfcourses.com/golf-course/concra-wood/reviews",
      "https://top100.nationalclubgolfer.com/golfcourse/concra-wood",
      "https://destinationgolf.travel/concra-wood-this-is-golf-on-a-big-and-spacious-scale/",
      "https://www.todays-golfer.com/courses/europe/rep-of-ireland/monaghan/concra-wood-golf-club/",
      "https://where2golf.com/ireland/concra-wood-golf-country-club",
      "https://www.golfnow.com/courses/-1157-concra-wood-golf-country-club-details",
      "https://www.golfpass.com/travel-advisor/courses/20845-concra-wood-golf-country-club",
      "https://www.travelextra.ie/golf-in-irelands-county-monaghan"
    ]
  },
  "slieve-russell": {
    "overview": "The championship course at Slieve Russell (now branded PGA National Ireland Slieve Russell) was designed by Paddy (Patrick) Merrigan and opened in 1992 on a 300-acre estate near Ballyconnell that includes about 50 acres of lakes. It is a parkland layout wrapped around the lakes and drumlins of west Cavan, par 72 and a little over 7,000 yards from the back tees, with roughly 100 bunkers and large, rolling greens that reviewers describe as fast and tricky to read. Water is most prominent on the 11th, 12th, 13th and 16th, and the quarry sand-and-gravel base gives it a reputation for good drainage. It has hosted the Irish PGA Championship (1996), the European Tour's North West of Ireland Open (2001 and 2002) and the European Ladies' Team Championship (July 2026).",
    "signature": "The par-5 13th, 'Watergate', is the best-known hole: a dogleg left whose drive carries Lough Rud, with the fairway hugging the water all the way to a green on the lake's edge and an 'SR' floral display beside it. The elevated par-3 7th ('Tee More'), the par-3 11th over water and the par-3 16th ('The Mourning Pond') are also frequently singled out.",
    "holes": {
      "1": "'Shannon Pot'. Opening par 4 that doglegs left to right, with a highly visible bunker at the elbow of the dogleg.",
      "2": "'Aghavoher Leap'. Long par 4 with water in play: downhill drive over water to a narrow fairway, then an uphill approach over water to an elevated, well-protected green.",
      "4": "'Wishing Well'. Short par 3 demanding accuracy and distance control; a multi-tiered green means finding the wrong plateau brings three-putts into play.",
      "5": "'Feather Bed Lane'. Par 4 with a heavily undulating fairway and elevation changes; a single bunker guards the green.",
      "7": "'Tee More'. Long par 3 played from an elevated tee, the green fully visible below and ringed by bunkers on all sides; wind judgement is key.",
      "10": "'Swan Lake'. Par 4 snaking left to right, with bunkers at the elbow and an elevated, well-protected green.",
      "11": "'Heron Haunt'. Par 3 played over water to a stage-like green; anything short finds water, and four bunkers surround the putting surface.",
      "12": "'Risky Rud'. Difficult par 4 swinging right to left, with water down the entire left side; the green sits into the water with bunkering on the right.",
      "13": "'Watergate'. Par-5 dogleg left: drive over Lough Rud, bite off as much as you dare. Fairway clings to the lake all the way to a waterside green; reachable in two.",
      "16": "'The Mourning Pond'. Par 3 where water covers anything short; bunkers guard the other sides of the green.",
      "17": "'Cranaghan Bend'. Par 4 doglegging left to right; tee-shot placement matters to set up the approach to an elevated green.",
      "18": "'The Gap'. Strong closing par 5 with a meandering fairway that weaves left and right towards the green."
    },
    "sources": [
      "https://www.slieverussell.ie/golf",
      "https://www.slieverussell.ie/golf/course-overview/",
      "https://www.slieverussell.ie/golf/hole-by-hole/",
      "https://www.golfshake.com/course/news/14130/PGA_National_Ireland_Slieve_Russell_Feature_Review.html",
      "https://linksmagazine.com/great-courses-of-britain-ireland-slieve-russell/",
      "https://irishgolfer.ie/top-100/2022/06/21/best-100-golf-holes-in-ireland-2022/",
      "https://www.gogolfing.ie/golf-course.php?id_club=52",
      "https://www.ireland-guide.com/golf/slieve-russell-golf-club.4986.html",
      "https://www.fairwaysandfundays.com/golf-courses-ireland/slieve-russell-golf-club/",
      "https://www.golfwow.com/en/courses/ireland/pga-national-slieve-russell",
      "https://findagolfbreak.com/courses/pga-national-ireland-slieve-russell/",
      "https://www.golfpass.com/travel-advisor/articles/ireland-golf-trip-dispatch-dublin-northern-ireland-rosapenna-st-patricks-portstewart-portmarnock-slieve-russell",
      "https://www.top100golfcourses.com/golf-course/slieve-russell",
      "https://en.wikipedia.org/wiki/2026_European_Ladies%27_Team_Championship"
    ]
  },
  "farnham-estate": {
    "overview": "Farnham Estate's course was designed by Jeff Howes, a Kilkenny-based Canadian architect (GolfPass also credits Jonathan Davison). Most sources say it opened in 2009. It is a par-72 parkland course spread over about 500 acres just outside Cavan town on the Killeshandra road, with two contrasting nines. The front nine runs over open, undulating meadow and the back nine climbs into dense, tighter woodland. A meandering stream and seven lakes bring water into play, the bunkers are described as large, flat-bottomed and natural-looking, and reviewers praise the greens. Several reviewers mention soft or wet fairways and long walks between some greens and tees, and buggies are recommended.",
    "signature": "The 4th is generally regarded as the signature hole and is the designer's own favourite: a stroke-index-1 par 4 needing a slight draw between two large oak trees to a green guarded by water. The 2nd (a downhill par 4 over a stream), the drivable par-4 14th, the tree-lined par-5 15th and the par-5 18th around the lake below the hotel are also often mentioned.",
    "holes": {
      "1": "Opening par 4 with a very open, generous fairway and plenty of room left and right.",
      "2": "Long par 4 from a high tee, downhill between trees left and rough slope right; approach crosses a stream/pond to a green in a glade. Avoid the right.",
      "3": "Par 4 with water in play; how much of the water to take on is the strategic decision.",
      "4": "Stroke index 1 and the designer's favourite. Needs a slight draw between two large oaks; the well-guarded green has water behind and to the right, so approach from the left.",
      "5": "Straightforward par 3 on the open front nine, described by one reviewer as the plainest hole on the course.",
      "6": "Long par 5 with a tight landing area for the third shot.",
      "7": "Par 4 with a large bunker hugging the left side; the fairway is generous to the right but narrows further on.",
      "8": "Long par 3 with a stream just short of the green and a long bunker and rough to the right.",
      "9": "Par 5 that plays shorter than its yardage; a good drive leaves little to reach the green.",
      "10": "First hole of the woodland back nine: a short but tight par 4, followed by a steep walk uphill from behind the green.",
      "13": "Par 4 up in the forest; wayward tee shots disappear deep into the trees, and deep rough and soft ground punish anything off line.",
      "14": "Drivable short par 4 (stroke index 16) with a hard green to hit and numerous bunkers left and right.",
      "15": "Three-shot par 5 down a narrow, tree-lined fairway sloping downhill; balls in the trees are rarely found. A reviewers' favourite.",
      "16": "Picturesque par 3 on the wooded back nine, cited by several golfers as a contender for signature hole.",
      "18": "Par-5 finisher sweeping around a lake below the hotel; tee shot carries water; taking on more water gives a chance to get home in two. Overlooked by the clubhouse terrace."
    },
    "sources": [
      "https://www.farnhamestate.ie/golf/the-course/",
      "https://jhgd.com/project/farnham-estate/",
      "https://destinationgolf.travel/farnham-estate-2/",
      "https://destinationgolf.travel/farnham-estate-golf-spa-cavan-championship-golf-luxury-resort-spa-in-the-heart-of-ireland/",
      "https://irishgolfer.ie/latest-golf-news/2019/08/01/farnham-estate-its-time-for-a-visit/",
      "https://www.golfshake.com/course/view/67865/Farnham_Estate_Golf_Club.html",
      "https://www.golfpass.com/travel-advisor/courses/32067-farnham-estate-golf-club",
      "https://www.gogolfing.ie/golf-course.php?id_club=51",
      "https://www.ireland-guide.com/golf/farnham-estate-golf-club.8796.html",
      "https://www.todays-golfer.com/courses/europe/rep-of-ireland/co-cavan/farnham-estate-golf-club",
      "https://sharkclub.golf/courses/farnham_estate_spa_and_golf_resort_cavan.html",
      "https://www.yourgolftravel.com/farnham-estate-spa-and-golf-resort",
      "https://www.golfnow.co.uk/courses/-1138-farnham-estate-golf-spa-resort-details",
      "https://www.boards.ie/discussion/2055593350/farnham-estate-golf-course",
      "https://www.top100golfcourses.com/golf-course/farnham-estate"
    ]
  }
};
