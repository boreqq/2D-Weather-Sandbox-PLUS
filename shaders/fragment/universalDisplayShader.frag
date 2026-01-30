#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;

uniform sampler2D anyTex; // can be any RGBW32F texture
uniform isampler2D wallTex;

uniform int quantityIndex; // which quantity to display
uniform float dispMultiplier;
uniform bool reflectivityMode;
uniform float reflMult;
uniform float reflBoost;
uniform float reflPixelSize; // >=1; 1 = no pixelation
uniform bool reflBackground; // true = opaque overwrite, false = overlay (alpha honored)

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

void main()
{
  vec2 sampleCoord = texCoord;
  if (reflectivityMode && reflPixelSize > 1.0) {
    vec2 grid = resolution / reflPixelSize;         // snap in sim-cell space
    sampleCoord = floor(texCoord * grid) / grid;    // square blocks in both axes
  }

  vec4 cell = texture(anyTex, sampleCoord);
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
    // bulk pseudo-reflectivity: scaled precipitation only (no cloud smear)
    float p = max(cell.z, 0.0);
    float z_raw = p * reflMult + p * p * reflBoost; // quadratic boost for strong precip
    if (z_raw < 0.001 || wall[1] == 0)
      discard; // keep background/terrain transparent

    float dBZ = 4.3429448 * log(z_raw + 1e-6); // 10*log10(x)
    float alpha = reflBackground ? 1.0 : clamp((dBZ - 5.0) / 30.0, 0.0, 0.60);
    fragmentColor = vec4(radarColor(dBZ), alpha);
  } else if (val > 0.0) {
    fragmentColor = vec4(1.0, 1.0 - val, 1.0 - val, 1.0);
  } else {
    fragmentColor = vec4(1.0 + val, 1.0 + val, 1.0, 1.0);
  }
  drawCursor(cursor, view);
}
