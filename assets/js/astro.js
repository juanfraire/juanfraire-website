// Low-precision astronomy, good to a fraction of a degree: enough for pictures and
// light-time, not for operations. No dependencies; used with and without the 3D scene.

const DEG = Math.PI / 180;
export const AU_KM = 149597870.7;
export const C_KMS = 299792.458;

const daysJ2000 = (date) => date.getTime() / 86400000 + 2440587.5 - 2451545.0;

// JPL "Approximate Positions of the Planets", Table 1 (valid 1800-2050), J2000 ecliptic:
// a [AU], e, I, L, long. perihelion, long. ascending node [deg], each with a per-century rate.
const ELEMENTS = {
  earth: [1.00000261, 0.00000562, 0.01671123, -0.00004392, -0.00001531, -0.01294668,
    100.46457166, 35999.37244981, 102.93768193, 0.32327364, 0.0, 0.0],
  mars: [1.52371034, 0.00001847, 0.09339410, 0.00007882, 1.84969142, -0.00813131,
    -4.55343205, 19140.30268499, -23.94362959, 0.44441088, 49.55953891, -0.29257343],
};

export function solveKepler(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

/** Heliocentric position [AU] in the J2000 ecliptic frame. */
export function heliocentric(planet, date) {
  const T = daysJ2000(date) / 36525;
  const [a0, da, e0, de, I0, dI, L0, dL, w0, dw, O0, dO] = ELEMENTS[planet];
  const a = a0 + da * T, e = e0 + de * T, I = (I0 + dI * T) * DEG;
  const L = L0 + dL * T, w = w0 + dw * T, O = (O0 + dO * T) * DEG;
  const om = w * DEG - O;
  const E = solveKepler(((L - w) % 360) * DEG, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = Math.cos(om), so = Math.sin(om), cO = Math.cos(O), sO = Math.sin(O), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}

/** One-way light time from Earth to Mars, in minutes. */
export function marsLightMinutes(date = new Date()) {
  const e = heliocentric('earth', date), m = heliocentric('mars', date);
  return Math.hypot(m[0] - e[0], m[1] - e[1], m[2] - e[2]) * AU_KM / C_KMS / 60;
}

const OBLIQUITY = 23.4393 * DEG;
const eclipticToEquatorial = ([x, y, z]) => [
  x,
  y * Math.cos(OBLIQUITY) - z * Math.sin(OBLIQUITY),
  y * Math.sin(OBLIQUITY) + z * Math.cos(OBLIQUITY),
];

/** Unit vector from Earth to Mars in the Earth equatorial (ECI) frame. */
export function marsDirectionEci(date) {
  const e = heliocentric('earth', date), m = heliocentric('mars', date);
  const v = eclipticToEquatorial([m[0] - e[0], m[1] - e[1], m[2] - e[2]]);
  const n = Math.hypot(...v);
  return v.map((c) => c / n);
}

/** Unit vector from Earth to the Sun in the ECI frame (Astronomical Almanac low-precision formula). */
export function sunDirectionEci(date) {
  const n = daysJ2000(date);
  const L = 280.460 + 0.9856474 * n;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  return [Math.cos(lambda), Math.cos(eps) * Math.sin(lambda), Math.sin(eps) * Math.sin(lambda)];
}

/** Greenwich mean sidereal time [rad]. */
export function gmst(date) {
  return ((280.46061837 + 360.98564736629 * daysJ2000(date)) % 360) * DEG;
}
