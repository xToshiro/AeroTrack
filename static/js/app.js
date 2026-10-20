/**
 * AeroTrack ADS-B Radar Client
 * Real-time public telemetry for TAM3734 / LA3734
 */

document.addEventListener("DOMContentLoaded", () => {
  // Application State
  const state = {
    currentFlight: "TAM3734",
    pollingInterval: 5000,
    pollTimer: null,
    audioEnabled: true,
    autoCenter: true,
    showTrail: true,
    mapStyle: "dark", // 'dark' | 'osm'
    map: null,
    planeMarker: null,
    trailPolyline: null,
    routeLine: null,
    originMarker: null,
    destMarker: null,
    lastTelemetry: null,
    cachedData: null,
    audioCtx: null,
    showProfileGrid: true,
    mouseHoverPos: null
  };

  // DOM Elements
  const el = {
    flightInput: document.getElementById("flightInput"),
    btnSearch: document.getElementById("btnSearch"),
    chips: document.querySelectorAll(".chip"),
    clockUtc: document.getElementById("clockUtc"),
    clockBrt: document.getElementById("clockBrt"),
    btnAudioToggle: document.getElementById("btnAudioToggle"),
    btnRefresh: document.getElementById("btnRefresh"),
    refreshIcon: document.getElementById("refreshIcon"),
    btnRawData: document.getElementById("btnRawData"),
    rawModal: document.getElementById("rawModal"),
    btnCloseModal: document.getElementById("btnCloseModal"),
    btnCopyJson: document.getElementById("btnCopyJson"),
    jsonViewer: document.getElementById("jsonViewer"),
    
    // Alerts & Dynamic Status
    flightAlertBanner: document.getElementById("flightAlertBanner"),
    flightAlertMessage: document.getElementById("flightAlertMessage"),
    legendOrigIata: document.getElementById("legendOrigIata"),
    legendDestIata: document.getElementById("legendDestIata"),
    schedOrigTitle: document.getElementById("schedOrigTitle"),
    schedDestTitle: document.getElementById("schedDestTitle"),
    footerFlightDesc: document.getElementById("footerFlightDesc"),

    // Hero Banner
    livePill: document.getElementById("livePill"),
    liveStatusText: document.getElementById("liveStatusText"),
    mainCallsign: document.getElementById("mainCallsign"),
    altFlightNumber: document.getElementById("altFlightNumber"),
    aircraftModelShort: document.getElementById("aircraftModelShort"),
    aircraftRegShort: document.getElementById("aircraftRegShort"),
    originIata: document.getElementById("originIata"),
    originCity: document.getElementById("originCity"),
    originGateTag: document.getElementById("originGateTag"),
    destIata: document.getElementById("destIata"),
    destCity: document.getElementById("destCity"),
    destGateTag: document.getElementById("destGateTag"),
    flightPhaseLabel: document.getElementById("flightPhaseLabel"),
    progressFill: document.getElementById("progressFill"),
    planeProgressMarker: document.getElementById("planeProgressMarker"),
    distFlownText: document.getElementById("distFlownText"),
    progressPctText: document.getElementById("progressPctText"),
    distRemText: document.getElementById("distRemText"),
    
    // HUD
    valAltitude: document.getElementById("valAltitude"),
    valAltitudeMeters: document.getElementById("valAltitudeMeters"),
    vsiIndicator: document.getElementById("vsiIndicator"),
    valVsi: document.getElementById("valVsi"),
    valSpeed: document.getElementById("valSpeed"),
    valSpeedKmh: document.getElementById("valSpeedKmh"),
    valMach: document.getElementById("valMach"),
    valHeading: document.getElementById("valHeading"),
    valHeadingCardinal: document.getElementById("valHeadingCardinal"),
    compassDial: document.getElementById("compassDial"),
    valCoords: document.getElementById("valCoords"),
    valHexCode: document.getElementById("valHexCode"),
    valEta: document.getElementById("valEta"),
    valFlightStatusDesc: document.getElementById("valFlightStatusDesc"),
    badgeEtaStatus: document.getElementById("badgeEtaStatus"),
    
    // Map controls
    btnRecenter: document.getElementById("btnRecenter"),
    btnToggleTrail: document.getElementById("btnToggleTrail"),
    btnMapStyle: document.getElementById("btnMapStyle"),

    // 2D Profile (VSD) Elements
    elevationCanvas: document.getElementById("elevationCanvas"),
    profileCanvasWrapper: document.getElementById("profileCanvasWrapper"),
    vsdTooltip: document.getElementById("vsdTooltip"),
    vsdFlightLevel: document.getElementById("vsdFlightLevel"),
    vsdAltText: document.getElementById("vsdAltText"),
    vsdVsiText: document.getElementById("vsdVsiText"),
    btnToggleProfileGrid: document.getElementById("btnToggleProfileGrid"),
    
    // Sidebar
    cardRegBadge: document.getElementById("cardRegBadge"),
    aircraftPhoto: document.getElementById("aircraftPhoto"),
    photoCopyright: document.getElementById("photoCopyright"),
    specModel: document.getElementById("specModel"),
    specAirline: document.getElementById("specAirline"),
    specReg: document.getElementById("specReg"),
    specHex: document.getElementById("specHex"),
    specTrailCount: document.getElementById("specTrailCount"),
    logStream: document.getElementById("logStream"),
    schedDepTime: document.getElementById("schedDepTime"),
    realDepTime: document.getElementById("realDepTime"),
    schedArrTime: document.getElementById("schedArrTime"),
    estArrTime: document.getElementById("estArrTime"),
    pollingIntervalText: document.getElementById("pollingIntervalText")
  };

  // --- AUDIO SYNTHESIS ---
  function playTelemetryPing() {
    if (!state.audioEnabled) return;
    try {
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (state.audioCtx.state === "suspended") {
        state.audioCtx.resume();
      }

      const osc = state.audioCtx.createOscillator();
      const gain = state.audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, state.audioCtx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(440, state.audioCtx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.04, state.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioCtx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(state.audioCtx.destination);

      osc.start();
      osc.stop(state.audioCtx.currentTime + 0.13);
    } catch (e) {
      console.warn("Audio Context error:", e);
    }
  }

  // --- CLOCK UPDATES ---
  function updateClocks() {
    const now = new Date();
    // UTC
    const utcHours = String(now.getUTCHours()).padStart(2, "0");
    const utcMinutes = String(now.getUTCMinutes()).padStart(2, "0");
    const utcSeconds = String(now.getUTCSeconds()).padStart(2, "0");
    el.clockUtc.textContent = `${utcHours}:${utcMinutes}:${utcSeconds} UTC`;

    // BRT (UTC-3)
    const brt = new Date(now.getTime() - (3 * 3600 * 1000));
    const brtHours = String(brt.getUTCHours()).padStart(2, "0");
    const brtMinutes = String(brt.getUTCMinutes()).padStart(2, "0");
    const brtSeconds = String(brt.getUTCSeconds()).padStart(2, "0");
    el.clockBrt.textContent = `${brtHours}:${brtMinutes}:${brtSeconds} BRT`;
  }
  setInterval(updateClocks, 1000);
  updateClocks();

  // --- HELPER FORMATTERS ---
  function formatTimestamp(unixSec) {
    if (!unixSec) return "--:--";
    const d = new Date(unixSec * 1000);
    // Brasilia local time (-03:00)
    return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  }

  function getCardinalDirection(angle) {
    const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    const index = Math.round(((angle %= 360) < 0 ? angle + 360 : angle) / 22.5) % 16;
    return directions[index];
  }

  function addLog(msg, type = "data") {
    const timeStr = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">[${timeStr}]</span> <span class="log-msg">${msg}</span>`;
    el.logStream.prepend(entry);

    // Keep log max 40 items
    while (el.logStream.children.length > 40) {
      el.logStream.removeChild(el.logStream.lastChild);
    }
  }

  // --- LEAFLET MAP INITIALIZATION ---
  function initMap() {
    // Default center Brasília (BSB) -> Fortaleza (FOR) midpoint
    state.map = L.map("radarMap", {
      center: [-10.0, -43.0],
      zoom: 6,
      zoomControl: true,
      attributionControl: false
    });

    // ESRI World Dark Gray Base & Reference (Zero API key, crisp ATC radar theme)
    state.tileLayerDark = L.layerGroup([
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 16,
        attribution: "Esri, HERE, Garmin"
      }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 16
      })
    ]);

    state.tileLayerOsm = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "OpenStreetMap"
    });

    state.tileLayerDark.addTo(state.map);

    // Custom Aircraft Marker Icon
    const planeSvg = `
      <div class="plane-marker-icon">
        <div class="radar-ping-ring"></div>
        <div class="plane-svg-wrapper" id="planeSvgWrapper">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L15 9L22 13L15 13.5L14 20L16 22H12L8 22L10 20L9 13.5L2 13L9 9L12 2Z" 
                  fill="#00e5ff" stroke="#003b46" stroke-width="1.2" stroke-linejoin="round" />
            <circle cx="12" cy="12" r="2" fill="#ffffff" />
          </svg>
        </div>
      </div>
    `;

    const customPlaneIcon = L.divIcon({
      html: planeSvg,
      className: "custom-leaflet-plane",
      iconSize: [44, 44],
      iconAnchor: [22, 22]
    });

    state.planeMarker = L.marker([-15.8711, -47.9186], { icon: customPlaneIcon }).addTo(state.map);

    // Airport Icons Factory
    window.createAirportPinIcon = (iata, color) => L.divIcon({
      html: `<div style="background:${color};color:#000;font-weight:700;font-family:'JetBrains Mono';font-size:10px;padding:2px 6px;border-radius:4px;box-shadow:0 0 8px ${color};border:1px solid #fff;text-align:center;">${iata}</div>`,
      className: "airport-pin",
      iconSize: [38, 20],
      iconAnchor: [19, 10]
    });

    state.originMarker = L.marker([-15.8711, -47.9186], { icon: window.createAirportPinIcon("DEP", "#ff5252") })
      .bindPopup("<b>Origem</b>")
      .addTo(state.map);

    state.destMarker = L.marker([-3.7763, -38.5325], { icon: window.createAirportPinIcon("ARR", "#00e676") })
      .bindPopup("<b>Destino</b>")
      .addTo(state.map);

    // Trail polyline
    state.trailPolyline = L.polyline([], {
      color: "#00e5ff",
      weight: 3.5,
      opacity: 0.85,
      lineJoin: "round"
    }).addTo(state.map);

    // Reference route line
    state.routeLine = L.polyline([[-15.8711, -47.9186], [-3.7763, -38.5325]], {
      color: "rgba(255, 255, 255, 0.25)",
      weight: 2,
      dashArray: "6, 8"
    }).addTo(state.map);
  }

  // --- DATA FETCHING & UI UPDATE ---
  async function fetchFlightData() {
    el.refreshIcon.classList.add("fa-spin");
    try {
      const resp = await fetch(`/api/flight/${encodeURIComponent(state.currentFlight)}`);
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);
      const data = await resp.json();
      state.cachedData = data;
      renderFlightData(data);
    } catch (err) {
      console.error("Erro ao buscar dados do voo:", err);
      addLog(`Erro ao consultar dados: ${err.message}`, "system");
    } finally {
      setTimeout(() => el.refreshIcon.classList.remove("fa-spin"), 400);
    }
  }

  function renderFlightData(data) {
    const isLive = data.is_live;
    const tel = data.telemetry || {};
    const route = data.route || {};
    const orig = route.origin || {};
    const dest = route.destination || {};
    const ac = data.aircraft || {};
    const times = data.times || {};

    // Offline / Not-found banner handler
    if (data.not_found) {
      if (el.flightAlertBanner) {
        el.flightAlertBanner.classList.add("show");
        if (el.flightAlertMessage) {
          el.flightAlertMessage.textContent = data.status?.description || `Nenhum sinal ADS-B ao vivo detectado para '${state.currentFlight}'.`;
        }
      }
    } else {
      if (el.flightAlertBanner) {
        el.flightAlertBanner.classList.remove("show");
      }
    }

    // Live Badge & Status
    if (isLive) {
      el.livePill.className = "live-pill";
      el.liveStatusText.textContent = "AO VIVO (ADS-B)";
      el.flightPhaseLabel.textContent = data.status.phase || "EM VOO";
    } else {
      el.livePill.className = "live-pill amber";
      el.liveStatusText.textContent = data.status.text || "NO SOLO / PROGRAMADO";
      el.flightPhaseLabel.textContent = data.status.phase || "PROGRAMADO";
    }

    // Call signs & aircraft
    el.mainCallsign.textContent = data.callsign || state.currentFlight;
    el.altFlightNumber.textContent = `${data.airline.name || 'Companhia'} ${data.flight_number || ''}`;
    el.aircraftModelShort.textContent = ac.model_name || "Aeronave Comercial";
    el.aircraftRegShort.textContent = ac.registration || "---";

    // Dynamic Airports
    const origIata = orig.iata || "DEP";
    const destIata = dest.iata || "ARR";
    const origCity = orig.city || "Origem";
    const destCity = dest.city || "Destino";

    el.originIata.textContent = origIata;
    el.originCity.textContent = origCity;
    el.originGateTag.textContent = orig.terminal && orig.terminal !== '-' ? `Portão ${orig.gate || '-'} • T${orig.terminal}` : (orig.name || "Aeroporto de Origem");

    el.destIata.textContent = destIata;
    el.destCity.textContent = destCity;
    el.destGateTag.textContent = dest.name || "Aeroporto de Destino";

    // Legend & timeline labels
    if (el.legendOrigIata) el.legendOrigIata.textContent = `(${origIata})`;
    if (el.legendDestIata) el.legendDestIata.textContent = `(${destIata})`;
    if (el.schedOrigTitle) el.schedOrigTitle.textContent = `${origCity} (${origIata})`;
    if (el.schedDestTitle) el.schedDestTitle.textContent = `${destCity} (${destIata})`;
    if (el.footerFlightDesc) {
      el.footerFlightDesc.textContent = `AeroTrack ADS-B // Rastreando ${data.callsign || state.currentFlight} (${origIata} → ${destIata})`;
    }

    // Progress Bar
    const progress = Math.min(100, Math.max(0, route.progress_percent || 0));
    el.progressFill.style.width = `${progress}%`;
    el.planeProgressMarker.style.left = `${progress}%`;
    el.progressPctText.textContent = `${progress.toFixed(0)}%`;
    el.distFlownText.textContent = `Percorrido: ${route.distance_flown_km || 0} km`;
    el.distRemText.textContent = `Restante: ${route.distance_remaining_km || 0} km`;

    // HUD Telemetry
    const altFt = tel.altitude_ft || 0;
    const altM = tel.altitude_m || Math.round(altFt * 0.3048);
    el.valAltitude.innerHTML = `${altFt.toLocaleString('pt-BR')} <span class="unit">FT</span>`;
    el.valAltitudeMeters.textContent = `${altM.toLocaleString('pt-BR')} M (MSL)`;

    // VSI (Vertical Speed Indicator)
    const vsi = tel.vertical_speed_fpm || 0;
    el.valVsi.textContent = `${vsi > 0 ? '+' : ''}${vsi} FPM`;
    if (vsi > 150) {
      el.vsiIndicator.className = "vsi-badge climb";
      el.vsiIndicator.innerHTML = `<i class="fa-solid fa-arrow-trend-up"></i> <span>+${vsi} FPM (Subindo)</span>`;
    } else if (vsi < -150) {
      el.vsiIndicator.className = "vsi-badge descent";
      el.vsiIndicator.innerHTML = `<i class="fa-solid fa-arrow-trend-down"></i> <span>${vsi} FPM (Descendo)</span>`;
    } else {
      el.vsiIndicator.className = "vsi-badge neutral";
      el.vsiIndicator.innerHTML = `<i class="fa-solid fa-minus"></i> <span>${vsi} FPM (Nivelado)</span>`;
    }

    // Speed
    const spdKts = tel.speed_kts || 0;
    const spdKmh = tel.speed_kmh || Math.round(spdKts * 1.852);
    el.valSpeed.innerHTML = `${spdKts} <span class="unit">KTS</span>`;
    el.valSpeedKmh.textContent = `${spdKmh} KM/H`;
    el.valMach.textContent = `MACH ${(tel.mach || 0).toFixed(2)}`;

    // Heading & Compass
    const hdg = tel.heading || 0;
    const cardinal = getCardinalDirection(hdg);
    el.valHeading.innerHTML = `${hdg}° <span class="unit">${cardinal}</span>`;
    const pointer = document.querySelector(".compass-pointer");
    if (pointer) {
      pointer.style.transform = `rotate(${hdg}deg)`;
    }

    // Coords & Hex
    el.valCoords.textContent = `${(tel.latitude || 0).toFixed(4)}, ${(tel.longitude || 0).toFixed(4)}`;
    el.valHexCode.textContent = `HEX MODE-S: ${ac.hex || 'E4A125'}`.toUpperCase();

    // ETA
    const etaTimestamp = times.estimated_arrival || times.scheduled_arrival;
    el.valEta.innerHTML = `${formatTimestamp(etaTimestamp)} <span class="unit">BRT</span>`;
    el.valFlightStatusDesc.textContent = isLive ? "Estimativa recalculada via radar" : "Horário previsto em plano";

    // Sidebar Specs
    el.cardRegBadge.textContent = ac.registration || "PR-XBV";
    el.specModel.textContent = ac.model_name || "Airbus A320neo";
    el.specAirline.textContent = data.airline.name || "LATAM Airlines Brasil";
    el.specReg.textContent = ac.registration || "PR-XBV";
    el.specHex.textContent = (ac.hex || "E4A125").toUpperCase();
    el.specTrailCount.textContent = `${(data.trail || []).length} pontos captados`;

    if (ac.photo_url) {
      el.aircraftPhoto.src = ac.photo_url;
      el.photoCopyright.innerHTML = `<i class="fa-solid fa-camera"></i> Foto: ${ac.photo_copyright || 'JetPhotos'}`;
    }

    // Schedule Times
    el.schedDepTime.textContent = formatTimestamp(times.scheduled_departure);
    el.realDepTime.textContent = formatTimestamp(times.real_departure);
    el.schedArrTime.textContent = formatTimestamp(times.scheduled_arrival);
    el.estArrTime.textContent = formatTimestamp(times.estimated_arrival);

    // Update Map & 2D Vertical Elevation Profile (Side-view)
    updateMapDisplay(data);
    drawElevationProfile(data);

    // Audio Ping & Telemetry log if position changed
    if (!state.lastTelemetry || state.lastTelemetry.latitude !== tel.latitude || state.lastTelemetry.longitude !== tel.longitude) {
      playTelemetryPing();
      addLog(`ADS-B: Lat: ${tel.latitude?.toFixed(4)}, Lon: ${tel.longitude?.toFixed(4)} | Alt: ${altFt} ft | Spd: ${spdKts} kts | Hdg: ${hdg}°`);
      state.lastTelemetry = tel;
    }
  }

  function updateMapDisplay(data) {
    if (!state.map) return;

    const tel = data.telemetry || {};
    const lat = tel.latitude;
    const lng = tel.longitude;
    const hdg = tel.heading || 0;

    const origPos = data.route?.origin?.position;
    const destPos = data.route?.destination?.position;

    if (lat && lng && lat !== 0 && lng !== 0) {
      const planePos = [lat, lng];
      state.planeMarker.setLatLng(planePos);

      // Rotate plane marker SVG
      const wrapper = document.getElementById("planeSvgWrapper");
      if (wrapper) {
        wrapper.style.transform = `rotate(${hdg}deg)`;
      }

      // Aircraft Popup
      state.planeMarker.bindPopup(`
        <div style="font-family:'Inter';font-size:12px;color:#000;">
          <b style="color:#005577;">${data.callsign} (${data.flight_number})</b><br>
          <b>Altitude:</b> ${tel.altitude_ft} ft (${tel.altitude_m} m)<br>
          <b>Velocidade:</b> ${tel.speed_kts} kts (${tel.speed_kmh} km/h)<br>
          <b>Proa:</b> ${hdg}° (${getCardinalDirection(hdg)})<br>
          <b>Prefixo:</b> ${data.aircraft?.registration || 'PR-XBV'}
        </div>
      `);

      // Initial framing of origin, destination and aircraft
      if (!state.initialFramed && origPos && destPos && origPos.lat !== 0 && destPos.lat !== 0) {
        state.map.fitBounds([
          [origPos.lat, origPos.lng],
          [destPos.lat, destPos.lng],
          [lat, lng]
        ], { padding: [50, 50], maxZoom: 8 });
        state.initialFramed = true;
      } else if (state.autoCenter) {
        state.map.panTo(planePos, { animate: true, duration: 1.0 });
      }
    }

    // Update Dynamic Airport Pins
    if (origPos && destPos && origPos.lat !== 0 && destPos.lat !== 0) {
      const origIata = data.route?.origin?.iata || "DEP";
      const destIata = data.route?.destination?.iata || "ARR";
      const origCity = data.route?.origin?.city || "Origem";
      const destCity = data.route?.destination?.city || "Destino";

      if (window.createAirportPinIcon) {
        state.originMarker.setIcon(window.createAirportPinIcon(origIata, "#ff5252"));
        state.destMarker.setIcon(window.createAirportPinIcon(destIata, "#00e676"));
      }

      state.originMarker.setLatLng([origPos.lat, origPos.lng]);
      state.originMarker.bindPopup(`<b>Origem:</b> ${origCity} (${origIata})<br>${data.route?.origin?.name || ''}`);

      state.destMarker.setLatLng([destPos.lat, destPos.lng]);
      state.destMarker.bindPopup(`<b>Destino:</b> ${destCity} (${destIata})<br>${data.route?.destination?.name || ''}`);

      state.routeLine.setLatLngs([
        [origPos.lat, origPos.lng],
        [destPos.lat, destPos.lng]
      ]);

      if (!state.initialFramed && (!lat || lat === 0)) {
        state.map.fitBounds([
          [origPos.lat, origPos.lng],
          [destPos.lat, destPos.lng]
        ], { padding: [50, 50], maxZoom: 8 });
        state.initialFramed = true;
      }
    }

    // Update Trail Polyline
    if (state.showTrail && data.trail && data.trail.length > 0) {
      const points = data.trail.map(pt => [pt.lat, pt.lng]);
      state.trailPolyline.setLatLngs(points);
    } else {
      state.trailPolyline.setLatLngs([]);
    }
  }

  // --- 2D ELEVATION PROFILE & VSD (VERTICAL SITUATION DISPLAY) ---
  function drawAirplaneSideView(ctx, x, y, scale = 1.0, pitchDeg = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((pitchDeg * Math.PI) / 180);
    ctx.scale(scale, scale);

    // Pulsing beacon ring
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0, 229, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Fuselage (Body)
    ctx.beginPath();
    ctx.moveTo(24, 0);
    // Nose upper contour
    ctx.bezierCurveTo(20, -4, -14, -5, -22, -3);
    // Vertical Stabilizer (Tail)
    ctx.lineTo(-30, -17);
    ctx.lineTo(-36, -17);
    ctx.lineTo(-30, -1);
    // Tail cone
    ctx.lineTo(-34, 1);
    ctx.lineTo(-32, 3);
    // Underbelly
    ctx.bezierCurveTo(-14, 5, 14, 5, 24, 0);
    ctx.closePath();

    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "rgba(0, 229, 255, 0.8)";
    ctx.shadowBlur = 10;
    ctx.fill();

    // Tail livery accent (LATAM Red)
    ctx.beginPath();
    ctx.moveTo(-25, -2);
    ctx.lineTo(-30, -17);
    ctx.lineTo(-36, -17);
    ctx.lineTo(-32, -4);
    ctx.closePath();
    ctx.fillStyle = "#e11d48";
    ctx.fill();

    // Cockpit window glass
    ctx.beginPath();
    ctx.moveTo(19, -2);
    ctx.lineTo(14, -3);
    ctx.lineTo(14, -1);
    ctx.lineTo(20, 0);
    ctx.closePath();
    ctx.fillStyle = "#0f172a";
    ctx.fill();

    // Turbofan Engine Pod
    ctx.beginPath();
    ctx.ellipse(4, 5, 7, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#64748b";
    ctx.fill();

    // Engine exhaust thrust glow
    ctx.beginPath();
    ctx.ellipse(-3, 5, 2, 2.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#38bdf8";
    ctx.fill();

    // Wing root
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, 3);
    ctx.lineTo(-14, 2);
    ctx.closePath();
    ctx.fillStyle = "#cbd5e1";
    ctx.fill();

    ctx.restore();
  }

  function getTerrainElevationAt(km, totalKm, origElev = 0, destElev = 0) {
    const ratio = Math.max(0, Math.min(1, km / (totalKm || 1)));
    // Procedural terrain interpolating smoothly between origElev and destElev
    const baseElev = origElev * (1 - ratio) + destElev * ratio;
    // Add sinusoidal topography variation damped at both terminal areas
    const damping = Math.sin(ratio * Math.PI);
    const hillVariation = (Math.sin(ratio * 14) * 260 + Math.cos(ratio * 26) * 130) * damping;
    return Math.max(10, Math.round(baseElev + hillVariation));
  }

  function drawElevationProfile(data) {
    if (!el.elevationCanvas) return;
    const canvas = el.elevationCanvas;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    // Margins (generous left margin so FL labels are never truncated)
    const pLeft = 90;
    const pRight = 45;
    const pTop = 32;
    const pBottom = 34;
    const plotW = W - pLeft - pRight;
    const plotH = H - pTop - pBottom;

    const maxAlt = 42000; // FL420 ceiling
    const totalDist = data.route?.distance_total_km || 1000;
    const origElev = data.route?.origin?.position?.altitude || 0;
    const destElev = data.route?.destination?.position?.altitude || 0;
    const origIata = data.route?.origin?.iata || "DEP";
    const destIata = data.route?.destination?.iata || "ARR";

    const tel = data.telemetry || {};
    const curAlt = tel.altitude_ft || 0;
    const curDist = data.route?.distance_flown_km || 0;
    const vsi = tel.vertical_speed_fpm || 0;

    // Update VSD header badges
    if (el.vsdFlightLevel) {
      el.vsdFlightLevel.textContent = curAlt > 0 ? `FL${Math.round(curAlt / 100)}` : "FL000";
    }
    if (el.vsdAltText) {
      el.vsdAltText.textContent = `${curAlt.toLocaleString("pt-BR")} FT`;
    }
    if (el.vsdVsiText) {
      el.vsdVsiText.textContent = `${vsi > 0 ? "+" : ""}${vsi} FPM`;
      el.vsdVsiText.className = `vsd-badge ${vsi > 150 ? "green" : (vsi < -150 ? "amber" : "")}`;
    }

    const toX = (km) => pLeft + Math.min(plotW, Math.max(0, (km / totalDist) * plotW));
    const toY = (alt) => pTop + plotH - Math.min(plotH, Math.max(0, (alt / maxAlt) * plotH));

    // Clear background
    ctx.clearRect(0, 0, W, H);

    // Sky background subtle gradient
    const skyGrad = ctx.createLinearGradient(0, pTop, 0, pTop + plotH);
    skyGrad.addColorStop(0, "rgba(8, 17, 36, 0.95)");
    skyGrad.addColorStop(1, "rgba(5, 10, 22, 0.98)");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(pLeft, pTop, plotW, plotH);

    // Grid lines for Flight Levels
    if (state.showProfileGrid) {
      const flightLevels = [
        { alt: 40000, label: "FL400 (40k)" },
        { alt: 30000, label: "FL300 (30k)" },
        { alt: 20000, label: "FL200 (20k)" },
        { alt: 10000, label: "FL100 (10k)", limit: true },
        { alt: 5000,  label: "FL050 (5k)"  },
        { alt: 0,      label: "0 FT (MSL)" }
      ];

      ctx.font = "9.5px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      flightLevels.forEach(fl => {
        const y = toY(fl.alt);
        ctx.beginPath();
        ctx.moveTo(pLeft, y);
        ctx.lineTo(pLeft + plotW, y);
        
        if (fl.limit) {
          ctx.strokeStyle = "rgba(255, 179, 0, 0.35)"; // Amber dashed line for 250 kts restriction
          ctx.setLineDash([4, 4]);
        } else {
          ctx.strokeStyle = "rgba(0, 229, 255, 0.12)";
          ctx.setLineDash([2, 5]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Label with proper spacing from the grid line
        ctx.fillStyle = fl.limit ? "rgba(255, 179, 0, 0.85)" : "rgba(139, 155, 180, 0.75)";
        ctx.fillText(fl.label, pLeft - 10, y);
      });

      // Distance markers along bottom
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "rgba(139, 155, 180, 0.65)";
      const dQuarter = Math.round(totalDist / 4);
      const distSteps = [0, dQuarter, dQuarter * 2, dQuarter * 3, Math.round(totalDist)];
      distSteps.forEach(dist => {
        const x = toX(dist);
        ctx.beginPath();
        ctx.moveTo(x, pTop + plotH);
        ctx.lineTo(x, pTop + plotH + 5);
        ctx.strokeStyle = "rgba(0, 229, 255, 0.25)";
        ctx.stroke();
        ctx.fillText(`${dist} km`, x, pTop + plotH + 8);
      });
    }

    // --- DRAW TERRAIN PROFILE ---
    ctx.beginPath();
    ctx.moveTo(pLeft, pTop + plotH); // Bottom left

    const numTerrainSteps = 60;
    for (let i = 0; i <= numTerrainSteps; i++) {
      const km = (i / numTerrainSteps) * totalDist;
      const elev = getTerrainElevationAt(km, totalDist, origElev, destElev);
      ctx.lineTo(toX(km), toY(elev));
    }
    ctx.lineTo(pLeft + plotW, pTop + plotH); // Bottom right
    ctx.closePath();

    const terrainGrad = ctx.createLinearGradient(0, toY(3500), 0, pTop + plotH);
    terrainGrad.addColorStop(0, "rgba(24, 35, 54, 0.95)");
    terrainGrad.addColorStop(1, "rgba(10, 15, 26, 0.98)");
    ctx.fillStyle = terrainGrad;
    ctx.fill();

    ctx.strokeStyle = "rgba(71, 85, 105, 0.8)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Airport Runway Bars & Labels
    const origX = toX(0);
    const origY = toY(origElev);
    ctx.fillStyle = "#ff5252";
    ctx.fillRect(origX, origY - 3, 26, 5);
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#ff7b7b";
    ctx.textAlign = "left";
    ctx.fillText(`${origIata} • ${origElev.toLocaleString('pt-BR')} FT`, origX + 2, origY + 16);

    const destX = toX(totalDist);
    const destY = toY(destElev);
    ctx.fillStyle = "#00e676";
    ctx.fillRect(destX - 26, destY - 3, 26, 5);
    ctx.fillStyle = "#69f0ae";
    ctx.textAlign = "right";
    ctx.fillText(`${destIata} • ${destElev.toLocaleString('pt-BR')} FT`, destX - 2, destY + 16);

    // --- PREPARE & CLAMP FLIGHT TRAIL ---
    // Clamping: when taxiing on ground at BSB, transponder reports 0 ft, but true MSL altitude is 3,479 ft
    const validTrail = [];
    validTrail.push({ dist_km: 0, alt: origElev });

    const rawTrail = data.trail || [];
    rawTrail.forEach(pt => {
      const d = pt.dist_km !== undefined ? pt.dist_km : 0;
      let a = pt.alt || 0;
      // Clamp ground taxi points to airport elevation
      if (a < origElev && d < 35) {
        a = origElev;
      }
      if (d > 0.05 || validTrail.length === 1) {
        validTrail.push({ dist_km: d, alt: Math.max(origElev, a) });
      }
    });

    if (curDist > 0 && curAlt > 0) {
      validTrail.push({ dist_km: curDist, alt: curAlt });
    }

    // --- DRAW TRAIL FLOWN (REAL ADS-B COORDINATES) ---
    if (validTrail.length > 1) {
      // 1. Area fill under flown path (fills strictly down to terrain, not sea level)
      ctx.beginPath();
      ctx.moveTo(toX(validTrail[0].dist_km), toY(validTrail[0].alt));
      for (let i = 1; i < validTrail.length; i++) {
        ctx.lineTo(toX(validTrail[i].dist_km), toY(validTrail[i].alt));
      }
      // Down to terrain at current aircraft position
      const curTerrain = getTerrainElevationAt(curDist, totalDist, origElev, destElev);
      ctx.lineTo(toX(curDist), toY(curTerrain));

      // Trace terrain backwards to origin
      const returnSteps = 24;
      for (let i = returnSteps; i >= 0; i--) {
        const km = (i / returnSteps) * curDist;
        ctx.lineTo(toX(km), toY(getTerrainElevationAt(km, totalDist, origElev, destElev)));
      }
      ctx.closePath();

      const pathGrad = ctx.createLinearGradient(0, toY(curAlt), 0, toY(origElev));
      pathGrad.addColorStop(0, "rgba(0, 229, 255, 0.22)");
      pathGrad.addColorStop(1, "rgba(0, 229, 255, 0.01)");
      ctx.fillStyle = pathGrad;
      ctx.fill();

      // 2. Stroke glowing cyan path
      ctx.beginPath();
      ctx.moveTo(toX(validTrail[0].dist_km), toY(validTrail[0].alt));
      for (let i = 1; i < validTrail.length; i++) {
        ctx.lineTo(toX(validTrail[i].dist_km), toY(validTrail[i].alt));
      }
      ctx.save();
      ctx.strokeStyle = "#00e5ff";
      ctx.lineWidth = 2.8;
      ctx.shadowColor = "rgba(0, 229, 255, 0.9)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.restore();
    }

    // --- DRAW PROJECTED DESCENT PROFILE ---
    if (curDist < totalDist) {
      const planeX = toX(curDist);
      const planeY = toY(curAlt > 0 ? curAlt : origElev);
      const destX = toX(totalDist);
      const destY = toY(destElev);

      // Top of Descent (TOD): approx ~180-220 km before destination
      const descentDistKm = Math.min(260, (curAlt / 1000) * 5.8);
      const todDistKm = Math.max(curDist, totalDist - descentDistKm);
      const todX = toX(todDistKm);

      ctx.beginPath();
      ctx.moveTo(planeX, planeY);
      // Cruise level until TOD
      ctx.lineTo(todX, planeY);
      // Smooth descent slope to FOR runway
      ctx.bezierCurveTo(todX + (destX - todX) * 0.4, planeY, destX - 40, destY + 20, destX, destY);

      ctx.save();
      ctx.strokeStyle = "rgba(0, 229, 255, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.restore();

      // Top of descent marker tag
      if (todDistKm > curDist + 40 && todDistKm < totalDist - 40) {
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.fillStyle = "rgba(0, 229, 255, 0.8)";
        ctx.textAlign = "center";
        ctx.fillText("TOD (Descida)", todX, planeY - 12);
        ctx.beginPath();
        ctx.arc(todX, planeY, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#00e5ff";
      }
    }

    // --- DRAW AIRCRAFT SIDE-VIEW SILHOUETTE ---
    const planeScreenX = toX(curDist);
    const planeScreenY = toY(curAlt > 0 ? curAlt : origElev);

    // Calculate pitch angle: subindo (+4°), descendo (-3°), nivelado (0°)
    let pitch = 0;
    if (vsi > 300) pitch = -4; // In screen space, negative rotation is nose-up!
    else if (vsi < -300) pitch = 3; // positive rotation is nose-down

    drawAirplaneSideView(ctx, planeScreenX, planeScreenY, 0.95, pitch);

    // Airplane floating HUD Tag
    ctx.save();
    const tagText = `FL${Math.round(curAlt / 100)} (${curAlt.toLocaleString('pt-BR')} FT)`;
    ctx.font = "bold 10px 'JetBrains Mono', monospace";
    const textWidth = ctx.measureText(tagText).width;
    const boxW = textWidth + 14;
    const boxH = 20;
    const boxX = Math.min(W - pRight - boxW, Math.max(pLeft, planeScreenX - boxW / 2));
    const boxY = Math.max(pTop + 5, planeScreenY - 36);

    ctx.fillStyle = "rgba(8, 14, 28, 0.85)";
    ctx.strokeStyle = "#00e5ff";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(tagText, boxX + boxW / 2, boxY + boxH / 2);
    ctx.restore();

    // --- MOUSE HOVER CROSSHAIR ---
    if (state.mouseHoverPos) {
      const mx = state.mouseHoverPos.x;
      if (mx >= pLeft && mx <= pLeft + plotW) {
        ctx.beginPath();
        ctx.moveTo(mx, pTop);
        ctx.lineTo(mx, pTop + plotH);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  // --- CONTROLLER FOR TRACKED FLIGHT & URL SYNC ---
  function updateActiveChips(flightCode) {
    el.chips.forEach(chip => {
      chip.classList.toggle("active", chip.getAttribute("data-flight") === flightCode);
    });
  }

  function setTrackedFlight(flightCode) {
    if (!flightCode) return;
    const clean = flightCode.trim().toUpperCase();
    state.currentFlight = clean;
    if (el.flightInput) el.flightInput.value = clean;
    updateActiveChips(clean);

    // Update browser URL query parameter without full reload
    try {
      const url = new URL(window.location);
      url.searchParams.set("flight", clean);
      window.history.replaceState({}, "", url);
    } catch (e) {
      console.warn("Could not replace history state:", e);
    }

    state.initialFramed = false;
    addLog(`Rastreando voo: ${clean}`, "system");
    fetchFlightData();
  }

  // --- EVENT LISTENERS ---
  el.btnSearch.addEventListener("click", () => {
    setTrackedFlight(el.flightInput.value);
  });

  el.flightInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      setTrackedFlight(el.flightInput.value);
    }
  });

  el.chips.forEach(chip => {
    chip.addEventListener("click", () => {
      setTrackedFlight(chip.getAttribute("data-flight"));
    });
  });

  // Alert banner suggested links
  document.querySelectorAll(".alert-link").forEach(link => {
    link.addEventListener("click", () => {
      setTrackedFlight(link.getAttribute("data-flight"));
    });
  });

  el.btnRefresh.addEventListener("click", () => {
    fetchFlightData();
  });

  el.btnAudioToggle.addEventListener("click", () => {
    state.audioEnabled = !state.audioEnabled;
    el.btnAudioToggle.classList.toggle("active", state.audioEnabled);
    el.btnAudioToggle.innerHTML = state.audioEnabled ? 
      '<i class="fa-solid fa-volume-high"></i>' : 
      '<i class="fa-solid fa-volume-xmark"></i>';
    if (state.audioEnabled) playTelemetryPing();
  });

  el.btnRecenter.addEventListener("click", () => {
    state.autoCenter = true;
    el.btnRecenter.classList.add("active");
    if (state.lastTelemetry && state.lastTelemetry.latitude) {
      state.map.setView([state.lastTelemetry.latitude, state.lastTelemetry.longitude], 8, { animate: true });
    }
  });

  el.btnToggleTrail.addEventListener("click", () => {
    state.showTrail = !state.showTrail;
    el.btnToggleTrail.classList.toggle("active", state.showTrail);
    if (state.cachedData) {
      updateMapDisplay(state.cachedData);
    }
  });

  el.btnMapStyle.addEventListener("click", () => {
    if (state.mapStyle === "dark") {
      state.map.removeLayer(state.tileLayerDark);
      state.tileLayerOsm.addTo(state.map);
      state.mapStyle = "osm";
      el.btnMapStyle.classList.add("active");
    } else {
      state.map.removeLayer(state.tileLayerOsm);
      state.tileLayerDark.addTo(state.map);
      state.mapStyle = "dark";
      el.btnMapStyle.classList.remove("active");
    }
  });

  // Modal JSON
  el.btnRawData.addEventListener("click", () => {
    if (state.cachedData) {
      el.jsonViewer.textContent = JSON.stringify(state.cachedData, null, 2);
    } else {
      el.jsonViewer.textContent = "Nenhum dado capturado ainda.";
    }
    el.rawModal.classList.add("open");
  });

  el.btnCloseModal.addEventListener("click", () => {
    el.rawModal.classList.remove("open");
  });

  el.rawModal.addEventListener("click", (e) => {
    if (e.target === el.rawModal) {
      el.rawModal.classList.remove("open");
    }
  });

  el.btnCopyJson.addEventListener("click", () => {
    if (state.cachedData) {
      navigator.clipboard.writeText(JSON.stringify(state.cachedData, null, 2))
        .then(() => {
          el.btnCopyJson.innerHTML = '<i class="fa-solid fa-check"></i> Copiado!';
          setTimeout(() => {
            el.btnCopyJson.innerHTML = '<i class="fa-solid fa-copy"></i> Copiar JSON';
          }, 2000);
        });
    }
  });

  // 2D Elevation Profile Listeners
  if (el.btnToggleProfileGrid) {
    el.btnToggleProfileGrid.addEventListener("click", () => {
      state.showProfileGrid = !state.showProfileGrid;
      el.btnToggleProfileGrid.classList.toggle("active", state.showProfileGrid);
      if (state.cachedData) drawElevationProfile(state.cachedData);
    });
  }

  if (el.elevationCanvas) {
    el.elevationCanvas.addEventListener("mousemove", (e) => {
      const rect = el.elevationCanvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      state.mouseHoverPos = { x, y };

      const pLeft = 90;
      const pRight = 45;
      const plotW = rect.width - pLeft - pRight;
      const totalDist = state.cachedData?.route?.distance_total_km || 1000;
      const origElev = state.cachedData?.route?.origin?.position?.altitude || 0;
      const destElev = state.cachedData?.route?.destination?.position?.altitude || 0;
      const origIata = state.cachedData?.route?.origin?.iata || "Origem";
      const destIata = state.cachedData?.route?.destination?.iata || "Destino";

      if (x >= pLeft && x <= pLeft + plotW) {
        const km = ((x - pLeft) / plotW) * totalDist;
        const elev = getTerrainElevationAt(km, totalDist, origElev, destElev);
        const remainingKm = Math.max(0, totalDist - km);

        el.vsdTooltip.style.left = `${Math.min(rect.width - 160, Math.max(10, x + 15))}px`;
        el.vsdTooltip.style.top = `${Math.max(10, y - 40)}px`;
        el.vsdTooltip.innerHTML = `
          <div>Distância ${origIata}: <strong>${km.toFixed(1)} km</strong></div>
          <div>Restante ${destIata}: <strong>${remainingKm.toFixed(1)} km</strong></div>
          <div>Elevação Terreno: <strong>${Math.round(elev)} ft</strong></div>
        `;
        el.vsdTooltip.classList.add("show");
      } else {
        el.vsdTooltip.classList.remove("show");
      }

      if (state.cachedData) drawElevationProfile(state.cachedData);
    });

    el.elevationCanvas.addEventListener("mouseleave", () => {
      state.mouseHoverPos = null;
      el.vsdTooltip.classList.remove("show");
      if (state.cachedData) drawElevationProfile(state.cachedData);
    });
  }

  window.addEventListener("resize", () => {
    if (state.cachedData) {
      drawElevationProfile(state.cachedData);
    }
  });

  // Initialize from URL parameter or default
  const urlParams = new URLSearchParams(window.location.search);
  const initialFlight = (urlParams.get("flight") || "TAM3734").toUpperCase();
  state.currentFlight = initialFlight;
  if (el.flightInput) el.flightInput.value = initialFlight;
  updateActiveChips(initialFlight);

  // Start polling
  initMap();
  fetchFlightData();
  state.pollTimer = setInterval(fetchFlightData, state.pollingInterval);
});
