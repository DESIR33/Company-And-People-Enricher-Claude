// SMB vertical taxonomy.
//
// Phase 5 — every directory connector already keys its category preset
// map by the same set of slugs ("plumber", "hvac", "restaurant", …).
// This file is the single source of truth for what each slug *means*
// across taxonomies the rest of the system cares about:
//
//   - NAICS codes — used by state Secretary-of-State filings searches,
//     state license boards, and Manta listings.
//   - SIC codes   — legacy but still appears in older datasets.
//   - Aliases     — the natural search terms users type ("plumbers",
//     "plumbing services", "plumbing contractor"). Lets the discover
//     UI resolve free text to a canonical vertical.
//
// Per-directory category codes (Google Place types, Foursquare ids,
// Yelp slugs, etc.) intentionally stay in their own connector files
// for now — those connectors maintain them as part of their data
// shape. The lookup helpers in lib/taxonomy/lookup.ts read both.

export type Vertical = {
  slug: string;
  label: string;
  /** Higher-level grouping for menu sectioning (e.g. "home_services"). */
  parent?: string;
  /**
   * Natural-language strings users might type. Lower-cased; matched
   * with both substring and exact comparison. Always include the slug
   * itself + the label here for symmetry.
   */
  aliases: string[];
  /** NAICS-2022 codes. Most-specific (6-digit) first; primary in [0]. */
  naics: string[];
  /** SIC-1987 codes. Empty when there isn't a clean match. */
  sic: string[];
};

// Verticals in this list cover the 50-ish SMB types this engine targets
// most. Add new entries freely — alphabetised within each parent group
// to make merges easier; ordering doesn't affect lookup behaviour.
export const VERTICALS: readonly Vertical[] = [
  // --- Home services ----------------------------------------------------
  {
    slug: "carpenter",
    label: "Carpenter",
    parent: "home_services",
    aliases: ["carpenter", "carpentry", "finish carpenter", "framing"],
    naics: ["238350", "236118"],
    sic: ["1751"],
  },
  {
    slug: "carpet_cleaning",
    label: "Carpet & Upholstery Cleaning",
    parent: "home_services",
    aliases: ["carpet cleaning", "carpet cleaner", "upholstery cleaning"],
    naics: ["561740"],
    sic: ["7217"],
  },
  {
    slug: "cleaning",
    label: "Janitorial / Cleaning Services",
    parent: "home_services",
    aliases: [
      "cleaning",
      "cleaning service",
      "janitorial",
      "house cleaning",
      "maid service",
      "commercial cleaning",
    ],
    naics: ["561720"],
    sic: ["7349"],
  },
  {
    slug: "electrician",
    label: "Electrician",
    parent: "home_services",
    aliases: ["electrician", "electrical contractor", "electrical services"],
    naics: ["238210"],
    sic: ["1731"],
  },
  {
    slug: "fencing",
    label: "Fencing Contractor",
    parent: "home_services",
    aliases: ["fence", "fencing", "fence company", "fence contractor"],
    naics: ["238990"],
    sic: ["1799"],
  },
  {
    slug: "flooring",
    label: "Flooring Contractor",
    parent: "home_services",
    aliases: ["flooring", "floor installation", "hardwood floors", "tile floors"],
    naics: ["238330"],
    sic: ["1752"],
  },
  {
    slug: "garage_door",
    label: "Garage Door Service",
    parent: "home_services",
    aliases: ["garage door", "garage door repair", "garage door installation"],
    naics: ["238350"],
    sic: ["1799"],
  },
  {
    slug: "general_contractor",
    label: "General Contractor",
    parent: "home_services",
    aliases: [
      "general contractor",
      "remodeler",
      "home remodeling",
      "residential construction",
      "home builder",
    ],
    naics: ["236118", "238990"],
    sic: ["1521"],
  },
  {
    slug: "handyman",
    label: "Handyman",
    parent: "home_services",
    aliases: ["handyman", "handyman service", "home repair"],
    naics: ["811490", "238990"],
    sic: ["7699"],
  },
  {
    slug: "hvac",
    label: "HVAC Contractor",
    parent: "home_services",
    aliases: [
      "hvac",
      "hvac contractor",
      "heating and cooling",
      "heating and air conditioning",
      "air conditioning",
      "ac repair",
      "furnace repair",
    ],
    naics: ["238220"],
    sic: ["1711"],
  },
  {
    slug: "landscaper",
    label: "Landscaping Services",
    parent: "home_services",
    aliases: [
      "landscaper",
      "landscaping",
      "lawn care",
      "lawn service",
      "gardener",
      "yard service",
    ],
    naics: ["561730"],
    sic: ["0782"],
  },
  {
    slug: "locksmith",
    label: "Locksmith",
    parent: "home_services",
    aliases: ["locksmith", "lock repair", "key cutting"],
    naics: ["561622"],
    sic: ["7699"],
  },
  {
    slug: "painter",
    label: "Painting Contractor",
    parent: "home_services",
    aliases: ["painter", "painting", "house painter", "painting contractor"],
    naics: ["238320"],
    sic: ["1721"],
  },
  {
    slug: "pest_control",
    label: "Pest Control",
    parent: "home_services",
    aliases: ["pest control", "exterminator", "termite control"],
    naics: ["561710"],
    sic: ["7342"],
  },
  {
    slug: "plumber",
    label: "Plumber",
    parent: "home_services",
    aliases: [
      "plumber",
      "plumbers",
      "plumbing",
      "plumbing services",
      "plumbing contractor",
    ],
    naics: ["238220"],
    sic: ["1711"],
  },
  {
    slug: "pool_service",
    label: "Pool Service",
    parent: "home_services",
    aliases: ["pool service", "pool cleaning", "pool maintenance", "pool repair"],
    naics: ["561790"],
    sic: ["7389"],
  },
  {
    slug: "roofer",
    label: "Roofing Contractor",
    parent: "home_services",
    aliases: ["roofer", "roofing", "roofing contractor", "roof repair"],
    naics: ["238160"],
    sic: ["1761"],
  },
  {
    slug: "tree_service",
    label: "Tree Service",
    parent: "home_services",
    aliases: ["tree service", "arborist", "tree removal", "tree trimming"],
    naics: ["561730"],
    sic: ["0783"],
  },
  {
    slug: "window_treatments",
    label: "Window & Door Installation",
    parent: "home_services",
    aliases: ["window installation", "windows", "doors", "window contractor"],
    naics: ["238150"],
    sic: ["1751"],
  },

  // --- Food / hospitality ----------------------------------------------
  {
    slug: "bakery",
    label: "Retail Bakery",
    parent: "food",
    aliases: ["bakery", "bakeries", "bread", "pastry shop"],
    naics: ["311811"],
    sic: ["5461"],
  },
  {
    slug: "bar",
    label: "Bar / Pub",
    parent: "food",
    aliases: ["bar", "pub", "tavern", "cocktail bar", "wine bar"],
    naics: ["722410"],
    sic: ["5813"],
  },
  {
    slug: "cafe",
    label: "Café / Coffee Shop",
    parent: "food",
    aliases: ["cafe", "café", "coffee shop", "coffee", "espresso bar"],
    naics: ["722515"],
    sic: ["5812"],
  },
  {
    slug: "catering",
    label: "Catering",
    parent: "food",
    aliases: ["catering", "caterer", "private chef"],
    naics: ["722320"],
    sic: ["5812"],
  },
  {
    slug: "fast_food",
    label: "Fast Food",
    parent: "food",
    aliases: ["fast food", "quick service", "qsr"],
    naics: ["722513"],
    sic: ["5812"],
  },
  {
    slug: "food_truck",
    label: "Food Truck",
    parent: "food",
    aliases: ["food truck", "food cart", "mobile food"],
    naics: ["722330"],
    sic: ["5812"],
  },
  {
    slug: "hotel",
    label: "Hotel / Motel",
    parent: "food",
    aliases: ["hotel", "motel", "lodging", "inn", "bed and breakfast"],
    naics: ["721110"],
    sic: ["7011"],
  },
  {
    slug: "restaurant",
    label: "Restaurant",
    parent: "food",
    aliases: [
      "restaurant",
      "restaurants",
      "diner",
      "bistro",
      "eatery",
      "fine dining",
    ],
    naics: ["722511"],
    sic: ["5812"],
  },

  // --- Health / medical -------------------------------------------------
  {
    slug: "chiropractor",
    label: "Chiropractor",
    parent: "health",
    aliases: ["chiropractor", "chiropractic", "back pain", "spine clinic"],
    naics: ["621310"],
    sic: ["8041"],
  },
  {
    slug: "dentist",
    label: "Dentist",
    parent: "health",
    aliases: ["dentist", "dental", "dental office", "orthodontist"],
    naics: ["621210"],
    sic: ["8021"],
  },
  {
    slug: "doctor",
    label: "Physician / Medical Office",
    parent: "health",
    aliases: ["doctor", "physician", "medical office", "primary care", "clinic"],
    naics: ["621111"],
    sic: ["8011"],
  },
  {
    slug: "optometrist",
    label: "Optometrist / Eye Care",
    parent: "health",
    aliases: ["optometrist", "optometry", "eye doctor", "vision care"],
    naics: ["621320"],
    sic: ["8042"],
  },
  {
    slug: "pharmacy",
    label: "Pharmacy",
    parent: "health",
    aliases: ["pharmacy", "drug store", "drugstore", "pharmacist"],
    naics: ["446110"],
    sic: ["5912"],
  },
  {
    slug: "physical_therapy",
    label: "Physical Therapy",
    parent: "health",
    aliases: ["physical therapy", "pt", "physiotherapy", "rehab clinic"],
    naics: ["621340"],
    sic: ["8049"],
  },
  {
    slug: "veterinarian",
    label: "Veterinarian",
    parent: "health",
    aliases: ["veterinarian", "vet", "veterinary clinic", "animal hospital"],
    naics: ["541940"],
    sic: ["0742"],
  },

  // --- Beauty / personal care ------------------------------------------
  {
    slug: "barber",
    label: "Barber Shop",
    parent: "beauty",
    aliases: ["barber", "barbershop", "barber shop"],
    naics: ["812111"],
    sic: ["7241"],
  },
  {
    slug: "beauty",
    label: "Beauty Salon",
    parent: "beauty",
    aliases: ["beauty salon", "beautician", "esthetician"],
    naics: ["812112"],
    sic: ["7231"],
  },
  {
    slug: "hair",
    label: "Hair Salon",
    parent: "beauty",
    aliases: [
      "hair salon",
      "hair stylist",
      "hairdresser",
      "salon",
      "blow dry bar",
    ],
    naics: ["812112"],
    sic: ["7231"],
  },
  {
    slug: "massage",
    label: "Massage Therapy",
    parent: "beauty",
    aliases: ["massage", "massage therapy", "bodywork"],
    naics: ["812199"],
    sic: ["7299"],
  },
  {
    slug: "nails",
    label: "Nail Salon",
    parent: "beauty",
    aliases: ["nail salon", "nails", "manicure", "pedicure"],
    naics: ["812113"],
    sic: ["7231"],
  },
  {
    slug: "spa",
    label: "Day Spa",
    parent: "beauty",
    aliases: ["spa", "day spa", "wellness spa"],
    naics: ["812199"],
    sic: ["7299"],
  },
  {
    slug: "tattoo",
    label: "Tattoo Studio",
    parent: "beauty",
    aliases: ["tattoo", "tattoo studio", "tattoo parlor", "piercing"],
    naics: ["812199"],
    sic: ["7299"],
  },

  // --- Auto -------------------------------------------------------------
  {
    slug: "auto_body",
    label: "Auto Body Shop",
    parent: "auto",
    aliases: ["auto body", "collision repair", "body shop"],
    naics: ["811121"],
    sic: ["7532"],
  },
  {
    slug: "car_repair",
    label: "Auto Repair",
    parent: "auto",
    aliases: ["auto repair", "car repair", "mechanic", "auto shop"],
    naics: ["811111"],
    sic: ["7538"],
  },
  {
    slug: "car_wash",
    label: "Car Wash",
    parent: "auto",
    aliases: ["car wash", "auto wash", "detailing"],
    naics: ["811192"],
    sic: ["7542"],
  },
  {
    slug: "oil_change",
    label: "Oil Change / Lube Shop",
    parent: "auto",
    aliases: ["oil change", "lube shop", "quick lube"],
    naics: ["811191"],
    sic: ["7549"],
  },
  {
    slug: "tire_shop",
    label: "Tire Shop",
    parent: "auto",
    aliases: ["tire shop", "tires", "tire store"],
    naics: ["441320"],
    sic: ["5531"],
  },
  {
    slug: "towing",
    label: "Towing Service",
    parent: "auto",
    aliases: ["towing", "tow truck", "roadside assistance"],
    naics: ["488410"],
    sic: ["7549"],
  },

  // --- Retail -----------------------------------------------------------
  {
    slug: "florist",
    label: "Florist",
    parent: "retail",
    aliases: ["florist", "flower shop", "flowers"],
    naics: ["453110"],
    sic: ["5992"],
  },
  {
    slug: "pet_store",
    label: "Pet Store",
    parent: "retail",
    aliases: ["pet store", "pet shop", "pet supplies"],
    naics: ["453910"],
    sic: ["5999"],
  },

  // --- Fitness ----------------------------------------------------------
  {
    slug: "fitness",
    label: "Gym / Fitness Center",
    parent: "fitness",
    aliases: ["gym", "fitness", "fitness center", "health club"],
    naics: ["713940"],
    sic: ["7991"],
  },
  {
    slug: "yoga",
    label: "Yoga Studio",
    parent: "fitness",
    aliases: ["yoga", "yoga studio", "vinyasa"],
    naics: ["611620"],
    sic: ["7991"],
  },
  {
    slug: "martial_arts",
    label: "Martial Arts Studio",
    parent: "fitness",
    aliases: ["martial arts", "karate", "jiu jitsu", "mma gym", "taekwondo"],
    naics: ["611620"],
    sic: ["7991"],
  },

  // --- Professional services -------------------------------------------
  {
    slug: "accountant",
    label: "Accounting Firm",
    parent: "professional",
    aliases: [
      "accountant",
      "accounting",
      "cpa",
      "bookkeeper",
      "tax preparation",
    ],
    naics: ["541211", "541213"],
    sic: ["8721"],
  },
  {
    slug: "financial_advisor",
    label: "Financial Advisor",
    parent: "professional",
    aliases: ["financial advisor", "financial planner", "wealth management"],
    naics: ["523930"],
    sic: ["6282"],
  },
  {
    slug: "insurance",
    label: "Insurance Agency",
    parent: "professional",
    aliases: ["insurance agency", "insurance broker", "insurance agent"],
    naics: ["524210"],
    sic: ["6411"],
  },
  {
    slug: "lawyer",
    label: "Law Firm",
    parent: "professional",
    aliases: ["lawyer", "attorney", "law firm", "law office", "legal services"],
    naics: ["541110"],
    sic: ["8111"],
  },
  {
    slug: "marketing_agency",
    label: "Marketing / Advertising Agency",
    parent: "professional",
    aliases: ["marketing agency", "advertising agency", "ad agency", "branding"],
    naics: ["541613", "541810"],
    sic: ["7311"],
  },
  {
    slug: "realtor",
    label: "Real Estate Agency",
    parent: "professional",
    aliases: ["realtor", "real estate agent", "real estate broker", "realty"],
    naics: ["531210"],
    sic: ["6531"],
  },
  {
    slug: "web_design",
    label: "Web Design / Dev Agency",
    parent: "professional",
    aliases: ["web design", "web development", "web agency", "design agency"],
    naics: ["541511", "541512"],
    sic: ["7371"],
  },
];
