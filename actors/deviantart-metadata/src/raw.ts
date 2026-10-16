/** DeviantArt `__INITIAL_STATE__` entities, trimmed to the fields we read. */

export interface RawMediaType {
  t?: string;
  c?: string;
  w?: number;
  h?: number;
}

export interface RawMedia {
  baseUri?: string;
  prettyName?: string;
  token?: string[];
  types?: RawMediaType[];
}

export interface RawUser {
  userId?: number;
  username?: string;
  usericon?: string;
  type?: string;
  isGroup?: boolean;
  stats?: { watchers?: number; friends?: number };
}

export interface RawDeviation {
  deviationId?: number;
  type?: string;
  url?: string;
  title?: string;
  publishedTime?: string;
  isMature?: boolean;
  isDownloadable?: boolean;
  isDailyDeviation?: boolean;
  isAiUseDisallowed?: boolean;
  isAiGenerated?: boolean;
  isJournal?: boolean;
  license?: string;
  /** A user id in normalized entities, or an embedded user object. */
  author?: number | RawUser;
  stats?: {
    comments?: number;
    favourites?: number;
    views?: number;
    downloads?: number;
  };
  media?: RawMedia;
}

export interface RawDeviationExtended {
  tags?: { name?: string }[];
  stats?: { views?: number; downloads?: number };
  parentDeviationEntityId?: number;
}

export interface RawProfileStats {
  deviations?: number;
  watchers?: number;
  watching?: number;
  pageviews?: number;
  favourites?: number;
  commentsReceivedProfile?: number;
  friends?: number;
  joinDate?: string;
}

export interface RawProfileOwner {
  user?: { id?: number };
  stats?: RawProfileStats;
  tagline?: string;
}

export interface RawAbout {
  username?: string;
  country?: string;
  countrycode?: string;
  isArtist?: boolean;
  tagline?: string;
  website?: string;
}

export interface RawOembed {
  title?: string;
  author_name?: string;
  author_url?: string;
  safety?: string;
  pubdate?: string;
  tags?: string;
  thumbnail_url?: string;
  community?: {
    statistics?: {
      _attributes?: {
        views?: number;
        favorites?: number;
        comments?: number;
        downloads?: number;
      };
    };
  };
}
