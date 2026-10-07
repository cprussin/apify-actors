/**
 * Chart categories with their App Store genre ID and Google Play category.
 * "all" = no genre filter on the App Store, all non-game apps on Google Play
 * (Play has no combined apps + games chart).
 */
export const CATEGORIES = {
  all: { apple: null, google: "APPLICATION" },
  games: { apple: "6014", google: "GAME" },
  books: { apple: "6018", google: "BOOKS_AND_REFERENCE" },
  business: { apple: "6000", google: "BUSINESS" },
  education: { apple: "6017", google: "EDUCATION" },
  entertainment: { apple: "6016", google: "ENTERTAINMENT" },
  finance: { apple: "6015", google: "FINANCE" },
  foodAndDrink: { apple: "6023", google: "FOOD_AND_DRINK" },
  healthAndFitness: { apple: "6013", google: "HEALTH_AND_FITNESS" },
  lifestyle: { apple: "6012", google: "LIFESTYLE" },
  medical: { apple: "6020", google: "MEDICAL" },
  music: { apple: "6011", google: "MUSIC_AND_AUDIO" },
  navigation: { apple: "6010", google: "MAPS_AND_NAVIGATION" },
  news: { apple: "6009", google: "NEWS_AND_MAGAZINES" },
  photoAndVideo: { apple: "6008", google: "PHOTOGRAPHY" },
  productivity: { apple: "6007", google: "PRODUCTIVITY" },
  shopping: { apple: "6024", google: "SHOPPING" },
  socialNetworking: { apple: "6005", google: "SOCIAL" },
  sports: { apple: "6004", google: "SPORTS" },
  travel: { apple: "6003", google: "TRAVEL_AND_LOCAL" },
  utilities: { apple: "6002", google: "TOOLS" },
  weather: { apple: "6001", google: "WEATHER" },
} as const satisfies Record<string, { apple: string | null; google: string }>;

export type Category = keyof typeof CATEGORIES;

export const CHARTS = ["topFree", "topPaid", "topGrossing"] as const;
export type Chart = (typeof CHARTS)[number];
