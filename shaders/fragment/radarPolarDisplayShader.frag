#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform sampler2D productTex;
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
uniform float compositePixelSize;
uniform int radarCount;
uniform vec4 radarSites[16];  // x, y, rangeKm, binKm
uniform vec4 radarParams[16]; // beamWidthDeg, attenuation, refreshSec, unused

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "commonDisplay.glsl"

#define TAU 6.28318530717958647692

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
  float sampleAngle = (beamBin + 0.5) * beamWidthRad;
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

bool colorFromProduct(vec4 sampleValue, out vec4 color, out float score)
{
  if (productMode == 0) {
    float zhLinear = max(sampleValue.r, 0.0);
    float zRaw = sqrt(zhLinear) * reflMult + zhLinear * reflBoost;
    float echoMask = smoothstep(0.00005, 0.00150, zRaw);
    if (echoMask <= 0.0)
      return false;

    float dBZ = 4.3429448 * log(zRaw + 1e-6);
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
    float zhLinear = max(sampleValue.r, 0.0);
    float zRaw = sqrt(zhLinear) * reflMult + zhLinear * reflBoost;
    float echoMask = smoothstep(0.00005, 0.00150, zRaw);
    if (echoMask <= 0.0)
      return false;

    score = 4.3429448 * log(zRaw + 1e-6);
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

float getCompositeRadarQuality(float rangeKm, float rangeBinKm, float beamWidthRad, float maxRangeKm, float attenuation, float reliability)
{
  float rangeNorm = clamp(rangeKm / max(maxRangeKm, 0.01), 0.0, 1.0);
  float edgeScore = 1.0 - smoothstep(0.82, 1.0, rangeNorm);
  float rangeScore = mix(1.0, 0.45, rangeNorm);
  float effectiveBinKm = max(max(rangeBinKm, rangeKm * beamWidthRad), 0.05);
  float resolutionScore = 1.0 / pow(effectiveBinKm, 1.15);
  float attenuationScore = 1.0 / (1.0 + max(attenuation, 0.0) * rangeNorm * rangeNorm * 0.12);
  return reliability * edgeScore * rangeScore * resolutionScore * attenuationScore;
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

      vec4 sampleValue = texture(productTex, sampleCoord);
      float productScore;
      float reliability;
      if (!getProductSignal(sampleValue, productScore, reliability))
        continue;

      float quality = getCompositeRadarQuality(rangeKm, rangeBinKm, beamWidthRad, radarSites[i].z, radarParams[i].y, reliability);
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

      vec4 sampleValue = texture(productTex, sampleCoord);
      float productScore;
      float reliability;
      if (!getProductSignal(sampleValue, productScore, reliability))
        continue;

      float quality = getCompositeRadarQuality(rangeKm, rangeBinKm, beamWidthRad, radarSites[i].z, radarParams[i].y, reliability);
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

    vec4 sampleValue = texture(productTex, sampleCoord);
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
