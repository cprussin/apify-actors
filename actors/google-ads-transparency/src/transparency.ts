import type { RpcClient } from "./http.js";
import {
  parseSearchCreatives,
  parseSuggestions,
  searchCreativesRequest,
  suggestionsRequest,
  type SearchFilter,
  type SearchPage,
  type Suggestions,
} from "./rpc.js";

/** The Transparency Center calls the actor needs (mockable in tests). */
export interface TransparencyApi {
  suggestions(query: string, count: number): Promise<Suggestions>;
  searchCreatives(
    filter: SearchFilter,
    count: number,
    pageToken?: string,
  ): Promise<SearchPage>;
  /** Raw content.js of an ad preview. */
  preview(url: string): Promise<string>;
}

export class Transparency implements TransparencyApi {
  constructor(private readonly client: RpcClient) {}

  async suggestions(query: string, count: number): Promise<Suggestions> {
    return parseSuggestions(
      await this.client.rpc(
        "SearchService/SearchSuggestions",
        suggestionsRequest(query, count),
      ),
    );
  }

  async searchCreatives(
    filter: SearchFilter,
    count: number,
    pageToken?: string,
  ): Promise<SearchPage> {
    return parseSearchCreatives(
      await this.client.rpc(
        "SearchService/SearchCreatives",
        searchCreativesRequest(filter, count, pageToken),
      ),
    );
  }

  preview(url: string): Promise<string> {
    return this.client.get(url);
  }
}
