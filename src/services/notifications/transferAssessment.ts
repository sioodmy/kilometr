import type { CurrentLocation } from '../currentLocation';
import type { LegStop } from '../../types/models';
import { bearingDegrees, distanceMeters, projectPointToPolyline } from '../../gtfs/geo';

export class TransferRideEstimator {
  private previous: { fix: CurrentLocation; position: number } | null = null;
  private established = false;
  private position = -1;
  private delays: number[] = [];

  observe(stops: LegStop[], board: number, baseMs: number, fix: CurrentLocation, now: number) {
    if (
      fix.accuracy == null ||
      fix.accuracy < 0 ||
      fix.accuracy > 45 ||
      now - fix.timestamp < 0 ||
      now - fix.timestamp > 20_000 ||
      !Number.isFinite(fix.lat) ||
      !Number.isFinite(fix.lon)
    )
      return null;
    let best: { position: number; distance: number; expected: number } | null = null;
    for (let i = board; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (
        i + 1 < this.position - 0.15 ||
        a.lat == null ||
        a.lon == null ||
        b.lat == null ||
        b.lon == null ||
        a.departSec == null ||
        b.arriveSec == null
      )
        continue;
      const length = distanceMeters(a.lat, a.lon, b.lat, b.lon);
      if (length < 10) continue;
      const projection = projectPointToPolyline(fix.lat, fix.lon, [
        { lat: a.lat, lon: a.lon },
        { lat: b.lat, lon: b.lon },
      ]);
      if (projection.distanceMeters > Math.max(65, fix.accuracy * 2)) continue;
      if (
        !this.established &&
        fix.heading != null &&
        (fix.speed ?? 0) >= 2.2 &&
        Math.abs(((fix.heading - bearingDegrees(a.lat, a.lon, b.lat, b.lon) + 540) % 360) - 180) >
          65
      )
        continue;
      const fraction = projection.fractionAlongShape;
      const expected = baseMs + (a.departSec + (b.arriveSec - a.departSec) * fraction) * 1000;
      if (now < expected - 180_000 || now > expected + 3_600_000) continue;
      if (!best || projection.distanceMeters < best.distance) {
        best = { position: i + fraction, distance: projection.distanceMeters, expected };
      }
    }
    if (!best || best.position < this.position - 0.15) return null;
    const previous = this.previous;
    if (!this.established) {
      if (!previous) {
        this.previous = { fix, position: best.position };
        return null;
      }
      const elapsed = fix.timestamp - previous.fix.timestamp;
      if (elapsed < 8000) return null;
      const displacement = distanceMeters(previous.fix.lat, previous.fix.lon, fix.lat, fix.lon);
      if (
        elapsed > 60_000 ||
        displacement < 25 ||
        displacement / (elapsed / 1000) < 2 ||
        best.position <= previous.position
      ) {
        this.previous = { fix, position: best.position };
        return null;
      }
      this.established = true;
    } else if (
      previous &&
      fix.timestamp > previous.fix.timestamp &&
      distanceMeters(previous.fix.lat, previous.fix.lon, fix.lat, fix.lon) /
        ((fix.timestamp - previous.fix.timestamp) / 1000) >
        50
    )
      return null;
    this.previous = { fix, position: best.position };
    this.position = Math.max(this.position, best.position);
    if (!previous || fix.timestamp !== previous.fix.timestamp) {
      this.delays.push(Math.round((fix.timestamp - best.expected) / 1000));
      this.delays = this.delays.slice(-3);
    }
    return {
      position: this.position,
      delaySec: [...this.delays].sort((a, b) => a - b)[Math.floor(this.delays.length / 2)],
    };
  }
}

export class TransferRiskDecision {
  private missedSince: number | null = null;
  private lastAt = 0;
  private status: 'safe' | 'risk' | 'missed' = 'safe';

  assess(slackSec: number, bufferSec: number, now: number) {
    if (slackSec >= bufferSec + 60) {
      this.missedSince = null;
      this.status = 'safe';
    } else if (slackSec < -30) {
      if (this.missedSince == null || now - this.lastAt > 30_000) this.missedSince = now;
      this.status = now - this.missedSince >= 20_000 ? 'missed' : 'risk';
    } else {
      this.missedSince = null;
      if (slackSec < bufferSec) this.status = 'risk';
    }
    this.lastAt = now;
    return this.status;
  }
}
