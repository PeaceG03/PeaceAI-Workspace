// Built-in profiles: a typed object in a second file, a realistic target for multi-step plans (M6).
import type { Profile } from "./config";

export const GUEST: Profile = {
  id: "guest",
  displayName: "Guest",
};

export function isGuest(profile: Profile): boolean {
  return profile.id === GUEST.id;
}
