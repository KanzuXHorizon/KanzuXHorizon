import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const username =
  process.env.PROFILE_USERNAME ||
  process.env.GITHUB_REPOSITORY_OWNER ||
  process.env.GITHUB_REPOSITORY?.split("/")[0] ||
  "KanzuXHorizon";
const outputPath = resolve(
  process.env.PROFILE_METRICS_OUTPUT || "assets/profile-metrics.svg",
);
const mobileOutputPath = resolve(
  process.env.PROFILE_METRICS_MOBILE_OUTPUT ||
    "assets/profile-metrics-mobile.svg",
);
const now = new Date();
const to = now.toISOString();
const fromDate = new Date(now);
fromDate.setUTCDate(fromDate.getUTCDate() - 364);
fromDate.setUTCHours(0, 0, 0, 0);
const from = fromDate.toISOString();

const featuredRepositoryNames = [
  "HRS-code-public",
  "folderverse-3d",
  "Fca-Horizon-Remastered",
];
const currentPublicRepositoryNames = [
  "Global_Horizon",
  "HRS-code-public",
  "folderverse-3d",
];
const configuredPrivateRepositories = Number.parseInt(
  process.env.PROFILE_PRIVATE_REPOSITORIES || "0",
  10,
);
const privateRepositoryAccessConfigured =
  process.env.PROFILE_PRIVATE_TOKEN_CONFIGURED !== "false";

const query = `query($login:String!,$from:DateTime!,$to:DateTime!){
  user(login:$login){
    createdAt
    followers{totalCount}
    publicRepositories:repositories(privacy:PUBLIC,ownerAffiliations:OWNER){totalCount}
    privateRepositories:repositories(privacy:PRIVATE,ownerAffiliations:OWNER){totalCount}
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

const raw = execFileSync(
  "gh",
  [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `login=${username}`,
    "-F",
    `from=${from}`,
    "-F",
    `to=${to}`,
  ],
  { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 },
);

const user = JSON.parse(raw)?.data?.user;
if (!user) throw new Error(`GitHub user not found: ${username}`);

const repositories = (user.repositories?.nodes || []).filter(
  (repository) =>
    repository && !repository.isFork && repository.name !== username,
);
const featuredRepositories = featuredRepositoryNames
  .map((name) => repositories.find((repository) => repository.name === name))
  .filter(Boolean);
const currentPublicRepository = repositories
  .filter(
    (repository) =>
      !repository.isArchived &&
      currentPublicRepositoryNames.includes(repository.name) &&
      repository.defaultBranchRef?.target,
  )
  .sort((a, b) => new Date(b.pushedAt) - new Date(a.pushedAt))[0];
const contributions = user.contributionsCollection || {};
const calendar = contributions.contributionCalendar || {};
const weeks = calendar.weeks || [];
const days = weeks
  .flatMap((week) => week.contributionDays || [])
  .sort((a, b) => a.date.localeCompare(b.date));

const totalContributions = calendar.totalContributions || 0;
const privateContributions = contributions.restrictedContributionsCount || 0;
const publicContributions = Math.max(
  0,
  totalContributions - privateContributions,
);
const activeDays = days.filter((day) => day.contributionCount > 0).length;
const averagePerWeek = totalContributions / Math.max(1, weeks.length);
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
    ? Math.round((currentDate - previousActiveDate) / 86_400_000)
    : null;
  currentRun = gap === 1 ? currentRun + 1 : 1;
  longestStreak = Math.max(longestStreak, currentRun);
  previousActiveDate = currentDate;
}

const metrics = {
  contributions: totalContributions,
  commits: contributions.totalCommitContributions || 0,
  publicProjects: repositories.length,
  publicRepositories: user.publicRepositories?.totalCount ?? repositories.length,
  privateRepositories: privateRepositoryAccessConfigured
    ? (user.privateRepositories?.totalCount ?? 0)
    : Number.isFinite(configuredPrivateRepositories)
      ? Math.max(0, configuredPrivateRepositories)
      : 0,
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
  publicContributions,
  activeDays,
  averagePerWeek,
  longestStreak,
  busiestDay,
};

const languageTotals = new Map();
for (const repository of featuredRepositories) {
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
const topLanguages = [...languageTotals.values()]
  .sort((a, b) => b.size - a.size)
  .slice(0, 5);
const languageSizeTotal = Math.max(
  1,
  topLanguages.reduce((sum, language) => sum + language.size, 0),
);

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const formatNumber = (value, maximumFractionDigits = 0) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
const formatDate = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
const formatMonthDay = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(value);
const formatShortDate = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
const truncate = (value, length = 30) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;

const statCards = [
  [
    "CONTRIBUTIONS",
    formatNumber(metrics.contributions),
    "rolling 12 months",
    `${formatNumber(metrics.privateContributions)} private aggregate`,
  ],
  [
    "ACTIVE DAYS",
    formatNumber(metrics.activeDays),
    `${formatNumber(metrics.averagePerWeek, 1)} contributions / week`,
    `${formatNumber(metrics.commits)} commit contributions`,
  ],
  [
    "LONGEST STREAK",
    `${formatNumber(metrics.longestStreak)} days`,
    metrics.busiestDay
      ? `best day · ${formatMonthDay(new Date(`${metrics.busiestDay.date}T00:00:00Z`))}`
      : "best day · no activity",
    metrics.busiestDay
      ? `${formatNumber(metrics.busiestDay.contributionCount)} contributions`
      : "0 contributions",
  ],
  [
    "REPOSITORIES",
    `${formatNumber(metrics.publicRepositories + metrics.privateRepositories)} repositories`,
    `${formatNumber(metrics.publicRepositories)} public · ${formatNumber(metrics.privateRepositories)} private`,
    `${formatNumber(metrics.publicProjects)} projects · ★${formatNumber(metrics.stars)} · forks ${formatNumber(metrics.forks)}`,
  ],
]
  .map(([label, value, detail, note], index) => {
    const x = 42 + index * 280;
    return `<g class="reveal card-${index + 1}" transform="translate(${x} 78)">
      <rect width="264" height="118" rx="17" fill="#fff" fill-opacity=".035" stroke="#dbe5ff" stroke-opacity=".11"/>
      <text x="18" y="28" class="metric-label">${escapeXml(label)}</text>
      <text x="18" y="64" class="metric-value">${escapeXml(value)}</text>
      <text x="18" y="87" class="metric-detail">${escapeXml(detail)}</text>
      <text x="246" y="103" text-anchor="end" class="metric-note">${escapeXml(note)}</text>
    </g>`;
  })
  .join("");

const heatColors = ["#1a2335", "#31456d", "#4f68a3", "#7189c6", "#9eb0e8"];
const heatLevel = (count) => {
  if (count <= 0) return 0;
  if (count <= 3) return 1;
  if (count <= 9) return 2;
  if (count <= 19) return 3;
  return 4;
};
const heatmap = weeks
  .map((week, weekIndex) =>
    (week.contributionDays || [])
      .map((day) => {
        const x = 62 + weekIndex * 10.9;
        const y = 286 + day.weekday * 10.9;
        const level = heatLevel(day.contributionCount);
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="8.2" height="8.2" rx="2" fill="${heatColors[level]}"${level === 4 ? ' class="heat-peak"' : ""}/>`;
      })
      .join(""),
  )
  .join("");

const monthLabels = [];
let previousMonth = null;
for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
  const firstDay = weeks[weekIndex]?.contributionDays?.[0];
  if (!firstDay) continue;
  const date = new Date(`${firstDay.date}T00:00:00Z`);
  const month = date.getUTCMonth();
  if (month === previousMonth) continue;
  previousMonth = month;
  monthLabels.push(
    `<text x="${(62 + weekIndex * 10.9).toFixed(1)}" y="270" class="month-label">${escapeXml(
      new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date),
    )}</text>`,
  );
}

const desktopLanguageStartY = 276;
const desktopLanguageGap = 36;
const desktopLanguageTrackWidth = 312;
const desktopLanguageNoteY = 456;
const languageBars = topLanguages
  .map((language, index) => {
    const y = desktopLanguageStartY + index * desktopLanguageGap;
    const percentage = (language.size / languageSizeTotal) * 100;
    const width = Math.max(
      12,
      (percentage / 100) * desktopLanguageTrackWidth,
    );
    return `<g transform="translate(798 ${y})">
      <circle cx="4" cy="-4" r="4" fill="${escapeXml(language.color)}"/>
      <text x="18" y="0" class="language-name">${escapeXml(language.name)}</text>
      <text x="330" y="0" text-anchor="end" class="language-share">${formatNumber(percentage, 1)}%</text>
      <rect x="18" y="12" width="${desktopLanguageTrackWidth}" height="5" rx="2.5" fill="#fff" fill-opacity=".055"/>
      <rect x="18" y="12" width="${width.toFixed(1)}" height="5" rx="2.5" fill="${escapeXml(language.color)}" fill-opacity=".88"/>
    </g>`;
  })
  .join("");

const featuredCards = featuredRepositories
  .map((repository, index) => {
    const x = 42 + index * 372;
    const language = repository.primaryLanguage?.name || "Mixed stack";
    const languageColor = repository.primaryLanguage?.color || "#94a3b8";
    const status = repository.isArchived ? "ARCHIVED CASE STUDY" : "PUBLIC SOURCE";
    return `<g class="reveal project-${index + 1}" transform="translate(${x} 493)">
      <rect width="356" height="120" rx="17" fill="#fff" fill-opacity=".028" stroke="#dbe5ff" stroke-opacity=".10"/>
      <circle cx="20" cy="25" r="5" fill="${escapeXml(languageColor)}"/>
      <text x="34" y="30" class="repo-name">${escapeXml(truncate(repository.name))}</text>
      <text x="336" y="29" text-anchor="end" class="repo-status">${escapeXml(status)}</text>
      <text x="20" y="63" class="repo-impact">★ ${formatNumber(repository.stargazerCount)}  ·  forks ${formatNumber(repository.forkCount)}  ·  ${escapeXml(language)}</text>
      <text x="20" y="91" class="repo-updated">Last public update ${escapeXml(formatShortDate(new Date(repository.pushedAt)))}</text>
      <path d="M20 105H336" stroke="#dbe5ff" stroke-opacity=".08"/>
    </g>`;
  })
  .join("");

const formatRelativeAge = (value) => {
  const days = Math.max(
    0,
    Math.floor((now - new Date(value)) / 86_400_000),
  );
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  if (months < 12) return `${months} months ago`;
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
};

const currentTarget = currentPublicRepository?.defaultBranchRef?.target;
const currentWorkMarkup = currentPublicRepository
  ? `<rect x="42" y="487" width="1116" height="82" rx="17" fill="#fff" fill-opacity=".028" stroke="#dbe5ff" stroke-opacity=".10"/>
  <text x="62" y="514" class="section-label">LATEST PUBLIC ACTIVITY</text>
  <circle cx="66" cy="541" r="5" fill="${escapeXml(currentPublicRepository.primaryLanguage?.color || "#94a3b8")}" class="activity-dot"/>
  <text x="82" y="546" class="current-name">${escapeXml(currentPublicRepository.name)}</text>
  <text x="350" y="546" class="current-detail">${formatNumber(currentTarget?.history?.totalCount || 0)} commits on ${escapeXml(currentPublicRepository.defaultBranchRef?.name || "default branch")}</text>
  <text x="690" y="546" class="current-detail">Last commit ${escapeXml(formatDate(new Date(currentTarget?.committedDate || currentPublicRepository.pushedAt)))} · ${escapeXml(formatRelativeAge(currentTarget?.committedDate || currentPublicRepository.pushedAt))}</text>
  <text x="1138" y="546" text-anchor="end" class="current-sha">${escapeXml((currentTarget?.oid || "").slice(0, 7))}</text>
  <path d="M62 558H1138" stroke="#dbe5ff" stroke-opacity=".08"/>`
  : "";

const memberSince = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(user.createdAt));

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(username)} GitHub engineering snapshot</title>
<desc id="desc">Automatically refreshed GitHub contribution rhythm, activity metrics, selected-work language mix, and featured public repositories.</desc>
<defs>
  <linearGradient id="background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b1220"/><stop offset=".58" stop-color="#111a2c"/><stop offset="1" stop-color="#0d1728"/></linearGradient>
  <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#89a5ff"/><stop offset=".55" stop-color="#b4c1f3"/><stop offset="1" stop-color="#79cfc3"/></linearGradient>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop stop-color="#8da5f2" stop-opacity=".12"/><stop offset="1" stop-color="#8da5f2" stop-opacity="0"/></radialGradient>
  <clipPath id="frame"><rect width="1200" height="760" rx="22"/></clipPath>
  <style>
    text{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.heading{fill:#f5f7ff;font-size:24px;font-weight:680}.updated{fill:#8393b2;font-size:11.5px}.metric-label,.section-label{fill:#9aa9c6;font-size:11px;font-weight:680;letter-spacing:1.15px}.section-meta{fill:#7f91b3;font-size:9.5px;font-weight:700;letter-spacing:.75px}.metric-value{fill:#f5f7ff;font-size:29px;font-weight:720}.metric-detail{fill:#98a8c5;font-size:11.5px}.metric-note{fill:#7687a6;font-size:10.5px}.month-label,.axis-label{fill:#7787a5;font-size:10px}.panel-note{fill:#8191ae;font-size:11px}.language-note{fill:#7688a8;font-size:10.5px}.language-name{fill:#dfe7f8;font-size:12px;font-weight:680}.language-share{fill:#96a6c4;font-size:11px}.repo-name{fill:#edf2ff;font-size:14.5px;font-weight:680}.repo-status{fill:#8797b5;font-size:9.5px;font-weight:680;letter-spacing:.72px}.repo-impact{fill:#aab7cf;font-size:12px}.repo-updated{fill:#8090ad;font-size:11px}.current-name{fill:#f1f5ff;font-size:16px;font-weight:720}.current-detail{fill:#a0aec8;font-size:12px}.current-sha{fill:#8191ae;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}.footer{fill:#7484a2;font-size:11px}.reveal{opacity:1;animation:reveal .65s ease both}.card-1{animation-delay:40ms}.card-2{animation-delay:100ms}.card-3{animation-delay:160ms}.card-4{animation-delay:220ms}.project-1{animation-delay:260ms}.project-2{animation-delay:320ms}.project-3{animation-delay:380ms}.accent-line{animation:breathe 4.8s ease-in-out infinite}.heat-peak{animation:peak 3.2s ease-in-out infinite}.activity-dot{animation:activityPulse 2.8s ease-in-out infinite}@keyframes reveal{from{opacity:.84}to{opacity:1}}@keyframes breathe{0%,100%{opacity:.42}50%{opacity:.88}}@keyframes peak{0%,100%{opacity:.82}50%{opacity:1}}@keyframes activityPulse{0%,100%{opacity:.62}50%{opacity:1}}@media(prefers-reduced-motion:reduce){.reveal,.accent-line,.heat-peak,.activity-dot{animation:none!important;opacity:1}}
  </style>
</defs>
<g clip-path="url(#frame)">
  <rect width="1200" height="760" fill="url(#background)"/>
  <circle cx="1120" cy="25" r="210" fill="url(#glow)"/>
  <path d="M0 1H1200" stroke="url(#accent)" stroke-opacity=".72" class="accent-line"/>
  <text x="42" y="46" class="heading">Engineering snapshot</text>
  <text x="1158" y="34" text-anchor="end" class="updated">Updated ${escapeXml(formatDate(now))}</text>
  <text x="1158" y="50" text-anchor="end" class="updated">GitHub GraphQL · automated daily</text>

  ${statCards}

  <rect x="42" y="214" width="716" height="250" rx="17" fill="#fff" fill-opacity=".024" stroke="#dbe5ff" stroke-opacity=".09"/>
  <rect x="774" y="214" width="384" height="250" rx="17" fill="#fff" fill-opacity=".024" stroke="#dbe5ff" stroke-opacity=".09"/>
  <text x="62" y="242" class="section-label">CONTRIBUTION RHYTHM · LAST 12 MONTHS</text>
  <text x="798" y="242" class="section-label">SELECTED WORK · LANGUAGE MIX</text>
  <rect x="1050" y="226" width="88" height="22" rx="11" fill="#8da5f2" fill-opacity=".07" stroke="#9eb0e8" stroke-opacity=".13"/>
  <text x="1094" y="241" text-anchor="middle" class="section-meta">TOP ${topLanguages.length} · ${featuredRepositories.length} REPOS</text>

  ${monthLabels.join("")}
  <text x="49" y="299" class="axis-label">M</text>
  <text x="49" y="321" class="axis-label">W</text>
  <text x="49" y="343" class="axis-label">F</text>
  ${heatmap}

  <g transform="translate(62 391)">
    <text x="0" y="0" class="panel-note">${formatNumber(metrics.publicContributions)} public</text>
    <circle cx="81" cy="-4" r="2.5" fill="#7189c6"/>
    <text x="92" y="0" class="panel-note">${formatNumber(metrics.privateContributions)} private aggregate</text>
    <circle cx="229" cy="-4" r="2.5" fill="#79cfc3"/>
    <text x="240" y="0" class="panel-note">${formatNumber(metrics.pullRequests)} PRs</text>
    <circle cx="298" cy="-4" r="2.5" fill="#b4c1f3"/>
    <text x="309" y="0" class="panel-note">${formatNumber(metrics.reviews)} reviews</text>
    <circle cx="391" cy="-4" r="2.5" fill="#89a5ff"/>
    <text x="402" y="0" class="panel-note">${formatNumber(metrics.issues)} issues</text>
  </g>
  <text x="62" y="438" class="panel-note">Intensity is calculated from GitHub's daily contribution counts. Private repository details are never requested or rendered.</text>

  ${languageBars}
  <text x="798" y="${desktopLanguageNoteY}" class="language-note">Public language totals across ${featuredRepositories.length} featured repositories.</text>

  ${currentWorkMarkup}

  <g transform="translate(0 99)">
    ${featuredCards}
  </g>

  <text x="42" y="741" class="footer">GitHub member since ${escapeXml(memberSince)} · ${formatNumber(metrics.followers)} followers · generated locally with gh api</text>
  <text x="1158" y="741" text-anchor="end" class="footer">profile.hzi.io.vn</text>
</g>
</svg>\n`;

const mobileStatCards = [
  [
    "CONTRIBUTIONS",
    formatNumber(metrics.contributions),
    `${formatNumber(metrics.privateContributions)} private aggregate`,
  ],
  [
    "ACTIVE DAYS",
    formatNumber(metrics.activeDays),
    `${formatNumber(metrics.commits)} commit contributions`,
  ],
  [
    "LONGEST STREAK",
    `${formatNumber(metrics.longestStreak)} days`,
    metrics.busiestDay
      ? `Best ${formatMonthDay(new Date(`${metrics.busiestDay.date}T00:00:00Z`))} · ${formatNumber(metrics.busiestDay.contributionCount)} contributions`
      : "No activity recorded",
  ],
  [
    "REPOSITORIES",
    `${formatNumber(metrics.publicRepositories + metrics.privateRepositories)} total`,
    `${formatNumber(metrics.publicRepositories)} public · ${formatNumber(metrics.privateRepositories)} private`,
  ],
]
  .map(([label, value, detail], index) => {
    const x = 18 + (index % 2) * 196;
    const y = 66 + Math.floor(index / 2) * 112;
    return `<g transform="translate(${x} ${y})">
      <rect width="188" height="104" rx="15" fill="#fff" fill-opacity=".035" stroke="#dbe5ff" stroke-opacity=".11"/>
      <text x="14" y="24" class="mobile-label">${escapeXml(label)}</text>
      <text x="14" y="57" class="mobile-value">${escapeXml(value)}</text>
      <text x="14" y="82" class="mobile-detail">${escapeXml(detail)}</text>
    </g>`;
  })
  .join("");

const mobileHeatmap = weeks
  .map((week, weekIndex) =>
    (week.contributionDays || [])
      .map((day) => {
        const x = 40 + weekIndex * 6.45;
        const y = 365 + day.weekday * 6.45;
        const level = heatLevel(day.contributionCount);
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="5.2" height="5.2" rx="1.3" fill="${heatColors[level]}"/>`;
      })
      .join(""),
  )
  .join("");

const mobileMonthLabels = [];
let mobilePreviousMonth = null;
for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
  const firstDay = weeks[weekIndex]?.contributionDays?.[0];
  if (!firstDay) continue;
  const date = new Date(`${firstDay.date}T00:00:00Z`);
  const month = date.getUTCMonth();
  if (month === mobilePreviousMonth) continue;
  mobilePreviousMonth = month;
  mobileMonthLabels.push(
    `<text x="${(40 + weekIndex * 6.45).toFixed(1)}" y="350" class="mobile-month">${escapeXml(
      new Intl.DateTimeFormat("en-US", {
        month: "short",
        timeZone: "UTC",
      }).format(date),
    )}</text>`,
  );
}

const mobileLanguageStartY = 526;
const mobileLanguageGap = 35;
const mobileLanguageTrackWidth = 344;
const mobileLanguageBars = topLanguages
  .map((language, index) => {
    const y = mobileLanguageStartY + index * mobileLanguageGap;
    const percentage = (language.size / languageSizeTotal) * 100;
    const width = Math.max(
      10,
      (percentage / 100) * mobileLanguageTrackWidth,
    );
    return `<g>
      <circle cx="38" cy="${y - 4}" r="3.5" fill="${escapeXml(language.color)}"/>
      <text x="49" y="${y}" class="mobile-language">${escapeXml(language.name)}</text>
      <text x="382" y="${y}" text-anchor="end" class="mobile-share">${formatNumber(percentage, 1)}%</text>
      <rect x="38" y="${y + 11}" width="${mobileLanguageTrackWidth}" height="5" rx="2.5" fill="#fff" fill-opacity=".055"/>
      <rect x="38" y="${y + 11}" width="${width.toFixed(1)}" height="5" rx="2.5" fill="${escapeXml(language.color)}" fill-opacity=".9"/>
    </g>`;
  })
  .join("");

const mobileCurrentWork = currentPublicRepository
  ? `<rect x="18" y="735" width="384" height="82" rx="15" fill="#fff" fill-opacity=".028" stroke="#dbe5ff" stroke-opacity=".10"/>
  <text x="34" y="760" class="mobile-section">LATEST PUBLIC ACTIVITY</text>
  <circle cx="38" cy="786" r="4" fill="${escapeXml(currentPublicRepository.primaryLanguage?.color || "#94a3b8")}"/>
  <text x="50" y="790" class="mobile-current">${escapeXml(truncate(currentPublicRepository.name, 24))}</text>
  <text x="386" y="790" text-anchor="end" class="mobile-detail">${formatNumber(currentTarget?.history?.totalCount || 0)} commits · ${escapeXml(formatRelativeAge(currentTarget?.committedDate || currentPublicRepository.pushedAt))}</text>
  <text x="34" y="806" class="mobile-meta">Last commit ${escapeXml(formatDate(new Date(currentTarget?.committedDate || currentPublicRepository.pushedAt)))} · ${escapeXml((currentTarget?.oid || "").slice(0, 7))}</text>`
  : "";

const mobileFeaturedCards = featuredRepositories
  .map((repository, index) => {
    const y = 866 + index * 88;
    const language = repository.primaryLanguage?.name || "Mixed stack";
    const languageColor = repository.primaryLanguage?.color || "#94a3b8";
    const status = repository.isArchived ? "ARCHIVED" : "PUBLIC SOURCE";
    return `<g transform="translate(18 ${y})">
      <rect width="384" height="80" rx="15" fill="#fff" fill-opacity=".028" stroke="#dbe5ff" stroke-opacity=".10"/>
      <circle cx="18" cy="23" r="4" fill="${escapeXml(languageColor)}"/>
      <text x="31" y="28" class="mobile-repo">${escapeXml(truncate(repository.name, 26))}</text>
      <text x="366" y="27" text-anchor="end" class="mobile-status">${escapeXml(status)}</text>
      <text x="18" y="52" class="mobile-impact">★ ${formatNumber(repository.stargazerCount)} · forks ${formatNumber(repository.forkCount)} · ${escapeXml(language)}</text>
      <text x="18" y="68" class="mobile-meta">Updated ${escapeXml(formatShortDate(new Date(repository.pushedAt)))}</text>
    </g>`;
  })
  .join("");

const mobileSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="1160" viewBox="0 0 420 1160" role="img" aria-labelledby="title desc">
<title id="title">${escapeXml(username)} mobile GitHub engineering snapshot</title>
<desc id="desc">A mobile-optimized view of GitHub activity metrics, contribution rhythm, language mix, latest public activity, and featured repositories.</desc>
<defs>
  <linearGradient id="mobile-background" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#0b1220"/><stop offset=".58" stop-color="#111a2c"/><stop offset="1" stop-color="#0d1728"/></linearGradient>
  <linearGradient id="mobile-accent" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#89a5ff"/><stop offset=".55" stop-color="#b4c1f3"/><stop offset="1" stop-color="#79cfc3"/></linearGradient>
  <radialGradient id="mobile-glow" cx="50%" cy="50%" r="50%"><stop stop-color="#8da5f2" stop-opacity=".13"/><stop offset="1" stop-color="#8da5f2" stop-opacity="0"/></radialGradient>
  <clipPath id="mobile-frame"><rect width="420" height="1160" rx="20"/></clipPath>
  <style>
    text{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.mobile-heading{fill:#f5f7ff;font-size:19px;font-weight:700}.mobile-updated{fill:#8393b2;font-size:9.5px}.mobile-label,.mobile-section{fill:#9aa9c6;font-size:10px;font-weight:680;letter-spacing:.9px}.mobile-value{fill:#f5f7ff;font-size:23px;font-weight:720}.mobile-detail{fill:#9aa9c6;font-size:10.5px}.mobile-month{fill:#7787a5;font-size:9px}.mobile-axis{fill:#6f809f;font-size:8.5px}.mobile-note{fill:#8191ae;font-size:9.5px}.mobile-language-note{fill:#7486a5;font-size:9.2px}.mobile-language{fill:#dfe7f8;font-size:11.5px;font-weight:680}.mobile-share{fill:#96a6c4;font-size:10px}.mobile-current{fill:#f1f5ff;font-size:13px;font-weight:700}.mobile-repo{fill:#edf2ff;font-size:13px;font-weight:680}.mobile-status{fill:#8797b5;font-size:8.5px;font-weight:680;letter-spacing:.55px}.mobile-impact{fill:#aab7cf;font-size:10.5px}.mobile-meta{fill:#8090ad;font-size:9.5px}.mobile-footer{fill:#7484a2;font-size:9.5px}
  </style>
</defs>
<g clip-path="url(#mobile-frame)">
  <rect width="420" height="1160" fill="url(#mobile-background)"/>
  <circle cx="390" cy="15" r="130" fill="url(#mobile-glow)"/>
  <path d="M0 1H420" stroke="url(#mobile-accent)" stroke-opacity=".72"/>
  <text x="18" y="34" class="mobile-heading">Engineering snapshot</text>
  <text x="402" y="25" text-anchor="end" class="mobile-updated">Updated ${escapeXml(formatDate(now))}</text>
  <text x="402" y="40" text-anchor="end" class="mobile-updated">Automated daily</text>

  ${mobileStatCards}

  <rect x="18" y="300" width="384" height="155" rx="15" fill="#fff" fill-opacity=".024" stroke="#dbe5ff" stroke-opacity=".09"/>
  <text x="34" y="326" class="mobile-section">CONTRIBUTION RHYTHM · 12 MONTHS</text>
  ${mobileMonthLabels.join("")}
  <text x="28" y="376" text-anchor="end" class="mobile-axis">M</text>
  <text x="28" y="389" text-anchor="end" class="mobile-axis">W</text>
  <text x="28" y="402" text-anchor="end" class="mobile-axis">F</text>
  ${mobileHeatmap}
  <text x="34" y="432" class="mobile-note">${formatNumber(metrics.publicContributions)} public · ${formatNumber(metrics.privateContributions)} private aggregate</text>
  <text x="34" y="447" class="mobile-note">${formatNumber(metrics.pullRequests)} PRs · ${formatNumber(metrics.reviews)} reviews · ${formatNumber(metrics.issues)} issues</text>

  <rect x="18" y="470" width="384" height="248" rx="15" fill="#fff" fill-opacity=".024" stroke="#dbe5ff" stroke-opacity=".09"/>
  <text x="34" y="496" class="mobile-section">SELECTED WORK · LANGUAGE MIX</text>
  ${mobileLanguageBars}
  <text x="38" y="705" class="mobile-language-note">Public language totals across ${featuredRepositories.length} featured repositories.</text>

  ${mobileCurrentWork}

  <text x="18" y="846" class="mobile-section">FEATURED PUBLIC WORK</text>
  ${mobileFeaturedCards}

  <text x="18" y="1143" class="mobile-footer">Member since ${escapeXml(memberSince)} · ${formatNumber(metrics.followers)} followers</text>
  <text x="402" y="1143" text-anchor="end" class="mobile-footer">profile.hzi.io.vn</text>
</g>
</svg>\n`;

await Promise.all([
  mkdir(dirname(outputPath), { recursive: true }),
  mkdir(dirname(mobileOutputPath), { recursive: true }),
]);
await Promise.all([
  writeFile(outputPath, svg, "utf8"),
  writeFile(mobileOutputPath, mobileSvg, "utf8"),
]);
console.log(`Updated ${outputPath} and ${mobileOutputPath} for ${username}.`);
