typescript
import { Octokit } from "@octokit/rest";
import {
  getOpenPullRequests,
  getPullRequestDiff,
  getIssueDetails,
  postReviewComment,
  ListPullRequestsParams,
  PullRequestReviewComment,
} from "../githubClient";
import { Logger } from "../logger";

// ---------------------------------------------------------------------------
// Logger mock (used to verify logging calls)
// ---------------------------------------------------------------------------
jest.mock("../logger", () => ({
  Logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Octokit mock
// ---------------------------------------------------------------------------
jest.mock("@octokit/rest");

const mockOctokit = new Octokit() as jest.Mocked<Octokit>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const testOwner = "test-owner";
const testRepo = "test-repo";
const testPrNumber = 42;
const testIssueNumber = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Creates a minimal pagination response for Octokit.
 */
function paginatedResponse<T>(data: T, headers?: Record<string, string>): { data: T } {
  return {
    data,
    headers: { link: undefined, ...headers },
    status: 200,
    url: "https://api.github.com",
  } as any;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("githubClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===================================================================
  // getOpenPullRequests
  // ===================================================================
  describe("getOpenPullRequests", () => {
    it("should return open pull requests when API call succeeds", async () => {
      const mockPrs = [
        { number: 1, title: "PR1", state: "open" },
        { number: 2, title: "PR2", state: "open" },
      ];
      mockOctokit.pulls.list.mockResolvedValueOnce(paginatedResponse(mockPrs));

      const result = await getOpenPullRequests(mockOctokit, testOwner, testRepo);

      expect(result).toEqual(mockPrs);
      expect(mockOctokit.pulls.list).toHaveBeenCalledWith({
        owner: testOwner,
        repo: testRepo,
        state: "open",
      });
      expect(Logger.info).toHaveBeenCalledWith(
        "Retrieved 2 open pull requests",
        expect.any(Object)
      );
    });

    it("should handle empty list (no open PRs)", async () => {
      mockOctokit.pulls.list.mockResolvedValueOnce(paginatedResponse([]));

      const result = await getOpenPullRequests(mockOctokit, testOwner, testRepo);

      expect(result).toEqual([]);
    });

    it.each([
      ["Rate limit exceeded", 429],
      ["Not Found", 404],
      ["Internal Server Error", 500],
      ["Forbidden", 403],
      ["Conflict", 409],
      ["Connection timeout", -1],
    ])("should handle HTTP %i error: %s", async (_desc, status) => {
      const error = new Error("API error");
      (error as any).status = status;
      mockOctokit.pulls.list.mockRejectedValueOnce(error);

      await expect(
        getOpenPullRequests(mockOctokit, testOwner, testRepo)
      ).rejects.toThrow("API error");
      expect(Logger.error).toHaveBeenCalledWith(
        "Failed to fetch pull requests",
        expect.objectContaining({ status })
      );
    });

    it("should throw when owner is empty", async () => {
      await expect(
        getOpenPullRequests(mockOctokit, "", testRepo)
      ).rejects.toThrow("Invalid parameters: owner and repo must be provided");
    });

    it("should throw when repo is empty", async () => {
      await expect(
        getOpenPullRequests(mockOctokit, testOwner, "")
      ).rejects.toThrow("Invalid parameters: owner and repo must be provided");
    });

    it("should throw when client is null", async () => {
      await expect(
        getOpenPullRequests(null as any, testOwner, testRepo)
      ).rejects.toThrow("Invalid parameters: client must be provided");
    });

    it("should handle paginated responses by returning all pages", async () => {
      const page1 = [{ number: 1, title: "PR1" }];
      const page2 = [{ number: 2, title: "PR2" }];
      mockOctokit.pulls.list
        .mockResolvedValueOnce(paginatedResponse(page1, { link: '<https://api.github.com/repos/owner/repo/pulls?page=2>; rel="next", <https://api.github.com/repos/owner/repo/pulls?page=3>; rel="last"' }))
        .mockResolvedValueOnce(paginatedResponse(page2, { link: undefined }));

      const result = await getOpenPullRequests(mockOctokit, testOwner, testRepo);

      expect(result).toHaveLength(2);
      expect(result).toEqual([...page1, ...page2]);
    });
  });

  // ===================================================================
  // getPullRequestDiff
  // ===================================================================
  describe("getPullRequestDiff", () => {
    const mockDiff =
      "diff --git a/file.ts b/file.ts\nindex abc..def 100644\n--- a/file.ts\n+++ b/file.ts\n@@ -1,3 +1,4 @@\n+new line";

    it("should return the diff for a given PR number", async () => {
      // PR exists
      mockOctokit.pulls.get.mockResolvedValueOnce(
        paginatedResponse({
          diff_url: `https://api.github.com/repos/${testOwner}/${testRepo}/pulls/${testPrNumber}.diff`,
        })
      );
      // Fetch diff content
      mockOctokit.request.mockResolvedValueOnce({ data: mockDiff } as any);

      const result = await getPullRequestDiff(mockOctokit, testOwner, testRepo, testPrNumber);

      expect(result).toBe(mockDiff);
      expect(mockOctokit.pulls.get).toHaveBeenCalledWith({
        owner: testOwner,
        repo: testRepo,
        pull_number: testPrNumber,
      });
      expect(mockOctokit.request).toHaveBeenCalledWith("GET /repos/:owner/:repo/pulls/:pull_number.diff", {
        owner: testOwner,
        repo: testRepo,
        pull_number: testPrNumber,
      });
    });

    it("should throw when PR does not exist (404)", async () => {
      const error = new Error("Not Found");
      (error as any).status = 404;
      mockOctokit.pulls.get.mockRejectedValueOnce(error);

      await expect(
        getPullRequestDiff(mockOctokit, testOwner, testRepo, testPrNumber)
      ).rejects.toThrow("Not Found");
    });

    it("should throw when PR number is not a positive integer", async () => {
      await expect(
        getPullRequestDiff(mockOctokit, testOwner, testRepo, 0)
      ).rejects.toThrow("Invalid parameters: pull_number must be a positive integer");
    });

    it("should throw when PR number is negative", async () => {
      await expect(
        getPullRequestDiff(mockOctokit, testOwner, testRepo, -5)
      ).rejects.toThrow("Invalid parameters: pull_number must be a positive integer");
    });

    it("should return empty string when diff is empty", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce(
        paginatedResponse({ diff_url: `https://api.github.com/repos/${testOwner}/${testRepo}/pulls/${testPrNumber}.diff` })
      );
      mockOctokit.request.mockResolvedValueOnce({ data: "" } as any);

      const result = await getPullRequestDiff(mockOctokit, testOwner, testRepo, testPrNumber);

      expect(result).toBe("");
    });

    it("should handle rate limiting during diff fetch", async () => {
      mockOctokit.pulls.get.mockResolvedValueOnce(
        paginatedResponse({ diff_url: `https://api.github.com/repos/${testOwner}/${testRepo}/pulls/${testPrNumber}.diff` })
      );
      const error = new Error("Rate limit exceeded");
      (error as any).status = 429;
      mockOctokit.request.mockRejectedValueOnce(error);

      await expect(
        getPullRequestDiff(mockOctokit, testOwner, testRepo, testPrNumber)
      ).rejects.toThrow("Rate limit exceeded");
    });
  });

  // ===================================================================
  // getIssueDetails
  // ===================================================================
  describe("getIssueDetails", () => {
    it("should return issue body and comments for a valid issue number", async () => {
      const mockIssue = { body: "Issue body text", number: testIssueNumber };
      const mockComments = [{ body: "Comment 1" }, { body: "Comment 2" }];
      mockOctokit.issues.get.mockResolvedValueOnce(paginatedResponse(mockIssue));
      mockOctokit.issues.listComments.mockResolvedValueOnce(paginatedResponse(mockComments));

      const result = await getIssueDetails(mockOctokit, testOwner, testRepo, testIssueNumber);

      expect(result).toEqual({ body: "Issue body text", comments: ["Comment 1", "Comment 2"] });
      expect(mockOctokit.issues.get).toHaveBeenCalledWith({
        owner: testOwner,
        repo: testRepo,
        issue_number: testIssueNumber,
      });
      expect(mockOctokit.issues.listComments).toHaveBeenCalledWith({
        owner: testOwner,
        repo: testRepo,
        issue_number: testIssueNumber,
      });
    });

    it("should return empty comments array when issue has no comments", async () => {
      const mockIssue = { body: "Issue body text", number: testIssueNumber };
      mockOctokit.issues.get.mockResolvedValueOnce(paginatedResponse(mockIssue));
      mockOctokit.issues.listComments.mockResolvedValueOnce(paginatedResponse([]));

      const result = await getIssueDetails(mockOctokit, testOwner, testRepo, testIssueNumber);

      expect(result.comments).toEqual([]);
    });

    it("should return null body when issue has no body", async () => {
      const mockIssue = { body: null, number: testIssueNumber };
      mockOctokit.issues.get.mockResolvedValueOnce(paginatedResponse(mockIssue));
      mockOctokit.issues.listComments.mockResolvedValueOnce(paginatedResponse([]));

      const result = await getIssueDetails(mockOctokit, testOwner, testRepo, testIssueNumber);

      expect(result.body).toBeNull();
    });

    it("should throw if issue does not exist (404)", async () => {
      const error = new Error("Not Found");
      (error as any).status = 404;
      mockOctokit.issues.get.mockRejectedValueOnce(error);

      await expect(
        getIssueDetails(mockOctokit, testOwner, testRepo, 999)
      ).rejects.toThrow("Not Found");
    });

    it("should throw when issue number is invalid", async () => {
      await expect(
        getIssueDetails(mockOctokit, testOwner, testRepo, -1)
      ).rejects.toThrow("Invalid parameters: issue_number must be a positive integer");
    });

    it("should throw when issue number is zero", async () => {
      await expect(
        getIssueDetails(mockOctokit, testOwner, testRepo, 0)
      ).rejects.toThrow("Invalid parameters: issue_number must be a positive integer");
    });

    it("should handle pagination of comments (multiple pages)", async () => {
      const mockIssue = { body: "Issue body", number: testIssueNumber };
      const page1 = [{ body: "Comment 1" }, { body: "Comment 2" }];
      const page2 = [{ body: "Comment 3" }];
      mockOctokit.issues.get.mockResolvedValueOnce(paginatedResponse(mockIssue));
      mockOctokit.issues.listComments
        .mockResolvedValueOnce(paginatedResponse(page1, { link: '<https://api.github.com/repos/owner/repo/issues/1/comments?page=2>; rel="next"' }))
        .mockResolvedValueOnce(paginatedResponse(page2, { link: undefined }));

      const result = await getIssueDetails(mockOctokit, testOwner, testRepo, testIssueNumber);

      expect(result.comments).toEqual(["Comment 1", "Comment 2", "Comment 3"]);
    });
  });

  // ===================================================================
  // postReviewComment
  // ===================================================================
  describe("postReviewComment", () => {
    const baseComment: PullRequestReviewComment = {
      body: "# [Claude Code]\n\nThis looks good.",
      commit_id: "abc123",
      path: "file.ts",
      line: 10,
    };

    it("should post a comment successfully", async () => {
      mockOctokit.pulls.createReviewComment.mockResolvedValueOnce(
        paginatedResponse({ id: 123 })
      );

      const result = await postReviewComment(mockOctokit, testOwner, testRepo, testPrNumber, baseComment);

      expect(result).toBe(true);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: testOwner,
        repo: testRepo,
        pull_number: testPrNumber,
        body: baseComment.body,
        commit_id: baseComment.commit_id,
        path: baseComment.path,
        line: baseComment.line,
      });
    });

    it("should return false when posting comment fails due to rate limit (429)", async () => {
      const comment: PullRequestReviewComment = { body: "Test comment" };
      const rateLimitError = new Error("Rate limit exceeded");
      (rateLimitError as any).status = 429;
      mockOctokit.pulls.createReviewComment.mockRejectedValueOnce(rateLimitError);

      const result = await postReviewComment(mockOctokit, testOwner, testRepo, testPrNumber, comment);

      expect(result).toBe(false);
      expect(Logger.warn).toHaveBeenCalledWith(
        "Rate limit reached while posting comment, returning false",
        expect.any(Object)
      );
    });

    it("should return false when posting comment fails due to 403 (Forbidden)", async () => {
      const error = new Error("Forbidden");
      (error as any).status = 403;
      mockOctokit.pulls.createReviewComment.mockRejectedValueOnce(error);

      const result = await postReviewComment(mockOctokit, testOwner, testRepo, testPrNumber, { body: "test" });

      expect(result).toBe(false);
    });

    it("should rethrow non-rate-limit and non-forbidden errors", async () => {
      const comment: PullRequestReviewComment = { body: "Test comment" };
      mockOctokit.pulls.createReviewComment.mockRejectedValueOnce(new Error("Validation error"));

      await expect(
        postReviewComment(mockOctokit, testOwner, testRepo, testPrNumber, comment)
      ).rejects.toThrow("Validation error");
    });

    it("should post comment without optional fields (minimal)", async () => {
      const minimalComment: PullRequestReviewComment = {
        body: "Minimal comment",
      };
      mockOctokit.pulls.createReviewComment.mockResolvedValueOnce(
        paginatedResponse({ id: 456 })
      );

      const result = await postReviewComment(mockOctokit, testOwner, testRepo, testPrNumber, minimalComment);

      expect(result).toBe(true);
      expect(mockOctokit.pulls.createReviewComment).toHaveBeenCalledWith({
        owner: testOwner,
        repo: testRepo,
        pull_number: testPrNumber,
        body: "Minimal comment",
        commit_id: undefined,
        path: undefined,
        line: undefined,
      });
    });

    it("should throw if body is empty", async () => {
      await expect(
        postReviewComment(mockOctokit, testOwner, testRepo, testPrNumber, { body: "" })
      ).rejects.toThrow("Invalid parameters: comment body must be a non-empty string");
    });

    it("should handle network errors gracefully", async () => {
      const networkError = new Error("Network failure");
      (networkError as any).code = "ECONNRESET";
      mockOctokit.pulls.createReviewComment.mockRejectedValueOnce(networkError);

      await expect(
        postReviewComment(mockOctokit, testOwner, testRepo, testPrNumber, { body: "test" })
      ).rejects.toThrow("Network failure");
    });

    it("should log debug when posting succeeds", async () => {
      mockOctokit.pulls.createReviewComment.mockResolvedValueOnce(
        paginatedResponse({ id: 789 })
      );

      await postReviewComment(mockOctokit, testOwner, testRepo, testPrNumber, baseComment);

      expect(Logger.debug).toHaveBeenCalledWith(
        "Review comment posted successfully",
        expect.objectContaining({ commentId: 789 })
      );
    });
  });
});