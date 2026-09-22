export interface GtfsStop {
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  normalized_name: string;
}

export interface GtfsRoute {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_type: number; // 0 = Tram, 3 = Bus
}

export interface GtfsTrip {
  route_id: string;
  service_id: string;
  trip_id: string;
  trip_headsign: string;
  direction_id: number;
  shape_id: string;
  brigade_id?: string;
}

export interface GtfsStopTime {
  trip_id: string;
  arrival_time: string; // "14:02:00"
  departure_time: string; // "14:02:00"
  arrival_sec: number; // seconds from midnight
  departure_sec: number; // seconds from midnight
  stop_id: string;
  stop_sequence: number;
}

export interface GtfsCalendar {
  service_id: string;
  monday: number;
  tuesday: number;
  wednesday: number;
  thursday: number;
  friday: number;
  saturday: number;
  sunday: number;
  start_date: string;
  end_date: string;
}

export interface GtfsCalendarDate {
  service_id: string;
  date: string; // YYYYMMDD
  exception_type: number; // 1 = added, 2 = removed
}

export interface GtfsShapePoint {
  shape_id: string;
  lat: number;
  lon: number;
  sequence: number;
}

export interface GtfsCalendarDate {
  service_id: string;
  date: string; // YYYYMMDD
  exception_type: number; // 1 = added, 2 = removed
}

export interface Footpath {
  from_stop_id: string;
  to_stop_id: string;
  distance_m: number;
  duration_sec: number;
}
