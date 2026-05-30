#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform sampler2D rhohvTex;
uniform sampler2D radarPaletteTex;
uniform float productAlpha;
uniform bool productOpaque;
uniform float binSize;
uniform float radarRefreshTick;
uniform bool showLowCCArtifacts;
uniform bool showRandomNoise;
uniform float clutterDensity;
uniform vec2 radarPaletteRange;
uniform float radarPaletteRowCenter;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "commonDisplay.glsl"

#define EDGE_BIN_RADIUS 3

float rhohvRand2(vec2 p)
{
  float dt = dot(p, vec2(12.9898, 78.233));
  return fract(sin(mod(dt, 3.14)) * 43758.5453123);
}

vec4 sampleRadarPalette(float value)
{
  float paletteSpan = max(radarPaletteRange.y - radarPaletteRange.x, 1e-6);
  float paletteU = clamp((value - radarPaletteRange.x) / paletteSpan, 0.0, 1.0);
  return texture(radarPaletteTex, vec2(paletteU, radarPaletteRowCenter));
}

void main()
{
  vec4 rhoSample = texture(rhohvTex, texCoord);
  int bin = max(int(floor(binSize + 0.5)), 1);
  vec2 binCoord = floor(texCoord * resolution / float(bin));
  float timeBucket = floor(radarRefreshTick);

  float rho = rhoSample.r;
  float alpha = productOpaque ? 1.0 : productAlpha;

  if (rhoSample.a <= 0.0) {
    if (!showLowCCArtifacts)
      discard;

    float nearestValid = float(EDGE_BIN_RADIUS + 1);
    float neighborInfluence = 0.0;

    for (int dy = -EDGE_BIN_RADIUS; dy <= EDGE_BIN_RADIUS; dy++) {
      for (int dx = -EDGE_BIN_RADIUS; dx <= EDGE_BIN_RADIUS; dx++) {
        int ring = max(abs(dx), abs(dy));
        if (ring == 0 || ring > EDGE_BIN_RADIUS)
          continue;

        vec2 neighborUv = texCoord + vec2(float(dx * bin), float(dy * bin)) * texelSize;
        if (neighborUv.x < 0.0 || neighborUv.x > 1.0 || neighborUv.y < 0.0 || neighborUv.y > 1.0)
          continue;

        vec4 neighbor = texture(rhohvTex, neighborUv);
        if (neighbor.a > 0.0) {
          nearestValid = min(nearestValid, float(ring));
          neighborInfluence += 1.0 / float(ring);
        }
      }
    }

    if (nearestValid > float(EDGE_BIN_RADIUS))
      discard;

    float edgeWeight = clamp((float(EDGE_BIN_RADIUS + 1) - nearestValid) / float(EDGE_BIN_RADIUS), 0.0, 1.0);
    float neighborDensity = clamp(neighborInfluence / 4.5, 0.0, 1.0);
    float cluster = rhohvRand2(floor(binCoord * 0.5) + vec2(31.7, 7.9) + vec2(timeBucket * 0.21, timeBucket * 0.13));
    float speckle = rhohvRand2(binCoord + vec2(17.3, 41.7) + vec2(timeBucket * 0.87, timeBucket * 0.61));
    float coverage = mix(0.20, 0.56, edgeWeight) * mix(0.95, 1.35, neighborDensity) * mix(0.85, 1.30, cluster);
    coverage = clamp(coverage * clutterDensity, 0.0, 0.95);
    if (speckle > coverage)
      discard;

    float tintJitter = rhohvRand2(binCoord + vec2(73.1, 9.4) + vec2(timeBucket * 0.43, timeBucket * 0.57));
    rho = mix(0.46, 0.70, tintJitter) + (1.0 - edgeWeight) * 0.03;
    rho = clamp(rho, 0.42, 0.76);
    alpha = productOpaque ? 1.0 : productAlpha;
    vec4 paletteSample = sampleRadarPalette(rho);
    fragmentColor = vec4(paletteSample.rgb, alpha * paletteSample.a);
    drawCursor(cursor, view);
    return;
  }

  float edgeInside = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0)
        continue;

      vec2 neighborUv = texCoord + vec2(float(dx * bin), float(dy * bin)) * texelSize;
      if (neighborUv.x < 0.0 || neighborUv.x > 1.0 || neighborUv.y < 0.0 || neighborUv.y > 1.0) {
        edgeInside = 1.0;
        continue;
      }

      vec4 neighbor = texture(rhohvTex, neighborUv);
      if (neighbor.a <= 0.0)
        edgeInside = 1.0;
    }
  }

  if (edgeInside > 0.0 && showRandomNoise) {
    float rimCluster = rhohvRand2(floor(binCoord * 0.75) + vec2(5.2, 18.6) + vec2(timeBucket * 0.11, timeBucket * 0.09));
    float rimSpeckle = rhohvRand2(binCoord + vec2(27.4, 63.8) + vec2(timeBucket * 0.69, timeBucket * 0.49));
    float rimCoverage = mix(0.16, 0.34, rimCluster);
    if (rimSpeckle < rimCoverage)
      rho = min(rho + mix(0.010, 0.024, rimCluster), 1.03);
  }

  if (showRandomNoise) {
    float dynamicNoise = (rhohvRand2(binCoord + vec2(11.7, 29.4) + vec2(timeBucket * 0.93, timeBucket * 0.37)) - 0.5) * 0.010;
    float dynamicFine = (rhohvRand2(binCoord * 2.0 + vec2(41.2, 83.1) + vec2(timeBucket * 1.17, timeBucket * 0.71)) - 0.5) * 0.004;
    rho = clamp(rho + dynamicNoise + dynamicFine, 0.0, 1.05);
  }

  vec4 paletteSample = sampleRadarPalette(rho);
  fragmentColor = vec4(paletteSample.rgb, alpha * paletteSample.a);
  drawCursor(cursor, view);
}
