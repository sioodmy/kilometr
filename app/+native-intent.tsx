import { sharedTripPath } from '../src/sharing/links';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return sharedTripPath(path) ?? path;
}
