---
name: flight-tracker
description: Monitor and analyze real-time aircraft flights, ADS-B transponders, tactical radar mapping, and 2D vertical situation displays (VSD).
---

# Flight Tracker & ADS-B Telemetry Skill

This skill provides comprehensive instructions and mathematical foundations for querying public ADS-B transponder telemetry, decoding flight radar signals, normalizing multi-airline datasets, and rendering tactical flight interfaces.

---

## 1. Public ADS-B Data Protocol

### Primary Endpoints (Open Data, Zero API Keys Required)

1. **Flight Search & Transponder Discovery:**
   - **URL:** `https://www.flightradar24.com/v1/search/web/find?query={QUERY}`
   - **Method:** `GET`
   - **Query Parameters:**
     - `query`: Flight callsign (e.g. `TAM3734`), flight number (`LA3734`), aircraft registration (`PR-XBV`), or hex Mode-S code (`E4A125`).
   - **Result Types:**
     - `"live"`: Active transponder in the air, contains real-time `id`, `lat`, `lon`, `altitude`.
     - `"schedule"`: Scheduled or recently arrived flight with origin/destination IATA airport codes.

2. **Full Telemetry & Transponder Trail (Clickhandler):**
   - **URL:** `https://data-live.flightradar24.com/clickhandler/?flight={FLIGHT_ID}`
   - **Method:** `GET`
   - **Key Fields Decoded:**
     - `identification.callsign`: ICAO air traffic callsign (e.g., `TAM3734`, `AFR443`).
     - `identification.number.default`: Commercial flight number.
     - `aircraft.model.text`: Aircraft airframe model (e.g., `Airbus A320-271N`, `Boeing 777-328ER`).
     - `aircraft.hex`: 24-bit Mode-S ICAO aircraft address.
     - `aircraft.images`: High-resolution aircraft photography.
     - `trail`: Chronological array of transponder GPS ping tuples: `[lat, lon, alt_ft, spd_kts, hdg_deg, ts]`.
     - `airport.origin` & `airport.destination`: Runways, coordinates, altitudes, and terminal info.

3. **Fallback Schedule Endpoint:**
   - **URL:** `https://api.flightradar24.com/common/v1/flight/list.json?query={QUERY}&fetchBy=flight&page=1&limit=2`
   - **Method:** `GET`
   - **Usage:** Used when the aircraft is on ground with its transponder idle or between flights to retrieve origin, destination, and schedule timeline.

---

## 2. Airline Code Auto-Swapping Rule

Flight identifiers frequently alternate between ICAO callsigns and IATA booking codes:

| Airline | ICAO Prefix (ADS-B Radar) | IATA Code (Ticket / Booking) |
| :--- | :--- | :--- |
| **LATAM Airlines** | `TAM` | `LA` / `JJ` |
| **Gol Linhas Aéreas** | `GLO` | `G3` |
| **Azul Linhas Aéreas** | `AZU` | `AD` |
| **Air France** | `AFR` | `AF` |
| **TAP Air Portugal** | `TAP` | `TP` |
| **American Airlines** | `AAL` | `AA` |
| **United Airlines** | `UAL` | `UA` |
| **Lufthansa** | `DLH` | `LH` |

**Transformation Rule:** If an initial search for an ICAO code returns no live transponder, immediately retry with the IATA equivalent (e.g. `TAM3734` ↔ `LA3734`), and vice-versa.

---

## 3. Mathematical Foundations

### A. Great-Circle Distance (Haversine Formula)
Computes distance over the Earth's curvature between $(\phi_1, \lambda_1)$ and $(\phi_2, \lambda_2)$:

$$\Delta\phi = \phi_2 - \phi_1, \quad \Delta\lambda = \lambda_2 - \lambda_1$$

$$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)$$

$$c = 2 \cdot \arctan2(\sqrt{a}, \sqrt{1-a})$$

$$d = R \cdot c \quad (R = 6,371.0 \text{ km})$$

### B. True Navigation Bearing (Heading)
Computes initial bearing from point 1 to point 2:

$$\theta = \arctan2\left(\sin(\Delta\lambda)\cos(\phi_2), \cos(\phi_1)\sin(\phi_2) - \sin(\phi_1)\cos(\phi_2)\cos(\Delta\lambda)\right)$$

Normalize to degrees: $\text{Bearing} = (\text{degrees}(\theta) + 360) \pmod{360}$.

### C. Vertical Speed Indicator (VSI) Estimation
Calculates climb or descent rate in feet per minute (FPM) from consecutive transponder packets:

$$\text{VSI} = \frac{\text{Alt}_0 - \text{Alt}_1}{\Delta t_{\text{seconds}}} \times 60$$

- $\text{VSI} > +150 \text{ FPM}$: Aircraft in **Climb** phase.
- $\text{VSI} < -150 \text{ FPM}$: Aircraft in **Descent** phase.
- $-150 \le \text{VSI} \le +150 \text{ FPM}$: Aircraft in **Cruise** level flight.

### D. Atmospheric Mach Number
Approximation of aircraft speed relative to the speed of sound at standard sea-level temperature ($a_0 \approx 661.47 \text{ kts}$):

$$\text{Mach} \approx \frac{V_{\text{kts}}}{661.47}$$

---

## 4. 2D Vertical Situation Display (VSD) Engine

The 2D elevation profile provides a cockpit-grade side-view of the aircraft trajectory:

1. **Dual Coordinate Transformation:**
   - $X(\text{dist}) = X_{\text{offset}} + \frac{\text{dist}}{\text{TotalDist}} \times W_{\text{plot}}$
   - $Y(\text{alt}) = Y_{\text{offset}} + H_{\text{plot}} - \frac{\text{alt}}{\text{Alt}_{\text{max}}} \times H_{\text{plot}}$ (where $\text{Alt}_{\text{max}} = 42,000\text{ ft} = \text{FL420}$).

2. **Ground Taxi Elevation Clamping:**
   - At high-elevation airports (e.g. Brasília BSB at 3,479 ft MSL), transponders report $0\text{ ft}$ radar altitude when on ground.
   - **Correction Rule:** If $\text{dist} < 35\text{ km}$ and $\text{alt} < \text{OrigElev}$, clamp altitude to $\text{OrigElev}$ to prevent false 0-foot plunges into terrain.

3. **Dynamic Terrain Profile Interpolation:**
   $$\text{Elev}_{\text{terrain}}(d) = \text{OrigElev} \cdot (1 - r) + \text{DestElev} \cdot r + \text{Hills}(r) \cdot \sin(\pi r)$$
   where $r = \frac{d}{d_{\text{total}}}$. The $\sin(\pi r)$ term guarantees terrain matches runway elevations precisely at both departure and arrival airports.

4. **Top of Descent (TOD) Prediction:**
   $$\text{Dist}_{\text{descent}} = \min\left(260\text{ km}, \frac{\text{Alt}_{\text{cruise}}}{1,000} \times 5.8\right)$$
   $$\text{TOD} = \max(\text{Dist}_{\text{flown}}, \text{Dist}_{\text{total}} - \text{Dist}_{\text{descent}})$$

---

## 5. Troubleshooting & Operational Guide

| Symptom | Cause | Resolution |
| :--- | :--- | :--- |
| **HTTP 429 Rate Limit** | Too many frequent clickhandler calls to public CDN | The backend falls back to search-level lat/lon positions and serves the last known cached telemetry. Default polling is 5 seconds. |
| **Flight Not Found** | Flight not active in transponder range or airline code mismatch | Check ICAO vs IATA airline code (e.g. use `LA3734` if `TAM3734` yields no signal), or check offline schedule banner. |
| **Aircraft Plunges to 0 ft** | Transponder reporting AGL rather than MSL while taxiing | Verified clamping automatically locks departure altitude to the runway MSL elevation. |
| **Map Not Centered** | Flight moved to a different continent/region | `state.initialFramed = false` triggers automatic `fitBounds` across the new route coordinates. |
