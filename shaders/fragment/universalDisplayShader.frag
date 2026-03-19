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
uniform isampler2D wallTex;

uniform int quantityIndex; // wich quantity to display
uniform float dispMultiplier;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "commonDisplay.glsl"

void main()
{
  vec4 cell = texture(anyTex, texCoord);
  ivec2 wall = texture(wallTex, texCoord).xy;

  float val = cell[quantityIndex] * dispMultiplier;

  if (wall[1] == 0) {  // is wall
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

      float mix = ice / max(liquid + ice, 1e-6);
      // ignore sparse/noisy bins or very weak echoes
      if (zhLinear < 1e-6 || count < 2.0 || dBZ < 25.0) {
        fragmentColor = vec4(rhoColor(1.0), alpha);
        return;
      }

      // heterogeneity penalty only for substantial mix (35–65% ice share)
      float hetero = 0.0;
      if (mix > 0.35 && mix < 0.65) {
        hetero = mix * (1.0 - mix); // 0..0.25
      }

      // coefficient of variation of density captures size/phase diversity
      float cvPenalty = densCV * densCV; // variance proxy

      float rho = exp(-1.2 * cvPenalty) - 0.15 * hetero;
      rho = clamp(rho, 0.6, 1.05);
      fragmentColor = vec4(rhoColor(rho), alpha);
    }
  } else if (val > 0.0) {
    fragmentColor = vec4(1.0, 1.0 - val, 1.0 - val, 1.0);
  } else {
    fragmentColor = vec4(1.0 + val, 1.0 + val, 1.0, 1.0);
  }
  drawCursor(cursor, view);
}