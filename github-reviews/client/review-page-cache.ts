import type { PullRequestScope, ReviewFilter, ReviewPage } from "../shared/contracts";

export type ReviewPageRequest = { page: number; scope: PullRequestScope; reviewFilter: ReviewFilter };

// Keep each visited queue/page until a refresh replaces it or saved filters/account change.
export class ReviewPageCache {
  private revision: string | null = null;
  private epoch = 0;
  private sequence = 0;
  private accountRequest = 0;
  private login: string | null = null;
  private pages = new Map<string, ReviewPage>();
  private pending = new Map<string, Promise<ReviewPage>>();
  constructor(private readonly fetch: (input: ReviewPageRequest) => Promise<ReviewPage>) {}

  private key(input: ReviewPageRequest, revision: string) {
    if (this.revision !== revision) {
      this.revision = revision; this.epoch++;
      this.pages.clear(); this.pending.clear(); this.login = null;
    }
    return JSON.stringify([input.scope, input.scope === "created" ? "all" : input.reviewFilter, input.page]);
  }
  read(input: ReviewPageRequest, revision: string) { return this.pages.get(this.key(input, revision)); }

  load(input: ReviewPageRequest, revision: string, refresh = false): Promise<ReviewPage> {
    const key = this.key(input, revision);
    const cached = this.pages.get(key);
    if (cached && !refresh) return Promise.resolve(cached);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const epoch = this.epoch, request = ++this.sequence;
    const pending = this.fetch({ ...input, reviewFilter: input.scope === "created" ? "all" : input.reviewFilter }).then((page) => {
      if (epoch !== this.epoch) return page;
      if (this.login !== null && this.login !== page.login) {
        // An older response must not restore the previous account's cache.
        if (request < this.accountRequest) return page;
        this.epoch++; this.pages.clear(); this.pending.clear();
      }
      this.login = page.login;
      this.accountRequest = Math.max(this.accountRequest, request);
      this.pages.set(key, page);
      return page;
    }).finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); });
    this.pending.set(key, pending);
    return pending;
  }
}
