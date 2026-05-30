#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform sampler2D radarMomentsTex;
uniform sampler2D phaseStatsTex;
uniform sampler2D sizeStatsTex;
uniform isampler2D wallTex;
uniform float binSize;
uniform float dryLapse;

layout(location = 0) out vec4 fragmentColor;

#include "common.glsl"

#define MAX_BIN_SIZE 32

void main()
{
  ivec2 pixel = ivec2(clamp(floor(fragCoord), vec2(0.0), resolution - 1.0));
  ivec2 wall = texelFetch(wallTex, pixel, 0).xy;
  if (wall[DISTANCE] == 0) {
    fragmentColor = vec4(0.0);
    return;
  }

  int bin = clamp(int(floor(binSize + 0.5)), 1, MAX_BIN_SIZE);
  ivec2 binBase = (pixel / bin) * bin;

  float sumZh = 0.0;
  float sumZv = 0.0;
  float sumHV = 0.0;
  float count = 0.0;
  float rhoParticleSum = 0.0;
  float rhoParticleSqSum = 0.0;
  float irregularitySum = 0.0;
  float sizeSum = 0.0;
  float sizeSqSum = 0.0;
  float sizeWeightSum = 0.0;

  for (int oy = 0; oy < MAX_BIN_SIZE; oy++) {
    if (oy >= bin)
      break;
    for (int ox = 0; ox < MAX_BIN_SIZE; ox++) {
      if (ox >= bin)
        break;

      ivec2 cell = binBase + ivec2(ox, oy);
      if (cell.x >= int(resolution.x) || cell.y >= int(resolution.y))
        continue;

      ivec2 wallCell = texelFetch(wallTex, cell, 0).xy;
      if (wallCell[DISTANCE] == 0)
        continue;

      vec4 moments = texelFetch(radarMomentsTex, cell, 0);
      vec4 stats = texelFetch(phaseStatsTex, cell, 0);
      vec4 sizeStats = texelFetch(sizeStatsTex, cell, 0);
      sumZh += max(moments.r, 0.0);
      sumZv += max(moments.g, 0.0);
      sumHV += max(moments.b, 0.0);
      count += max(moments.a, 0.0);
      rhoParticleSum += max(stats.r, 0.0);
      rhoParticleSqSum += max(stats.g, 0.0);
      irregularitySum += max(stats.a, 0.0);
      sizeSum += max(sizeStats.r, 0.0);
      sizeSqSum += max(sizeStats.g, 0.0);
      sizeWeightSum += max(sizeStats.b, 0.0);
    }
  }

  float signal = max(sumZh, sumZv);
  if (signal <= 1e-8 || count <= 0.0) {
    fragmentColor = vec4(0.0);
    return;
  }

  float rhoPrecip = sumHV / sqrt(max(sumZh * sumZv, 1e-12));
  rhoPrecip = clamp(rhoPrecip, 0.0, 1.0);

  float safeCount = max(count, 1.0);
  float rhoParticleMean = rhoParticleSum / safeCount;
  float rhoParticleVar = max(rhoParticleSqSum / safeCount - rhoParticleMean * rhoParticleMean, 0.0);
  float rhoParticleStd = sqrt(rhoParticleVar);
  float irregularityMean = irregularitySum / safeCount;
  float safeSizeWeight = max(sizeWeightSum, 1e-6);
  float sizeMean = sizeSum / safeSizeWeight;
  float sizeVar = max(sizeSqSum / safeSizeWeight - sizeMean * sizeMean, 0.0);
  float sizeStd = sqrt(sizeVar);
  float sizeCv = sizeStd / max(sizeMean, 0.5);
  float sizeStatsConfidence = smoothstep(1e-4, 1e-2, sizeWeightSum);
  float sizeDiversityPenalty = smoothstep(0.45, 1.40, sizeCv) * 0.06 * sizeStatsConfidence;

  float rhoCore = clamp(rhoPrecip - rhoParticleStd * 0.10 - irregularityMean * 0.03 - sizeDiversityPenalty, 0.0, 1.0);

  float signalConfidence = smoothstep(2e-6, 3e-4, signal);
  float countConfidence = smoothstep(1.5, 4.5, count);
  float confidence = max(signalConfidence, countConfidence);

  float rho = mix(min(1.0, rhoCore + 0.018), rhoCore, confidence);

  // Keep only a very small global lift. The visible clean-air ring is added
  // later in the display shader so the storm interior does not brighten.
  float baselineLift = mix(0.0075, 0.0030, smoothstep(0.05, 0.45, irregularityMean));
  rho = min(rho + baselineLift, 1.015);

  float binNoise = (rand2d(vec2(binBase)) - 0.5) * 0.0065;
  float fineNoise = (rand2d(vec2(binBase) * 0.37 + vec2(19.0, 73.0)) - 0.5) * 0.0030;
  rho = clamp(rho + binNoise + fineNoise, 0.0, 1.05);

  float valid = step(2e-6, signal);
  fragmentColor = vec4(rho, rhoPrecip, irregularityMean, valid);
}
