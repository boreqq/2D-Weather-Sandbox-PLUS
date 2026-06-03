#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform sampler2D reflectivityTex;
uniform isampler2D wallTex;
uniform float reflMult;
uniform float reflBoost;
uniform float simHeightKm;
uniform float sourcePixelSize;

layout(location = 0) out vec4 fragmentColor;

#define DISTANCE 1
#define MAX_VERTICAL_BINS 1024

float calcDbz(float zhLinear)
{
  float zRaw = sqrt(max(zhLinear, 0.0)) * reflMult + max(zhLinear, 0.0) * reflBoost;
  return 4.3429448 * log(zRaw + 1e-6);
}

ivec2 getSourceCell(ivec2 cell)
{
  float blockSize = max(sourcePixelSize, 1.0);
  if (blockSize <= 1.0)
    return cell;

  vec2 productGrid = max(floor(resolution / blockSize), vec2(1.0));
  vec2 sourceCoord = (floor((vec2(cell) + vec2(0.5)) / resolution * productGrid) + vec2(0.5)) / productGrid;
  return ivec2(clamp(floor(sourceCoord * resolution), vec2(0.0), resolution - vec2(1.0)));
}

void main()
{
  int x = int(clamp(floor(fragCoord.x), 0.0, resolution.x - 1.0));
  float layerKm = simHeightKm / max(resolution.y, 1.0);
  float layerM = layerKm * 1000.0;

  float echoTopKm = 0.0;
  float maxDbz = -99.0;
  float vil = 0.0;

  for (int y = 0; y < MAX_VERTICAL_BINS; y++) {
    if (y >= int(resolution.y))
      break;

    ivec2 cell = ivec2(x, y);
    ivec2 wall = texelFetch(wallTex, cell, 0).xy;
    if (wall[DISTANCE] == 0)
      continue;

    float zhLinear = max(texelFetch(reflectivityTex, getSourceCell(cell), 0).r, 0.0);
    float dbz = calcDbz(zhLinear);
    maxDbz = max(maxDbz, dbz);

    if (dbz >= 5.0) {
      float zLinear = pow(10.0, clamp(dbz, -10.0, 80.0) / 10.0);
      vil += 3.44e-6 * pow(zLinear, 4.0 / 7.0) * layerM;
    }

    if (dbz >= 18.0)
      echoTopKm = (float(y) + 0.5) * layerKm;
  }

  float valid = smoothstep(0.1, 1.0, echoTopKm) * smoothstep(5.0, 25.0, maxDbz);
  float vild = valid > 0.0 ? vil / max(echoTopKm, layerKm) : 0.0;

  fragmentColor = vec4(echoTopKm, vil, vild, valid);
}
