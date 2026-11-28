import { profileSteamIdSchema } from '@who-ruined/contracts';

export function steamProfileUrl(steamId: string | null): string | null {
  const id = profileSteamIdSchema.safeParse(steamId);
  return id.success ? `https://steamcommunity.com/profiles/${id.data}` : null;
}

export function playerProfilePath(steamId: string | null): string | null {
  const id = profileSteamIdSchema.safeParse(steamId);
  return id.success ? `/players/${id.data}` : null;
}
