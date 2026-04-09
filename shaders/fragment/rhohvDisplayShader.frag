#version 300 es
precision highp float;
precision highp sampler2D;
precision highp isampler2D;

in vec2 texCoord;
in vec2 fragCoord;

uniform vec2 resolution;
uniform vec2 texelSize;
uniform sampler2D rhohvTex;
uniform float productAlpha;
uniform bool productOpaque;

uniform vec3 view;   // Xpos  Ypos    Zoom
uniform vec4 cursor; // xpos   Ypos  Size   type

out vec4 fragmentColor;

#include "commonDisplay.glsl"

vec3 rhoColor(float rho)
{
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
    if (rho >= levels[i]) {
      float t = (rho - levels[i]) / (levels[i - 1] - levels[i]);
      return mix(cols[i], cols[i - 1], t);
    }
  }
  return cols[n - 1];
}

void main()
{
  vec4 rhoSample = texture(rhohvTex, texCoord);
  if (rhoSample.a <= 0.0)
    discard;

  float alpha = productOpaque ? 1.0 : productAlpha;
  fragmentColor = vec4(rhoColor(rhoSample.r), alpha);
  drawCursor(cursor, view);
}
