#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform sampler2D productTex;
uniform sampler2D previousProductTex;
uniform sampler2D radarPaletteTex;
uniform isampler2D wallTex;

uniform int productMode; // 0 reflectivity, 1 rhohv, 2 zdr
uniform bool productOpaque;
uniform float productAlpha;
uniform float reflMult;
uniform float reflBoost;
uniform vec2 radarPaletteRange;
uniform float radarPaletteRowCenter;
uniform float simHeightKm;
uniform bool wrapHorizontally;
uniform bool compositeMode;
uniform bool attenuationEnabled;
uniform bool sweepRevealEnabled;
uniform float sweepProgress;
uniform float compositePixelSize;
uniform int radarCount;
uniform vec4 radarSites[16];  // x, y, rangeKm, binKm
uniform vec4 radarParams[16]; // beamWidthDeg, attenuation, refreshSec, unused

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "commonDisplay.glsl"

#define TAU 6.28318530717958647692
#define ATTENUATION_STEPS 12

vec4 sampleRadarPalette(float value)
{
  float paletteSpan = max(radarPaletteRange.y - radarPaletteRange.x, 1e-6);
  float paletteU = clamp((value - radarPaletteRange.x) / paletteSpan, 0.0, 1.0);
  return texture(radarPaletteTex, vec2(paletteU, radarPaletteRowCenter));
}

float wrapDeltaX(float dx)
{
  return dx - floor(dx + 0.5);
}

bool isBeamRevealedBySweep(float angleRad)
{
  if (!sweepRevealEnabled)
    return true;

  float normalizedAngle = mod(angleRad, TAU);
  if (normalizedAngle > PI)
    return false;

  float upperHalfAngle = normalizedAngle;
  float clockwiseSweepAngle = PI * (1.0 - clamp(sweepProgress, 0.0, 1.0));
  return upperHalfAngle >= clockwiseSweepAngle;
}

vec4 sampleRadarProduct(vec2 sampleCoord, float angleRad)
{
  if (isBeamRevealedBySweep(angleRad))
    return texture(productTex, sampleCoord);
  return texture(previousProductTex, sampleCoord);
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

vec2 getCompositeSampleCoord()
{
  if (!compositeMode)
    return texCoord;

  float pixelSize = max(compositePixelSize, 1.0);
  vec2 productGrid = max(floor(resolution / pixelSize), vec2(1.0));
  vec2 gridCell = clamp(floor(texCoord * productGrid), vec2(0.0), productGrid - vec2(1.0));
  vec2 coord = (gridCell + vec2(0.5)) / productGrid;
  if (wrapHorizontally)
    coord.x = fract(coord.x);
  return coord;
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
  return wall.y != 0;
}

bool getPolarSample(int siteIndex, out vec2 sampleCoord, out float rangeKm, out float rangeBinKm, out float angleRad, out float beamWidthRad)
{
  vec4 site = radarSites[siteIndex];
  vec4 params = radarParams[siteIndex];
  vec2 currentCoord = getCompositeSampleCoord();

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

  float rangeBin = floor(rangeKm / rangeBinKm);
  float beamBin = floor(angleRad / beamWidthRad);
  float sampleRangeKm = (rangeBin + 0.5) * rangeBinKm;
  float sampleAngle = min((beamBin + 0.5) * beamWidthRad, PI);
  angleRad = sampleAngle;
  return getRadarSampleCoord(siteIndex, sampleRangeKm, sampleAngle, sampleCoord);
}

float getPathAttenuationDb(int siteIndex, float rangeKm, float rangeBinKm, float angleRad, float radarAttenuation)
{
  if (!attenuationEnabled || productMode != 0 || radarAttenuation <= 0.0)
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

    vec4 blockerSample = sampleRadarProduct(blockerCoord, angleRad);
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
  if (!attenuationEnabled || productMode != 0 || attenuationDb <= 0.0)
    return sampleValue;

  float zRaw = getReflectivityRaw(sampleValue);
  if (zRaw <= 0.0)
    return sampleValue;

  float attenuatedRaw = zRaw * exp(-attenuationDb / 4.3429448);
  sampleValue.r = getReflectivityLinearFromRaw(attenuatedRaw);
  return sampleValue;
}

bool colorFromProduct(vec4 sampleValue, out vec4 color, out float score)
{
  if (productMode == 0) {
    float echoMask = getReflectivityEchoMask(sampleValue);
    if (echoMask <= 0.0)
      return false;

    float dBZ = getReflectivityDbz(sampleValue);
    float alpha = productOpaque ? 1.0 : clamp((dBZ - 5.0) / 30.0, 0.0, 0.60);
    vec4 paletteSample = sampleRadarPalette(dBZ);
    color = vec4(paletteSample.rgb, alpha * echoMask * paletteSample.a);
    score = dBZ;
    return true;
  }

  if (sampleValue.a <= 0.0)
    return false;

  if (productMode == 1) {
    float rho = clamp(sampleValue.r, radarPaletteRange.x, radarPaletteRange.y);
    vec4 paletteSample = sampleRadarPalette(rho);
    color = vec4(paletteSample.rgb, (productOpaque ? 1.0 : productAlpha) * paletteSample.a);
    score = sampleValue.a + rho * 0.001;
    return true;
  }

  float zdr = clamp(sampleValue.r, radarPaletteRange.x, radarPaletteRange.y);
  vec4 paletteSample = sampleRadarPalette(zdr);
  color = vec4(paletteSample.rgb, (productOpaque ? 1.0 : productAlpha) * paletteSample.a);
  score = sampleValue.a + abs(zdr) * 0.001;
  return true;
}

bool getProductSignal(vec4 sampleValue, out float score, out float reliability)
{
  if (productMode == 0) {
    float echoMask = getReflectivityEchoMask(sampleValue);
    if (echoMask <= 0.0)
      return false;

    score = getReflectivityDbz(sampleValue);
    reliability = echoMask;
    return true;
  }

  if (sampleValue.a <= 0.0)
    return false;

  reliability = clamp(sampleValue.a, 0.0, 1.0);
  if (productMode == 1) {
    score = sampleValue.a + clamp(sampleValue.r, radarPaletteRange.x, radarPaletteRange.y) * 0.001;
    return true;
  }

  score = sampleValue.a + abs(clamp(sampleValue.r, radarPaletteRange.x, radarPaletteRange.y)) * 0.001;
  return true;
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
  if (compositeMode) {
    float bestQuality = 0.0;

    for (int i = 0; i < 16; i++) {
      if (i >= radarCount)
        break;

      vec2 sampleCoord;
      float rangeKm;
      float rangeBinKm;
      float angleRad;
      float beamWidthRad;

      if (!getPolarSample(i, sampleCoord, rangeKm, rangeBinKm, angleRad, beamWidthRad))
        continue;

      vec4 sampleValue = sampleRadarProduct(sampleCoord, angleRad);
      float pathAttenuationDb = getPathAttenuationDb(i, rangeKm, rangeBinKm, angleRad, radarParams[i].y);
      sampleValue = applyPathAttenuation(sampleValue, pathAttenuationDb);
      float productScore;
      float reliability;
      if (!getProductSignal(sampleValue, productScore, reliability))
        continue;

      float quality = getCompositeRadarQuality(rangeKm, rangeBinKm, beamWidthRad, radarSites[i].z, radarParams[i].y, reliability, pathAttenuationDb);
      bestQuality = max(bestQuality, quality);
    }

    if (bestQuality <= 0.0)
      discard;

    vec4 weightedSample = vec4(0.0);
    float totalWeight = 0.0;
    float qualityCutoff = bestQuality * 0.40;

    for (int i = 0; i < 16; i++) {
      if (i >= radarCount)
        break;

      vec2 sampleCoord;
      float rangeKm;
      float rangeBinKm;
      float angleRad;
      float beamWidthRad;

      if (!getPolarSample(i, sampleCoord, rangeKm, rangeBinKm, angleRad, beamWidthRad))
        continue;

      vec4 sampleValue = sampleRadarProduct(sampleCoord, angleRad);
      float pathAttenuationDb = getPathAttenuationDb(i, rangeKm, rangeBinKm, angleRad, radarParams[i].y);
      sampleValue = applyPathAttenuation(sampleValue, pathAttenuationDb);
      float productScore;
      float reliability;
      if (!getProductSignal(sampleValue, productScore, reliability))
        continue;

      float quality = getCompositeRadarQuality(rangeKm, rangeBinKm, beamWidthRad, radarSites[i].z, radarParams[i].y, reliability, pathAttenuationDb);
      if (quality < qualityCutoff)
        continue;

      weightedSample += sampleValue * quality;
      totalWeight += quality;
    }

    if (totalWeight <= 0.0)
      discard;

    vec4 productColor;
    float productScore;
    if (!colorFromProduct(weightedSample / totalWeight, productColor, productScore))
      discard;

    fragmentColor = productColor;
    drawCursor(cursor, view);
    return;
  }

  vec4 bestColor = vec4(0.0);
  float bestScore = -1e20;

  for (int i = 0; i < 16; i++) {
    if (i >= radarCount)
      break;

    vec2 sampleCoord;
    float rangeKm;
    float rangeBinKm;
    float angleRad;
    float beamWidthRad;

    if (!getPolarSample(i, sampleCoord, rangeKm, rangeBinKm, angleRad, beamWidthRad))
      continue;

    vec4 sampleValue = sampleRadarProduct(sampleCoord, angleRad);
    float pathAttenuationDb = getPathAttenuationDb(i, rangeKm, rangeBinKm, angleRad, radarParams[i].y);
    sampleValue = applyPathAttenuation(sampleValue, pathAttenuationDb);
    vec4 productColor;
    float productScore;
    if (!colorFromProduct(sampleValue, productColor, productScore))
      continue;

    if (productScore > bestScore) {
      bestScore = productScore;
      bestColor = productColor;
    }
  }

  if (bestScore <= -1e19) {
    discard;
  }

  fragmentColor = bestColor;
  drawCursor(cursor, view);
}
