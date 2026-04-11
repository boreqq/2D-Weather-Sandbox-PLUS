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
  float validCells = 0.0;
  float echoCells = 0.0;
  float meanEchoSignalAccum = 0.0;

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
      validCells += 1.0;

      vec4 moments = texelFetch(radarMomentsTex, cell, 0);
      vec4 stats = texelFetch(phaseStatsTex, cell, 0);
      float cellSignal = max(moments.r, moments.g);
      sumZh += max(moments.r, 0.0);
      sumZv += max(moments.g, 0.0);
      sumHV += max(moments.b, 0.0);
      count += max(moments.a, 0.0);
      rhoParticleSum += max(stats.r, 0.0);
      rhoParticleSqSum += max(stats.g, 0.0);
      irregularitySum += max(stats.a, 0.0);
      if (cellSignal > 2e-6) {
        echoCells += 1.0;
        meanEchoSignalAccum += cellSignal;
      }
    }
  }

  float signal = max(sumZh, sumZv);
  if (signal <= 1e-8 || count <= 0.0) {
    fragmentColor = vec4(0.0);
    return;
  }

  float rhoRaw = sumHV / sqrt(max(sumZh * sumZv, 1e-12));
  rhoRaw = clamp(rhoRaw, 0.0, 1.0);

  float safeCount = max(count, 1.0);
  float rhoParticleMean = rhoParticleSum / safeCount;
  float rhoParticleVar = max(rhoParticleSqSum / safeCount - rhoParticleMean * rhoParticleMean, 0.0);
  float rhoParticleStd = sqrt(rhoParticleVar);
  float irregularityMean = irregularitySum / safeCount;
  float fillFraction = echoCells / max(validCells, 1.0);
  float meanEchoSignal = meanEchoSignalAccum / max(echoCells, 1.0);
  float partialFill = 1.0 - smoothstep(0.03, 0.18, fillFraction);

  float rhoCore = clamp(rhoRaw - rhoParticleStd * 0.10 - irregularityMean * 0.03, 0.0, 1.0);

  // Sparse bins in this superparticle model should collapse toward high CC
  // instead of producing isolated low-value pixels.
  float signalConfidence = smoothstep(2e-6, 3e-4, signal);
  float countConfidence = smoothstep(1.5, 4.5, count);
  float confidence = max(signalConfidence, countConfidence);
  float rho = mix(min(1.0, rhoCore + 0.035), rhoCore, confidence);

  float edgeSignalWindow = smoothstep(4e-6, 6e-5, meanEchoSignal) * (1.0 - smoothstep(2.0e-4, 1.0e-3, meanEchoSignal));
  float edgeBoost = 0.030 * partialFill * edgeSignalWindow * (1.0 - smoothstep(2.5, 7.0, count));
  edgeBoost += 0.012 * (1.0 - confidence) * (1.0 - smoothstep(4e-5, 4e-3, signal));
  float binNoise = (rand2d(vec2(binBase)) - 0.5) * 0.004;
  rho = clamp(rho + edgeBoost + binNoise, 0.0, 1.05);

  float valid = step(2e-6, signal);
  fragmentColor = vec4(rho, rhoRaw, irregularityMean, valid);
}
