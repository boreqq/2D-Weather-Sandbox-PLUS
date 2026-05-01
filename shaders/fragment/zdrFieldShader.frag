#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform sampler2D radarMomentsTex;
uniform sampler2D reflectivityTex;
uniform isampler2D wallTex;
uniform float fillRadius;
uniform float supportDbzMin;
uniform float reflMult;
uniform float reflBoost;
uniform float dryLapse;

layout(location = 0) out vec4 fragmentColor;

#include "common.glsl"

#define MAX_FILL_RADIUS 4

float calcDbz(float zhLinear)
{
  float zRaw = sqrt(max(zhLinear, 0.0)) * reflMult + max(zhLinear, 0.0) * reflBoost;
  return 4.3429448 * log(zRaw + 1e-6);
}

void main()
{
  ivec2 pixel = ivec2(clamp(floor(fragCoord), vec2(0.0), resolution - 1.0));
  ivec2 wall = texelFetch(wallTex, pixel, 0).xy;
  if (wall[DISTANCE] == 0) {
    fragmentColor = vec4(0.0);
    return;
  }

  float supportZh = max(texelFetch(reflectivityTex, pixel, 0).r, 0.0);
  float supportDbz = calcDbz(supportZh);
  if (supportDbz < supportDbzMin) {
    fragmentColor = vec4(0.0);
    return;
  }

  int radius = clamp(int(floor(fillRadius + 0.5)), 0, MAX_FILL_RADIUS);

  float sumZh = 0.0;
  float sumZv = 0.0;
  float contributors = 0.0;

  for (int dy = -MAX_FILL_RADIUS; dy <= MAX_FILL_RADIUS; dy++) {
    if (abs(dy) > radius)
      continue;

    for (int dx = -MAX_FILL_RADIUS; dx <= MAX_FILL_RADIUS; dx++) {
      if (abs(dx) > radius)
        continue;

      ivec2 cell = pixel + ivec2(dx, dy);
      if (cell.x < 0 || cell.y < 0 || cell.x >= int(resolution.x) || cell.y >= int(resolution.y))
        continue;

      ivec2 wallCell = texelFetch(wallTex, cell, 0).xy;
      if (wallCell[DISTANCE] == 0)
        continue;

      vec4 moments = texelFetch(radarMomentsTex, cell, 0);
      float zh = max(moments.r, 0.0);
      float zv = max(moments.g, 0.0);
      float count = max(moments.a, 0.0);
      float signal = max(zh, zv);
      if (signal <= 1e-10 || count <= 0.0)
        continue;

      sumZh += zh;
      sumZv += zv;
      contributors += 1.0;
    }
  }

  if (contributors <= 0.0 || sumZh <= 0.0 || sumZv <= 0.0) {
    fragmentColor = vec4(0.0);
    return;
  }

  float zdrDb = 4.3429448 * log((sumZh + 1e-6) / (sumZv + 1e-6));
  zdrDb = clamp(zdrDb, -3.0, 7.0);
  float confidence = clamp((contributors - 1.0) / 8.0, 0.0, 1.0);

  fragmentColor = vec4(zdrDb, confidence, supportDbz, 1.0);
}
