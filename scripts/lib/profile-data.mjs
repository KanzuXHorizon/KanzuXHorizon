import { execFileSync } from "node:child_process";

const DAY_MS = 86_400_000;
const DEFAULT_FEATURED_LIMIT = 3;
const DEFAULT_LANGUAGE_LIMIT = 5;

const PROFILE_QUERY = `query($login:String!,$from:DateTime!,$to:DateTime!){
  user(login:$login){
    createdAt
    followers{totalCount}
    publicRepositories:repositories(privacy:PUBLIC,ownerAffiliations:OWNER){totalCount}
    contributionsCollection(from:$from,to:$to){
      contributionCalendar{
        totalContributions
        weeks{contributionDays{date contributionCount weekday}}
      }
      restrictedContributionsCount
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
    }
    repositories(first:100,privacy:PUBLIC,ownerAffiliations:OWNER,orderBy:{field:PUSHED_AT,direction:DESC}){
      nodes{
        name
        isFork
        isArchived
        stargazerCount
        forkCount
        pushedAt
        primaryLanguage{name color}
        languages(first:10,orderBy:{field:SIZE,direction:DESC}){
          edges{size node{name color}}
        }
        defaultBranchRef{
          name
          target{
            ... on Commit{
              history{totalCount}
              committedDate
              oid
            }
          }
        }
      }
    }
  }
}`;

export function resolveUsername(environment = process.env) {
  const username =
    environment.PROFILE_USERNAME ||
    environment.GITHUB_REPOSITORY_OWNER ||
    environment.GITHUB_REPOSITORY?.split("/")[0];

  if (!username) {
    throw new Error(
      "Set PROFILE_USERNAME or run inside a GitHub Actions repository context.",
    );
  }

  return username;
}

export function resolveSnapshotDate(value = process.env.PROFILE_NOW) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid PROFILE_NOW value: ${value}`);
  }
  return date;
}

export function createContributionRange(now) {
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - 364);
  fromDate.setUTCHours(0, 0, 0, 0);

  return {
    from: fromDate.toISOString(),
    to: now.toISOString(),
  };
}

export function parseRepositoryNames(value = "") {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

export function fetchProfileUser({ username, from, to }) {
  const raw = execFileSync(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${PROFILE_QUERY}`,
      "-F",
      `login=${username}`,
      "-F",
      `from=${from}`,
      "-F",
      `to=${to}`,
    ],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
  );

  const payload = JSON.parse(raw);
  if (payload.errors?.length) {
    throw new Error(
      `GitHub GraphQL request failed: ${payload.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  const user = payload.data?.user;
  if (!user) throw new Error(`GitHub user not found: ${username}`);
  return user;
}

export function getOwnedPublicRepositories(user, username) {
  return (user.repositories?.nodes || []).filter(
    (repository) =>
      repository &&
      !repository.isFork &&
      repository.name.toLowerCase() !== username.toLowerCase(),
  );
}

function compareRepositories(a, b) {
  return (
    b.stargazerCount - a.stargazerCount ||
    b.forkCount - a.forkCount ||
    new Date(b.pushedAt) - new Date(a.pushedAt) ||
    a.name.localeCompare(b.name)
  );
}

export function selectFeaturedRepositories(
  repositories,
  preferredNames = [],
  limit = DEFAULT_FEATURED_LIMIT,
) {
  const byName = new Map(
    repositories.map((repository) => [repository.name.toLowerCase(), repository]),
  );
  const preferred = [];
  const preferredSet = new Set();
  for (const name of preferredNames) {
    const repository = byName.get(name.toLowerCase());
    if (!repository || preferredSet.has(repository.name)) continue;
    preferred.push(repository);
    preferredSet.add(repository.name);
  }
  const discovered = repositories
    .filter(
      (repository) =>
        !repository.isArchived && !preferredSet.has(repository.name),
    )
    .sort(compareRepositories);

  return [...preferred, ...discovered].slice(0, Math.max(1, limit));
}

export function selectCurrentPublicRepository(repositories) {
  return repositories
    .filter(
      (repository) =>
        !repository.isArchived && repository.defaultBranchRef?.target,
    )
    .sort(
      (a, b) =>
        new Date(b.defaultBranchRef.target.committedDate || b.pushedAt) -
        new Date(a.defaultBranchRef.target.committedDate || a.pushedAt),
    )[0];
}

export function calculateContributionMetrics(user, repositories) {
  const contributions = user.contributionsCollection || {};
  const calendar = contributions.contributionCalendar || {};
  const weeks = calendar.weeks || [];
  const days = weeks
    .flatMap((week) => week.contributionDays || [])
    .sort((a, b) => a.date.localeCompare(b.date));
  const totalContributions = calendar.totalContributions || 0;
  const privateContributions = contributions.restrictedContributionsCount || 0;
  const activeDays = days.filter((day) => day.contributionCount > 0).length;
  const busiestDay = days.reduce(
    (best, day) =>
      day.contributionCount > (best?.contributionCount || 0) ? day : best,
    null,
  );

  let longestStreak = 0;
  let currentRun = 0;
  let previousActiveDate = null;
  for (const day of days) {
    if (day.contributionCount <= 0) continue;

    const currentDate = new Date(`${day.date}T00:00:00Z`);
    const gap = previousActiveDate
      ? Math.round((currentDate - previousActiveDate) / DAY_MS)
      : null;
    currentRun = gap === 1 ? currentRun + 1 : 1;
    longestStreak = Math.max(longestStreak, currentRun);
    previousActiveDate = currentDate;
  }

  return {
    weeks,
    days,
    metrics: {
      contributions: totalContributions,
      commits: contributions.totalCommitContributions || 0,
      publicProjects: repositories.length,
      publicRepositories:
        user.publicRepositories?.totalCount ?? repositories.length,
      stars: repositories.reduce(
        (sum, repository) => sum + repository.stargazerCount,
        0,
      ),
      forks: repositories.reduce(
        (sum, repository) => sum + repository.forkCount,
        0,
      ),
      followers: user.followers?.totalCount || 0,
      pullRequests: contributions.totalPullRequestContributions || 0,
      reviews: contributions.totalPullRequestReviewContributions || 0,
      issues: contributions.totalIssueContributions || 0,
      privateContributions,
      publicContributions: Math.max(
        0,
        totalContributions - privateContributions,
      ),
      activeDays,
      averagePerWeek: totalContributions / Math.max(1, weeks.length),
      longestStreak,
      busiestDay,
    },
  };
}

export function aggregateLanguages(
  repositories,
  limit = DEFAULT_LANGUAGE_LIMIT,
) {
  const languageTotals = new Map();

  for (const repository of repositories) {
    for (const edge of repository.languages?.edges || []) {
      const name = edge?.node?.name;
      const size = edge?.size || 0;
      if (!name || size <= 0) continue;

      const existing = languageTotals.get(name) || {
        name,
        color: edge.node.color || "#94a3b8",
        size: 0,
      };
      existing.size += size;
      languageTotals.set(name, existing);
    }
  }

  return [...languageTotals.values()]
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name))
    .slice(0, Math.max(1, limit));
}

export function buildProfileSnapshot(
  user,
  {
    username,
    preferredRepositoryNames = [],
    featuredLimit = DEFAULT_FEATURED_LIMIT,
    languageLimit = DEFAULT_LANGUAGE_LIMIT,
  },
) {
  const repositories = getOwnedPublicRepositories(user, username);
  const featuredRepositories = selectFeaturedRepositories(
    repositories,
    preferredRepositoryNames,
    featuredLimit,
  );
  const currentPublicRepository = selectCurrentPublicRepository(repositories);
  const { weeks, days, metrics } = calculateContributionMetrics(
    user,
    repositories,
  );

  return {
    repositories,
    featuredRepositories,
    currentPublicRepository,
    topLanguages: aggregateLanguages(featuredRepositories, languageLimit),
    weeks,
    days,
    metrics,
  };
}
