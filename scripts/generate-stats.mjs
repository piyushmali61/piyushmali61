// Generates assets/stats.svg and assets/languages.svg from the GitHub GraphQL API.
// Runs daily in .github/workflows/profile-stats.yml. No dependencies.
//
//   GITHUB_TOKEN=... node scripts/generate-stats.mjs
//   MOCK=sample.json node scripts/generate-stats.mjs        (offline preview)
//   PLACEHOLDER=1 node scripts/generate-stats.mjs           (cards before the first run)
//
// Numbers come straight from the API: public, non-fork repositories you own,
// your followers and the contribution calendar GitHub shows on your profile.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGIN = process.env.PROFILE_LOGIN || "piyushmali61";
const C = {
  bg: "#0B0D10", surface: "#14171C", surface2: "#1C2128", accent: "#FF7A1A", accent2: "#FFB347",
  text: "#F5F5F5", text2: "#A0A7B4", border: "#292E36",
};
const SANS = "'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";

const QUERY = `query($login: String!) {
  user(login: $login) {
    followers { totalCount }
    repositories(ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, first: 100) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 12, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
      }
    }
    contributionsCollection {
      contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
    }
  }
}`;

async function fetchData() {
  if (process.env.MOCK) return JSON.parse(readFileSync(process.env.MOCK, "utf8"));
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "profile-stats" },
    body: JSON.stringify({ query: QUERY, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API error: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data.user;
}

function streaks(days) {
  // days: [{date, contributionCount}] oldest -> newest (includes today)
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--; // today may not have activity yet
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;
  return { current, longest };
}

function summarize(user) {
  const repos = user.repositories.nodes;
  const stars = repos.reduce((s, r) => s + r.stargazerCount, 0);
  const langs = new Map();
  for (const r of repos) for (const e of r.languages.edges) {
    const cur = langs.get(e.node.name) || { size: 0, color: e.node.color || C.text2 };
    cur.size += e.size; langs.set(e.node.name, cur);
  }
  const total = [...langs.values()].reduce((s, l) => s + l.size, 0) || 1;
  const top = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6)
    .map(([name, l]) => ({ name, color: l.color, pct: (l.size / total) * 100 }));
  const days = user.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  return {
    repos: user.repositories.totalCount,
    stars,
    followers: user.followers.totalCount,
    contributions: user.contributionsCollection.contributionCalendar.totalContributions,
    ...streaks(days),
    top,
  };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const today = () => new Date().toISOString().slice(0, 10);

function card(title, body, h, note) {
  const W = 600;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <style>.f{opacity:0;animation:f .7s ease-out forwards}@keyframes f{to{opacity:1}}@media (prefers-reduced-motion: reduce){.f{animation:none;opacity:1}}</style>
  <rect x=".5" y=".5" width="${W - 1}" height="${h - 1}" rx="14" fill="${C.surface}" stroke="${C.border}"/>
  <rect x="28" y="26" width="4" height="20" rx="2" fill="${C.accent}"/>
  <text x="42" y="42" font-family="${SANS}" font-size="17" font-weight="700" fill="${C.text}">${esc(title)}</text>
  <text x="${W - 28}" y="42" font-family="${SANS}" font-size="11.5" fill="${C.text2}" text-anchor="end">${esc(note)}</text>
  ${body}
</svg>
`;
}

function statsCard(s) {
  const items = [
    ["Public repositories", s.repos],
    ["Stars earned", s.stars],
    ["Followers", s.followers],
    ["Contributions (12 months)", s.contributions],
    ["Current streak", s.current === "…" ? "…" : `${s.current} day${s.current === 1 ? "" : "s"}`],
    ["Longest streak (12 months)", s.longest === "…" ? "…" : `${s.longest} day${s.longest === 1 ? "" : "s"}`],
  ];
  const cells = items.map(([label, value], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 28 + col * 186, y = 70 + row * 74;
    return `<g class="f" style="animation-delay:${(i * 0.08).toFixed(2)}s">
    <rect x="${x}" y="${y}" width="172" height="62" rx="10" fill="${C.surface2}" stroke="${C.border}"/>
    <text x="${x + 14}" y="${y + 33}" font-family="${SANS}" font-size="22" font-weight="750" fill="${i === 4 ? C.accent : C.text}">${esc(value)}</text>
    <text x="${x + 14}" y="${y + 51}" font-family="${SANS}" font-size="11.5" fill="${C.text2}">${esc(label)}</text>
  </g>`;
  }).join("\n  ");
  return card("GitHub Stats", cells, 236, s.updated);
}

function langCard(s) {
  const barX = 28, barW = 544, barY = 70;
  let x = barX;
  const segs = s.top.length
    ? s.top.map((l) => { const w = Math.max(2, (l.pct / 100) * barW); const r = `<rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="12" fill="${l.color}"/>`; x += w; return r; }).join("")
    : `<rect x="${barX}" y="${barY}" width="${barW}" height="12" fill="${C.surface2}"/>`;
  const legend = s.top.map((l, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const lx = 28 + col * 280, ly = 116 + row * 34;
    return `<g class="f" style="animation-delay:${(i * 0.08).toFixed(2)}s"><circle cx="${lx + 6}" cy="${ly - 4}" r="6" fill="${l.color}"/>
    <text x="${lx + 20}" y="${ly}" font-family="${SANS}" font-size="14" font-weight="600" fill="${C.text}">${esc(l.name)}</text>
    <text x="${lx + 250}" y="${ly}" font-family="${SANS}" font-size="13" fill="${C.text2}" text-anchor="end">${l.pct.toFixed(1)}%</text></g>`;
  }).join("\n  ");
  const empty = s.top.length ? "" : `<text x="300" y="150" font-family="${SANS}" font-size="13" fill="${C.text2}" text-anchor="middle">Calculated from public repositories on the first workflow run</text>`;
  const body = `<clipPath id="bar"><rect x="${barX}" y="${barY}" width="${barW}" height="12" rx="6"/></clipPath>
  <g clip-path="url(#bar)">${segs}</g>
  ${legend}${empty}`;
  return card("Most Used Languages", body, 236, "by code size · public repos");
}

async function main() {
  let s;
  if (process.env.PLACEHOLDER) {
    s = { repos: "…", stars: "…", followers: "…", contributions: "…", current: "…", longest: "…", top: [], updated: "updates daily" };
  } else {
    s = summarize(await fetchData());
    s.updated = `updated ${today()}`;
  }
  mkdirSync(join(ROOT, "assets"), { recursive: true });
  writeFileSync(join(ROOT, "assets/stats.svg"), statsCard(s));
  writeFileSync(join(ROOT, "assets/languages.svg"), langCard(s));
  console.log("stats:", JSON.stringify({ ...s, top: s.top.map((l) => `${l.name} ${l.pct.toFixed(1)}%`) }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
