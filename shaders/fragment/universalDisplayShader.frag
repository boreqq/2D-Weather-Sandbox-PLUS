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
uniform isampler2D wallTex;

uniform int quantityIndex; // which quantity to display
uniform float dispMultiplier;
uniform bool reflectivityMode;
uniform float reflMult;
uniform float reflBoost;
uniform float reflPixelSize; // >=1; 1 = no pixelation
uniform bool reflBackground; // true = opaque overwrite, false = overlay (alpha honored)
uniform int radarProduct; // 0 reflectivity, 1 rhohv

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "commonDisplay.glsl"

vec3 radarColor(float dBZ)
{
  // NEXRAD-like palette provided by user (dBZ breakpoints)
  // pairs: threshold -> RGB (0-255)
  const int n = 13;
  float levels[n] = float[n](
    -15.0, 5.0, 17.5, 22.5, 32.5, 37.5, 42.5, 50.0, 60.0, 70.0, 75.0, 80.0, 85.0
  );
  vec3 cols[n] = vec3[n](
    vec3(0, 0, 0) / 255.0,          // -15
    vec3(29, 37, 60) / 255.0,       // 5
    vec3(89, 155, 171) / 255.0,     // 17.5
    vec3(33, 186, 72) / 255.0,      // 22.5
    vec3(5, 101, 1) / 255.0,        // 32.5
    vec3(251, 252, 0) / 255.0,      // 37.5 (first triplet from line)
    vec3(253, 149, 2) / 255.0,      // 42.5
    vec3(253, 38, 0) / 255.0,       // 50
    vec3(193, 148, 179) / 255.0,    // 60
    vec3(165, 2, 215) / 255.0,      // 70
    vec3(135, 255, 253) / 255.0,    // 75
    vec3(173, 99, 64) / 255.0,      // 80
    vec3(105, 0, 4) / 255.0         // 85
  );

  // note: input had extra multi-stop entries at some thresholds; we interpret sequential stops via interpolation.
  dBZ = clamp(dBZ, levels[0], 95.0);

  for (int i = 1; i < n; i++) {
    if (dBZ <= levels[i]) {
      float t = (dBZ - levels[i - 1]) / (levels[i] - levels[i - 1]);
      return mix(cols[i - 1], cols[i], t);
    }
  }

  // above last defined level (85..95), fade to black
  float t = clamp((dBZ - 85.0) / 10.0, 0.0, 1.0);
  return mix(vec3(105, 0, 4) / 255.0, vec3(0, 0, 0), t);
}

vec3 rhoColor(float rho)
{
  // Palette from spec (levels with RGB):
  // 1.05:(164,54,150) 1.00:(255,180,215) 0.99:(139,30,77)
  // 0.97:(225,3,0) 0.95:(255,140,0) 0.90:(255,255,0)
  // 0.85:(135,215,10) 0.80:(95,245,100) 0.75:(120,120,255)
  // 0.60:(10,10,190) 0.45:(15,15,140) 0.00:(15,15,140)
  const int n = 12;
  float levels[n] = float[n](1.05, 1.00, 0.99, 0.97, 0.95, 0.90, 0.85, 0.80, 0.75, 0.60, 0.45, 0.00);
  vec3 cols[n] = vec3[n](
    vec3(164, 54, 150) / 255.0,
    vec3(255, 180, 215) / 255.0,
    vec3(139, 30, 77) / 255.0,
    vec3(225, 3, 0) / 255.0,
    vec3(255, 140, 0) / 255.0,
    vec3(255, 255, 0) / 255.0,
    vec3(135, 215, 10) / 255.0,
    vec3(95, 245, 100) / 255.0,
    vec3(120, 120, 255) / 255.0,
    vec3(10, 10, 190) / 255.0,
    vec3(15, 15, 140) / 255.0,
    vec3(15, 15, 140) / 255.0
  );

  rho = clamp(rho, levels[n - 1], levels[0]);
  for (int i = 1; i < n; i++) {
    if (rho >= levels[i]) { // levels are descending
      float t = (rho - levels[i]) / (levels[i - 1] - levels[i]);
      return mix(cols[i], cols[i - 1], t);
    }
  }
  return cols[n - 1];
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
      fragmentColor = vec4(radarColor(dBZ), alpha);
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
        fragmentColor = vec4(rhoColor(1.0), alpha);
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

      // RGB colormap by rho uses user palette (rhoColor), alpha for smooth transition
      float rhoAlpha = clamp(alpha + 0.15, 0.35, 0.9);
      fragmentColor = vec4(rhoColor(rho), rhoAlpha);
    }
  } else if (val > 0.0) {
    fragmentColor = vec4(1.0, 1.0 - val, 1.0 - val, 1.0);
  } else {
    fragmentColor = vec4(1.0 + val, 1.0 + val, 1.0, 1.0);
  }
  drawCursor(cursor, view);
}
