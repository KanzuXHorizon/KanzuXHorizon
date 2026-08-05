import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateLanguages,
  buildProfileSnapshot,
  calculateContributionMetrics,
  createContributionRange,
  parseRepositoryNames,
  resolveSnapshotDate,
  resolveUsername,
  selectCurrentPublicRepository,
  selectFeaturedRepositories,
} from "../scripts/lib/profile-data.mjs";

function repository(overrides = {}) {
  return {
    name: "example",
    isFork: false,
    isArchived: false,
    stargazerCount: 0,
    forkCount: 0,
    pushedAt: "2026-01-01T00:00:00Z",
    primaryLanguage: { name: "TypeScript", color: "#3178c6" },
    languages: {
      edges: [
        {
          size: 100,
          node: { name: "TypeScript", color: "#3178c6" },
        },
      ],
    },
    defaultBranchRef: {
      name: "main",
      target: {
        history: { totalCount: 10 },
        committedDate: "2026-01-01T00:00:00Z",
        oid: "0123456789abcdef",
      },
    },
    ...overrides,
  };
}

function userFixture(repositories) {
  return {
    createdAt: "2020-01-01T00:00:00Z",
    followers: { totalCount: 12 },
    publicRepositories: { totalCount: repositories.length },
    repositories: { nodes: repositories },
    contributionsCollection: {
      restrictedContributionsCount: 3,
      totalCommitContributions: 7,
      totalIssueContributions: 2,
      totalPullRequestContributions: 4,
      totalPullRequestReviewContributions: 5,
      contributionCalendar: {
        totalContributions: 10,
        weeks: [
          {
            contributionDays: [
              { date: "2026-01-01", contributionCount: 1, weekday: 4 },
              { date: "2026-01-02", contributionCount: 2, weekday: 5 },
              { date: "2026-01-03", contributionCount: 0, weekday: 6 },
            ],
          },
          {
            contributionDays: [
              { date: "2026-01-04", contributionCount: 3, weekday: 0 },
              { date: "2026-01-05", contributionCount: 4, weekday: 1 },
            ],
          },
        ],
      },
    },
  };
}

test("resolves runtime identity without a repository-specific fallback", () => {
  assert.equal(resolveUsername({ PROFILE_USERNAME: "octocat" }), "octocat");
  assert.equal(
    resolveUsername({ GITHUB_REPOSITORY: "hubot/profile" }),
    "hubot",
  );
  assert.throws(() => resolveUsername({}), /Set PROFILE_USERNAME/);
});

test("creates a reproducible rolling contribution range", () => {
  const now = resolveSnapshotDate("2026-08-05T12:00:00Z");
  assert.deepEqual(createContributionRange(now), {
    from: "2025-08-06T00:00:00.000Z",
    to: "2026-08-05T12:00:00.000Z",
  });
  assert.throws(
    () => resolveSnapshotDate("not-a-date"),
    /Invalid PROFILE_NOW/,
  );
});

test("parses optional repository preferences without duplicates", () => {
  assert.deepEqual(
    parseRepositoryNames("alpha, beta\nalpha,\n gamma"),
    ["alpha", "beta", "gamma"],
  );
});

test("uses preferred repositories first and discovers the remaining featured work", () => {
  const repositories = [
    repository({ name: "preferred", stargazerCount: 1 }),
    repository({ name: "popular", stargazerCount: 20 }),
    repository({ name: "recent", stargazerCount: 5, forkCount: 3 }),
    repository({ name: "archived", isArchived: true, stargazerCount: 99 }),
  ];

  assert.deepEqual(
    selectFeaturedRepositories(
      repositories,
      ["preferred", "PREFERRED"],
      3,
    ).map(
      ({ name }) => name,
    ),
    ["preferred", "popular", "recent"],
  );
});

test("selects the latest active repository from commit data", () => {
  const repositories = [
    repository({
      name: "older",
      defaultBranchRef: {
        name: "main",
        target: {
          history: { totalCount: 1 },
          committedDate: "2026-01-02T00:00:00Z",
          oid: "older",
        },
      },
    }),
    repository({
      name: "newer",
      defaultBranchRef: {
        name: "main",
        target: {
          history: { totalCount: 2 },
          committedDate: "2026-02-02T00:00:00Z",
          oid: "newer",
        },
      },
    }),
    repository({
      name: "archived-newest",
      isArchived: true,
      defaultBranchRef: {
        name: "main",
        target: {
          history: { totalCount: 3 },
          committedDate: "2026-03-02T00:00:00Z",
          oid: "archived",
        },
      },
    }),
  ];

  assert.equal(selectCurrentPublicRepository(repositories).name, "newer");
});

test("calculates public contribution totals and streaks", () => {
  const repositories = [repository({ name: "alpha", stargazerCount: 3 })];
  const { metrics } = calculateContributionMetrics(
    userFixture(repositories),
    repositories,
  );

  assert.equal(metrics.publicContributions, 7);
  assert.equal(metrics.privateContributions, 3);
  assert.equal(metrics.activeDays, 4);
  assert.equal(metrics.longestStreak, 2);
  assert.equal(metrics.stars, 3);
  assert.equal(metrics.publicRepositories, 1);
  assert.equal("privateRepositories" in metrics, false);
});

test("aggregates language usage across dynamically selected repositories", () => {
  const repositories = [
    repository({
      name: "alpha",
      languages: {
        edges: [
          {
            size: 100,
            node: { name: "TypeScript", color: "#3178c6" },
          },
          { size: 50, node: { name: "Python", color: "#3572A5" } },
        ],
      },
    }),
    repository({
      name: "beta",
      languages: {
        edges: [
          {
            size: 25,
            node: { name: "TypeScript", color: "#3178c6" },
          },
        ],
      },
    }),
  ];

  assert.deepEqual(aggregateLanguages(repositories, 2), [
    { name: "TypeScript", color: "#3178c6", size: 125 },
    { name: "Python", color: "#3572A5", size: 50 },
  ]);
});

test("builds a complete snapshot without repository-name hardcoding", () => {
  const repositories = [
    repository({ name: "profile-owner" }),
    repository({ name: "alpha", stargazerCount: 4 }),
    repository({
      name: "beta",
      stargazerCount: 8,
      defaultBranchRef: {
        name: "main",
        target: {
          history: { totalCount: 20 },
          committedDate: "2026-02-01T00:00:00Z",
          oid: "abcdef0123456789",
        },
      },
    }),
  ];
  const snapshot = buildProfileSnapshot(userFixture(repositories), {
    username: "profile-owner",
  });

  assert.deepEqual(
    snapshot.repositories.map(({ name }) => name),
    ["alpha", "beta"],
  );
  assert.equal(snapshot.featuredRepositories[0].name, "beta");
  assert.equal(snapshot.currentPublicRepository.name, "beta");
});
