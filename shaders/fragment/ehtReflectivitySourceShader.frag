#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;

uniform vec2 resolution;
uniform sampler2D reflectivityTex;
uniform isampler2D wallTex;
uniform float reflMult;
uniform float reflBoost;
uniform float simHeightKm;
uniform bool wrapHorizontally;
uniform bool usePolarGrid;
uniform bool compositeMode;
uniform bool attenuationEnabled;
uniform int radarCount;
uniform vec4 radarSites[16];  // x, y, rangeKm, binKm
uniform vec4 radarParams[16]; // beamWidthDeg, attenuation, refreshSec, unused

layout(location = 0) out vec4 fragmentColor;

#define DISTANCE 1
#define PI 3.14159265358979323846
#define TAU 6.28318530717958647692
#define ATTENUATION_STEPS 12

const float deg2rad = PI / 180.0;

float wrapDeltaX(float dx)
{
  return dx - floor(dx + 0.5);
}

float getReflectivityRaw(vec4 sampleValue)
{
  float zhLinear = max(sampleValue.r, 0.0);
  return max(sqrt(zhLinear) * reflMult + zhLinear * reflBoost, 0.0);
}

float getReflectivityDbz(vec4 sampleValue)
{
  return 4.3429448 * log(getReflectivityRaw(sampleValue) + 1e-6);
}

float getReflectivityEchoMask(vec4 sampleValue)
{
  return smoothstep(0.00005, 0.00150, getReflectivityRaw(sampleValue));
}

float getReflectivityLinearFromRaw(float zRaw)
{
  float targetRaw = max(zRaw, 0.0);
  float gain = max(reflMult, 1e-6);
  float boost = max(reflBoost, 0.0);

  if (boost > 1e-6) {
    float root = (-gain + sqrt(gain * gain + 4.0 * boost * targetRaw)) / (2.0 * boost);
    return root * root;
  }

  float root = targetRaw / gain;
  return root * root;
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

bool getPolarSample(int siteIndex, out float rangeKm, out float rangeBinKm, out float angleRad, out float beamWidthRad, out float rangeBin, out float beamBin)
{
  vec4 site = radarSites[siteIndex];
  vec4 params = radarParams[siteIndex];
  vec2 currentCoord = texCoord;

  if (wrapHorizontally) {
    currentCoord.x = fract(currentCoord.x);
  } else if (currentCoord.x < 0.0 || currentCoord.x > 1.0) {
    return false;
  }
  if (currentCoord.y < 0.0 || currentCoord.y > 1.0)
    return false;

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

  angleRad = atan(deltaCells.y, deltaCells.x);
  if (angleRad < 0.0)
    angleRad += TAU;

  rangeBin = floor(rangeKm / rangeBinKm);
  beamBin = floor(angleRad / beamWidthRad);
  angleRad = min((beamBin + 0.5) * beamWidthRad, PI);
  return true;
}

vec4 samplePolarBinReflectivity(int siteIndex, float rangeBin, float beamBin, float rangeBinKm, float beamWidthRad)
{
  vec4 sampleSum = vec4(0.0);
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

      sampleSum += texture(reflectivityTex, sampleCoord);
      weightSum += 1.0;
    }
  }

  return weightSum > 0.0 ? sampleSum / weightSum : vec4(0.0);
}

float getPathAttenuationDb(int siteIndex, float rangeKm, float rangeBinKm, float angleRad, float radarAttenuation)
{
  if (!attenuationEnabled || radarAttenuation <= 0.0)
    return 0.0;

  float pathEndKm = rangeKm - rangeBinKm * 0.75;
  if (pathEndKm <= 0.0)
    return 0.0;

  float stepKm = pathEndKm / float(ATTENUATION_STEPS);
  float attenuationDb = 0.0;

  for (int step = 0; step < ATTENUATION_STEPS; step++) {
    float sampleRangeKm = (float(step) + 0.5) * stepKm;
    if (sampleRangeKm >= pathEndKm)
      break;

    vec2 blockerCoord;
    if (!getRadarSampleCoord(siteIndex, sampleRangeKm, angleRad, blockerCoord))
      continue;

    vec4 blockerSample = texture(reflectivityTex, blockerCoord);
    float echoMask = getReflectivityEchoMask(blockerSample);
    if (echoMask <= 0.0)
      continue;

    float blockerDbz = getReflectivityDbz(blockerSample);
    float moderateCore = smoothstep(28.0, 52.0, blockerDbz);
    float heavyCore = smoothstep(45.0, 68.0, blockerDbz);
    float specificDbPerKm = radarAttenuation * (0.010 * moderateCore + 0.035 * heavyCore) * echoMask;
    attenuationDb += 2.0 * specificDbPerKm * stepKm;
  }

  return clamp(attenuationDb, 0.0, 36.0);
}

vec4 applyPathAttenuation(vec4 sampleValue, float attenuationDb)
{
  if (!attenuationEnabled || attenuationDb <= 0.0)
    return sampleValue;

  float zRaw = getReflectivityRaw(sampleValue);
  if (zRaw <= 0.0)
    return sampleValue;

  float attenuatedRaw = zRaw * exp(-attenuationDb / 4.3429448);
  sampleValue.r = getReflectivityLinearFromRaw(attenuatedRaw);
  return sampleValue;
}

float getCompositeRadarQuality(float rangeKm, float rangeBinKm, float beamWidthRad, float maxRangeKm, float attenuation, float reliability, float pathAttenuationDb)
{
  float rangeNorm = clamp(rangeKm / max(maxRangeKm, 0.01), 0.0, 1.0);
  float edgeScore = 1.0 - smoothstep(0.82, 1.0, rangeNorm);
  float rangeScore = mix(1.0, 0.45, rangeNorm);
  float effectiveBinKm = max(max(rangeBinKm, rangeKm * beamWidthRad), 0.05);
  float resolutionScore = 1.0 / pow(effectiveBinKm, 1.15);
  float attenuationScore = 1.0 / (1.0 + max(attenuation, 0.0) * rangeNorm * rangeNorm * 0.12);
  float pathScore = 1.0 / (1.0 + pathAttenuationDb * 0.08);
  return reliability * edgeScore * rangeScore * resolutionScore * attenuationScore * pathScore;
}

void main()
{
  ivec2 wall = texture(wallTex, texCoord).xy;
  if (wall[DISTANCE] == 0) {
    fragmentColor = vec4(0.0);
    return;
  }

  if (!usePolarGrid || radarCount <= 0) {
    vec4 source = texture(reflectivityTex, texCoord);
    fragmentColor = vec4(max(source.r, 0.0), 0.0, 0.0, source.r > 0.0 ? 1.0 : 0.0);
    return;
  }

  if (!compositeMode) {
    vec4 bestSample = vec4(0.0);
    float bestScore = -1e20;

    for (int i = 0; i < 16; i++) {
      if (i >= radarCount)
        break;

      float rangeKm;
      float rangeBinKm;
      float angleRad;
      float beamWidthRad;
      float rangeBin;
      float beamBin;

      if (!getPolarSample(i, rangeKm, rangeBinKm, angleRad, beamWidthRad, rangeBin, beamBin))
        continue;

      vec4 sampleValue = samplePolarBinReflectivity(i, rangeBin, beamBin, rangeBinKm, beamWidthRad);
      float pathAttenuationDb = getPathAttenuationDb(i, rangeKm, rangeBinKm, angleRad, radarParams[i].y);
      sampleValue = applyPathAttenuation(sampleValue, pathAttenuationDb);
      float echoMask = getReflectivityEchoMask(sampleValue);
      if (echoMask <= 0.0)
        continue;

      float score = getReflectivityDbz(sampleValue);
      if (score > bestScore) {
        bestScore = score;
        bestSample = sampleValue;
      }
    }

    fragmentColor = bestScore > -1e19 ? vec4(max(bestSample.r, 0.0), 0.0, 0.0, 1.0) : vec4(0.0);
    return;
  }

  float bestQuality = 0.0;

  for (int i = 0; i < 16; i++) {
    if (i >= radarCount)
      break;

    float rangeKm;
    float rangeBinKm;
    float angleRad;
    float beamWidthRad;
    float rangeBin;
    float beamBin;

    if (!getPolarSample(i, rangeKm, rangeBinKm, angleRad, beamWidthRad, rangeBin, beamBin))
      continue;

    vec4 sampleValue = samplePolarBinReflectivity(i, rangeBin, beamBin, rangeBinKm, beamWidthRad);
    float pathAttenuationDb = getPathAttenuationDb(i, rangeKm, rangeBinKm, angleRad, radarParams[i].y);
    sampleValue = applyPathAttenuation(sampleValue, pathAttenuationDb);
    float reliability = getReflectivityEchoMask(sampleValue);
    if (reliability <= 0.0)
      continue;

    float quality = getCompositeRadarQuality(rangeKm, rangeBinKm, beamWidthRad, radarSites[i].z, radarParams[i].y, reliability, pathAttenuationDb);
    bestQuality = max(bestQuality, quality);
  }

  if (bestQuality <= 0.0) {
    fragmentColor = vec4(0.0);
    return;
  }

  vec4 weightedSample = vec4(0.0);
  float totalWeight = 0.0;
  float qualityCutoff = bestQuality * 0.40;

  for (int i = 0; i < 16; i++) {
    if (i >= radarCount)
      break;

    float rangeKm;
    float rangeBinKm;
    float angleRad;
    float beamWidthRad;
    float rangeBin;
    float beamBin;

    if (!getPolarSample(i, rangeKm, rangeBinKm, angleRad, beamWidthRad, rangeBin, beamBin))
      continue;

    vec4 sampleValue = samplePolarBinReflectivity(i, rangeBin, beamBin, rangeBinKm, beamWidthRad);
    float pathAttenuationDb = getPathAttenuationDb(i, rangeKm, rangeBinKm, angleRad, radarParams[i].y);
    sampleValue = applyPathAttenuation(sampleValue, pathAttenuationDb);
    float reliability = getReflectivityEchoMask(sampleValue);
    if (reliability <= 0.0)
      continue;

    float quality = getCompositeRadarQuality(rangeKm, rangeBinKm, beamWidthRad, radarSites[i].z, radarParams[i].y, reliability, pathAttenuationDb);
    if (quality < qualityCutoff)
      continue;

    weightedSample += sampleValue * quality;
    totalWeight += quality;
  }

  fragmentColor = totalWeight > 0.0 ? vec4(max((weightedSample / totalWeight).r, 0.0), 0.0, 0.0, 1.0) : vec4(0.0);
}
