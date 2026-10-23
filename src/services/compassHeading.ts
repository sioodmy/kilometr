export interface CompassSample {
  trueHeading: number;
  magHeading: number;
  accuracy: number;
}

export function compassDegrees(sample: CompassSample): number | null {
  if (!Number.isFinite(sample.accuracy) || sample.accuracy <= 0) return null;
  const value =
    Number.isFinite(sample.trueHeading) && sample.trueHeading >= 0
      ? sample.trueHeading
      : sample.magHeading;
  return Number.isFinite(value) && value >= 0 ? value % 360 : null;
}
