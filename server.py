"""
Universal Flight Radar & Telemetry Backend
Queries real-time public ADS-B transponder data and flight schedules.
"""

import time
import math
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("flight-tracker")

app = FastAPI(title="AeroTrack Universal ADS-B Flight Monitor API", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
}

# Cache per flight query
_flight_cache: Dict[str, Dict[str, Any]] = {}
_last_live_state: Dict[str, Any] = {}
CACHE_TTL_SEC = 5

def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points on the earth in km."""
    R = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the initial bearing between two points in degrees."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    bearing = math.degrees(math.atan2(y, x))
    return (bearing + 360) % 360

def search_flight_public(query: str) -> List[Dict[str, Any]]:
    """Query FR24 search API for live flights, schedules, or aircraft."""
    url = f"https://www.flightradar24.com/v1/search/web/find?query={query.strip()}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=6)
        if resp.status_code == 200:
            return resp.json().get("results", [])
    except Exception as e:
        logger.warning(f"Error in search_flight_public({query}): {e}")
    return []

def fetch_flight_data(target_query: str) -> Dict[str, Any]:
    """Fetch live or recent flight data for ANY commercial or general aviation flight."""
    global _last_live_state
    cleaned_query = target_query.strip().upper()
    now = time.time()

    # 1. Search for live or scheduled match
    search_results = search_flight_public(cleaned_query)

    live_match = next((r for r in search_results if r.get("type") == "live"), None)
    schedule_match = next((r for r in search_results if r.get("type") == "schedule"), None)

    flight_id = live_match.get("id") if live_match else None

    # Try standard IATA/ICAO airline code swaps if not found initially
    if not flight_id:
        swaps = []
        if cleaned_query.startswith("TAM"): swaps.append(cleaned_query.replace("TAM", "LA"))
        elif cleaned_query.startswith("LA"): swaps.append(cleaned_query.replace("LA", "TAM"))
        elif cleaned_query.startswith("GLO"): swaps.append(cleaned_query.replace("GLO", "G3"))
        elif cleaned_query.startswith("G3"): swaps.append(cleaned_query.replace("G3", "GLO"))
        elif cleaned_query.startswith("AZU"): swaps.append(cleaned_query.replace("AZU", "AD"))
        elif cleaned_query.startswith("AD"): swaps.append(cleaned_query.replace("AD", "AZU"))
        elif cleaned_query.startswith("AFR"): swaps.append(cleaned_query.replace("AFR", "AF"))
        elif cleaned_query.startswith("AF"): swaps.append(cleaned_query.replace("AF", "AFR"))

        for alt in swaps:
            alt_res = search_flight_public(alt)
            alt_live = next((r for r in alt_res if r.get("type") == "live"), None)
            if alt_live:
                flight_id = alt_live.get("id")
                live_match = alt_live
                break
            if not schedule_match:
                schedule_match = next((r for r in alt_res if r.get("type") == "schedule"), None)

    # If flight is currently airborne
    if live_match and flight_id:
        try:
            detail_url = f"https://data-live.flightradar24.com/clickhandler/?flight={flight_id}"
            det_resp = requests.get(detail_url, headers=HEADERS, timeout=6)
            if det_resp.status_code == 200:
                detail = det_resp.json()
                live_parsed = parse_live_flight(detail, live_match)
                _last_live_state[flight_id] = live_parsed
                return live_parsed
            elif det_resp.status_code == 429:
                logger.info(f"Clickhandler 429 rate limit. Using search-level coordinates for {flight_id}")
        except Exception as e:
            logger.warning(f"Error fetching clickhandler details: {e}")

        # Fallback to search-level live telemetry if clickhandler was rate-limited
        if flight_id in _last_live_state:
            cached = _last_live_state[flight_id]
            det = live_match.get("detail", {}) or {}
            new_lat = det.get("lat")
            new_lon = det.get("lon")
            if new_lat and new_lon:
                cached["telemetry"]["latitude"] = new_lat
                cached["telemetry"]["longitude"] = new_lon
                orig_pos = cached["route"]["origin"]["position"]
                dest_pos = cached["route"]["destination"]["position"]
                total_dist = cached["route"]["distance_total_km"]
                flown = haversine_distance_km(orig_pos["lat"], orig_pos["lng"], new_lat, new_lon)
                rem = haversine_distance_km(new_lat, new_lon, dest_pos["lat"], dest_pos["lng"])
                cached["route"]["distance_flown_km"] = round(flown, 1)
                cached["route"]["distance_remaining_km"] = round(rem, 1)
                if total_dist > 0:
                    cached["route"]["progress_percent"] = round(min(100.0, (flown / total_dist) * 100), 1)
                cached["last_updated"] = int(time.time())
            return cached

    # Flight is not live in the air right now -> Fetch schedule or generic fallback
    return fetch_scheduled_or_fallback(cleaned_query, schedule_match)

def parse_live_flight(detail: Dict[str, Any], live_match: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Parse and normalize live flight details into a rich telemetry payload."""
    ident = detail.get("identification", {}) or {}
    aircraft = detail.get("aircraft", {}) or {}
    airline = detail.get("airline", {}) or {}
    airport = detail.get("airport", {}) or {}
    status = detail.get("status", {}) or {}
    times = detail.get("time", {}) or {}
    trail = detail.get("trail", []) or []

    # Current telemetry from latest trail point or live match
    cur_lat = 0.0
    cur_lng = 0.0
    cur_alt_ft = 0
    cur_spd_kts = 0
    cur_hd = 0
    cur_ts = int(time.time())
    vertical_speed_fpm = 0

    if trail and len(trail) > 0:
        p0 = trail[0]
        cur_lat = p0.get("lat", 0.0)
        cur_lng = p0.get("lng", 0.0)
        cur_alt_ft = p0.get("alt", 0)
        cur_spd_kts = p0.get("spd", 0)
        cur_hd = p0.get("hd", 0)
        cur_ts = p0.get("ts", cur_ts)

        # Estimate vertical speed from last two trail points
        if len(trail) > 1:
            p1 = trail[1]
            dt = p0.get("ts", 0) - p1.get("ts", 0)
            if dt > 0:
                d_alt = p0.get("alt", 0) - p1.get("alt", 0)
                vertical_speed_fpm = int((d_alt / dt) * 60)
    elif live_match:
        det = live_match.get("detail", {}) or {}
        cur_lat = det.get("lat", 0.0)
        cur_lng = det.get("lon", 0.0)

    # Origin & Destination Airports
    orig = airport.get("origin", {}) or {}
    dest = airport.get("destination", {}) or {}

    orig_pos = orig.get("position", {}) or {}
    dest_pos = dest.get("position", {}) or {}

    orig_lat = orig_pos.get("latitude", 0.0)
    orig_lng = orig_pos.get("longitude", 0.0)
    dest_lat = dest_pos.get("latitude", 0.0)
    dest_lng = dest_pos.get("longitude", 0.0)

    orig_elev = orig_pos.get("altitude", 0)
    dest_elev = dest_pos.get("altitude", 0)

    # Calculate distance flown & distance remaining
    total_dist_km = haversine_distance_km(orig_lat, orig_lng, dest_lat, dest_lng) if (orig_lat != 0 and dest_lat != 0) else 1000.0
    dist_from_orig_km = haversine_distance_km(orig_lat, orig_lng, cur_lat, cur_lng) if (orig_lat != 0 and cur_lat != 0) else 0.0
    dist_to_dest_km = haversine_distance_km(cur_lat, cur_lng, dest_lat, dest_lng) if (cur_lat != 0 and dest_lat != 0) else total_dist_km

    progress_pct = 0.0
    if total_dist_km > 0:
        progress_pct = min(100.0, max(0.0, (dist_from_orig_km / total_dist_km) * 100))

    # Calculate Mach (approx at standard atmospheric speed of sound)
    mach = round(cur_spd_kts / 661.47, 2) if cur_spd_kts > 0 else 0.0

    # Photos
    images = aircraft.get("images", {}) or {}
    thumbnails = images.get("thumbnails", []) or []
    large_images = images.get("large", []) or []
    medium_images = images.get("medium", []) or []

    photo_url = None
    photo_copyright = None
    if large_images and len(large_images) > 0:
        photo_url = large_images[0].get("src")
        photo_copyright = large_images[0].get("copyright")
    elif medium_images and len(medium_images) > 0:
        photo_url = medium_images[0].get("src")
        photo_copyright = medium_images[0].get("copyright")
    elif thumbnails and len(thumbnails) > 0:
        photo_url = thumbnails[0].get("src")
        photo_copyright = thumbnails[0].get("copyright")

    # Format Trail points with calculated distance from origin
    formatted_trail = []
    for pt in reversed(trail):
        p_lat = pt.get("lat")
        p_lng = pt.get("lng")
        p_dist = round(haversine_distance_km(orig_lat, orig_lng, p_lat, p_lng), 1) if (orig_lat != 0 and p_lat and p_lng) else 0.0
        formatted_trail.append({
            "lat": p_lat,
            "lng": p_lng,
            "alt": pt.get("alt"),
            "spd": pt.get("spd"),
            "hd": pt.get("hd"),
            "ts": pt.get("ts"),
            "dist_km": p_dist
        })

    flight_number = ident.get("number", {}).get("default") or ident.get("callsign") or "VOO"
    callsign = ident.get("callsign") or flight_number

    # Logo
    airline_logo = None
    if live_match and live_match.get("detail", {}).get("logo"):
        airline_logo = live_match["detail"]["logo"]
    elif live_match and live_match.get("detail", {}).get("operator_id"):
        airline_logo = f"https://cdn.flightradar24.com/assets/airlines/logotypes/{live_match['detail']['operator_id']}.png"

    return {
        "is_live": True,
        "not_found": False,
        "flight_id": ident.get("id"),
        "callsign": callsign,
        "flight_number": flight_number,
        "alternative_flight": ident.get("number", {}).get("alternative") or callsign,
        "status": {
            "text": status.get("text", "Em Voo"),
            "color": status.get("icon", "green"),
            "live": True,
            "phase": "CRUISE" if cur_alt_ft > 25000 else ("CLIMB" if vertical_speed_fpm > 300 else ("DESCENT" if vertical_speed_fpm < -300 else "EN ROUTE")),
            "description": "Aeronave em voo transmitindo ADS-B em tempo real"
        },
        "aircraft": {
            "model_code": aircraft.get("model", {}).get("code", "JATO"),
            "model_name": aircraft.get("model", {}).get("text", "Aeronave Comercial"),
            "registration": aircraft.get("registration", "---"),
            "hex": aircraft.get("hex", "------"),
            "photo_url": photo_url,
            "photo_copyright": photo_copyright,
        },
        "airline": {
            "name": airline.get("name", "Companhia Aérea"),
            "iata": airline.get("code", {}).get("iata", ""),
            "icao": airline.get("code", {}).get("icao", ""),
            "logo": airline_logo
        },
        "route": {
            "origin": {
                "name": orig.get("name", "Aeroporto de Origem"),
                "city": orig.get("position", {}).get("region", {}).get("city", "Origem"),
                "iata": orig.get("code", {}).get("iata", "ORIG"),
                "icao": orig.get("code", {}).get("icao", "----"),
                "terminal": orig.get("info", {}).get("terminal", "-"),
                "gate": orig.get("info", {}).get("gate", "-"),
                "position": {"lat": orig_lat, "lng": orig_lng, "altitude": orig_elev},
                "timezone": orig.get("timezone", {}).get("name", "UTC")
            },
            "destination": {
                "name": dest.get("name", "Aeroporto de Destino"),
                "city": dest.get("position", {}).get("region", {}).get("city", "Destino"),
                "iata": dest.get("code", {}).get("iata", "DEST"),
                "icao": dest.get("code", {}).get("icao", "----"),
                "terminal": dest.get("info", {}).get("terminal", "-"),
                "gate": dest.get("info", {}).get("gate", "-"),
                "position": {"lat": dest_lat, "lng": dest_lng, "altitude": dest_elev},
                "timezone": dest.get("timezone", {}).get("name", "UTC")
            },
            "distance_total_km": round(total_dist_km, 1),
            "distance_flown_km": round(dist_from_orig_km, 1),
            "distance_remaining_km": round(dist_to_dest_km, 1),
            "progress_percent": round(progress_pct, 1)
        },
        "telemetry": {
            "latitude": cur_lat,
            "longitude": cur_lng,
            "altitude_ft": cur_alt_ft,
            "altitude_m": round(cur_alt_ft * 0.3048),
            "speed_kts": cur_spd_kts,
            "speed_kmh": round(cur_spd_kts * 1.852),
            "mach": mach,
            "heading": cur_hd,
            "vertical_speed_fpm": vertical_speed_fpm,
            "timestamp": cur_ts,
            "trail_points_count": len(trail)
        },
        "times": {
            "scheduled_departure": times.get("scheduled", {}).get("departure"),
            "real_departure": times.get("real", {}).get("departure"),
            "estimated_arrival": times.get("estimated", {}).get("arrival") or times.get("other", {}).get("eta"),
            "scheduled_arrival": times.get("scheduled", {}).get("arrival"),
        },
        "trail": formatted_trail,
        "last_updated": int(time.time()),
        "source": "ADS-B Transponder via FlightRadar24 Public Network"
    }

def fetch_scheduled_or_fallback(target_query: str, schedule_match: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Dynamically fetch schedule and airport information for any flight when not in the air."""
    sched_list = []
    try:
        url = f"https://api.flightradar24.com/common/v1/flight/list.json?query={target_query}&fetchBy=flight&page=1&limit=2"
        r = requests.get(url, headers=HEADERS, timeout=6)
        if r.status_code == 200:
            sched_list = r.json().get("result", {}).get("response", {}).get("data", [])
    except Exception as e:
        logger.warning(f"Error fetching schedule list for {target_query}: {e}")

    if sched_list:
        latest = sched_list[0]
        ident = latest.get("identification", {}) or {}
        orig = latest.get("airport", {}).get("origin", {}) or {}
        dest = latest.get("airport", {}).get("destination", {}) or {}
        orig_pos = orig.get("position", {}) or {}
        dest_pos = dest.get("position", {}) or {}
        airline = latest.get("airline", {}) or {}
        aircraft = latest.get("aircraft", {}) or {}
        status = latest.get("status", {}) or {}
        times = latest.get("time", {}) or {}

        orig_lat = orig_pos.get("latitude", 0.0)
        orig_lng = orig_pos.get("longitude", 0.0)
        dest_lat = dest_pos.get("latitude", 0.0)
        dest_lng = dest_pos.get("longitude", 0.0)
        total_dist_km = haversine_distance_km(orig_lat, orig_lng, dest_lat, dest_lng) if (orig_lat != 0 and dest_lat != 0) else 800.0

        return {
            "is_live": False,
            "not_found": False,
            "flight_id": None,
            "callsign": ident.get("callsign") or target_query,
            "flight_number": ident.get("number", {}).get("default") or target_query,
            "alternative_flight": ident.get("number", {}).get("alternative") or target_query,
            "status": {
                "text": status.get("text", "Programado / No Solo"),
                "color": "amber",
                "live": False,
                "phase": "ON GROUND / SCHEDULED",
                "description": f"Voo {target_query} programado ou encerrado. Rota registrada entre {orig.get('code', {}).get('iata', 'ORIG')} e {dest.get('code', {}).get('iata', 'DEST')}."
            },
            "aircraft": {
                "model_code": aircraft.get("model", {}).get("code", "JET"),
                "model_name": aircraft.get("model", {}).get("text", "Aeronave Comercial"),
                "registration": aircraft.get("registration", "---"),
                "hex": aircraft.get("hex", "------"),
                "photo_url": None,
                "photo_copyright": None,
            },
            "airline": {
                "name": airline.get("name", "Companhia Aérea"),
                "iata": airline.get("code", {}).get("iata", ""),
                "icao": airline.get("code", {}).get("icao", ""),
                "logo": f"https://cdn.flightradar24.com/assets/airlines/logotypes/{schedule_match.get('detail', {}).get('operator_id')}.png" if schedule_match and schedule_match.get("detail", {}).get("operator_id") else None
            },
            "route": {
                "origin": {
                    "name": orig.get("name", "Aeroporto de Origem"),
                    "city": orig_pos.get("region", {}).get("city", "Origem"),
                    "iata": orig.get("code", {}).get("iata", "ORIG"),
                    "icao": orig.get("code", {}).get("icao", "----"),
                    "terminal": "-",
                    "gate": "-",
                    "position": {"lat": orig_lat, "lng": orig_lng, "altitude": orig_pos.get("altitude", 0)},
                    "timezone": orig.get("timezone", {}).get("name", "UTC")
                },
                "destination": {
                    "name": dest.get("name", "Aeroporto de Destino"),
                    "city": dest_pos.get("region", {}).get("city", "Destino"),
                    "iata": dest.get("code", {}).get("iata", "DEST"),
                    "icao": dest.get("code", {}).get("icao", "----"),
                    "terminal": "-",
                    "gate": "-",
                    "position": {"lat": dest_lat, "lng": dest_lng, "altitude": dest_pos.get("altitude", 0)},
                    "timezone": dest.get("timezone", {}).get("name", "UTC")
                },
                "distance_total_km": round(total_dist_km, 1),
                "distance_flown_km": 0.0,
                "distance_remaining_km": round(total_dist_km, 1),
                "progress_percent": 0.0
            },
            "telemetry": {
                "latitude": orig_lat,
                "longitude": orig_lng,
                "altitude_ft": orig_pos.get("altitude", 0),
                "altitude_m": round(orig_pos.get("altitude", 0) * 0.3048),
                "speed_kts": 0,
                "speed_kmh": 0,
                "mach": 0.0,
                "heading": round(calculate_bearing(orig_lat, orig_lng, dest_lat, dest_lng)) if (orig_lat != 0 and dest_lat != 0) else 0,
                "vertical_speed_fpm": 0,
                "timestamp": int(time.time()),
                "trail_points_count": 0
            },
            "times": {
                "scheduled_departure": times.get("scheduled", {}).get("departure"),
                "real_departure": times.get("real", {}).get("departure"),
                "estimated_arrival": times.get("estimated", {}).get("arrival"),
                "scheduled_arrival": times.get("scheduled", {}).get("arrival"),
            },
            "trail": [],
            "last_updated": int(time.time()),
            "source": "Cronograma Público de Voo"
        }

    # Not found / No schedule found
    return {
        "is_live": False,
        "not_found": True,
        "flight_id": None,
        "callsign": target_query,
        "flight_number": target_query,
        "alternative_flight": target_query,
        "status": {
            "text": "Sem Sinal ADS-B",
            "color": "amber",
            "live": False,
            "phase": "OFFLINE / NÃO LOCALIZADO",
            "description": f"Nenhuma transmissão ADS-B ao vivo encontrada para '{target_query}'. Verifique o código do voo ou teste uma sugestão acima."
        },
        "aircraft": {
            "model_code": "---",
            "model_name": "Aeronave não identificada",
            "registration": "---",
            "hex": "------",
            "photo_url": None,
            "photo_copyright": None,
        },
        "airline": {
            "name": "Linha Aérea",
            "iata": "",
            "icao": "",
            "logo": None
        },
        "route": {
            "origin": {
                "name": "Aeroporto de Origem",
                "city": "Origem",
                "iata": "---",
                "icao": "----",
                "terminal": "-",
                "gate": "-",
                "position": {"lat": 0.0, "lng": 0.0, "altitude": 0},
                "timezone": "UTC"
            },
            "destination": {
                "name": "Aeroporto de Destino",
                "city": "Destino",
                "iata": "---",
                "icao": "----",
                "terminal": "-",
                "gate": "-",
                "position": {"lat": 0.0, "lng": 0.0, "altitude": 0},
                "timezone": "UTC"
            },
            "distance_total_km": 0.0,
            "distance_flown_km": 0.0,
            "distance_remaining_km": 0.0,
            "progress_percent": 0.0
        },
        "telemetry": {
            "latitude": 0.0,
            "longitude": 0.0,
            "altitude_ft": 0,
            "altitude_m": 0,
            "speed_kts": 0,
            "speed_kmh": 0,
            "mach": 0.0,
            "heading": 0,
            "vertical_speed_fpm": 0,
            "timestamp": int(time.time()),
            "trail_points_count": 0
        },
        "times": {
            "scheduled_departure": None,
            "real_departure": None,
            "estimated_arrival": None,
            "scheduled_arrival": None,
        },
        "trail": [],
        "last_updated": int(time.time()),
        "source": "Rede Pública ADS-B"
    }

@app.get("/api/flight/{callsign}")
def get_flight(callsign: str, force: bool = False):
    """Get flight telemetry by callsign/flight number (e.g. TAM3734, GLO1500, AFR443)."""
    now = time.time()
    cache_key = callsign.strip().upper()
    
    if not force and cache_key in _flight_cache:
        cached_entry = _flight_cache[cache_key]
        if now - cached_entry["timestamp"] < CACHE_TTL_SEC:
            return cached_entry["data"]

    data = fetch_flight_data(target_query=cache_key)
    _flight_cache[cache_key] = {
        "data": data,
        "timestamp": now
    }
    return data

@app.get("/api/search")
def search_flights(q: str = Query(..., min_length=2, description="Flight number, callsign or airline query")):
    """Search for flights and airlines with live indicators."""
    results = search_flight_public(q)
    formatted = []
    for r in results:
        formatted.append({
            "id": r.get("id"),
            "label": r.get("label"),
            "type": r.get("type"),
            "detail": r.get("detail", {})
        })
    return {"query": q, "results": formatted}

@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "AeroTrack Universal Flight Monitor",
        "timestamp": int(time.time()),
        "active_cached_flights": len(_flight_cache)
    }

# Resolve paths relative to this file so it works from any working directory
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

# Mount static folder
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
def serve_index():
    return FileResponse(str(STATIC_DIR / "index.html"))

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8080, reload=False)
