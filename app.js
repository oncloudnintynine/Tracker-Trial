// Initialization Constants & State
const SINGAPORE_BOUNDS = {
    lamin: 0.5,
    lomin: 103.0,
    lamax: 2.0,
    lomax: 105.0
};

let map;
let airLayer, seaLayer;
let airMarkers = {};
let seaMarkers = {};
let airUpdateInterval;
let aisWebSocket;
let useMockSeaData = true;
let mockSeaInterval;

// SVGs for markers
const SVG_AIRPLANE = `<svg viewBox="0 0 24 24" width="24" height="24" style="transform: rotate({heading}deg); drop-shadow(1px 1px 2px rgba(0,0,0,0.5));"><path fill="#4db8ff" stroke="#ffffff" stroke-width="1" d="M21,16V14L13,9V3.5C13,2.67 12.33,2 11.5,2C10.67,2 10,2.67 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z"/></svg>`;
const SVG_SHIP = `<svg viewBox="0 0 24 24" width="20" height="20" style="transform: rotate({heading}deg); drop-shadow(1px 1px 2px rgba(0,0,0,0.5));"><path fill="#ff6b6b" stroke="#ffffff" stroke-width="1" d="M20,21C18.61,21 17.22,20.53 16.16,19.56C14.03,17.63 10.76,17.63 8.63,19.56C7.57,20.53 6.18,21 4.79,21H3V19C4.39,19 5.78,18.53 6.84,17.56C8.97,15.63 12.24,15.63 14.37,17.56C15.43,18.53 16.82,19 18.21,19H20V21M20,17H18.21C16.82,17 15.43,16.53 14.37,15.56C12.24,13.63 8.97,13.63 6.84,15.56C5.78,16.53 4.39,17 3,17H2V10L9,13V6H11V14L15,12V8H17V11L22,9V17H20Z"/></svg>`;

// Initialize Map
function initMap() {
    map = L.map('map').setView([1.290270, 103.851959], 9); // Centered around Singapore

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    airLayer = L.layerGroup().addTo(map);
    seaLayer = L.layerGroup().addTo(map);
}

// Map Controls Toggles
document.getElementById('toggle-air').addEventListener('change', (e) => {
    if(e.target.checked) map.addLayer(airLayer);
    else map.removeLayer(airLayer);
});

document.getElementById('toggle-sea').addEventListener('change', (e) => {
    if(e.target.checked) map.addLayer(seaLayer);
    else map.removeLayer(seaLayer);
});

// Create/Update Marker Helper
function updateMarker(id, lat, lon, heading, type, popupContent, markersObj, layer) {
    if (!lat || !lon) return;
    
    // Normalize heading to ensure it behaves correctly visually
    const safeHeading = heading || 0;
    
    if (markersObj[id]) {
        markersObj[id].setLatLng([lat, lon]);
        
        // Update rotation inside the custom div icon HTML
        const svgHTML = type === 'air' ? SVG_AIRPLANE : SVG_SHIP;
        const rotatedHTML = svgHTML.replace('{heading}', safeHeading);
        markersObj[id].setIcon(L.divIcon({
            className: 'custom-marker',
            html: rotatedHTML,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        }));
        markersObj[id].getPopup().setContent(popupContent);
        markersObj[id].lastSeen = Date.now();
    } else {
        const svgHTML = type === 'air' ? SVG_AIRPLANE : SVG_SHIP;
        const rotatedHTML = svgHTML.replace('{heading}', safeHeading);
        
        const icon = L.divIcon({
            className: 'custom-marker',
            html: rotatedHTML,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        const marker = L.marker([lat, lon], { icon }).bindPopup(popupContent);
        marker.lastSeen = Date.now();
        marker.addTo(layer);
        markersObj[id] = marker;
    }
}

// Clear Stale Markers 
function cleanupStaleMarkers() {
    const now = Date.now();
    // 60 seconds for air, 5 mins for sea
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
    
    document.getElementById('air-count').innerText = Object.keys(airMarkers).length;
    document.getElementById('sea-count').innerText = Object.keys(seaMarkers).length;
}

// ---------------------------------------------
// AIR TRACKS: OpenSky Network (REST API)
// ---------------------------------------------
async function fetchAirTraffic() {
    const statusEl = document.getElementById('air-status');
    try {
        statusEl.innerText = "Status: Fetching...";
        statusEl.style.color = "#ffcc00";

        const url = `https://opensky-network.org/api/states/all?lamin=${SINGAPORE_BOUNDS.lamin}&lomin=${SINGAPORE_BOUNDS.lomin}&lamax=${SINGAPORE_BOUNDS.lamax}&lomax=${SINGAPORE_BOUNDS.lomax}`;
        const response = await fetch(url);
        
        if (!response.ok) {
            if (response.status === 429) throw new Error("Rate Limited by OpenSky");
            throw new Error(`HTTP Error ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data && data.states) {
            data.states.forEach(state => {
                const icao24 = state[0];
                const callsign = state[1] ? state[1].trim() : "UNKNOWN";
                const origin = state[2];
                const lon = state[5];
                const lat = state[6];
                const alt = state[7] !== null ? state[7] + "m" : "N/A";
                const velocity = state[9] !== null ? (state[9] * 3.6).toFixed(0) + " km/h" : "N/A";
                const true_track = state[10] !== null ? state[10] : 0; // heading
                
                const popupStr = `
                    <h4>Flight ${callsign}</h4>
                    <p><strong>ICAO:</strong> ${icao24}</p>
                    <p><strong>Origin:</strong> ${origin}</p>
                    <p><strong>Altitude:</strong> ${alt}</p>
                    <p><strong>Speed:</strong> ${velocity}</p>
                `;

                updateMarker(icao24, lat, lon, true_track, 'air', popupStr, airMarkers, airLayer);
            });
        }
        
        statusEl.innerText = "Status: Connected (Live)";
        statusEl.style.color = "#4caf50";
    } catch (error) {
        console.error("OpenSky fetch error:", error);
        statusEl.innerText = `Status: Error (${error.message})`;
        statusEl.style.color = "#ff6b6b";
    }
    
    document.getElementById('air-count').innerText = Object.keys(airMarkers).length;
}

// ---------------------------------------------
// SEA TRACKS: Mock Data & AISStream (WebSocket)
// ---------------------------------------------

// Generate some fake ships to demonstrate UI if no API key is provided
function startMockSeaData() {
    useMockSeaData = true;
    document.getElementById('sea-status').innerText = "Status: Using Mock Data (No API Key)";
    document.getElementById('sea-status').style.color = "#ffcc00";

    // Initial mock ships
    const mockVessels = [
        { id: 'MOCK1', lat: 1.25, lon: 103.75, hdg: 45, name: 'EVER GIVEN', type: 'Cargo' },
        { id: 'MOCK2', lat: 1.15, lon: 103.95, hdg: 110, name: 'SEASPAN RELIANCE', type: 'Tanker' },
        { id: 'MOCK3', lat: 1.30, lon: 104.05, hdg: 310, name: 'MAERSK MC-KINNEY', type: 'Cargo' },
        { id: 'MOCK4', lat: 1.10, lon: 103.65, hdg: 270, name: 'OCEAN EXPLORER', type: 'Passenger' },
        { id: 'MOCK5', lat: 1.22, lon: 103.88, hdg: 15, name: 'MSC GÜLSÜN', type: 'Cargo' }
    ];

    mockSeaInterval = setInterval(() => {
        if(!useMockSeaData) {
            clearInterval(mockSeaInterval);
            return;
        }

        mockVessels.forEach(v => {
            // Move them slightly based on heading
            const rad = v.hdg * (Math.PI / 180);
            v.lat += Math.cos(rad) * 0.0005;
            v.lon += Math.sin(rad) * 0.0005;

            // Keep in bounds
            if(v.lat > 2.0 || v.lat < 0.5 || v.lon > 105.0 || v.lon < 103.0) {
                v.hdg = (v.hdg + 180) % 360; // turn around
            }

            const popupStr = `
                <h4>Vessel ${v.name} (MOCK)</h4>
                <p><strong>MMSI:</strong> ${v.id}</p>
                <p><strong>Type:</strong> ${v.type}</p>
                <p><strong>Heading:</strong> ${v.hdg.toFixed(0)}&deg;</p>
                <p><em>Mock data for demonstration.</em></p>
            `;
            
            updateMarker(v.id, v.lat, v.lon, v.hdg, 'sea', popupStr, seaMarkers, seaLayer);
        });

        document.getElementById('sea-count').innerText = Object.keys(seaMarkers).length;
    }, 2000);
}

// Connect to real AISStream via Websocket
function connectLiveSeaData(apiKey) {
    const statusEl = document.getElementById('sea-status');
    statusEl.innerText = "Status: Connecting to AISStream...";
    statusEl.style.color = "#ffcc00";

    if (aisWebSocket) {
        aisWebSocket.close();
    }

    // Clear mock data
    useMockSeaData = false;
    if(mockSeaInterval) clearInterval(mockSeaInterval);
    for (const id in seaMarkers) {
        seaLayer.removeLayer(seaMarkers[id]);
    }
    seaMarkers = {};

    aisWebSocket = new WebSocket("wss://stream.aisstream.io/v0/stream");

    aisWebSocket.onopen = function() {
        statusEl.innerText = "Status: Connected (Live WS)";
        statusEl.style.color = "#4caf50";

        // Subscribe to a bounding box around Singapore
        const subscriptionMessage = {
            APIKey: apiKey,
            BoundingBoxes: [[[SINGAPORE_BOUNDS.lamin, SINGAPORE_BOUNDS.lomin], [SINGAPORE_BOUNDS.lamax, SINGAPORE_BOUNDS.lomax]]],
            FilterMessageTypes: ["PositionReport"] // Limit data to reduce bandwidth
        };
        aisWebSocket.send(JSON.stringify(subscriptionMessage));
    };

    aisWebSocket.onmessage = function(event) {
        try {
            const aisMessage = JSON.parse(event.data);
            if (aisMessage.MessageType === "PositionReport" && aisMessage.Message && aisMessage.Message.PositionReport) {
                const report = aisMessage.Message.PositionReport;
                const mmsi = aisMessage.MetaData.MMSI;
                const lat = report.Latitude;
                const lon = report.Longitude;
                const hdg = report.TrueHeading !== 511 ? report.TrueHeading : (report.Cog || 0); // 511 means not available
                const name = aisMessage.MetaData.ShipName ? aisMessage.MetaData.ShipName.trim() : "UNKNOWN";

                const popupStr = `
                    <h4>Vessel ${name}</h4>
                    <p><strong>MMSI:</strong> ${mmsi}</p>
                    <p><strong>Heading:</strong> ${hdg}&deg;</p>
                    <p><strong>Speed:</strong> ${report.Sog} knots</p>
                `;

                updateMarker(mmsi, lat, lon, hdg, 'sea', popupStr, seaMarkers, seaLayer);
                document.getElementById('sea-count').innerText = Object.keys(seaMarkers).length;
            }
        } catch (err) {
            console.error("AIS Parsing error:", err);
        }
    };

    aisWebSocket.onerror = function(error) {
        console.error("AISStream WebSocket Error:", error);
        statusEl.innerText = "Status: WebSocket Error";
        statusEl.style.color = "#ff6b6b";
    };

    aisWebSocket.onclose = function() {
        if (!useMockSeaData) {
            statusEl.innerText = "Status: Disconnected. Reconnecting in 5s...";
            statusEl.style.color = "#ff6b6b";
            setTimeout(() => connectLiveSeaData(apiKey), 5000);
        }
    };
}

// Listen to User API Key Input
document.getElementById('btn-connect-ais').addEventListener('click', () => {
    const key = document.getElementById('ais-key').value.trim();
    if (key) {
        connectLiveSeaData(key);
    } else {
        alert("Please enter a valid AISStream API key, or leave it blank to continue using Mock Data.");
        startMockSeaData();
    }
});

// Bootstrap
window.onload = () => {
    initMap();
    
    // Start fetching OpenSky Network
    fetchAirTraffic();
    airUpdateInterval = setInterval(fetchAirTraffic, 30000); // every 30s to respect limits

    // Start Sea data (defaults to mock unless user adds API key)
    startMockSeaData();

    // Stale cleanup loop
    setInterval(cleanupStaleMarkers, 10000);
};
