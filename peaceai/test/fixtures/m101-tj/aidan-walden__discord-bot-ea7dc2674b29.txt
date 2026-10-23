export const RIOT_PLATFORMS = [
	"br1",
	"eun1",
	"euw1",
	"jp1",
	"kr",
	"la1",
	"la2",
	"na1",
	"oc1",
	"tr1",
	"ru",
	"ph2",
	"sg2",
	"th2",
	"tw2",
	"vn2",
] as const;

export type RiotPlatform = (typeof RIOT_PLATFORMS)[number];

export const RIOT_REGIONS = ["americas", "europe", "asia", "sea"] as const;
export type RiotRegion = (typeof RIOT_REGIONS)[number];

export const PLATFORM_TO_REGION: Record<RiotPlatform, RiotRegion> = {
	br1: "americas",
	la1: "americas",
	la2: "americas",
	na1: "americas",
	oc1: "sea",
	ph2: "sea",
	sg2: "sea",
	th2: "sea",
	tw2: "sea",
	vn2: "sea",
	eun1: "europe",
	euw1: "europe",
	tr1: "europe",
	ru: "europe",
	jp1: "asia",
	kr: "asia",
};

export const ACCOUNT_CACHE_TTL_MS = 10 * 60_000;
export const MATCH_CACHE_TTL_MS = 60 * 60_000;
export const SUMMONER_CACHE_TTL_MS = 10 * 60_000;
export const LEAGUE_CACHE_TTL_MS = 60_000;
export const LOL_VIEW_CACHE_TTL_MS = 5 * 60_000;
export const DEFAULT_429_RETRY_MS = 1_000;
/** Personal-key app limits applied before response headers arrive. */
export const DEFAULT_APP_RATE_LIMITS = [
	{ limit: 20, windowMs: 1_000 },
	{ limit: 100, windowMs: 120_000 },
] as const;
export const RECENT_MATCH_COUNT = 5;
export const SOLO_QUEUE = "RANKED_SOLO_5x5";
export const FLEX_QUEUE = "RANKED_FLEX_SR";
export const DEFAULT_POLL_INTERVAL_SECONDS = 60;
export const RANK_HISTORY_LIMIT = 5;
export const MATCH_IDS_PAGE_SIZE = 100;

/** Friendly region labels (NA, EUW, …) → platform routing values. */
export const FRIENDLY_REGION_TO_PLATFORM: Record<string, RiotPlatform> = {
	NA: "na1",
	EUW: "euw1",
	EUNE: "eun1",
	KR: "kr",
	BR: "br1",
	LAN: "la1",
	LAS: "la2",
	OCE: "oc1",
	JP: "jp1",
	TR: "tr1",
	RU: "ru",
	PH: "ph2",
	SG: "sg2",
	TH: "th2",
	TW: "tw2",
	VN: "vn2",
};

/** Platform routing values → friendly region labels; inverse of {@link FRIENDLY_REGION_TO_PLATFORM}. */
export const PLATFORM_TO_FRIENDLY_REGION = Object.fromEntries(
	Object.entries(FRIENDLY_REGION_TO_PLATFORM).map(([region, platform]) => [
		platform,
		region,
	]),
) as Record<RiotPlatform, string>;

const QUEUE_NAMES: Record<number, string> = {
	400: "Normal Draft",
	420: "Solo/Duo",
	430: "Normal Blind",
	440: "Flex",
	450: "ARAM",
	490: "Quickplay",
	700: "Clash",
	900: "URF",
	1020: "One for All",
	1300: "Nexus Blitz",
	1700: "Arena",
	1900: "URF",
};

export function platformToRegion(platform: RiotPlatform): RiotRegion {
	return PLATFORM_TO_REGION[platform];
}

/** Parse `GameName#TAG`. Returns null if malformed. */
export function parseRiotId(
	raw: string,
): { gameName: string; tagLine: string } | null {
	const hash = raw.indexOf("#");
	if (hash <= 0 || hash === raw.length - 1) {
		return null;
	}
	const gameName = raw.slice(0, hash).trim();
	const tagLine = raw.slice(hash + 1).trim();
	if (!gameName || !tagLine) {
		return null;
	}
	return { gameName, tagLine };
}

export function parseFriendlyRegion(input: string): RiotPlatform | null {
	const key = input.trim().toUpperCase();
	return FRIENDLY_REGION_TO_PLATFORM[key] ?? null;
}

export function queueName(queueId: number): string {
	return QUEUE_NAMES[queueId] ?? `Queue ${queueId}`;
}

export function profileIconUrl(profileIconId: number): string {
	return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${profileIconId}.jpg`;
}
