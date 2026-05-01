#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform sampler2D zdrTex;
uniform sampler2D radarPaletteTex;
uniform float productAlpha;
uniform bool productOpaque;
uniform float binSize;
uniform float radarRefreshTick;
uniform vec2 radarPaletteRange;
uniform float radarPaletteRowCenter;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "commonDisplay.glsl"

float zdrRand2(vec2 p)
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
  vec2 sampleCoord = texCoord;
  int bin = max(int(floor(binSize + 0.5)), 1);
  if (binSize > 1.0) {
    vec2 grid = resolution / max(binSize, 1.0);
    sampleCoord = floor(texCoord * grid) / grid;
  }
  vec2 binCoord = floor(texCoord * resolution / float(bin));
  float timeBucket = floor(radarRefreshTick);

  vec4 zdrSample = texture(zdrTex, sampleCoord);
  if (zdrSample.a <= 0.0)
    discard;

  float zdr = zdrSample.r;
  float confidence = clamp(zdrSample.g, 0.0, 1.0);
  float supportDbz = zdrSample.b;
  float alpha = productOpaque ? 1.0 : productAlpha;

  float edgeInside = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      if (dx == 0 && dy == 0)
        continue;

      vec2 neighborUv = sampleCoord + vec2(float(dx * bin), float(dy * bin)) * texelSize;
      if (neighborUv.x < 0.0 || neighborUv.x > 1.0 || neighborUv.y < 0.0 || neighborUv.y > 1.0) {
        edgeInside = 1.0;
        continue;
      }

      vec4 neighbor = texture(zdrTex, neighborUv);
      if (neighbor.a <= 0.0)
        edgeInside = 1.0;
    }
  }

  float weakEcho = 1.0 - clamp((supportDbz - 18.0) / 28.0, 0.0, 1.0);
  float lowConfidence = 1.0 - confidence;
  float noiseStrength = clamp(lowConfidence * 0.50 + weakEcho * 0.28 + edgeInside * 0.22, 0.0, 1.0);

  float blockNoise = (zdrRand2(binCoord + vec2(11.7, 29.4) + vec2(timeBucket * 0.93, timeBucket * 0.37)) - 0.5) *
                     mix(0.08, 0.42, noiseStrength);
  float fineNoise = (zdrRand2(binCoord * 2.0 + vec2(41.2, 83.1) + vec2(timeBucket * 1.17, timeBucket * 0.71)) - 0.5) *
                    mix(0.03, 0.14, noiseStrength);
  zdr += blockNoise + fineNoise;

  if (edgeInside > 0.0) {
    float rimCluster = zdrRand2(floor(binCoord * 0.75) + vec2(5.2, 18.6) + vec2(timeBucket * 0.11, timeBucket * 0.09));
    float rimNoise = (zdrRand2(binCoord + vec2(27.4, 63.8) + vec2(timeBucket * 0.69, timeBucket * 0.49)) - 0.5) *
                     mix(0.10, 0.28, rimCluster);
    zdr += rimNoise;
  }

  zdr = clamp(zdr, radarPaletteRange.x, radarPaletteRange.y);
  vec4 paletteSample = sampleRadarPalette(zdr);
  fragmentColor = vec4(paletteSample.rgb, alpha * paletteSample.a);
  drawCursor(cursor, view);
}
