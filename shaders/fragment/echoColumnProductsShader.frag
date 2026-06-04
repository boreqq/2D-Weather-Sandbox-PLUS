#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform sampler2D reflectivityTex;
uniform isampler2D wallTex;
uniform float reflMult;
uniform float reflBoost;
uniform float simHeightKm;
uniform float sourcePixelSize;
uniform bool wrapHorizontally;
uniform bool usePolarGrid;
uniform int radarCount;
uniform vec4 radarSites[16];  // x, y, rangeKm, binKm
uniform vec4 radarParams[16]; // beamWidthDeg, attenuation, refreshSec, unused

layout(location = 0) out vec4 fragmentColor;

#define DISTANCE 1
#define MAX_VERTICAL_BINS 1024
#define PI 3.14159265358979323846
#define TAU 6.28318530717958647692

const float deg2rad = PI / 180.0;

float calcDbz(float zhLinear)
{
  float zRaw = sqrt(max(zhLinear, 0.0)) * reflMult + max(zhLinear, 0.0) * reflBoost;
  return 4.3429448 * log(zRaw + 1e-6);
}

float wrapDeltaX(float dx)
{
  return dx - floor(dx + 0.5);
}

ivec2 getSourceCell(ivec2 cell)
{
  float blockSize = max(sourcePixelSize, 1.0);
  if (blockSize <= 1.0)
    return cell;

  vec2 productGrid = max(floor(resolution / blockSize), vec2(1.0));
  vec2 sourceCoord = (floor((vec2(cell) + vec2(0.5)) / resolution * productGrid) + vec2(0.5)) / productGrid;
  return ivec2(clamp(floor(sourceCoord * resolution), vec2(0.0), resolution - vec2(1.0)));
}

bool getRadarSampleCoord(int siteIndex, float sampleRangeKm, float sampleAngle, out vec2 sampleCoord)
{
  vec4 site = radarSites[siteIndex];
  float cellKm = max(simHeightKm / max(resolution.y, 1.0), 1e-6);
  float sampleRangeCells = sampleRangeKm / cellKm;
  vec2 sampleOffset = vec2(cos(sampleAngle), sin(sampleAngle)) * sampleRangeCells / resolution;

  sampleCoord = site.xy + sampleOffset;
  if (wrapHorizontally) {
    sampleCoord.x = fract(sampleCoord.x);
  } else if (sampleCoord.x < 0.0 || sampleCoord.x > 1.0) {
    return false;
  }

  if (sampleCoord.y < 0.0 || sampleCoord.y > 1.0)
    return false;

  ivec2 wall = texture(wallTex, sampleCoord).xy;
  return wall[DISTANCE] != 0;
}

bool getPolarSample(ivec2 cell, int siteIndex, out float rangeKm, out float rangeBinKm, out float beamWidthRad, out float rangeBin, out float beamBin)
{
  vec4 site = radarSites[siteIndex];
  vec4 params = radarParams[siteIndex];
  vec2 currentCoord = (vec2(cell) + vec2(0.5)) / resolution;

  float dx = currentCoord.x - site.x;
  if (wrapHorizontally)
    dx = wrapDeltaX(dx);
  float dy = currentCoord.y - site.y;
  if (dy < 0.0)
    return false;

  vec2 deltaCells = vec2(dx * resolution.x, dy * resolution.y);
  float rangeCells = length(deltaCells);
  float cellKm = max(simHeightKm / max(resolution.y, 1.0), 1e-6);
  rangeKm = rangeCells * cellKm;

  if (rangeKm > site.z)
    return false;

  rangeBinKm = max(site.w, 0.01);
  beamWidthRad = max(params.x * deg2rad, 0.0001);

  float angleRad = atan(deltaCells.y, deltaCells.x);
  if (angleRad < 0.0)
    angleRad += TAU;

  rangeBin = floor(rangeKm / rangeBinKm);
  beamBin = floor(angleRad / beamWidthRad);
  return true;
}

float samplePolarBinZh(int siteIndex, float rangeBin, float beamBin, float rangeBinKm, float beamWidthRad)
{
  float zhSum = 0.0;
  float weightSum = 0.0;

  for (int r = 0; r < 3; r++) {
    float rangeFrac = 0.20 + float(r) * 0.30;
    float sampleRangeKm = (rangeBin + rangeFrac) * rangeBinKm;

    for (int a = 0; a < 3; a++) {
      float angleFrac = 0.20 + float(a) * 0.30;
      float sampleAngle = min((beamBin + angleFrac) * beamWidthRad, PI);

      vec2 sampleCoord;
      if (!getRadarSampleCoord(siteIndex, sampleRangeKm, sampleAngle, sampleCoord))
        continue;

      zhSum += max(texture(reflectivityTex, sampleCoord).r, 0.0);
      weightSum += 1.0;
    }
  }

  return weightSum > 0.0 ? zhSum / weightSum : 0.0;
}

float getRadarZhLinear(ivec2 cell)
{
  float bestZh = 0.0;
  float bestScore = -1e20;

  for (int i = 0; i < 16; i++) {
    if (i >= radarCount)
      break;

    float rangeKm;
    float rangeBinKm;
    float beamWidthRad;
    float rangeBin;
    float beamBin;

    if (!getPolarSample(cell, i, rangeKm, rangeBinKm, beamWidthRad, rangeBin, beamBin))
      continue;

    float zhLinear = samplePolarBinZh(i, rangeBin, beamBin, rangeBinKm, beamWidthRad);
    if (zhLinear <= 0.0)
      continue;

    float score = calcDbz(zhLinear);
    if (score > bestScore) {
      bestScore = score;
      bestZh = zhLinear;
    }
  }

  return bestZh;
}

void main()
{
  int x = int(clamp(floor(fragCoord.x), 0.0, resolution.x - 1.0));
  float layerKm = simHeightKm / max(resolution.y, 1.0);
  float layerM = layerKm * 1000.0;

  float echoTopKm = 0.0;
  float maxDbz = -99.0;
  float vil = 0.0;

  for (int y = 0; y < MAX_VERTICAL_BINS; y++) {
    if (y >= int(resolution.y))
      break;

    ivec2 cell = ivec2(x, y);
    ivec2 wall = texelFetch(wallTex, cell, 0).xy;
    if (wall[DISTANCE] == 0)
      continue;

    float zhLinear = usePolarGrid ? getRadarZhLinear(cell) : max(texelFetch(reflectivityTex, getSourceCell(cell), 0).r, 0.0);
    float dbz = calcDbz(zhLinear);
    maxDbz = max(maxDbz, dbz);

    if (dbz >= 5.0) {
      float zLinear = pow(10.0, clamp(dbz, -10.0, 80.0) / 10.0);
      vil += 3.44e-6 * pow(zLinear, 4.0 / 7.0) * layerM;
    }

    if (dbz >= 18.0)
      echoTopKm = (float(y) + 0.5) * layerKm;
  }

  float valid = smoothstep(0.1, 1.0, echoTopKm) * smoothstep(5.0, 25.0, maxDbz);
  float vild = valid > 0.0 ? vil / max(echoTopKm, layerKm) : 0.0;

  fragmentColor = vec4(echoTopKm, vil, vild, valid);
}
