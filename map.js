// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Check that Mapbox GL JS is loaded
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken =
  'pk.eyJ1Ijoic2FrZXRoLWJpcnJ1IiwiYSI6ImNtd2R3d2I1cTAyMDQyeW85MGNyam50Ym8ifQ.wwZOBMKGwJYKPNHihumFBw';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/streets-v12', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

// Select the SVG element inside the map container (Step 3.3)
const svg = d3.select('#map').select('svg');

// ---------- Global helper functions ----------

// Step 3.3: convert a station's lon/lat to pixel coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Step 5.2: minutes since midnight -> "2:30 PM"
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Step 5.3: Date -> minutes since midnight
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Step 5.4: trips pre-sorted into 1440 one-minute buckets
let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

// Step 5.4: trips within 60 minutes before/after `minute`
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat(); // No filtering, return all trips
  }

  // Normalize both min and max minutes to the valid range [0, 1439]
  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  // Handle time filtering across midnight
  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

// Steps 4.2 / 5.3 / 5.4: arrivals, departures and total traffic per station
function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

// Step 6.1: quantize scale -> three discrete flow values
let stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// departures / total, guarded so stations with no trips don't give NaN
function departureRatio(d) {
  return stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5);
}

// Step 2.3: shared bike lane style
const bikeLaneStyle = {
  'line-color': '#32D400',
  'line-width': 3,
  'line-opacity': 0.5,
};

// ---------- Everything that needs the map to be loaded ----------
map.on('load', async () => {
  // Step 2: Boston bike lanes
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-boston',
    type: 'line',
    source: 'boston_route',
    paint: bikeLaneStyle,
  });

  // Step 2.3: Cambridge bike lanes
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  map.addLayer({
    id: 'bike-lanes-cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: bikeLaneStyle,
  });

  // Step 3.1: fetch the stations JSON
  let jsonData;
  try {
    const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';

    // Await JSON fetch
    jsonData = await d3.json(jsonurl);

    console.log('Loaded JSON Data:', jsonData); // Log to verify structure
  } catch (error) {
    console.error('Error loading JSON:', error); // Handle errors
    return;
  }

  // Step 4.1 / 5.3 / 5.4: fetch trips, parse dates, fill minute buckets
  // Step 4.1 / 5.3 / 5.4: fetch trips, parse dates, fill minute buckets
  let trips;
  try {
    trips = await d3.csv(
      'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
      (trip) => {
        // 'T' makes the date format parse reliably in every browser
        trip.started_at = new Date(trip.started_at.replace(' ', 'T'));
        trip.ended_at = new Date(trip.ended_at.replace(' ', 'T'));

        const startedMinutes = minutesSinceMidnight(trip.started_at);
        const endedMinutes = minutesSinceMidnight(trip.ended_at);

        // skip rows with unparseable dates instead of crashing
        if (Number.isNaN(startedMinutes) || Number.isNaN(endedMinutes)) return null;

        departuresByMinute[startedMinutes].push(trip);
        arrivalsByMinute[endedMinutes].push(trip);
        return trip;
      },
    );
    console.log('Loaded trips:', trips.length);
  } catch (error) {
    console.error('Error loading trips CSV:', error);
    return;
  }
  // Step 5.3: stations with traffic (all trips, since timeFilter defaults to -1)
  const stations = computeStationTraffic(jsonData.data.stations);
  console.log('Stations Array:', stations);

  // Step 4.3: square root scale so circle AREA encodes traffic
  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Steps 3.3, 4.3, 4.4, 6.1: append circles
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name) // key so D3 reuses circles
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .attr('stroke-width', 1)
    .each(function (d) {
      // Add <title> for browser tooltips
      d3.select(this)
        .append('title')
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    })
    .style('--departure-ratio', (d) => departureRatio(d));

  // Step 3.3: keep circles aligned with the map
  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions); // Update during map movement
  map.on('zoom', updatePositions); // Update during zooming
  map.on('resize', updatePositions); // Update on window resize
  map.on('moveend', updatePositions); // Final adjustment after movement ends

  // Step 5.2: slider elements (getElementById takes the id WITHOUT '#')
  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  // Step 5.3: update circles for the selected time
  function updateScatterPlot(timeFilter) {
    // Recompute station traffic based on the time window
    const filteredStations = computeStationTraffic(stations, timeFilter);

    // Bigger circles when filtering, since fewer trips are shown
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name) // Ensure D3 tracks elements correctly
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic)) // Update circle sizes
      .style('--departure-ratio', (d) => departureRatio(d)) // Update colors
      .select('title') // Update tooltips
      .text(
        (d) =>
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
      );
  }

  // Step 5.2: update the time display, then the plot
  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value); // Get slider value

    if (timeFilter === -1) {
      selectedTime.textContent = ''; // Clear time display
      anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
      selectedTime.textContent = formatTime(timeFilter); // Display formatted time
      anyTimeLabel.style.display = 'none'; // Hide "(any time)"
    }

    // Call updateScatterPlot to reflect the changes on the map
    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});