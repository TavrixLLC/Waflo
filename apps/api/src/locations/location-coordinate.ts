import { HttpStatus } from "@nestjs/common";
import { isCanonicalTimeZone } from "@waflo/contracts";
import timezoneAt from "tz-lookup";
import { AppError } from "../common/app-error.js";

export interface ValidatedBusinessCoordinate {
  latitude: number;
  longitude: number;
  timezone: string;
}

export function validateBusinessCoordinate(
  latitude: number,
  longitude: number,
): ValidatedBusinessCoordinate {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new AppError(
      "INVALID_LOCATION_COORDINATE",
      "Choose a valid business location on the map.",
      HttpStatus.BAD_REQUEST,
    );
  }

  let timezone: string;
  try {
    timezone = timezoneAt(latitude, longitude);
  } catch {
    throw new AppError(
      "LOCATION_TIMEZONE_UNAVAILABLE",
      "We couldn't determine the timezone for this location. Move the pin and try again.",
      HttpStatus.BAD_REQUEST,
    );
  }
  if (!isCanonicalTimeZone(timezone)) {
    throw new AppError(
      "LOCATION_TIMEZONE_UNAVAILABLE",
      "We couldn't determine the timezone for this location. Move the pin and try again.",
      HttpStatus.BAD_REQUEST,
    );
  }
  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    timezone,
  };
}
