// Orbit helpers for the landing scene. Plain arrays, no three.js.
// Scene frame: unit = one Earth radius, +Y = celestial north. An ECI vector (x, y, z)
// maps to the scene as (x, z, -y), which keeps three.js's Y-up convention and puts
// longitude 0 at +X on a default SphereGeometry when the Earth is rotated by GMST.

import { solveKepler } from '../astro.js';

const DEG = Math.PI / 180;
export const RE_KM = 6371;
export const MU_EARTH = 398600.4418;   // km^3/s^2
export const RM_KM = 3389.5;
export const MU_MARS = 42828.37;

export const toScene = (x, y, z, out = [0, 0, 0]) => { out[0] = x; out[1] = z; out[2] = -y; return out; };

/** Body-fixed unit vector for a latitude/longitude, in scene axes (before body rotation). */
export function latLon(latDeg, lonDeg) {
  const la = latDeg * DEG, lo = lonDeg * DEG;
  return [Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)];
}

/** Rotate a body-fixed scene vector about +Y by angle (the body's rotation). */
export function spinY(v, angle, out = [0, 0, 0]) {
  const c = Math.cos(angle), s = Math.sin(angle);
  out[0] = v[0] * c + v[2] * s;
  out[1] = v[1];
  out[2] = -v[0] * s + v[2] * c;
  return out;
}

/** Sun-synchronous inclination [deg] for a circular orbit at altKm (J2 nodal precession). */
export function ssoInclination(altKm) {
  const a = 6378.137 + altKm, J2 = 1.08263e-3;
  const n = Math.sqrt(MU_EARTH / a ** 3);
  const rate = 2 * Math.PI / (365.2422 * 86400);
  return Math.acos(-rate / (1.5 * n * J2 * (6378.137 / a) ** 2)) / DEG;
}

/**
 * Circular orbits as flat arrays, positions filled by `place(sats, tSeconds, out)`.
 * Each satellite: [radius (Earth radii), inclination, RAAN, phase at t=0 (rad), mean motion (rad/s)].
 */
export function circular(list) {
  const n = list.length, data = new Float64Array(n * 5);
  list.forEach((s, i) => {
    const a = (RE_KM + s.altKm);
    data.set([a / RE_KM, s.inc * DEG, s.raan * DEG, s.phase * DEG, Math.sqrt(MU_EARTH / a ** 3)], i * 5);
  });
  return { n, data };
}

export function place({ n, data }, t, out) {
  for (let i = 0; i < n; i++) {
    const k = i * 5, r = data[k], inc = data[k + 1], raan = data[k + 2];
    const u = data[k + 3] + data[k + 4] * t;
    const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(inc), si = Math.sin(inc);
    // ECI = r (cosO cosu - sinO sinu cosi, sinO cosu + cosO sinu cosi, sinu sini) -> scene (x, z, -y)
    out[i * 3] = r * (cO * cu - sO * su * ci);
    out[i * 3 + 1] = r * su * si;
    out[i * 3 + 2] = -r * (sO * cu + cO * su * ci);
  }
  return out;
}

/** Walker-delta T/P/F shell as a satellite list. */
export function walker({ planes, perPlane, f = 1, altKm, inc, raan0 = 0, raanSpan = 360, phase0 = 0 }) {
  const T = planes * perPlane, list = [];
  for (let p = 0; p < planes; p++) {
    const raan = raan0 + (raanSpan >= 360 ? (360 * p) / planes : (planes > 1 ? (p / (planes - 1) - 0.5) * raanSpan : 0));
    for (let j = 0; j < perPlane; j++) {
      list.push({ altKm, inc, raan, phase: phase0 + (360 * j) / perPlane + (360 * f * p) / T, plane: p, slot: j });
    }
  }
  return list;
}

/** Keplerian orbit around a body; returns position [km] in the body's equatorial axes (scene convention). */
export function keplerPosition(o, t, mu, out = [0, 0, 0]) {
  const n = Math.sqrt(mu / o.a ** 3);
  const E = solveKepler(((o.ma * DEG + n * t) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI), o.ecc);
  const xp = o.a * (Math.cos(E) - o.ecc), yp = o.a * Math.sqrt(1 - o.ecc ** 2) * Math.sin(E);
  const w = o.argp * DEG, O = o.raan * DEG, i = o.inc * DEG;
  const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const z = sw * si * xp + cw * si * yp;
  return toScene(x, y, z, out);
}

/** Earth central angle [rad] covered by a satellite at altKm down to minElevDeg. */
export function coverageAngle(altKm, minElevDeg) {
  const e = minElevDeg * DEG;
  return Math.acos((RE_KM / (RE_KM + altKm)) * Math.cos(e)) - e;
}

/** Great-circle distance [km] between two lat/lon points. */
export function greatCircleKm(a, b) {
  const [la1, lo1] = a.map((d) => d * DEG), [la2, lo2] = b.map((d) => d * DEG);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * RE_KM * Math.asin(Math.sqrt(h));
}
