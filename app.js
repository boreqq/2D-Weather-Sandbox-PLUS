/*
This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. This program is distributed in the hope that it will be useful, but
WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more
details. You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
*/

function updateSetupSliders()
{
  let simResX = parseInt(simResSelX.value);
  let simResY = parseInt(simResSelY.value);
  let simHeight = parseInt(simHeightSel.value);

  let cellHeight = simHeight / simResY;
  let simWidth = cellHeight * simResX;

  document.getElementById('simWorldProperties').innerHTML = 'cellHeight: ' + cellHeight.toFixed(1) + ' m  &nbsp&nbsp&nbsp   Simulation width: ' + (simWidth / 1000).toFixed(1) + ' km';

  document.getElementById('simHeightWarning').style.display = (simHeight == 12000) ? 'none' : 'block';
  document.getElementById('simResYWarning').style.display = (simResY == 300) ? 'none' : 'block';
  document.getElementById('simResShowX').value = simResX;
  document.getElementById('simResShowY').value = simResY
  document.getElementById('simHeightShow').value = simHeight + ' m';
}

var FPS = 60.0;


function mixGeneric(a, b, t, {clamp = false} = {})
{
  const clampT = v => (v < 0 ? 0 : v > 1 ? 1 : v);

  if (typeof a === 'number' && typeof b === 'number') {
    const tt = clamp ? clampT(t) : t;
    return a * (1 - tt) + b * tt;
  }

  // arrays / typed arrays
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    if (!Array.isArray(b) && !ArrayBuffer.isView(b))
      throw new TypeError('mismatched types');
    if (a.length !== b.length)
      throw new RangeError('length mismatch');
    const out = new (Array.isArray(a) ? Array : a.constructor)(a.length);
    for (let i = 0; i < a.length; i++) {
      const tt = clamp ? clampT(t[i] ?? t) : (Array.isArray(t) ? t[i] ?? t : t);
      out[i] = a[i] * (1 - tt) + b[i] * tt;
    }
    return out;
  }

  // vector-like object with same keys
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = {};
    for (const k of Object.keys(a)) {
      if (typeof a[k] === 'number' && typeof b[k] === 'number') {
        const tt = clamp ? clampT(t[k] ?? t) : (t && typeof t === 'object' ? (t[k] ?? t) : t);
        out[k] = a[k] * (1 - tt) + b[k] * tt;
      }
    }
    return out;
  }

  throw new TypeError('Unsupported types for mixGeneric');
}

const corsUrl = 'https://my-cors-proxy.nielsdaemen747.workers.dev/?url='; // my own proxy worker on cloudfare

async function getSoundingGraphImgUrl(url)
{
  try {
    const response = await fetch(corsUrl + encodeURIComponent(url));
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const img = doc.querySelectorAll('img')[0];
    return 'https://www.meteociel.fr/' + img.getAttribute('src');
  } catch (error) {
    console.error('Error fetching the data:', error);
  }
}

// Function to scrape table data from the given URL
async function scrapeTableData(url)
{
  try {
    const response = await fetch(corsUrl + encodeURIComponent(url));
    const html = await response.text();

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Select the rows of the main table (starting at line 51)
    const rows = doc.querySelectorAll('table:nth-of-type(2) tr:not(:first-child)');

    const tableData = [];

    rows.forEach(row => {
      const cells = row.querySelectorAll('td');

      const rowData = {
        alt : parseFloat(cells[0].textContent),
        p : parseFloat(cells[1].textContent),
        t : parseFloat(cells[2].textContent),
        tw : parseFloat(cells[3].textContent),
        td : parseFloat(cells[4].textContent),
        rh : parseFloat(cells[5].textContent),
        vel : parseFloat(cells[6].textContent.split(' / ')[1]),
        angle : parseFloat(cells[6].textContent.split(' / ')[0]),
      };

      const hasNaN = Object.values(rowData).some(v => Number.isNaN(v));

      if (!hasNaN) // discard if the row contains any NaN
        tableData.push(rowData);
    });
    return tableData;

  } catch (error) {
    console.error('Error fetching the data:', error);
  }
}

async function loadSounding(stationID, timeStamp)
{

  const imgMapType = 1; // 0 = large classic emagram   1 = small emagram
  const graphPageUrl = 'https://www.meteociel.fr/cartes_obs/sondage_display.php?id=' + stationID + '&map=' + imgMapType + '&date=' + timeStamp;
  const tablePageUrl = 'https://www.meteociel.fr/cartes_obs/sondage_display.php?id=' + stationID + '&map=4&date=' + timeStamp;

  const SoundingGraphImgUrl = await getSoundingGraphImgUrl(graphPageUrl);

  const soundingImgEl = document.getElementById('soundingPreview');
  soundingImgEl.src = SoundingGraphImgUrl;

  // console.log(graphPageUrl, SoundingGraphImgUrl, tablePageUrl);

  return scrapeTableData(tablePageUrl);
}

function sampleIsInvalid(s) { return isNaN(s.t) || isNaN(s.td) || isNaN(s.vel); }

function rawSoundingToSimSounding(soundingData, simHeight, inSimSoundingRes)
{
  let soundingForSim = [];

  soundingDataIndex = soundingData.length - 1; // start from lowest datapoint

  for (let y = 0; y < inSimSoundingRes; y++) {

    const inSimAlt = y * (simHeight / sim_res_y);

    while (soundingData[soundingDataIndex]['alt'] < inSimAlt ||
           sampleIsInvalid(soundingData[soundingDataIndex])) { // go up in the sounding until the altitude matches, or is more than the in sim altitude
      soundingDataIndex--;
    }

    const sampleAboveOrEqual = soundingData[soundingDataIndex];

    const sampleBelow = soundingData[Math.min(soundingDataIndex + 1, soundingData.length - 1)];

    let s = sampleAboveOrEqual;
    if (sampleAboveOrEqual['alt'] != inSimAlt && inSimAlt >= soundingData[soundingData.length - 1].alt) {
      let a = (inSimAlt - sampleBelow['alt']) / (sampleAboveOrEqual['alt'] - sampleBelow['alt']);
      s = mixGeneric(sampleBelow, sampleAboveOrEqual, a);
    }

    // console.log(inSimAlt, sampleBelow['alt'], sampleAboveOrEqual['alt'], s);

    let twoDimentionalVel = s.vel * Math.cos(s.angle * degToRad);   // km/h

    const inSimVel = msToRawVelocity(twoDimentionalVel / 3.6);      // convert to m/s first

    soundingForSim[y] = {'t' : s.t, 'td' : s.td, 'vel' : inSimVel}; // Put the requered data in an array of objects
  }

  // console.log('soundingForSim', soundingForSim);

  return soundingForSim;
}

var stationSelector;

const presets = [
  {name : 'Summer storms in northern Italy', location : 'Milan', date : '2025-06-05', hour : 12}, {name : 'Some cells in the Netherlands', location : 'Essen', date : '2016-06-23', hour : 12},
  {name : 'Supercell in the Netherlands', location : 'De Bilt', date : '2014-06-09', hour : 12}, {name : 'Cold winter on Gotland', location : 'Gotland', date : '2025-01-03', hour : 12},
  {name : 'Spring cells in Germany', location : 'Stuttgart', date : '2021-06-09', hour : 12}, {name : 'Hot summer in Spain', location : 'Madrid', date : '2018-07-07', hour : 12},
  {name : 'Double inversion over Sicily', location : 'Sicily', date : '2021-07-14', hour : 12}, {name : 'Low base with CAPE in Rome', location : 'Rome', date : '2021-07-16', hour : 12},
  {name : 'High low level cape over mediterranean in fall', location : 'Ajaccio', date : '2025-10-23', hour : 12}
];

var startDate;
var startLatitude;

function createPresetSelect()
{
  let select = document.getElementById('presetSelect');

  //  console.log(presets);

  presets.forEach((preset, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = preset.name;
    select.appendChild(option);
  });
  select.value = -1;

  select.onchange = function() {
    let preset = presets[select.selectedIndex];

    document.getElementById('datePicker').value = preset.date;

    startDate = new Date(preset.date);

    document.getElementById('hourSelector').value = preset.hour;

    stationSelector.selectedIndex = Object.keys(soundingStations).indexOf(preset.location);
    stationSelector.dispatchEvent(new Event('change', {bubbles : true}));

    prepareSounding();
  };
}

const soundingStations = {
  'Andoya' : {id : 1010, lat : 69.1144},
  'Lapland' : {id : 2836, lat : 67.4160},
  'Iceland' : {id : 4018, lat : 64.9631},
  'Trondheim' : {id : 1241, lat : 63.4305},
  'Helsinki' : {id : 2963, lat : 60.1699},
  'Stavanger' : {id : 1415, lat : 58.9700},
  'Gotland' : {id : 2591, lat : 57.6359},
  'North Sea' : {id : 1400, lat : 56.5333},
  'Moscow' : {id : 27730, lat : 55.7558},
  'Gdańsk' : {id : 12120, lat : 54.3520},
  'Greifswald' : {id : 10184, lat : 54.0833},
  'Norderney' : {id : 10113, lat : 53.7000},
  'Hamburg' : {id : 10035, lat : 53.5507},
  'Nottingham' : {id : 3354, lat : 52.9500},
  'Bergen(DE)' : {id : 10238, lat : 52.8092},
  'Meppen' : {id : 10304, lat : 52.7928},
  'Berlin' : {id : 10393, lat : 52.5235},
  'Warsaw' : {id : 12374, lat : 52.2297},
  'De Bilt' : {id : 6260, lat : 52.1085},
  'Essen' : {id : 10410, lat : 51.4556},
  'Wroclaw' : {id : 12425, lat : 51.1079},
  'Brussels' : {id : 6458, lat : 50.8371},
  'Meiningen' : {id : 10548, lat : 50.5678},
  'Kraków' : {id : 12575, lat : 50.0647},
  'Idar-Oberstein' : {id : 10618, lat : 49.7167},
  'Nuremberg' : {id : 10771, lat : 49.4521},
  'Paris' : {id : 7145, lat : 48.8567},
  'Stuttgart' : {id : 10739, lat : 48.7758},
  'Brest' : {id : 7110, lat : 48.3900},
  'Vienna' : {id : 11035, lat : 48.2092},
  'Altenstadt' : {id : 10954, lat : 48.3556},
  'Munich' : {id : 10868, lat : 48.1333},
  'peißenberg' : {id : 10962, lat : 47.7975},
  'Insbruck' : {id : 11120, lat : 47.2692},
  'Bern' : {id : 6610, lat : 46.9480},
  'Udine' : {id : 16045, lat : 46.0713},
  'Zagreb' : {id : 14240, lat : 45.8150},
  'Milan' : {id : 16064, lat : 45.4642},
  'Bordeaux' : {id : 7510, lat : 44.8378},
  'Bologna' : {id : 16144, lat : 44.4968},
  'Bucharest' : {id : 15420, lat : 44.4268},
  'Cuneo' : {id : 16113, lat : 44.3843},
  'Zadar' : {id : 14430, lat : 44.1194},
  'Montpellier' : {id : 7645, lat : 43.6119},
  'Barcelona' : {id : 8190, lat : 41.3851},
  'Ajaccio' : {id : 7761, lat : 41.9192},
  'Rome' : {id : 16245, lat : 41.9028},
  'Istanbul' : {id : 17064, lat : 41.0082},
  'Madrid' : {id : 8221, lat : 40.4168},
  'Sardinia' : {id : 16546, lat : 40.1209},
  'Lisbon' : {id : 8536, lat : 38.7223},
  'Athens' : {id : 16716, lat : 37.9792},
  'Sicily' : {id : 16429, lat : 37.6000},
  'Krete' : {id : 16754, lat : 35.2401},
  'Cyprus' : {id : 17607, lat : 35.1264},
  'Palestine' : {id : 40179, lat : 32.0853},
  'Cairo' : {id : 62378, lat : 30.0444},
};

function createStationSelect()
{
  let select = document.getElementById('stationSelect');

  for (const [key, value] of Object.entries(soundingStations)) {
    let option = document.createElement('option');
    option.value = value.id;
    option.innerHTML = key + ' ' + value.lat.toFixed(1) + '° N';
    select.appendChild(option);
  }
  select.value = 10868;

  select.onchange = function() {
    startLatitude = Object.values(soundingStations)[select.selectedIndex].lat;
    prepareSounding();
  };

  let datePicker = document.getElementById('datePicker');
  datePicker.onchange = function() {
    startDate = new Date(datePicker.value);
    prepareSounding();
  };

  return select;
}


// Ensure the DOM is fully loaded before running the function
document.addEventListener('DOMContentLoaded', () => {
  createPresetSelect();
  stationSelector = createStationSelect();
  prepareSounding();
});


var canvas;
var gl;

var clockEl;

var simDateTime;

var SETUP_MODE = false;

var loadingBar;
var cam;
var soundSystem;

const PI = 3.14159265359;
const degToRad = 0.0174533;
const radToDeg = 57.2957795;
const kmToMil = 0.62137;
const mToFt = 3.28084;

const saveFileVersionID = 910274663;              // Uint32 id to check if save file is compatible
const previousSaveFileVersionID = 322531714;      // previous save format with 6 floats per droplet
const legacySaveFileVersionID = 263574036;        // earlier save format with 5 floats per droplet
const olderLegacySaveFileVersionID = 1939327491;  // oldest save format without embedded settings
const valsPerDroplet = 7;
const previousValsPerDroplet = 6;
const legacyValsPerDroplet = 5;

const RADAR_PRODUCT_REFLECTIVITY = 'RADAR_REFLECTIVITY';
const RADAR_PRODUCT_RHOHV = 'RADAR_RHOHV';
const RADAR_PRODUCT_ZDR = 'RADAR_ZDR';
const RADAR_PRODUCT_KDP = 'RADAR_KDP';
const RADAR_PRODUCT_RADIAL_VELOCITY = 'RADAR_RADIAL_VELOCITY';
const RADAR_PANEL_MODE_COMPOSITE = 'RADAR_PANEL_MODE_COMPOSITE';
const RADAR_PANEL_MODE_SINGLE_STATION = 'RADAR_PANEL_MODE_SINGLE_STATION';
const RADAR_MAX_RENDER_SITES = 16;

const RADAR_TYPE_PRESETS = Object.freeze({
  X : Object.freeze({
    rangeKm : 80,
    resolutionKm : 0.1,
    attenuation : 1.6,
    refreshSec : 1,
    beamWidthDeg : 0.5,
  }),
  C : Object.freeze({
    rangeKm : 250,
    resolutionKm : 0.5,
    attenuation : 0.8,
    refreshSec : 2,
    beamWidthDeg : 1.0,
  }),
  S : Object.freeze({
    rangeKm : 500,
    resolutionKm : 2.0,
    attenuation : 0.35,
    refreshSec : 4,
    beamWidthDeg : 0.8,
  }),
});

const RADAR_PARAM_LIMITS = Object.freeze({
  rangeKm : Object.freeze({min : 1.0, max : 1000.0, step : 1.0}),
  resolutionKm : Object.freeze({min : 0.01, max : 50.0, step : 0.01}),
  attenuation : Object.freeze({min : 0.0, max : 50.0, step : 0.01}),
  refreshSec : Object.freeze({min : 0.01, max : 120.0, step : 0.01}),
  beamWidthDeg : Object.freeze({min : 0.01, max : 90.0, step : 0.01}),
});

const RADAR_PRODUCTS = Object.freeze([
  {
    id : RADAR_PRODUCT_REFLECTIVITY,
    label : 'reflectivity',
    launcherLabel : 'ref',
    shortDescription : 'Base reflectivity (dBZ)',
    isImplemented : true,
    displayMode : 'DISP_REFLECTIVITY',
  },
  {
    id : RADAR_PRODUCT_RHOHV,
    label : 'rhohv',
    launcherLabel : 'rhohv',
    shortDescription : 'Dual-pol rhohv / correlation coefficient',
    isImplemented : true,
    displayMode : 'DISP_RHOHV',
  },
  {
    id : RADAR_PRODUCT_ZDR,
    label : 'zdr',
    launcherLabel : 'zdr',
    shortDescription : 'Differential reflectivity',
    isImplemented : true,
    displayMode : 'DISP_ZDR',
  },
  {
    id : RADAR_PRODUCT_KDP,
    label : 'kdp',
    launcherLabel : 'kdp',
    shortDescription : 'Specific differential phase',
    isImplemented : false,
    displayMode : null,
  },
  {
    id : RADAR_PRODUCT_RADIAL_VELOCITY,
    label : 'vradh',
    launcherLabel : 'vradh',
    shortDescription : 'Radial velocity',
    isImplemented : false,
    displayMode : null,
  },
]);

const RADAR_PRODUCTS_BY_ID = Object.freeze(
  RADAR_PRODUCTS.reduce((acc, product) => {
    acc[product.id] = product;
    return acc;
  }, {})
);

const RADAR_PALETTE_STORAGE_VERSION = 1;
const RADAR_PALETTE_TEXTURE_UNIT = 11;
const RADAR_PALETTE_TEXTURE_WIDTH = 512;
const RADAR_BUILTIN_PALETTE_PREFIX = 'builtin:';
const RADAR_CUSTOM_PALETTE_PREFIX = 'custom:';
const RADAR_PRODUCT_TEXTURE_ROW_BY_ID = Object.freeze(
  RADAR_PRODUCTS.reduce((acc, product, index) => {
    acc[product.id] = index;
    return acc;
  }, {})
);
const RADAR_PRODUCT_PAL_CODES_BY_ID = Object.freeze({
  [RADAR_PRODUCT_REFLECTIVITY] : [ 'BR', 'DB', 'DR' ],
  [RADAR_PRODUCT_RHOHV] : [ 'CC', 'RHOHV', 'RHO' ],
  [RADAR_PRODUCT_ZDR] : [ 'ZDR' ],
  [RADAR_PRODUCT_KDP] : [ 'KDP', 'PHI' ],
  [RADAR_PRODUCT_RADIAL_VELOCITY] : [ 'BV', 'DV', 'SRV', 'VEL', 'VR' ],
});

function cloneGuiValue(value)
{
  if (Array.isArray(value) || (value && typeof value == 'object'))
    return JSON.parse(JSON.stringify(value));
  return value;
}

function clampNumber(value, min, max)
{
  return Math.min(max, Math.max(min, value));
}

function clampByte(value)
{
  return Math.round(clampNumber(value, 0, 255));
}

function getRadarTypePreset(type)
{
  return RADAR_TYPE_PRESETS[type] || RADAR_TYPE_PRESETS.C;
}

function getEffectiveRadarSettings(rawSettings)
{
  const settings = rawSettings || {};
  const preset = getRadarTypePreset(settings.radarType);
  const useCustom = settings.radarType == 'CUSTOM';
  const customOrPreset = function(customValue, presetValue) {
    const parsed = Number(useCustom ? customValue : presetValue);
    return Number.isFinite(parsed) ? parsed : presetValue;
  };

  return {
    rangeKm : clampNumber(customOrPreset(settings.customRangeKm, preset.rangeKm), RADAR_PARAM_LIMITS.rangeKm.min, RADAR_PARAM_LIMITS.rangeKm.max),
    resolutionKm : clampNumber(customOrPreset(settings.customResolutionKm, preset.resolutionKm), RADAR_PARAM_LIMITS.resolutionKm.min, RADAR_PARAM_LIMITS.resolutionKm.max),
    attenuation : clampNumber(customOrPreset(settings.customAttenuation, preset.attenuation), RADAR_PARAM_LIMITS.attenuation.min, RADAR_PARAM_LIMITS.attenuation.max),
    refreshSec : clampNumber(customOrPreset(settings.customRefreshSec, preset.refreshSec), RADAR_PARAM_LIMITS.refreshSec.min, RADAR_PARAM_LIMITS.refreshSec.max),
    beamWidthDeg : clampNumber(customOrPreset(settings.customBeamWidthDeg, preset.beamWidthDeg), RADAR_PARAM_LIMITS.beamWidthDeg.min, RADAR_PARAM_LIMITS.beamWidthDeg.max),
  };
}

function getBuiltinRadarPaletteId(productId)
{
  return RADAR_BUILTIN_PALETTE_PREFIX + productId;
}

function createRadarPaletteEntry(value, colorStart, mode, colorEnd)
{
  return {
    value,
    colorStart : colorStart.slice(0, 4),
    colorEnd : colorEnd ? colorEnd.slice(0, 4) : null,
    mode,
  };
}

const FALLBACK_RADAR_PALETTE_DEFINITION = Object.freeze({
  id : getBuiltinRadarPaletteId('GENERIC'),
  name : 'Default',
  range : [ 0.0, 1.0 ],
  entries : [
    createRadarPaletteEntry(0.0, [ 42, 49, 63, 255 ], 'smooth', [ 214, 223, 235, 255 ]),
    createRadarPaletteEntry(1.0, [ 214, 223, 235, 255 ], 'solid'),
  ],
});

const DEFAULT_RADAR_PALETTE_DEFINITIONS = Object.freeze({
  [RADAR_PRODUCT_REFLECTIVITY] : Object.freeze({
    id : getBuiltinRadarPaletteId(RADAR_PRODUCT_REFLECTIVITY),
    name : 'Default',
    range : [ -15.0, 95.0 ],
    entries : [
      createRadarPaletteEntry(-15.0, [ 0, 0, 0, 255 ], 'smooth'),
      createRadarPaletteEntry(5.0, [ 29, 37, 60, 255 ], 'smooth'),
      createRadarPaletteEntry(17.5, [ 89, 155, 171, 255 ], 'smooth'),
      createRadarPaletteEntry(22.5, [ 33, 186, 72, 255 ], 'smooth'),
      createRadarPaletteEntry(32.5, [ 5, 101, 1, 255 ], 'smooth'),
      createRadarPaletteEntry(37.5, [ 251, 252, 0, 255 ], 'smooth'),
      createRadarPaletteEntry(42.5, [ 253, 149, 2, 255 ], 'smooth'),
      createRadarPaletteEntry(50.0, [ 253, 38, 0, 255 ], 'smooth'),
      createRadarPaletteEntry(60.0, [ 193, 148, 179, 255 ], 'smooth'),
      createRadarPaletteEntry(70.0, [ 165, 2, 215, 255 ], 'smooth'),
      createRadarPaletteEntry(75.0, [ 135, 255, 253, 255 ], 'smooth'),
      createRadarPaletteEntry(80.0, [ 173, 99, 64, 255 ], 'smooth'),
      createRadarPaletteEntry(85.0, [ 105, 0, 4, 255 ], 'smooth', [ 0, 0, 0, 255 ]),
      createRadarPaletteEntry(95.0, [ 0, 0, 0, 255 ], 'solid'),
    ],
  }),
  [RADAR_PRODUCT_RHOHV] : Object.freeze({
    id : getBuiltinRadarPaletteId(RADAR_PRODUCT_RHOHV),
    name : 'Default',
    range : [ 0.0, 1.05 ],
    entries : [
      createRadarPaletteEntry(0.0, [ 15, 15, 140, 255 ], 'smooth'),
      createRadarPaletteEntry(0.45, [ 15, 15, 140, 255 ], 'smooth'),
      createRadarPaletteEntry(0.60, [ 10, 10, 190, 255 ], 'smooth'),
      createRadarPaletteEntry(0.75, [ 120, 120, 255, 255 ], 'smooth'),
      createRadarPaletteEntry(0.80, [ 95, 245, 100, 255 ], 'smooth'),
      createRadarPaletteEntry(0.85, [ 135, 215, 10, 255 ], 'smooth'),
      createRadarPaletteEntry(0.90, [ 255, 255, 0, 255 ], 'smooth'),
      createRadarPaletteEntry(0.95, [ 255, 140, 0, 255 ], 'smooth'),
      createRadarPaletteEntry(0.97, [ 225, 3, 0, 255 ], 'smooth'),
      createRadarPaletteEntry(0.99, [ 139, 30, 77, 255 ], 'smooth'),
      createRadarPaletteEntry(1.00, [ 255, 180, 215, 255 ], 'smooth'),
      createRadarPaletteEntry(1.05, [ 164, 54, 150, 255 ], 'solid'),
    ],
  }),
  [RADAR_PRODUCT_ZDR] : Object.freeze({
    id : getBuiltinRadarPaletteId(RADAR_PRODUCT_ZDR),
    name : 'Default',
    range : [ -3.0, 7.0 ],
    entries : [
      createRadarPaletteEntry(-3.0, [ 63, 0, 108, 255 ], 'smooth', [ 137, 0, 137, 255 ]),
      createRadarPaletteEntry(-1.5, [ 137, 0, 137, 255 ], 'smooth', [ 255, 255, 255, 255 ]),
      createRadarPaletteEntry(0.0, [ 255, 255, 255, 255 ], 'smooth', [ 0, 189, 246, 255 ]),
      createRadarPaletteEntry(1.5, [ 0, 189, 246, 255 ], 'smooth', [ 70, 210, 45, 255 ]),
      createRadarPaletteEntry(3.0, [ 70, 210, 45, 255 ], 'smooth', [ 255, 244, 0, 255 ]),
      createRadarPaletteEntry(4.0, [ 255, 244, 0, 255 ], 'smooth', [ 255, 0, 0, 255 ]),
      createRadarPaletteEntry(7.0, [ 255, 0, 0, 255 ], 'solid'),
    ],
  }),
});

function getDefaultRadarPaletteDefinition(productId)
{
  return DEFAULT_RADAR_PALETTE_DEFINITIONS[productId] || FALLBACK_RADAR_PALETTE_DEFINITION;
}

function createDefaultRadarPaletteState()
{
  const products = {};

  for (const product of RADAR_PRODUCTS) {
    products[product.id] = {
      selectedPaletteId : getBuiltinRadarPaletteId(product.id),
      customPalettes : [],
    };
  }

  return {
    version : RADAR_PALETTE_STORAGE_VERSION,
    products,
  };
}

function normalizeRadarPaletteColor(rawColor)
{
  if (!Array.isArray(rawColor) || (rawColor.length != 3 && rawColor.length != 4))
    return null;

  const color = rawColor.slice(0, 4).map(Number);
  if (color.some((value) => !Number.isFinite(value)))
    return null;

  if (color.length == 3)
    color.push(255);

  return color.map(clampByte);
}

function normalizeRadarPaletteEntry(rawEntry, order)
{
  if (!rawEntry || typeof rawEntry != 'object')
    return null;

  const value = Number(rawEntry.value);
  const colorStart = normalizeRadarPaletteColor(rawEntry.colorStart || rawEntry.color || rawEntry.startColor);
  const colorEnd = normalizeRadarPaletteColor(rawEntry.colorEnd || rawEntry.intervalEndColor || rawEntry.endColor);

  if (!Number.isFinite(value) || !colorStart)
    return null;

  return {
    value,
    colorStart,
    colorEnd,
    mode : rawEntry.mode == 'solid' ? 'solid' : 'smooth',
    order,
  };
}

function normalizeRadarPaletteDefinition(rawPalette, productId, fallbackName)
{
  if (!rawPalette || typeof rawPalette != 'object')
    return null;

  const entries = Array.isArray(rawPalette.entries) ? rawPalette.entries
    .map((entry, index) => normalizeRadarPaletteEntry(entry, index))
    .filter(Boolean) : [];

  if (!entries.length)
    return null;

  entries.sort((left, right) => {
    if (left.value != right.value)
      return left.value - right.value;
    return left.order - right.order;
  });

  let range = Array.isArray(rawPalette.range) && rawPalette.range.length == 2 ? [ Number(rawPalette.range[0]), Number(rawPalette.range[1]) ] : null;
  if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[1] <= range[0]) {
    range = [ entries[0].value, entries[entries.length - 1].value ];
  }
  if (range[1] <= range[0])
    range[1] = range[0] + 1.0;

  return {
    id : typeof rawPalette.id == 'string' && rawPalette.id ? rawPalette.id : getBuiltinRadarPaletteId(productId),
    name : typeof rawPalette.name == 'string' && rawPalette.name.trim() ? rawPalette.name.trim() : fallbackName,
    sourceFilename : typeof rawPalette.sourceFilename == 'string' ? rawPalette.sourceFilename : '',
    meta : rawPalette.meta && typeof rawPalette.meta == 'object' ? {
      productCode : typeof rawPalette.meta.productCode == 'string' ? rawPalette.meta.productCode : '',
      units : typeof rawPalette.meta.units == 'string' ? rawPalette.meta.units : '',
      scale : Number.isFinite(Number(rawPalette.meta.scale)) ? Number(rawPalette.meta.scale) : 1.0,
      offset : Number.isFinite(Number(rawPalette.meta.offset)) ? Number(rawPalette.meta.offset) : 0.0,
    } : {
      productCode : '',
      units : '',
      scale : 1.0,
      offset : 0.0,
    },
    range,
    entries : entries.map((entry) => ({
      value : entry.value,
      colorStart : entry.colorStart.slice(),
      colorEnd : entry.colorEnd ? entry.colorEnd.slice() : null,
      mode : entry.mode,
    })),
  };
}

function normalizeRadarPaletteState(rawState)
{
  const defaultState = createDefaultRadarPaletteState();
  const normalizedState = {
    version : RADAR_PALETTE_STORAGE_VERSION,
    products : {},
  };

  const rawProducts = rawState && typeof rawState == 'object' && rawState.products && typeof rawState.products == 'object' ? rawState.products : {};

  for (const product of RADAR_PRODUCTS) {
    const rawProductState = rawProducts[product.id];
    const normalizedProductState = {
      selectedPaletteId : getBuiltinRadarPaletteId(product.id),
      customPalettes : [],
    };

    if (rawProductState && typeof rawProductState == 'object') {
      if (typeof rawProductState.selectedPaletteId == 'string' && rawProductState.selectedPaletteId)
        normalizedProductState.selectedPaletteId = rawProductState.selectedPaletteId;

      if (Array.isArray(rawProductState.customPalettes)) {
        normalizedProductState.customPalettes = rawProductState.customPalettes
          .map((palette, index) => normalizeRadarPaletteDefinition(palette, product.id, 'Custom ' + (index + 1)))
          .filter(Boolean);
      }
    }

    const hasSelectedCustomPalette = normalizedProductState.customPalettes.some((palette) => palette.id == normalizedProductState.selectedPaletteId);
    if (!hasSelectedCustomPalette && normalizedProductState.selectedPaletteId != getBuiltinRadarPaletteId(product.id))
      normalizedProductState.selectedPaletteId = defaultState.products[product.id].selectedPaletteId;

    normalizedState.products[product.id] = normalizedProductState;
  }

  return normalizedState;
}

function getRadarPaletteStateForProduct(productId)
{
  if (!guiControls || !guiControls.radarPaletteState)
    return null;
  return guiControls.radarPaletteState.products[productId] || null;
}

function getSelectedRadarPaletteDefinition(productId)
{
  const productState = getRadarPaletteStateForProduct(productId);
  const builtinPaletteId = getBuiltinRadarPaletteId(productId);
  if (!productState)
    return getDefaultRadarPaletteDefinition(productId);

  if (productState.selectedPaletteId != builtinPaletteId) {
    const customPalette = productState.customPalettes.find((palette) => palette.id == productState.selectedPaletteId);
    if (customPalette)
      return customPalette;
  }

  return getDefaultRadarPaletteDefinition(productId);
}

function sampleRadarPaletteDefinition(paletteDefinition, value)
{
  const entries = paletteDefinition.entries;
  if (!entries.length)
    return [ 255, 255, 255, 255 ];

  if (value <= entries[0].value)
    return entries[0].colorStart.slice();

  for (let index = 0; index < entries.length - 1; index++) {
    const currentEntry = entries[index];
    const nextEntry = entries[index + 1];

    if (value <= nextEntry.value) {
      const startColor = currentEntry.colorStart;
      const endColor = currentEntry.colorEnd || nextEntry.colorStart;

      if (currentEntry.mode == 'solid' || nextEntry.value <= currentEntry.value)
        return endColor.slice();

      const amount = clampNumber((value - currentEntry.value) / (nextEntry.value - currentEntry.value), 0.0, 1.0);
      return [
        Math.round(startColor[0] + (endColor[0] - startColor[0]) * amount),
        Math.round(startColor[1] + (endColor[1] - startColor[1]) * amount),
        Math.round(startColor[2] + (endColor[2] - startColor[2]) * amount),
        Math.round(startColor[3] + (endColor[3] - startColor[3]) * amount),
      ];
    }
  }

  const lastEntry = entries[entries.length - 1];
  return (lastEntry.colorEnd || lastEntry.colorStart).slice();
}

function updateRadarPaletteTexture()
{
  if (!gl || !radarPaletteTexture || !guiControls || !guiControls.radarPaletteState)
    return;

  const rowCount = RADAR_PRODUCTS.length;
  const pixelData = new Uint8Array(RADAR_PALETTE_TEXTURE_WIDTH * rowCount * 4);

  for (const product of RADAR_PRODUCTS) {
    const paletteDefinition = getSelectedRadarPaletteDefinition(product.id);
    const rowIndex = RADAR_PRODUCT_TEXTURE_ROW_BY_ID[product.id];
    const rangeStart = paletteDefinition.range[0];
    const rangeEnd = paletteDefinition.range[1];

    for (let x = 0; x < RADAR_PALETTE_TEXTURE_WIDTH; x++) {
      const amount = RADAR_PALETTE_TEXTURE_WIDTH > 1 ? x / (RADAR_PALETTE_TEXTURE_WIDTH - 1) : 0.0;
      const value = rangeStart + (rangeEnd - rangeStart) * amount;
      const color = sampleRadarPaletteDefinition(paletteDefinition, value);
      const dataIndex = (rowIndex * RADAR_PALETTE_TEXTURE_WIDTH + x) * 4;
      pixelData[dataIndex + 0] = color[0];
      pixelData[dataIndex + 1] = color[1];
      pixelData[dataIndex + 2] = color[2];
      pixelData[dataIndex + 3] = color[3];
    }
  }

  gl.activeTexture(gl.TEXTURE0 + RADAR_PALETTE_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, radarPaletteTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, RADAR_PALETTE_TEXTURE_WIDTH, rowCount, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixelData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function getRadarPaletteRowCenter(productId)
{
  const rowIndex = RADAR_PRODUCT_TEXTURE_ROW_BY_ID[productId] || 0;
  return (rowIndex + 0.5) / RADAR_PRODUCTS.length;
}

function applyRadarPaletteUniforms(program, productId)
{
  const paletteDefinition = getSelectedRadarPaletteDefinition(productId);
  gl.uniform2f(gl.getUniformLocation(program, 'radarPaletteRange'), paletteDefinition.range[0], paletteDefinition.range[1]);
  gl.uniform1f(gl.getUniformLocation(program, 'radarPaletteRowCenter'), getRadarPaletteRowCenter(productId));
}

function makeCustomRadarPaletteId()
{
  return RADAR_CUSTOM_PALETTE_PREFIX + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function getRadarPaletteNameFromFilename(fileName)
{
  if (typeof fileName != 'string' || !fileName)
    return 'Custom palette';

  const segments = fileName.split('.');
  if (segments.length > 1)
    segments.pop();

  const baseName = segments.join('.').trim();
  return baseName || 'Custom palette';
}

function isRadarPaletteCompatibleWithProduct(productId, productCode)
{
  if (!productCode)
    return true;

  const acceptedCodes = RADAR_PRODUCT_PAL_CODES_BY_ID[productId];
  if (!acceptedCodes || !acceptedCodes.length)
    return true;

  return acceptedCodes.includes(productCode.toUpperCase());
}

function convertPalValueToProductUnits(rawValue, productId, units, scale, offset)
{
  let value = rawValue;

  if (Number.isFinite(offset) && offset !== 0.0)
    value -= offset;

  if (Number.isFinite(scale) && scale !== 0.0 && scale !== 1.0)
    value /= scale;

  const normalizedUnits = typeof units == 'string' ? units.toUpperCase() : '';
  if (productId == RADAR_PRODUCT_RHOHV && value > 1.5 && (normalizedUnits == '%' || normalizedUnits == 'PERCENT'))
    value /= 100.0;

  return value;
}

function parsePalLineNumbers(line)
{
  const matches = line.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!matches)
    return [];
  return matches.map(Number).filter(Number.isFinite);
}

function parseRadarPaletteFile(text, productId, sourceFilename)
{
  const lines = text.replace(/\ufeff/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const entries = [];
  let productCode = '';
  let units = '';
  let scale = 1.0;
  let offset = 0.0;
  let order = 0;

  for (const rawLine of lines) {
    let line = rawLine;
    const semicolonIndex = line.indexOf(';');
    if (semicolonIndex >= 0)
      line = line.slice(0, semicolonIndex);
    line = line.trim();

    if (!line || line.startsWith('#') || line.startsWith('//'))
      continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex >= 0) {
      const keyword = line.slice(0, colonIndex).trim().toUpperCase();
      const payload = line.slice(colonIndex + 1).trim();

      if (keyword == 'PRODUCT') {
        productCode = payload.split(/\s+/)[0].toUpperCase();
        continue;
      }
      if (keyword == 'UNITS') {
        units = payload.split(/\s+/)[0].toUpperCase();
        continue;
      }
      if (keyword == 'SCALE') {
        const parsedScale = Number(parsePalLineNumbers(payload)[0]);
        if (Number.isFinite(parsedScale) && parsedScale !== 0.0)
          scale = parsedScale;
        continue;
      }
      if (keyword == 'OFFSET') {
        const parsedOffset = Number(parsePalLineNumbers(payload)[0]);
        if (Number.isFinite(parsedOffset))
          offset = parsedOffset;
        continue;
      }

      const isColorDirective = keyword == 'COLOR' || keyword == 'COLOR4' || keyword == 'SOLIDCOLOR' || keyword == 'SOLIDCOLOR4';
      if (!isColorDirective)
        continue;

      const numericValues = parsePalLineNumbers(payload);
      const colorChannelCount = keyword.endsWith('4') ? 4 : 3;
      if (numericValues.length < 1 + colorChannelCount)
        continue;

      const startColor = numericValues.slice(1, 1 + colorChannelCount);
      const endColor = numericValues.length >= 1 + colorChannelCount * 2 ? numericValues.slice(1 + colorChannelCount, 1 + colorChannelCount * 2) : null;
      const convertedValue = convertPalValueToProductUnits(numericValues[0], productId, units, scale, offset);
      const normalizedStartColor = normalizeRadarPaletteColor(startColor);
      const normalizedEndColor = normalizeRadarPaletteColor(endColor);

      if (!normalizedStartColor)
        continue;

      entries.push({
        value : convertedValue,
        colorStart : normalizedStartColor,
        colorEnd : normalizedEndColor,
        mode : keyword.startsWith('SOLID') ? 'solid' : 'smooth',
        order : order++,
      });
      continue;
    }

    const numericValues = parsePalLineNumbers(line);
    if (numericValues.length >= 4) {
      const hasAlpha = numericValues.length >= 5;
      const color = hasAlpha ? numericValues.slice(1, 5) : numericValues.slice(1, 4);
      const normalizedColor = normalizeRadarPaletteColor(color);

      if (!normalizedColor)
        continue;

      entries.push({
        value : convertPalValueToProductUnits(numericValues[0], productId, units, scale, offset),
        colorStart : normalizedColor,
        colorEnd : null,
        mode : 'solid',
        order : order++,
      });
    }
  }

  if (!entries.length)
    throw new Error('Unsupported or empty .pal file.');

  entries.sort((left, right) => {
    if (left.value != right.value)
      return left.value - right.value;
    return left.order - right.order;
  });

  const normalizedEntries = entries.map((entry) => ({
    value : entry.value,
    colorStart : entry.colorStart.slice(),
    colorEnd : entry.colorEnd ? entry.colorEnd.slice() : null,
    mode : entry.mode,
  }));

  return {
    id : makeCustomRadarPaletteId(),
    name : getRadarPaletteNameFromFilename(sourceFilename),
    sourceFilename : sourceFilename || '',
    meta : {
      productCode,
      units,
      scale,
      offset,
    },
    range : [ normalizedEntries[0].value, normalizedEntries[normalizedEntries.length - 1].value ],
    entries : normalizedEntries,
  };
}

const guiControls_default = {
  vorticity : 0.005,
  dragMultiplier : 0.001, // 0.01
  wind : 0.0,
  globalEffectsStartAlt : 0,
  globalEffectsEndAlt : 10000,
  globalDrying : 0.000000, // 0.000010
  globalHeating : 0.0,
  soundingForcing : 0.0,
  sunIntensity : 1.0,
  waterTemperature : 25.0, // °C
  dynamicWaterTemperature : true,
  landEvaporation : 0.00005,
  waterEvaporation : 0.0001,
  evapHeat : 2.90,          //  Real: 2260 J/g
  meltingHeat : 0.43,       //  Real:  334 J/g
  condensationRate : 0.0050,
  waterWeight : 0.25,       // 0.50
  inactiveDroplets : 0,
  aboveZeroThreshold : 1.0, // PRECIPITATION
  subZeroThreshold : 0.005, // 0.01
  spawnChance : 0.00005,    // 30. 10 to 50
  snowDensity : 0.2,        // 0.3
  fallSpeed : 0.0003,
  growthRate0C : 0.0001,    // 0.0005
  growthRate_30C : 0.001,   // 0.01
  freezingRate : 0.01,
  meltingRate : 0.01,
  evapRate : 0.0008, // 0.0005
  displayMode : 'DISP_REAL',
  wrapHorizontally : true,
  SmoothCam : true,
  camSpeed : 0.01,
  exposure : 1.0,
  timeOfDay : 9.9,
  latitude : 45.0,
  month : 6.65, // Northern hemisphere summer solstice
  sunAngle : 9.9,
  dayNightCycle : true,
  accelerateNight : true,
  greenhouseGases : 0.001,
  waterGreenHouseEffect : 0.0015,
  IR_rate : 1.0,
  tool : 'TOOL_NONE',
  brushSize : 20,
  wholeWidth : false,
  brushIntensity : 0.01,
  allowCaves : true,
  showGraph : false,
  soundingSmoothing : true,
  showCAPE : true,
  showCIN : true,
  showMLCAPE : true,
  showCAPE03 : true,
  reflectivityBackground : true,
  debugReflectivity : false,
  reflectivityGain : 0.0,
  reflectivityBoost : 10000.0,
  reflectivityPixelSize : 8,
  radarShowRangeRings : false,
  rhohvBackground : true,
  debugRhohv : false,
  rhohvPixelSize : 8,
  rhohvLowCCArtifacts : true,
  rhohvClutterDensity : 1.0,
  zdrBackground : true,
  debugZdr : false,
  zdrPixelSize : 8,
  zdrFillRadius : 2,
  zdrMaskDbz : 10.0,
  reflectivityRefreshSec : 2.0,
  radarProduct : RADAR_PRODUCT_REFLECTIVITY, // legacy save compatibility only
  selectedRadarProduct : RADAR_PRODUCT_REFLECTIVITY,
  lastLiveRadarProduct : RADAR_PRODUCT_REFLECTIVITY,
  radarPaletteState : createDefaultRadarPaletteState(),
  realDewPoint : false, // show real dew point in graph, instead of dew point with cloud water included
  enablePrecipitation : true,
  showDrops : false,
  paused : false,
  IterPerFrame : 10,
  auto_IterPerFrame : true,
  sound : true,
  dryLapseRate : 10.0,     // Real: 9.8 degrees / km
  simHeight : 12000,       // meters
  twelveHourClock : false, // only for display.  false = metric
  lengthUnit : 'LENGTH_UNIT_METRIC',
  tempUnit : 'TEMP_UNIT_C',
  windUnit : 'SPEED_UNIT_KMH',
};

function getRadarProductMeta(productId)
{
  return RADAR_PRODUCTS_BY_ID[productId] || RADAR_PRODUCTS_BY_ID[RADAR_PRODUCT_REFLECTIVITY];
}

function isImplementedRadarProduct(productId)
{
  return !!getRadarProductMeta(productId).isImplemented;
}

function getDisplayModeForRadarProduct(productId)
{
  return getRadarProductMeta(productId).displayMode;
}

function getRadarProductIdForDisplayMode(displayMode)
{
  if (displayMode == 'DISP_REFLECTIVITY')
    return RADAR_PRODUCT_REFLECTIVITY;
  if (displayMode == 'DISP_RHOHV')
    return RADAR_PRODUCT_RHOHV;
  if (displayMode == 'DISP_ZDR')
    return RADAR_PRODUCT_ZDR;
  return null;
}

var horizontalDisplayMult = 3.0; // 3.0 to cover srceen while zoomed out

var guiControls;

var displayVectorField = false;

var displayWeatherStations = true;

var sunIsUp = true;

var airplaneMode = false;

var dropletFollowID = -1;
var reflectivityDbgEl;
var lastReflectivitySnapshotTime = -Infinity;
var radarRefreshNoiseTick = 0;

var minShadowLight = 0.02;

var saveFileName = '';

var guiControlsFromSaveFile = null;
var datGui;
var radarPaletteTexture;
var radarPaletteFileInputEl;
var radarPaletteImportTargetProductId = null;

var sim_res_x;
var sim_res_y;
var sim_aspect; //  = sim_res_x / sim_res_y
var sim_height = 12000;

var cellHeight = 12000. / 300.; // guiControls.simHeight / sim_res_y;  // in meters // cell width is the same

var frameNum = 0;
var lastFrameNum = 0;

var iterNum = 0;

// global framebuffers for measurements
var frameBuff_0;
var frameBuff_1;
var lightFrameBuff_0;
var reflectivitySnapshotFBO;

var dryLapse;


const timePerIteration = 0.00008; // in hours (0.00008 = 0.288 sec, at 40m cell size that means the speed of light & sound = 138.88 m/s = 500 km/h)

var NUM_DROPLETS;
const NUM_DROPLETS_DEVIDER = 25; // 25

let hdrFBO;

let bloomFBOs = [];

let ambientLightFBOs = [];
let emittedLightFBO;


function clamp(num, min, max) { return Math.min(Math.max(num, min), max); }

function screenToSimX(screenX)
{
  let leftEdge = canvas.width / 2.0 - (canvas.width * cam.curZoom) / 2.0;
  let rightEdge = canvas.width / 2.0 + (canvas.width * cam.curZoom) / 2.0;
  return map_range(screenX, leftEdge, rightEdge, 0.0, 1.0) - cam.curXpos / 2.0;
}

function screenToSimY(screenY)
{
  let topEdge = canvas.height / 2.0 - ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  let bottemEdge = canvas.height / 2.0 + ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  return map_range(screenY, bottemEdge, topEdge, 0.0, 1.0) - (cam.curYpos / 2.0) * sim_aspect;
}

function simToScreenX(simX)
{
  simX += 0.5;
  simX /= sim_res_x;
  let leftEdge = canvas.width / 2.0 - (canvas.width * cam.curZoom) / 2.0;
  let rightEdge = canvas.width / 2.0 + (canvas.width * cam.curZoom) / 2.0;
  return map_range(simX + cam.curXpos / 2.0, 0.0, 1.0, leftEdge, rightEdge);
}

function simToScreenY(simY)
{
  simY += 0.5; // center in cell
  simY /= sim_res_y;
  let topEdge = canvas.height / 2.0 - ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  let bottemEdge = canvas.height / 2.0 + ((canvas.width / sim_aspect) * cam.curZoom) / 2.0;
  return map_range(simY + (cam.curYpos / 2.0) * sim_aspect, 0.0, 1.0, bottemEdge, topEdge);
}

function download(filename, data)
{
  var url = URL.createObjectURL(data);
  const element = document.createElement('a');
  element.setAttribute('href', url);
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

// Universal Functions

function mod(a, b)
{
  // proper modulo to handle negative numbers
  return ((a % b) + b) % b;
}

function map_range(value, low1, high1, low2, high2) { return low2 + ((high2 - low2) * (value - low1)) / (high1 - low1); }

function map_range_C(value, low1, high1, low2, high2) { return clamp(low2 + ((high2 - low2) * (value - low1)) / (high1 - low1), Math.min(low2, high2), Math.max(low2, high2)); }

// Temperature Functions

function CtoK(C) { return C + 273.15; }

function KtoC(K) { return K - 273.15; }

function CtoF(C) { return C * 1.8 + 32.0; }


function dT_saturated(dTdry, dTl)
{
  // dTl = temperature difference because of latent heat
  // if (dTl == 0.0)
  //   return dTdry;
  //  else {
  var multiplier = dTdry / (dTdry - dTl);
  return dTdry * multiplier;
  // }
}

const IR_constant = 5.670374419; // ×10−8

function IR_emitted(T)
{
  return Math.pow(T * 0.01, 4) * IR_constant; // Stefan–Boltzmann law
}

function IR_temp(IR)
{
  // inversed Stefan–Boltzmann law
  return Math.pow(IR / IR_constant, 1.0 / 4.0) * 100.0;
}

////////////// Water Functions ///////////////
const wf_devider = 250.0;
const wf_pow = 17.0;

function maxWater(Td)
{
  return Math.pow(Td / wf_devider,
                  wf_pow); // w = ((Td)/(250))^(18) // Td in Kelvin, w in grams per m^3
}

function dewpoint(W)
{
  //  if (W < 0.00001) // can't remember why this was here...
  //    return 0.0;
  //  else
  return wf_devider * Math.pow(W, 1.0 / wf_pow);
}

function relativeHumd(T, W) { return (W / maxWater(T)) * 100.0; }

// Print funtions:

function convertTempToSelectedUnit(tempC)
{
  switch (guiControls.tempUnit) {
  case 'TEMP_UNIT_C':
    return tempC;
  case 'TEMP_UNIT_F':
    return CtoF(tempC);
  case 'TEMP_UNIT_K':
    return (tempC + 273.15);
  }
}

function printTemp(tempC)
{
  let tempStr = convertTempToSelectedUnit(tempC).toFixed(1);
  switch (guiControls.tempUnit) {
  case 'TEMP_UNIT_C':
    return tempStr + '°C';
  case 'TEMP_UNIT_F':
    return tempStr + '°F';
  case 'TEMP_UNIT_K':
    return tempStr + ' K';
  }
}

function mmToIn(mm) { return mm * 0.393701; }

function msToKnots(ms) { return ms * 1.94384; };

function msToMPH(ms) { return ms * 2.23694; };

function knotsToMs(kt) { return kt * 0.514444; };

function printSnowHeight(snowHeight_cm)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    return mmToIn(snowHeight_cm).toFixed(1) + '"'; // inches
  } else
    return snowHeight_cm.toFixed(1) + ' cm';
}

function smoothstepJS(edge0, edge1, x)
{
  if (edge0 == edge1)
    return x < edge0 ? 0.0 : 1.0;
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0.0), 1.0);
  return t * t * (3.0 - 2.0 * t);
}

function mixJS(a, b, t)
{
  return a * (1.0 - t) + b * t;
}

function clamp01(x)
{
  return Math.min(Math.max(x, 0.0), 1.0);
}

function inferCompactnessProxy(waterMass, iceMass, density, size = 0.0)
{
  const liquid = Math.max(waterMass, 0.0);
  const ice = Math.max(iceMass, 0.0);
  const total = liquid + ice;
  if (total <= 0.0)
    return 0.0;
  if (ice <= 1e-6)
    return 1.0;

  const iceFraction = ice / Math.max(total, 1e-6);
  const liquidFraction = liquid / Math.max(total, 1e-6);
  const densityNorm = smoothstepJS(0.42, 0.98, Math.min(Math.max(density, 0.0), 1.0));
  const iceNorm = smoothstepJS(0.55, 0.98, iceFraction);
  const sizeNorm = smoothstepJS(0.45, 1.35, Math.max(size, 0.0));
  const baseCompactness = 0.08 + densityNorm * 0.52 + iceNorm * 0.22 + sizeNorm * 0.18;
  const dryIceCore = smoothstepJS(0.90, 0.995, iceFraction) *
                     (1.0 - smoothstepJS(0.02, 0.12, liquidFraction)) *
                     smoothstepJS(0.82, 1.00, Math.min(Math.max(density, 0.0), 1.0));
  const hailCoreBoost = dryIceCore * smoothstepJS(0.80, 1.50, Math.max(size, 0.0));
  return clamp01(Math.max(baseCompactness, hailCoreBoost * mixJS(0.58, 0.92, hailCoreBoost)));
}

function calcHydrometeorSizeProxy(waterMass, iceMass, density, compactness = inferCompactnessProxy(waterMass, iceMass, density, 0.0))
{
  const liquid = Math.max(waterMass, 0.0);
  const ice = Math.max(iceMass, 0.0);
  const totalMass = liquid + ice;
  if (totalMass <= 0.0)
    return 0.0;

  const iceFraction = ice / Math.max(totalMass, 1e-6);
  const liquidFraction = liquid / Math.max(totalMass, 1e-6);
  const clampedDensity = Math.min(Math.max(density, 0.12), 1.0);
  const clampedCompactness = clamp01(compactness);
  const waterEquivalentSize = Math.pow(totalMass, 1.0 / 3.0);

  const snowiness = clamp01((0.72 - clampedDensity) / 0.42) * (1.0 - smoothstepJS(0.28, 0.72, clampedCompactness));
  const hailness = smoothstepJS(0.72, 0.98, clampedCompactness) * smoothstepJS(0.55, 0.95, iceFraction);
  const graupelness = smoothstepJS(0.28, 0.68, clampedCompactness) * (1.0 - hailness) * smoothstepJS(0.45, 0.95, iceFraction);

  const drySnowScale = mixJS(0.88, 1.10, snowiness);
  const graupelScale = mixJS(drySnowScale, 1.14, graupelness);
  const hailScale = mixJS(1.00, 1.32, hailness);
  const iceScale = mixJS(graupelScale, hailScale, hailness);
  const mixedScale = mixJS(iceScale, Math.max(1.00, 1.05 + hailness * 0.10), smoothstepJS(0.18, 0.88, liquidFraction));

  if (ice <= 1e-6)
    return waterEquivalentSize;
  if (liquid <= 1e-6)
    return waterEquivalentSize * iceScale;
  return waterEquivalentSize * mixedScale;
}

function computeHydrometeorMemberships(waterMass, iceMass, density, size, compactness)
{
  const liquid = Math.max(waterMass, 0.0);
  const ice = Math.max(iceMass, 0.0);
  const total = liquid + ice;
  if (total <= 0.0) {
    return {
      rain : 0.0,
      snow : 0.0,
      graupel : 0.0,
      hail : 0.0,
      wetHail : 0.0,
      melting : 0.0,
    };
  }

  const liquidFraction = liquid / Math.max(total, 1e-6);
  const iceFraction = ice / Math.max(total, 1e-6);
  const compact = clamp01(compactness);
  const dryIce = smoothstepJS(0.60, 0.98, iceFraction) * (1.0 - smoothstepJS(0.04, 0.20, liquidFraction));

  let rain = smoothstepJS(0.82, 0.995, liquidFraction) * (1.0 - smoothstepJS(0.05, 0.35, iceFraction));
  let wetHail = smoothstepJS(0.65, 0.98, iceFraction) * smoothstepJS(0.06, 0.35, liquidFraction) * smoothstepJS(0.78, 1.00, density) *
                smoothstepJS(0.70, 1.00, compact) * smoothstepJS(0.55, 1.10, size);
  let hail = dryIce * smoothstepJS(0.82, 1.00, density) * smoothstepJS(0.72, 1.00, compact) * smoothstepJS(0.55, 1.10, size) *
             (1.0 - smoothstepJS(0.04, 0.16, liquidFraction)) * (1.0 - wetHail);
  let graupel = dryIce * smoothstepJS(0.38, 0.82, density) * smoothstepJS(0.28, 0.78, compact) * smoothstepJS(0.30, 0.90, size) *
                (1.0 - hail) * (1.0 - wetHail);
  let melting = smoothstepJS(0.04, 0.40, liquidFraction) * smoothstepJS(0.30, 0.98, iceFraction) *
                (1.0 - smoothstepJS(0.76, 1.00, compact) * smoothstepJS(0.82, 1.00, density));
  let snow = dryIce * (1.0 - smoothstepJS(0.45, 0.78, density)) * (1.0 - smoothstepJS(0.28, 0.72, compact)) *
             (1.0 - 0.75 * graupel) * (1.0 - 0.70 * melting);

  const sum = rain + snow + graupel + hail + wetHail + melting;
  if (sum <= 1e-6) {
    if (liquid >= ice)
      rain = 1.0;
    else
      snow = 1.0;
    return { rain, snow, graupel : 0.0, hail : 0.0, wetHail : 0.0, melting : 0.0 };
  }

  const inv = 1.0 / sum;
  return {
    rain : rain * inv,
    snow : snow * inv,
    graupel : graupel * inv,
    hail : hail * inv,
    wetHail : wetHail * inv,
    melting : melting * inv,
  };
}

function dominantHydrometeorLabel(memberships)
{
  let label = 'rain';
  let best = memberships.rain;
  if (memberships.snow > best) {
    best = memberships.snow;
    label = 'snow';
  }
  if (memberships.graupel > best) {
    best = memberships.graupel;
    label = 'graupel';
  }
  if (memberships.hail > best) {
    best = memberships.hail;
    label = 'hail';
  }
  if (memberships.wetHail > best) {
    best = memberships.wetHail;
    label = 'wet hail';
  }
  if (memberships.melting > best) {
    label = 'melting';
  }
  return label;
}

function calcDropletRadarMetrics(waterMass, iceMass, density, size, compactness = inferCompactnessProxy(waterMass, iceMass, density, size))
{
  const liquid = Math.max(waterMass, 0.0);
  const ice = Math.max(iceMass, 0.0);
  const total = liquid + ice;
  if (total <= 0.0 || size <= 0.0) {
    return {
      zh : 0.0,
      zv : 0.0,
      hv : 0.0,
      zdrDb : 0.0,
      hSize : 0.0,
      vSize : 0.0,
      flattening : 0.0,
      radarPresence : 0.0,
      compactness : 0.0,
      rhoParticle : 0.0,
      hydrometeors : computeHydrometeorMemberships(0.0, 0.0, 0.0, 0.0, 0.0),
      dominantType : 'none',
    };
  }

  const liquidFraction = liquid / Math.max(total, 1e-6);
  const iceFraction = ice / Math.max(total, 1e-6);
  const hydro = computeHydrometeorMemberships(liquid, ice, density, size, compactness);

  const rainFlatten = Math.min(Math.max((size - 0.35) * 0.26, 0.0), 0.38);
  const mixedFlatten = Math.min(Math.max((size - 0.45) * 0.14, 0.0), 0.16);
  const snowFlatten = Math.min(Math.max((size - 0.55) * 0.05, 0.0), 0.05);
  const flattening = rainFlatten * hydro.rain +
                     mixedFlatten * (hydro.melting * 0.55 + hydro.wetHail * 0.18) +
                     snowFlatten * (hydro.snow * 0.70 + hydro.graupel * 0.35);

  const radarPresence = smoothstepJS(0.12, 0.35, total);
  const waterSize = size * Math.pow(Math.max(liquidFraction, 0.0), 1.0 / 3.0);
  const iceSize = size * Math.pow(Math.max(iceFraction, 0.0), 1.0 / 3.0);

  const waterMoment = Math.pow(Math.max(waterSize * 0.58, 1e-4), 6.0);
  const iceDensity = Math.min(Math.max(density, 0.12), 1.0);
  const aggregateBoost = mixJS(1.42, 1.08, clamp01(0.35 * compactness + 0.65 * iceDensity));
  const iceRadarSize = iceSize * ((0.42 * (1.0 - iceDensity)) + (0.60 * iceDensity)) * aggregateBoost;
  const iceCoeff = hydro.snow * 0.14 + hydro.graupel * 0.20 + hydro.hail * 0.28 + hydro.wetHail * 0.31 + hydro.melting * 0.22;
  const iceMoment = iceCoeff * Math.pow(Math.max(iceRadarSize, 1e-4), 6.0);

  const brightBand = hydro.melting * 0.08 + hydro.wetHail * 0.05;

  const largeRainTail = smoothstepJS(1.55, 2.70, size);
  const giantRainTail = smoothstepJS(2.05, 3.00, size);
  const meltingTail = smoothstepJS(1.45, 2.30, size);
  const rainZdr = mixJS(0.12, 2.45, smoothstepJS(0.45, 1.55, size)) + flattening * 1.10 + largeRainTail * 0.78 + giantRainTail * 3.00;
  const meltingZdr = mixJS(0.22, 1.55, smoothstepJS(0.45, 1.55, size)) + flattening * 0.82 + meltingTail * 0.22;
  const wetHailZdr = mixJS(-0.10, 0.70, smoothstepJS(0.70, 2.00, size)) + flattening * 0.35;
  const snowZdr = mixJS(0.02, 0.22, smoothstepJS(0.50, 1.80, size));
  const graupelZdr = mixJS(-0.10, 0.08, smoothstepJS(0.55, 1.60, size));
  const hailZdr = -mixJS(0.05, 0.70, smoothstepJS(0.75, 2.40, size));

  let targetZdrDb = hydro.rain * rainZdr +
                    hydro.snow * snowZdr +
                    hydro.graupel * graupelZdr +
                    hydro.hail * hailZdr +
                    hydro.wetHail * wetHailZdr +
                    hydro.melting * meltingZdr;
  targetZdrDb = Math.min(Math.max(targetZdrDb, -1.25), 6.80);

  const baseMoment = radarPresence * (waterMoment + iceMoment) * (1.0 + brightBand * 0.85);
  const zdrRatio = Math.pow(10.0, targetZdrDb / 10.0);
  const zh = baseMoment * (2.0 * zdrRatio / (1.0 + zdrRatio));
  const zv = baseMoment * (2.0 / (1.0 + zdrRatio));

  const hSize = size * (1.0 + flattening * 0.60);
  const vSize = size * Math.max(1.0 - flattening * 0.75, 0.55);
  const particleRho = clamp01(
    hydro.rain * mixJS(0.992, 0.986, smoothstepJS(0.50, 1.80, size)) +
    hydro.snow * mixJS(0.985, 0.974, smoothstepJS(0.35, 1.30, size)) +
    hydro.graupel * mixJS(0.964, 0.940, smoothstepJS(0.40, 1.60, size)) +
    hydro.hail * mixJS(0.950, 0.900, smoothstepJS(0.55, 1.90, size)) +
    hydro.wetHail * mixJS(0.930, 0.840, smoothstepJS(0.55, 1.90, size)) +
    hydro.melting * mixJS(0.940, 0.870, smoothstepJS(0.10, 0.45, liquidFraction)) -
    hydro.rain * flattening * 0.04
  );

  const zdrDb = 10.0 * Math.log10((zh + 1e-6) / (zv + 1e-6));

  return {
    zh,
    zv,
    hv : particleRho * Math.sqrt(Math.max(zh * zv, 0.0)),
    zdrDb,
    hSize,
    vSize,
    flattening,
    radarPresence,
    compactness,
    rhoParticle : particleRho,
    hydrometeors : hydro,
    dominantType : dominantHydrometeorLabel(hydro),
  };
}

function upgradeLegacyPrecipArray(legacyPrecipArray, loadedValsPerDroplet = legacyValsPerDroplet)
{
  if (loadedValsPerDroplet == valsPerDroplet)
    return legacyPrecipArray;

  if (legacyPrecipArray.length % loadedValsPerDroplet != 0)
    return legacyPrecipArray;

  const legacyDropletCount = legacyPrecipArray.length / loadedValsPerDroplet;
  const upgraded = new Float32Array(legacyDropletCount * valsPerDroplet);
  for (let i = 0; i < legacyDropletCount; i++) {
    const legacyOffset = i * loadedValsPerDroplet;
    const upgradedOffset = i * valsPerDroplet;
    const waterMass = legacyPrecipArray[legacyOffset + 2];
    const iceMass = legacyPrecipArray[legacyOffset + 3];
    const density = legacyPrecipArray[legacyOffset + 4];
    const size = loadedValsPerDroplet >= previousValsPerDroplet && waterMass >= 0.0 ? legacyPrecipArray[legacyOffset + 5] :
                 (waterMass >= 0.0 ? calcHydrometeorSizeProxy(waterMass, iceMass, density) : 0.0);
    const compactness = waterMass >= 0.0 ? inferCompactnessProxy(waterMass, iceMass, density, size) : 0.0;

    upgraded[upgradedOffset + 0] = legacyPrecipArray[legacyOffset + 0];
    upgraded[upgradedOffset + 1] = legacyPrecipArray[legacyOffset + 1];
    upgraded[upgradedOffset + 2] = waterMass;
    upgraded[upgradedOffset + 3] = iceMass;
    upgraded[upgradedOffset + 4] = density;
    upgraded[upgradedOffset + 5] = size;
    upgraded[upgradedOffset + 6] = compactness;
  }
  return upgraded;
}

function printSoilMoisture(soilMoisture_mm)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    return mmToIn(soilMoisture_mm).toFixed(1) + '"'; // inches
  } else
    return soilMoisture_mm.toFixed(1) + ' mm';
}


function printDistance(m)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    let miles = m * kmToMil / 1000;
    let ft = m * mToFt;
    return miles < 1.0 ? ft.toFixed(0) + ' ft' : miles.toFixed(1) + ' miles';
  } else {
    let km = m / 1000;
    return m < 1000 ? m.toFixed(0) + ' m' : km.toFixed(1) + ' km';
  }
}

function printAltitude(meters)
{
  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    let feet = meters * mToFt;
    return feet.toFixed() + ' ft';
  } else
    return meters.toFixed() + ' m';
}

function convertVelocityToSelectedUnit(ms)
{
  switch (guiControls.speedUnit) {
  case 'SPEED_UNIT_KMH':
    return ms * 3.6;
  case 'SPEED_UNIT_MS':
    return ms;
  case 'SPEED_UNIT_MPH':
    return msToMPH(ms);
  case 'SPEED_UNIT_KT':
    return msToKnots(ms);
  }
}

function printVelocity(ms)
{
  let velStr = convertVelocityToSelectedUnit(ms).toFixed();
  switch (guiControls.speedUnit) {
  case 'SPEED_UNIT_KMH':
    return velStr + ' km/h';
  case 'SPEED_UNIT_MS':
    return velStr + ' m/s';
  case 'SPEED_UNIT_MPH':
    return velStr + ' MPH';
  case 'SPEED_UNIT_KT':
    return velStr + ' kt';
  }
}

function printVerticalVelocity(ms)
{
  let veloStr = ms >= 0. ? '+' : '';
  let unitStr = '';

  if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL') {
    veloStr += (ms * 196.8504).toFixed(0);
    unitStr = ' ft/m';
  } else {
    veloStr += ms.toFixed(1);
    unitStr = ' m/s';
  }
  return [ veloStr, unitStr ];
}

function rawVelocityTo_ms(vel)
{                          // Raw velocity is in cells/iteration
  vel /= timePerIteration; // convert to cells per hour
  vel *= cellHeight;       // convert to meters per hour
  vel /= 3600.0;           // convert to m/s
  return vel;
}

function msToRawVelocity(vel)
{                          // Raw velocity is in cells/iteration
  vel *= 3600;             // convert to meters per hour
  vel /= cellHeight;       // convert to cells per hour
  vel *= timePerIteration; // convert to raw (cells per iteration)
  return vel;
}

function CtoK(c) { return c + 273.15; }

function realToPotentialT(realT, y) { return realT + (y / sim_res_y) * dryLapse; }

function potentialToRealT(potentialT, y) { return potentialT - (y / sim_res_y) * dryLapse; }


// Global Classes:

class Vec2D // simple 2D vector
{
  x;
  y;
  constructor(x = 0, y = 0)
  {
    this.x = x;
    this.y = y;
  }
  static fromAngle(angle, mag) // create vector from angle and optional magnitude
  {
    if (mag == null)
      mag = 1.0;
    let x = -Math.cos(angle) * mag;
    let y = Math.sin(angle) * mag;
    return new Vec2D(x, y);
  }

  copy() { return new Vec2D(this.x, this.y); }
  add(other)
  {
    this.x += other.x;
    this.y += other.y;
    return this;
  }
  subtract(other)
  {
    this.x -= other.x;
    this.y -= other.y;
    return this;
  }
  mult(mult)
  {
    this.x *= mult;
    this.y *= mult;
    return this;
  }
  div(div)
  {
    this.x /= div;
    this.y /= div;
    return this;
  }

  rotate(angle) // rotate vector
  {
    let newX = Math.sin(angle) * this.y + Math.cos(angle) * this.x;
    this.y = Math.cos(angle) * this.y - Math.sin(angle) * this.x;
    this.x = newX;
    return this;
  }

  mag() { return Math.sqrt(this.x * this.x + this.y * this.y); } // get magnitude of vector

  magSq() { return this.x * this.x + this.y * this.y; }          // square of magnitude

  angle()                                                        // get angle of vector
  {
    return Math.atan(this.y / -this.x);
  }
}

class FBO // wraps texture, frambuffer and info in one
{
  width;
  height;
  texelSizeX;
  texelSizeY;
  texture;
  frameBuffer;

  constructor(w, h, internalFormat, format, type, texFilter, wrapMode_S)
  {
    this.width = w;
    this.height = h;
    gl.activeTexture(gl.TEXTURE0);
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, texFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, texFilter);

    if (!wrapMode_S)
      wrapMode_S = gl.CLAMP_TO_EDGE;

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode_S);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    this.frameBuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.texelSizeX = 1.0 / this.width;
    this.texelSizeY = 1.0 / this.height;
  }
}

function createHdrFBO() { hdrFBO = new FBO(canvas.width, canvas.height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR); }

function createBloomFBOs()
{
  let res = new Vec2D(canvas.width, canvas.height);

  bloomFBOs.length = 0;           // empty array
  for (let i = 0; i < 100; i++) { // max bloom iterations
    let width = res.x >> i;       // right shift to devide by 2 multiple times
    let height = res.y >> i;

    //  console.log('BloomFBO', i, width, height)

    if (width < 2 || height < 2)
      break; // stop when texture resolution is 2 x 2

    let fbo = new FBO(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
    bloomFBOs.push(fbo);
  }
}


function createAmbientLightFBOs()
{
  emittedLightFBO = new FBO(sim_res_x, sim_res_y, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);

  let res = new Vec2D(sim_res_x, sim_res_y);

  // console.log('createAmbientLightFBOs');

  ambientLightFBOs.length = 0;   // empty array
  for (let i = 0; i < 80; i++) { // max iterations
    let width = res.x >> i;      // right shift to devide by 2 multiple times
    let height = res.y >> i;

    if (width < 2 || height < 2)
      break; // stop when texture width or height is <= 2

    let fbo = new FBO(width, height, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR, gl.REPEAT);
    ambientLightFBOs.push(fbo);
  }
}

class Weatherstation
{
  #width = 120; // 100 display size
  #height = 70; // 55
  #mainDiv;
  #canvas;
  #c; // 2d canvas context
  #x; // position in simulation
  #y;

  #isOnLand = false;
  #isOnWater = false;

  #time;             // ISO time string of moment of last measurement
  #temperature = 0;  // °C
  #dewpoint = 0;     // °C
  #relativeHumd = 0; // %
  #velocity = 0;     // ms
  #soilMoisture = 0; // mm
  #snowHeight = 0;   // cm
  #airQuality = 0;   // AQI
  #waterTemperature = 0;

  #netIRpow = 0;
  #solarPower = 0;

  #chartCanvas;
  #historyChart;

  #displaySunAndIRPower;


  constructor(xIn, yIn)
  {
    this.#x = Math.floor(xIn);
    this.#y = Math.floor(yIn);
    this.#mainDiv = document.createElement('div');
    this.#canvas = document.createElement('canvas');
    this.#mainDiv.appendChild(this.#canvas);
    document.body.appendChild(this.#mainDiv);
    this.#canvas.height = this.#height;
    this.#canvas.width = this.#width;

    this.#mainDiv.style.position = 'absolute';
    this.#mainDiv.style.width = '0px';
    this.#mainDiv.style.height = '0px';
    this.#mainDiv.style.zIndex = 2;

    this.#c = this.#canvas.getContext('2d');

    this.#canvas.style.position = 'absolute';
    this.#canvas.style.zIndex = 1; // z-index

    this.#displaySunAndIRPower = false;

    let thisObj = this;
    this.#canvas.addEventListener('mousedown', function(event) {
      if (event.button == 0) {     // left mouse button
        if (guiControls.tool == 'TOOL_STATION') {
          thisObj.destroy();       // remove weather station
          event.stopPropagation(); // prevent mousedown on body from firing
        } else {
          if (guiControls.dayNightCycle == true) {
            thisObj.#chartCanvas.style.display = (thisObj.#chartCanvas.style.display == 'none') ? 'block' : 'none'; // toggle visibility of chart canvas
          }
        }
      } else if (event.button == 2) {                                   // right mouse button
        thisObj.#displaySunAndIRPower = !thisObj.#displaySunAndIRPower; // toggle display of radiation flux
      }
    });

    this.#canvas.addEventListener('contextmenu', function(event) { event.preventDefault(); }); // Prevent the browser's context menu from appearing

    this.createChartJSCanvas();
  }

  createChartJSCanvas()
  {
    this.#chartCanvas = document.createElement('canvas');

    this.#mainDiv.appendChild(this.#chartCanvas);

    const ctx = this.#chartCanvas.getContext('2d');

    this.#chartCanvas.height = 400;
    this.#chartCanvas.width = 500;

    let style = this.#chartCanvas.style;

    style.marginTop = '100px';

    style.position = 'relative';

    style.left = '-200px';

    style.display = 'none'; // hide initially


    this.#historyChart = new Chart(ctx, {
      type : 'line',
      data : {
        labels : [], // Time-based labels
        datasets : [
          {
            label : 'Temperature',
            data : [],
            backgroundColor : 'rgba(255, 0, 0, 0.9)',
            borderColor : 'rgba(255, 0, 0, 1)',
            radius : 0,
            borderWidth : 1,
            fill : false,
          },
          {
            label : 'Dew Point',
            data : [],
            backgroundColor : '#00FFFF',
            borderColor : '#00FFFF',
            radius : 0,
            borderWidth : 1,
            fill : false,
          },
          {label : 'Wind Speed', data : [], backgroundColor : '#AAAAAA', borderColor : '#AAAAAA', radius : 0, borderWidth : 1, fill : false, hidden : true},                            //
          {label : 'Air Quality', data : [], backgroundColor : '#803c00', borderColor : '#803c00', radius : 0, borderWidth : 1, fill : false, hidden : true},                           //
          {label : 'Precipitation', data : [], backgroundColor : '#0055FF', borderColor : '#0055FF', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true},    //
          {label : 'Snow Height', data : [], backgroundColor : '#FFFFFF', borderColor : '#FFFFFF', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true},      //
          {label : 'Water Temperature', data : [], backgroundColor : '#406cff', borderColor : '#406cff', radius : 0, borderWidth : 1, fill : false, hidden : true, reallyHidden : true} //
        ]
      },
      options : {
        scales : {
          x : {
            type : 'time', // Set the x-axis to use a time scale
            time : {unit : 'minute', tooltipFormat : 'HH:mm'},
            title : {
              display : true,
              color : 'white' // Make sure title color is white
            },
            ticks : {
              color : 'white' // White color for the x-axis labels
            },
            grid : {
              color : 'rgba(255, 255, 255, 0.2)' // Optional: light white for grid lines
            }
          },
          y : {
            beginAtZero : false, // Start the y-axis at 0
            ticks : {
              color : 'white'    // White color for the y-axis labels
            },
            title : {
              display : true,
              color : 'white' // Make sure title color is white
            },
            grid : {
              color : 'rgba(255, 255, 255, 0.2)' // Optional: light white for grid lines
            }
          }
        },
        plugins : {
          legend : {
            display : true,
            labels : {
              color : 'white', // White color for legend text
              font : {
                size : 14,
                family : 'Arial' // Optional: Ensure font family is set
              },
              filter : function(item, chart) { return !chart.datasets[item.datasetIndex].reallyHidden; }
            }
          }
        },
        responsive : false, // Auto rescale on canvas resize
        maintainAspectRatio : false,
        animation : false,  // Disables all animations
        normalized : true
        // parsing : false
      }
    });
  }

  updateChartJS() // add newest measurement to chart
  {
    if (this.#historyChart) {
      this.#historyChart.data.datasets[0].data.push(convertTempToSelectedUnit(this.#temperature));
      this.#historyChart.data.datasets[1].data.push(convertTempToSelectedUnit(this.#dewpoint));
      this.#historyChart.data.datasets[2].data.push(convertVelocityToSelectedUnit(this.#velocity));
      this.#historyChart.data.datasets[3].data.push(this.#airQuality);

      if (this.#isOnLand) {
        this.#historyChart.data.datasets[4].data.push(guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL' ? mmToIn(this.#soilMoisture) : this.#soilMoisture);
        this.#historyChart.data.datasets[5].data.push(guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL' ? mmToIn(this.#snowHeight) : this.#snowHeight);
      } else if (this.#isOnWater) {
        this.#historyChart.data.datasets[6].data.push(convertTempToSelectedUnit(this.#waterTemperature));
      }

      this.#historyChart.data.labels.push(this.#time);

      if (this.#historyChart.data.labels.length > 60 * 24) { // max 24 hour history. Remove the oldest data and label
        this.#historyChart.data.labels.shift();
        this.#historyChart.data.datasets.forEach(dataSet => { dataSet.data.shift(); });
      }

      if (guiControls.dayNightCycle == true) {
        if (this.#chartCanvas.style.display != 'none') // only update if visible
          this.#historyChart.update();
      } else {
        this.#chartCanvas.style.display = 'none';
      }
    }
  }

  clearChart()
  {
    this.#historyChart.data.datasets.forEach(dataSet => { dataSet.data = []; });
    this.#historyChart.data.labels = [];
    this.#historyChart.update();
  }

  destroy()
  {
    this.#chartCanvas.remove();
    this.#canvas.parentElement.removeChild(this.#canvas); // remove canvas element
    let index = weatherStations.indexOf(this);
    weatherStations.splice(index, 1);                     // remove object from array
  }

  measure()
  {
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); // basetexture
    var baseTextureValues = new Float32Array(4 * 3);
    gl.readPixels(this.#x, this.#y - 1, 1, 3, gl.RGBA, gl.FLOAT, baseTextureValues);

    let T = potentialToRealT(baseTextureValues[1 * 4 + 3], this.#y); // temperature in kelvin

    this.#temperature = KtoC(T);
    this.#velocity = rawVelocityTo_ms(Math.sqrt(Math.pow(baseTextureValues[2 * 4 + 0], 2) + Math.pow(baseTextureValues[4 + 1], 2)));

    // gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
    var waterTextureValues = new Float32Array(2 * 4);
    gl.readPixels(this.#x, this.#y - 1, 1, 2, gl.RGBA, gl.FLOAT, waterTextureValues);

    if (waterTextureValues[4 + 0] > 1000.) { // is not air
      this.destroy();                        // remove weather station
      return;
    }

    if (waterTextureValues[0 + 0] > 1001.5) { // water wall
      this.#waterTemperature = KtoC(baseTextureValues[0 + 3]);
    } else {
      this.#waterTemperature = -100.;
    }

    this.#dewpoint = KtoC(dewpoint(waterTextureValues[4 + 0]));

    if (guiControls.realDewPoint) {
      this.#dewpoint = Math.min(this.#temperature, this.#dewpoint);
    }

    this.#relativeHumd = relativeHumd(T, waterTextureValues[4 + 0]);

    if (guiControls.realDewPoint) {
      this.#relativeHumd = Math.min(this.#relativeHumd, 100.0);
    }


    if (waterTextureValues[0] > 1000.5 && waterTextureValues[0] < 1001.5) { // on land surface
      this.#soilMoisture = waterTextureValues[2];
      this.#snowHeight = waterTextureValues[3];

      if (!this.#isOnLand) {
        this.clearChart();
        this.#isOnLand = true;
        this.#isOnWater = false;
        this.#historyChart.data.datasets[4].reallyHidden = false;
        this.#historyChart.data.datasets[5].reallyHidden = false;
        this.#historyChart.data.datasets[6].reallyHidden = true;
      }

    } else if (waterTextureValues[0] > 1001.5) { // on water surface
      if (!this.#isOnWater) {
        this.clearChart();
        this.#isOnWater = true;
        this.#isOnLand = false;
        this.#historyChart.data.datasets[4].reallyHidden = true;
        this.#historyChart.data.datasets[5].reallyHidden = true;
        this.#historyChart.data.datasets[6].reallyHidden = false;
      }
    } else { // in air
      if (this.#isOnLand || this.#isOnWater) {
        this.clearChart();
        this.#isOnLand = false;
        this.#isOnWater = false;
        this.#soilMoisture = 0;
        this.#snowHeight = 0;
        this.#waterTemperature = -10.0;
        this.#historyChart.data.datasets[4].reallyHidden = true;
        this.#historyChart.data.datasets[5].reallyHidden = true;
        this.#historyChart.data.datasets[6].reallyHidden = true;
      }
    }


    this.#airQuality = waterTextureValues[4 + 3] * 300.0; // read smoke

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); // light texture
    var lightTextureValues = new Float32Array(4);
    gl.readPixels(this.#x, this.#y, 1, 1, gl.RGBA, gl.FLOAT, lightTextureValues);

    this.#netIRpow = lightTextureValues[2] - lightTextureValues[3]; // IR_DOWN - IR_UP
    // this.#netIRpow = lightTextureValues[1] / 0.000002; // or calculate from NET_HEATING

    let directSunlight = Math.max(lightTextureValues[0] * Math.sin(guiControls.sunAngle * degToRad), 0.0);

    this.#solarPower = directSunlight;

    this.#time = simDateTime.toISOString();
    this.updateChartJS(); // update chart
  }

  getXpos() { return this.#x; }

  getYpos() { return this.#y; }

  setHidden(hidden)
  {
    this.#mainDiv.style.display = hidden ? 'none' : 'block';
    this.#chartCanvas.style.display = 'none'; // hide charts
  }

  updateCanvas()
  {
    let screenX = simToScreenX(this.#x) - this.#width / 2;
    let screenY = simToScreenY(this.#y) - this.#height;

    // if (screenX > 0 && screenX < canvas.width && screenY > 0 && screenY < canvas.height) {
    this.#mainDiv.style.left = screenX + 'px';
    this.#mainDiv.style.top = screenY + 'px';
    // this.#canvas.style.left = screenX + 'px';
    // this.#canvas.style.top = screenY + 'px';
    let c = this.#c;
    c.clearRect(0, 0, this.#width, this.#height);
    c.fillStyle = '#00000000';
    c.fillRect(0, 0, this.#width, this.#height);

    // temperature
    c.font = '15px Arial';
    c.fillStyle = '#FFFFFF';
    c.fillText(printTemp(this.#temperature), 30, 15);

    if (this.#displaySunAndIRPower) {
      c.font = '12px Arial';
      c.fillStyle = '#00FFFF';
      c.fillText(this.#relativeHumd.toFixed(1) + ' %', 30, 28);

      c.fillStyle = '#FFFFFF';
      c.fillText('🔅 ' + this.#solarPower.toFixed(1) + 'W/m2', 10, 40);
      c.fillStyle = '#FFFFFF';
      c.fillText('♨️' + this.#netIRpow.toFixed(1) + 'W/m2', 10, 55);
    } else {
      c.font = '12px Arial';
      c.fillStyle = '#00FFFF';
      c.fillText(printTemp(this.#dewpoint), 30, 28);

      c.fillStyle = '#FFFFFF';
      c.fillText(printVelocity(this.#velocity), 20, 40);

      if (this.#soilMoisture > 0.) {
        c.fillText(printSoilMoisture(this.#soilMoisture), 0, 52);
        c.fillText('💧', 20, 65);
      } else if (this.#waterTemperature > -1.0) {
        c.fillStyle = '#406cff';
        c.fillText(printTemp(this.#waterTemperature), 0, 52);
        c.fillText('🌊 🌡', 20, 65);
      }

      if (this.#snowHeight > 0.) {
        c.fillText(printSnowHeight(this.#snowHeight), 67, 52);
        c.font = '14px Arial';
        c.fillText('❄', 85, 65);
      }
    }


    // Position pointer
    c.beginPath();
    c.moveTo(this.#width / 2, this.#height * 0.80);
    c.lineTo(this.#width / 2, this.#height);
    c.strokeStyle = 'white';
    c.stroke();
    //  }
  }
}

let radarTowerIconImg = null;
let radarTowerIconLoadPromise = null;
let radarTowerIdCounter = 0;
var selectedRadarTowerId = null;
var radarPanelModeForMarkers = RADAR_PANEL_MODE_SINGLE_STATION;
let radarRangeOverlayCanvas = null;
let radarRangeOverlayCtx = null;
var radarTowerSelectionBridge = null;
var radarTowerRemovedBridge = null;
var radarTowerToolClickBridge = null;
let radarTowerIconSourceRect = null;

function getOpaqueImageBounds(img)
{
  const canvasEl = document.createElement('canvas');
  canvasEl.width = img.naturalWidth || img.width;
  canvasEl.height = img.naturalHeight || img.height;
  const ctx = canvasEl.getContext('2d', {willReadFrequently : true});
  if (!ctx || canvasEl.width <= 0 || canvasEl.height <= 0)
    return {sx : 0, sy : 0, sw : Math.max(1, canvasEl.width), sh : Math.max(1, canvasEl.height)};

  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
  ctx.drawImage(img, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height).data;
  const w = canvasEl.width;
  const h = canvasEl.height;

  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < h; y++) {
    const rowOffset = y * w * 4;
    for (let x = 0; x < w; x++) {
      const alpha = pixels[rowOffset + x * 4 + 3];
      if (alpha > 8) {
        if (x < minX)
          minX = x;
        if (y < minY)
          minY = y;
        if (x > maxX)
          maxX = x;
        if (y > maxY)
          maxY = y;
      }
    }
  }

  if (maxX < minX || maxY < minY)
    return {sx : 0, sy : 0, sw : w, sh : h};

  return {
    sx : minX,
    sy : minY,
    sw : Math.max(1, maxX - minX + 1),
    sh : Math.max(1, maxY - minY + 1),
  };
}

function handleRadarTowerSelectionFromMarker(towerId)
{
  if (!towerId)
    return;

  if (typeof radarTowerSelectionBridge == 'function') {
    radarTowerSelectionBridge(towerId);
    return;
  }

  if (selectedRadarTowerId == towerId) {
    selectedRadarTowerId = null;
    radarPanelModeForMarkers = RADAR_PANEL_MODE_COMPOSITE;
    return;
  }

  selectedRadarTowerId = towerId;
  radarPanelModeForMarkers = RADAR_PANEL_MODE_SINGLE_STATION;
}

function handleRadarTowerRemovedFromMarker(towerId)
{
  if (!towerId)
    return;

  if (typeof radarTowerRemovedBridge == 'function') {
    radarTowerRemovedBridge(towerId);
    return;
  }

  if (selectedRadarTowerId == towerId) {
    selectedRadarTowerId = null;
    radarPanelModeForMarkers = RADAR_PANEL_MODE_COMPOSITE;
  }
}

function ensureRadarTowerIconLoaded()
{
  if (radarTowerIconImg || radarTowerIconLoadPromise)
    return;

  radarTowerIconLoadPromise = loadImage('resources/img/radar_icon.png')
    .catch(() => loadImage('resources/img/radar-tower.png'))
    .then((img) => {
      radarTowerIconImg = img;
      radarTowerIconSourceRect = getOpaqueImageBounds(img);
    })
    .catch(() => {
      radarTowerIconImg = null;
      radarTowerIconSourceRect = null;
    });
}

function handleRadarTowerToolClickFromMarker(towerId)
{
  if (!towerId)
    return;

  if (typeof radarTowerToolClickBridge == 'function') {
    radarTowerToolClickBridge(towerId);
    return;
  }

  handleRadarTowerSelectionFromMarker(towerId);
}

function ensureRadarRangeOverlay()
{
  if (radarRangeOverlayCanvas)
    return;

  radarRangeOverlayCanvas = document.createElement('canvas');
  radarRangeOverlayCanvas.style.position = 'fixed';
  radarRangeOverlayCanvas.style.left = '0px';
  radarRangeOverlayCanvas.style.top = '0px';
  radarRangeOverlayCanvas.style.zIndex = 1;
  radarRangeOverlayCanvas.style.pointerEvents = 'none';
  radarRangeOverlayCanvas.style.display = 'none';
  document.body.appendChild(radarRangeOverlayCanvas);
  radarRangeOverlayCtx = radarRangeOverlayCanvas.getContext('2d');
}

function getSimDomainScreenRect()
{
  const leftEdge = simToScreenX(-0.5);
  const rightEdge = simToScreenX(sim_res_x - 0.5);
  const bottomEdge = simToScreenY(-0.5);
  const topEdge = simToScreenY(sim_res_y - 0.5);
  return {
    left : Math.min(leftEdge, rightEdge),
    right : Math.max(leftEdge, rightEdge),
    top : Math.min(topEdge, bottomEdge),
    bottom : Math.max(topEdge, bottomEdge),
  };
}

function getRadarRangeCircle(tower)
{
  const effective = tower.getEffectiveSettings();
  const rangeCells = effective.rangeKm * 1000.0 / Math.max(cellHeight, 0.000001);
  const x = simToScreenX(tower.getXpos());
  const y = simToScreenY(tower.getYpos());
  return {
    x,
    y,
    r : Math.abs(simToScreenX(tower.getXpos() + rangeCells) - x),
  };
}

function getWrappedRadarRangeCircles(towers, domainRect)
{
  const circles = [];
  const domainWidth = Math.max(0, domainRect.right - domainRect.left);

  for (const tower of towers) {
    const baseCircle = getRadarRangeCircle(tower);
    if (!(baseCircle.r > 1))
      continue;

    if (domainWidth <= 0) {
      circles.push(baseCircle);
      continue;
    }

    circles.push(baseCircle);

    if (!guiControls.wrapHorizontally || !canvas) {
      if (baseCircle.x + baseCircle.r > domainRect.right) {
        circles.push({
          x : baseCircle.x - domainWidth,
          y : baseCircle.y,
          r : baseCircle.r,
        });
      }

      if (baseCircle.x - baseCircle.r < domainRect.left) {
        circles.push({
          x : baseCircle.x + domainWidth,
          y : baseCircle.y,
          r : baseCircle.r,
        });
      }
      continue;
    }

    const minCopy = Math.floor((0 - (baseCircle.x + baseCircle.r)) / domainWidth) - 1;
    const maxCopy = Math.ceil((canvas.width - (baseCircle.x - baseCircle.r)) / domainWidth) + 1;

    for (let copyIndex = minCopy; copyIndex <= maxCopy; copyIndex++) {
      if (copyIndex == 0)
        continue;
      const shiftedX = baseCircle.x + copyIndex * domainWidth;
      if (shiftedX + baseCircle.r < 0 || shiftedX - baseCircle.r > canvas.width)
        continue;

      circles.push({
        x : shiftedX,
        y : baseCircle.y,
        r : baseCircle.r,
      });
    }
  }

  return circles;
}

function isPointInsideRadarOverlayDomain(x, y, domainRect)
{
  const insideVertical = y >= domainRect.top && y <= domainRect.bottom;
  if (!insideVertical)
    return false;
  if (guiControls.wrapHorizontally && canvas)
    return x >= 0 && x <= canvas.width;
  return x >= domainRect.left && x <= domainRect.right;
}

function drawRadarRangeCircle(ctx, circles, alpha)
{
  if (!circles || circles.length == 0)
    return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(196, 204, 214, 0.88)';
  ctx.lineWidth = 2;

  for (let circleIndex = 0; circleIndex < circles.length; circleIndex++) {
    const circle = circles[circleIndex];
    const steps = Math.max(96, Math.min(720, Math.ceil(circle.r * 0.75)));
    let drawingSegment = false;

    ctx.beginPath();
    for (let step = 0; step <= steps; step++) {
      const angle = (step / steps) * Math.PI * 2;
      const x = circle.x + Math.cos(angle) * circle.r;
      const y = circle.y + Math.sin(angle) * circle.r;
      let coveredBySibling = false;

      for (let otherIndex = 0; otherIndex < circles.length; otherIndex++) {
        if (otherIndex == circleIndex)
          continue;
        const other = circles[otherIndex];
        const dx = x - other.x;
        const dy = y - other.y;
        if (dx * dx + dy * dy < (other.r - 1.0) * (other.r - 1.0)) {
          coveredBySibling = true;
          break;
        }
      }

      if (!coveredBySibling) {
        if (!drawingSegment) {
          ctx.moveTo(x, y);
          drawingSegment = true;
        } else {
          ctx.lineTo(x, y);
        }
      } else {
        drawingSegment = false;
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawCompositeRadarCoverage(ctx, towers, domainRect)
{
  const circles = getWrappedRadarRangeCircles(towers, domainRect);
  if (circles.length == 0)
    return;

  ctx.save();
  ctx.strokeStyle = 'rgba(196, 204, 214, 0.72)';
  ctx.lineWidth = 2;

  for (let circleIndex = 0; circleIndex < circles.length; circleIndex++) {
    const circle = circles[circleIndex];
    const steps = Math.max(96, Math.min(720, Math.ceil(circle.r * 0.75)));
    let drawingSegment = false;

    ctx.beginPath();
    for (let step = 0; step <= steps; step++) {
      const angle = (step / steps) * Math.PI * 2;
      const x = circle.x + Math.cos(angle) * circle.r;
      const y = circle.y + Math.sin(angle) * circle.r;
      const insideDomain = isPointInsideRadarOverlayDomain(x, y, domainRect);
      let coveredByOther = false;

      if (insideDomain) {
        for (let otherIndex = 0; otherIndex < circles.length; otherIndex++) {
          if (otherIndex == circleIndex)
            continue;
          const other = circles[otherIndex];
          const dx = x - other.x;
          const dy = y - other.y;
          if (dx * dx + dy * dy < (other.r - 1.0) * (other.r - 1.0)) {
            coveredByOther = true;
            break;
          }
        }
      }

      if (insideDomain && !coveredByOther) {
        if (!drawingSegment) {
          ctx.moveTo(x, y);
          drawingSegment = true;
        } else {
          ctx.lineTo(x, y);
        }
      } else {
        drawingSegment = false;
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawRadarRangeOverlay()
{
  ensureRadarRangeOverlay();

  if (!radarRangeOverlayCtx || !canvas || !guiControls || !guiControls.radarShowRangeRings) {
    if (radarRangeOverlayCanvas)
      radarRangeOverlayCanvas.style.display = 'none';
    return;
  }

  if (radarRangeOverlayCanvas.width != canvas.width)
    radarRangeOverlayCanvas.width = canvas.width;
  if (radarRangeOverlayCanvas.height != canvas.height)
    radarRangeOverlayCanvas.height = canvas.height;

  radarRangeOverlayCanvas.style.width = canvas.width + 'px';
  radarRangeOverlayCanvas.style.height = canvas.height + 'px';
  radarRangeOverlayCanvas.style.display = 'block';

  const ctx = radarRangeOverlayCtx;
  ctx.clearRect(0, 0, radarRangeOverlayCanvas.width, radarRangeOverlayCanvas.height);

  const domainRect = getSimDomainScreenRect();
  const domainWidth = Math.max(0, domainRect.right - domainRect.left);
  const domainHeight = Math.max(0, domainRect.bottom - domainRect.top);
  if (domainWidth <= 0 || domainHeight <= 0)
    return;

  ctx.save();
  ctx.beginPath();
  if (guiControls.wrapHorizontally && canvas)
    ctx.rect(0, domainRect.top, canvas.width, domainHeight);
  else
    ctx.rect(domainRect.left, domainRect.top, domainWidth, domainHeight);
  ctx.clip();

  if (radarPanelModeForMarkers == RADAR_PANEL_MODE_SINGLE_STATION) {
    const selectedTower = radarTowers.find((tower) => tower.getId() == selectedRadarTowerId);
    if (selectedTower && !selectedTower.isHiddenForOverlay())
      drawRadarRangeCircle(ctx, getWrappedRadarRangeCircles([ selectedTower ], domainRect), 0.95);
  } else {
    const enabledTowers = radarTowers.filter((tower) => tower.isEnabled() && !tower.isHiddenForOverlay());
    drawCompositeRadarCoverage(ctx, enabledTowers, domainRect);
  }

  ctx.restore();
}

class RadarTower
{
  #width = 96;
  #height = 120;
  #mainDiv;
  #rangeRingDiv;
  #canvas;
  #ctx;
  #x;
  #y;
  #id;
  #code;
  #maxHeightMeters = 100.0;
  #lastMeasureMs = -Infinity;
  #lightSample = new Float32Array(4);
  #lightBrightness = 1.0;
  #hideBadge = false;
  #badgeHitRect = null;
  #settings;

  constructor(xIn, yIn)
  {
    radarTowerIdCounter += 1;
    this.#id = 'RT_' + radarTowerIdCounter;
    this.#code = 'R' + String(radarTowerIdCounter).padStart(2, '0');
    this.#settings = {
      name : this.#code,
      radarType : 'C',
      enabled : true,
      customRangeKm : RADAR_TYPE_PRESETS.C.rangeKm,
      customResolutionKm : RADAR_TYPE_PRESETS.C.resolutionKm,
      customAttenuation : RADAR_TYPE_PRESETS.C.attenuation,
      customRefreshSec : 2,
      customBeamWidthDeg : RADAR_TYPE_PRESETS.C.beamWidthDeg,
    };
    this.#x = Math.floor(xIn);
    this.#y = Math.floor(yIn);
    this.#mainDiv = document.createElement('div');
    this.#rangeRingDiv = document.createElement('div');
    this.#canvas = document.createElement('canvas');
    this.#mainDiv.appendChild(this.#rangeRingDiv);
    this.#mainDiv.appendChild(this.#canvas);
    document.body.appendChild(this.#mainDiv);
    this.#canvas.height = this.#height;
    this.#canvas.width = this.#width;

    this.#mainDiv.style.position = 'absolute';
    this.#mainDiv.style.width = '0px';
    this.#mainDiv.style.height = '0px';

    this.#ctx = this.#canvas.getContext('2d');

    this.#rangeRingDiv.style.position = 'absolute';
    this.#rangeRingDiv.style.zIndex = 0;
    this.#rangeRingDiv.style.pointerEvents = 'none';
    this.#rangeRingDiv.style.display = 'none';
    this.#rangeRingDiv.style.border = '2px solid rgba(196, 204, 214, 0.46)';
    this.#rangeRingDiv.style.borderRadius = '50%';
    this.#rangeRingDiv.style.boxSizing = 'border-box';
    this.#rangeRingDiv.style.boxShadow = '0 0 16px rgba(6, 17, 38, 0.18)';

    this.#canvas.style.position = 'absolute';
    this.#canvas.style.zIndex = 1;
    this.#canvas.style.cursor = 'default';

    let self = this;
    this.#canvas.addEventListener('mousedown', function(event) {
      if (event.button != 0)
        return;
      const localPos = self.#getLocalCanvasPos(event);
      if (!self.#isPointOnBadge(localPos.x, localPos.y))
        return;

      if (guiControls.tool == 'TOOL_RADAR')
        handleRadarTowerToolClickFromMarker(self.#id);
      else
        handleRadarTowerSelectionFromMarker(self.#id);
      event.stopPropagation();
    });
    this.#canvas.addEventListener('mousemove', function(event) {
      const localPos = self.#getLocalCanvasPos(event);
      self.#canvas.style.cursor = self.#isPointOnBadge(localPos.x, localPos.y) ? 'pointer' : 'default';
    });
    this.#canvas.addEventListener('mouseleave', function() {
      self.#canvas.style.cursor = 'default';
    });
    this.#canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

    ensureRadarTowerIconLoaded();
    this.setHidden(false);
  }

  measure(nowMs)
  {
    const now = nowMs ?? (performance.now ? performance.now() : Date.now());
    const minInterval = Math.max(16, guiControls.reflectivityRefreshSec * 1000.0);
    if (now - this.#lastMeasureMs < minInterval)
      return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(this.#x, this.#y, 1, 1, gl.RGBA, gl.FLOAT, this.#lightSample);

    const directSun = Math.max(this.#lightSample[0], 0.0);
    const ambientIR = Math.max(this.#lightSample[2], 0.0);
    const sunlightNorm = Math.min(directSun / 900.0, 1.0);
    const ambientNorm = Math.min(ambientIR / 300.0, 1.0);
    // Keep tower texture dark at night; brighten mainly with direct sunlight.
    this.#lightBrightness = clamp(0.06 + sunlightNorm * 0.92 + ambientNorm * 0.08, 0.05, 1.15);

    this.#lastMeasureMs = now;
  }

  updateCanvas()
  {
    const selected = selectedRadarTowerId == this.#id && radarPanelModeForMarkers == RADAR_PANEL_MODE_SINGLE_STATION;
    const disabled = this.#settings && this.#settings.enabled === false;
    const markerNow = performance.now ? performance.now() : Date.now();
    const pulse = 0.5 + 0.5 * Math.sin(markerNow * 0.008);

    // Keep tower visualized as fixed 100 m in simulation space.
    const towerHeightInCells = this.#maxHeightMeters / Math.max(cellHeight, 0.000001);
    const groundAnchorSimY = this.#y - 0.5;
    const baseScreenY = simToScreenY(groundAnchorSimY);
    const topScreenY = simToScreenY(groundAnchorSimY + towerHeightInCells);
    const iconH = Math.max(2, Math.round(Math.abs(baseScreenY - topScreenY)));

    const iconAspect = radarTowerIconSourceRect && radarTowerIconSourceRect.sh > 0 ?
      (radarTowerIconSourceRect.sw / radarTowerIconSourceRect.sh) :
      (radarTowerIconImg && radarTowerIconImg.naturalHeight > 0 ? (radarTowerIconImg.naturalWidth / radarTowerIconImg.naturalHeight) : 1.0);
    const iconW = Math.max(2, Math.round(iconH * iconAspect));

    const badgeText = this.#code;
    const c = this.#ctx;
    c.font = '600 16px "Cascadia Code", monospace';
    const badgeTextW = c.measureText(badgeText).width;
    const badgeW = Math.ceil(badgeTextW + 44);
    const badgeH = 32;
    const badgeGroundMargin = 10;
    const sidePad = 6;
    const topPad = 6;
    const bottomPad = 0;

    const contentW = Math.max(iconW, badgeW);
    const contentH = badgeH + badgeGroundMargin + iconH;
    const nextWidth = Math.ceil(contentW + sidePad * 2);
    const nextHeight = Math.ceil(contentH + topPad + bottomPad);

    if (nextWidth != this.#width || nextHeight != this.#height) {
      this.#width = nextWidth;
      this.#height = nextHeight;
      this.#canvas.width = this.#width;
      this.#canvas.height = this.#height;
    }

    const screenX = simToScreenX(this.#x) - this.#width * 0.5;
    const screenY = baseScreenY - this.#height;
    this.#mainDiv.style.left = Math.round(screenX) + 'px';
    this.#mainDiv.style.top = Math.round(screenY) + 'px';
    this.#updateRangeRing(screenX, screenY);

    c.clearRect(0, 0, this.#width, this.#height);
    c.fillStyle = '#00000000';
    c.fillRect(0, 0, this.#width, this.#height);

    const iconX = Math.floor((this.#width - iconW) * 0.5);
    const iconY = this.#height - bottomPad - iconH;
    if (radarTowerIconImg) {
      c.save();
      c.filter = 'brightness(' + Math.round(this.#lightBrightness * 100) + '%)';
      if (radarTowerIconSourceRect) {
        c.drawImage(
          radarTowerIconImg,
          radarTowerIconSourceRect.sx,
          radarTowerIconSourceRect.sy,
          radarTowerIconSourceRect.sw,
          radarTowerIconSourceRect.sh,
          iconX,
          iconY,
          iconW,
          iconH
        );
      } else {
        c.drawImage(radarTowerIconImg, iconX, iconY, iconW, iconH);
      }
      c.restore();
    }

    if (!this.#hideBadge) {
      const badgeX = Math.floor(iconX + (iconW - badgeW) * 0.5);
      const badgeY = Math.floor(iconY - badgeH - badgeGroundMargin);
      this.#badgeHitRect = {x : badgeX, y : badgeY, w : badgeW, h : badgeH};

      c.fillStyle = disabled ? 'rgba(44, 12, 16, 0.94)' : 'rgba(6, 17, 38, 0.94)';
      this.#roundRect(c, badgeX, badgeY, badgeW, badgeH, 11);
      c.fill();

      c.lineWidth = selected ? 1.25 : 1;
      c.strokeStyle = disabled ? 'rgba(255, 108, 108, 0.72)' :
                     (selected ? 'rgba(123, 203, 255, 0.78)' : 'rgba(255, 255, 255, 0.18)');
      this.#roundRect(c, badgeX + 0.5, badgeY + 0.5, badgeW - 1, badgeH - 1, 10);
      c.stroke();

      if (selected) {
        c.save();
        c.globalAlpha = 0.28 + pulse * 0.28;
        c.shadowColor = disabled ? 'rgba(255, 82, 82, 0.95)' : 'rgba(76, 179, 255, 0.95)';
        c.shadowBlur = 12 + pulse * 10;
        c.strokeStyle = disabled ? 'rgba(255, 104, 104, 0.95)' : 'rgba(116, 205, 255, 0.95)';
        c.lineWidth = 1.8;
        this.#roundRect(c, badgeX - 0.5, badgeY - 0.5, badgeW + 1, badgeH + 1, 11);
        c.stroke();
        c.restore();
      }

      c.font = '600 16px "Cascadia Code", monospace';
      c.fillStyle = disabled ? '#ffd3d3' : (selected ? '#ffffff' : '#eaf1ff');
      c.fillText(badgeText, badgeX + 12, badgeY + 22);

      const ledX = badgeX + badgeW - 15;
      const ledY = badgeY + badgeH * 0.5;
      c.beginPath();
      c.arc(ledX, ledY, 3.2, 0, Math.PI * 2);
      c.fillStyle = disabled ? '#ff4f4f' : '#35e77e';
      c.fill();

      if (selected) {
        c.save();
        c.globalAlpha = 0.42 + pulse * 0.32;
        c.beginPath();
        c.arc(ledX, ledY, 5.8 + pulse * 1.8, 0, Math.PI * 2);
        c.strokeStyle = disabled ? '#ff7a7a' : '#68f3a0';
        c.lineWidth = 1.2;
        c.stroke();
        c.restore();
      }
    } else {
      this.#badgeHitRect = null;
    }
  }

  #updateRangeRing(markerScreenX, markerScreenY)
  {
    if (!this.#rangeRingDiv)
      return;

    this.#rangeRingDiv.style.display = 'none';
  }

  setHidden(hidden)
  {
    this.#hideBadge = !!hidden;
    this.#badgeHitRect = null;
    this.#canvas.style.cursor = 'default';
    this.#mainDiv.style.display = 'block';
  }

  #getLocalCanvasPos(event)
  {
    const rect = this.#canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.#canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.#canvas.height / rect.height : 1;
    return {
      x : (event.clientX - rect.left) * scaleX,
      y : (event.clientY - rect.top) * scaleY,
    };
  }

  #isPointOnBadge(x, y)
  {
    if (!this.#badgeHitRect || this.#hideBadge)
      return false;
    return x >= this.#badgeHitRect.x &&
           x <= this.#badgeHitRect.x + this.#badgeHitRect.w &&
           y >= this.#badgeHitRect.y &&
           y <= this.#badgeHitRect.y + this.#badgeHitRect.h;
  }

  #roundRect(ctx, x, y, width, height, radius)
  {
    const r = Math.min(radius, width * 0.5, height * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  getId() { return this.#id; }
  getCode() { return this.#code; }
  getSettings() { return this.#settings; }
  isEnabled() { return this.#settings.enabled !== false; }
  isHiddenForOverlay() { return this.#hideBadge; }
  getEffectiveSettings() { return getEffectiveRadarSettings(this.#settings); }

  setName(nextName)
  {
    const cleaned = String(nextName || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 4);
    this.#settings.name = cleaned;
    this.#code = cleaned;
  }

  setRadarType(nextType)
  {
    if (nextType != 'X' && nextType != 'C' && nextType != 'S' && nextType != 'CUSTOM')
      return;
    this.#settings.radarType = nextType;
  }

  setEnabled(enabled)
  {
    this.#settings.enabled = !!enabled;
  }

  setCustomRangeKm(value) { this.#settings.customRangeKm = value; }
  setCustomResolutionKm(value) { this.#settings.customResolutionKm = value; }
  setCustomAttenuation(value) { this.#settings.customAttenuation = value; }
  setCustomRefreshSec(value) { this.#settings.customRefreshSec = value; }
  setCustomBeamWidthDeg(value) { this.#settings.customBeamWidthDeg = value; }
  getXpos() { return this.#x; }
  getYpos() { return this.#y; }

  destroy()
  {
    if (this.#mainDiv && this.#mainDiv.parentNode)
      this.#mainDiv.parentNode.removeChild(this.#mainDiv);
    let idx = radarTowers.indexOf(this);
    if (idx >= 0) {
      radarTowers.splice(idx, 1);
      handleRadarTowerRemovedFromMarker(this.#id);
    }
  }
}


let weatherStations = []; // array holding all weather stations
let radarTowers = [];    // array holding all radar towers
let radarNeedsMeasure = false;


async function loadData()
{
  let file = document.getElementById('fileInput').files[0];

  if (file) {                                                    // load data from save file
    let versionBlob = file.slice(0, 4);                          // extract first 4 bytes containing version id
    let versionBuf = await versionBlob.arrayBuffer();
    let version = new Uint32Array(versionBuf)[0];                // convert to Uint32

    if (version == saveFileVersionID || version == previousSaveFileVersionID || version == legacySaveFileVersionID || version == olderLegacySaveFileVersionID) {
      // check version id, only proceed if file has the right version id
      let fileArrBuf = await file.slice(4).arrayBuffer(); // slice from behind version id to
      // the end of the file
      let fileUint8Arr = new Uint8Array(fileArrBuf);        // convert to Uint8Array for pako
      let decompressed = window.pako.inflate(fileUint8Arr); // uncompress
      let dataBlob = new Blob([ decompressed ]);            // turn into blob

      let sliceStart = 0;
      let sliceEnd = 4;

      let resBlob = dataBlob.slice(sliceStart, sliceEnd); // extract first 4 bytes containing resolution
      let resBuf = await resBlob.arrayBuffer();
      resArray = new Uint16Array(resBuf);
      sim_res_x = resArray[0];
      sim_res_y = resArray[1];

      NUM_DROPLETS = (sim_res_x * sim_res_y) / NUM_DROPLETS_DEVIDER;

      saveFileName = file.name;

      if (saveFileName.includes('.')) {
        saveFileName = saveFileName.split('.').slice(0, -1).join('.'); // remove extension
      }

      console.log('loading file: ' + saveFileName);
      console.log('File versionID: ' + version);
      console.log('sim_res_x: ' + sim_res_x);
      console.log('sim_res_y: ' + sim_res_y);


      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 4;
      let baseTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let baseTexBuf = await baseTexBlob.arrayBuffer();
      let baseTexF32 = new Float32Array(baseTexBuf);

      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 4; // 4 * float
      let waterTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let waterTexBuf = await waterTexBlob.arrayBuffer();
      let waterTexF32 = new Float32Array(waterTexBuf);

      sliceStart = sliceEnd;
      sliceEnd += sim_res_x * sim_res_y * 4 * 1; // 4 * byte
      let wallTexBlob = dataBlob.slice(sliceStart, sliceEnd);
      let wallTexBuf = await wallTexBlob.arrayBuffer();
      let wallTexI8 = new Int8Array(wallTexBuf);

      const loadedValsPerDroplet = version == saveFileVersionID ? valsPerDroplet :
                                   version == previousSaveFileVersionID ? previousValsPerDroplet : legacyValsPerDroplet;

      sliceStart = sliceEnd;
      sliceEnd += NUM_DROPLETS * Float32Array.BYTES_PER_ELEMENT * loadedValsPerDroplet;
      let precipArrayBlob = dataBlob.slice(sliceStart, sliceEnd);
      let precipArrayBuf = await precipArrayBlob.arrayBuffer();
      let precipArray = new Float32Array(precipArrayBuf);
      if (loadedValsPerDroplet != valsPerDroplet)
        precipArray = upgradeLegacyPrecipArray(precipArray, loadedValsPerDroplet);

      if (version != olderLegacySaveFileVersionID) {
        sliceStart = sliceEnd;
        sliceEnd += 1 * Int16Array.BYTES_PER_ELEMENT; // one 16 bit int indicates number of weather stations
        let numWeatherStationsArrayBlob = dataBlob.slice(sliceStart, sliceEnd);
        let numWeatherStationsBuf = await numWeatherStationsArrayBlob.arrayBuffer();
        let numWeatherStations = new Int16Array(numWeatherStationsBuf)[0];

        console.log('numWeatherStations', numWeatherStations);

        sliceStart = sliceEnd;
        sliceEnd += numWeatherStations * 2 * Int16Array.BYTES_PER_ELEMENT;
        let weatherStationArrayBlob = dataBlob.slice(sliceStart, sliceEnd);
        let weatherStationBuf = await weatherStationArrayBlob.arrayBuffer();
        let weatherStationArray = new Int16Array(weatherStationBuf);


        for (i = 0; i < numWeatherStations; i++) {
          weatherStations.push(new Weatherstation(weatherStationArray[i * 2], weatherStationArray[i * 2 + 1]));
        }

        sliceStart = sliceEnd;
        let settingsArrayBlob = dataBlob.slice(sliceStart); // until end of file


        guiControlsFromSaveFile = await settingsArrayBlob.text();
      } else if (version == olderLegacySaveFileVersionID) {
        alert('Save File from older version, settings will not be loaded');
      }

      mainScript(baseTexF32, waterTexF32, wallTexI8, precipArray);
    } else {
      // wrong id
      alert('Incompatible file!');
      document.getElementById('fileInput').value = ''; // clear file
    }
  } else {
    // no file, so create new simulation
    sim_res_x = parseInt(document.getElementById('simResSelX').value);
    sim_res_y = parseInt(document.getElementById('simResSelY').value);
    sim_height = parseInt(document.getElementById('simHeightSel').value);

    NUM_DROPLETS = (sim_res_x * sim_res_y) / NUM_DROPLETS_DEVIDER;
    SETUP_MODE = true;

    mainScript(null); // run without initial textures
  }
}

function loadImage(url)
{
  return new Promise((resolve, reject) => {
    let img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

class LoadingBar
{
  #loadingBar;
  #bar;
  #underBar;
  #percent;
  #description;

  constructor(percentIn)
  {
    if (percentIn == null)
      this.percent = 0;
    else
      this.percent = percentIn;

    // create html
    this.loadingBar = document.createElement('div');
    this.bar = document.createElement('div');
    this.loadingBar.appendChild(this.bar);

    this.underBar = document.createElement('div');
    this.loadingBar.appendChild(this.underBar);

    this.loadingBar.style.width = '100%';
    this.loadingBar.style.height = '100px';
    this.loadingBar.style.color = 'white';
    this.loadingBar.style.textAlign = 'center';
    this.loadingBar.style.lineHeight = '50px';
    this.loadingBar.style.backgroundColor = 'gray';
    this.loadingBar.style.marginTop = '400px';
    this.loadingBar.style.position = 'absolute';
    this.loadingBar.style.zIndex = '2';

    this.underBar.style.width = '100%';
    this.underBar.style.height = '50px';
    this.underBar.style.backgroundColor = 'black';

    this.bar.style.height = '50px';

    this.bar.style.backgroundColor = 'green';
    this.bar.style.fontSize = '20px';

    this.#update();

    document.body.appendChild(this.loadingBar);
  }

  async add(num, text)
  {
    this.percent += num;
    this.description = text;
    await this.#update();
  }

  async set(num, text)
  {
    this.percent = num;
    this.description = text;
    await this.#update();
  }

  async showError(error)
  {
    this.bar.style.backgroundColor = 'red';
    this.description = error;
    await this.#update();
  }

  #update()
  {
    return new Promise((resolve) => {
      this.bar.style.width = this.percent + '%';
      this.bar.innerHTML = this.percent + '%';
      this.underBar.innerHTML = this.description;
      let timeout;
      if (this.percent == 100)
        timeout = 5;
      else
        timeout = 5; // 50 for nicer feel
      setTimeout(() => { resolve(); }, timeout);
    });
  }

  remove() { this.loadingBar.parentNode.removeChild(this.loadingBar); }
}


function setLoadingBar()
{
  return new Promise((resolve) => {
    document.body.classList.add('game-active');
    var element = document.getElementById('IntroScreen');
    element.parentNode.removeChild(element); // remove introscreen div

    document.body.style.backgroundColor = 'black';

    loadingBar = new LoadingBar(1);

    setTimeout(() => { resolve(); }, 10);
  });
}

var soundingData;
var soundingDiagnostics = {
  tempC : null,
  dewC : null,
  rh : null,
  cape : null,
  mlCape : null,
  sbCape : null,
  cape03 : null,
  pwat : null,
  cin : null,
  mlCin : null,
  lr03 : null,
  lr36 : null,
  lcl : null,
};

// Ensure the sounding panel HTML exists (created dynamically so it's not in the intro DOM)
function ensureSoundingPanel()
{
  if (document.getElementById('soundingPanel'))
    return;

  const panelHtml = `
    <div id="soundingPanel" class="sounding-panel" style="display:none;">
      <div class="sounding-panel__header">
        <h3 class="sounding-panel__title">Sounding View</h3>
        <div class="sounding-panel__meta" id="soundingMeta">Live CAPE/CIN values for current probe</div>
      </div>
      <div class="sounding-graph-wrapper" id="soundingGraphWrapper">
        <canvas id="graphCanvas"></canvas>
      </div>
      <div class="sounding-tables">
        <div class="sounding-table">
          <table>
            <thead>
              <tr>
                <th>TEMP. (°C)</th>
                <th>DEW POINT (°C)</th>
                <th>SURFACE RH (%)</th>
                <th>CAPE (J/kg)</th>
                <th>MLCAPE (J/kg)</th>
                <th>MUCAPE (J/kg)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td id="tempVal">--</td>
                <td id="dewVal">--</td>
                <td id="rhVal">--</td>
                <td id="capeVal">--</td>
                <td id="mlCapeVal">--</td>
                <td id="sbCapeVal">--</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sounding-table">
          <table>
            <thead>
              <tr>
                <th>CIN (J/kg)</th>
                <th>MLCIN (J/kg)</th>
                <th>0-3 km LR (°C/km)</th>
                <th>3-6 km LR (°C/km)</th>
                <th>0-6 LCL (m)</th>
                <th>PWAT (mm)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td id="cinVal">--</td>
                <td id="mlCinVal">--</td>
                <td id="lr03Val">--</td>
                <td id="lr36Val">--</td>
                <td id="lclVal">--</td>
                <td id="pwatVal">--</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const container = document.createElement('div');
  container.innerHTML = panelHtml.trim();
  document.body.appendChild(container.firstChild);
}

function updateSoundingDiagnosticsUI()
{
  const formatVal = (v) => Number.isFinite(v) ? Math.round(v) : '--';
  const ids = {
    tempC : 'tempVal',
    dewC : 'dewVal',
    rh : 'rhVal',
    cape : 'capeVal',
    mlCape : 'mlCapeVal',
    sbCape : 'sbCapeVal',
    pwat : 'pwatVal',
    cin : 'cinVal',
    mlCin : 'mlCinVal',
    lr03 : 'lr03Val',
    lr36 : 'lr36Val',
    lcl : 'lclVal',
  };

  for (const [key, id] of Object.entries(ids)) {
    const el = document.getElementById(id);
    if (el)
      el.textContent = formatVal(soundingDiagnostics[key]);
  }
}

function resizeSoundingCanvas()
{
  ensureSoundingPanel();
  const wrapper = document.getElementById('soundingGraphWrapper');
  const canvas = document.getElementById('graphCanvas');
  if (!wrapper || !canvas)
    return;

  const width = wrapper.clientWidth || Math.min(window.innerWidth, 760);
  const availableHeight = wrapper.clientHeight ? (wrapper.clientHeight - 16) : (window.innerHeight - 120);
  const height = Math.max(420, Math.min(availableHeight, width, window.innerHeight - 120));

  canvas.width = width;
  canvas.height = height;
}

async function prepareSounding()
{
  const dateSel = document.getElementById('datePicker');
  const date = new Date(dateSel.value);
  let epochTime = Math.floor(date.getTime() / 1000);

  const hourSelector = document.getElementById('hourSelector');
  const hour = hourSelector.options[hourSelector.selectedIndex].value;

  epochTime += hour * 3600;

  soundingData = await loadSounding(stationSelector.options[stationSelector.selectedIndex].value, epochTime);
}

async function mainScript(initialBaseTex, initialWaterTex, initialWallTex, initialRainDrops)
{


  await setLoadingBar();
  ensureSoundingPanel();

  let lastSaveTime = new Date();

  class Camera
  {
    #spring = 0.02;   // 0.02
    #damp = 0.70;     // 0.70
    wrapHorizontally; // bool
    smooth;           // bool
    curXpos;
    curXposLin;
    curYpos;
    curZoom;
    tarXpos;
    tarYpos;
    tarZoom;
    #Xvel;
    #Yvel;
    #Zvel;

    constructor()
    {
      this.curXpos = 0;
      this.curXposLin = 0;
      this.curYpos = -0.5 + sim_res_y / sim_res_x; // viewYpos = -0.5 + sim_res_y / sim_res_x;// match bottem of sim area to bottem of screen
      this.curZoom = 1.0001;
      this.tarXpos = 0;
      this.tarYpos = -0.5 + sim_res_y / sim_res_x;
      this.tarZoom = 1.0001;
      this.wrapHorizontally = true;
      this.smooth = true;
      this.#Xvel = 0;
      this.#Yvel = 0;
      this.#Zvel = 0;
    }

    center()
    {
      this.tarXpos = this.curXpos = this.curXposLin = 0.0;
      this.tarYpos = this.curYpos = -0.5 + sim_res_y / sim_res_x;
      this.tarZoom = this.curZoom = 1.0001;
      this.#Xvel = 0;
      this.#Yvel = 0;
      this.#Zvel = 0;
    }

    changeCurXpos(change)
    {
      this.curXposLin = this.curXposLin + change;
      this.curXpos = mod(this.curXposLin + 1.0, 2.0) - 1.0;
    }

    setPosition(x, y, zoom)
    {
      this.curXpos = this.tarXpos = x;
      this.curYpos = this.tarYpos = y;

      if (zoom)
        this.curZoom = this.tarZoom = zoom;
    }

    move()
    {
      let xDif = this.tarXpos - this.curXposLin;
      let yDif = this.tarYpos - this.curYpos;
      let zoomDif = this.tarZoom - this.curZoom;
      if (this.smooth) {
        this.#Xvel += xDif * this.#spring;
        this.#Xvel *= this.#damp;
        this.changeCurXpos(this.#Xvel);

        this.#Yvel += yDif * this.#spring;
        this.#Yvel *= this.#damp;
        this.curYpos += this.#Yvel;

        this.#Zvel += zoomDif * this.#spring;
        this.#Zvel *= this.#damp;
        this.curZoom += this.#Zvel;
      } else {
        this.changeCurXpos(xDif);
        this.curYpos += yDif;
        this.curZoom += zoomDif;
      }

      if (guiControls.sound && !guiControls.paused) {
        soundSystem.updateAmbientSound(this.curXpos, this.curYpos, this.curZoom);
      }
    }

    changeViewZoom(change)
    {
      this.tarZoom *= 1.0 + change;

      let minZoom = 0.5;
      let maxZoom = 35.0 * sim_aspect;

      if (this.tarZoom > maxZoom) {
        this.tarZoom = maxZoom;
        return false;
      } else if (this.tarZoom < minZoom) {
        this.tarZoom = minZoom;
        return false;
      } else {
        return true;
      }
    }

    changeViewXpos(change)
    {
      this.tarXpos += change;
      if (!this.wrapHorizontally)
        this.tarXpos = clamp(this.tarXpos, -0.99, 0.99);
    }

    changeViewYpos(change) { this.tarYpos = clamp(this.tarYpos + change, -2.50, 0.50); }

    zoomAtMousePos(delta)
    {
      if (cam.changeViewZoom(delta)) {
        // zoom center at mouse position
        var mousePositionZoomCorrectionX = (((mouseX - canvas.width / 2 + this.tarXpos) * delta) / cam.tarZoom / canvas.width) * 2.0;
        var mousePositionZoomCorrectionY = ((((mouseY - canvas.height / 2 + this.tarYpos) * delta) / cam.tarZoom / canvas.height) * 2.0) / canvas_aspect;
        this.changeViewXpos(-mousePositionZoomCorrectionX);
        this.changeViewYpos(mousePositionZoomCorrectionY);
      }
    }
  }

  cam = new Camera();

  class JetEngineSoundGenerator
  {
    constructor(ctx) { this.audioCtx = ctx; }

    createSource(bufferSize)
    {
      const bufferSource = this.audioCtx.createBufferSource();
      bufferSource.buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      return bufferSource;
    }

    createLowNoiseSource()
    {
      const bufferSize = 20 * this.audioCtx.sampleRate;
      const bufferSource = this.createSource(bufferSize);
      const data = bufferSource.buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 2)
        data[i] = Math.random() * 2 - 1;
      for (let i = 1; i < bufferSize - 1; i += 2)   // Fill in the gaps
        data[i] = (data[i - 1] + data[i + 1]) / 2.; // average of surrounding samples
      return bufferSource;
    }

    start()
    {
      // High-pitch turbine whine
      this.lowWhine = this.audioCtx.createOscillator();
      this.lowWhine.type = "sine";
      this.lowWhineGain = this.audioCtx.createGain();

      this.highWhine = this.audioCtx.createOscillator();
      this.highWhine.type = "sine";
      this.highWhineGain = this.audioCtx.createGain();

      // low rumble noise
      this.lowNoiseSource = this.createLowNoiseSource();
      this.lowNoiseSource.loop = true;
      this.lowNoiseFilter = this.audioCtx.createBiquadFilter();
      this.lowNoiseFilter.type = "lowpass";
      this.lowNoiseFilter.Q.value = 5.5;
      this.lowNoiseGain = this.audioCtx.createGain();

      // stereo pan
      this.pan = this.audioCtx.createStereoPanner();

      // Master mix
      this.mix = this.audioCtx.createGain();
      this.mix.gain.value = 0.;

      // Connect graph
      this.lowWhine.connect(this.lowWhineGain).connect(this.mix);
      this.highWhine.connect(this.highWhineGain).connect(this.mix);
      this.lowNoiseSource.connect(this.lowNoiseFilter).connect(this.lowNoiseGain).connect(this.mix);
      this.mix.connect(this.pan).connect(this.audioCtx.destination);

      // Start
      this.lowWhine.start();
      this.highWhine.start();
      this.lowNoiseSource.start();
    }

    update(N1, dist, horizontalAngle)
    {
      const rpm = N1 * 7000;
      const whineFreq = 100 + rpm * 1.0; // 300 + rpm * 0.8;
      const noiseFreq = N1 * 600;        // 200 + N1 * 300;

      this.lowWhine.frequency.value = whineFreq / 2.;
      this.highWhine.frequency.value = whineFreq;
      this.lowNoiseFilter.frequency.value = noiseFreq;

      const airVol = Math.sqrt(N1) * 3.;
      const whineVol = Math.sqrt(Math.min(N1, 0.3)) * 0.005;

      this.lowNoiseGain.gain.value = airVol;
      this.lowWhineGain.gain.value = whineVol;
      this.highWhineGain.gain.value = whineVol;

      dist += 1.0; // prevent devide by 0

      this.pan.pan.value = -horizontalAngle / 90.;
      this.mix.gain.value = 170.0 / dist;
    }

    mute() { this.mix.gain.value = 0.; }

    stop()
    {
      this.mix.gain.value = 0;
      this.lowWhine.stop();
      this.highWhine.stop();
      this.lowNoiseSource.stop();
    }
  }

  class SoundSystem
  {
    audioCtx;
    jetEngineSound;

    thunderCCSounds = [];
    thunderCGSounds = [];

    urban_sound;
    forest_sound;
    beach_sound;
    rain_sound;
    wind_sound;


    constructor()
    {
      this.audioCtx = new window.AudioContext();
      this.jetEngineSound = new JetEngineSoundGenerator(this.audioCtx);
      // load sound files asynchronously
      this.loadThunderSounds('cc', 13).then(buffers => { this.thunderCCSounds = buffers; });
      this.loadThunderSounds('cg', 13).then(buffers => { this.thunderCGSounds = buffers; });

      this.loadSound('urban.m4a').then(buffer => { this.urban_sound = this.playLoop(buffer, 0.0); });
      this.loadSound('forest.mp3').then(buffer => { this.forest_sound = this.playLoop(buffer, 0.0); });
      this.loadSound('beach.mp3').then(buffer => { this.beach_sound = this.playLoop(buffer, 0.0); });
      this.loadSound('rain.m4a').then(buffer => { this.rain_sound = this.playLoop(buffer, 0.0); });
      this.loadSound('wind.m4a').then(buffer => { this.wind_sound = this.playLoop(buffer, 0.0); });
    }

    async loadSound(url)
    {
      const resp = await fetch('resources/sounds/' + url);
      const arrayBuffer = await resp.arrayBuffer();
      return await this.audioCtx.decodeAudioData(arrayBuffer);
    }

    async loadThunderSounds(name, num)
    {
      const soundPromises = [];
      for (let i = 1; i <= num; i++) {
        const filename = name + `${i}.m4a`;
        soundPromises.push(this.loadSound(filename));
      }
      return await Promise.all(soundPromises);
    }

    soundThunder(x, y, intensity)
    {
      let camXnorm = 1. - (cam.curXpos + 1.0) / 2.0;

      let camDistFromSim = cellHeight * sim_res_x * 0.5 / cam.curZoom; // asuming 90° HFOV

      let camHorDistFromStrike = (x - camXnorm) * cellHeight * sim_res_x;

      let vecStrikeToCam = new Vec2D(camDistFromSim, camHorDistFromStrike);

      let distance = vecStrikeToCam.mag();

      let leftRightBalance = -vecStrikeToCam.angle();

      // console.log(camDistFromSim, camHorDistFromStrike, distance, leftRightBalance);

      // Speed of sound ≈ 343 m/s
      let soundDelay = distance / 343;                                            // in seconds

      let simTimeMult = timePerIteration * guiControls.IterPerFrame * FPS * 3600; // how much faster sime time is than real time

      soundDelay /= simTimeMult;

      let soundArray = intensity > 1.0 ? this.thunderCGSounds : this.thunderCCSounds;
      let randomThunderSound = soundArray[Math.floor(Math.random() * soundArray.length)];
      this.playOnce(randomThunderSound, intensity / (distance * 0.001), leftRightBalance, soundDelay);
    }

    playOnce(buffer, volume = 1, leftRightBalance = 0, delay = 0)
    {
      const src = this.audioCtx.createBufferSource();
      const gain = this.audioCtx.createGain();
      const pan = this.audioCtx.createStereoPanner();
      src.buffer = buffer;
      src.loop = false;
      gain.gain.value = volume;
      pan.pan.value = clamp(leftRightBalance, -1., 1.);
      src.connect(gain).connect(pan).connect(this.audioCtx.destination);
      src.start(this.audioCtx.currentTime + delay);
    }

    playLoop(buffer, volume = 1, leftRightBalance = 0)
    {
      const src = this.audioCtx.createBufferSource();
      const gain = this.audioCtx.createGain();
      const pan = this.audioCtx.createStereoPanner();
      src.buffer = buffer;
      src.loop = true;
      gain.gain.value = volume;
      pan.pan.value = clamp(leftRightBalance, -1., 1.);
      src.connect(gain).connect(pan).connect(this.audioCtx.destination);
      src.start();
      return {gain : gain.gain, pan : pan.pan};
    }

    updateAmbientSound(Xpos, Ypos, zoom)
    {
      let camDistFromSim = cellHeight * sim_res_x * 0.5 / zoom; // asuming 90° HFOV

      if (camDistFromSim < 5000) {

        const sampleWidth = Math.floor(clamp(camDistFromSim / cellHeight * 3, 30, 200)); // sample just a litte wider than the fov
        const sampleWidth_2 = Math.floor(sampleWidth / 2);
        const sampleWidth_3 = Math.floor(sampleWidth / 3);

        let simXpos = Math.floor((-Xpos + 1) * 0.5 * sim_res_x);
        let simYpos = clamp(Math.floor((-Ypos * sim_aspect + 1) * 0.5 * sim_res_y), 0, sim_res_y - 1);

        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
        gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture
        var wallTextureValues = new Int8Array(4 * sampleWidth);
        gl.readPixels(simXpos - sampleWidth_2, simYpos, sampleWidth, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

        let cellsAboveSurface = wallTextureValues[sampleWidth_2 * 4 + 2];

        let camHeightAboveSurface = cellsAboveSurface * cellHeight;

        let vecCamToSurface = new Vec2D(camDistFromSim, camHeightAboveSurface);

        let distanceToSurface = vecCamToSurface.mag();

        let forest = new Vec2D();
        let beach = new Vec2D();
        let urban = new Vec2D();

        let distVolumeMult = map_range_C(1.0 / (clamp(distanceToSurface, 1000, 5000) / 1000.0), 0.2, 1.0, 0.0, 1.0); // multiplier based on camera distance to surface

        for (let i = 0; i < sampleWidth; i++) {

          let Lgain = clamp((sampleWidth_3 - Math.abs(i - sampleWidth_3)) / (sampleWidth_3 * sampleWidth_3), 0., 1.);
          let Rgain = clamp((sampleWidth_3 - Math.abs(i - sampleWidth_3 * 2)) / (sampleWidth_3 * sampleWidth_3), 0., 1.);
          let gain = new Vec2D(Lgain, Rgain);

          if (wallTextureValues[i * 4 + 0] == 1) { // land vegetation
            let vegetationNorm = wallTextureValues[i * 4 + 3] / 127.0;
            forest.add(gain.mult(vegetationNorm));
          } else if (wallTextureValues[i * 4 + 0] == 2) {                                      // water
            beach.add(gain);
          } else if (wallTextureValues[i * 4 + 0] == 4 || wallTextureValues[i * 4 + 0] == 6) { // urban or industrial
            urban.add(gain);
          }
        }

        forest.mult(distVolumeMult * 0.15);
        beach.mult(distVolumeMult * 1.0);
        urban.mult(distVolumeMult * 1.0);

        this.setSoundLeftRight(this.forest_sound, forest.x, forest.y);
        this.setSoundLeftRight(this.beach_sound, beach.x, beach.y);
        this.setSoundLeftRight(this.urban_sound, urban.x, urban.y);

        // wind sound
        gl.readBuffer(gl.COLOR_ATTACHMENT0); // basetexture
        var baseTextureValues = new Float32Array(4);
        let justAboveSurfaceCellY = simYpos - cellsAboveSurface + 3;
        gl.readPixels(simXpos, justAboveSurfaceCellY, 1, 1, gl.RGBA, gl.FLOAT, baseTextureValues); // read single cell at mouse position

        let windVolume = Math.abs(baseTextureValues[0]) * 10.0;

        windVolume *= distVolumeMult;

        this.setSoundGainAndPan(this.wind_sound, windVolume);

        let tempC = KtoC(potentialToRealT(baseTextureValues[3], justAboveSurfaceCellY));

        // rain sound

        let rainVolume = 0;

        if (tempC > 0) {

          gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
          var waterTextureValues = new Float32Array(4);

          gl.readPixels(simXpos, justAboveSurfaceCellY, 1, 1, gl.RGBA, gl.FLOAT, waterTextureValues);

          rainVolume = Math.pow(waterTextureValues[2] * 0.5, 0.5);

          rainVolume *= map_range_C(tempC, 0., 3., 0., 1.); // rain sound fades as temperature approaches 0 (wet snow)

          rainVolume *= distVolumeMult;
        }

        this.setSoundGainAndPan(this.rain_sound, rainVolume);

        //    console.log(distVolumeMult, rainVolume, windVolume);
      }

      if (airplaneMode) {
        let camXnorm = 1. - (cam.curXpos + 1.0) / 2.0;
        let camYnorm = 1. - (cam.curYpos * sim_aspect + 1.0) / 2.0;

        //    console.log(camXnorm, airplane.phys.pos.x);

        const vecCamToPlaneOnFlatSimArea = airplane.phys.pos.copy().subtract(new Vec2D(camXnorm * cellHeight * sim_res_x, camYnorm * cellHeight * sim_res_y));

        const distCamToPlane = new Vec2D(vecCamToPlaneOnFlatSimArea.mag(), camDistFromSim).mag();

        const horizontalAngleCamToPlane = new Vec2D(camDistFromSim, vecCamToPlaneOnFlatSimArea.x).angle() * radToDeg;

        this.jetEngineSound.update(airplane.getN1(), distCamToPlane, horizontalAngleCamToPlane);
      }
    }

    setSoundLeftRight(sound, L, R)
    {
      let gain = Math.max(L, R);
      if (gain == 0) {
        this.setSoundGainAndPan(sound, 0, 0);
        return;
      }
      let pan = (R - L) / gain;
      this.setSoundGainAndPan(sound, gain, pan);
    }

    setSoundGainAndPan(sound, gain, pan = 0.0)
    {
      if (sound) {
        sound.gain.value = gain;
        sound.pan.value = pan;
      }
    }

    mute()
    {
      this.setSoundGainAndPan(this.forest_sound, 0);
      this.setSoundGainAndPan(this.beach_sound, 0);
      this.setSoundGainAndPan(this.urban_sound, 0);
      this.setSoundGainAndPan(this.rain_sound, 0);
      this.setSoundGainAndPan(this.wind_sound, 0);
      this.jetEngineSound.mute();
    }
  }

  // AIRPLANE

  class PIDController
  {
    #previousValue;
    #previousError;
    integral;

    constructor(kp, ki, kd, iThreshold)
    {
      this.kp = kp; // Proportional gain
      this.ki = ki; // Integral gain
      this.kd = kd; // Derivative gain
      this.iThreshold = iThreshold;
      this.resetState();
    }

    resetState()
    {
      this.#previousValue = 0;
      this.#previousError = 0;
      this.integral = 0;
    }

    update(setpoint, measuredValue)
    {
      const error = setpoint - measuredValue;

      const derivative = error - this.#previousError;

      let integralActive =
        this.iThreshold == null || (Math.abs(error) < this.iThreshold && Math.abs(derivative) < this.iThreshold / 100.); // only adjust integral if already close and stable to target

      if (integralActive)
        this.integral += error;
      else
        this.integral = 0;

      this.#previousError = error;
      this.#previousValue = measuredValue;

      let totalOutput = this.kp * error + this.kd * derivative;

      if (integralActive) {
        totalOutput += this.ki * this.integral;
      }

      return totalOutput;
    }
  }

  class Autopilot
  {
    mode;
    autoThrottleEnabled;
    targetPitch;
    targetAltitude;
    targetIAS;
    targetGlideslope;

    // dependencies:
    #instrumentPanel;
    #airplane;

    constructor(airplane)
    {
      this.#airplane = airplane;
      // PID for altitude to pitch
      this.altitudePID = new PIDController(0.04, 0.00003, 20.0, 100.0);
      // PID for pitch to elevator
      this.pitchPID = new PIDController(0.4, 0.001, 20.0, 5.0, true); // 0.5, 0.001, 100.0

      this.speedPID = new PIDController(0.05, 0.00005, 1.0, 10.0);

      // PID for glideslope to pitch
      this.glideslopePID = new PIDController(2.0, 0.0015, 5.0, 3.0);

      this.targetPitch = 0.0;
      this.targetAltitude = 5000.0;
      this.targetIAS = 0.0;
      this.mode = 'ALTITUDE';

      this.autoThrottleEnabled = false;

      this.targetGlideslope = -3.0;
    }

    bindInstrumentPanel(instrumentPanel) { this.#instrumentPanel = instrumentPanel; }

    setMode(mode) { this.mode = mode; }

    setAutoThrottle(ATHR_state) { this.autoThrottleEnabled = ATHR_state; }

    resetState()
    {
      this.altitudePID.resetState();
      this.pitchPID.resetState();
      this.speedPID.resetState();
      this.glideslopePID.resetState();
    }

    update(pitchAttitude, altitude, trueVel, IAS, vecToRunway, gearOnGround)
    {
      let targetIAS = this.targetIAS;

      switch (this.mode) {

      case 'ALTITUDE':
        this.targetPitch = clamp(this.altitudePID.update(this.targetAltitude, altitude) + 3.0, -6.0, 10.0); // add 3.0 degree pitch bias

        this.targetPitch *= 1.0 - Math.abs(trueVel.y) * 0.03;                                               // limit vertical speed

        break;
      case 'AUTOLAND':

        if (vecToRunway.x <= 4000) {
          this.#airplane.setGear(true);
        }

        let currentGlideslope = trueVel.angle() * radToDeg;
        let adjustedTargetGlideslope = 0.0;

        if (vecToRunway.x <= 200) {
          adjustedTargetGlideslope = Math.max((vecToRunway.y - 10) * -0.08, -2.0); // flare
          // targetGlideslope = Math.max(targetGlideslope, currentGlideslope); // prevent acelerating down when entering at shallow angle
          targetIAS = 0.0;

        } else {

          let slopeToRunway = vecToRunway.angle() * radToDeg;

          adjustedTargetGlideslope = this.targetGlideslope + clamp((slopeToRunway - this.targetGlideslope) * 3.0, -5.0, 3.0); // move towards ideal glideslope

          targetIAS = map_range_C(vecToRunway.x, 2000, 15000, 95, 128);                                                       // target speed depend on distance to runway
          this.#instrumentPanel.setTargetIAS(msToKnots(targetIAS));
        }

        this.targetPitch = clamp(this.glideslopePID.update(adjustedTargetGlideslope, currentGlideslope) + 0.0, -6.0, 10.0);

        break;
      }


      let throttle = clamp(this.speedPID.update(targetIAS, IAS) + 0.60, 0.0, 1.0); // add 60% thrust bias

      // console.log(this.targetAltitude, altitude, this.targetPitch);

      let elevator = clamp(this.pitchPID.update(this.targetPitch, pitchAttitude) + 0.2, -1.0, 1.0);


      if (gearOnGround) {
        elevator = 0.40;
        throttle = -1.0;
      }

      //  console.log(this.#desiredPitch, pitchAttitude, elevator);

      return [ elevator, throttle ];
    }
  }

  class N1Indicator
  {
    container;
    percentText;
    fillArc;
    arcLength;

    constructor(parentElement)
    {
      this.container = document.createElement('div');
      this.container.innerHTML += `
          <svg class="gauge" viewBox="0 90 320 90" aria-hidden="true">
            <path class="bg-arc" d="M40 140 A120 120 0 0 1 280 140" />
            <path id="fillArc" class="fill-arc" d="M40 140 A120 120 0 0 1 280 140" />
            <text id="percentText" x="160" y="140" class="value">0%</text>
          </svg>
      `;

      this.percentText = this.container.querySelector('#percentText');
      this.fillArc = this.container.querySelector('#fillArc');

      this.arcLength = this.fillArc.getTotalLength();
      this.fillArc.style.strokeDasharray = this.arcLength + ' ' + this.arcLength;
      this.fillArc.style.strokeDashoffset = this.arcLength;

      parentElement.appendChild(this.container);
    }

    getColor(p)
    {
      if (p < 80) {
        const ratio = p / 80;
        const r = Math.round(0 + ratio * 255);
        const g = 255;
        return `rgb(${r},${g},0)`;
      } else if (p < 100) {
        const ratio = (p - 90) / 10;
        const r = 255;
        const g = Math.round(255 - ratio * 155);
        return `rgb(${r},${g},0)`;
      } else {
        return `rgb(255,0,0)`;
      }
    }

    update(N1)
    {
      const p = N1 * 100.;
      this.percentText.textContent = p.toFixed(1) + '%';
      this.fillArc.style.stroke = this.getColor(p);
      const offset = this.arcLength * (1 - p / 100);
      this.fillArc.style.strokeDashoffset = offset;
    }
  }

  class InstrumentPanel
  {
    #instrumentCanvas;
    #panelImg;
    #targetAltInput;
    #targetIASInput;
    #targetGlideslopeInput;
    #autolandButton;
    #autoThrottleButton;
    #altHoldButton;
    #panelDiv;
    #N1Indicator;

    // dependencies:
    #autopilot

    constructor(autopilot)
    {
      this.#autopilot = autopilot;
      this.#panelDiv = document.createElement('div');
      this.#instrumentCanvas = document.createElement('canvas');
      this.#instrumentCanvas.width = 800;
      this.#instrumentCanvas.height = 660;
      this.#panelDiv.style.opacity = 0.7;
      this.#panelDiv.style.position = 'absolute';
      this.#panelDiv.style.bottom = 0;
      this.#panelDiv.style.right = 0;
      this.#panelDiv.style.left = 'auto';
      this.loadImages();
      this.genAutopilotBar(this.#panelDiv);
      this.#panelDiv.appendChild(this.#instrumentCanvas);
      body.appendChild(this.#panelDiv);
    }

    setDisplaySideRight(right)
    {
      if (right) {
        this.#panelDiv.style.right = 0;
        this.#panelDiv.style.left = 'auto';
      } else { // left
        this.#panelDiv.style.right = 'auto';
        this.#panelDiv.style.left = 0;
      }
    }

    setMode_AUTOLAND(on)
    {
      if (on) {
        this.#autopilot.setMode('AUTOLAND');
        this.#altHoldButton.checked = false;
      } else {
        this.#autopilot.setMode('NONE');
      }
    }

    setMode_ALTITUDE(on)
    {
      if (on) {
        this.#autopilot.setMode('ALTITUDE');
        this.#autolandButton.checked = false;
      } else {
        this.#autopilot.setMode('NONE');
      }
    }

    setAutoThrottle(ATHR_state) { this.#autopilot.setAutoThrottle(ATHR_state); }

    genAutopilotBar(panelDiv)
    {
      const container = document.createElement('div');

      const speedLabel = document.createElement('label');
      speedLabel.style = 'position: absolute; left: 10px;';

      this.#targetIASInput = document.createElement('input');
      this.#targetIASInput.type = 'number';
      this.#targetIASInput.id = 'speed';
      this.#targetIASInput.className = 'autopilotNumberInput';
      this.#targetIASInput.min = '0';
      this.#targetIASInput.max = '330';
      this.#targetIASInput.step = '5';
      this.#targetIASInput.value = '220';
      this.#targetIASInput.style = 'width: 150px;';
      this.#targetIASInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetIASInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      speedLabel.appendChild(this.#targetIASInput);

      const speedSpan = document.createElement('span');
      speedSpan.textContent = 'KT';
      speedSpan.style = 'position: absolute; right: 100px;';
      speedLabel.appendChild(speedSpan);
      container.appendChild(speedLabel);

      this.#autoThrottleButton = document.createElement('input');
      this.#autoThrottleButton.type = 'checkbox';
      this.#autoThrottleButton.id = 'athr';
      this.#autoThrottleButton.className = 'airbus-switch';
      this.#autoThrottleButton.addEventListener('change', () => this.setAutoThrottle(this.#autoThrottleButton.checked));
      container.appendChild(this.#autoThrottleButton);

      let athrLabel = document.createElement('label');
      athrLabel.htmlFor = 'athr';
      athrLabel.className = 'airbus-label';
      athrLabel.innerHTML = 'A/THR';
      athrLabel.style = 'position: absolute; left: 200px;';
      container.appendChild(athrLabel);

      this.#N1Indicator = new N1Indicator(container);

      const glideSlopeLabel = document.createElement('label');
      glideSlopeLabel.style = 'position: absolute; left: 420px;';

      this.#targetGlideslopeInput = document.createElement('input');
      this.#targetGlideslopeInput.type = 'number';
      this.#targetGlideslopeInput.id = 'targetGlideSlopeInput';
      this.#targetGlideslopeInput.className = 'autopilotNumberInput';
      this.#targetGlideslopeInput.name = 'altitude';
      this.#targetGlideslopeInput.min = '2';
      this.#targetGlideslopeInput.max = '6';
      this.#targetGlideslopeInput.step = '1';
      this.#targetGlideslopeInput.value = '3';
      this.#targetGlideslopeInput.style.width = '55px';
      this.#targetGlideslopeInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetGlideslopeInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      glideSlopeLabel.appendChild(this.#targetGlideslopeInput);

      const glidSlopeSpan = document.createElement('span');
      glidSlopeSpan.textContent = '°';
      glidSlopeSpan.style = 'position: absolute; right: 20px;';
      glideSlopeLabel.appendChild(glidSlopeSpan);
      container.appendChild(glideSlopeLabel);

      this.#autolandButton = document.createElement('input');
      this.#autolandButton.type = 'checkbox';
      this.#autolandButton.id = 'autoland';
      this.#autolandButton.className = 'airbus-switch';
      this.#autolandButton.addEventListener('change', e => {this.setMode_AUTOLAND(e.target.checked)});
      container.appendChild(this.#autolandButton);

      let autolandLabel = document.createElement('label');
      autolandLabel.htmlFor = 'autoland';
      autolandLabel.className = 'airbus-label';
      autolandLabel.innerHTML = 'LAND';
      autolandLabel.style = 'position: absolute; left: 500px;';
      container.appendChild(autolandLabel);

      this.#altHoldButton = document.createElement('input');
      this.#altHoldButton.type = 'checkbox';
      this.#altHoldButton.id = 'althold';
      this.#altHoldButton.className = 'airbus-switch';
      this.#altHoldButton.addEventListener('change', e => {this.setMode_ALTITUDE(e.target.checked)});
      container.appendChild(this.#altHoldButton);

      let altLabel = document.createElement('label');
      altLabel.htmlFor = 'althold';
      altLabel.className = 'airbus-label';
      altLabel.innerHTML = 'ALT';
      altLabel.style = 'position: absolute; left: 600px;';
      container.appendChild(altLabel);


      const targetAltitudeLabel = document.createElement('label');

      this.#targetAltInput = document.createElement('input');
      this.#targetAltInput.type = 'number';
      this.#targetAltInput.id = 'altitude';
      this.#targetAltInput.className = 'autopilotNumberInput';
      this.#targetAltInput.name = 'altitude';
      this.#targetAltInput.min = '0';
      this.#targetAltInput.max = '40000';
      this.#targetAltInput.step = '100';
      this.#targetAltInput.value = '10000';
      this.#targetAltInput.style.width = '55px';
      this.#targetAltInput.style = 'position: absolute; left: 670px;';
      this.#targetAltInput.addEventListener('wheel', (e) => { e.stopPropagation(); });
      this.#targetAltInput.addEventListener('keydown', (e) => { e.stopPropagation(); });
      targetAltitudeLabel.appendChild(this.#targetAltInput);

      const targetAltSpan = document.createElement('span');
      targetAltSpan.textContent = 'ft';
      targetAltSpan.style = 'position: absolute; right: 70px;';
      targetAltitudeLabel.appendChild(targetAltSpan);

      container.appendChild(targetAltitudeLabel);


      container.style = 'height: 60px; display: flex; justify-content: space-between; align-items: center; background-color: #222222; color: white';

      panelDiv.appendChild(container);

      this.setMode_ALTITUDE();
    }

    setTargetIAS(targetIAS) { this.#targetIASInput.value = targetIAS.toFixed(0); }


    getTargetAlt() { return this.#targetAltInput.value / mToFt; }
    getTargetIAS() { return knotsToMs(this.#targetIASInput.value); }
    getTargetGlideslope() { return -this.#targetGlideslopeInput.value; }

    remove()
    {
      this.#instrumentCanvas.remove();
      this.#panelDiv.remove()
    }

    async loadImages() { this.#panelImg = await loadImage('resources/img/Panel.png'); }

    async display(pitchAngle, airAngle, altitude, radarAltitude, IAS, trueVel, OAT_C, throttle, N1, elevator, targetPitch, autopilotEn, gearStatus, runwayPointer, vecToRunway, brake)
    {
      let ctx = this.#instrumentCanvas.getContext('2d');
      let width = this.#instrumentCanvas.width - 50;
      let height = this.#instrumentCanvas.height;
      const topBarHeight = 50;
      let mainHeight = height - topBarHeight; // height of virtual horizon part

      let targetAltitude = this.getTargetAlt();
      let targetIAS = this.getTargetIAS();

      // ATTITUDE INDICATOR / VIRTUAL HORIZON:

      const pixPerDeg = 15.0;

      let y0 = mainHeight / 2 + topBarHeight + pitchAngle * pixPerDeg; // y pos of 0 deg pitch line

      ctx.beginPath();
      ctx.rect(0, -1000, width, 1000 + y0);
      ctx.fillStyle = '#05A3ED'; // blue
      ctx.fill();
      ctx.beginPath();
      ctx.rect(0, y0, width, 1500);
      ctx.fillStyle = '#F0843C'; // brown
      ctx.fill();


      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.beginPath();
      for (let i = Math.round((pitchAngle) / 10) * 10 - 50; i < pitchAngle + 50; i += 2.5) {
        let y = y0 - i * pixPerDeg;
        if (i % 10 == 0) {
          ctx.moveTo(width / 2 - width * 0.15, y);
          ctx.lineTo(width / 2 + width * 0.15, y);
          if (i != 0) {
            ctx.fillText(i, width / 2 - width * 0.25, y + 12);
            ctx.fillText(i, width / 2 + width * 0.21, y + 12);
          }
        } else if (i % 5 == 0) {
          ctx.moveTo(width / 2 - width * 0.075, y);
          ctx.lineTo(width / 2 + width * 0.075, y);
        } else { // 2.5 deg
          ctx.moveTo(width / 2 - width * 0.0375, y);
          ctx.lineTo(width / 2 + width * 0.0375, y);
        }
      }
      ctx.stroke();
      ctx.strokeStyle = 'yellow';
      ctx.beginPath();
      let moveIndY = mainHeight / 2 + topBarHeight + (pitchAngle - trueVel.angle() * radToDeg) * pixPerDeg; // airAngle
      ctx.moveTo(width / 2 - width * 0.15, moveIndY);
      ctx.lineTo(width / 2 + width * 0.15, moveIndY);
      ctx.stroke();

      ctx.strokeStyle = 'green';
      ctx.beginPath();
      let targIndY = mainHeight / 2 + topBarHeight + (pitchAngle - targetPitch) * pixPerDeg;
      ctx.moveTo(width / 2 - width * 0.15, targIndY);
      ctx.lineTo(width / 2 + width * 0.15, targIndY);
      ctx.stroke();

      if (vecToRunway.x < 150000) {
        ctx.strokeStyle = 'blue';
        ctx.beginPath();
        let runwayIndY = mainHeight / 2 + topBarHeight + (pitchAngle - runwayPointer) * pixPerDeg;
        ctx.moveTo(width / 2 - width * 0.15, runwayIndY);
        ctx.lineTo(width / 2 + width * 0.15, runwayIndY);
        ctx.stroke();
        ctx.fillStyle = 'blue';
        ctx.font = '20px serif';
        ctx.fillText(printDistance(vecToRunway.x), width / 2 - width * 0.15 - 70, runwayIndY - 5);
        ctx.fillText(printDistance(vecToRunway.y + 7.5), width / 2 + width * 0.15, runwayIndY - 5);
        ctx.fillText((vecToRunway.angle() * radToDeg).toFixed(1) + ' °', width / 2 + width * 0.23, runwayIndY - 5);
      }

      if (this.#panelImg)
        ctx.drawImage(this.#panelImg, 0, topBarHeight, width, mainHeight);

      // ALTITUDE INDICATOR:

      const altIndXpos = 640; // pos of vertical line

      ctx.beginPath();
      ctx.moveTo(altIndXpos, topBarHeight);
      ctx.lineTo(altIndXpos, height);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.stroke();
      ctx.font = '30px serif';

      let unit = ' m'

      if (guiControls.lengthUnit == 'LENGTH_UNIT_IMPERIAL')
      {
        altitude *= mToFt;
        radarAltitude *= mToFt;
        targetAltitude *= mToFt;
        unit = ' ft'
      }

      const pxPerAlt = 0.65;
      const altRange = 500; // + and -

      ctx.beginPath();
      for (let i = Math.round((altitude - altRange) / 100) * 100; i < altitude + altRange; i += 50) {
        let y = mainHeight / 2 + topBarHeight - (i - altitude) * pxPerAlt;
        if (i % 100 == 0) {
          ctx.moveTo(altIndXpos, y);
          ctx.lineTo(altIndXpos + 20, y);
          ctx.fillText(i, altIndXpos + 25, y + 12);
        } else {
          ctx.moveTo(altIndXpos, y);
          ctx.lineTo(altIndXpos + 10, y);
        }
      }
      ctx.stroke();
      ctx.fillStyle = 'black';
      ctx.fillRect(altIndXpos - 3, mainHeight / 2 + topBarHeight - 25, 113, 50);
      ctx.fillStyle = 'white';
      ctx.fillText(altitude.toFixed(0) + unit, altIndXpos, mainHeight / 2 + topBarHeight + 10);

      // Show ground level
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(altIndXpos - 3, mainHeight / 2 + topBarHeight + radarAltitude * pxPerAlt, 100, 500);

      // Show target altitude
      ctx.beginPath();
      let targetAltY = mainHeight / 2 + topBarHeight + (altitude - targetAltitude) * pxPerAlt;
      ctx.moveTo(altIndXpos, targetAltY);
      ctx.lineTo(altIndXpos + 100, targetAltY);
      ctx.strokeStyle = 'green';
      ctx.stroke();

      // VELOCITY INDICATOR:
      const velIndXpos = 110;
      ctx.beginPath();
      ctx.moveTo(velIndXpos, topBarHeight);
      ctx.lineTo(velIndXpos, height);
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'white';
      ctx.fillStyle = 'white';
      ctx.stroke();
      ctx.font = '30px serif';

      let stallSpeed = 70.0; // m/s
      let overSpeed = 173.0; // m/s

      if (guiControls.speedUnit == 'SPEED_UNIT_KT') {
        IAS = msToKnots(IAS);
        targetIAS = msToKnots(targetIAS);
        stallSpeed = msToKnots(stallSpeed);
        overSpeed = msToKnots(overSpeed);
        unit = ' kt'
      } else {
        unit = ' km/h'
        IAS *= 3.6; // convert m/s to km/h
        targetIAS *= 3.6;
        stallSpeed *= 3.6;
        overSpeed *= 3.6;
      }

      const pxPerVel = 10.0;
      const velRange = 35; // + and -

      ctx.beginPath();
      for (let i = Math.max(Math.round((IAS) / 10) * 10 - velRange, 0); i < IAS + velRange; i += 5) {
        let y = mainHeight / 2 + topBarHeight - (i - IAS) * pxPerVel;
        if (i % 10 == 0) {
          ctx.moveTo(velIndXpos - 20, y);
          ctx.lineTo(velIndXpos, y);
          ctx.fillText(i, 0, y + 12);
        } else {
          ctx.moveTo(velIndXpos - 10, y);
          ctx.lineTo(velIndXpos, y);
        }
      }
      ctx.stroke();
      ctx.fillStyle = 'black';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight - 25, velIndXpos + 3, 50);
      ctx.fillStyle = 'white';
      ctx.fillText(IAS.toFixed(0) + unit, 0, mainHeight / 2 + topBarHeight + 10);

      // Show stall speed
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight + (IAS - stallSpeed) * pxPerVel, velIndXpos + 3, 5000);

      // Show over speed
      ctx.beginPath();
      ctx.fillStyle = '#aa0000aa';
      ctx.fillRect(0, mainHeight / 2 + topBarHeight + (IAS - overSpeed) * pxPerVel - 5000, velIndXpos + 3, 5000);

      // Show target IAS
      ctx.beginPath();
      let targetIasY = mainHeight / 2 + topBarHeight + (IAS - targetIAS) * pxPerVel;
      ctx.moveTo(0, targetIasY);
      ctx.lineTo(velIndXpos + 3, targetIasY);
      ctx.strokeStyle = 'green';
      ctx.stroke();

      // VERTICAL VElOCITY INDICATOR
      ctx.fillStyle = 'black';
      ctx.fillRect(width, topBarHeight, 50, mainHeight);
      let hue = clamp(120.0 + trueVel.y * 10.0, 0.0, 200.0);
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;

      let verticalSpeedIndicatorVal = trueVel.y < 0 ? Math.sqrt(-trueVel.y) : -Math.sqrt(trueVel.y);
      ctx.fillRect(width + 10, mainHeight / 2 + topBarHeight, 30, verticalSpeedIndicatorVal * 40.);

      ctx.fillStyle = 'black';
      ctx.fillRect(width, mainHeight / 2 + topBarHeight - 13, 50, 26);

      const [veloStr, unitStr] = printVerticalVelocity(trueVel.y);

      ctx.font = '20px serif';
      ctx.fillStyle = 'white';
      ctx.fillText(veloStr, width, mainHeight / 2 + topBarHeight + 6);
      ctx.fillText(unitStr, width + 10, mainHeight / 2 + topBarHeight + 22);

      // OVERHEAD
      ctx.fillStyle = '#222222';
      ctx.fillRect(0, 0, this.#instrumentCanvas.width, topBarHeight);

      ctx.fillStyle = '#00FFFF';
      ctx.font = '30px serif';
      ctx.fillText('🌡 ' + printTemp(OAT_C), 0, 40);

      ctx.fillStyle = '#FFFF00';
      ctx.fillText('🎚️ ' + throttle.toFixed() + ' %', 140, 40);

      this.#N1Indicator.update(N1);

      let gearStatusIndicator = '';
      if (gearStatus == 'UP') {
        gearStatusIndicator = 'UP';
        ctx.fillStyle = '#444444';
      } else if (gearStatus == 'EXTENDING' || gearStatus == 'RETRACTING') {
        gearStatusIndicator = 'UNLK';
        ctx.fillStyle = '#FF0000';
      } else if (gearStatus == 'DOWN') {
        gearStatusIndicator = '▽▽▽';
        ctx.fillStyle = '#00FF00';
      }
      ctx.fillText(gearStatusIndicator, 290, 40);


      let AOA = pitchAngle - airAngle;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('∠ ' + AOA.toFixed(1) + '°', 410, 40);

      if (AOA > 14.0) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText('STALL!', 605, 40);
      }

      if (autopilotEn) {
        ctx.fillStyle = '#00FF00';
        ctx.fillText('AP', 540, 40);
      }

      if (IAS > overSpeed) {
        ctx.fillStyle = '#FF0000';
        ctx.fillText('Overspeed!', 605, 40);
      }

      // BELOW VIRTUAL HORIZON

      ctx.fillStyle = '#AAA';
      ctx.fillText('GS: ' + printVelocity(trueVel.mag()), 130, 640);

      if (brake) {
        ctx.fillStyle = '#F00';
        ctx.fillText('BRAKE', 340, 640);
      }

      ctx.fillStyle = '#AAA';
      ctx.fillText('ELE: ' + elevator.toFixed(2), 500, 640);
    }
  }


  const dt = 1. / FPS;

  class PhysicsObject
  {        // 2D PhysicsObject
    m;     // mass in kg
    I;     // moment of inertia
    pos;   // in meters
    vel;   // in m/s
    angle; // radians
    aVel;  // angular velocity in rad/s

    constructor(m, I, x, y, vx, vy)
    {
      this.m = m;
      this.I = I;
      this.pos = new Vec2D(x, y);
      this.vel = new Vec2D(vx, vy);
      this.angle = 0.0;
      this.aVel = 0.0;
    }

    applyAcceleration(a) { this.vel.add(a.mult(dt)); }

    applyForce(F, pos) // position relative to center
    {
      F.mult(dt);
      this.vel.add(F.copy().div(this.m)); // simply apply force at center of mass
      if (pos != null) {                  // apply torque if force not applied at the center of mass

        let angleToCm = pos.angle();      // angle to center of mass

                                          // console.log(F);
        F.rotate(-angleToCm); // make force vector perpendicular to vector to center off mass

                              // console.log('After rotating ', F, angleToCm * radToDeg);

        let torque = -F.y * pos.mag(); // if force perpendicular to vector from center, mult by dist from center
        this.aVel += torque / this.I;
      }
    }

    move(directionIsLeft)
    {
      let movementPerFrame = this.vel.copy();
      movementPerFrame.mult(dt);
      if (!directionIsLeft)
        movementPerFrame.x = -movementPerFrame.x;
      this.pos.add(movementPerFrame);
      this.pos.x = mod(this.pos.x, sim_res_x * cellHeight); // make sure airplane position stays within sim area
      this.angle += this.aVel * dt;                         // rotate
    }
  }

  class JetEngine
  {
    N1;     // 0. to 1.
    thrust; // 0. to 1.
    starting;
    started;

    constructor()
    {
      this.N1 = 0.186;
      this.starting = false;
      this.started = true;
    }

    toggle()
    {
      if (this.started) {
        this.stop();
      } else {
        this.start();
      }
    }

    start()
    {
      if (!this.started) {
        this.starting = true;
      }
    }

    stop()
    {
      this.started = false;
      this.starting = false;
    }

    update(throttle)
    {
      if (this.starting) {
        this.N1 += 0.00008;
        this.N1 *= 1.006;
        if (this.N1 >= 0.15) {
          this.starting = false;
          this.started = true;
        }
      } else if (this.started)
        this.N1 += (Math.abs(throttle) + 0.223) * 0.0042;

      this.N1 *= 0.995; // drag

      this.thrust = Math.pow(this.N1, 2.0);

      return throttle < 0. ? this.thrust * -0.7 : this.thrust;
    }
  }

  class Airplane
  {
    #instrumentPanel;
    #autopilot;

    directionIsLeft; // false means right

    #relVelAngle;    // angle of velocity relative to air
    #airspeed;       // true airspeed, m/s
    #groundSpeed;
    #IAS;            // indicated airspeed, m/s
    #camFollow;
    #OAT;            // outdoor air temperature

    #radarAltitude;  // meters above ground
    #framesSinceCrash;
    #gearExtPos;     // down: 0.0  up: 7.0
    #gearOnGround;   // if the wheels are touching the ground
    #braking;

    #runwayThresholdPos;

    // Controls
    elevator;
    throttle;
    prevThrottle;

    #gearStatus; // UP EXTENDING DOWN RETRACTING
    #autopilotEnabled;

    jetEngine;

    phys; // physics object, containing all physical properties including position and velocity

    getClosestRunwayPos()
    {
      let Xpos = Math.floor(mod(this.phys.pos.x / cellHeight, sim_res_x));
      // let Ypos = Math.floor(clamp(this.phys.pos.y / cellHeight + 1.0, 100, sim_res_y - 1));

      let Ypos = 90;

      // console.log(Ypos);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture
      var wallTextureValues = new Int8Array(sim_res_x * 4);
      gl.readPixels(0, Ypos, sim_res_x, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

      if (this.directionIsLeft) {
        let x = Xpos - 1;
        while (x != Xpos) {
          if (x < 0)
            x = sim_res_x - 1;

          if (wallTextureValues[x * 4 + 0] == 5) // found runway
          {
            return new Vec2D(x * cellHeight, (Ypos - wallTextureValues[x * 4 + 2]) * cellHeight + 15);
          }
          x--;
        }
      } else { // direction is right
        let x = Xpos + 1;
        while (x != Xpos) {
          if (x > sim_res_x - 1)
            x = 0;

          if (wallTextureValues[x * 4 + 0] == 5) // found runway
          {
            return new Vec2D(x * cellHeight, (Ypos - wallTextureValues[x * 4 + 2]) * cellHeight + 15);
          }
          x++;
        }
      }
      return new Vec2D(0, 0);
    }

    constructor()
    {
      this.#camFollow = true;
      this.phys = new PhysicsObject(1, 1, 0, 0);
      this.phys.pos.x = -99.0;
      this.phys.pos.y = -99.0;
      this.#IAS = 0.0;
      this.#OAT = 0.0;
      this.#airspeed = 0.0;
      this.#groundSpeed = 0.0;
      this.#autopilotEnabled = false;
      this.#gearOnGround = false;
      this.#braking = false;
      this.#runwayThresholdPos = new Vec2D(0, 0);
    }

    toggleCamFollow()
    {
      if (airplaneMode)
        this.#camFollow = !this.#camFollow;
    }

    enableAirplaneMode(autopilotEn)
    {
      this.#autopilot = new Autopilot(this);
      this.setAutopilot(autopilotEn);
      this.#instrumentPanel = new InstrumentPanel(this.#autopilot);
      this.#autopilot.bindInstrumentPanel(this.#instrumentPanel);
      airplaneMode = true;
      this.directionIsLeft = true; // left
      this.#camFollow = true;
      let M = 400 * 1000;          // mass: 400 tons
      let L = 50.0;                // effective length in meters
      let I = 1 / 12 * M * L * L;  // moment of inertia

      let simXpos = Math.floor(mouseXinSim * sim_res_x);
      let simYpos = findSimYposAboveSurfaceAtMouseX();

      let startsOnSurface = simYpos > (mouseYinSim * sim_res_y); // It is placed above the mouse position

      let planePosX = simXpos * cellHeight;
      let planePosY = Math.min(simYpos * cellHeight - (startsOnSurface ? 32.0 : 0.0), 15000.0);

      let velX = startsOnSurface ? 0.0 : map_range_C(mouseYinSim, 0.0, 1.0, -100.0, -200);

      this.phys = new PhysicsObject(M, I, planePosX, planePosY, velX, 0.0);
      this.phys.angle = startsOnSurface ? 0.0 : 5.0 * degToRad;
      this.throttle = startsOnSurface ? 0.00 : 0.40; // %

      if (startsOnSurface) {
        this.#gearStatus = 'DOWN';
        this.#gearExtPos = 0.0;
      } else {
        this.#gearStatus = 'UP';
        this.#gearExtPos = 7.0;

        this.#runwayThresholdPos = this.getClosestRunwayPos();
      }

      cam.tarZoom = 100.0;

      this.jetEngine = new JetEngine();
      soundSystem.jetEngineSound.start();
    }

    changeDirection()
    {
      if (this.directionIsLeft) {
        if (!confirm('Do you want to change the flight direction to Right?'))
          return;
      } else {
        if (!confirm('Do you want to change the flight direction to Left?'))
          return;
      }
      this.directionIsLeft = !this.directionIsLeft;
      this.#instrumentPanel.setDisplaySideRight(this.directionIsLeft);
      this.#runwayThresholdPos = this.getClosestRunwayPos();
    }

    disableAirplaneMode()
    {
      airplaneMode = false;
      this.#framesSinceCrash = -1;
      this.phys.pos.x = -99.0;
      this.phys.pos.y = -99.0;
      this.#camFollow = false;
      this.display(); // run display function one more time to update uniforms
      this.#instrumentPanel.remove();
      document.body.style.cursor = 'default';
      soundSystem.jetEngineSound.stop();
    }

    getN1() { return this.jetEngine ? this.jetEngine.N1 : 0.0; }

    onUpPressed()
    {
      if (this.throttle == 0.) {
        this.throttle = +0.01;
      }
    }

    onDownPressed()
    {
      if (this.throttle == 0.) {
        this.throttle = -0.01;
      }
    }

    setBrakes(enabled) { this.#braking = enabled; }

    toggleEngine() { this.jetEngine.toggle(); }

    toggleGear() { this.setGear(this.#gearStatus == 'UP'); }

    setGear(boolDown)
    {
      if (boolDown) {
        if (this.#gearStatus == 'UP')
          this.#gearStatus = 'EXTENDING';

      } else {
        if (this.#gearStatus == 'DOWN')
          this.#gearStatus = 'RETRACTING';
      }
    }

    // https://aviation.stackexchange.com/questions/64490/is-there-a-simple-relationship-between-angle-of-attack-and-lift-coefficient/97747#97747?newreg=547ea95b1d784abf993b7d1850dcc938
    Cl(AOA) // lift coefficient https://www.desmos.com/calculator/aeeizqvarp
    {
      let lift = 0.0;
      if ((AOA > 0. && AOA < PI / 7.23) || (AOA > 7. / 8.124 * PI && AOA < PI)) {
        lift = Math.sin(6. * AOA);
      } else {
        lift = Math.sin(2. * AOA);
      }
      return lift;
    }

    Cd(AOA) // drag coefficient
    {
      return 1.0 - Math.cos(2 * AOA);
    }

    move()
    {
      if (this.#framesSinceCrash >= 0) {
        this.#framesSinceCrash++;
        if (this.#framesSinceCrash > 30)
          this.disableAirplaneMode();
        return;
      }

      let Xpos = mod(this.phys.pos.x / cellHeight - 1., sim_res_x);
      let Ypos = Math.min(this.phys.pos.y / cellHeight + 1.0, sim_res_y - 1);

      let fractX = fract(Xpos);
      let fractY = fract(Ypos);

      Xpos = Math.floor(Xpos);
      Ypos = Math.floor(Ypos);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);                                   // basetexture
      var baseTextureValues = new Float32Array(4 * 2 * 2);
      gl.readPixels(Xpos, Ypos, 2, 2, gl.RGBA, gl.FLOAT, baseTextureValues); // order bottem up: x0y0 x1y0 x0y1 x1y1

      let temperature = KtoC(potentialToRealT(baseTextureValues[3], Ypos));

      function fract(f) { return f % 1.; }
      function mix(x, y, a) { return x * (1. - a) + y * a; }

      function bilerp(array, ind, fractX, fractY) // ind: index of value in array to get
      {
        let top = mix(array[2 * 4 + ind], array[3 * 4 + ind], fractX);
        let bottem = mix(array[0 * 4 + ind], array[1 * 4 + ind], fractX);
        return mix(bottem, top, fractY);
      }


      // Linearly interpolatate velocity
      let Vx = bilerp(baseTextureValues, 0, fractX, fractY);
      let Vy = bilerp(baseTextureValues, 1, fractX, fractY);

      let airVel = new Vec2D(this.directionIsLeft ? Vx : -Vx, Vy);

      if (this.phys.pos.y > guiControls.simHeight) {
        airVel.mult(0.0);              // still air above sim area
      } else {
        airVel.mult(cellHeight * 3.6); // convert to m/s
      }

      this.#OAT = temperature;

      // gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
      // var waterTextureValues = new Float32Array(4);
      // gl.readPixels(Xpos, Ypos, 1, 1, gl.RGBA, gl.FLOAT, waterTextureValues);
      // let dewpoint = KtoC(dewpoint(waterTextureValues[0]));

      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      var wallTextureValues = new Int8Array(4 * 3 * 1);
      gl.readPixels(Xpos, Ypos, 3, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

      // wrap arround the edge of the sim area
      if (Xpos == sim_res_x - 2) {
        gl.readPixels(0, Ypos, 1, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues.subarray(2 * 4));
      } else if (Xpos == sim_res_x - 1) {
        gl.readPixels(0, Ypos, 2, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues.subarray(1 * 4));
      }

      let radarAltL = (wallTextureValues[0 * 4 + 2] + fractY - 1.) * cellHeight;
      let radarAltM = (wallTextureValues[1 * 4 + 2] + fractY - 1.) * cellHeight;
      let radarAltR = (wallTextureValues[2 * 4 + 2] + fractY - 1.) * cellHeight;


      let radarAltFrontGear = this.directionIsLeft ? mix(radarAltL, radarAltM, Math.min(fractX + 0.14, 1.)) : mix(radarAltM, radarAltR, Math.min(fractX, 1.));

      this.#radarAltitude = Math.min(mix(radarAltL, radarAltM, fractX), mix(radarAltM, radarAltR, fractX));

      // console.log(Xpos, Ypos, radarAltL.toFixed(1), radarAltM.toFixed(1), radarAltR.toFixed(1), fractX);

      if (this.#gearStatus == 'EXTENDING') {
        this.#gearExtPos = Math.max(this.#gearExtPos - 0.01, 0.0);
        if (this.#gearExtPos == 0.0)
          this.#gearStatus = 'DOWN';
      } else if (this.#gearStatus == 'RETRACTING') {
        this.#gearExtPos = Math.min(this.#gearExtPos + 0.01, 7.0);
        if (this.#gearExtPos == 7.0)
          this.#gearStatus = 'UP';
      }

      let heightAboveGround = this.#radarAltitude;

      let heightAboveObstacles = radarAltM;

      let gearTouchAlt = 8.0 - this.#gearExtPos;

      let bounceForceMult = 100000.0;

      if (wallTextureValues[1 * 4 + 0] == 1) { // over land

        let treeHeight = map_range_C(wallTextureValues[1 * 4 + 3], 80, 127, 0., 15.);
        heightAboveObstacles -= treeHeight;

      } else if (wallTextureValues[1 * 4 + 0] == 2) { // over water
        heightAboveObstacles += 20.;
        gearTouchAlt = -5.0;                          // + (7.0 - this.#gearExtPos) * 0.2;
        bounceForceMult = 9000.0 + Math.abs(this.phys.vel.x) * 600.0;

        let draught = gearTouchAlt - heightAboveGround;
        if (draught > 0.0) {
          let waterDragForce = this.phys.vel.x * -50000.0 * draught;
          // console.log(waterDragForce);
          if (waterDragForce > 3000000 || this.#gearExtPos < 7.0) { // crash on water
            guiControls.IterPerFrame = 1;
            guiControls.auto_IterPerFrame = false;
            this.#framesSinceCrash = 0;
            soundSystem.jetEngineSound.stop();
          }

          this.phys.applyForce(new Vec2D(waterDragForce, 0.));

          this.jetEngine.stop();
        }

      } else if (wallTextureValues[1 * 4 + 0] == 4) { // over urban
        heightAboveObstacles -= 80.0;
      }

      let mainGearForce = Math.max(gearTouchAlt - heightAboveGround, 0.0) * bounceForceMult * 100.0;

      if (mainGearForce > 0.0) {
        this.#gearOnGround = true;
        mainGearForce -= this.phys.vel.y * 500000; // damping
      } else {
        this.#gearOnGround = false;
      }

      this.phys.applyForce(new Vec2D(0.0, mainGearForce), new Vec2D(1., 0.));

      let frontGearPosX = 36.0;                                                         // m

      let frontGearAlt = radarAltFrontGear + Math.sin(this.phys.angle) * frontGearPosX; // front gear altitude is not completely acurate yet

      let frontGearForce = Math.max(gearTouchAlt - frontGearAlt, 0.0) * bounceForceMult * 5.0;

      if (frontGearForce > 0.0)
        frontGearForce -= this.phys.aVel * 5000000; // damping

      this.phys.applyForce(new Vec2D(0.0, -frontGearForce), new Vec2D(-frontGearPosX, 0.));

      let gearPos = clamp(-(heightAboveGround - gearTouchAlt), 0.0, 5.0) + this.#gearExtPos; // 0 is all the way down, positive is up into the airplane

      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeDirectionAndGearPos'), this.directionIsLeft, gearPos);

      if (wallTextureValues[0] != 2 && (heightAboveObstacles < 6.0 || radarAltL < 6.0 || (heightAboveObstacles < 10.0 && Math.abs(this.phys.angle) > 0.25))) { // crash into the surface
        guiControls.IterPerFrame = 1;
        guiControls.auto_IterPerFrame = false;
        this.#framesSinceCrash = 0;
        soundSystem.jetEngineSound.stop();
      }

      this.#groundSpeed = this.phys.vel.mag();

      let relVel = this.phys.vel.copy().subtract(airVel);           // velocity relative to air
      this.#airspeed = relVel.mag();                                // true airspeed in m/s
      let relAlt = this.phys.pos.y / 12000.0;                       // 12000 m = 1.0
      let relAirDensity = Math.pow(1. - relAlt * 0.47, 2.0);        // 1.0 is sea level, 0.28 is 12000 meters
      let relIndVel = relVel.copy().mult(Math.sqrt(relAirDensity)); // convert velocity relative to air to indicated, wich is also what the airplane feels

      this.#IAS = relIndVel.mag();

      // this.phys.angle += this.elevator * 0.001; // simple pitch control for testing

      // this.#relVelAngle = this.phys.vel.angle(); // ignore air movement for testing
      this.#relVelAngle = relVel.angle();


      let AOA = this.phys.angle - this.#relVelAngle;
      let dynamicPressMult = relIndVel.magSq(); // dynamic pressure
      let liftForce = this.Cl(AOA) * dynamicPressMult * 800.0;
      let dragForce = this.Cd(AOA) * dynamicPressMult * 800.0;

      // console.log(Math.round(liftForce, 1), Math.round(dragForce, 1));
      // console.log((liftForce / dragForce).toFixed(1));
      // console.log(Math.abs(this.phys.vel.x));

      let mainWingForce = new Vec2D(dragForce, liftForce);
      mainWingForce.rotate(this.#relVelAngle);
      this.phys.applyForce(mainWingForce); // Apply Main wing force at center off mass

      // console.log('this.elevator ' + this.elevator);

      let vertStabilAOA = AOA - (this.elevator * 15.0 + 3.0) * degToRad; // angled at -12 to 18 degrees relative to main wing with 3 deg center position

      // console.log('vertStabilAOA ', vertStabilAOA * radToDeg);

      let vertStabilPos = new Vec2D(35., 0.); // 35 meters to the right of the center of mass
      vertStabilPos.rotate(this.phys.angle);
      // console.log('vertStabilPos ', vertStabilPos);
      let vertStabilForce = new Vec2D(this.Cd(vertStabilAOA) * dynamicPressMult * 40.0, this.Cl(vertStabilAOA) * dynamicPressMult * 40.0);
      vertStabilForce.rotate(this.#relVelAngle);

      // console.log((vertStabilAOA * radToDeg).toFixed(2), vertStabilForce.copy().div(10000));

      let thrust = this.jetEngine.update(this.throttle);

      let thrustAltMult = 0.5 + relAirDensity * 0.5;

      this.phys.applyForce(vertStabilForce, vertStabilPos);                                        // apply vertical stabiliser force
      this.phys.applyForce(Vec2D.fromAngle(this.phys.angle, thrust * thrustAltMult * 311000 * 4)); // Thrust 4 X 311 kN
      this.phys.applyAcceleration(new Vec2D(0.0, -9.81));                                          // gravity

      let normRelVel = new Vec2D(Math.cos(this.#relVelAngle), Math.sin(this.#relVelAngle));
      let dragMult = (this.#gearStatus == 'UP' ? 25.0 : 35.0) + Math.abs(Math.sin(AOA) * 150.0);
      let dragMag = dynamicPressMult * dragMult;

      this.phys.applyForce(new Vec2D(normRelVel.x * dragMag, -normRelVel.y * dragMag));

      if (this.#gearOnGround) {
        let gearDragForce = (this.#braking ? 1100000.0 : 50000.0); // braking and wheel friction

        this.phys.applyForce(new Vec2D(this.phys.vel.x > 0.0 ? -gearDragForce : gearDragForce, 0.));
      }

      this.phys.aVel *= 1. - 0.15 * dt; // angular velocity drag

      this.phys.move(this.directionIsLeft);
    }

    hasCrashed() { return this.#framesSinceCrash >= 0; }

    setAutopilot(enabledIn)
    {
      document.body.style.cursor = enabledIn ? 'default' : 'crosshair';
      this.#autopilotEnabled = enabledIn;

      if (enabledIn == true) {
        this.#runwayThresholdPos = this.getClosestRunwayPos();
        this.#autopilot.resetState();
        this.#autopilot.targetPitch = this.phys.angle * radToDeg;
      }
    }

    calcVecToRunway()
    {
      if (this.directionIsLeft) {
        let distToRunwayY = this.phys.pos.y - this.#runwayThresholdPos.y;
        let distToRunwayX = 0;
        if (this.phys.pos.x > this.#runwayThresholdPos.x) {               // to the right of runway
          distToRunwayX = this.phys.pos.x - this.#runwayThresholdPos.x;
        } else if (this.phys.pos.x > this.#runwayThresholdPos.x - 3000) { // above runway
          distToRunwayX = 0;
        } else {                                                          // to the left of runway, wrap around map
          distToRunwayX = sim_res_x * cellHeight + (this.phys.pos.x - this.#runwayThresholdPos.x);
        }
        let vecToRunway = new Vec2D(distToRunwayX, distToRunwayY);
        return vecToRunway;
      } else {
        let distToRunwayY = this.phys.pos.y - this.#runwayThresholdPos.y;
        let distToRunwayX = 0;
        if (this.phys.pos.x < this.#runwayThresholdPos.x) {               // to the left of runway
          distToRunwayX = this.#runwayThresholdPos.x - this.phys.pos.x;
        } else if (this.phys.pos.x < this.#runwayThresholdPos.x + 3000) { // above runway
          distToRunwayX = 0;
        } else {                                                          // to the left of runway, wrap around map
          distToRunwayX = sim_res_x * cellHeight + (this.phys.pos.x - this.#runwayThresholdPos.x);
        }
        let vecToRunway = new Vec2D(distToRunwayX, distToRunwayY);
        return vecToRunway;
      }
    }

    takeUserInput()
    {
      this.prevThrottle = this.throttle;

      if (upPressed) {
        this.throttle += 0.01;
      } else if (downPressed) {
        this.throttle -= 0.01;
      }

      const [autopilotElevator, autopilotThrottle] = this.#autopilot.update(this.phys.angle * radToDeg, this.phys.pos.y, this.phys.vel, this.#IAS, this.calcVecToRunway(), this.#gearOnGround);

      this.#autopilot.targetAltitude = this.#instrumentPanel.getTargetAlt();
      this.#autopilot.targetIAS = this.#instrumentPanel.getTargetIAS();
      this.#autopilot.targetGlideslope = this.#instrumentPanel.getTargetGlideslope();

      if (this.#autopilot.autoThrottleEnabled) {
        this.throttle = autopilotThrottle;

        if (this.throttle < 0.0)
          this.#braking = true;
      }

      const gp = navigator.getGamepads()[0];

      if (this.#autopilotEnabled) {

        this.elevator = autopilotElevator;
      } else if (gp) {
        this.elevator = -gp.axes[1];
      } else {                                                              // manual elevator control
        this.elevator = (mouseY - canvas.height / 2) / canvas.height * 2.0; // pitch input -1.0 to +1.0
      }

      // this.elevator /= 1.0 + Math.max(this.#airspeed - 80, 0.) * 0.01;          // limit elevator throw at higher airspeed
      this.elevator += Math.max(-this.phys.angle * radToDeg - 50.0, 0.) * 0.03; // limit elevator to prevent going down steeper than vertical
      this.elevator -= Math.max(this.phys.angle * radToDeg - 50.0, 0.) * 0.03;  // limit elevator to prevent going up steeper than vertical

      // console.log(this.phys.angle * radToDeg, this.elevator);

      if (gp) {
        if (!this.#autopilot.autoThrottleEnabled) {
          this.throttle = (gp.axes[2] + 1.) / 2.;
          this.throttle *= -gp.axes[4]; // reverse thrust
        }
        this.#braking = gp.buttons[0].pressed;

        this.setGear(gp.axes[7] > 0.)
      }

      this.throttle = clamp(this.throttle, (this.#gearOnGround && (this.prevThrottle < 0. || this.#autopilot.autoThrottleEnabled || gp)) ? -0.3 : 0.0,
                            (this.prevThrottle > 0. || this.#autopilot.autoThrottleEnabled || gp) ? 1.0 : 0.0);
    }

    display()
    {
      let normXpos = this.phys.pos.x / cellHeight / sim_res_x;
      let normYpos = (this.phys.pos.y / cellHeight + 1.0) / sim_res_y;

      // console.log(normXpos, normYpos);
      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform3f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planePos'), normXpos, normYpos, this.directionIsLeft ? this.phys.angle : -this.phys.angle);
      gl.useProgram(advectionProgram);
      gl.uniform4f(gl.getUniformLocation(advectionProgram, 'airplaneValues'), normXpos, normYpos, this.throttle, this.#framesSinceCrash > 0 ? 1.0 : (zPressed ? -1.0 : 0.0));
      gl.useProgram(skyBackgroundDisplayProgram);

      if (this.#camFollow) {
        cam.tarXpos = -normXpos * 2.0 + 1.0;
        cam.tarYpos = -normYpos * 2.0 * (sim_res_y / sim_res_x) + (sim_res_y / sim_res_x);
      }

      let vecToRunway = this.calcVecToRunway();

      this.#instrumentPanel.display(this.phys.angle * radToDeg, this.#relVelAngle * radToDeg, this.phys.pos.y, this.#radarAltitude, this.#IAS, this.phys.vel, this.#OAT, this.throttle * 100.0,
                                    this.jetEngine.N1, this.elevator, this.#autopilot.targetPitch, this.#autopilotEnabled, this.#gearStatus, vecToRunway.angle() * radToDeg, vecToRunway,
                                    this.#braking);
    }
  }

  var airplane = new Airplane();

  document.body.style.overflow = 'hidden'; // prevent scrolling bar from apearing

  canvas = document.getElementById('mainCanvas');

  var contextAttributes = {
    alpha : false,
    desynchronized : false,
    antialias : true,
    depth : false,
    failIfMajorPerformanceCaveat : false,
    powerPreference : 'high-performance',
    premultipliedAlpha : true, // true
    preserveDrawingBuffer : false,
    stencil : false,
  };
  gl = canvas.getContext('webgl2', contextAttributes);
  // console.log(gl.getContextAttributes());

  if (!gl) {
    alert('Your browser does not support WebGL2, Download a new browser.');
    throw ' Error: Your browser does not support WebGL2';
  }

  // SETUP GUI

  if (guiControlsFromSaveFile == null) { // use default settings
    setupDatGui(JSON.stringify(guiControls_default));
    guiControls.simHeight = sim_height;
    guiControls.globalEffectsEndAlt = sim_height;

    if (startDate) {
      guiControls.month = startDate.getMonth() + 1 + startDate.getDate() / 30.5;
    }

    if (startLatitude) {
      guiControls.latitude = startLatitude;
    }

  } else {
    setupDatGui(guiControlsFromSaveFile);                     // use settings from save file

    for (const [key, value] of Object.entries(guiControls)) { // set numerical values that could not be loaded from the savefile to their defaults.
      if (value === -1) {
        guiControls[key] = guiControls_default[key];
      }
    }
  }

  function setGuiUniforms()
  { // set all uniforms to new values
    gl.useProgram(boundaryProgram);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'), guiControls.vorticity);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'landEvaporation'), guiControls.landEvaporation);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterEvaporation'), guiControls.waterEvaporation);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dynamicWaterTemperature'), guiControls.dynamicWaterTemperature ? 1.0 : 0.0);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterWeight'), guiControls.waterWeight);
    gl.useProgram(velocityProgram);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'dragMultiplier'), guiControls.dragMultiplier);
    gl.uniform1f(gl.getUniformLocation(velocityProgram, 'wind'), guiControls.wind);
    gl.useProgram(lightingProgram);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'greenhouseGases'), guiControls.greenhouseGases);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterGreenHouseEffect'), guiControls.waterGreenHouseEffect);
    gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate);
    gl.useProgram(advectionProgram);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'meltingHeat'), guiControls.meltingHeat);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'condensationRate'), guiControls.condensationRate);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalDrying'), guiControls.globalDrying);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalHeating'), guiControls.globalHeating);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'soundingForcing'), guiControls.soundingForcing);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
    gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
    gl.useProgram(precipitationProgram);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapHeat'), guiControls.evapHeat);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingHeat'), guiControls.meltingHeat);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'aboveZeroThreshold'), guiControls.aboveZeroThreshold);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'subZeroThreshold'), guiControls.subZeroThreshold);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'spawnChanceMult'), guiControls.spawnChance);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'snowDensity'), guiControls.snowDensity);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'fallSpeed'), guiControls.fallSpeed);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate0C'), guiControls.growthRate0C);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate_30C'), guiControls.growthRate_30C);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'freezingRate'), guiControls.freezingRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingRate'), guiControls.meltingRate);
    gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapRate'), guiControls.evapRate);
    gl.useProgram(postProcessingProgram);
    gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
  }

  var radarDisplayModeController;

  function syncLegacyRadarProductField()
  {
    guiControls.radarProduct = isImplementedRadarProduct(guiControls.lastLiveRadarProduct) ? guiControls.lastLiveRadarProduct : RADAR_PRODUCT_REFLECTIVITY;
  }

  function normalizeRadarGuiState()
  {
    const liveProductFromDisplayMode = getRadarProductIdForDisplayMode(guiControls.displayMode);

    if (!RADAR_PRODUCTS_BY_ID[guiControls.selectedRadarProduct])
      guiControls.selectedRadarProduct = liveProductFromDisplayMode || RADAR_PRODUCT_REFLECTIVITY;

    if (!isImplementedRadarProduct(guiControls.lastLiveRadarProduct))
      guiControls.lastLiveRadarProduct = isImplementedRadarProduct(guiControls.selectedRadarProduct) ? guiControls.selectedRadarProduct :
                                         (liveProductFromDisplayMode || RADAR_PRODUCT_REFLECTIVITY);

    if (!isImplementedRadarProduct(guiControls.lastLiveRadarProduct))
      guiControls.lastLiveRadarProduct = RADAR_PRODUCT_REFLECTIVITY;

    syncLegacyRadarProductField();
  }

  function setupDatGui(strGuiControls)
  {
    datGui = new dat.GUI();
    guiControls = JSON.parse(strGuiControls); // load settings object
    const hadSavedSelectedRadarProduct = guiControls.selectedRadarProduct !== undefined;
    const hadSavedLastLiveRadarProduct = guiControls.lastLiveRadarProduct !== undefined;

    for (const [key, value] of Object.entries(guiControls_default)) {
      if (guiControls[key] === undefined) {
        guiControls[key] = cloneGuiValue(value);
      }
    }

    guiControls.radarPaletteState = normalizeRadarPaletteState(guiControls.radarPaletteState);
    guiControls.tool = 'TOOL_NONE';

    if (!hadSavedSelectedRadarProduct && !hadSavedLastLiveRadarProduct && isImplementedRadarProduct(guiControls.radarProduct)) {
      const legacyDisplayMode = getDisplayModeForRadarProduct(guiControls.radarProduct);
      if (legacyDisplayMode)
        guiControls.displayMode = legacyDisplayMode;
    }

    normalizeRadarGuiState();

    cam.wrapHorizontally = guiControls.wrapHorizontally;
    cam.smooth = guiControls.SmoothCam;

    if (guiControls.wrapHorizontally)
      horizontalDisplayMult = 3.0;
    else
      horizontalDisplayMult = 1.0;


    if (frameNum == 0) {
      // only hide during initial setup. When resetting settings and
      // reinitializing datGui, H key no longer works to unhide it
      datGui.hide();
    }
    // add functions to guicontrols object
    guiControls.download = function() { prepareDownload(); };

    guiControls.resetSettings = function() {
      if (confirm('Are you sure you want to reset all settings to default?')) {
        datGui.destroy();                                 // remove datGui completely
        setupDatGui(JSON.stringify(guiControls_default)); // generate new one with new settings
        setGuiUniforms();
        hideOrShowGraph();
        updateSunlight();
        handleRadarUiExternalChange();
      }
    };

    updateRadarPaletteTexture();

    var fluidParams_folder = datGui.addFolder('Fluid');

    fluidParams_folder.add(guiControls, 'vorticity', 0.0, 0.010, 0.001)
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'), guiControls.vorticity);
      })
      .name('Vorticity');

    fluidParams_folder.add(guiControls, 'dragMultiplier', 0.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'dragMultiplier'), guiControls.dragMultiplier);
      })
      .name('Drag');

    fluidParams_folder.add(guiControls, 'wind', -1.0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(velocityProgram);
        gl.uniform1f(gl.getUniformLocation(velocityProgram, 'wind'), guiControls.wind);
      })
      .name('Wind');

    fluidParams_folder.add(guiControls, 'globalDrying', 0.0, 0.0001, 0.000001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalDrying'), guiControls.globalDrying);
      })
      .name('Global Drying');

    fluidParams_folder.add(guiControls, 'globalHeating', -0.001, 0.001, 0.00001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalHeating'), guiControls.globalHeating);
      })
      .name('Global Heating');

    // , 0, 1.0, 0.01
    fluidParams_folder.add(guiControls, 'soundingForcing', 0, 1.0, 0.01)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'soundingForcing'), guiControls.soundingForcing);
      })
      .name('Sounding Forcing');

    fluidParams_folder.add(guiControls, 'globalEffectsEndAlt', 0, guiControls.simHeight, 10)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        if (guiControls.globalEffectsEndAlt < guiControls.globalEffectsStartAlt) {
          guiControls.globalEffectsStartAlt = guiControls.globalEffectsEndAlt;
          gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
        }
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
      })
      .listen()
      .name('Apply below altitude');

    fluidParams_folder.add(guiControls, 'globalEffectsStartAlt', 0, guiControls.simHeight, 10)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        if (guiControls.globalEffectsStartAlt > guiControls.globalEffectsEndAlt) {
          guiControls.globalEffectsEndAlt = guiControls.globalEffectsStartAlt;
          gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsEndAlt'), guiControls.globalEffectsEndAlt / guiControls.simHeight);
        }

        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'globalEffectsStartAlt'), guiControls.globalEffectsStartAlt / guiControls.simHeight);
      })
      .listen()
      .name('Apply above altitude');


    var UI_folder = datGui.addFolder('User Interaction');

    UI_folder
      .add(guiControls, 'tool', {
        'Flashlight' : 'TOOL_NONE',
        'Temperature' : 'TOOL_TEMPERATURE',
        'Water Vapor / Cloud' : 'TOOL_WATER',
        'Land' : 'TOOL_WALL_LAND',
        'Lake / Sea' : 'TOOL_WALL_SEA',
        'Urban' : 'TOOL_WALL_URBAN',
        'Runway' : 'TOOL_WALL_RUNWAY',
        'Industrial' : 'TOOL_WALL_INDUSTRIAL',
        'Fire' : 'TOOL_WALL_FIRE',
        'Smoke / Dust' : 'TOOL_SMOKE',
        'Soil Moisture' : 'TOOL_WALL_MOIST',
        'Vegetation' : 'TOOL_VEGETATION',
        'Snow' : 'TOOL_WALL_SNOW',
        'Wind' : 'TOOL_WIND',
        'Weather Station' : 'TOOL_STATION',
        'Radar Tower' : 'TOOL_RADAR',
        'Sounding Probe' : 'TOOL_SOUNDING',
      })
      .name('Tool')
      .listen();
    UI_folder.add(guiControls, 'brushSize', 1, 200, 1).name('Brush Diameter').listen();
    UI_folder.add(guiControls, 'wholeWidth').name('Whole Width Brush').listen();
    UI_folder.add(guiControls, 'brushIntensity', 0.005, 0.05, 0.001).name('Brush Intensity');
    UI_folder.add(guiControls, 'allowCaves')
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'allowCaves'), guiControls.allowCaves ? 1 : 0);
      })
      .name('Allow Caves');

    var radiation_folder = datGui.addFolder('Radiation');

    radiation_folder.add(guiControls, 'timeOfDay', 0.0, 23.96, 0.01).onChange(onUpdateTimeOfDaySlider).name('Time of day').listen();

    radiation_folder.add(guiControls, 'dayNightCycle').name('Day/Night Cycle').listen();

    radiation_folder.add(guiControls, 'accelerateNight').name('Accelerate Night').listen();

    radiation_folder.add(guiControls, 'latitude', -90.0, 90.0, 0.1).onChange(function() { updateSunlight(); }).name('Latitude').listen();

    radiation_folder.add(guiControls, 'month', 1.0, 12.99, 0.01).onChange(onUpdateMonthSlider).name('Month').listen();

    radiation_folder.add(guiControls, 'sunAngle', -10.0, 190.0, 0.1)
      .onChange(function() {
        updateSunlight('MANUAL_ANGLE');
        guiControls.dayNightCycle = false;
      })
      .name('Sun Angle')
      .listen();

    radiation_folder.add(guiControls, 'sunIntensity', 0.0, 2.0, 0.01).onChange(function() { updateSunlight('MANUAL_ANGLE'); }).name('Sun Intensity');

    radiation_folder.add(guiControls, 'greenhouseGases', 0.0, 0.01, 0.0001)
      .onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'greenhouseGases'), guiControls.greenhouseGases);
      })
      .name('Greenhouse Gases');

    radiation_folder.add(guiControls, 'waterGreenHouseEffect', 0.0, 0.01, 0.0001)
      .onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterGreenHouseEffect'), guiControls.waterGreenHouseEffect);
      })
      .name('Water Vapor Greenhouse Effect');

    radiation_folder
      .add(guiControls, 'IR_rate', 0.0, 10.0, 0.1)
      /*.onChange(function() {
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate);
      })*/
      .name('IR Multiplier');

    var water_folder = datGui.addFolder('Water');

    water_folder.add(guiControls, 'waterTemperature', 0.0, 40.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'waterTemperature'), CtoK(guiControls.waterTemperature));
      })
      .name('Lake / Sea Temperature (°C)');

    water_folder.add(guiControls, 'dynamicWaterTemperature').name('Dynamic Water Temperature').onChange(function() {
      gl.useProgram(boundaryProgram);
      gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dynamicWaterTemperature'), guiControls.dynamicWaterTemperature ? 1.0 : 0.0);
    });

    water_folder.add(guiControls, 'landEvaporation', 0.0, 0.0002, 0.00001)
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'landEvaporation'), guiControls.landEvaporation);
      })
      .name('Land Evaporation');
    water_folder.add(guiControls, 'waterEvaporation', 0.0, 0.0004, 0.00001)
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterEvaporation'), guiControls.waterEvaporation);
      })
      .name('Lake / Sea Evaporation');
    water_folder.add(guiControls, 'evapHeat', 0.0, 5.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'evapHeat'), guiControls.evapHeat);
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapHeat'), guiControls.evapHeat);
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'evapHeat'), guiControls.evapHeat);
      })
      .name('Evaporation Heat');
    water_folder.add(guiControls, 'meltingHeat', 0.0, 5.0, 0.1)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'meltingHeat'), guiControls.meltingHeat);
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingHeat'), guiControls.meltingHeat);
      })
      .name('Melting Heat');
    water_folder.add(guiControls, 'condensationRate', 0.001, 0.020, 0.001)
      .onChange(function() {
        gl.useProgram(advectionProgram);
        gl.uniform1f(gl.getUniformLocation(advectionProgram, 'condensationRate'), guiControls.condensationRate);
      })
      .listen()
      .name('Condensation Rate');
    water_folder.add(guiControls, 'waterWeight', 0.0, 2.0, 0.01)
      .onChange(function() {
        gl.useProgram(boundaryProgram);
        gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterWeight'), guiControls.waterWeight);
      })
      .name('Water Weight');

    var precipitation_folder = datGui.addFolder('Precipitation');

    precipitation_folder.add(guiControls, 'aboveZeroThreshold', 0.1, 2.0, 0.001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'aboveZeroThreshold'), guiControls.aboveZeroThreshold);
      })
      .name('Precipitation Threshold +°C');

    precipitation_folder.add(guiControls, 'subZeroThreshold', 0.0, 1.0, 0.001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'subZeroThreshold'), guiControls.subZeroThreshold);
      })
      .name('Precipitation Threshold -°C');

    precipitation_folder.add(guiControls, 'spawnChance', 0.00001, 0.0001, 0.00001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'spawnChanceMult'), guiControls.spawnChance);
      })
      .name('Spawn Rate')
      .listen();

    precipitation_folder.add(guiControls, 'snowDensity', 0.1, 0.9, 0.01)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'snowDensity'), guiControls.snowDensity);
      })
      .name('Snow Density');

    precipitation_folder.add(guiControls, 'fallSpeed', 0.0001, 0.001, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'fallSpeed'), guiControls.fallSpeed);
      })
      .name('Fall Speed');

    precipitation_folder.add(guiControls, 'growthRate0C', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate0C'), guiControls.growthRate0C);
      })
      .name('Growth Rate 0°C');

    precipitation_folder.add(guiControls, 'growthRate_30C', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'growthRate_30C'), guiControls.growthRate_30C);
      })
      .name('Growth Rate -30°C');

    precipitation_folder
      .add(guiControls, 'freezingRate', 0.0005, 0.01, 0.0001) // 0.0035
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'freezingRate'), guiControls.freezingRate);
      })
      .name('Freezing Rate');

    precipitation_folder
      .add(guiControls, 'meltingRate', 0.0005, 0.01, 0.0001) // 0.0035
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'meltingRate'), guiControls.meltingRate);
      })
      .name('Melting Rate');

    precipitation_folder.add(guiControls, 'evapRate', 0.0001, 0.005, 0.0001)
      .onChange(function() {
        gl.useProgram(precipitationProgram);
        gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'evapRate'), guiControls.evapRate);
      })
      .name('Evaporation Rate');

    precipitation_folder.add(guiControls, 'inactiveDroplets', 0, NUM_DROPLETS).listen().name('Inactive Droplets');


    var display_folder = datGui.addFolder('Display');

    radarDisplayModeController = display_folder
      .add(guiControls, 'displayMode', {
        '1 Temperature -26°C to 30°C' : 'DISP_TEMPERATURE',
        '2 Water Vapor' : 'DISP_WATER',
        '3 Realistic' : 'DISP_REAL',
        '4 Horizontal Velocity' : 'DISP_HORIVEL',
        '5 Vertical Velocity' : 'DISP_VERTVEL',
        '6 IR Heating / Cooling' : 'DISP_IRHEATING',
        '7 IR Down -60°C to 26°C' : 'DISP_IRDOWNTEMP',
        '8 IR Up -26°C to 30°C' : 'DISP_IRUPTEMP',
        '9 Precipitation Mass' : 'DISP_PRECIPFEEDBACK_MASS',
        'Particle Size (Drops)' : 'DISP_PARTICLE_SIZE',
        'Precipitation Heating/Cooling' : 'DISP_PRECIPFEEDBACK_HEAT',
        'Precipitation Condensation/Evaporation' : 'DISP_PRECIPFEEDBACK_VAPOR',
        'Rain Deposition' : 'DISP_PRECIPFEEDBACK_RAIN',
        'Snow Deposition' : 'DISP_PRECIPFEEDBACK_SNOW',
        'Precipitation/Soil Moisture' : 'DISP_SOIL_MOISTURE',
        'Curl' : 'DISP_CURL',
        'Air Quality' : 'DISP_AIRQUALITY',
        'Reflectivity (beta)' : 'DISP_REFLECTIVITY',
        'Correlation Coefficient (rhohv)' : 'DISP_RHOHV',
        'Differential Reflectivity (ZDR)' : 'DISP_ZDR'
      })
      .name('Display Mode')
      .onChange(function() {
        const radarProductId = getRadarProductIdForDisplayMode(guiControls.displayMode);
        if (radarProductId) {
          activateRadarProduct(radarProductId);
        } else {
          handleRadarUiExternalChange();
        }
      })
      .listen();
    display_folder.add(guiControls, 'exposure', 0.5, 5.0, 0.01)
      .onChange(function() {
        gl.useProgram(postProcessingProgram);
        gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
      })
      .name('Exposure');

    display_folder.add(guiControls, 'camSpeed', 0.001, 0.050, 0.001).name('Camera Pan Speed');


    display_folder.add(guiControls, 'wrapHorizontally')
      .onChange(function() {
        cam.wrapHorizontally = guiControls.wrapHorizontally;
        cam.center();
        if (guiControls.wrapHorizontally)
          horizontalDisplayMult = 3.0;
        else
          horizontalDisplayMult = 1.0;
      })
      .name('Wrap Horizontally');

    display_folder.add(guiControls, 'SmoothCam').onChange(function() { cam.smooth = guiControls.SmoothCam; }).name('Smooth Camera');

    display_folder.add(guiControls, 'showDrops').name('Show Droplets').listen();
    display_folder.add(guiControls, 'realDewPoint').name('Show Real Dew Point');


    display_folder.add(guiControls, 'twelveHourClock').name('12-hour clock');

    display_folder
      .add(guiControls, 'lengthUnit', {
        'km / meters / cm / mm' : 'LENGTH_UNIT_METRIC',
        'miles / ft / inch' : 'LENGTH_UNIT_IMPERIAL',
      })
      .name('Length Unit')
      .onChange(function() {
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });

    display_folder
      .add(guiControls, 'speedUnit', {
        'km/h' : 'SPEED_UNIT_KMH',
        'm/s' : 'SPEED_UNIT_MS',
        'mph' : 'SPEED_UNIT_MPH',
        'kt' : 'SPEED_UNIT_KT',
      })
      .name('Speed Unit')
      .onChange(function() {
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });

    display_folder
      .add(guiControls, 'tempUnit', {
        '°C' : 'TEMP_UNIT_C',
        '°F' : 'TEMP_UNIT_F',
        'K' : 'TEMP_UNIT_K',
      })
      .name('Temperature Unit')
      .onChange(function() {
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      });


    var advanced_folder = datGui.addFolder('Advanced');

    advanced_folder.add(guiControls, 'enablePrecipitation')
      .onChange(function() {
        initRainDrops();
        setupPrecipitationBuffers();
        guiControls.inactiveDroplets = NUM_DROPLETS;
      })
      .name('Enable Precipitation');

    advanced_folder.add(guiControls, 'IterPerFrame', 1, 50, 1).onChange(function() { guiControls.auto_IterPerFrame = false; }).name('Iterations / Frame').listen();

    advanced_folder.add(guiControls, 'auto_IterPerFrame').name('Auto Adjust').listen();


    advanced_folder.add(guiControls, 'sound').name('Enable Sound').onChange(function() {
      if (guiControls.sound) {
        if (soundSystem == null) {
          soundSystem = new SoundSystem();
        }
      } else {
        soundSystem.mute();
      }
    });

    advanced_folder.add(guiControls, 'resetSettings').name('Reset all settings');

    datGui.add(guiControls, 'paused').onChange(handlePause).name('Paused').listen();
    datGui.add(guiControls, 'download').name('Save Simulation to File');

    // Soundings tab at the bottom
    var soundings_folder = datGui.addFolder('Soundings');
    soundings_folder.add(guiControls, 'showGraph').onChange(hideOrShowGraph).name('Show Sounding Graph').listen();
    soundings_folder.add(guiControls, 'soundingSmoothing').name('Smooth Sounding (±2 cols)').listen().onChange(() => { soundingProbeNeedsRedraw = true; });
    soundings_folder.add(guiControls, 'showCAPE').name('Show CAPE').listen();
    soundings_folder.add(guiControls, 'showCIN').name('Show CIN').listen();
    soundings_folder.add(guiControls, 'showMLCAPE').name('Show MLCAPE').listen();
    soundings_folder.add(guiControls, 'showCAPE03').name('Show 0-3 km CAPE').listen();

    // Radar-specific controls
    var radar_folder = datGui.addFolder('Radar');
    radar_folder.add(guiControls, 'reflectivityRefreshSec', 0.0, 10.0, 0.01)
      .onChange(function() {
        handleRadarUiExternalChange();
      })
      .name('Radar refresh (s)')
      .listen();

    var reflectivity_folder = datGui.addFolder('Reflectivity');
    reflectivity_folder.add(guiControls, 'reflectivityBackground').onChange(handleRadarUiExternalChange).name('Reflectivity Background').listen();
    reflectivity_folder.add(guiControls, 'debugReflectivity').onChange(handleRadarUiExternalChange).name('Debug dBZ at Cursor').listen();
    reflectivity_folder.add(guiControls, 'reflectivityPixelSize', 1, 32, 1)
      .name('Reflectivity Pixel Size')
      .onChange(function() {
        lastReflectivitySnapshotTime = -Infinity;
        handleRadarUiExternalChange();
      })
      .listen();

    var rhohv_folder = datGui.addFolder('Correlation Coefficient');
    rhohv_folder.add(guiControls, 'rhohvLowCCArtifacts').onChange(handleRadarUiExternalChange).name('Low CC Artifacts').listen();
    rhohv_folder.add(guiControls, 'rhohvClutterDensity', 0.0, 3.0, 0.01).onChange(handleRadarUiExternalChange).name('Clutter Density').listen();
    rhohv_folder.add(guiControls, 'rhohvBackground').onChange(handleRadarUiExternalChange).name('rhohv Background').listen();
    rhohv_folder.add(guiControls, 'debugRhohv').onChange(handleRadarUiExternalChange).name('Debug rhohv at Cursor').listen();
    rhohv_folder.add(guiControls, 'rhohvPixelSize', 1, 32, 1)
      .name('rhohv Pixel Size')
      .onChange(function() {
        lastReflectivitySnapshotTime = -Infinity;
        handleRadarUiExternalChange();
      })
      .listen();

    var zdr_folder = datGui.addFolder('Differential Reflectivity');
    zdr_folder.add(guiControls, 'zdrBackground').onChange(handleRadarUiExternalChange).name('ZDR Background').listen();
    zdr_folder.add(guiControls, 'debugZdr').onChange(handleRadarUiExternalChange).name('Debug ZDR at Cursor').listen();
    zdr_folder.add(guiControls, 'zdrPixelSize', 1, 32, 1)
      .name('ZDR Pixel Size')
      .onChange(function() {
        handleRadarUiExternalChange();
      })
      .listen();
    zdr_folder.add(guiControls, 'zdrFillRadius', 0, 4, 1)
      .name('ZDR Fill Radius')
      .onChange(function() {
        lastReflectivitySnapshotTime = -Infinity;
        handleRadarUiExternalChange();
      })
      .listen();
    zdr_folder.add(guiControls, 'zdrMaskDbz', -10.0, 35.0, 0.1)
      .name('ZDR Min dBZ')
      .onChange(function() {
        lastReflectivitySnapshotTime = -Infinity;
        handleRadarUiExternalChange();
      })
      .listen();

    datGui.width = 400;
  }

  function isRhohvMode(displayMode)
  {
    return displayMode == 'DISP_RHOHV';
  }

  function isZdrMode(displayMode)
  {
    return displayMode == 'DISP_ZDR';
  }

  function getRadarProductBackground(displayMode)
  {
    if (isRhohvMode(displayMode))
      return guiControls.rhohvBackground;
    if (isZdrMode(displayMode))
      return guiControls.zdrBackground;
    return guiControls.reflectivityBackground;
  }

  function getRadarProductDebugEnabled(displayMode)
  {
    if (isRhohvMode(displayMode))
      return guiControls.debugRhohv;
    if (isZdrMode(displayMode))
      return guiControls.debugZdr;
    return guiControls.debugReflectivity;
  }

  var radarDrawerRootEl = null;
  var radarDrawerLauncherEl = null;
  var radarDrawerLauncherLabelEl = null;
  var radarDrawerLauncherStationBadgeEl = null;
  var radarDrawerBackEl = null;
  var radarDrawerCloseEl = null;
  var radarDrawerLocationEl = null;
  var radarDrawerPanelEl = null;
  var radarPanelCompositeTabEl = null;
  var radarPanelSingleStationTabEl = null;
  var radarProductListEl = null;
  var radarStationListEl = null;
  var radarStationSummaryEl = null;
  var radarSettingsSheetEl = null;
  var radarSettingsToggleEl = null;
  var radarSettingsArrowEl = null;
  var radarSettingsPeekTitleEl = null;
  var radarSettingsTitleEl = null;
  var radarSettingsMetaEl = null;
  var radarSettingsContentEl = null;
  var radarTowerPopupEl = null;
  var radarTowerPopupBodyEl = null;
  var radarTowerPopupTitleEl = null;
  var radarTowerPopupCloseEl = null;
  var radarTowerPopupTowerId = null;
  var radarTowerPopupDragging = false;
  var radarTowerPopupDragOffsetX = 0;
  var radarTowerPopupDragOffsetY = 0;
  var radarDrawerOpen = false;
  var radarSettingsOpen = false;
  var radarPanelMode = RADAR_PANEL_MODE_SINGLE_STATION;
  radarPanelModeForMarkers = radarPanelMode;
  selectedRadarTowerId = null;

  function getRadarProductRenderMode(displayMode)
  {
    if (displayMode == 'DISP_REFLECTIVITY')
      return 0;
    if (displayMode == 'DISP_RHOHV')
      return 1;
    if (displayMode == 'DISP_ZDR')
      return 2;
    return -1;
  }

  function getEnabledRadarTowers()
  {
    return radarTowers.filter((tower) => tower.isEnabled());
  }

  function getPolarRadarRenderTowers()
  {
    if (radarPanelMode == RADAR_PANEL_MODE_SINGLE_STATION) {
      const selectedRadarTower = getSelectedRadarTower();
      return selectedRadarTower ? [ selectedRadarTower ] : [];
    }

    return getEnabledRadarTowers().slice(0, RADAR_MAX_RENDER_SITES);
  }

  function shouldUsePolarRadarRenderer(displayMode)
  {
    if (!getRadarProductIdForDisplayMode(displayMode))
      return false;
    return getPolarRadarRenderTowers().length > 0;
  }

  function getRadarProductPixelSize(displayMode)
  {
    if (displayMode == 'DISP_RHOHV')
      return Math.max(1.0, Math.round(guiControls.rhohvPixelSize));
    if (displayMode == 'DISP_ZDR')
      return Math.max(1.0, Math.round(guiControls.zdrPixelSize));
    return Math.max(1.0, Math.round(guiControls.reflectivityPixelSize));
  }

  function buildPolarRadarUniformData(towers)
  {
    const sites = new Float32Array(RADAR_MAX_RENDER_SITES * 4);
    const params = new Float32Array(RADAR_MAX_RENDER_SITES * 4);

    for (let index = 0; index < towers.length && index < RADAR_MAX_RENDER_SITES; index++) {
      const tower = towers[index];
      const effective = tower.getEffectiveSettings();
      const rangeBinKm = effective.resolutionKm;
      const beamWidthDeg = effective.beamWidthDeg;
      const offset = index * 4;

      sites[offset + 0] = (tower.getXpos() + 0.5) / sim_res_x;
      sites[offset + 1] = (tower.getYpos() + 0.5) / sim_res_y;
      sites[offset + 2] = effective.rangeKm;
      sites[offset + 3] = Math.max(0.01, rangeBinKm);

      params[offset + 0] = Math.max(0.05, beamWidthDeg);
      params[offset + 1] = effective.attenuation;
      params[offset + 2] = effective.refreshSec;
      params[offset + 3] = 0.0;
    }

    return {
      count : Math.min(towers.length, RADAR_MAX_RENDER_SITES),
      sites,
      params,
    };
  }

  function formatRadarUiNumber(value, digits = 2)
  {
    return Number(value).toFixed(digits).replace(/\.?0+$/, '');
  }

  function getVisibleRadarProductsForPanelMode()
  {
    if (radarPanelMode == RADAR_PANEL_MODE_COMPOSITE) {
      if (getEnabledRadarTowers().length == 0) {
        return RADAR_PRODUCTS.filter((product) =>
          product.id != RADAR_PRODUCT_RADIAL_VELOCITY &&
          product.id != RADAR_PRODUCT_KDP
        );
      }
      return RADAR_PRODUCTS.filter((product) => product.id == RADAR_PRODUCT_REFLECTIVITY);
    }
    return RADAR_PRODUCTS;
  }

  function getSelectedRadarTower()
  {
    return radarTowers.find((tower) => tower.getId() == selectedRadarTowerId) || null;
  }

  function setSelectedRadarTower(towerId)
  {
    if (!towerId) {
      selectedRadarTowerId = null;
      setRadarPanelMode(RADAR_PANEL_MODE_COMPOSITE);
      return;
    }

    const tower = radarTowers.find((entry) => entry.getId() == towerId);
    if (!tower)
      return;

    selectedRadarTowerId = towerId;
    setRadarPanelMode(RADAR_PANEL_MODE_SINGLE_STATION);
  }

  function toggleRadarTowerSelection(towerId)
  {
    if (!towerId)
      return;

    if (selectedRadarTowerId == towerId) {
      selectedRadarTowerId = null;
      setRadarPanelMode(RADAR_PANEL_MODE_COMPOSITE);
      return;
    }

    setSelectedRadarTower(towerId);
  }

  function handleRadarTowerRemoved(towerId)
  {
    if (!towerId)
      return;

    if (selectedRadarTowerId == towerId) {
      selectedRadarTowerId = null;
      setRadarPanelMode(RADAR_PANEL_MODE_COMPOSITE);
      if (radarTowerPopupTowerId == towerId)
        closeRadarTowerPopup();
      return;
    }

    if (radarTowerPopupTowerId == towerId)
      closeRadarTowerPopup();

    if (radarDrawerOpen)
      renderRadarStationList();
  }

  function ensureRadarTowerPopup()
  {
    if (radarTowerPopupEl)
      return;

    const popup = document.createElement('div');
    popup.id = 'radarTowerSettingsPopup';
    popup.style.position = 'fixed';
    popup.style.left = '20px';
    popup.style.top = '110px';
    popup.style.width = '360px';
    popup.style.maxWidth = 'min(94vw, 420px)';
    popup.style.maxHeight = 'min(78vh, 640px)';
    popup.style.display = 'none';
    popup.style.flexDirection = 'column';
    popup.style.overflow = 'hidden';
    popup.style.zIndex = '6';
    popup.style.borderRadius = '14px';
    popup.style.border = '1px solid rgba(255, 186, 133, 0.28)';
    popup.style.background = 'linear-gradient(180deg, rgba(20, 24, 40, 0.97), rgba(12, 16, 30, 0.98))';
    popup.style.boxShadow = '0 18px 38px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.04)';
    popup.style.backdropFilter = 'blur(10px)';
    popup.style.pointerEvents = 'auto';

    const header = document.createElement('div');
    header.style.display = 'grid';
    header.style.gridTemplateColumns = '1fr auto';
    header.style.alignItems = 'center';
    header.style.gap = '8px';
    header.style.padding = '10px 12px';
    header.style.cursor = 'move';
    header.style.borderBottom = '1px solid rgba(255,255,255,0.08)';
    header.style.background = 'linear-gradient(180deg, rgba(43, 53, 86, 0.45), rgba(21, 28, 47, 0.45))';

    const title = document.createElement('div');
    title.style.fontFamily = '"Cascadia Code", monospace';
    title.style.fontSize = '0.92rem';
    title.style.fontWeight = '700';
    title.style.color = '#fff2e6';
    title.textContent = 'Radar Tower Settings';
    header.appendChild(title);
    radarTowerPopupTitleEl = title;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close radar tower settings');
    closeBtn.style.width = '30px';
    closeBtn.style.height = '30px';
    closeBtn.style.borderRadius = '8px';
    closeBtn.style.border = '1px solid rgba(255,255,255,0.16)';
    closeBtn.style.background = 'rgba(12, 16, 28, 0.8)';
    closeBtn.style.color = '#f1f3ff';
    closeBtn.style.fontSize = '1rem';
    closeBtn.style.cursor = 'pointer';
    closeBtn.addEventListener('click', function(event) {
      event.stopPropagation();
      closeRadarTowerPopup();
    });
    header.appendChild(closeBtn);
    radarTowerPopupCloseEl = closeBtn;

    header.addEventListener('mousedown', function(event) {
      if (event.button != 0)
        return;
      radarTowerPopupDragging = true;
      const rect = popup.getBoundingClientRect();
      radarTowerPopupDragOffsetX = event.clientX - rect.left;
      radarTowerPopupDragOffsetY = event.clientY - rect.top;
      event.preventDefault();
    });

    const body = document.createElement('div');
    body.style.padding = '10px 12px 12px';
    body.style.display = 'grid';
    body.style.gap = '10px';
    body.style.overflowY = 'auto';
    body.style.minHeight = '0';
    radarTowerPopupBodyEl = body;

    popup.appendChild(header);
    popup.appendChild(body);
    document.body.appendChild(popup);
    radarTowerPopupEl = popup;

    window.addEventListener('mousemove', function(event) {
      if (!radarTowerPopupDragging || !radarTowerPopupEl)
        return;
      const nextLeft = event.clientX - radarTowerPopupDragOffsetX;
      const nextTop = event.clientY - radarTowerPopupDragOffsetY;
      const maxLeft = Math.max(8, window.innerWidth - radarTowerPopupEl.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - radarTowerPopupEl.offsetHeight - 8);
      radarTowerPopupEl.style.left = clamp(nextLeft, 8, maxLeft) + 'px';
      radarTowerPopupEl.style.top = clamp(nextTop, 8, maxTop) + 'px';
    });
    window.addEventListener('mouseup', function() {
      radarTowerPopupDragging = false;
    });
  }

  function closeRadarTowerPopup()
  {
    if (!radarTowerPopupEl)
      return;
    radarTowerPopupEl.style.display = 'none';
    radarTowerPopupTowerId = null;
    radarTowerPopupDragging = false;
  }

  function positionRadarTowerPopupNearTower(tower)
  {
    if (!radarTowerPopupEl || !tower)
      return;

    const anchorX = simToScreenX(tower.getXpos());
    const anchorY = simToScreenY(tower.getYpos());
    const popupW = radarTowerPopupEl.offsetWidth || 360;
    const popupH = radarTowerPopupEl.offsetHeight || 420;

    let nextLeft = Math.round(anchorX + 20);
    let nextTop = Math.round(anchorY - popupH * 0.62);
    const maxLeft = Math.max(8, window.innerWidth - popupW - 8);
    const maxTop = Math.max(8, window.innerHeight - popupH - 8);
    nextLeft = clamp(nextLeft, 8, maxLeft);
    nextTop = clamp(nextTop, 8, maxTop);

    radarTowerPopupEl.style.left = nextLeft + 'px';
    radarTowerPopupEl.style.top = nextTop + 'px';
  }

  function renderRadarTowerPopup()
  {
    if (!radarTowerPopupBodyEl)
      return;

    const tower = radarTowers.find((entry) => entry.getId() == radarTowerPopupTowerId) || null;
    radarTowerPopupBodyEl.replaceChildren();
    if (!tower)
      return;

    const settings = tower.getSettings();
    if (radarTowerPopupTitleEl)
      radarTowerPopupTitleEl.textContent = 'Radar Tower Settings - ' + tower.getCode();

    appendRadarTextControl(radarTowerPopupBodyEl, {
      label : 'Radar Name',
      description : 'Up to 4 characters.',
      value : settings.name,
      placeholder : 'R001',
      maxLength : 4,
      onInput : function(value, inputEl) {
        tower.setName(value);
        handleRadarUiExternalChange();
        if (inputEl)
          inputEl.value = tower.getCode();
      },
    });

    appendRadarSelectControl(radarTowerPopupBodyEl, {
      label : 'Radar Type',
      value : settings.radarType,
      options : [
        {value : 'X', label : 'X-band'},
        {value : 'C', label : 'C-band'},
        {value : 'S', label : 'S-band'},
        {value : 'CUSTOM', label : 'Custom'},
      ],
      onChange : function(nextType) {
        tower.setRadarType(nextType);
        renderRadarTowerPopup();
      },
    });

    if (settings.radarType == 'CUSTOM') {
      appendRadarRangeControl(radarTowerPopupBodyEl, {
        label : 'Range (km)',
        description : 'Placeholder custom range.',
        min : RADAR_PARAM_LIMITS.rangeKm.min,
        max : RADAR_PARAM_LIMITS.rangeKm.max,
        step : RADAR_PARAM_LIMITS.rangeKm.step,
        getValue : function() { return settings.customRangeKm; },
        formatValue : function(value) { return Math.round(value).toString(); },
        onInput : function(value) { tower.setCustomRangeKm(Math.round(value)); },
      });

      appendRadarRangeControl(radarTowerPopupBodyEl, {
        label : 'Resolution (km)',
        description : 'Placeholder radar bin size.',
        min : RADAR_PARAM_LIMITS.resolutionKm.min,
        max : RADAR_PARAM_LIMITS.resolutionKm.max,
        step : RADAR_PARAM_LIMITS.resolutionKm.step,
        getValue : function() { return settings.customResolutionKm; },
        formatValue : function(value) { return formatRadarUiNumber(value, 2); },
        onInput : function(value) { tower.setCustomResolutionKm(value); },
      });

      appendRadarRangeControl(radarTowerPopupBodyEl, {
        label : 'Attenuation',
        description : 'Placeholder signal attenuation.',
        min : RADAR_PARAM_LIMITS.attenuation.min,
        max : RADAR_PARAM_LIMITS.attenuation.max,
        step : RADAR_PARAM_LIMITS.attenuation.step,
        getValue : function() { return settings.customAttenuation; },
        formatValue : function(value) { return formatRadarUiNumber(value, 2); },
        onInput : function(value) { tower.setCustomAttenuation(value); },
      });

      appendRadarRangeControl(radarTowerPopupBodyEl, {
        label : 'Refresh Rate (s)',
        description : 'Placeholder per-radar refresh.',
        min : RADAR_PARAM_LIMITS.refreshSec.min,
        max : RADAR_PARAM_LIMITS.refreshSec.max,
        step : RADAR_PARAM_LIMITS.refreshSec.step,
        getValue : function() { return settings.customRefreshSec; },
        formatValue : function(value) { return formatRadarUiNumber(value, 2); },
        onInput : function(value) { tower.setCustomRefreshSec(value); },
      });

      appendRadarRangeControl(radarTowerPopupBodyEl, {
        label : 'Beam Width (deg)',
        description : 'Placeholder beam width.',
        min : RADAR_PARAM_LIMITS.beamWidthDeg.min,
        max : RADAR_PARAM_LIMITS.beamWidthDeg.max,
        step : RADAR_PARAM_LIMITS.beamWidthDeg.step,
        getValue : function() { return settings.customBeamWidthDeg; },
        formatValue : function(value) { return formatRadarUiNumber(value, 2); },
        onInput : function(value) { tower.setCustomBeamWidthDeg(value); },
      });
    }

    appendRadarActionControl(radarTowerPopupBodyEl, {
      label : 'Radar Actions',
      actions : [
        {
          label : settings.enabled ? 'Disable In Composite' : 'Enable In Composite',
          onClick : function() {
            tower.setEnabled(!settings.enabled);
            handleRadarUiExternalChange();
            renderRadarTowerPopup();
          },
        },
        {
          label : 'Remove Radar',
          variant : 'danger',
          onClick : function() {
            tower.destroy();
            if (radarDrawerOpen)
              renderRadarStationList();
          },
        },
      ],
      note : 'These controls are placeholders for future radar logic.',
    });
  }

  function handleRadarTowerToolClick(towerId)
  {
    if (!towerId)
      return;

    setSelectedRadarTower(towerId);
    ensureRadarTowerPopup();
    radarTowerPopupTowerId = towerId;
    radarTowerPopupEl.style.display = 'flex';
    renderRadarTowerPopup();
    const tower = radarTowers.find((entry) => entry.getId() == towerId) || null;
    positionRadarTowerPopupNearTower(tower);
  }

  radarTowerSelectionBridge = toggleRadarTowerSelection;
  radarTowerRemovedBridge = handleRadarTowerRemoved;
  radarTowerToolClickBridge = handleRadarTowerToolClick;

  function setRadarPanelMode(nextMode)
  {
    const mode = nextMode == RADAR_PANEL_MODE_SINGLE_STATION ? RADAR_PANEL_MODE_SINGLE_STATION : RADAR_PANEL_MODE_COMPOSITE;
    radarPanelMode = mode;
    radarPanelModeForMarkers = mode;

    if (mode == RADAR_PANEL_MODE_COMPOSITE && guiControls.selectedRadarProduct != RADAR_PRODUCT_REFLECTIVITY) {
      setSelectedRadarProduct(RADAR_PRODUCT_REFLECTIVITY, {activateIfImplemented : true});
      return;
    }

    handleRadarUiExternalChange();
  }

  function updateRadarPanelShell()
  {
    if (!radarDrawerRootEl)
      return;

    const selectedRadarProduct = getRadarProductMeta(guiControls.selectedRadarProduct);
    radarDrawerRootEl.classList.toggle('is-open', radarDrawerOpen);
    radarDrawerRootEl.classList.toggle('has-settings-open', radarSettingsOpen);
    radarDrawerLauncherEl.setAttribute('aria-expanded', radarDrawerOpen ? 'true' : 'false');
    radarDrawerPanelEl.setAttribute('aria-hidden', radarDrawerOpen ? 'false' : 'true');
    if (radarDrawerLauncherLabelEl)
      radarDrawerLauncherLabelEl.textContent = selectedRadarProduct.launcherLabel;
    const selectedRadarTower = getSelectedRadarTower();
    if (radarDrawerLauncherStationBadgeEl) {
      radarDrawerLauncherStationBadgeEl.textContent = selectedRadarTower ? selectedRadarTower.getCode() : 'RADAR';
      radarDrawerLauncherStationBadgeEl.classList.toggle('is-hidden', !selectedRadarTower || radarPanelMode == RADAR_PANEL_MODE_COMPOSITE);
    }
    if (radarDrawerLocationEl)
      radarDrawerLocationEl.textContent = selectedRadarTower && radarPanelMode == RADAR_PANEL_MODE_SINGLE_STATION ?
        selectedRadarTower.getCode() + ' (Poland)' :
        (radarPanelMode == RADAR_PANEL_MODE_SINGLE_STATION ? 'No station selected' : 'Composite (Poland)');
    if (radarPanelCompositeTabEl) {
      const compositeTabSelected = radarPanelMode == RADAR_PANEL_MODE_COMPOSITE;
      radarPanelCompositeTabEl.classList.toggle('is-active', compositeTabSelected);
      radarPanelCompositeTabEl.setAttribute('aria-selected', compositeTabSelected ? 'true' : 'false');
    }
    if (radarPanelSingleStationTabEl) {
      const singleStationTabSelected = radarPanelMode == RADAR_PANEL_MODE_SINGLE_STATION;
      radarPanelSingleStationTabEl.classList.toggle('is-active', singleStationTabSelected);
      radarPanelSingleStationTabEl.setAttribute('aria-selected', singleStationTabSelected ? 'true' : 'false');
    }
    if (radarSettingsToggleEl)
      radarSettingsToggleEl.setAttribute('aria-expanded', radarSettingsOpen ? 'true' : 'false');
    if (radarSettingsArrowEl)
      radarSettingsArrowEl.textContent = radarSettingsOpen ? '▾' : '▴';
    if (radarSettingsPeekTitleEl)
      radarSettingsPeekTitleEl.textContent = selectedRadarProduct.label;
  }

  function handleRadarUiExternalChange()
  {
    syncLegacyRadarProductField();
    updateRadarPanelShell();
    if (radarDrawerOpen) {
      renderRadarProductList();
      renderRadarStationList();
      renderRadarSettings();
    }
    if (radarDisplayModeController)
      radarDisplayModeController.updateDisplay();
  }

  function appendRadarToggleControl(parent, label, description, checked, onChange)
  {
    const wrapper = document.createElement('label');
    wrapper.className = 'radar-control radar-control--toggle';

    const copy = document.createElement('div');
    copy.className = 'radar-control__copy';

    const title = document.createElement('span');
    title.className = 'radar-control__label';
    title.textContent = label;
    copy.appendChild(title);

    if (description) {
      const descriptionEl = document.createElement('span');
      descriptionEl.className = 'radar-control__description';
      descriptionEl.textContent = description;
      copy.appendChild(descriptionEl);
    }

    const input = document.createElement('input');
    input.className = 'radar-control__checkbox';
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', function(event) {
      onChange(event.target.checked);
    });

    wrapper.appendChild(copy);
    wrapper.appendChild(input);
    parent.appendChild(wrapper);
  }

  function appendRadarRangeControl(parent, config)
  {
    const wrapper = document.createElement('label');
    wrapper.className = 'radar-control radar-control--range';

    const topRow = document.createElement('div');
    topRow.className = 'radar-control__toprow';

    const labelEl = document.createElement('span');
    labelEl.className = 'radar-control__label';
    labelEl.textContent = config.label;
    topRow.appendChild(labelEl);

    const valueEl = document.createElement('span');
    valueEl.className = 'radar-control__value';
    valueEl.textContent = config.formatValue(config.getValue());
    topRow.appendChild(valueEl);

    wrapper.appendChild(topRow);

    if (config.description) {
      const descriptionEl = document.createElement('span');
      descriptionEl.className = 'radar-control__description';
      descriptionEl.textContent = config.description;
      wrapper.appendChild(descriptionEl);
    }

    const input = document.createElement('input');
    input.className = 'radar-control__slider';
    input.type = 'range';
    input.min = config.min;
    input.max = config.max;
    input.step = config.step;
    input.value = config.getValue();
    input.addEventListener('input', function(event) {
      const nextValue = Number(event.target.value);
      config.onInput(nextValue);
      valueEl.textContent = config.formatValue(nextValue);
    });
    wrapper.appendChild(input);
    parent.appendChild(wrapper);
  }

  function appendRadarSelectControl(parent, config)
  {
    const wrapper = document.createElement('div');
    wrapper.className = 'radar-control radar-control--select';

    const topRow = document.createElement('div');
    topRow.className = 'radar-control__toprow';

    const labelEl = document.createElement('span');
    labelEl.className = 'radar-control__label';
    labelEl.textContent = config.label;
    topRow.appendChild(labelEl);

    if (config.valueLabel) {
      const valueEl = document.createElement('span');
      valueEl.className = 'radar-control__value';
      valueEl.textContent = config.valueLabel;
      topRow.appendChild(valueEl);
    }

    wrapper.appendChild(topRow);

    const select = document.createElement('select');
    select.className = 'radar-control__select';

    for (const optionConfig of config.options) {
      const option = document.createElement('option');
      option.value = optionConfig.value;
      option.textContent = optionConfig.label;
      select.appendChild(option);
    }

    select.value = config.value;
    select.addEventListener('change', function(event) {
      config.onChange(event.target.value);
    });

    wrapper.appendChild(select);
    parent.appendChild(wrapper);
  }

  function appendRadarTextControl(parent, config)
  {
    const wrapper = document.createElement('div');
    wrapper.className = 'radar-control radar-control--select';

    const topRow = document.createElement('div');
    topRow.className = 'radar-control__toprow';

    const labelEl = document.createElement('span');
    labelEl.className = 'radar-control__label';
    labelEl.textContent = config.label;
    topRow.appendChild(labelEl);
    wrapper.appendChild(topRow);

    if (config.description) {
      const descriptionEl = document.createElement('span');
      descriptionEl.className = 'radar-control__description';
      descriptionEl.textContent = config.description;
      wrapper.appendChild(descriptionEl);
    }

    const input = document.createElement('input');
    input.className = 'radar-control__select';
    input.type = 'text';
    input.maxLength = config.maxLength || 64;
    input.value = config.value || '';
    input.placeholder = config.placeholder || '';
    input.addEventListener('input', function(event) {
      if (typeof config.onInput == 'function')
        config.onInput(event.target.value, event.target);
    });

    wrapper.appendChild(input);
    parent.appendChild(wrapper);
  }

  function appendRadarActionControl(parent, config)
  {
    const wrapper = document.createElement('div');
    wrapper.className = 'radar-control radar-control--actions';

    if (config.label) {
      const labelEl = document.createElement('span');
      labelEl.className = 'radar-control__label';
      labelEl.textContent = config.label;
      wrapper.appendChild(labelEl);
    }

    const actionsEl = document.createElement('div');
    actionsEl.className = 'radar-control__actions';

    for (const actionConfig of config.actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'radar-control__button';
      if (actionConfig.variant == 'danger')
        button.classList.add('radar-control__button--danger');
      button.textContent = actionConfig.label;
      button.disabled = !!actionConfig.disabled;
      button.addEventListener('click', function() {
        if (!button.disabled)
          actionConfig.onClick();
      });
      actionsEl.appendChild(button);
    }

    wrapper.appendChild(actionsEl);

    if (config.note) {
      const noteEl = document.createElement('span');
      noteEl.className = 'radar-control__note';
      noteEl.textContent = config.note;
      wrapper.appendChild(noteEl);
    }

    parent.appendChild(wrapper);
  }

  function getRadarPaletteOptions(productId)
  {
    const productState = getRadarPaletteStateForProduct(productId);
    const options = [
      {
        value : getBuiltinRadarPaletteId(productId),
        label : 'Default',
      },
    ];

    if (!productState)
      return options;

    for (const palette of productState.customPalettes) {
      options.push({
        value : palette.id,
        label : palette.name,
      });
    }

    return options;
  }

  function getSelectedCustomRadarPalette(productId)
  {
    const productState = getRadarPaletteStateForProduct(productId);
    if (!productState)
      return null;
    return productState.customPalettes.find((palette) => palette.id == productState.selectedPaletteId) || null;
  }

  function requestRadarPaletteUpload(productId)
  {
    ensureRadarPanel();
    if (!radarPaletteFileInputEl)
      return;

    radarPaletteImportTargetProductId = productId;
    radarPaletteFileInputEl.value = '';
    radarPaletteFileInputEl.click();
  }

  async function handleRadarPaletteFileSelection(event)
  {
    const file = event.target.files && event.target.files[0];
    const productId = radarPaletteImportTargetProductId;
    radarPaletteImportTargetProductId = null;

    if (!file || !productId)
      return;

    try {
      const paletteDefinition = normalizeRadarPaletteDefinition(
        parseRadarPaletteFile(await file.text(), productId, file.name),
        productId,
        getRadarPaletteNameFromFilename(file.name)
      );

      if (!paletteDefinition)
        throw new Error('The imported .pal file could not be normalized.');

      const productState = getRadarPaletteStateForProduct(productId);
      if (!productState)
        throw new Error('Radar palette state is unavailable.');

      productState.customPalettes.push(paletteDefinition);
      productState.selectedPaletteId = paletteDefinition.id;
      updateRadarPaletteTexture();
      handleRadarUiExternalChange();

      const importedProductCode = paletteDefinition.meta ? paletteDefinition.meta.productCode : '';
      if (importedProductCode && !isRadarPaletteCompatibleWithProduct(productId, importedProductCode)) {
        alert(
          'Imported palette declares Product: ' + importedProductCode +
          '. It was attached to ' + getRadarProductMeta(productId).label + ' anyway.'
        );
      }
    } catch (error) {
      alert('Failed to import .pal file: ' + error.message);
    } finally {
      event.target.value = '';
    }
  }

  function removeSelectedCustomRadarPalette(productId)
  {
    const productState = getRadarPaletteStateForProduct(productId);
    const selectedCustomPalette = getSelectedCustomRadarPalette(productId);

    if (!productState || !selectedCustomPalette)
      return;

    if (!confirm('Remove custom palette "' + selectedCustomPalette.name + '" from ' + getRadarProductMeta(productId).label + '?'))
      return;

    productState.customPalettes = productState.customPalettes.filter((palette) => palette.id != selectedCustomPalette.id);
    productState.selectedPaletteId = getBuiltinRadarPaletteId(productId);
    updateRadarPaletteTexture();
    handleRadarUiExternalChange();
  }

  function appendRadarPaletteControls(parent, productId)
  {
    const productState = getRadarPaletteStateForProduct(productId);
    if (!productState)
      return;

    const customCount = productState.customPalettes.length;
    appendRadarSelectControl(parent, {
      label : 'Palette',
      value : productState.selectedPaletteId,
      valueLabel : customCount > 0 ? customCount + ' custom' : 'Default only',
      options : getRadarPaletteOptions(productId),
      onChange : function(nextPaletteId) {
        productState.selectedPaletteId = nextPaletteId;
        updateRadarPaletteTexture();
        handleRadarUiExternalChange();
      },
    });

    appendRadarActionControl(parent, {
      label : 'Custom .pal',
      actions : [
        {
          label : 'Upload .pal',
          onClick : function() { requestRadarPaletteUpload(productId); },
        },
        {
          label : 'Remove Custom',
          variant : 'danger',
          disabled : !getSelectedCustomRadarPalette(productId),
          onClick : function() { removeSelectedCustomRadarPalette(productId); },
        },
      ],
      note : 'Uploaded palettes are stored in simulation save files.',
    });
  }

  function renderRadarProductList()
  {
    if (!radarProductListEl)
      return;

    radarProductListEl.replaceChildren();

    for (const product of getVisibleRadarProductsForPanelMode()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'radar-product-card';

      if (guiControls.selectedRadarProduct == product.id)
        button.classList.add('is-selected');

      const currentDisplayProduct = getRadarProductIdForDisplayMode(guiControls.displayMode);
      if (currentDisplayProduct == product.id)
        button.classList.add('is-active-view');

      const copy = document.createElement('div');
      copy.className = 'radar-product-card__copy';

      const label = document.createElement('span');
      label.className = 'radar-product-card__label';
      label.textContent = product.label;
      copy.appendChild(label);

      const description = document.createElement('span');
      description.className = 'radar-product-card__description';
      description.textContent = product.shortDescription;
      copy.appendChild(description);

      button.appendChild(copy);

      button.addEventListener('click', function() {
        setSelectedRadarProduct(product.id, {activateIfImplemented : true});
      });

      radarProductListEl.appendChild(button);
    }
  }

  function renderRadarStationList()
  {
    if (!radarStationListEl)
      return;

    radarStationListEl.replaceChildren();

    if (radarTowers.length == 0) {
      if (radarStationSummaryEl)
        radarStationSummaryEl.textContent = 'No deployed radars';

      const emptyCard = document.createElement('div');
      emptyCard.className = 'radar-station-card is-muted';

      const copy = document.createElement('div');
      copy.className = 'radar-product-card__copy';

      const label = document.createElement('span');
      label.className = 'radar-product-card__label';
      label.textContent = 'No stations';
      copy.appendChild(label);

      const description = document.createElement('span');
      description.className = 'radar-product-card__description';
      description.textContent = 'Deploy radar towers to populate this list.';
      copy.appendChild(description);

      emptyCard.appendChild(copy);
      radarStationListEl.appendChild(emptyCard);
      return;
    }

    if (radarStationSummaryEl)
      radarStationSummaryEl.textContent = radarTowers.length + ' station' + (radarTowers.length == 1 ? '' : 's') + ' deployed';

    for (const tower of radarTowers) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'radar-station-card';
      if (tower.getId() == selectedRadarTowerId && radarPanelMode == RADAR_PANEL_MODE_SINGLE_STATION)
        button.classList.add('is-selected');

      const copy = document.createElement('div');
      copy.className = 'radar-product-card__copy';

      const label = document.createElement('span');
      label.className = 'radar-product-card__label';
      label.textContent = tower.getCode();
      copy.appendChild(label);

      const description = document.createElement('span');
      description.className = 'radar-product-card__description';
      description.textContent = 'Radar tower';
      copy.appendChild(description);

      button.appendChild(copy);
      button.addEventListener('click', function() {
        toggleRadarTowerSelection(tower.getId());
      });

      radarStationListEl.appendChild(button);
    }
  }

  function renderRadarSettings()
  {
    if (!radarSettingsContentEl)
      return;

    const product = getRadarProductMeta(guiControls.selectedRadarProduct);
    radarSettingsContentEl.replaceChildren();

    if (!product.isImplemented) {
      const stateEl = document.createElement('div');
      stateEl.className = 'radar-empty-state';

      const badge = document.createElement('span');
      badge.className = 'radar-empty-state__badge';
      badge.textContent = 'Soon';
      stateEl.appendChild(badge);

      const title = document.createElement('div');
      title.className = 'radar-empty-state__title';
      title.textContent = 'Product unavailable in this version';
      stateEl.appendChild(title);

      const message = document.createElement('div');
      message.className = 'radar-empty-state__text';
      message.textContent = 'This product is planned, but not rendered in this version yet.';
      stateEl.appendChild(message);

      const fallbackProduct = getRadarProductMeta(guiControls.lastLiveRadarProduct);
      const shortcutHint = document.createElement('div');
      shortcutHint.className = 'radar-empty-state__hint';
      shortcutHint.textContent = 'Key 0 switches to: ' + fallbackProduct.label;
      stateEl.appendChild(shortcutHint);

      radarSettingsContentEl.appendChild(stateEl);
      return;
    }

    appendRadarPaletteControls(radarSettingsContentEl, product.id);
    appendRadarToggleControl(
      radarSettingsContentEl,
      'Range Rings',
      'Show gray radar range circles: selected site in single-station, enabled sites in composite.',
      guiControls.radarShowRangeRings,
      function(checked) { guiControls.radarShowRangeRings = checked; }
    );

    if (product.id == RADAR_PRODUCT_REFLECTIVITY) {
      appendRadarToggleControl(
        radarSettingsContentEl,
        'Background',
        'Blend over terrain or render as a full radar view.',
        guiControls.reflectivityBackground,
        function(checked) { guiControls.reflectivityBackground = checked; }
      );
      appendRadarToggleControl(
        radarSettingsContentEl,
        'Debug At Cursor',
        'Show sampled dBZ under the mouse cursor.',
        guiControls.debugReflectivity,
        function(checked) { guiControls.debugReflectivity = checked; }
      );
      appendRadarRangeControl(radarSettingsContentEl, {
        label : 'Pixel Size',
        description : 'Controls the blocky radar bin look.',
        min : 1,
        max : 32,
        step : 1,
        getValue : function() { return guiControls.reflectivityPixelSize; },
        formatValue : function(value) { return Math.round(value).toString(); },
        onInput : function(value) {
          guiControls.reflectivityPixelSize = Math.round(value);
          lastReflectivitySnapshotTime = -Infinity;
        },
      });
      appendRadarRangeControl(radarSettingsContentEl, {
        label : 'Radar Refresh (s)',
        description : 'Shared refresh cadence for radar snapshots.',
        min : 0,
        max : 10,
        step : 0.01,
        getValue : function() { return guiControls.reflectivityRefreshSec; },
        formatValue : function(value) { return formatRadarUiNumber(value, 2); },
        onInput : function(value) { guiControls.reflectivityRefreshSec = value; },
      });
      return;
    }

    if (product.id == RADAR_PRODUCT_ZDR) {
      appendRadarToggleControl(
        radarSettingsContentEl,
        'Background',
        'Blend over terrain or render as a full radar view.',
        guiControls.zdrBackground,
        function(checked) { guiControls.zdrBackground = checked; }
      );
      appendRadarToggleControl(
        radarSettingsContentEl,
        'Debug At Cursor',
        'Show sampled ZDR under the mouse cursor.',
        guiControls.debugZdr,
        function(checked) { guiControls.debugZdr = checked; }
      );
      appendRadarRangeControl(radarSettingsContentEl, {
        label : 'Pixel Size',
        description : 'Controls the blocky radar bin look for ZDR.',
        min : 1,
        max : 32,
        step : 1,
        getValue : function() { return guiControls.zdrPixelSize; },
        formatValue : function(value) { return Math.round(value).toString(); },
        onInput : function(value) { guiControls.zdrPixelSize = Math.round(value); },
      });
      appendRadarRangeControl(radarSettingsContentEl, {
        label : 'Fill Radius',
        description : 'Fills sparse gaps inside echo without softening the edge.',
        min : 0,
        max : 4,
        step : 1,
        getValue : function() { return guiControls.zdrFillRadius; },
        formatValue : function(value) { return Math.round(value).toString(); },
        onInput : function(value) {
          guiControls.zdrFillRadius = Math.round(value);
          lastReflectivitySnapshotTime = -Infinity;
        },
      });
      appendRadarRangeControl(radarSettingsContentEl, {
        label : 'Min dBZ',
        description : 'Hard support threshold used to keep ZDR inside actual echo.',
        min : -10,
        max : 35,
        step : 0.1,
        getValue : function() { return guiControls.zdrMaskDbz; },
        formatValue : function(value) { return formatRadarUiNumber(value, 1); },
        onInput : function(value) {
          guiControls.zdrMaskDbz = value;
          lastReflectivitySnapshotTime = -Infinity;
        },
      });
      appendRadarRangeControl(radarSettingsContentEl, {
        label : 'Radar Refresh (s)',
        description : 'Shared refresh cadence for radar snapshots.',
        min : 0,
        max : 10,
        step : 0.01,
        getValue : function() { return guiControls.reflectivityRefreshSec; },
        formatValue : function(value) { return formatRadarUiNumber(value, 2); },
        onInput : function(value) { guiControls.reflectivityRefreshSec = value; },
      });
      return;
    }

    appendRadarToggleControl(
      radarSettingsContentEl,
      'Background',
      'Blend over terrain or render as a full radar view.',
      guiControls.rhohvBackground,
      function(checked) { guiControls.rhohvBackground = checked; }
    );
    appendRadarToggleControl(
      radarSettingsContentEl,
      'Debug At Cursor',
      'Show sampled rhohv under the mouse cursor.',
      guiControls.debugRhohv,
      function(checked) { guiControls.debugRhohv = checked; }
    );
    appendRadarRangeControl(radarSettingsContentEl, {
      label : 'Pixel Size',
      description : 'Controls the apparent bin size for rhohv.',
      min : 1,
      max : 32,
      step : 1,
      getValue : function() { return guiControls.rhohvPixelSize; },
      formatValue : function(value) { return Math.round(value).toString(); },
      onInput : function(value) {
        guiControls.rhohvPixelSize = Math.round(value);
        lastReflectivitySnapshotTime = -Infinity;
      },
    });
    appendRadarToggleControl(
      radarSettingsContentEl,
      'Low CC Artifacts',
      'Keep the current noisy low-correlation styling.',
      guiControls.rhohvLowCCArtifacts,
      function(checked) { guiControls.rhohvLowCCArtifacts = checked; }
    );
    appendRadarRangeControl(radarSettingsContentEl, {
      label : 'Clutter Density',
      description : 'Adds more or less texture to low-CC regions.',
      min : 0,
      max : 3,
      step : 0.01,
      getValue : function() { return guiControls.rhohvClutterDensity; },
      formatValue : function(value) { return formatRadarUiNumber(value, 2); },
      onInput : function(value) { guiControls.rhohvClutterDensity = value; },
    });
    appendRadarRangeControl(radarSettingsContentEl, {
      label : 'Radar Refresh (s)',
      description : 'Shared refresh cadence for radar snapshots.',
      min : 0,
      max : 10,
      step : 0.01,
      getValue : function() { return guiControls.reflectivityRefreshSec; },
      formatValue : function(value) { return formatRadarUiNumber(value, 2); },
      onInput : function(value) { guiControls.reflectivityRefreshSec = value; },
    });
  }

  function ensureRadarPanel()
  {
    if (radarDrawerRootEl)
      return;

    const container = document.createElement('div');
    container.innerHTML = `
      <div id="radarDrawer" class="radar-drawer">
        <button id="radarDrawerLauncher" class="radar-drawer__launcher" type="button" aria-label="Toggle radar panel" aria-controls="radarDrawerPanel" aria-expanded="false">
          <span class="radar-drawer__launcher-icon" aria-hidden="true"></span>
          <span id="radarDrawerLauncherLabel" class="radar-drawer__launcher-label">pvol</span>
          <span id="radarDrawerLauncherStationBadge" class="radar-drawer__launcher-station-badge">RADAR</span>
        </button>
        <section id="radarDrawerPanel" class="radar-drawer__panel" aria-hidden="true">
          <div class="radar-drawer__header">
            <button id="radarDrawerBack" class="radar-drawer__navbtn" type="button" aria-label="Back">‹</button>
            <div class="radar-drawer__location">
              <span class="radar-drawer__flag" aria-hidden="true">🇵🇱</span>
              <span id="radarDrawerLocationLabel" class="radar-drawer__location-label">Single Radar (Poland)</span>
            </div>
            <button id="radarDrawerClose" class="radar-drawer__navbtn" type="button" aria-label="Close">×</button>
          </div>
          <div class="radar-panel-tabs" role="tablist" aria-label="Radar mode">
            <button id="radarTabComposite" class="radar-panel-tab" type="button" role="tab" aria-selected="false">Composite</button>
            <button id="radarTabSingleStation" class="radar-panel-tab is-active" type="button" role="tab" aria-selected="true">Single station</button>
          </div>
          <div class="radar-panel-subtitle">Radar products and stations</div>
          <div class="radar-panel-columns">
            <section class="radar-panel-column radar-panel-column--products" aria-label="Radar products">
              <div class="radar-panel-column__title">Products</div>
              <div id="radarProductList" class="radar-product-list"></div>
            </section>
            <section class="radar-panel-column radar-panel-column--stations" aria-label="Radar stations">
              <div class="radar-panel-column__title">Radar stations</div>
              <div id="radarStationSummary" class="radar-panel-column__meta">No deployed radars</div>
              <div id="radarStationList" class="radar-station-list"></div>
            </section>
          </div>
          <div id="radarSettingsSheet" class="radar-settings-sheet">
            <button id="radarSettingsToggle" class="radar-settings-sheet__tab" type="button" aria-expanded="false" aria-controls="radarSettingsBody">
              <div class="radar-settings-sheet__copy">
                <div class="radar-settings-sheet__eyebrow">Settings</div>
                <div id="radarSettingsPeekTitle" class="radar-settings-sheet__title">Reflectivity</div>
              </div>
              <span id="radarSettingsArrow" class="radar-settings-sheet__arrow" aria-hidden="true">▴</span>
            </button>
            <div id="radarSettingsBody" class="radar-settings-sheet__body">
              <div class="radar-settings">
                <div id="radarSettingsContent" class="radar-settings__content"></div>
              </div>
            </div>
          </div>
        </section>
      </div>`;

    radarDrawerRootEl = container.firstElementChild;
    document.body.appendChild(radarDrawerRootEl);

    radarDrawerLauncherEl = document.getElementById('radarDrawerLauncher');
    radarDrawerLauncherLabelEl = document.getElementById('radarDrawerLauncherLabel');
    radarDrawerLauncherStationBadgeEl = document.getElementById('radarDrawerLauncherStationBadge');
    radarDrawerBackEl = document.getElementById('radarDrawerBack');
    radarDrawerCloseEl = document.getElementById('radarDrawerClose');
    radarDrawerLocationEl = document.getElementById('radarDrawerLocationLabel');
    radarDrawerPanelEl = document.getElementById('radarDrawerPanel');
    radarPanelCompositeTabEl = document.getElementById('radarTabComposite');
    radarPanelSingleStationTabEl = document.getElementById('radarTabSingleStation');
    radarProductListEl = document.getElementById('radarProductList');
    radarStationListEl = document.getElementById('radarStationList');
    radarStationSummaryEl = document.getElementById('radarStationSummary');
    radarSettingsSheetEl = document.getElementById('radarSettingsSheet');
    radarSettingsToggleEl = document.getElementById('radarSettingsToggle');
    radarSettingsArrowEl = document.getElementById('radarSettingsArrow');
    radarSettingsPeekTitleEl = document.getElementById('radarSettingsPeekTitle');
    radarSettingsContentEl = document.getElementById('radarSettingsContent');

    radarPaletteFileInputEl = document.createElement('input');
    radarPaletteFileInputEl.type = 'file';
    radarPaletteFileInputEl.accept = '.pal';
    radarPaletteFileInputEl.style.display = 'none';
    radarPaletteFileInputEl.addEventListener('change', handleRadarPaletteFileSelection);
    document.body.appendChild(radarPaletteFileInputEl);

    const stopRadarUiPropagation = function(event) { event.stopPropagation(); };
    radarDrawerRootEl.addEventListener('keydown', stopRadarUiPropagation);
    radarDrawerRootEl.addEventListener('keyup', stopRadarUiPropagation);
    radarDrawerRootEl.addEventListener('keypress', stopRadarUiPropagation);
    radarDrawerRootEl.addEventListener('mousedown', stopRadarUiPropagation);
    radarDrawerRootEl.addEventListener('wheel', stopRadarUiPropagation);

    radarDrawerLauncherEl.addEventListener('click', function(event) {
      event.stopPropagation();
      toggleRadarPanel();
    });

    radarDrawerBackEl.addEventListener('click', function(event) {
      event.stopPropagation();
      toggleRadarPanel(false);
    });

    radarDrawerCloseEl.addEventListener('click', function(event) {
      event.stopPropagation();
      toggleRadarPanel(false);
    });

    radarPanelCompositeTabEl.addEventListener('click', function(event) {
      event.stopPropagation();
      setRadarPanelMode(RADAR_PANEL_MODE_COMPOSITE);
    });

    radarPanelSingleStationTabEl.addEventListener('click', function(event) {
      event.stopPropagation();
      setRadarPanelMode(RADAR_PANEL_MODE_SINGLE_STATION);
    });

    radarSettingsToggleEl.addEventListener('click', function(event) {
      event.stopPropagation();
      toggleRadarSettings();
    });

    updateRadarPanelShell();
  }

  function toggleRadarSettings(open)
  {
    ensureRadarPanel();
    radarSettingsOpen = open === undefined ? !radarSettingsOpen : !!open;
    updateRadarPanelShell();
  }

  function toggleRadarPanel(open)
  {
    ensureRadarPanel();
    radarDrawerOpen = open === undefined ? !radarDrawerOpen : !!open;
    if (!radarDrawerOpen)
      radarSettingsOpen = false;
    updateRadarPanelShell();

    if (radarDrawerOpen) {
      renderRadarProductList();
      renderRadarStationList();
      renderRadarSettings();
    }
  }

  function activateRadarProduct(productId, options = {})
  {
    const product = getRadarProductMeta(productId);
    if (!product.isImplemented)
      return false;

    if (!options.preserveSelectedProduct)
      guiControls.selectedRadarProduct = product.id;

    guiControls.lastLiveRadarProduct = product.id;
    guiControls.displayMode = product.displayMode;
    handleRadarUiExternalChange();
    return true;
  }

  function setSelectedRadarProduct(productId, options = {})
  {
    const product = getRadarProductMeta(productId);
    if (radarPanelMode == RADAR_PANEL_MODE_COMPOSITE && product.id != RADAR_PRODUCT_REFLECTIVITY)
      guiControls.selectedRadarProduct = RADAR_PRODUCT_REFLECTIVITY;
    else
      guiControls.selectedRadarProduct = product.id;

    if (options.activateIfImplemented && product.isImplemented) {
      activateRadarProduct(guiControls.selectedRadarProduct);
      return;
    }

    syncLegacyRadarProductField();
    updateRadarPanelShell();
    if (radarDrawerOpen) {
      renderRadarProductList();
      renderRadarStationList();
      renderRadarSettings();
    }
  }

  // guiControls.paused = true; // pause before first iteration for debugging

  await loadingBar.set(3, 'Initializing Sounding Graph');
  // END OF GUI

  let boundaryProgram;
  let lightingProgram;
  let skyBackgroundDisplayProgram;
  let realisticDisplayProgram;

  function startSimulation()
  {
    SETUP_MODE = false;
    datGui.show(); // unhide
    ensureRadarPanel();
    toggleRadarPanel(false);
    handleRadarUiExternalChange();

    if (!clockEl || !clockEl.isConnected) {
      clockEl = document.getElementById('simClock');
      if (!clockEl) {
        clockEl = document.createElement('div');
        clockEl.id = 'simClock';
        document.body.appendChild(clockEl);
      }
    }

    clockEl.innerHTML = '';
    clockEl.style.position = 'absolute';
    clockEl.style.fontFamily = 'Monospace';
    clockEl.style.fontSize = '35px';
    clockEl.style.color = 'white';
    clockEl.style.pointerEvents = 'none';

    if (!reflectivityDbgEl || !reflectivityDbgEl.isConnected) {
      reflectivityDbgEl = document.getElementById('reflectivityDebugOverlay');
      if (!reflectivityDbgEl) {
        reflectivityDbgEl = document.createElement('div');
        reflectivityDbgEl.id = 'reflectivityDebugOverlay';
        document.body.appendChild(reflectivityDbgEl);
      }
    }

    reflectivityDbgEl.style.position = 'absolute';
    reflectivityDbgEl.style.fontFamily = 'Monospace';
    reflectivityDbgEl.style.fontSize = '16px';
    reflectivityDbgEl.style.color = '#00ff00';
    reflectivityDbgEl.style.pointerEvents = 'none';
    reflectivityDbgEl.style.display = 'none';

    simDateTime = new Date(2000, Math.floor(guiControls.month) - 1, (guiControls.month % 1) * 30.417);

    // initialize time and solar angle
    if (guiControls.dayNightCycle) {
      onUpdateTimeOfDaySlider();
      onUpdateMonthSlider();
    } else {
      updateSunlight('MANUAL_ANGLE'); // set angle from savefile
    }
  }

function ensureSoundingPanel()
{
  if (document.getElementById('soundingPanel'))
    return;

  const panelHtml = `
    <div id="soundingPanel" class="sounding-panel" style="display:none;">
      <div class="sounding-panel__header">
        <h3 class="sounding-panel__title">Sounding View</h3>
        <div class="sounding-panel__meta" id="soundingMeta">Live CAPE/CIN values for current probe</div>
      </div>
      <div class="sounding-graph-wrapper" id="soundingGraphWrapper">
        <canvas id="graphCanvas"></canvas>
      </div>
      <div class="sounding-tables">
        <div class="sounding-table">
          <table>
            <thead>
              <tr>
                <th>TEMP. (°C)</th>
                <th>DEW POINT (°C)</th>
                <th>SURFACE RH (%)</th>
                <th>CAPE (J/kg)</th>
                <th>MLCAPE (J/kg)</th>
                <th>MUCAPE (J/kg)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td id="tempVal">--</td>
                <td id="dewVal">--</td>
                <td id="rhVal">--</td>
                <td id="capeVal">--</td>
                <td id="mlCapeVal">--</td>
                <td id="sbCapeVal">--</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="sounding-table">
          <table>
            <thead>
              <tr>
                <th>CIN (J/kg)</th>
                <th>MLCIN (J/kg)</th>
                <th>0-3 km LR (°C/km)</th>
                <th>3-6 km LR (°C/km)</th>
                <th>0-6 LCL (m)</th>
                <th>PWAT (mm)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td id="cinVal">--</td>
                <td id="mlCinVal">--</td>
                <td id="lr03Val">--</td>
                <td id="lr36Val">--</td>
                <td id="lclVal">--</td>
                <td id="pwatVal">--</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  const container = document.createElement('div');
  container.innerHTML = panelHtml.trim();
  document.body.appendChild(container.firstChild);
}

var soundingGraph = {
    graphCanvas : null,
    ctx : null,
  init : function() {
      ensureSoundingPanel();
      this.graphCanvas = document.getElementById('graphCanvas');
      resizeSoundingCanvas();
      this.ctx = this.graphCanvas.getContext('2d');
      var style = this.graphCanvas.style;
      const panelEl = document.getElementById('soundingPanel');
      if (guiControls.showGraph) {
        style.display = 'block';
        if (panelEl)
          panelEl.style.display = 'flex';
      } else {
        style.display = 'none';
        if (panelEl)
          panelEl.style.display = 'none';
      }
    },
    draw : function(simXpos, simYpos) {
      // draw graph
      // mouse positions in sim coordinates

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
      // Read sounding columns; optionally smooth horizontally (Gaussian weights ±2 cols)
      var baseTextureValues = new Float32Array(4 * sim_res_y);
      var waterTextureValues = new Float32Array(4 * sim_res_y);
      const radius = guiControls.soundingSmoothing ? 2 : 0;
      const weights = [1, 4, 6, 4, 1];
      let weightSum = 0;

      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      for (let dx = -radius; dx <= radius; dx++) {
        const w = guiControls.soundingSmoothing ? weights[dx + radius] : 1;
        const col = clamp(simXpos + dx, 0, sim_res_x - 1);
        var tempBase = new Float32Array(4 * sim_res_y);
        gl.readPixels(col, 0, 1, sim_res_y, gl.RGBA, gl.FLOAT, tempBase);
        for (let i = 0; i < tempBase.length; i++) baseTextureValues[i] += tempBase[i] * w;
        weightSum += w;
      }

      gl.readBuffer(gl.COLOR_ATTACHMENT1);
      for (let dx = -radius; dx <= radius; dx++) {
        const w = guiControls.soundingSmoothing ? weights[dx + radius] : 1;
        const col = clamp(simXpos + dx, 0, sim_res_x - 1);
        var tempWater = new Float32Array(4 * sim_res_y);
        gl.readPixels(col, 0, 1, sim_res_y, gl.RGBA, gl.FLOAT, tempWater);
        for (let i = 0; i < tempWater.length; i++) waterTextureValues[i] += tempWater[i] * w;
      }
      if (weightSum > 0) {
        for (let i = 0; i < baseTextureValues.length; i++) baseTextureValues[i] /= weightSum;
        for (let i = 0; i < waterTextureValues.length; i++) waterTextureValues[i] /= weightSum;
      }

      gl.readBuffer(gl.COLOR_ATTACHMENT2);
      var wallTextureValues = new Int32Array(4 * sim_res_y);
      gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA_INTEGER, gl.INT, wallTextureValues); // read a vertical column of cells


      const graphBottem = this.graphCanvas.height - 40; // in pixels

      var c = this.ctx;

      c.clearRect(0, 0, graphCanvas.width, graphCanvas.height);
      c.fillStyle = '#00000055';
      c.fillRect(0, 0, graphCanvas.width, graphCanvas.height);

      drawIsotherms();
      drawHeightLabels();

      var reachedAir = false;
      var surfaceLevel;
      var surfaceTempC = null;
      var surfaceDewC = null;
      var surfaceRH = null;

      // Draw temperature line
      c.beginPath();
      for (var y = 0; y < sim_res_y; y++) {
        var potentialTemp = baseTextureValues[4 * y + 3];

        var temp = potentialTemp - ((y / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0 - 273.15;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.font = '15px Arial';
        c.fillStyle = 'white';

        if (wallTextureValues[4 * y + 1] != 0) { // if this is fluid cell
          if (!reachedAir) {
            // first non wall cell
            reachedAir = true;
            surfaceLevel = y;

            if (simYpos < surfaceLevel)
              simYpos = surfaceLevel;

            // surface diagnostics
            surfaceTempC = temp;
            surfaceDewC = KtoC(dewpoint(waterTextureValues[4 * y]));
            const tempK = baseTextureValues[4 * y + 3] - ((y / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
            surfaceRH = relativeHumd(tempK, waterTextureValues[4 * y]);
          }
          if (reachedAir && y == simYpos) {
            // c.fillText('' + Math.round(map_range(y-1, 0, sim_res_y, 0,
            // guiControls.simHeight)) + ' m', 5, scrYpos + 5);
            c.strokeStyle = '#FFF';
            c.lineWidth = 1.0;
            c.strokeRect(T_to_Xpos(temp, scrYpos), scrYpos, 10,
                         1); // vertical position indicator
            c.fillText('' + printTemp(temp), T_to_Xpos(temp, scrYpos) + 20, scrYpos + 5);
          }

          c.lineTo(T_to_Xpos(temp, scrYpos), scrYpos);  // temperature
        } else if (wallTextureValues[4 * y + 2] == 0) { // is surface layer
          if (wallTextureValues[4 * y + 0] != 2) {      // is land, urban or fire
            c.fillStyle = 'white';
            c.lineWidth = 1.0;

            let soilMoisture_mm = waterTextureValues[4 * y + 2];
            if (soilMoisture_mm > 0.) {
              c.fillText('💧' + printSoilMoisture(soilMoisture_mm), 65, scrYpos + 17);
            }

            let snowHeight_cm = waterTextureValues[4 * y + 3];
            if (snowHeight_cm > 0.) {
              c.fillText('❄' + printSnowHeight(snowHeight_cm), 160, scrYpos + 17); // display snow height
            }
          } else if (wallTextureValues[4 * y + 0] == 2) {                          // is water
            c.fillStyle = 'lightblue';
            c.lineWidth = 1.0;
            let waterTempC = KtoC(potentialTemp);                                                           // water temperature is stored as absolute, not dependant on height
            c.fillText('🌊 🌡' + printTemp(waterTempC), T_to_Xpos(waterTempC, scrYpos) - 33, scrYpos + 17); // display water surface temperature
          }
        }
      }
      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#FF0000';
      c.stroke();


      // Draw wind indicators
      c.beginPath();
      for (var y = surfaceLevel; y < sim_res_y; y++) {

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        var velocity = rawVelocityTo_ms(baseTextureValues[4 * y]); // horizontal wind velocity

        let Xpos = this.graphCanvas.width - 70;

        c.moveTo(Xpos, scrYpos);
        c.lineTo(Xpos + velocity * 2.5, scrYpos); // draw line segment
      }

      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#666666';
      c.stroke();


      // Draw Dew point line
      c.beginPath();
      for (var y = surfaceLevel; y < sim_res_y; y++) {

        if (wallTextureValues[4 * y + 1] != 0) { // fluid cell

          var dewPoint = KtoC(dewpoint(waterTextureValues[4 * y]));

          var temp = baseTextureValues[4 * y + 3] - ((y / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0 - 273.15;
          if (guiControls.realDewPoint) {
            dewPoint = Math.min(temp, dewPoint);
          }

          var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

          var velocity = rawVelocityTo_ms(Math.sqrt(Math.pow(baseTextureValues[4 * y], 2) + Math.pow(baseTextureValues[4 * y + 1], 2)));

          c.font = '15px Arial';
          c.fillStyle = 'white';

          // c.fillText('Surface: ' + y, 10, scrYpos);
          if (y == simYpos) {
            c.fillText('' + printAltitude(map_range(y - 1, 0, sim_res_y, 0, guiControls.simHeight)), 5, scrYpos + 5);

            c.fillText('' + printVelocity(velocity), this.graphCanvas.width - 113, scrYpos + 20);


            c.strokeStyle = '#FFF';
            c.lineWidth = 1.0;


            c.strokeRect(T_to_Xpos(dewPoint, scrYpos) - 10, scrYpos, 10,
                         1); // vertical position indicator
            c.fillText('' + printTemp(dewPoint), T_to_Xpos(dewPoint, scrYpos) - 70, scrYpos + 5);
          }

          c.lineTo(T_to_Xpos(dewPoint, scrYpos), scrYpos); // draw line segment
        }
      }

      c.lineWidth = 2.0; // 3
      c.strokeStyle = '#0055FF';
      c.stroke();

      // Draw rising parcel temperature line
      // Force parcel sampling to surface level of this column only (ignore cursor Y)
      var parcelY = surfaceLevel;
      var water = waterTextureValues[4 * parcelY];
      var potentialTemp = baseTextureValues[4 * parcelY + 3];
      var initialTemperature = potentialTemp - ((parcelY / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
      var initialCloudWater = waterTextureValues[4 * parcelY + 1];
      var prevTemp = initialTemperature;
      var prevCloudWater = initialCloudWater;

      var drylapsePerCell = ((-1.0 / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
      var cellHeightLocal = guiControls.simHeight / sim_res_y; // meters per vertical cell

      reachedSaturation = false;
      var cape = 0.0;          // Convective Available Potential Energy (J/kg)
      var cape03 = 0.0;        // CAPE limited to lowest 3 km (J/kg)
      var cin = 0.0;           // Convective Inhibition (J/kg)
      const g = 9.81;          // gravity (m/s^2)
      var positiveReached = false;


      c.beginPath();
      var scrYpos = map_range(parcelY, sim_res_y, 0, 0, graphBottem);
      c.moveTo(T_to_Xpos(KtoC(initialTemperature), scrYpos), scrYpos);
      for (var y = parcelY + 1; y < sim_res_y; y++) {
        var dT = drylapsePerCell;

        var cloudWater = Math.max(water - maxWater(prevTemp + dT),
                                  0.0); // how much cloud water there would be after that
        // temperature change

        var dWt = (cloudWater - prevCloudWater) * guiControls.evapHeat; // how much that water phase change would
        // change the temperature

        var actualTempChange = dT_saturated(dT, dWt);

        var T = prevTemp + actualTempChange;

        var scrYpos = map_range(y, sim_res_y, 0, 0, graphBottem);

        c.lineTo(T_to_Xpos(KtoC(T), scrYpos), scrYpos); // temperature

        prevTemp = T;
        prevCloudWater = Math.max(water - maxWater(prevTemp), 0.0);

        // accumulate CAPE/CIN using temperature buoyancy of parcel vs environment
        if (wallTextureValues[4 * y + 1] != 0) {
          var envTempK = baseTextureValues[4 * y + 3] - ((y / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
          var buoyancy = (T - envTempK) / envTempK;
          if (buoyancy > 0.0) {
            positiveReached = true;
            cape += buoyancy * g * cellHeightLocal;
            if (((y - surfaceLevel) * cellHeightLocal) <= 3000.0) {
              cape03 += buoyancy * g * cellHeightLocal;
            }
          } else if (!positiveReached) {
            cin += (-buoyancy) * g * cellHeightLocal;
          }
        }

        if (!reachedSaturation && prevCloudWater > 0.0) {
          reachedSaturation = true;
          c.strokeStyle = '#008800'; // dark green for dry lapse rate
          c.stroke();

          if (y - simYpos > 5) {
            c.beginPath();
            c.moveTo(T_to_Xpos(KtoC(T), scrYpos) - 0, scrYpos); // temperature
            c.lineTo(T_to_Xpos(KtoC(T), scrYpos) + 40,
                     scrYpos);                                  // Horizontal ceiling line
            c.strokeStyle = '#FFFFFF';
            c.stroke();
            c.fillText('' + printAltitude(Math.round(map_range(y - 1, 0, sim_res_y, 0, guiControls.simHeight))), T_to_Xpos(KtoC(T), scrYpos) + 50, scrYpos + 5);
          }

          c.beginPath();
          c.moveTo(T_to_Xpos(KtoC(T), scrYpos), scrYpos); // temperature
        }
      }

      c.lineWidth = 2.0;           // 3
      if (reachedSaturation) {
        c.strokeStyle = '#00FF00'; // light green for saturated lapse rate
      } else
        c.strokeStyle = '#008800';

      c.stroke();

      // --- Additional parcel diagnostics: CIN, MLCAPE, 0-3 km CAPE ---
      function integrateParcelEnergies(startY, parcelWater, parcelTempK)
      {
        var prevT = parcelTempK;
        var prevCloud = Math.max(parcelWater - maxWater(prevT), 0.0);
        var localCape = 0.0;
        var localCin = 0.0;
        var localCape03 = 0.0;
        var positiveReachedLocal = false;
        var negAfterPos = 0;
        const negLimit = 8; // require sustained negative buoyancy before terminating (reduces pixel-to-pixel jumps)

        for (var yy = startY + 1; yy < sim_res_y; yy++) {
          var dTlocal = drylapsePerCell;
          var cloudLocal = Math.max(parcelWater - maxWater(prevT + dTlocal), 0.0);
          var dWtLocal = (cloudLocal - prevCloud) * guiControls.evapHeat;
          var actualChange = dT_saturated(dTlocal, dWtLocal);
          var parcelTk = prevT + actualChange;

          prevT = parcelTk;
          prevCloud = Math.max(parcelWater - maxWater(prevT), 0.0);

          if (wallTextureValues[4 * yy + 1] != 0) {
            var envTk = baseTextureValues[4 * yy + 3] - ((yy / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
            var buoy = (parcelTk - envTk) / envTk;
            if (buoy > 0.0) {
              positiveReachedLocal = true;
              negAfterPos = 0; // reset negative counter once buoyancy is positive again
              localCape += buoy * g * cellHeightLocal;
              if (((yy - surfaceLevel) * cellHeightLocal) <= 3000.0) {
                localCape03 += buoy * g * cellHeightLocal;
              }
            } else if (!positiveReachedLocal) {
              localCin += (-buoy) * g * cellHeightLocal;
            } else {
              negAfterPos++;
              if (negAfterPos >= negLimit)
                break; // stop only after sustained negative buoyancy
            }
          }
        }
        return {cape: localCape, cin: localCin, cape03: localCape03};
      }

      // mixed-layer (0-1 km) parcel using potential temperature (theta) and vapor mixing ratio (qv)
      const mlDepth = 1000.0; // meters
      let mlSumTheta = 0.0;
      let mlSumQv = 0.0;
      let mlCount = 0;
      for (var yy = surfaceLevel; yy < sim_res_y && ((yy - surfaceLevel) * cellHeightLocal) <= mlDepth; yy++) {
        if (wallTextureValues[4 * yy + 1] == 0) continue; // skip non-fluid
        const theta = baseTextureValues[4 * yy + 3];          // stored as potential temperature (K)
        const qv = Math.max(waterTextureValues[4 * yy + 0], 0.0); // vapor only (channel 0)
        mlSumTheta += theta;
        mlSumQv += qv;
        mlCount++;
      }
      const mlTheta = mlCount > 0 ? mlSumTheta / mlCount : baseTextureValues[4 * surfaceLevel + 3];
      const mlQv = mlCount > 0 ? mlSumQv / mlCount : water;

      // convert theta back to actual temperature at surface-level height
      const mlInitTemp = potentialToRealT(mlTheta, surfaceLevel);
      const mlWater = mlQv;

      // calculate mixed-layer energies
      var mlEnergy = integrateParcelEnergies(surfaceLevel, mlWater, mlInitTemp);
      // soften the fallback only if ML is unrealistically small vs surface
      if (mlEnergy.cape < 0.1 * cape && cape > 50.0) {
        const blend = 0.5;
        var surfEnergy = integrateParcelEnergies(surfaceLevel, water, initialTemperature);
        mlEnergy.cape = mlEnergy.cape * (1 - blend) + surfEnergy.cape * blend;
        mlEnergy.cin = mlEnergy.cin * (1 - blend) + surfEnergy.cin * blend;
      }

      // precipitable water (PWAT) integrated hydrostatically using Td-derived qv
      function computePWATmm(surfaceLevel, topMeters = 12000.0)
      {
        const Rd = 287.05;   // J/(kg*K)
        const rhoW = 1000.0; // kg/m^3
        let p_hPa = 1013.25; // starting surface pressure (hPa)
        let pw_kg_m2 = 0.0;
        const maxCells = Math.min(sim_res_y - 1, surfaceLevel + Math.floor(topMeters / cellHeightLocal));

        const satVaporPressure = (Tc) => 6.112 * Math.exp((17.67 * Tc) / (Tc + 243.5)); // hPa
        const mixingRatioFromTd = (TdC, p_hPa_local) => {
          const e = satVaporPressure(TdC);
          return 0.622 * e / Math.max(p_hPa_local - e, 1e-3); // kg/kg
        };

        for (let yy = surfaceLevel; yy <= maxCells; yy++) {
          if (wallTextureValues[4 * yy + 1] == 0) continue;
          const envTk = baseTextureValues[4 * yy + 3] - ((yy / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
          const TdK = dewpoint(waterTextureValues[4 * yy + 0]);
          const qv = mixingRatioFromTd(TdK - 273.15, p_hPa); // kg/kg from Td
          const rho = (p_hPa * 100) / (Rd * envTk);
          const dz = cellHeightLocal;
          pw_kg_m2 += rho * qv * dz;
          p_hPa *= Math.exp((-g * dz) / (Rd * envTk));
        }
        return (pw_kg_m2 / rhoW) * 1000.0; // mm
      }

      const pwatMm = computePWATmm(surfaceLevel, guiControls.simHeight);

      // --- Most-unstable CAPE (MU) in lowest 3 km ---
      var muEnergy = {cape: 0.0, cin: 0.0};
      var maxCape = -1.0;
      const muTopMeters = 3000.0;
      const maxMuY = Math.min(sim_res_y - 1, Math.floor(surfaceLevel + muTopMeters / cellHeightLocal));
      for (var yy = surfaceLevel; yy <= maxMuY; yy++) {
        if (wallTextureValues[4 * yy + 1] == 0) continue;
        const thetaMu = baseTextureValues[4 * yy + 3];
        const qvMu = Math.max(waterTextureValues[4 * yy + 0], 0.0);
        const tempMu = potentialToRealT(thetaMu, yy);
        const energy = integrateParcelEnergies(yy, qvMu, tempMu);
        if (energy.cape > maxCape) {
          maxCape = energy.cape;
          muEnergy = energy;
        }
      }

      function envTempAtHeight(meters)
      {
        const yIdx = Math.min(sim_res_y - 1, Math.max(surfaceLevel, Math.round(surfaceLevel + meters / cellHeightLocal)));
        const envTempK = baseTextureValues[4 * yIdx + 3] - ((yIdx / sim_res_y) * guiControls.simHeight * guiControls.dryLapseRate) / 1000.0;
        return KtoC(envTempK);
      }

      let lr03 = null, lr36 = null;
      if (guiControls.simHeight >= 3000) {
        const t0 = envTempAtHeight(0);
        const t3 = envTempAtHeight(3000);
        lr03 = (t0 - t3) / 3.0;
      }
      if (guiControls.simHeight >= 6000) {
        const t3 = envTempAtHeight(3000);
        const t6 = envTempAtHeight(6000);
        lr36 = (t3 - t6) / 3.0;
      }

      let lclMeters = null;
      if (surfaceTempC != null && surfaceDewC != null) {
        lclMeters = Math.max(0, 125.0 * (surfaceTempC - surfaceDewC));
      }

      soundingDiagnostics.cape = cape;
      soundingDiagnostics.sbCape = muEnergy.cape; // now MU CAPE
      soundingDiagnostics.cape03 = cape03;
      soundingDiagnostics.cin = cin;
      soundingDiagnostics.mlCape = mlEnergy.cape;
      soundingDiagnostics.mlCin = mlEnergy.cin;
      soundingDiagnostics.pwat = pwatMm;
      soundingDiagnostics.tempC = surfaceTempC;
      soundingDiagnostics.dewC = surfaceDewC;
      soundingDiagnostics.rh = surfaceRH;
      soundingDiagnostics.lr03 = lr03;
      soundingDiagnostics.lr36 = lr36;
      soundingDiagnostics.lcl = lclMeters;
      updateSoundingDiagnosticsUI();


      c.fillText('' + printDistance(map_range(simXpos, 0, sim_res_y, 0, guiControls.simHeight)), this.graphCanvas.width - 70, 20);


      function T_to_Xpos(T, y)
      {
        // temperature to horizontal position
        var normX = T * 0.0115 + 1.18 - (y / graphBottem) * 0.8; // -30 to 50
        return normX * this.graphCanvas.width;                   // T * 7.5 + 780.0 - 600.0 * (y / graphBottem);
      }

      function drawIsotherms()
      {
        c.strokeStyle = '#964B00';
        c.beginPath();
        c.fillStyle = 'white';

        for (var T = -80.0; T <= 50.0; T += 10.0) {
          c.moveTo(T_to_Xpos(T, graphBottem), graphBottem);
          c.lineTo(T_to_Xpos(T, 0), 0);

          if (T >= -30.0)
            c.fillText(printTemp(Math.round(T)), T_to_Xpos(T, graphBottem) - 20, this.graphCanvas.height - 5);
        }
        c.lineWidth = 1.0;
        c.stroke();
        // draw 0 degree line thicker
        c.beginPath();
        c.moveTo(T_to_Xpos(0, graphBottem), graphBottem);
        c.lineTo(T_to_Xpos(0, 0), 0);
        c.lineWidth = 3.0;
        c.stroke();
      }

      function drawHeightLabels()
      {
        c.font = '14px Arial';
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.strokeStyle = 'rgba(255,255,255,0.25)';
        c.lineWidth = 1.0;

        const stepM = 1000; // 1 km
        for (let m = 0; m <= guiControls.simHeight; m += stepM) {
          const yIndex = (m / guiControls.simHeight) * sim_res_y;
          const scrYpos = map_range(yIndex, sim_res_y, 0, 0, graphBottem);
          c.beginPath();
          c.moveTo(8, scrYpos);
          c.lineTo(24, scrYpos);
          c.stroke();
          c.fillText((m / 1000).toFixed(0) + ' km', 30, scrYpos + 5);
        }
      }
    }, // end of draw()
  };
  soundingGraph.init();
  updateSoundingDiagnosticsUI();

  await loadingBar.set(6, 'Setting up eventlisteners');
  // END OF GRAPH


  sim_aspect = sim_res_x / sim_res_y;

  var canvas_aspect;

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  canvas_aspect = canvas.width / canvas.height;

  var mouseXinSim, mouseYinSim;
  var prevMouseXinSim, prevMouseYinSim;
  var soundingProbeActive = false;
  var soundingProbeX = 0.0;
  var soundingProbeY = 0.0;
  var soundingProbeNeedsRedraw = false;

  window.addEventListener('resize', function() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas_aspect = canvas.width / canvas.height;

    resizeSoundingCanvas();

    // Render output framebuffers need to match canvas resolution
    createBloomFBOs(); // recreate bloom framebuffers
    createHdrFBO();    // recreate hdr framebuffer
  });

  function logSample()
  {
    // mouse position in sim coordinates
    var simXpos = Math.floor(Math.abs(mod(mouseXinSim * sim_res_x, sim_res_x)));
    var simYpos = Math.min(Math.max(Math.floor(mouseYinSim * sim_res_y), 0), sim_res_y - 1);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);                                         // basetexture
    var baseTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, baseTextureValues); // read single cell at mouse position

    // gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
    var waterTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, waterTextureValues);

    gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture
    var wallTextureValues = new Int8Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

    gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
    gl.readBuffer(gl.COLOR_ATTACHMENT0); // lighttexture_1
    var lightTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, lightTextureValues);

    gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    var precipitationFeedbackTextureValues = new Float32Array(4);
    gl.readPixels(simXpos, simYpos, 1, 1, gl.RGBA, gl.FLOAT, precipitationFeedbackTextureValues);

    console.log(' ');
    console.log(' ');
    console.log('Sample at:      X: ' + simXpos + ' (' + simXpos * cellHeight / 1000 + ' km)', '  Y: ' + simYpos + ' (' + simYpos * cellHeight / 1000 + ' km)');
    console.log('BASE-----------------------------------------');
    console.log('[0] X-vel:', baseTextureValues[0]);
    console.log('[1] Y-vel:', baseTextureValues[1]);
    console.log('[2] Press:', baseTextureValues[2]);
    console.log('[3] Temp :', baseTextureValues[3].toFixed(2) + ' K   ', KtoC(baseTextureValues[3]).toFixed(2) + ' °C   ', KtoC(potentialToRealT(baseTextureValues[3], simYpos)).toFixed(2) + ' °C');

    console.log('WATER-----------------------------------------');
    console.log('[0] Water:     ', waterTextureValues[0]);
    console.log('[1] Cloudwater:', waterTextureValues[1]);
    console.log('[2] Soil Moisture / Precipitation:', waterTextureValues[2]);
    console.log('[3] Smoke/snow:', waterTextureValues[3]);

    console.log('WALL-----------------------------------------');
    console.log('[0] walltype :         ', wallTextureValues[0]);
    console.log('[1] distance:          ', wallTextureValues[1]);
    console.log('[2] Vertical distance :', wallTextureValues[2]);
    console.log('[3] Vegetation:        ', wallTextureValues[3]);

    console.log('LIGHT-----------------------------------------');
    console.log('[0] Sunlight:  ', lightTextureValues[0].toFixed(2), 'W/m²');
    console.log('[1] IR Heating:', (lightTextureValues[1] / 0.000002).toFixed(2), 'W/m²  (includes sunlight absorbed by smoke)'); // net effect of ir
    console.log('[2] IR down:   ', lightTextureValues[2].toFixed(2), 'W/m²', KtoC(IR_temp(lightTextureValues[2])).toFixed(2) + ' °C');
    console.log('[3] IR up:     ', lightTextureValues[3].toFixed(2), 'W/m²', KtoC(IR_temp(lightTextureValues[3])).toFixed(2) + ' °C');
    console.log('Net IR up:     ', (lightTextureValues[3] - lightTextureValues[2]).toFixed(2), 'W/m²');

    console.log('PRECIPITATION FEEDBACK-------------------------');
    console.log('[0] Mass:  ', precipitationFeedbackTextureValues[0]);
    console.log('[1] Heat:', precipitationFeedbackTextureValues[1]); // net effect of ir
    console.log('[2] Vapor:   ', precipitationFeedbackTextureValues[2]);
    console.log('[3] Snow deposition:     ', precipitationFeedbackTextureValues[3]);
  }


  var middleMousePressed = false;
  var leftMousePressed = false;
  var prevMouseX = 0;
  var prevMouseY = 0;
  var mouseX = 0;
  var mouseY = 0;
  var ctrlPressed = false;
  var rightCtrlPressed = false;
  var bPressed = false;
  var leftPressed = false;
  var downPressed = false;
  var rightPressed = false;
  var upPressed = false;
  var plusPressed = false;
  var minusPressed = false;
  var zPressed = false;


  // EVENT LISTENERS

  addEventListener('beforeunload', (event) => {
    if (new Date() - lastSaveTime > 120000) { // more than 120 seconds
      event.preventDefault();
      // custom message not showing for some reason
      confirm('Are you sure you want to quit without saving?');
      event.returnValue = 0; // Google Chrome requires returnValue to be set.
    }
  });

  window.addEventListener('wheel', function(event) {
    var delta = 0.1;
    if (event.deltaY > 0)
      delta *= -1;
    if (typeof lastWheel == 'undefined')
      lastWheel = 0; // init static variable
    const now = new Date().getTime();

    if (bPressed) {
      guiControls.brushSize *= 1.0 + delta * 1.0;
      if (guiControls.brushSize < 1)
        guiControls.brushSize = 1;
      else if (guiControls.brushSize > 200)
        guiControls.brushSize = 200;
    } else {
      if (now - lastWheel > 20) {
        // change zoom
        lastWheel = now;

        cam.zoomAtMousePos(delta);
      }
    }
  });

  window.addEventListener('mousemove', function(event) {
    var rect = canvas.getBoundingClientRect();
    mouseX = event.clientX - rect.left;

    if (!(guiControls.tool == 'TOOL_WALL_SEA' && leftMousePressed)) // lock y pos while drawing lake / sea
      mouseY = event.clientY - rect.top;

    if (middleMousePressed) {
      cam.changeViewXpos(((mouseX - prevMouseX) / cam.curZoom / canvas.width) * 2.0);
      cam.changeViewYpos(-((mouseY - prevMouseY) / cam.curZoom / canvas.width) * 2.0);
      prevMouseX = mouseX;
      prevMouseY = mouseY;
    }
  });

  canvas.addEventListener('mousedown', function(e) { mouseDownEvent(e); });
  const graphCanvasEl = document.getElementById('graphCanvas');
  if (graphCanvasEl)
    graphCanvasEl.addEventListener('mousedown', function(e) { mouseDownEvent(e); });


  function findSimYposAboveSurfaceAtMouseX() // find the lowest location that is not underground
  {
    let simXpos = clamp(Math.floor(mouseXinSim * sim_res_x), 0, sim_res_x - 1);
    let simYpos = clamp(Math.floor(mouseYinSim * sim_res_y), 0, sim_res_y - 1);
    // console.log(simYpos)

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT2); // walltexture

    var wallTextureValues = new Int8Array(4 * sim_res_y);
    gl.readPixels(simXpos, 0, 1, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues); // read a vertical culumn of cells

    if (wallTextureValues[simYpos * 4 + 1] > 0) {                                         // place at mouse position of cell is not wall
      return simYpos;
    } else {
      for (let curSimYpos = simYpos; curSimYpos < sim_res_y; curSimYpos++) { // find first cell above that is not wall
        if (wallTextureValues[curSimYpos * 4 + 1] > 0) {                     // surface reached
          return curSimYpos;
        }
      }
    }
  }

  function mouseDownEvent(e)
  {
    // event.preventDefault(); // caused problems with dat.gui
    // console.log('mousedown');
    if (e.button == 0) { // left
      leftMousePressed = true;
      if (SETUP_MODE) {
        startSimulation();
      } else if (guiControls.tool == 'TOOL_STATION') {
        let simXpos = Math.floor(mouseXinSim * sim_res_x);
        let simYpos = findSimYposAboveSurfaceAtMouseX();

        if (simXpos >= 0 && simXpos < sim_res_x)
          weatherStations.push(new Weatherstation(simXpos, simYpos)); // add weather station
      } else if (guiControls.tool == 'TOOL_RADAR') {
        let simXpos = Math.floor(mouseXinSim * sim_res_x);
        let simYpos = findSimYposAboveSurfaceAtMouseX();

        if (simXpos >= 0 && simXpos < sim_res_x) {
          radarTowers.push(new RadarTower(simXpos, simYpos));
          if (radarDrawerOpen)
            renderRadarStationList();
        }
        radarNeedsMeasure = true;
      }
    } else if (e.button == 1) {
      // middle mouse button
      middleMousePressed = true;
      prevMouseX = mouseX;
      prevMouseY = mouseY;
    }
  }


  window.addEventListener('mouseup', function(event) {
    if (event.button == 0) {
      leftMousePressed = false;
    } else if (event.button == 1) {
      // middle mouse button
      middleMousePressed = false;
    }
  });


  var wasTwoFingerTouchBefore = false;

  var previousTouches;


  canvas.addEventListener('touchstart', function(event) { event.preventDefault(); }, {passive : false});

  canvas.addEventListener('touchend', function(event) {
    event.preventDefault();
    if (event.touches.length == 0) { // all fingers released
      leftMousePressed = false;
      //   }else if(event.touches.length == 1){
      wasTwoFingerTouchBefore = false;
      previousTouches = null;

      if (SETUP_MODE) {
        startSimulation();
      }
    }
  }, {passive : false});

  canvas.addEventListener('touchmove', function(event) {
    event.preventDefault();

    if (event.touches.length == 1) { // single finger

      // console.log(event.touches[0]);
      if (!wasTwoFingerTouchBefore) {
        leftMousePressed = true; // treat just like holding left mouse button
        mouseX = event.touches[0].clientX;
        mouseY = event.touches[0].clientY;
      }
    } else {
      leftMousePressed = false;

      if (event.touches.length == 2 && previousTouches && previousTouches.length == 2) // 2 finger zoom
      {
        mouseX = (event.touches[0].clientX + event.touches[1].clientX) / 2.0;          // position inbetween two fingers
        mouseY = (event.touches[0].clientY + event.touches[1].clientY) / 2.0;

        let prevXsep = previousTouches[0].clientX - previousTouches[1].clientX;
        let prevYsep = previousTouches[0].clientY - previousTouches[1].clientY;
        let prevSep = Math.sqrt(prevXsep * prevXsep + prevYsep * prevYsep);

        let curXsep = event.touches[0].clientX - event.touches[1].clientX;
        let curYsep = event.touches[0].clientY - event.touches[1].clientY;
        let curSep = Math.sqrt(curXsep * curXsep + curYsep * curYsep);

        cam.zoomAtMousePos((curSep / prevSep) - 1.0);

        if (wasTwoFingerTouchBefore) {
          cam.changeViewYpos(((mouseX - prevMouseX) / cam.curZoom / canvas.width) * 2.0);
          cam.changeViewYpos(((mouseY - prevMouseY) / cam.curZoom / canvas.width) * 2.0);
        }
        wasTwoFingerTouchBefore = true;
        prevMouseX = mouseX;
        prevMouseY = mouseY;
      }
    }

    previousTouches = event.touches;
  }, {passive : false});


  var lastBpressTime;

  function handlePause()
  {
    if (guiControls.paused) {
      soundSystem.mute();
    }
  }

  function isTypingInFormField(event)
  {
    const target = event.target;
    if (!target)
      return false;
    if (target.isContentEditable)
      return true;
    const tag = (target.tagName || '').toUpperCase();
    return tag == 'INPUT' || tag == 'TEXTAREA' || tag == 'SELECT';
  }

  document.addEventListener('keydown', (event) => {
    if (isTypingInFormField(event))
      return;

    if (event.code == 'ControlLeft') {
      ctrlPressed = true;
    }
    if (event.code == 'ControlRight') {
      // ctrl or cmd on mac
      rightCtrlPressed = true;
    } else if (event.code == 'Space') {
      // space bar
      guiControls.paused = !guiControls.paused;
      handlePause();
    } else if (event.code == 'KeyD') {
      // D
      guiControls.showDrops = !guiControls.showDrops;
    } else if (event.code == 'KeyB') {
      // B: scrolling to change brush size
      bPressed = true;
      if (new Date().getTime() - lastBpressTime < 300 && guiControls.tool != 'TOOL_NONE')
        // double pressed B
        guiControls.wholeWidth = !guiControls.wholeWidth; // toggle whole width brush

      // lastBpressTime = new Date().getTime();
    } else if (event.code == 'KeyF') {
      airplane.toggleCamFollow();
    } else if (event.code == 'KeyV') {
      // V: reset view to full simulation area
      cam.center();
    } else if (event.code == 'KeyG') {
      // G
      guiControls.showGraph = !guiControls.showGraph;
      hideOrShowGraph();
    } else if (event.code == 'Tab') {
      // TAB
      event.preventDefault();
      displayVectorField = !displayVectorField;
    } else if (event.code == 'KeyS') {
      // S: log sample at mouse location
      logSample();
    } else if (event.code == 'KeyZ') {
      zPressed = true;
    } else if (event.code == 'KeyX') {
      // Sample droplets around mouse location
      logDropletsAndToggleFollow();
    } else if (event.code == 'KeyA') {
      if (airplaneMode) {
        airplane.changeDirection();
      } else if (!SETUP_MODE)
        airplane.enableAirplaneMode(event.getModifierState('CapsLock'));
    } else if (event.code == 'CapsLock') {
      if (airplaneMode)
        airplane.setAutopilot(event.getModifierState('CapsLock'));
    } else if (event.code == 'ShiftLeft') {
      airplane.toggleGear();
    } else if (event.key == 1) { // number keys for displaymodes
      guiControls.displayMode = 'DISP_TEMPERATURE';
    } else if (event.key == 2) {
      guiControls.displayMode = 'DISP_WATER';
    } else if (event.key == 3) {
      guiControls.displayMode = 'DISP_REAL';
    } else if (event.key == 4) {
      guiControls.displayMode = 'DISP_HORIVEL';
    } else if (event.key == 5) {
      guiControls.displayMode = 'DISP_VERTVEL';
    } else if (event.key == 6) {
      guiControls.displayMode = 'DISP_IRHEATING';
    } else if (event.key == 7) {
      guiControls.displayMode = 'DISP_IRDOWNTEMP';
    } else if (event.key == 8) {
      guiControls.displayMode = 'DISP_IRUPTEMP';
    } else if (event.key == 9) {
      guiControls.displayMode = 'DISP_PRECIPFEEDBACK_MASS';
    } else if (event.key == 0) {
      const selectedRadarProduct = isImplementedRadarProduct(guiControls.selectedRadarProduct) ? guiControls.selectedRadarProduct : guiControls.lastLiveRadarProduct;
      activateRadarProduct(selectedRadarProduct, {
        preserveSelectedProduct : !isImplementedRadarProduct(guiControls.selectedRadarProduct),
      });
    } else if (event.code == 'KeyK') {
      guiControls.displayMode = 'DISP_AIRQUALITY';
    } else if (event.key == 'ArrowLeft') {
      leftPressed = true; // <
    } else if (event.key == 'ArrowUp') {
      if (!upPressed)
        airplane.onUpPressed();
      upPressed = true;    // ^
    } else if (event.key == 'ArrowRight') {
      rightPressed = true; // >
    } else if (event.key == 'ArrowDown') {
      if (!downPressed)
        airplane.onDownPressed();
      downPressed = true; // v
    } else if (event.key == '=' || event.key == '+') {
      event.preventDefault();
      plusPressed = true; // +
    } else if (event.key == '-') {
      event.preventDefault();
      minusPressed = true; // -
    } else if (event.code == 'Escape') {
      if (guiControls.tool == 'TOOL_NONE' && airplaneMode && confirm('Exit airplane mode?')) {
        airplane.disableAirplaneMode();
      } else {
        guiControls.tool = 'TOOL_NONE';
        guiControls.wholeWidth = false; // flashlight can't be whole width
      }
    } else if (event.code == 'KeyQ') {
      guiControls.tool = 'TOOL_TEMPERATURE';
    } else if (event.code == 'KeyW') {
      guiControls.tool = 'TOOL_WATER';
    } else if (event.code == 'KeyE') {
      guiControls.tool = 'TOOL_WALL_LAND';
    } else if (event.code == 'KeyR') {
      guiControls.tool = 'TOOL_WALL_SEA';
    } else if (event.code == 'KeyT') {
      guiControls.tool = 'TOOL_WALL_FIRE';
    } else if (event.code == 'KeyY') {
      guiControls.tool = 'TOOL_SMOKE';
    } else if (event.code == 'KeyU') {
      guiControls.tool = 'TOOL_WALL_MOIST';
    } else if (event.code == 'KeyI') {
      guiControls.tool = 'TOOL_VEGETATION';
    } else if (event.code == 'KeyO') {
      guiControls.tool = 'TOOL_WALL_SNOW';
    } else if (event.code == 'KeyP') {
      guiControls.tool = 'TOOL_WIND';
    } else if (event.code == 'BracketLeft') {
      guiControls.tool = 'TOOL_WALL_URBAN';
    } else if (event.code == 'BracketRight') {
      guiControls.tool = 'TOOL_WALL_RUNWAY';
    } else if (event.code == 'Backslash') {
      guiControls.tool = 'TOOL_WALL_INDUSTRIAL';
    } else if (event.code == 'KeyN') {
      if (displayWeatherStations) {
        displayWeatherStations = false;
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].setHidden(true);
        }
        for (i = 0; i < radarTowers.length; i++) {
          radarTowers[i].setHidden(true);
        }
      } else {
        displayWeatherStations = true;
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].setHidden(false);
        }
        for (i = 0; i < radarTowers.length; i++) {
          radarTowers[i].setHidden(false);
        }
        radarNeedsMeasure = true;
      }

      if (guiControls.tool == 'TOOL_STATION') // prevent placing weather stations when not visible
        guiControls.tool = 'TOOL_NONE';
    } else if (event.code == 'KeyM') {
      guiControls.tool = 'TOOL_STATION';
      displayWeatherStations = true;
      for (i = 0; i < weatherStations.length; i++) {
        weatherStations[i].setHidden(false);
      }
      for (i = 0; i < radarTowers.length; i++) {
        radarTowers[i].setHidden(false);
      }
    } else if (event.code == 'Period') {
      airplane.setBrakes(true);
    } else if (event.code == 'Slash') {
      airplane.toggleEngine();
    } else if (event.code == 'KeyL') {
      if (new Date() - lastSaveTime > 120000) // more than 120 seconds)
        if (!confirm('Are you sure you want to reload without saving?'))
          return;                             // abort

      // reload simulation
      if (initialRainDrops) { // if loaded from save file
        setupPrecipitationBuffers();
        setupTextures();
        gl.bindVertexArray(fluidVao);
        // iterNum = 0;
        // frameNum = 0;
      }
    } else if (event.code == 'PageUp') {
      adjIterPerFrame(1);
      guiControls.auto_IterPerFrame = false;
    } else if (event.code == 'PageDown') {
      adjIterPerFrame(-1);
      guiControls.auto_IterPerFrame = false;
    } else if (event.code == 'End') {
      guiControls.auto_IterPerFrame = true;
    } else if (event.code == 'Home') {
      guiControls.auto_IterPerFrame = false;
      guiControls.IterPerFrame = 1;
    }
  });

  document.addEventListener('keyup', (event) => {
    if (event.code == 'ControlLeft') {
      ctrlPressed = false;
    }
    if (event.code == 'ControlRight') {
      // ctrl or cmd on mac
      rightCtrlPressed = false;
    } else if (event.code == 'KeyB') {
      bPressed = false;
      lastBpressTime = new Date().getTime();
    } else if (event.code == 'KeyZ') {
      zPressed = false;
    } else if (event.key == 'ArrowLeft') {
      leftPressed = false;  // <
    } else if (event.key == 'ArrowUp') {
      upPressed = false;    // ^
    } else if (event.key == 'ArrowRight') {
      rightPressed = false; // >
    } else if (event.key == 'ArrowDown') {
      downPressed = false;  // v
    } else if (event.key == '=' || event.key == '+') {
      plusPressed = false;  // +
    } else if (event.key == '-') {
      minusPressed = false; // -
    } else if (event.code == 'Period') {
      airplane.setBrakes(false);
    }
  });

  await loadingBar.set(9, 'Setting up WebGL');

  gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('EXT_float_blend');
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('OES_texture_half_float_linear');

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.DEPTH_TEST);
  // gl.disable(gl.BLEND);
  // gl.enable(gl.BLEND)
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // load shaders
  var commonSource = await loadSourceFile('shaders/common.glsl');
  var commonDisplaySource = await loadSourceFile('shaders/commonDisplay.glsl');

  const simVertexShader = await loadShader('simShader.vert');
  const dispVertexShader = await loadShader('dispShader.vert');
  const realDispVertexShader = await loadShader('realDispShader.vert');
  const precipDisplayVertexShader = await loadShader('precipDisplayShader.vert');
  const precipPhaseAccumVertexShader = await loadShader('precipPhaseAccum.vert');
  const postProcessingVertexShader = await loadShader('postProcessingShader.vert');

  const pressureShader = await loadShader('pressureShader.frag');
  const velocityShader = await loadShader('velocityShader.frag');
  const advectionShader = await loadShader('advectionShader.frag');
  const curlShader = await loadShader('curlShader.frag');
  const vorticityShader = await loadShader('vorticityShader.frag');
  const boundaryShader = await loadShader('boundaryShader.frag');

  const lightingShader = await loadShader('lightingShader.frag');

  const lightningLocationShader = await loadShader('lightningLocationShader.frag');
  const radarFieldUpdateShader = await loadShader('radarFieldUpdateShader.frag');

  const setupShader = await loadShader('setupShader.frag');

  const temperatureDisplayShader = await loadShader('temperatureDisplayShader.frag');
  const airQualityDisplayShader = await loadShader('airQualityDisplayShader.frag');
  const precipDisplayShader = await loadShader('precipDisplayShader.frag');
  const precipPhaseAccumShader = await loadShader('precipPhaseAccum.frag');
  const rhohvFieldShader = await loadShader('rhohvFieldShader.frag');
  const rhohvDisplayShader = await loadShader('rhohvDisplayShader.frag');
  const zdrFieldShader = await loadShader('zdrFieldShader.frag');
  const zdrDisplayShader = await loadShader('zdrDisplayShader.frag');
  const universalDisplayShader = await loadShader('universalDisplayShader.frag');
  const radarPolarDisplayShader = await loadShader('radarPolarDisplayShader.frag');
  const skyBackgroundDisplayShader = await loadShader('skyBackgroundDisplayShader.frag');
  const realisticDisplayShader = await loadShader('realisticDisplayShader.frag');
  const IRtempDisplayShader = await loadShader('IRtempDisplayShader.frag');

  const postProcessingShader = await loadShader('postProcessingShader.frag');
  const isolateBrightPartsShader = await loadShader('isolateBrightPartsShader.frag');
  const bloomBlurShader = await loadShader('bloomBlurShader.frag');


  // create programs
  const pressureProgram = createProgram(simVertexShader, pressureShader);
  const velocityProgram = createProgram(simVertexShader, velocityShader);
  const advectionProgram = createProgram(simVertexShader, advectionShader);
  const curlProgram = createProgram(simVertexShader, curlShader);
  const vorticityProgram = createProgram(simVertexShader, vorticityShader);
  boundaryProgram = createProgram(simVertexShader, boundaryShader);

  lightingProgram = createProgram(simVertexShader, lightingShader);

  const lightningLocationProgram = createProgram(simVertexShader, lightningLocationShader);
  const radarFieldUpdateProgram = createProgram(simVertexShader, radarFieldUpdateShader);

  const setupProgram = createProgram(simVertexShader, setupShader);

  const temperatureDisplayProgram = createProgram(dispVertexShader, temperatureDisplayShader);
  const airQualityDisplayProgram = createProgram(dispVertexShader, airQualityDisplayShader);
  const precipDisplayProgram = createProgram(precipDisplayVertexShader, precipDisplayShader);
  const precipPhaseAccumProgram = createProgram(precipPhaseAccumVertexShader, precipPhaseAccumShader);
  const rhohvFieldProgram = createProgram(simVertexShader, rhohvFieldShader);
  const rhohvDisplayProgram = createProgram(dispVertexShader, rhohvDisplayShader);
  const zdrFieldProgram = createProgram(simVertexShader, zdrFieldShader);
  const zdrDisplayProgram = createProgram(dispVertexShader, zdrDisplayShader);
  const universalDisplayProgram = createProgram(dispVertexShader, universalDisplayShader);
  const radarPolarDisplayProgram = createProgram(dispVertexShader, radarPolarDisplayShader);
  skyBackgroundDisplayProgram = createProgram(realDispVertexShader, skyBackgroundDisplayShader);
  realisticDisplayProgram = createProgram(realDispVertexShader, realisticDisplayShader);
  const IRtempDisplayProgram = createProgram(dispVertexShader, IRtempDisplayShader);

  const postProcessingProgram = createProgram(postProcessingVertexShader, postProcessingShader);
  const isolateBrightPartsProgram = createProgram(postProcessingVertexShader, isolateBrightPartsShader);
  const bloomBlurProgram = createProgram(postProcessingVertexShader, bloomBlurShader);
  // const lightBlurProgram = createProgram(postProcessingVertexShader, bloomBlurShader);


  await loadingBar.set(80, 'Setting up textures');

  // // quad that fills the screen, so fragment shader is run for every pixel //
  // X, Y,  U, V  (x4)

  // Don't ask me why, but the * 1.0000001 is nesesary to get exactly round half
  // ( x.5 ) fragcoordinates in the fragmentshaders I figured this out
  // experimentally. It took me days! Without it the linear interpolation would
  // get fucked up because of the tiny offsets
  const fluidQuadVertices = [
    // X, Y,  U, V
    1.0,
    -1.0,
    sim_res_x * 1.0000001,
    0.0,
    -1.0,
    -1.0,
    0.0,
    0.0,
    1.0,
    1.0,
    sim_res_x * 1.0000001,
    sim_res_y * 1.0000001,
    -1.0,
    1.0,
    0.0,
    sim_res_y * 1.0000001,
  ];

  var fluidVao = gl.createVertexArray(); // vertex array object to store
  // bufferData and vertexAttribPointer
  gl.bindVertexArray(fluidVao);
  var fluidVertexBufferObject = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, fluidVertexBufferObject);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(fluidQuadVertices), gl.STATIC_DRAW);
  var positionAttribLocation = gl.getAttribLocation(pressureProgram,
                                                    'vertPosition'); // 0 these positions are the same for every program,
  // since they all use the same vertex shader
  var texCoordAttribLocation = gl.getAttribLocation(pressureProgram, 'vertTexCoord'); // 1
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(texCoordAttribLocation);
  gl.vertexAttribPointer(
    positionAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    0                                   // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
    texCoordAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
    // single vertex to this attribute
  );

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);


  const postProcessingQuadVertices = [
    1.0,  // X
    -1.0, // Y
    1.0,  // U
    0.0,  // V
    -1.0,
    -1.0,
    0.0,
    0.0,
    1.0,
    1.0,
    1.0,
    1.0,
    -1.0,
    1.0,
    0.0,
    1.0,
  ];

  var postProcessingVao = gl.createVertexArray(); // vertex array object to store
  // bufferData and vertexAttribPointer
  gl.bindVertexArray(postProcessingVao);
  var postProcessingVertexBufferObject = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, postProcessingVertexBufferObject);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(postProcessingQuadVertices), gl.STATIC_DRAW);
  positionAttribLocation = gl.getAttribLocation(postProcessingProgram,
                                                'vertPosition'); // 0 these positions are the same for every program,
  // since they all use the same vertex shader
  texCoordAttribLocation = gl.getAttribLocation(postProcessingProgram, 'vertTexCoord'); // 1
  gl.enableVertexAttribArray(positionAttribLocation);
  gl.enableVertexAttribArray(texCoordAttribLocation);
  gl.vertexAttribPointer(
    positionAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    0                                   // Offset from the beginning of a single vertex to this attribute
  );
  gl.vertexAttribPointer(
    texCoordAttribLocation,             // Attribute location
    2,                                  // Number of elements per attribute
    gl.FLOAT,                           // Type of elements
    gl.FALSE,
    4 * Float32Array.BYTES_PER_ELEMENT, // Size of an individual vertex
    2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
    // single vertex to this attribute
  );

  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);


  // Precipitation setup

  const precipitationVertexShader = await loadShader('precipitationShader.vert');
  const precipitationShader = await loadShader('precipitationShader.frag');
  const precipitationProgram = createProgram(precipitationVertexShader, precipitationShader, [ 'position_out', 'mass_out', 'density_out', 'size_out', 'compactness_out' ]);

  gl.useProgram(precipitationProgram);

  const dropPositionAttribLocation = 0;
  const massAttribLocation = 1;
  const densityAttribLocation = 2;
  const sizeAttribLocation = 3;
  const compactnessAttribLocation = 4;
  const dropletStrideBytes = valsPerDroplet * Float32Array.BYTES_PER_ELEMENT;

  var even = true; // used to switch between precipitation buffers

  const precipitationVao_0 = gl.createVertexArray();
  const precipVertexBuffer_0 = gl.createBuffer();
  const precipitationTF_0 = gl.createTransformFeedback();
  const precipitationVao_1 = gl.createVertexArray();
  const precipVertexBuffer_1 = gl.createBuffer();
  const precipitationTF_1 = gl.createTransformFeedback();


  var rainDrops;

  function initRainDrops()
  {
    rainDrops = [];
    // generate inactive droplets with random values to be used as seeds for random spawning
    for (var i = 0; i < NUM_DROPLETS; i++) {
      // seperate push for each element is fastest
      rainDrops.push(Math.random());         // X
      rainDrops.push(Math.random());         // Y
      rainDrops.push(-10.0 + Math.random()); // water negative to disable
      rainDrops.push(Math.random());         // ice
      rainDrops.push(Math.random());         // density
      rainDrops.push(0.0);                   // size proxy
      rainDrops.push(0.0);                   // compactness / ice-structure memory
    }
  }

  function setupPrecipitationBuffers()
  {
    gl.bindVertexArray(precipitationVao_0);

    gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_0);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rainDrops), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(dropPositionAttribLocation);
    gl.enableVertexAttribArray(massAttribLocation);
    gl.enableVertexAttribArray(densityAttribLocation);
    gl.enableVertexAttribArray(sizeAttribLocation);
    gl.enableVertexAttribArray(compactnessAttribLocation);
    gl.vertexAttribPointer(
      dropPositionAttribLocation,         // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      0                                   // Offset from the beginning of a single vertex to this attribute
    );
    gl.vertexAttribPointer(
      massAttribLocation,                 // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      densityAttribLocation,              // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      4 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      sizeAttribLocation,                 // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      5 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      compactnessAttribLocation,          // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      6 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, precipitationTF_0);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0,
                      precipVertexBuffer_0); // this binds the default (id = 0)
    // TRANSFORM_FEEBACK buffer
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    // var precipitationVao_1 = gl.createVertexArray();
    gl.bindVertexArray(precipitationVao_1);

    gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_1);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rainDrops), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(dropPositionAttribLocation);
    gl.enableVertexAttribArray(massAttribLocation);
    gl.enableVertexAttribArray(densityAttribLocation);
    gl.enableVertexAttribArray(sizeAttribLocation);
    gl.enableVertexAttribArray(compactnessAttribLocation);
    gl.vertexAttribPointer(
      dropPositionAttribLocation,         // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      0                                   // Offset from the beginning of a single vertex to this attribute
    );
    gl.vertexAttribPointer(
      massAttribLocation,                 // Attribute location
      2,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      2 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      densityAttribLocation,              // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      4 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      sizeAttribLocation,                 // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      5 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );
    gl.vertexAttribPointer(
      compactnessAttribLocation,          // Attribute location
      1,                                  // Number of elements per attribute
      gl.FLOAT,                           // Type of elements
      gl.FALSE,
      dropletStrideBytes,                 // Size of an individual vertex
      6 * Float32Array.BYTES_PER_ELEMENT  // Offset from the beginning of a
      // single vertex to this attribute
    );

    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, precipitationTF_1);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0,
                      precipVertexBuffer_1); // this binds the default (id = 0)
    // TRANSFORM_FEEBACK buffer
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);

    gl.bindBuffer(gl.ARRAY_BUFFER, null); // buffers are bound via VAO's
    gl.bindVertexArray(fluidVao);         // set screenfilling rect again
  }

  function logDropletsAndToggleFollow()
  {
    let dropletInfoCanvas = document.getElementById('dropletInfoCanvas');

    if (dropletFollowID >= 0) { // disable follow droplet
      dropletFollowID = -1;
      dropletInfoCanvas.style.display = 'none';
      return;
    }

    // log data of all the droplets within the brush
    let tempDroplets = new Float32Array(valsPerDroplet * NUM_DROPLETS);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, even ? precipVertexBuffer_0 : precipVertexBuffer_1); // x, y, water, ice, density, size, compactness
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, 0, tempDroplets);

    console.log(' ');
    console.log(' ');
    console.log('DROPLETS:-----------------------------------------');
    console.log(' ');

    let numInBrush = 0;
    let duplicates = 0;

    for (let n = 0; n < NUM_DROPLETS; n++) {
      let i = n * valsPerDroplet;
      let X = tempDroplets[i + 0];
      let Y = tempDroplets[i + 1];
      let x = (X + 1.0) / 2.0;
      let y = (Y + 1.0) / 2.0;
      let water = tempDroplets[i + 2];
      let ice = tempDroplets[i + 3];
      let density = tempDroplets[i + 4];
      let size = tempDroplets[i + 5];
      let compactness = tempDroplets[i + 6];

      let dx = (mouseXinSim - x) * sim_aspect;
      let dy = mouseYinSim - y;
      let dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < guiControls.brushSize / 2.0 / sim_res_y && water >= 0) { // if droplet is within the brush and active
        let radarMetrics = calcDropletRadarMetrics(water, ice, density, size, compactness);
        console.log('n:', n);
        console.log('x:', x);
        console.log('y:', y);
        console.log('water:', water);
        console.log('Ice:', ice);
        console.log('Density:', density);
        console.log('Size:', size);
        console.log('Compactness:', compactness);
        console.log('Zh:', radarMetrics.zh);
        console.log('Zv:', radarMetrics.zv);
        console.log('ZDR:', radarMetrics.zdrDb);
        console.log('HV:', radarMetrics.hv);
        console.log('rho_i:', radarMetrics.rhoParticle);
        console.log('Type:', radarMetrics.dominantType);
        console.log('Hydrometeors:', radarMetrics.hydrometeors);
        console.log('H size:', radarMetrics.hSize);
        console.log('V size:', radarMetrics.vSize);
        console.log('Flattening:', radarMetrics.flattening);
        console.log(' ');
        numInBrush++;


        if (numInBrush == 1) { // first droplet found
          dropletFollowID = n;
          dropletInfoCanvas.style.display = 'block';
        }
      }
      /*
        // check for duplicates. Very slow!
        if (n < NUM_DROPLETS - 1) {
          for (let d = n + 1; d < NUM_DROPLETS; d++) {
            let j = d * valsPerDroplet;
            if (X == tempDroplets[j + 0] && Y == tempDroplets[j + 1]) {
              duplicates++;
              break;
            }
          }
        }
      */
    }
    console.log(NUM_DROPLETS, 'total droplets. ', numInBrush, 'droplets logged. ', duplicates, ' duplicates found');


    // dropletFollowMode = true;
  }


  function readDropletData(n)
  {
    let i = n * valsPerDroplet;
    let byteOffset = i * 4; // Convert to byte offset

    let dropletData = new Float32Array(valsPerDroplet);
    gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER, even ? precipVertexBuffer_0 : precipVertexBuffer_1);
    gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER, byteOffset, dropletData, 0, valsPerDroplet);

    dropletData[0] = (dropletData[0] + 1.0) / 2.0;
    dropletData[1] = (dropletData[1] + 1.0) / 2.0;

    // let x = dropletData[0];
    // let y = dropletData[1];
    // let water = dropletData[2];
    // let ice = dropletData[3];
    // let density = dropletData[4];

    // console.log('Droplet ', n);
    // console.log('x:', x);
    // console.log('y:', y);
    // console.log('water:', water);
    // console.log('Ice:', ice);
    // console.log('Density:', density);
    // console.log(' ');

    return dropletData;
  }


  if (initialRainDrops) {
    rainDrops = initialRainDrops;
  } else {
    initRainDrops();
  }

  setupPrecipitationBuffers();


  /*

  TEXTURE DESCRIPTIONS

  base texture: RGBA32F
  [0] = Horizontal velocity                              -1.0 to 1.0
  [1] = Vertical   velocity                              -1.0 to 1.0
  [2] = Pressure                                          >= 0
  [3] = Temperature in air, indicator in wall

  water texture: RGBA32F
  [0] = total water                                        >= 0
  [1] = cloud water                                        >= 0
  [2] = precipitation in air, moisture in surface          >= 0
  [3] = smoke/dust in air, snow in surface                 >= 0 for smoke/dust
  0 to 100 for snow

  wall texture: RGBA8I
  [0] walltype
  [1] manhattan distance to nearest wall                   0 to 127
  [2] height above/below ground. Surface = 0               -127 to 127
  [3] vegetation                                           0 to 127     grass from 0 to 50, trees from 50 to 127

  lighting texture: RGBA32F
  [0] sunlight                                             0 to 1.0
  [1] net heating effect of IR + sun absorbed by smoke
  [2] IR coming down                                       >= 0
  [3] IR going  up                                         >= 0

  */

  const baseTexture_0 = gl.createTexture();
  const baseTexture_1 = gl.createTexture();
  const waterTexture_0 = gl.createTexture();
  const waterTexture_1 = gl.createTexture();
  const reflectivitySnapshotTex = gl.createTexture();
  const phaseTexture = gl.createTexture();           // liquid/ice sums and hail shaft mask
  const phaseStatsTexture = gl.createTexture();      // rho_i / irregularity stats for rhohv
  const radarMomentsTexture = gl.createTexture();    // Zh, Zv, HV, count
  const radarMomentsSnapshotTex = gl.createTexture();
  const rhohvSnapshotTex = gl.createTexture();
  const zdrSnapshotTex = gl.createTexture();
  const radarFieldTexture_0 = gl.createTexture();    // smoothed radar field
  const radarFieldTexture_1 = gl.createTexture();    // smoothed radar field
  const hailShaftTexture_0 = gl.createTexture();      // smoothed hail signal for realistic precipitation tint
  const hailShaftTexture_1 = gl.createTexture();      // smoothed hail signal for realistic precipitation tint
  const phaseSnapshotTex = gl.createTexture();
  const phaseStatsSnapshotTex = gl.createTexture();
  const wallTexture_0 = gl.createTexture();
  const wallTexture_1 = gl.createTexture();

  const curlTexture = gl.createTexture();
  const vortForceTexture = gl.createTexture();

  const lightTexture_0 = gl.createTexture();
  const lightTexture_1 = gl.createTexture();
  const precipitationFeedbackTexture = gl.createTexture();
  const precipitationDepositionTexture = gl.createTexture();
  const lightningDataTexture = gl.createTexture(); // single pixel texture holding location and timing of current lightning strike
  let phaseAccumProgram;

  // Static texures:
  const noiseTexture = gl.createTexture();
  const A380Texture = gl.createTexture();
  const A380_R_Texture = gl.createTexture();
  const A380GearTexture = gl.createTexture();
  const surfaceTextureMap = gl.createTexture();
  const colorScalesTexture = gl.createTexture();
  radarPaletteTexture = gl.createTexture();

  const lightningTextures = [];
  const numLightningTextures = 10;


  frameBuff_0 = gl.createFramebuffer(); // global for weather stations
  frameBuff_1 = gl.createFramebuffer();

  const curlFrameBuff = gl.createFramebuffer();
  const vortForceFrameBuff = gl.createFramebuffer();

  lightFrameBuff_0 = gl.createFramebuffer();
  const lightFrameBuff_1 = gl.createFramebuffer();
  reflectivitySnapshotFBO = gl.createFramebuffer();
  const rhohvSnapshotFBO = gl.createFramebuffer();
  const zdrSnapshotFBO = gl.createFramebuffer();
  const phaseFrameBuff = gl.createFramebuffer();
  const phaseSnapshotFBO = gl.createFramebuffer();
  const radarFieldFrameBuff_0 = gl.createFramebuffer();
  const radarFieldFrameBuff_1 = gl.createFramebuffer();
  const hailShaftFrameBuff_0 = gl.createFramebuffer();
  const hailShaftFrameBuff_1 = gl.createFramebuffer();
  const precipitationFeedbackFrameBuff = gl.createFramebuffer();
  const lightningDataFrameBuff = gl.createFramebuffer();
  let radarFieldCurrentIndex = 0;
  let hailShaftCurrentIndex = 0;

  // Set up Textures
  async function setupTextures()
  {
    radarFieldCurrentIndex = 0;
    hailShaftCurrentIndex = 0;

    gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialBaseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialBaseTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialWaterTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, initialWaterTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8I, sim_res_x, sim_res_y, 0, gl.RGBA_INTEGER, gl.BYTE, initialWallTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    //  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);


    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8I, sim_res_x, sim_res_y, 0, gl.RGBA_INTEGER, gl.BYTE, initialWallTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    // gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // cache for radar refresh (RGBA32F to hold the smoothed radar field snapshot)
    gl.bindTexture(gl.TEXTURE_2D, reflectivitySnapshotTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // live phase (water/ice sums)
    gl.bindTexture(gl.TEXTURE_2D, phaseTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    // live rho_i / irregularity stats for rhohv
    gl.bindTexture(gl.TEXTURE_2D, phaseStatsTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, radarMomentsTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, radarMomentsSnapshotTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, rhohvSnapshotTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, zdrSnapshotTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, radarFieldTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, radarFieldTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, hailShaftTexture_0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, hailShaftTexture_1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, phaseSnapshotTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindTexture(gl.TEXTURE_2D, phaseStatsSnapshotTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);


    lastSaveTime = new Date();
  }

  setupTextures();

  createAmbientLightFBOs();

  function refreshReflectivitySnapshot(now)
  {
    gl.bindFramebuffer(gl.FRAMEBUFFER, phaseFrameBuff);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindTexture(gl.TEXTURE_2D, phaseSnapshotTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, sim_res_x, sim_res_y);
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.bindTexture(gl.TEXTURE_2D, phaseStatsSnapshotTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, sim_res_x, sim_res_y);
    gl.readBuffer(gl.COLOR_ATTACHMENT2);
    gl.bindTexture(gl.TEXTURE_2D, radarMomentsSnapshotTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, sim_res_x, sim_res_y);

    gl.bindFramebuffer(gl.FRAMEBUFFER, radarFieldCurrentIndex == 0 ? radarFieldFrameBuff_0 : radarFieldFrameBuff_1);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindTexture(gl.TEXTURE_2D, reflectivitySnapshotTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, sim_res_x, sim_res_y);

    gl.bindFramebuffer(gl.FRAMEBUFFER, rhohvSnapshotFBO);
    gl.viewport(0, 0, sim_res_x, sim_res_y);
    gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
    gl.disable(gl.BLEND);
    gl.useProgram(rhohvFieldProgram);
    gl.uniform1f(gl.getUniformLocation(rhohvFieldProgram, 'binSize'), Math.max(1.0, Math.round(guiControls.rhohvPixelSize)));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, radarMomentsSnapshotTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, phaseStatsSnapshotTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
    gl.bindVertexArray(fluidVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, zdrSnapshotFBO);
    gl.viewport(0, 0, sim_res_x, sim_res_y);
    gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
    gl.disable(gl.BLEND);
    gl.useProgram(zdrFieldProgram);
    gl.uniform1f(gl.getUniformLocation(zdrFieldProgram, 'fillRadius'), Math.max(0.0, Math.round(guiControls.zdrFillRadius)));
    gl.uniform1f(gl.getUniformLocation(zdrFieldProgram, 'supportDbzMin'), guiControls.zdrMaskDbz);
    gl.uniform1f(gl.getUniformLocation(zdrFieldProgram, 'reflMult'), guiControls.reflectivityGain);
    gl.uniform1f(gl.getUniformLocation(zdrFieldProgram, 'reflBoost'), guiControls.reflectivityBoost);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, radarMomentsSnapshotTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, reflectivitySnapshotTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
    gl.bindVertexArray(fluidVao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    lastReflectivitySnapshotTime = now;
    radarRefreshNoiseTick += 1.0;
    radarNeedsMeasure = true; // trigger radar updates after new snapshot
  }

  function bindRadarProductTextureForDisplayMode(displayMode)
  {
    gl.activeTexture(gl.TEXTURE4);
    if (displayMode == 'DISP_RHOHV') {
      gl.bindTexture(gl.TEXTURE_2D, rhohvSnapshotTex);
    } else if (displayMode == 'DISP_ZDR') {
      gl.bindTexture(gl.TEXTURE_2D, zdrSnapshotTex);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, reflectivitySnapshotTex);
    }
  }

  function setupPolarRadarDisplay(displayMode, cursorType, productOpaque)
  {
    const productId = getRadarProductIdForDisplayMode(displayMode);
    const productMode = getRadarProductRenderMode(displayMode);
    const towers = getPolarRadarRenderTowers();
    if (!productId || productMode < 0 || towers.length == 0)
      return false;

    const uniformData = buildPolarRadarUniformData(towers);

    gl.useProgram(radarPolarDisplayProgram);
    gl.uniform2f(gl.getUniformLocation(radarPolarDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
    gl.uniform3f(gl.getUniformLocation(radarPolarDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
    gl.uniform4f(gl.getUniformLocation(radarPolarDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
    gl.uniform1f(gl.getUniformLocation(radarPolarDisplayProgram, 'Xmult'), horizontalDisplayMult);
    gl.uniform1i(gl.getUniformLocation(radarPolarDisplayProgram, 'productMode'), productMode);
    gl.uniform1i(gl.getUniformLocation(radarPolarDisplayProgram, 'productOpaque'), productOpaque ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(radarPolarDisplayProgram, 'productAlpha'), 0.76);
    gl.uniform1f(gl.getUniformLocation(radarPolarDisplayProgram, 'reflMult'), guiControls.reflectivityGain);
    gl.uniform1f(gl.getUniformLocation(radarPolarDisplayProgram, 'reflBoost'), guiControls.reflectivityBoost);
    gl.uniform1f(gl.getUniformLocation(radarPolarDisplayProgram, 'simHeightKm'), guiControls.simHeight / 1000.0);
    gl.uniform1i(gl.getUniformLocation(radarPolarDisplayProgram, 'wrapHorizontally'), guiControls.wrapHorizontally ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(radarPolarDisplayProgram, 'compositeMode'), radarPanelMode == RADAR_PANEL_MODE_COMPOSITE ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(radarPolarDisplayProgram, 'compositePixelSize'), getRadarProductPixelSize(displayMode));
    gl.uniform1i(gl.getUniformLocation(radarPolarDisplayProgram, 'radarCount'), uniformData.count);
    gl.uniform4fv(gl.getUniformLocation(radarPolarDisplayProgram, 'radarSites[0]'), uniformData.sites);
    gl.uniform4fv(gl.getUniformLocation(radarPolarDisplayProgram, 'radarParams[0]'), uniformData.params);
    applyRadarPaletteUniforms(radarPolarDisplayProgram, productId);

    gl.activeTexture(gl.TEXTURE0 + RADAR_PALETTE_TEXTURE_UNIT);
    gl.bindTexture(gl.TEXTURE_2D, radarPaletteTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
    bindRadarProductTextureForDisplayMode(displayMode);

    return true;
  }

  // Set up Framebuffers


  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, waterTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, wallTexture_0, 0);


  gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, baseTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, waterTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, wallTexture_1, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, reflectivitySnapshotFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflectivitySnapshotTex, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, rhohvSnapshotFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rhohvSnapshotTex, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, zdrSnapshotFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, zdrSnapshotTex, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, phaseFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, phaseTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, phaseStatsTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, radarMomentsTexture, 0);
  gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.bindFramebuffer(gl.FRAMEBUFFER, radarFieldFrameBuff_0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, radarFieldTexture_0, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, radarFieldFrameBuff_1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, radarFieldTexture_1, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, hailShaftFrameBuff_0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hailShaftTexture_0, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, hailShaftFrameBuff_1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hailShaftTexture_1, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, phaseSnapshotFBO);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, phaseSnapshotTex, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, phaseStatsSnapshotTex, 0);

  gl.bindFramebuffer(gl.FRAMEBUFFER, radarFieldFrameBuff_0);
  gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, radarFieldFrameBuff_1);
  gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, hailShaftFrameBuff_0);
  gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, hailShaftFrameBuff_1);
  gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // initialize snapshot immediately so first render has valid data
  refreshReflectivitySnapshot(performance.now ? performance.now() : 0);


  gl.bindTexture(gl.TEXTURE_2D, curlTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, sim_res_x, sim_res_y, 0, gl.RED, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, curlFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, curlTexture,
                          0); // attach the texture as the first color attachment


  gl.bindTexture(gl.TEXTURE_2D, vortForceTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sim_res_x, sim_res_y, 0, gl.RG, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, vortForceFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vortForceTexture, 0);

  gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT,
                null);                                               // HALF_FLOAT before, but problems with acuracy
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
                   gl.CLAMP_TO_EDGE); // prevent light from shining trough at bottem or top

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTexture_0, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emittedLightFBO.texture, 0);


  gl.bindTexture(gl.TEXTURE_2D, lightTexture_1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);    // LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // prevent light from shining trough at bottem or top

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_1);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightTexture_1, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, emittedLightFBO.texture, 0);


  gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, sim_res_x, sim_res_y, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, sim_res_x, sim_res_y, 0, gl.RG, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, precipitationFeedbackTexture, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, precipitationDepositionTexture, 0);

  gl.bindTexture(gl.TEXTURE_2D, lightningDataTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 1, 1, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  gl.bindFramebuffer(gl.FRAMEBUFFER, lightningDataFrameBuff);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lightningDataTexture, 0);

  // load images
  imgElement = await loadImage('resources/img/noise_texture.jpg');

  gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);

  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // gl.texParameteri(
  //     gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,
  //     gl.REPEAT);  // default, so no need to set
  // gl.texParameteri(
  //     gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,
  //     gl.REPEAT);  // default, so no need to set

  imgElement = await loadImage('resources/img/A380.png');

  gl.bindTexture(gl.TEXTURE_2D, A380Texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT
                                                                                   // NEAREST_MIPMAP_LINEAR create weird effects

  imgElement = await loadImage('resources/img/A380_R.png');

  gl.bindTexture(gl.TEXTURE_2D, A380_R_Texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT

  imgElement = await loadImage('resources/img/A380_gear.png');

  gl.bindTexture(gl.TEXTURE_2D, A380GearTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); // LINEAR_MIPMAP_LINEAR
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);            // CLAMP_TO_EDGE
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);            // REPEAT

  imgElement = await loadImage('resources/img/surfaceTextureMap.png');

  gl.bindTexture(gl.TEXTURE_2D, surfaceTextureMap);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  // gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);        // horizontal
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // vertical


  imgElement = await loadImage('resources/img/ColorScales.png');

  gl.bindTexture(gl.TEXTURE_2D, colorScalesTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imgElement.width, imgElement.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imgElement);
  // gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);        // horizontal
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); // vertical

  updateRadarPaletteTexture();


  function downloadImageData(imgData)
  {
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');
    canvas.width = imgData.width;
    canvas.height = imgData.height
    ctx.putImageData(imgData, 0, 0);
    var dataUrl = canvas.toDataURL('image/png');
    var link = document.createElement('a');
    link.href = dataUrl;
    link.download = 'Lightning_image.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }


  function generateLightningTexture(i, imgData)
  {
    lightningTextures[i] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, lightningTextures[i]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, imgData.width, imgData.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, imgData);
    // gl.generateMipmap(gl.TEXTURE_2D);                                                // optional
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); // LINEAR_MIPMAP_LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  }


  for (let i = 0; i < numLightningTextures; i++) {
    const lightningGeneratorWorker = new Worker('./lightningGenerator.js');
    lightningGeneratorWorker.onmessage = (imgElement) => {
      // downloadImageData(imgElement.data); // for debugging

      generateLightningTexture(i, imgElement.data);
    };

    lightningGeneratorWorker.postMessage({width : 2500, height : 5000}); // 10000 5000
  }

  await loadingBar.set(90, 'Setting up FBO`s');

  createHdrFBO();

  createBloomFBOs();

  var texelSizeX = 1.0 / sim_res_x;
  var texelSizeY = 1.0 / sim_res_y;

  dryLapse = (guiControls.simHeight * guiControls.dryLapseRate) / 1000.0; // total lapse rate from bottem to top of atmosphere


  // generate sounding data for forcing in sim

  var realWorldSounding_T = new Float32Array(504);   // sim_res_y + 1
  var realWorldSounding_W = new Float32Array(504);   // sim_res_y + 1
  var realWorldSounding_Vel = new Float32Array(504); // sim_res_y + 1
  if (soundingData && soundingData.length > 10) {
    var soundingForSim = rawSoundingToSimSounding(soundingData, guiControls.simHeight, sim_res_y + 1);

    for (var y = 0; y < sim_res_y + 1; y++) {

      let soundingSample = soundingForSim[y];

      realWorldSounding_T[y] = realToPotentialT(CtoK(soundingSample.t), y); // initial temperature profile
      realWorldSounding_W[y] = maxWater(CtoK(soundingSample.td), y);        // initial temperature profile
      realWorldSounding_Vel[y] = soundingSample.vel;
    }
    // console.log(realWorldSounding_T);
    // console.log(realWorldSounding_W);
    // console.log(realWorldSounding_Vel);
  } else {
    console.log('No valid sounding loaded!');
  }

  // generate Initial temperature profile

  var initial_T = new Float32Array(504); // sim_res_y + 1

  for (var y = 0; y < sim_res_y + 1; y++) {
    let altitude = y / (sim_res_y + 1) * guiControls.simHeight;
    var realTemp = Math.max(map_range(altitude, 0, 12000, 15.0, -70.0), -60);

    initial_T[y] = realToPotentialT(CtoK(realTemp), y); // initial temperature profile
  }

  cellHeight = guiControls.simHeight / sim_res_y; // in meters

  // Set constant uniforms
  gl.useProgram(setupProgram);
  gl.uniform2f(gl.getUniformLocation(setupProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform2f(gl.getUniformLocation(setupProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform1f(gl.getUniformLocation(setupProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(setupProgram, 'simHeight'), guiControls.simHeight);

  gl.uniform4fv(gl.getUniformLocation(setupProgram, 'initial_Tv'), initial_T);

  gl.useProgram(advectionProgram);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(advectionProgram, 'wallTex'), 2);
  gl.uniform2f(gl.getUniformLocation(advectionProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform2f(gl.getUniformLocation(advectionProgram, 'resolution'), sim_res_x, sim_res_y);
  // gl.uniform1fv(
  // gl.getUniformLocation(advectionProgram, 'initial_T'), initial_T);
  gl.uniform4fv(gl.getUniformLocation(advectionProgram, 'initial_Tv'), initial_T);
  gl.uniform1f(gl.getUniformLocation(advectionProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(advectionProgram, 'waterTemperature'),
               CtoK(guiControls.waterTemperature)); // can be changed by GUI input

  gl.uniform4fv(gl.getUniformLocation(advectionProgram, 'realWorldSounding_Tv'), realWorldSounding_T);
  gl.uniform4fv(gl.getUniformLocation(advectionProgram, 'realWorldSounding_Wv'), realWorldSounding_W);
  gl.uniform4fv(gl.getUniformLocation(advectionProgram, 'realWorldSounding_Velv'), realWorldSounding_Vel);

  gl.useProgram(pressureProgram);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(pressureProgram, 'wallTex'), 1);
  gl.uniform2f(gl.getUniformLocation(pressureProgram, 'texelSize'), texelSizeX, texelSizeY);

  gl.useProgram(velocityProgram);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(velocityProgram, 'wallTex'), 1);
  gl.uniform2f(gl.getUniformLocation(velocityProgram, 'texelSize'), texelSizeX, texelSizeY);

  // gl.uniform1fv(gl.getUniformLocation(velocityProgram, 'initial_T'), initial_T);
  gl.uniform4fv(gl.getUniformLocation(velocityProgram, 'initial_Tv'), initial_T);

  gl.useProgram(vorticityProgram);
  gl.uniform2f(gl.getUniformLocation(vorticityProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(vorticityProgram, 'curlTex'), 0);

  gl.useProgram(boundaryProgram);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'vortForceTex'), 2);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'wallTex'), 3);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'lightTex'), 4);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'precipFeedbackTex'), 5);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'precipDepositionTex'), 6);
  gl.uniform2f(gl.getUniformLocation(boundaryProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(boundaryProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'vorticity'),
               guiControls.vorticity);              // can be changed by GUI input
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'waterTemperature'),
               CtoK(guiControls.waterTemperature)); // can be changed by GUI input
  gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'dryLapse'), dryLapse);
  // gl.uniform1fv(gl.getUniformLocation(boundaryProgram, 'initial_T'), initial_T);
  gl.uniform4fv(gl.getUniformLocation(boundaryProgram, 'initial_Tv'), initial_T);
  gl.uniform1i(gl.getUniformLocation(boundaryProgram, 'allowCaves'), guiControls.allowCaves ? 1 : 0);

  gl.useProgram(curlProgram);
  gl.uniform2f(gl.getUniformLocation(curlProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(curlProgram, 'baseTex'), 0);

  gl.useProgram(lightingProgram);
  gl.uniform2f(gl.getUniformLocation(lightingProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(lightingProgram, 'texelSize'), texelSizeX, texelSizeY);

  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(lightingProgram, 'lightTex'), 3);
  gl.uniform1f(gl.getUniformLocation(lightingProgram, 'dryLapse'), dryLapse);

  // Display programs:
  gl.useProgram(temperatureDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(temperatureDisplayProgram, 'colorScalesTex'), 9);
  gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'dryLapse'), dryLapse);

  gl.useProgram(airQualityDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(airQualityDisplayProgram, 'colorScalesTex'), 9);
  gl.uniform1f(gl.getUniformLocation(airQualityDisplayProgram, 'dryLapse'), dryLapse);

  gl.useProgram(precipDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'waterTex'), 0);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'precipDisplayMode'), 0);

  gl.useProgram(precipPhaseAccumProgram);
  gl.uniform2f(gl.getUniformLocation(precipPhaseAccumProgram, 'resolution'), sim_res_x, sim_res_y);

  gl.useProgram(rhohvFieldProgram);
  gl.uniform2f(gl.getUniformLocation(rhohvFieldProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(rhohvFieldProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(rhohvFieldProgram, 'radarMomentsTex'), 0);
  gl.uniform1i(gl.getUniformLocation(rhohvFieldProgram, 'phaseStatsTex'), 1);
  gl.uniform1i(gl.getUniformLocation(rhohvFieldProgram, 'wallTex'), 2);
  gl.uniform1f(gl.getUniformLocation(rhohvFieldProgram, 'dryLapse'), dryLapse);

  gl.useProgram(rhohvDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(rhohvDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(rhohvDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(rhohvDisplayProgram, 'rhohvTex'), 4);
  gl.uniform1i(gl.getUniformLocation(rhohvDisplayProgram, 'radarPaletteTex'), RADAR_PALETTE_TEXTURE_UNIT);
  gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'binSize'), Math.max(1.0, Math.round(guiControls.rhohvPixelSize)));
  gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'radarRefreshTick'), radarRefreshNoiseTick);
  gl.uniform1i(gl.getUniformLocation(rhohvDisplayProgram, 'showLowCCArtifacts'), guiControls.rhohvLowCCArtifacts ? 1 : 0);
  gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'clutterDensity'), guiControls.rhohvClutterDensity);

  gl.useProgram(zdrFieldProgram);
  gl.uniform2f(gl.getUniformLocation(zdrFieldProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(zdrFieldProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(zdrFieldProgram, 'radarMomentsTex'), 0);
  gl.uniform1i(gl.getUniformLocation(zdrFieldProgram, 'reflectivityTex'), 1);
  gl.uniform1i(gl.getUniformLocation(zdrFieldProgram, 'wallTex'), 2);
  gl.uniform1f(gl.getUniformLocation(zdrFieldProgram, 'dryLapse'), dryLapse);

  gl.useProgram(zdrDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(zdrDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(zdrDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(zdrDisplayProgram, 'zdrTex'), 4);
  gl.uniform1i(gl.getUniformLocation(zdrDisplayProgram, 'radarPaletteTex'), RADAR_PALETTE_TEXTURE_UNIT);
  gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'radarRefreshTick'), radarRefreshNoiseTick);

  gl.useProgram(radarFieldUpdateProgram);
  gl.uniform2f(gl.getUniformLocation(radarFieldUpdateProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(radarFieldUpdateProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(radarFieldUpdateProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(radarFieldUpdateProgram, 'wallTex'), 1);
  gl.uniform1i(gl.getUniformLocation(radarFieldUpdateProgram, 'radarFieldTex'), 2);
  gl.uniform1i(gl.getUniformLocation(radarFieldUpdateProgram, 'radarSourceTex'), 3);

  gl.useProgram(skyBackgroundDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'simHeight'), guiControls.simHeight);
  gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'minShadowLight'), minShadowLight);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'lightTex'), 3);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'ambientLightTex'), 9);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'precipFeedbackTex'), 7);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeTex'), 8);
  gl.uniform1i(gl.getUniformLocation(skyBackgroundDisplayProgram, 'planeGearTex'), 10);

  gl.useProgram(universalDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'anyTex'), 0);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'snapshotTex'), 4);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'phaseTex'), 5);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'phaseStatsTex'), 6);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'radarMomentsTex'), 7);
  gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'radarPaletteTex'), RADAR_PALETTE_TEXTURE_UNIT);

  gl.useProgram(radarPolarDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(radarPolarDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(radarPolarDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(radarPolarDisplayProgram, 'productTex'), 4);
  gl.uniform1i(gl.getUniformLocation(radarPolarDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(radarPolarDisplayProgram, 'radarPaletteTex'), RADAR_PALETTE_TEXTURE_UNIT);

  gl.useProgram(realisticDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'minShadowLight'), minShadowLight);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'wallTex'), 2);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightTex'), 3);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'noiseTex'), 4);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'surfaceTextureMap'), 5);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'curlTex'), 6);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightningTex'), 7);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'lightningDataTex'), 8);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'ambientLightTex'), 9);
  gl.uniform1i(gl.getUniformLocation(realisticDisplayProgram, 'hailShaftTex'), 10);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'dryLapse'), dryLapse);
  gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'cellHeight'), cellHeight);

  gl.useProgram(precipitationProgram);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'baseTex'), 0);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'waterTex'), 1);
  gl.uniform1i(gl.getUniformLocation(precipitationProgram, 'lightningDataTex'), 2);
  gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(precipitationProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'dryLapse'), dryLapse);
  gl.useProgram(IRtempDisplayProgram);
  gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'texelSize'), texelSizeX, texelSizeY);
  gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'lightTex'), 0);
  gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'wallTex'), 2);

  gl.useProgram(postProcessingProgram);
  gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'hdrTex'), 0);
  gl.uniform1i(gl.getUniformLocation(postProcessingProgram, 'bloomTex'), 1);


  gl.useProgram(isolateBrightPartsProgram);
  gl.uniform1i(gl.getUniformLocation(isolateBrightPartsProgram, 'hdrTex'), 0);

  gl.useProgram(lightningLocationProgram);
  gl.uniform1i(gl.getUniformLocation(lightningLocationProgram, 'precipFeedbackTex'), 0);
  gl.uniform2f(gl.getUniformLocation(lightningLocationProgram, 'resolution'), sim_res_x, sim_res_y);
  gl.uniform2f(gl.getUniformLocation(lightningLocationProgram, 'texelSize'), texelSizeX, texelSizeY);


  // console.time('Set uniforms');
  setGuiUniforms(); // all uniforms changed by gui
  // console.timeEnd('Set uniforms')

  gl.bindVertexArray(fluidVao);

  // if no save file was loaded
  // Use setup shader to set initial conditions
  if (initialWallTex == null) {
    gl.viewport(0, 0, sim_res_x, sim_res_y);
    gl.useProgram(setupProgram);
    // Render to both framebuffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
    gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
    gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }


  if (!SETUP_MODE) {
    startSimulation();
  }

  if (guiControls.sound) {
    soundSystem = new SoundSystem();
  }

  await loadingBar.set(95, 'Loading sounds and generating lightning textures'); // loading complete
  await loadingBar.remove();

  var srcVAO;
  var destVAO;
  var destTF;

  // preload uniform locations for tiny performance gain
  var uniformLocation_boundaryProgram_iterNum = gl.getUniformLocation(boundaryProgram, 'iterNum');


  for (i = 0; i < weatherStations.length; i++) { // initial measurement at weather stations
    weatherStations[i].measure();
  }

  setInterval(calcFps, 1000); // log fps
  requestAnimationFrame(draw);

  function draw()
  { // Runs for every frame
    let camPanSpeed = guiControls.camSpeed;

    if (rightCtrlPressed) {
      camPanSpeed *= 0.2;
    }

    if (!airplaneMode) {
      if (upPressed) {
        // ^
        cam.changeViewYpos(-camPanSpeed / cam.curZoom);
      }
      if (downPressed) {
        // v
        cam.changeViewYpos(camPanSpeed / cam.curZoom);
      }
    }
    if (leftPressed) {
      // <
      cam.changeViewXpos(camPanSpeed / cam.curZoom);
    }
    if (rightPressed) {
      // >
      cam.changeViewXpos(-camPanSpeed / cam.curZoom);
    }
    if (plusPressed) {
      // +
      cam.changeViewZoom(camPanSpeed);
    }
    if (minusPressed) {
      // -
      cam.changeViewZoom(-camPanSpeed);
    }

    cam.move();

    prevMouseXinSim = mouseXinSim;
    prevMouseYinSim = mouseYinSim;

    mouseXinSim = screenToSimX(mouseX);
    mouseYinSim = screenToSimY(mouseY);

    if (SETUP_MODE) {
      gl.disable(gl.BLEND);
      gl.viewport(0, 0, sim_res_x, sim_res_y);
      gl.useProgram(setupProgram);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'seed'), mouseXinSim);
      gl.uniform1f(gl.getUniformLocation(setupProgram, 'heightMult'), ((canvas.height - mouseY) / canvas.height) * 2.0);
      // Render to both framebuffers
      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
      gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
      gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      // NOT SETUP MODE:

      // gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.useProgram(advectionProgram);

      var inputType = -1;
      if (leftMousePressed) {
        if (guiControls.tool == 'TOOL_NONE')
          inputType = 0; // only flashlight on
        else if (guiControls.tool == 'TOOL_TEMPERATURE')
          inputType = 1;
        else if (guiControls.tool == 'TOOL_WATER')
          inputType = 2;
        else if (guiControls.tool == 'TOOL_SMOKE')
          inputType = 3;
        else if (guiControls.tool == 'TOOL_WIND')
          inputType = 4;
        else if (guiControls.tool == 'TOOL_WALL')
          inputType = 10;
        else if (guiControls.tool == 'TOOL_WALL_LAND')
          inputType = 11;
        else if (guiControls.tool == 'TOOL_WALL_SEA')
          inputType = 12;
        else if (guiControls.tool == 'TOOL_WALL_FIRE')
          inputType = 13;
        else if (guiControls.tool == 'TOOL_WALL_URBAN')
          inputType = 14;
        else if (guiControls.tool == 'TOOL_WALL_RUNWAY')
          inputType = 15;
        else if (guiControls.tool == 'TOOL_WALL_INDUSTRIAL')
          inputType = 16;

        // Surface environment modifiers
        else if (guiControls.tool == 'TOOL_WALL_MOIST')
          inputType = 20;
        else if (guiControls.tool == 'TOOL_WALL_SNOW')
          inputType = 21;
        else if (guiControls.tool == 'TOOL_VEGETATION')
          inputType = 22;
        else if (guiControls.tool == 'TOOL_SOUNDING') {
          // activate probe and skip writing to simulation fields
          soundingProbeActive = true;
          soundingProbeX = guiControls.wrapHorizontally ? mod(mouseXinSim, 1.0) : clamp(mouseXinSim, 0.0, 1.0);
          soundingProbeY = clamp(mouseYinSim, 0.0, 1.0);
          soundingProbeNeedsRedraw = true;
          if (!guiControls.showGraph) {
            guiControls.showGraph = true;
            hideOrShowGraph();
            // ensure first render happens
            soundingProbeNeedsRedraw = true;
          }
          inputType = -1; // don't inject into sim
        } else if (guiControls.tool == 'TOOL_RADAR') {
          inputType = -1; // radar placement shouldn't paint into sim
        }

        var intensity = guiControls.brushIntensity;

        if (ctrlPressed) {
          intensity *= -1;
        }

        var posXinSim;

        if (guiControls.wholeWidth)
          posXinSim = -1.0;
        else if (guiControls.wrapHorizontally)
          posXinSim = mod(mouseXinSim, 1.0); // wrap mouse position around borders
        else
          posXinSim = clamp(mouseXinSim, 0.0, 1.0);


        let moveX = mouseXinSim - prevMouseXinSim;
        let moveY = mouseYinSim - prevMouseYinSim;

        gl.uniform4f(gl.getUniformLocation(advectionProgram, 'userInputValues'), posXinSim, mouseYinSim, intensity, guiControls.brushSize * 0.5);
        gl.uniform2f(gl.getUniformLocation(advectionProgram, 'userInputMove'), moveX, moveY);
        gl.uniform1i(gl.getUniformLocation(advectionProgram, 'wrapHorizontally'), guiControls.wrapHorizontally);
      }
      gl.uniform1i(gl.getUniformLocation(advectionProgram, 'userInputType'), inputType);


      // guiControls.IterPerFrame = 1.0 / timePerIteration * 3600 / 60.0;


      if (!guiControls.paused) { // Simulation part

        let nightAccelerationActive = !airplaneMode && guiControls.dayNightCycle && guiControls.accelerateNight && guiControls.sunAngle < 0.;

        if (guiControls.dayNightCycle) {
          if (airplaneMode) {
            updateSunlight(1.0 / 3600.0 / 60);                                                                    // increase solar time at real speed: 1/60 seconds per frame
          } else {
            updateSunlight(timePerIteration * guiControls.IterPerFrame * (nightAccelerationActive ? 10.0 : 1.0)); // increase solar time
          }
        }

        gl.useProgram(lightingProgram);
        gl.uniform1f(gl.getUniformLocation(lightingProgram, 'IR_rate'), guiControls.IR_rate * (nightAccelerationActive ? 10.0 : 1.0));

        gl.viewport(0, 0, sim_res_x, sim_res_y);
        gl.clearColor(0.0, 0.0, 0.0, 0.0);

        if (!airplaneMode || airplane.hasCrashed() || frameNum % 17 == 0) { // update every 17 frames because 60 * 0.288 secs per iteration = 17.28
          let numIterations = guiControls.IterPerFrame;
          if (airplaneMode)
            numIterations = 1;
          for (var i = 0; i < numIterations; i++) { // Simulation loop
            // calc and apply velocity
            gl.useProgram(velocityProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc curl
            gl.useProgram(curlProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, curlFrameBuff);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calculate vorticity
            gl.useProgram(vorticityProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, curlTexture);
            gl.bindFramebuffer(gl.FRAMEBUFFER, vortForceFrameBuff);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // apply vorticity, boundary conditions and user input
            gl.useProgram(boundaryProgram);
            gl.uniform1f(uniformLocation_boundaryProgram_iterNum, iterNum);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, vortForceTexture);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);


            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc and apply advection
            gl.useProgram(advectionProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_0);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc and apply pressure
            gl.useProgram(pressureProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.NONE, gl.COLOR_ATTACHMENT2 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            // calc light
            gl.useProgram(lightingProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.activeTexture(gl.TEXTURE3);

            if (even) {
              gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
              gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_1);

              srcVAO = precipitationVao_0;
              destTF = precipitationTF_1;
              destVAO = precipitationVao_1;
            } else {
              gl.bindTexture(gl.TEXTURE_2D, lightTexture_1);
              gl.bindFramebuffer(gl.FRAMEBUFFER, lightFrameBuff_0);

              srcVAO = precipitationVao_1;
              destTF = precipitationTF_0;
              destVAO = precipitationVao_0;
            }
            even = !even;

            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1 ]); // calc light
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);


            gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
            gl.viewport(0, 0, sim_res_x, sim_res_y);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1 ]);
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT);         // clear precipitation feedback

            gl.bindFramebuffer(gl.FRAMEBUFFER, phaseFrameBuff);
            gl.viewport(0, 0, sim_res_x, sim_res_y);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
            gl.clearColor(0.0, 0.0, 0.0, 0.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            if (guiControls.enablePrecipitation) { // move precipitation, HUGE PERFORMANCE BOTTLENECK!

              gl.useProgram(precipitationProgram);
              gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'iterNum'), iterNum);
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.ONE, gl.ONE); // add everything together
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
              gl.activeTexture(gl.TEXTURE1);
              gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
              gl.activeTexture(gl.TEXTURE2);
              gl.bindTexture(gl.TEXTURE_2D, lightningDataTexture);

              gl.bindFramebuffer(gl.FRAMEBUFFER, precipitationFeedbackFrameBuff);
              gl.viewport(0, 0, sim_res_x, sim_res_y);
              gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1 ]);

              gl.bindVertexArray(srcVAO);
              gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, destTF);
              gl.beginTransformFeedback(gl.POINTS);
              gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
              gl.endTransformFeedback();

              // sample to count number of inactive droplets
              if (iterNum % 600 == 0) {
                gl.readBuffer(gl.COLOR_ATTACHMENT0);
                var sampleValues = new Float32Array(4);
                // console.time('cnt');
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, sampleValues);
                // console.timeEnd('cnt')         // 1 - 100 ms huge variation
                // console.log(sampleValues[0]);  // number of inactive droplets
                guiControls.inactiveDroplets = sampleValues[0];
                // gl.useProgram(precipitationProgram); // already set
                gl.uniform1f(gl.getUniformLocation(precipitationProgram, 'inactiveDroplets'), sampleValues[0]);
              }

              gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
              gl.disable(gl.BLEND);

              // accumulate liquid/ice phase per cell for radar rhohv
              gl.bindFramebuffer(gl.FRAMEBUFFER, phaseFrameBuff);
              gl.drawBuffers([ gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2 ]);
              gl.enable(gl.BLEND);
              gl.blendFunc(gl.ONE, gl.ONE);
              gl.useProgram(precipPhaseAccumProgram);
              gl.bindVertexArray(destVAO); // latest droplet state
              gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
              gl.disable(gl.BLEND);
              gl.bindVertexArray(fluidVao); // set screenfilling rect again


              // Extract lightningLocation from precipitationfeedback
              gl.useProgram(lightningLocationProgram);
              gl.uniform1f(gl.getUniformLocation(lightningLocationProgram, 'iterNum'), iterNum);

              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);

              gl.bindFramebuffer(gl.FRAMEBUFFER, lightningDataFrameBuff);
              gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
              gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

              if (guiControls.sound) {
                gl.readBuffer(gl.COLOR_ATTACHMENT0);
                var lightningDataValues = new Float32Array(4);
                gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, lightningDataValues);
                // console.log('lightningDataValues: ', lightningDataValues[0], lightningDataValues[1], lightningDataValues[2], iterNum, lightningDataValues[3]);

                if (Math.round(lightningDataValues[2]) == iterNum) {
                  soundSystem.soundThunder(lightningDataValues[0], lightningDataValues[1], Math.pow(lightningDataValues[3], 2.0));
                }
              }
            }

            gl.useProgram(radarFieldUpdateProgram);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, radarFieldCurrentIndex == 0 ? radarFieldTexture_0 : radarFieldTexture_1);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, radarMomentsTexture);

            gl.bindFramebuffer(gl.FRAMEBUFFER, radarFieldCurrentIndex == 0 ? radarFieldFrameBuff_1 : radarFieldFrameBuff_0);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            radarFieldCurrentIndex = 1 - radarFieldCurrentIndex;

            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, hailShaftCurrentIndex == 0 ? hailShaftTexture_0 : hailShaftTexture_1);
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, phaseTexture);

            gl.bindFramebuffer(gl.FRAMEBUFFER, hailShaftCurrentIndex == 0 ? hailShaftFrameBuff_1 : hailShaftFrameBuff_0);
            gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            hailShaftCurrentIndex = 1 - hailShaftCurrentIndex;

            if (displayWeatherStations && iterNum % 208 == 0) { // ~every 60 in game seconds:  0.00008 *3600 * 208 = 59.9
              for (i = 0; i < weatherStations.length; i++) {
                weatherStations[i].measure();
              }
            }
            if (!airplaneMode) {
              iterNum++;
            }
          }
        }

        if (airplaneMode) {
          iterNum++; // make sure iterNum increases every frame for nice lightning
          airplane.takeUserInput();
          airplane.move();
        }

      } // end of simulation part

      if (guiControls.showGraph) {
        var probeX = soundingProbeActive ? soundingProbeX : mouseXinSim;
        var probeY = soundingProbeActive ? soundingProbeY : mouseYinSim;
        if (!soundingProbeActive || soundingProbeNeedsRedraw) {
          soundingGraph.draw(Math.floor(Math.abs(mod(probeX * sim_res_x, sim_res_x))), Math.floor(clamp(probeY, 0.0, 1.0) * sim_res_y));
          soundingProbeNeedsRedraw = false; // freeze until next probe move/click
        }
      }

    } // END OF NOT SETUP MODE


    let cursorType = 1.0; // normal circular brush
    if (guiControls.wholeWidth) {
      cursorType = 2.0;   // cursor whole width brush
    } else if (SETUP_MODE || (inputType <= 0 && !bPressed &&
               (guiControls.tool == 'TOOL_NONE' || guiControls.tool == 'TOOL_STATION' || guiControls.tool == 'TOOL_SOUNDING' || guiControls.tool == 'TOOL_RADAR'))) {
      cursorType = 0;     // cursor off sig (no brush ring for station / radar placement)
    }

    gl.useProgram(postProcessingProgram);

    if (cursorType != 0 && !sunIsUp) {
      // working at night
      gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), 2.0);
    } else {
      gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), guiControls.exposure);
    }

    if (inputType == 0) {
      // clicking while tool is set to flashlight(NONE)
      // enable flashlight
      cursorType += 0.55;
    }

    // Follow droplet
    if (dropletFollowID >= 0) {
      let dropletInfo = readDropletData(dropletFollowID);
      let radarMetrics = calcDropletRadarMetrics(dropletInfo[2], dropletInfo[3], dropletInfo[4], dropletInfo[5], dropletInfo[6]);
      cam.setPosition(-dropletInfo[0] * 2.0 + 1.0, -dropletInfo[1] * 2.0 * (sim_res_y / sim_res_x) + (sim_res_y / sim_res_x));

      let dropletInfoCanvas = document.getElementById('dropletInfoCanvas');
      let ctx = dropletInfoCanvas.getContext('2d');

      ctx.clearRect(0, 0, dropletInfoCanvas.width, dropletInfoCanvas.height);
      ctx.fillStyle = '#00000055';
      ctx.fillRect(0, 0, dropletInfoCanvas.width, dropletInfoCanvas.height);

      ctx.fillStyle = '#FF0000';
      ctx.fillRect(0, 0, 2, 2);

      ctx.font = '12px Arial';
      ctx.fillStyle = '#00AAFF';
      ctx.fillText('Water: ' + dropletInfo[2].toFixed(2), 0, 14);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('Ice: ' + dropletInfo[3].toFixed(2), 0, 28);
      ctx.fillStyle = '#00FF00';
      ctx.fillText('Dens: ' + dropletInfo[4].toFixed(2), 0, 42);
      ctx.fillStyle = '#FFD400';
      ctx.fillText('Size: ' + dropletInfo[5].toFixed(2), 0, 56);
      ctx.fillStyle = '#B8B8FF';
      ctx.fillText('Comp: ' + dropletInfo[6].toFixed(2), 0, 70);
      ctx.fillStyle = '#FF8A00';
      ctx.fillText('Zh: ' + radarMetrics.zh.toExponential(1), 0, 84);
      ctx.fillStyle = '#FFCC00';
      ctx.fillText('Zv: ' + radarMetrics.zv.toExponential(1), 0, 98);
      ctx.fillStyle = '#FFAA66';
      ctx.fillText('ZDR: ' + radarMetrics.zdrDb.toFixed(2) + ' dB', 0, 112);
      ctx.fillStyle = '#FF66CC';
      ctx.fillText('HV: ' + radarMetrics.hv.toExponential(1), 0, 126);
      ctx.fillStyle = '#FF99FF';
      ctx.fillText('rho_i: ' + radarMetrics.rhoParticle.toFixed(3), 0, 140);
      ctx.fillStyle = '#E8E8E8';
      ctx.fillText('Type: ' + radarMetrics.dominantType, 0, 154);
    }

    if (airplaneMode) {
      airplane.display();
    }

    // radar-like sweep: freeze reflectivity every user-defined interval
    const nowMs = performance.now ? performance.now() : Date.now();
    const refreshMs = Math.max(0.0, guiControls.reflectivityRefreshSec * 1000.0);
    if (nowMs - lastReflectivitySnapshotTime >= refreshMs) {
      refreshReflectivitySnapshot(nowMs);
    }

    // Radar product debug readout
    if (getRadarProductIdForDisplayMode(guiControls.displayMode) && getRadarProductDebugEnabled(guiControls.displayMode)) {
      var simXposDbg = Math.floor(Math.abs(mod(mouseXinSim * sim_res_x, sim_res_x)));
      var simYposDbg = Math.min(Math.max(Math.floor(mouseYinSim * sim_res_y), 0), sim_res_y - 1);

      var radarDbg = new Float32Array(4);
      if (guiControls.displayMode == 'DISP_REFLECTIVITY') {
        gl.bindFramebuffer(gl.FRAMEBUFFER, reflectivitySnapshotFBO);
        gl.readBuffer(gl.COLOR_ATTACHMENT0); // reflectivitySnapshotTex
        gl.readPixels(simXposDbg, simYposDbg, 1, 1, gl.RGBA, gl.FLOAT, radarDbg);
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, guiControls.displayMode == 'DISP_RHOHV' ? rhohvSnapshotFBO : zdrSnapshotFBO);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        gl.readPixels(simXposDbg, simYposDbg, 1, 1, gl.RGBA, gl.FLOAT, radarDbg);
      }

      reflectivityDbgEl.style.display = 'block';
      reflectivityDbgEl.style.left = mouseX + 12 + 'px';
      reflectivityDbgEl.style.top = mouseY + 12 + 'px';
      if (guiControls.displayMode == 'DISP_REFLECTIVITY') {
        var zhDbg = Math.max(radarDbg[0], 0.0);
        var z_raw_dbg = Math.sqrt(zhDbg) * guiControls.reflectivityGain + zhDbg * guiControls.reflectivityBoost;
        var dBZ_dbg = 10.0 * Math.log10(z_raw_dbg + 1e-6);
        reflectivityDbgEl.textContent = 'dBZ*: ' + dBZ_dbg.toFixed(1);
      } else if (guiControls.displayMode == 'DISP_RHOHV') {
        reflectivityDbgEl.textContent = 'rhohv: ' + radarDbg[0].toFixed(3);
      } else {
        reflectivityDbgEl.textContent = radarDbg[3] > 0.0 ? ('ZDR: ' + radarDbg[0].toFixed(2) + ' dB') : 'ZDR: --';
      }
    } else if (reflectivityDbgEl) {
      reflectivityDbgEl.style.display = 'none';
    }

    // render to canvas
    const isRadarProductMode = !!getRadarProductIdForDisplayMode(guiControls.displayMode);
    const usePolarRadarRenderer = shouldUsePolarRadarRenderer(guiControls.displayMode);
    const overlayRadarProduct = isRadarProductMode && !getRadarProductBackground(guiControls.displayMode);
    const displayModeEffective = overlayRadarProduct ? 'DISP_REAL' : guiControls.displayMode;

    gl.useProgram(realisticDisplayProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // null is canvas
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);        // background color
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT);


    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);

    if (displayModeEffective == 'DISP_REAL') {

      { //  Abient Light Calculation
        gl.bindVertexArray(postProcessingVao);

        gl.bindFramebuffer(gl.FRAMEBUFFER, ambientLightFBOs[0].frameBuffer);
        gl.viewport(0, 0, ambientLightFBOs[0].width, ambientLightFBOs[0].height);
        gl.clearColor(0.0, 0.0, 0.0, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        let prevFBO = emittedLightFBO; // the previous FBO

        gl.useProgram(bloomBlurProgram);
        gl.uniform1i(gl.getUniformLocation(bloomBlurProgram, 'bloomTexture'), 0);

        for (let blurTimes = 0; blurTimes < 2; blurTimes++) { // blur twice for smoother result

          // downsample
          for (let i = 1; i < ambientLightFBOs.length; i++) {
            let destFBO = ambientLightFBOs[i];
            gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

            gl.viewport(0, 0, destFBO.width, destFBO.height);

            // bind texture
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

            gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
            // gl.drawBuffers([ gl.BACK ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

            prevFBO = destFBO;
          }

          // upsample and add
          gl.blendFunc(gl.ONE, gl.ONE); // add to the existing texture in the framebuffer
          gl.enable(gl.BLEND);

          for (let i = ambientLightFBOs.length - 2; i >= 0; i--) {
            let destFBO = ambientLightFBOs[i];

            gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

            gl.viewport(0, 0, destFBO.width, destFBO.height);
            gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
            // gl.drawBuffers([ gl.BACK ]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

            prevFBO = destFBO;
          }
          gl.disable(gl.BLEND);
        }
        gl.bindVertexArray(fluidVao);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, baseTexture_1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);


      gl.bindFramebuffer(gl.FRAMEBUFFER, hdrFBO.frameBuffer); // render to hdr framebuffer
      // gl.viewport(0, 0, sim_res_x, sim_res_y);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0); // background color
      gl.clear(gl.COLOR_BUFFER_BIT);


      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, surfaceTextureMap);
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D, curlTexture);
      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);


      // draw background
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, airplane.directionIsLeft ? A380Texture : A380_R_Texture); // A380Texture
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, ambientLightFBOs[0].texture);
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, A380GearTexture);

      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
      gl.uniform3f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
      gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'Xmult'), horizontalDisplayMult);
      gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'iterNum'), iterNum);

      gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to hdrFramebuffer

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);


      // draw clouds and terrain
      gl.useProgram(realisticDisplayProgram);
      gl.uniform2f(gl.getUniformLocation(realisticDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
      gl.uniform3f(gl.getUniformLocation(realisticDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
      gl.uniform4f(gl.getUniformLocation(realisticDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'Xmult'), horizontalDisplayMult);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'iterNum'), iterNum);

      // Don't display vectors when zoomed out because you would just see noise
      if (cam.curZoom / sim_res_x > 0.003) {
        gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'displayVectorField'), displayVectorField);
      } else {
        gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'displayVectorField'), 0.0);
      }


      let lightningTexNum = Math.floor(iterNum / 400) % numLightningTextures;
      // console.log(lightningTexNum)

      gl.activeTexture(gl.TEXTURE7);
      gl.bindTexture(gl.TEXTURE_2D, lightningTextures[lightningTexNum]);
      gl.activeTexture(gl.TEXTURE8);
      gl.bindTexture(gl.TEXTURE_2D, lightningDataTexture);

      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, ambientLightFBOs[0].texture);
      gl.activeTexture(gl.TEXTURE10);
      gl.bindTexture(gl.TEXTURE_2D, hailShaftCurrentIndex == 0 ? hailShaftTexture_0 : hailShaftTexture_1);


      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to hdr framebuffer

      gl.disable(gl.BLEND);

      // Post processing:

      gl.bindVertexArray(postProcessingVao);


      gl.useProgram(isolateBrightPartsProgram);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdrFBO.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloomFBOs[0].frameBuffer); // brightPartsFrameBuffer
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);                            // background color
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawBuffers([ gl.COLOR_ATTACHMENT0 ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // render bright parts to seperate texture


      // BLOOM

      let prevFBO = bloomFBOs[0]; // the previous FBO

      gl.useProgram(bloomBlurProgram);
      gl.uniform1i(gl.getUniformLocation(bloomBlurProgram, 'bloomTexture'), 0);


      // downsample
      for (let i = 1; i < bloomFBOs.length; i++) {
        let destFBO = bloomFBOs[i];
        gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

        gl.viewport(0, 0, destFBO.width, destFBO.height);

        // bind texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

        gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
        // gl.drawBuffers([ gl.BACK ]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

        prevFBO = destFBO;
      }

      // upsample and add
      gl.blendFunc(gl.ONE, gl.ONE); // add to the existing texture in the framebuffer
      gl.enable(gl.BLEND);

      for (let i = bloomFBOs.length - 2; i >= 0; i--) {
        let destFBO = bloomFBOs[i];

        gl.uniform2f(gl.getUniformLocation(bloomBlurProgram, 'texelSize'), prevFBO.texelSizeX, prevFBO.texelSizeY);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, prevFBO.texture);

        gl.viewport(0, 0, destFBO.width, destFBO.height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, destFBO.frameBuffer);
        // gl.drawBuffers([ gl.BACK ]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to destFBO

        prevFBO = destFBO;
      }

      gl.disable(gl.BLEND);

      gl.useProgram(postProcessingProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, hdrFBO.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bloomFBOs[0].texture);

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      if (SETUP_MODE) {
        gl.uniform1f(gl.getUniformLocation(postProcessingProgram, 'exposure'), 50.0);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null); // null is canvas
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.0, 0.0, 0.0, 1.0);        // background color
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawBuffers([ gl.BACK ]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to canvas

      gl.bindVertexArray(fluidVao);

      if (guiControls.showDrops) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        // draw drops over clouds
        // draw precipitation
        gl.useProgram(precipDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(precipDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'precipDisplayMode'), 0);
        gl.bindVertexArray(destVAO);
        gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
        gl.bindVertexArray(fluidVao); // set screenfilling rect again
        gl.disable(gl.BLEND);
      }


    } else {
      gl.activeTexture(gl.TEXTURE9);
      gl.bindTexture(gl.TEXTURE_2D, colorScalesTexture);
      gl.activeTexture(gl.TEXTURE0 + RADAR_PALETTE_TEXTURE_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, radarPaletteTexture);

      if (displayModeEffective == 'DISP_PARTICLE_SIZE') {
        gl.clearColor(0.035, 0.05, 0.08, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(precipDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(precipDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(precipDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform1i(gl.getUniformLocation(precipDisplayProgram, 'precipDisplayMode'), 1);
        gl.bindVertexArray(destVAO);
        gl.drawArrays(gl.POINTS, 0, NUM_DROPLETS);
        gl.bindVertexArray(fluidVao);
        gl.disable(gl.BLEND);
      } else if (usePolarRadarRenderer && getRadarProductIdForDisplayMode(displayModeEffective)) {
        setupPolarRadarDisplay(displayModeEffective, cursorType, getRadarProductBackground(displayModeEffective));
      } else if (displayModeEffective == 'DISP_TEMPERATURE') {
        gl.useProgram(temperatureDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(temperatureDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(temperatureDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(temperatureDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'Xmult'), horizontalDisplayMult);


        // Don't display vectors when zoomed out because you would just see
        // noise
        if (cam.curZoom / sim_res_x > 0.003) {
          gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'displayVectorField'), displayVectorField);
        } else {
          gl.uniform1f(gl.getUniformLocation(temperatureDisplayProgram, 'displayVectorField'), 0.0);
        }

      } else if (displayModeEffective == 'DISP_AIRQUALITY') {
        gl.useProgram(airQualityDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(airQualityDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(airQualityDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(airQualityDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(airQualityDisplayProgram, 'Xmult'), horizontalDisplayMult);

      } else if (displayModeEffective == 'DISP_IRDOWNTEMP') {
        gl.useProgram(IRtempDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(IRtempDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(IRtempDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'upOrDown'), 0);
        gl.uniform1f(gl.getUniformLocation(IRtempDisplayProgram, 'Xmult'), horizontalDisplayMult);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      } else if (displayModeEffective == 'DISP_IRUPTEMP') {
        gl.useProgram(IRtempDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(IRtempDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(IRtempDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(IRtempDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1i(gl.getUniformLocation(IRtempDisplayProgram, 'upOrDown'), 1);
        gl.uniform1f(gl.getUniformLocation(IRtempDisplayProgram, 'Xmult'), horizontalDisplayMult);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
      } else if (displayModeEffective == 'DISP_RHOHV') {
        gl.useProgram(rhohvDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(rhohvDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(rhohvDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(rhohvDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'Xmult'), horizontalDisplayMult);
        applyRadarPaletteUniforms(rhohvDisplayProgram, RADAR_PRODUCT_RHOHV);
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'binSize'), Math.max(1.0, Math.round(guiControls.rhohvPixelSize)));
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'radarRefreshTick'), radarRefreshNoiseTick);
        gl.uniform1i(gl.getUniformLocation(rhohvDisplayProgram, 'showLowCCArtifacts'), guiControls.rhohvLowCCArtifacts ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'clutterDensity'), guiControls.rhohvClutterDensity);
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'productAlpha'), 0.76);
        gl.uniform1i(gl.getUniformLocation(rhohvDisplayProgram, 'productOpaque'), guiControls.rhohvBackground ? 1 : 0);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, rhohvSnapshotTex);
        if (!guiControls.rhohvBackground) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
      } else if (displayModeEffective == 'DISP_ZDR') {
        gl.useProgram(zdrDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(zdrDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(zdrDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(zdrDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'Xmult'), horizontalDisplayMult);
        applyRadarPaletteUniforms(zdrDisplayProgram, RADAR_PRODUCT_ZDR);
        gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'binSize'), Math.max(1.0, Math.round(guiControls.zdrPixelSize)));
        gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'radarRefreshTick'), radarRefreshNoiseTick);
        gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'productAlpha'), 0.76);
        gl.uniform1i(gl.getUniformLocation(zdrDisplayProgram, 'productOpaque'), guiControls.zdrBackground ? 1 : 0);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, zdrSnapshotTex);
        if (!guiControls.zdrBackground) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
      } else {
        gl.useProgram(universalDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(universalDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(universalDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'Xmult'), horizontalDisplayMult);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'reflectivityMode'), 0);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'reflMult'), 1.0);

        switch (displayModeEffective) {
        case 'DISP_HORIVEL':
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 10.0); // 20.0
          break;
        case 'DISP_VERTVEL':
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 10.0); // 20.0
          break;
        case 'DISP_WATER':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), -0.06); // negative number so positive amount is blue
          break;
        case 'DISP_IRHEATING':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, lightTexture_0);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 50000.0);
          break;
        case 'DISP_REFLECTIVITY':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
          gl.activeTexture(gl.TEXTURE4);
          gl.bindTexture(gl.TEXTURE_2D, reflectivitySnapshotTex);
          gl.activeTexture(gl.TEXTURE5);
          gl.bindTexture(gl.TEXTURE_2D, phaseSnapshotTex);
          gl.activeTexture(gl.TEXTURE6);
          gl.bindTexture(gl.TEXTURE_2D, phaseStatsSnapshotTex);
          gl.activeTexture(gl.TEXTURE7);
          gl.bindTexture(gl.TEXTURE_2D, radarMomentsTexture);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2); // unused in radar mode
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.0);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'reflectivityMode'), 1);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'radarProduct'), 0);
        applyRadarPaletteUniforms(universalDisplayProgram, RADAR_PRODUCT_REFLECTIVITY);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'reflMult'), guiControls.reflectivityGain); // user gain
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'reflBoost'), guiControls.reflectivityBoost);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'reflPixelSize'), guiControls.reflectivityPixelSize);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'reflBackground'), guiControls.reflectivityBackground ? 1 : 0);
        if (!guiControls.reflectivityBackground) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }
        break;
        case 'DISP_PRECIPFEEDBACK_MASS':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 0.3);
          break;
        case 'DISP_PRECIPFEEDBACK_HEAT':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 500.0);
          break;
        case 'DISP_PRECIPFEEDBACK_VAPOR':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationFeedbackTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 500.0);
          break;
        case 'DISP_PRECIPFEEDBACK_RAIN':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.0);
          break;
        case 'DISP_PRECIPFEEDBACK_SNOW':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, precipitationDepositionTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 1);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.0);
          break;
        case 'DISP_SOIL_MOISTURE':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, waterTexture_0);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 0.02);
          break;
        case 'DISP_CURL':
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, curlTexture);
          gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 0);
          gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 7.0);
          break;
        }
      }

      if (displayModeEffective != 'DISP_PARTICLE_SIZE')
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); // draw to canvas
    }

    if (overlayRadarProduct) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (usePolarRadarRenderer) {
        setupPolarRadarDisplay(guiControls.displayMode, cursorType, false);
      } else if (guiControls.displayMode == 'DISP_REFLECTIVITY') {
        gl.useProgram(universalDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(universalDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(universalDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(universalDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'Xmult'), horizontalDisplayMult);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'reflectivityMode'), 1);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'reflMult'), guiControls.reflectivityGain);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'reflBoost'), guiControls.reflectivityBoost);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'reflPixelSize'), guiControls.reflectivityPixelSize);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'reflBackground'), guiControls.reflectivityBackground ? 1 : 0);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'radarProduct'), 0);
        gl.uniform1i(gl.getUniformLocation(universalDisplayProgram, 'quantityIndex'), 2);
        gl.uniform1f(gl.getUniformLocation(universalDisplayProgram, 'dispMultiplier'), 1.0);
        applyRadarPaletteUniforms(universalDisplayProgram, RADAR_PRODUCT_REFLECTIVITY);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, waterTexture_1);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, reflectivitySnapshotTex);
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, phaseSnapshotTex);
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, phaseStatsSnapshotTex);
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, radarMomentsTexture);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, wallTexture_1);
      } else if (guiControls.displayMode == 'DISP_RHOHV') {
        gl.useProgram(rhohvDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(rhohvDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(rhohvDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(rhohvDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'Xmult'), horizontalDisplayMult);
        applyRadarPaletteUniforms(rhohvDisplayProgram, RADAR_PRODUCT_RHOHV);
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'binSize'), Math.max(1.0, Math.round(guiControls.rhohvPixelSize)));
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'radarRefreshTick'), radarRefreshNoiseTick);
        gl.uniform1i(gl.getUniformLocation(rhohvDisplayProgram, 'showLowCCArtifacts'), guiControls.rhohvLowCCArtifacts ? 1 : 0);
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'clutterDensity'), guiControls.rhohvClutterDensity);
        gl.uniform1f(gl.getUniformLocation(rhohvDisplayProgram, 'productAlpha'), 0.76);
        gl.uniform1i(gl.getUniformLocation(rhohvDisplayProgram, 'productOpaque'), 0);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, rhohvSnapshotTex);
      } else {
        gl.useProgram(zdrDisplayProgram);
        gl.uniform2f(gl.getUniformLocation(zdrDisplayProgram, 'aspectRatios'), sim_aspect, canvas_aspect);
        gl.uniform3f(gl.getUniformLocation(zdrDisplayProgram, 'view'), cam.curXpos, cam.curYpos, cam.curZoom);
        gl.uniform4f(gl.getUniformLocation(zdrDisplayProgram, 'cursor'), mouseXinSim, mouseYinSim, guiControls.brushSize * 0.5, cursorType);
        gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'Xmult'), horizontalDisplayMult);
        applyRadarPaletteUniforms(zdrDisplayProgram, RADAR_PRODUCT_ZDR);
        gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'binSize'), Math.max(1.0, Math.round(guiControls.zdrPixelSize)));
        gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'radarRefreshTick'), radarRefreshNoiseTick);
        gl.uniform1f(gl.getUniformLocation(zdrDisplayProgram, 'productAlpha'), 0.76);
        gl.uniform1i(gl.getUniformLocation(zdrDisplayProgram, 'productOpaque'), 0);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, zdrSnapshotTex);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
  }

  if (displayWeatherStations) {
    for (i = 0; i < weatherStations.length; i++) {
      weatherStations[i].updateCanvas(); // update weather stations
    }
  }
  drawRadarRangeOverlay();
  for (i = 0; i < radarTowers.length; i++) {
    radarTowers[i].updateCanvas(); // keep position synced with camera
  }
  if (radarNeedsMeasure && radarTowers.length > 0) {
    const nowRadar = performance.now ? performance.now() : Date.now();
    for (i = 0; i < radarTowers.length; i++) {
      radarTowers[i].measure(nowRadar);
    }
    radarNeedsMeasure = false;
  }

    frameNum++;
    requestAnimationFrame(draw);
  }

  //////////////////////////////////////////////////////// functions:

  function hideOrShowGraph()
  {
    ensureSoundingPanel();
    const panelEl = document.getElementById('soundingPanel');
    if (guiControls.showGraph) {
      if (soundingGraph.graphCanvas)
        soundingGraph.graphCanvas.style.display = 'block';
      if (panelEl)
        panelEl.style.display = 'flex';
      resizeSoundingCanvas();
      soundingProbeNeedsRedraw = true;
    } else {
      if (panelEl)
        panelEl.style.display = 'none';
    }
  }

  function pad(num, size)
  {
    num = num.toString();
    while (num.length < size)
      num = '0' + num;
    return num;
  }

  function dateTimeStr()
  {
    var timeStr;
    if (guiControls.twelveHourClock) { // 12 hour clock for Americans
      timeStr = simDateTime.toLocaleString('en-US', {hour12 : true, hour : 'numeric', minute : 'numeric'});
    } else {                           // 24 hour clock
      timeStr = simDateTime.toLocaleString('nl-NL', {hour12 : false, hour : 'numeric', minute : 'numeric'});
    }

    const monthStr = simDateTime.toLocaleString('en-us', {month : 'short', day : 'numeric'});
    return timeStr + '&nbsp; ' + monthStr;
  }

  function onUpdateTimeOfDaySlider()
  {
    let minutes = (guiControls.timeOfDay % 1) * 60;
    simDateTime.setHours(guiControls.timeOfDay, minutes);
    updateSunlight();
  }

  function onUpdateMonthSlider()
  {
    let month = guiControls.month - 0.96;
    let date = (month % 1) * 30;
    simDateTime.setMonth(month, date);
    updateSunlight();
  }

  function updateSunlight(deltaT_hours)
  {
    if (deltaT_hours != 'MANUAL_ANGLE') {
      if (deltaT_hours != null) {                                                   // increment time
        simDateTime = new Date(simDateTime.getTime() + deltaT_hours * 3600 * 1000); // convert hours to ms and add to current date
        guiControls.timeOfDay = simDateTime.getHours() + simDateTime.getMinutes() / 60. + simDateTime.getSeconds() / 3600.;
        guiControls.month = simDateTime.getMonth() + 1 + simDateTime.getDate() / 30.5 + simDateTime.getHours() / 720.;
      } else {
        for (i = 0; i < weatherStations.length; i++) {
          weatherStations[i].clearChart();
        }
      }

      let timeOfDayRad = (guiControls.timeOfDay / 24.0) * 2.0 * Math.PI; // convert to radians

      timeOfDayRad -= Math.PI / 2.0;

      let tiltDeg = Math.sin(guiControls.month * 0.5236 - 1.92) * 23.5; // axis tilt
      let t = tiltDeg * degToRad;                                       // axis tilt in radians
      let l = guiControls.latitude * degToRad;                          // latitude

      guiControls.sunAngle = Math.asin(Math.sin(t) * Math.sin(l) + Math.cos(t) * Math.cos(l) * Math.sin(timeOfDayRad)) * radToDeg;

      if (guiControls.latitude - tiltDeg < 0.0) {
        // If sun is to the north, flip angle
        guiControls.sunAngle = 180.0 - guiControls.sunAngle;
      }
    }
    let solarZenithAngleDeg = (guiControls.sunAngle - 90);
    let solarZenithAngle = solarZenithAngleDeg * degToRad; // Solar zenith angle centered around 0. (0 = vertical)
    // Calculations visualized: https://www.desmos.com/calculator/kzr76zj5hq
    if (Math.abs(solarZenithAngle) < 85.0 * degToRad) {
      sunIsUp = true;
    } else {
      sunIsUp = false;
    }
    //		console.log(solarZenithAngle, sunIsUp);
    //	let sunIntensity = guiControls.sunIntensity *
    // Math.pow(Math.max(Math.sin((90.0 - Math.abs(guiControls.sunAngle)) *
    // degToRad) - 0.1, 0.0) * 1.111, 0.4);
    let sunIntensity = guiControls.sunIntensity * Math.pow(Math.max(Math.sin((180.0 - guiControls.sunAngle) * degToRad), 0.0), 0.1) * 1300.0; // max 1300 w/m2 at 12 km
    // console.log('sunIntensity: ', sunIntensity);

    // minShadowLight = clamp(((90 + 10) - Math.abs(solarZenithAngleDeg)) * 0.006, 0.005, 0.040); // decrease until the sun goes 10 deg below the horizon

    minShadowLight = map_range_C(Math.abs(solarZenithAngleDeg), 100.0, 85.0, 0.005, 0.040); // decrease until the sun goes 10 deg below the horizon

    if (boundaryProgram && lightingProgram && realisticDisplayProgram && skyBackgroundDisplayProgram) {
      gl.useProgram(boundaryProgram);
      gl.uniform1f(gl.getUniformLocation(boundaryProgram, 'sunAngle'), solarZenithAngle);
      gl.useProgram(lightingProgram);
      gl.uniform1f(gl.getUniformLocation(lightingProgram, 'sunIntensity'), sunIntensity);
      gl.uniform1f(gl.getUniformLocation(lightingProgram, 'sunAngle'), solarZenithAngle);
      gl.useProgram(realisticDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'sunAngle'), solarZenithAngle);
      gl.uniform1f(gl.getUniformLocation(realisticDisplayProgram, 'minShadowLight'), minShadowLight);
      gl.useProgram(skyBackgroundDisplayProgram);
      gl.uniform1f(gl.getUniformLocation(skyBackgroundDisplayProgram, 'minShadowLight'), minShadowLight);
    }

    if (guiControls.dayNightCycle)
      clockEl.innerHTML = dateTimeStr(); // update clock
    else
      clockEl.innerHTML = '';
  }


  async function prepareDownload()
  {
    let prevIterPerFrame = guiControls.IterPerFrame;
    var newFileName = prompt('Please enter a file name. Can not include \'.\'', saveFileName);

    if (newFileName != null) {
      if (newFileName != '' && !newFileName.includes('.')) {
        saveFileName = newFileName;

        gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_0);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);
        let baseTextureValues = new Float32Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, baseTextureValues);
        gl.readBuffer(gl.COLOR_ATTACHMENT1);
        let waterTextureValues = new Float32Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues);
        gl.readBuffer(gl.COLOR_ATTACHMENT2);
        let wallTextureValues = new Int8Array(4 * sim_res_x * sim_res_y);
        gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA_INTEGER, gl.BYTE, wallTextureValues);

        let precipBufferValues = new ArrayBuffer(rainDrops.length * Float32Array.BYTES_PER_ELEMENT);
        gl.bindBuffer(gl.ARRAY_BUFFER, precipVertexBuffer_0);
        gl.getBufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(precipBufferValues));
        gl.bindBuffer(gl.ARRAY_BUFFER, null); // unbind again


        let weatherStationsPositions = new Int16Array(weatherStations.length * 2);
        for (i = 0; i < weatherStations.length; i++) {
          weatherStationsPositions[i * 2] = weatherStations[i].getXpos();
          weatherStationsPositions[i * 2 + 1] = weatherStations[i].getYpos();
        }


        let strGuiControls = JSON.stringify(guiControls);

        let saveDataArray = [
          Uint16Array.of(sim_res_x), Uint16Array.of(sim_res_y), baseTextureValues, waterTextureValues, wallTextureValues, precipBufferValues, Uint16Array.of(weatherStations.length),
          weatherStationsPositions, strGuiControls
        ];
        let blob = new Blob(saveDataArray);        // combine everything into a single blob
        let arrBuff = await blob.arrayBuffer();    // turn into array for pako
        let arr = new Uint8Array(arrBuff);
        let compressed = window.pako.deflate(arr); // compress
        let compressedBlob = new Blob([ Uint32Array.of(saveFileVersionID), compressed ], {
          type : 'application/x-binary',
        }); // turn back into blob and add version id in front
        download(saveFileName + '.weathersandbox', compressedBlob);
      } else {
        alert('You didn\'t enter a valid file name!');
      }
    }
    guiControls.IterPerFrame = prevIterPerFrame;
    lastSaveTime = new Date(); // reset timer
  }

  function createProgram(vertexShader, fragmentShader, transform_feedback_varyings)
  {
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);

    if (transform_feedback_varyings != null)
      gl.transformFeedbackVaryings(program, transform_feedback_varyings, gl.INTERLEAVED_ATTRIBS);

    gl.linkProgram(program);
    gl.validateProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return program; // linked succesfully
    } else {
      throw 'ERROR: ' + gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
    }
  }

  async function loadSourceFile(fileName)
  {
    try {
      var request = new XMLHttpRequest();
      request.open('GET', fileName, false);
      request.send(null);
    } catch (error) {
      await loadingBar.showError('ERROR loading shader files! If you just opened index.html, try again using a local server!');
      throw error;
    }

    if (request.status === 200)
      return request.responseText;
    else if (request.status === 404)
      throw 'File not found: ' + fileName;
    else
      throw 'File loading error' + request.status;
  }

  async function loadShader(nameIn)
  {
    const re = /(?:\.([^.]+))?$/;

    let extension = re.exec(nameIn)[1]; // extract file extension

    let shaderType;
    let type;

    if (extension == 'vert') {
      type = 'vertex';
      shaderType = gl.VERTEX_SHADER;
    } else if (extension == 'frag') {
      type = 'fragment';
      shaderType = gl.FRAGMENT_SHADER;
    } else {
      throw 'Invalid shadertype: ' + extension;
    }

    let filename = 'shaders/' + type + '/' + nameIn;

    var shaderSource = await loadSourceFile(filename);
    if (shaderSource.includes('#include "common.glsl"')) {
      shaderSource = shaderSource.replace('#include "common.glsl"', commonSource);
    }

    if (shaderSource.includes('#include "commonDisplay.glsl"')) {
      shaderSource = shaderSource.replace('#include "commonDisplay.glsl"', commonDisplaySource);
    }

    const shader = gl.createShader(shaderType);
    gl.shaderSource(shader, shaderSource);
    // console.time('compileShader');
    gl.compileShader(shader);
    // console.timeEnd('compileShader')

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      // Compile error
      throw filename + ' COMPILATION ' + gl.getShaderInfoLog(shader);
    }
    return new Promise(async (resolve) => {
      await loadingBar.add(3, 'Loading shader: ' + nameIn);
      resolve(shader);
    });
  }

  function adjIterPerFrame(adj) { guiControls.IterPerFrame = Math.round(clamp(guiControls.IterPerFrame + adj, 1, 50)); }

  function isPageHidden() { return document.hidden || document.msHidden || document.webkitHidden || document.mozHidden; }

  function calcFps()
  {
    if (!isPageHidden()) {
      FPS = frameNum - lastFrameNum;
      lastFrameNum = frameNum;


      if (!guiControls.paused) {
        console.log(FPS + ' FPS   ' + guiControls.IterPerFrame + ' Iterations / frame      ' + FPS * guiControls.IterPerFrame + ' Iterations / second');

        if (guiControls.auto_IterPerFrame && !airplaneMode) {
          const fpsTarget = 60;
          adjIterPerFrame((FPS / fpsTarget - 1.0) * 5.0); // example: ((30 / 60)-1.0) = -0.5

          if (FPS == fpsTarget)
            adjIterPerFrame(1);
        }
      }
      // calculate total amounts of water and smoke for verification of fluid simulation
      /*
            gl.bindFramebuffer(gl.FRAMEBUFFER, frameBuff_1);
            gl.readBuffer(gl.COLOR_ATTACHMENT1); // watertexture
            var waterTextureValues = new Float32Array(sim_res_x * sim_res_y * 4);
            gl.readPixels(0, 0, sim_res_x, sim_res_y, gl.RGBA, gl.FLOAT, waterTextureValues);

            let totalWaterVapor = 0.0;
            let totalCloudWater = 0.0;
            let totalSmoke = 0.0;

            for (let x = 0; x < sim_res_x; x++) {
              for (let y = 0; y < sim_res_y; y++) {
                let cellInd = (x + y * sim_res_x) * 4;
                let vapor = waterTextureValues[cellInd + 0];
                if (vapor < 1000.0) { // ignore wall
                  totalCloudWater += waterTextureValues[cellInd + 1];
                  totalWaterVapor += vapor;

                  totalSmoke += waterTextureValues[cellInd + 3];
                }
              }
            }

            let totalWater = totalWaterVapor + totalCloudWater;
            console.log('Water  Vapor  Cloud  Smoke\n', Math.round(totalWater), Math.round(totalWaterVapor), Math.round(totalCloudWater), Math.round(totalSmoke));
            */
    }
  }
} // end of mainscript
