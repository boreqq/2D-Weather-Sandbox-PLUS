#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform sampler2D anyTex; // can be any RGBW32F texture
uniform sampler2D snapshotTex; // cached radar moments for radar-like sweep
uniform sampler2D phaseTex;    // cached liquid/ice split for rhohv
uniform sampler2D phaseStatsTex; // cached density sums/sumsq/count
uniform sampler2D radarMomentsTex; // cached Zh/Zv/sumHV/count from precipitation accumulation
uniform sampler2D radarPaletteTex;
uniform isampler2D wallTex;

uniform int quantityIndex; // which quantity to display
uniform float dispMultiplier;
uniform bool reflectivityMode;
uniform float reflMult;
uniform float reflBoost;
uniform float reflPixelSize; // >=1; 1 = no pixelation
uniform bool reflBackground; // true = opaque overwrite, false = overlay (alpha honored)
uniform int radarProduct; // 0 DBZH, 1 rhohv, 2 VIL, 3 VILD, 4 EHT
uniform vec2 radarPaletteRange;
uniform float radarPaletteRowCenter;
uniform float simHeightKm;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "commonDisplay.glsl"

vec4 sampleRadarPalette(float value)
{
  float paletteSpan = max(radarPaletteRange.y - radarPaletteRange.x, 1e-6);
  float paletteU = clamp((value - radarPaletteRange.x) / paletteSpan, 0.0, 1.0);
  return texture(radarPaletteTex, vec2(paletteU, radarPaletteRowCenter));
}

void main()
{
  vec2 sampleCoord = texCoord;
  float effectivePixelSize = reflPixelSize;
  if (reflectivityMode && radarProduct == 1) {
    effectivePixelSize = max(reflPixelSize * 1.5, 1.0); // CC uses a slightly bigger sprite footprint
  }
  if (reflectivityMode && effectivePixelSize > 1.0) {
    vec2 grid = resolution / effectivePixelSize;         // snap in sim-cell space
    sampleCoord = floor(texCoord * grid) / grid;         // larger blocks for CC
  }

  vec4 cell = reflectivityMode ? texture(snapshotTex, sampleCoord) : texture(anyTex, sampleCoord);
  ivec2 wall = texture(wallTex, sampleCoord).xy;

  float val = cell[quantityIndex] * dispMultiplier;

  if (wall[1] == 0 && !reflectivityMode) {  // is wall
    switch (wall[0]) { // wall type
    case 0:
      fragmentColor = vec4(0, 0, 0, 1);
      break;
    case 1: // land wall
      fragmentColor = vec4(vec3(0.10), 1.0);
      break;
    case 2: // water wall
      fragmentColor = vec4(0, 0.5, 0.99, 1);
      break;
    case 3: // Fire wall
      fragmentColor = vec4(1.0, 0.5, 0.0, 1);
      break;
    }
  } else if (reflectivityMode) {
    if (radarProduct == 2 || radarProduct == 3 || radarProduct == 4) {
      float echoTopKm = max(cell.r, 0.0);
      float productValue = radarProduct == 2 ? max(cell.g, 0.0) : (radarProduct == 3 ? max(cell.b, 0.0) : echoTopKm);
      float valid = clamp(cell.a, 0.0, 1.0);
      float altitudeKm = texCoord.y * simHeightKm;
      if (valid <= 0.0 || wall[1] == 0 || altitudeKm > echoTopKm)
        discard;

      float alpha = reflBackground ? 1.0 : 0.68 * valid;
      vec4 paletteSample = sampleRadarPalette(productValue);
      fragmentColor = vec4(paletteSample.rgb, alpha * paletteSample.a);
      drawCursor(cursor, view);
      return;
    }

    // bulk pseudo-reflectivity or rhohv using cached radar moments
    float zhLinear = max(cell.r, 0.0);
    float p = sqrt(zhLinear);
    float z_raw = p * reflMult + zhLinear * reflBoost;
    float echoMask = smoothstep(0.00005, 0.00150, z_raw);
    if (echoMask <= 0.0 || wall[1] == 0)
      discard; // keep background/terrain transparent

    float dBZ = 4.3429448 * log(z_raw + 1e-6); // 10*log10(x)
    float alpha = reflBackground ? 1.0 : clamp((dBZ - 5.0) / 30.0, 0.0, 0.60);
    alpha *= echoMask;

    if (radarProduct == 0) {
      vec4 paletteSample = sampleRadarPalette(dBZ);
      fragmentColor = vec4(paletteSample.rgb, alpha * paletteSample.a);
    } else {
      vec4 phase = texture(phaseTex, sampleCoord);
      vec4 stats = texture(phaseStatsTex, sampleCoord);
      float liquid = max(phase.r, 0.0);
      float ice = max(phase.g, 0.0);
      float count = max(stats.b, 1e-6); // count stored in B of stats
      float densMean = stats.r / count; // density sum / count
      float densVar = max(stats.g / count - densMean * densMean, 0.0); // E[x^2]-mu^2
      float densCV = sqrt(densVar) / max(densMean, 1e-6);

      float phaseMix = ice / max(liquid + ice, 1e-6);
      // ignore sparse/noisy bins or very weak echoes
      if (zhLinear < 1e-6 || count < 3.0 || dBZ < 20.0) {
        vec4 paletteSample = sampleRadarPalette(1.0);
        fragmentColor = vec4(paletteSample.rgb, alpha * paletteSample.a);
        return;
      }

      // heterogeneity penalty only for substantial mix (35–65% ice share)
      float hetero = 0.0;
      if (phaseMix > 0.35 && phaseMix < 0.65) {
        hetero = phaseMix * (1.0 - phaseMix); // 0..0.25
      }

      // coefficient of variation of density captures size/phase diversity
      float cvPenalty = densCV * densCV; // variance proxy
      float rhoDensity = clamp(exp(-1.2 * cvPenalty) - 0.15 * hetero, 0.6, 1.05);

      // add radar moment component (Zh/Zv ratio) for CC behavior
      vec4 moments = texture(radarMomentsTex, sampleCoord);
      float zhMoment = max(moments.r, 1e-6);
      float zvMoment = max(moments.g, 1e-6);
      float zvzhRatio = clamp(zvMoment / zhMoment, 0.50, 0.98);
      float rhoRadar = mix(0.75, 1.02, smoothstep(0.55, 0.95, zvzhRatio));

      // balanced blend - both contributions matter for better sprite coherence
      float rho = mix(rhoDensity, rhoRadar, 0.45);
      rho = mix(rho, pow(rho, 0.91), 0.10);
      rho = clamp(rho, 0.6, 1.05);

      float rhoAlpha = clamp(alpha + 0.15, 0.35, 0.9);
      vec4 paletteSample = sampleRadarPalette(rho);
      fragmentColor = vec4(paletteSample.rgb, rhoAlpha * paletteSample.a);
    }
  } else if (val > 0.0) {
    fragmentColor = vec4(1.0, 1.0 - val, 1.0 - val, 1.0);
  } else {
    fragmentColor = vec4(1.0 + val, 1.0 + val, 1.0, 1.0);
  }
  drawCursor(cursor, view);
}
