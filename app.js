// Initialization Constants & State
const SINGAPORE_BOUNDS = { lamin: 0.5, lomin: 103.0, lamax: 2.0, lomax: 105.0 };

let map;
let airLayer, seaLayer;
let currentBaseMap;
let airMarkers = {};
let seaMarkers = {};
let airUpdateInterval;
let aisWebSocket;
let useMockSeaData = true;
let mockSeaInterval;
let isAirVisible = true;
let isSeaVisible = true;

// Map Providers
const baseMaps = {
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, detectRetina: true }),
    light: L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, detectRetina: true }),
    street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, detectRetina: true }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, detectRetina: true })
};

// SVGs for markers
const SVG_AIRPLANE = `<svg viewBox="0 0 24 24" width="22" height="22" style="transform: rotate({heading}deg); drop-shadow(0px 2px 3px rgba(0,0,0,0.5));"><path fill="#3b82f6" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round" d="M21,16V14L13,9V3.5C13,2.67 12.33,2 11.5,2C10.67,2 10,2.67 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z"/></svg>`;
const SVG_SHIP = `<svg viewBox="0 0 24 24" width="20" height="20" style="transform: rotate({heading}deg); drop-shadow(0px 2px 3px rgba(0,0,0,0.5));"><path fill="#f59e0b" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round" d="M20,21C18.61,21 17.22,20.53 16.16,19.56C14.03,17.63 10.76,17.63 8.63,19.56C7.57,20.53 6.18,21 4.79,21H3V19C4.39,19 5.78,18.53 6.84,17.56C8.97,15.63 12.24,15.63 14.37,17.56C15.43,18.53 16.82,19 18.21,19H20V21M20,17H18.21C16.82,17 15.43,16.53 14.37,15.56C12.24,13.63 8.97,13.63 6.84,15.56C5.78,16.53 4.39,17 3,17H2V10L9,13V6H11V14L15,12V8H17V11L22,9V17H20Z"/></svg>`;

// HUD / UI Logic
function showToast(message, type = "info") {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let iconHTML = type === "success" ? `✅` : type === "error" ? `⚠️` : `ℹ️`;
    toast.innerHTML = `<span>${iconHTML}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "fadeOutRight 0.3s forwards";
        setTimeout(() => { if(container.contains(toast)) container.removeChild(toast); }, 300);
    }, 3000);
}

function updateStatus(type, state, message) {
    // Update Dock Dot
    const dot = document.getElementById(`${type}-status-dot`);
    dot.className = "status-dot";
    if(state === "warning") dot.classList.add("warning");
    if(state === "error") dot.classList.add("error");
    
    // Update Detailed Settings Text
    const txt = document.getElementById(`${type}-status-text`);
    txt.innerText = message;
    txt.className = `status-${state}`;
}

function setDockCount(type, count) {
    document.getElementById(`${type}-count`).innerText = count;
}

// Modal Logic
function openModal(id) {
    document.getElementById(id).classList.add('show');
}
function closeModals() {
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('show'));
}

document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', closeModals);
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if(e.target === overlay) closeModals();
    });
});

document.getElementById('btn-layers').addEventListener('click', () => openModal('modal-layers'));
document.getElementById('btn-settings').addEventListener('click', () => openModal('modal-settings'));

// Toggles Logic
document.getElementById('btn-toggle-air').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    isAirVisible = !isAirVisible;
    if(isAirVisible) {
        map.addLayer(airLayer);
        btn.classList.add('active');
        showToast("Air tracking ON", "info");
    } else {
        map.removeLayer(airLayer);
        btn.classList.remove('active');
    }
});

document.getElementById('btn-toggle-sea').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    isSeaVisible = !isSeaVisible;
    if(isSeaVisible) {
        map.addLayer(seaLayer);
        btn.classList.add('active');
        showToast("Sea tracking ON", "info");
    } else {
        map.removeLayer(seaLayer);
        btn.classList.remove('active');
    }
});

// Map Layer Selector Logic
document.querySelectorAll('.layer-option').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.layer-option').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        
        const style = e.target.getAttribute('data-style');
        if (baseMaps[style]) {
            map.removeLayer(currentBaseMap);
            currentBaseMap = baseMaps[style];
            currentBaseMap.addTo(map);
            localStorage.setItem('preferredBaseMap', style);
        }
        closeModals();
    });
});

// Initialize Map
function initMap() {
    map = L.map('map', { center: [1.290270, 103.851959], zoom: 10, zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const savedStyle = localStorage.getItem('preferredBaseMap') || 'dark';
    
    // Update modal UI selection
    document.querySelectorAll('.layer-option').forEach(b => b.classList.remove('active'));
    document.querySelector(`.layer-option[data-style="${savedStyle}"]`).classList.add('active');

    currentBaseMap = baseMaps[savedStyle];
    currentBaseMap.addTo(map);

    airLayer = L.layerGroup().addTo(map);
    seaLayer = L.layerGroup().addTo(map);
}

// Marker Logic
function updateMarker(id, lat, lon, heading, type, popupContent, markersObj, layer) {
    if (!lat || !lon) return;
    const safeHeading = heading || 0;
    
    if (markersObj[id]) {
        markersObj[id].setLatLng([lat, lon]);
        const svgHTML = type === 'air' ? SVG_AIRPLANE : SVG_SHIP;
        markersObj[id].setIcon(L.divIcon({
            className: 'custom-marker',
            html: svgHTML.replace('{heading}', safeHeading),
            iconSize: [24, 24], iconAnchor: [12, 12]
        }));
        markersObj[id].getPopup().setContent(popupContent);
        markersObj[id].lastSeen = Date.now();
    } else {
        const svgHTML = type === 'air' ? SVG_AIRPLANE : SVG_SHIP;
        const icon = L.divIcon({
            className: 'custom-marker',
            html: svgHTML.replace('{heading}', safeHeading),
            iconSize: [24, 24], iconAnchor: [12, 12]
        });
        const marker = L.marker([lat, lon], { icon }).bindPopup(popupContent);
        marker.lastSeen = Date.now();
        marker.addTo(layer);
        markersObj[id] = marker;
    }
}

function cleanupStaleMarkers() {
    const now = Date.now();
    for (const id in airMarkers) {
        if (now - airMarkers[id].lastSeen > 60000) {
            airLayer.removeLayer(airMarkers[id]);
            delete airMarkers[id];
        }
    }
    for (const id in seaMarkers) {
        if (now - seaMarkers[id].lastSeen > 300000) {
            seaLayer.removeLayer(seaMarkers[id]);
            delete seaMarkers[id];
        }
    }
    setDockCount('air', Object.keys(airMarkers).length);
    setDockCount('sea', Object.keys(seaMarkers).length);
}

// API Calls (Air)
async function fetchAirTraffic() {
    try {
        updateStatus('air', 'warning', 'Fetching live data...');
        const url = `https://opensky-network.org/api/states/all?lamin=${SINGAPORE_BOUNDS.lamin}&lomin=${SINGAPORE_BOUNDS.lomin}&lamax=${SINGAPORE_BOUNDS.lamax}&lomax=${SINGAPORE_BOUNDS.lomax}`;
        const response = await fetch(url);
        
        if (!response.ok) throw new Error(response.status === 429 ? "Rate Limited (429)" : `HTTP ${response.status}`);
        
        const data = await response.json();
        if (data && data.states) {
            data.states.forEach(state => {
                const icao24 = state[0];
                const callsign = state[1] ? state[1].trim() : "UNKNOWN";
                const popupStr = `<h4>Flight ${callsign}</h4><p><strong>Origin:</strong> ${state[2]}</p><p><strong>Alt:</strong> ${state[7] !== null ? state[7]+"m" : "N/A"}</p>`;
                updateMarker(icao24, state[6], state[5], state[10] || 0, 'air', popupStr, airMarkers, airLayer);
            });
        }
        updateStatus('air', 'success', 'Live Connected via OpenSky');
    } catch (error) {
        updateStatus('air', 'error', `Error: ${error.message}`);
    }
    setDockCount('air', Object.keys(airMarkers).length);
}

// API Calls (Sea)
function startMockSeaData() {
    useMockSeaData = true;
    updateStatus('sea', 'warning', 'Using Mock Data (No Key)');
    const mockVessels = [
        { id: 'MOCK1', lat: 1.25, lon: 103.75, hdg: 45, name: 'EVER GIVEN' },
        { id: 'MOCK2', lat: 1.15, lon: 103.95, hdg: 110, name: 'SEASPAN RELIANCE' },
        { id: 'MOCK3', lat: 1.30, lon: 104.05, hdg: 310, name: 'MAERSK MC-KINNEY' }
    ];

    mockSeaInterval = setInterval(() => {
        if(!useMockSeaData) { clearInterval(mockSeaInterval); return; }
        mockVessels.forEach(v => {
            v.lat += Math.cos(v.hdg * (Math.PI / 180)) * 0.0005;
            v.lon += Math.sin(v.hdg * (Math.PI / 180)) * 0.0005;
            if(v.lat > 2.0 || v.lat < 0.5 || v.lon > 105.0 || v.lon < 103.0) v.hdg = (v.hdg + 180) % 360; 
            const popupStr = `<h4>${v.name} (Mock)</h4><p>Heading: ${v.hdg}&deg;</p>`;
            updateMarker(v.id, v.lat, v.lon, v.hdg, 'sea', popupStr, seaMarkers, seaLayer);
        });
        setDockCount('sea', Object.keys(seaMarkers).length);
    }, 2000);
}

function connectLiveSeaData(apiKey) {
    if (aisWebSocket) aisWebSocket.close();
    useMockSeaData = false;
    if(mockSeaInterval) clearInterval(mockSeaInterval);
    for (const id in seaMarkers) seaLayer.removeLayer(seaMarkers[id]);
    seaMarkers = {};

    updateStatus('sea', 'warning', 'Connecting to WS...');
    aisWebSocket = new WebSocket("wss://stream.aisstream.io/v0/stream");

    aisWebSocket.onopen = () => {
        updateStatus('sea', 'success', 'Live Connected via AISStream');
        showToast("AIS WebSocket Connected", "success");
        document.getElementById('btn-connect-ais').innerText = "Connected";
        document.getElementById('btn-connect-ais').style.backgroundColor = "var(--accent-green)";

        aisWebSocket.send(JSON.stringify({
            APIKey: apiKey,
            BoundingBoxes: [[[SINGAPORE_BOUNDS.lamin, SINGAPORE_BOUNDS.lomin], [SINGAPORE_BOUNDS.lamax, SINGAPORE_BOUNDS.lomax]]],
            FilterMessageTypes: ["PositionReport"]
        }));
    };

    aisWebSocket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.MessageType === "PositionReport" && msg.Message.PositionReport) {
                const r = msg.Message.PositionReport;
                const hdg = r.TrueHeading !== 511 ? r.TrueHeading : (r.Cog || 0); 
                const popupStr = `<h4>${msg.MetaData.ShipName ? msg.MetaData.ShipName.trim() : "UNKNOWN"}</h4><p>MMSI: ${msg.MetaData.MMSI}</p><p>Speed: ${r.Sog} kts</p>`;
                updateMarker(msg.MetaData.MMSI, r.Latitude, r.Longitude, hdg, 'sea', popupStr, seaMarkers, seaLayer);
                setDockCount('sea', Object.keys(seaMarkers).length);
            }
        } catch(e) {}
    };

    aisWebSocket.onerror = () => {
        updateStatus('sea', 'error', 'WebSocket Error');
        document.getElementById('btn-connect-ais').innerText = "Retry";
        document.getElementById('btn-connect-ais').style.backgroundColor = "var(--accent-red)";
    };

    aisWebSocket.onclose = () => {
        if (!useMockSeaData) {
            updateStatus('sea', 'error', 'Disconnected. Retrying...');
            setTimeout(() => connectLiveSeaData(apiKey), 5000);
        }
    };
}

document.getElementById('btn-connect-ais').addEventListener('click', () => {
    const key = document.getElementById('ais-key').value.trim();
    if (key) {
        localStorage.setItem('aisKey', key);
        connectLiveSeaData(key);
    } else {
        showToast("Please enter an API Key.", "error");
        startMockSeaData();
        const btn = document.getElementById('btn-connect-ais');
        btn.innerText = "Connect";
        btn.style.backgroundColor = "var(--accent-blue)";
    }
});

// Bootstrap
window.onload = () => {
    initMap();
    fetchAirTraffic();
    airUpdateInterval = setInterval(fetchAirTraffic, 30000);

    const savedKey = localStorage.getItem('aisKey');
    if (savedKey) {
        document.getElementById('ais-key').value = savedKey;
        connectLiveSeaData(savedKey);
    } else {
        startMockSeaData();
    }
    
    setInterval(cleanupStaleMarkers, 10000);
};